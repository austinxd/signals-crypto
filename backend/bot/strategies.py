"""Deterministic strategies.

A strategy turns a DataFrame of CLOSED candles into per-bar orders. `prepare()` must be causal:
row i may only use rows <= i. The backtester and the live engine both call the same `prepare()`
and act on a signal at the NEXT bar's open, so backtest and live cannot drift apart.

Columns added by prepare():
    sig  : 1 = open long, -1 = open short, 0 = nothing
    sl   : stop-loss price for that signal
    tp   : take-profit price (NaN = no fixed target)
    atr  : ATR at that bar (used by trailing stops)
Position management parameters live in self.p: trail_atr, breakeven_r, max_bars (0 = disabled).
"""
import contextlib
import io
from typing import Any, Dict, List

import numpy as np
import pandas as pd
import ta


def _atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    atr = ta.volatility.average_true_range(df["high"], df["low"], df["close"], window=n)
    return atr.replace(0.0, np.nan)


def htf_frame(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Resample to a higher timeframe exposing only COMPLETED higher-timeframe bars."""
    agg = df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    ).dropna()
    return agg


def align_htf(series: pd.Series, index: pd.Index) -> pd.Series:
    """Shift one HTF bar (so the bar in progress is never seen) and forward-fill onto `index`."""
    return series.shift(1).reindex(index, method="ffill")


class Strategy:
    name = ""
    timeframe = "1h"
    warmup = 300
    defaults: Dict[str, Any] = {}
    grid: Dict[str, List[Any]] = {}
    features: List[str] = []

    def __init__(self, **params):
        unknown = set(params) - set(self.defaults)
        if unknown:
            raise ValueError(f"{self.name}: unknown params {sorted(unknown)}")
        self.p = {**self.defaults, **params}

    def prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        raise NotImplementedError

    def _finish(self, out: pd.DataFrame) -> pd.DataFrame:
        out["sig"] = out["sig"].fillna(0).astype(int)
        bad = out["sl"].isna() | out["atr"].isna()
        out.loc[bad, "sig"] = 0
        out.iloc[: self.warmup, out.columns.get_loc("sig")] = 0
        return out


class DonchianTrend(Strategy):
    """Trend following: break of the N-bar channel in the direction of the long trend, ATR trailing exit."""
    name = "donchian"
    timeframe = "4h"
    warmup = 250
    defaults = {"n": 20, "ema": 200, "sl_atr": 2.5, "trail_atr": 4.0, "breakeven_r": 1.0, "max_bars": 0,
                "allow_short": True, "short_tp_r": 3.0}
    grid = {"n": [20, 55], "sl_atr": [2.0, 3.0], "trail_atr": [3.0, 5.0]}
    features = ["close", "ema", "chan_high", "chan_low", "atr"]

    def prepare(self, df):
        p = self.p
        out = df.copy()
        out["atr"] = _atr(out)
        out["ema"] = ta.trend.ema_indicator(out["close"], window=p["ema"])
        out["chan_high"] = out["high"].rolling(p["n"]).max().shift(1)
        out["chan_low"] = out["low"].rolling(p["n"]).min().shift(1)
        long_ = (out["close"] > out["chan_high"]) & (out["close"] > out["ema"])
        short_ = (out["close"] < out["chan_low"]) & (out["close"] < out["ema"]) & bool(p["allow_short"])
        out["sig"] = np.where(long_, 1, np.where(short_, -1, 0))
        out["sl"] = np.where(out["sig"] >= 0, out["close"] - p["sl_atr"] * out["atr"],
                             out["close"] + p["sl_atr"] * out["atr"])
        # Falls in crypto are fast and snap back, so the trailing stop hands most of a short's gain back:
        # shorts take profit at a multiple of the risk. Longs keep running on the trailing stop alone.
        r = float(p.get("short_tp_r") or 0)
        out["tp"] = np.where((out["sig"] < 0) & (r > 0), out["close"] - r * (out["sl"] - out["close"]), np.nan)
        return self._finish(out)


class TrendPullback(Strategy):
    """Buy dips in a 4h uptrend / sell rallies in a 4h downtrend, entries on 1h."""
    name = "pullback"
    timeframe = "1h"
    warmup = 900  # 4h EMA200 needs ~800 1h bars
    defaults = {"rsi_low": 40, "lookback": 6, "sl_atr": 2.0, "tp_r": 2.0, "trail_atr": 0.0,
                "breakeven_r": 0.0, "max_bars": 0, "allow_short": True}
    grid = {"rsi_low": [35, 45], "sl_atr": [1.5, 2.5], "tp_r": [1.5, 3.0]}
    features = ["close", "ema20", "rsi", "htf_trend", "atr"]

    def prepare(self, df):
        p = self.p
        out = df.copy()
        out["atr"] = _atr(out)
        out["ema20"] = ta.trend.ema_indicator(out["close"], window=20)
        out["rsi"] = ta.momentum.rsi(out["close"], window=14)

        h = htf_frame(out, "4h")
        e50 = ta.trend.ema_indicator(h["close"], window=50)
        e200 = ta.trend.ema_indicator(h["close"], window=200)
        trend = pd.Series(0, index=h.index)
        trend[(h["close"] > e200) & (e50 > e200)] = 1
        trend[(h["close"] < e200) & (e50 < e200)] = -1
        trend[e200.isna()] = 0
        out["htf_trend"] = align_htf(trend, out.index).fillna(0)

        dipped = out["rsi"].rolling(p["lookback"]).min() < p["rsi_low"]
        rallied = out["rsi"].rolling(p["lookback"]).max() > 100 - p["rsi_low"]
        cross_up = (out["close"] > out["ema20"]) & (out["close"].shift(1) <= out["ema20"].shift(1))
        cross_dn = (out["close"] < out["ema20"]) & (out["close"].shift(1) >= out["ema20"].shift(1))
        long_ = (out["htf_trend"] == 1) & dipped & cross_up
        short_ = (out["htf_trend"] == -1) & rallied & cross_dn & bool(p["allow_short"])
        out["sig"] = np.where(long_, 1, np.where(short_, -1, 0))
        dist = p["sl_atr"] * out["atr"]
        out["sl"] = np.where(out["sig"] >= 0, out["close"] - dist, out["close"] + dist)
        out["tp"] = np.where(out["sig"] >= 0, out["close"] + p["tp_r"] * dist, out["close"] - p["tp_r"] * dist)
        return self._finish(out)


class Legacy(Strategy):
    """The rules that already exist in signals.py (detect_signal + its TP/SL), as a baseline.

    min_score maps to the app's trading modes: 0 = aggressive, 1.5 = balanced, 2.5 = conservative.
    Funding is not fed into the score here (historical funding per bar is not wired in).
    """
    name = "legacy"
    timeframe = "4h"
    warmup = 250
    defaults = {"min_score": 1.5, "trail_atr": 0.0, "breakeven_r": 0.0, "max_bars": 0}
    grid = {"min_score": [0.0, 1.5, 2.5]}
    features = ["close", "ema_200", "rsi", "macd_histogram", "volume_ratio", "score", "atr"]

    def prepare(self, df):
        from indicators import add_all_indicators, get_latest_indicators  # backend/indicators.py
        from signals import detect_signal, SignalType  # backend/signals.py

        out = add_all_indicators(df)
        out["atr"] = out["atr"].replace(0.0, np.nan)
        n = len(out)
        sig = np.zeros(n, dtype=int)
        sl = np.full(n, np.nan)
        tp = np.full(n, np.nan)
        score = np.full(n, np.nan)
        sink = io.StringIO()
        for i in range(self.warmup, n):
            window = out.iloc[max(0, i - 99): i + 1]  # get_latest_indicators only needs the tail
            ind = get_latest_indicators(window)
            if ind is None or ind.get("ema_200") != ind.get("ema_200"):
                continue
            with contextlib.redirect_stdout(sink):
                s = detect_signal("", ind)
            if s is None:
                continue
            score[i] = s.score
            if s.score < self.p["min_score"]:
                continue
            sig[i] = 1 if s.signal_type == SignalType.LONG else -1
            sl[i], tp[i] = s.stop_loss, s.take_profit
        out["sig"], out["sl"], out["tp"], out["score"] = sig, sl, tp, score
        return self._finish(out)


STRATEGIES = {cls.name: cls for cls in (DonchianTrend, TrendPullback, Legacy)}


def make_strategy(name: str, **params) -> Strategy:
    if name not in STRATEGIES:
        raise ValueError(f"Unknown strategy '{name}'. Available: {sorted(STRATEGIES)}")
    return STRATEGIES[name](**params)

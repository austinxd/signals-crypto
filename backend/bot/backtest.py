"""Portfolio backtester on closed candles, with fees, slippage and funding.

Timing model: a signal on bar t is filled at the open of bar t+1. Stops/targets are checked
against each bar's high/low with the conservative rules in risk.exit_fill().
"""
import itertools
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from . import data, risk as risk_mod
from .config import CostConfig, RiskConfig, TF_SECONDS
from .strategies import Strategy, make_strategy, STRATEGIES


@dataclass
class Result:
    trades: pd.DataFrame
    equity: pd.Series
    rejected: Dict[str, int] = field(default_factory=dict)
    initial: float = 10_000.0

    def metrics(self) -> Dict[str, Any]:
        return compute_metrics(self.equity, self.trades, self.initial)


def compute_metrics(equity: pd.Series, trades: pd.DataFrame, initial: float) -> Dict[str, Any]:
    m: Dict[str, Any] = {"trades": int(len(trades))}
    if equity.empty:
        return m
    final = float(equity.iloc[-1])
    years = max((equity.index[-1] - equity.index[0]).total_seconds() / (365.25 * 86400), 1e-9)
    m["return_pct"] = (final / initial - 1) * 100
    m["cagr_pct"] = ((final / initial) ** (1 / years) - 1) * 100 if final > 0 else -100.0
    peak = equity.cummax()
    m["max_dd_pct"] = float(((equity - peak) / peak).min() * -100)
    daily = equity.resample("1D").last().dropna().pct_change().dropna()
    m["sharpe"] = float(daily.mean() / daily.std() * math.sqrt(365)) if len(daily) > 2 and daily.std() > 0 else 0.0
    if len(trades):
        wins = trades[trades["pnl"] > 0]["pnl"].sum()
        losses = -trades[trades["pnl"] <= 0]["pnl"].sum()
        m["win_rate_pct"] = float((trades["pnl"] > 0).mean() * 100)
        m["profit_factor"] = float(wins / losses) if losses > 0 else float("inf")
        m["avg_r"] = float(trades["r"].mean())
        m["avg_bars"] = float(trades["bars"].mean())
        m["fees"] = float(trades["fees"].sum())
        m["funding"] = float(trades["funding"].sum())
    return m


def _funding_per_bar(funding: Optional[pd.Series], index: pd.DatetimeIndex, tf: str) -> np.ndarray:
    """Funding rate charged to a position still open at the END of each bar."""
    if funding is None or funding.empty:
        return np.zeros(len(index))
    bar_open = (funding.index - pd.Timedelta(milliseconds=1)).floor(f"{TF_SECONDS[tf]}s")
    per_bar = funding.groupby(bar_open).sum()
    return per_bar.reindex(index).fillna(0.0).to_numpy()


def run_backtest(prepared: Dict[str, pd.DataFrame], tf: str, mgmt: Dict[str, Any],
                 risk: RiskConfig, costs: CostConfig,
                 funding: Optional[Dict[str, pd.Series]] = None, initial: float = 10_000.0,
                 start: Optional[str] = None, end: Optional[str] = None) -> Result:
    """prepared: symbol -> DataFrame from Strategy.prepare(). mgmt: trail_atr / breakeven_r / max_bars."""
    index = None
    for df in prepared.values():
        index = df.index if index is None else index.union(df.index)
    if start:
        index = index[index >= pd.Timestamp(start)]
    if end:
        index = index[index < pd.Timestamp(end)]
    T = len(index)
    cols = ["time", "symbol", "side", "qty", "entry_time", "entry", "sl0", "tp", "exit_time", "exit",
            "reason", "pnl", "fees", "funding", "r", "bars"]
    if T < 2:
        return Result(pd.DataFrame(columns=cols), pd.Series(dtype=float), {}, initial)

    symbols = list(prepared)
    A = {}
    for s in symbols:
        d = prepared[s].reindex(index)
        A[s] = {k: d[k].to_numpy(dtype=float).tolist() for k in ("open", "high", "low", "close", "sl", "tp", "atr")}
        A[s]["sig"] = d["sig"].fillna(0).to_numpy(dtype=int).tolist()
        A[s]["fund"] = _funding_per_bar((funding or {}).get(s), index, tf).tolist()

    trail_atr = float(mgmt.get("trail_atr") or 0)
    breakeven_r = float(mgmt.get("breakeven_r") or 0)
    max_bars = int(mgmt.get("max_bars") or 0)
    fee, slip = costs.taker_fee, costs.slippage

    balance = initial
    equity_prev = initial
    day_start_equity = initial
    days = index.normalize().asi8.tolist()
    times = index.to_list()
    positions: Dict[str, dict] = {}
    pending: Dict[str, tuple] = {}
    last_close: Dict[str, float] = {}
    trades: List[dict] = []
    rejected: Dict[str, int] = {}
    equity_curve = [0.0] * T

    def close(s: str, pos: dict, price: float, t: int, reason: str):
        nonlocal balance
        price = price * (1 - slip * pos["side"])
        gross = pos["side"] * pos["qty"] * (price - pos["entry"])
        fee_exit = pos["qty"] * price * fee
        balance += gross - fee_exit
        fees = pos["fee_entry"] + fee_exit
        pnl = gross - fees + pos["funding"]
        trades.append({
            "time": times[t], "symbol": s, "side": pos["side"], "qty": pos["qty"],
            "entry_time": pos["entry_time"], "entry": pos["entry"], "sl0": pos["sl0"], "tp": pos["tp"],
            "exit_time": times[t], "exit": price, "reason": reason, "pnl": pnl, "fees": fees,
            "funding": pos["funding"], "r": pnl / (pos["qty"] * abs(pos["entry"] - pos["sl0"])),
            "bars": pos["bars"],
        })
        del positions[s]

    for t in range(T):
        if t and days[t] != days[t - 1]:
            day_start_equity = equity_prev
        for s in symbols:
            a = A[s]
            o = a["open"][t]
            if o != o:  # no candle for this symbol at this time
                continue
            h, l, c = a["high"][t], a["low"][t], a["close"][t]
            last_close[s] = c

            order = pending.pop(s, None)
            if order and s not in positions:
                side, sl, tp = order
                entry = o * (1 + slip * side)
                open_notional = sum(p["qty"] * last_close.get(k, p["entry"]) for k, p in positions.items())
                v = risk_mod.evaluate(risk, side, entry, sl, equity_prev, len(positions), open_notional,
                                      day_start_equity, sum(1 for p in positions.values() if p["side"] == side))
                if v.ok:
                    fee_entry = v.qty * entry * fee
                    balance -= fee_entry
                    positions[s] = {"side": side, "qty": v.qty, "entry": entry, "sl0": sl, "sl": sl, "tp": tp,
                                    "entry_time": times[t], "fee_entry": fee_entry, "funding": 0.0, "bars": 0,
                                    "hw": entry, "lw": entry, "exit_next": False}
                else:
                    key = v.reason.split(" ")[0]
                    rejected[key] = rejected.get(key, 0) + 1

            pos = positions.get(s)
            if pos:
                if pos["exit_next"]:
                    close(s, pos, o, t, "time")
                else:
                    hit = risk_mod.exit_fill(pos["side"], pos["sl"], pos["tp"], o, h, l)
                    if hit:
                        close(s, pos, hit[0], t, hit[1])
                if s in positions:
                    pos["bars"] += 1
                    pos["hw"] = max(pos["hw"], h)
                    pos["lw"] = min(pos["lw"], l)
                    rate = a["fund"][t]
                    if rate:
                        paid = -pos["side"] * pos["qty"] * c * rate
                        pos["funding"] += paid
                        balance += paid
                    pos["sl"] = risk_mod.managed_stop(pos["side"], pos["entry"], pos["sl0"], pos["sl"],
                                                      pos["hw"], pos["lw"], a["atr"][t], trail_atr, breakeven_r)
                    if max_bars and pos["bars"] >= max_bars:
                        pos["exit_next"] = True

            if s not in positions and a["sig"][t] != 0 and t < T - 1:
                pending[s] = (a["sig"][t], a["sl"][t], a["tp"][t])

        if t == T - 1:
            for s in list(positions):
                close(s, positions[s], last_close[s], t, "end")
        unreal = sum(p["side"] * p["qty"] * (last_close[k] - p["entry"]) for k, p in positions.items())
        equity_prev = balance + unreal
        equity_curve[t] = equity_prev

    return Result(pd.DataFrame(trades, columns=cols), pd.Series(equity_curve, index=index), rejected, initial)


# ---------------------------------------------------------------------------------------------
# Convenience layer: load data, run, walk-forward
# ---------------------------------------------------------------------------------------------

def load_market(symbols: List[str], tf: str, start: str, end: Optional[str] = None, refresh: bool = True):
    """Returns (klines by symbol, funding by symbol). Loads extra history before `start` for warm-up."""
    warm_start = (pd.Timestamp(start) - pd.Timedelta(seconds=TF_SECONDS[tf] * 1000)).strftime("%Y-%m-%d")
    klines = {s: data.load_klines(s, tf, warm_start, end, refresh=refresh) for s in symbols}
    funding = {s: data.load_funding(s, warm_start) for s in symbols}
    return klines, funding


def backtest_strategy(strategy: Strategy, klines, funding, risk: RiskConfig, costs: CostConfig,
                      initial: float = 10_000.0, start=None, end=None, prepared=None) -> Result:
    prepared = prepared or {s: strategy.prepare(df) for s, df in klines.items()}
    return run_backtest(prepared, strategy.timeframe, strategy.p, risk, costs, funding, initial, start, end)


def buy_and_hold(klines: Dict[str, pd.DataFrame], start=None, end=None) -> Dict[str, float]:
    """Equal-weight, unlevered buy & hold over the same window, as a reference."""
    curves = []
    for df in klines.values():
        c = df["close"]
        if start:
            c = c[c.index >= pd.Timestamp(start)]
        if end:
            c = c[c.index < pd.Timestamp(end)]
        if len(c):
            curves.append(c / c.iloc[0])
    if not curves:
        return {}
    eq = pd.concat(curves, axis=1).ffill().mean(axis=1)
    return {"return_pct": float((eq.iloc[-1] - 1) * 100),
            "max_dd_pct": float(((eq - eq.cummax()) / eq.cummax()).min() * -100)}


def _score(m: Dict[str, Any], min_trades: int) -> float:
    if m.get("trades", 0) < min_trades:
        return -math.inf
    return m["return_pct"] / max(m["max_dd_pct"], 1.0)


def walk_forward(name: str, klines, funding, risk: RiskConfig, costs: CostConfig, start: str, end: str,
                 train_months: int = 12, test_months: int = 3, initial: float = 10_000.0,
                 min_trades: int = 10, base_params: Optional[dict] = None) -> Dict[str, Any]:
    """Rolling optimisation: pick grid params on each training window, trade them on the next
    unseen window. The stitched out-of-sample result is the honest estimate of the strategy."""
    cls = STRATEGIES[name]
    keys = list(cls.grid)
    combos = [dict(zip(keys, vals)) for vals in itertools.product(*(cls.grid[k] for k in keys))] or [{}]
    strategies = [make_strategy(name, **{**(base_params or {}), **c}) for c in combos]
    prepared = [{s: st.prepare(df) for s, df in klines.items()} for st in strategies]

    windows = []
    cursor = pd.Timestamp(start) + pd.DateOffset(months=train_months)
    stop = pd.Timestamp(end)
    equity = initial
    all_trades, curves = [], []
    while cursor < stop:
        test_end = min(cursor + pd.DateOffset(months=test_months), stop)
        train_start = cursor - pd.DateOffset(months=train_months)
        scores = []
        for st, prep in zip(strategies, prepared):
            res = run_backtest(prep, st.timeframe, st.p, risk, costs, funding, initial, train_start, cursor)
            scores.append(_score(res.metrics(), min_trades))
        best = int(np.argmax(scores))
        st = strategies[best]
        oos = run_backtest(prepared[best], st.timeframe, st.p, risk, costs, funding, equity, cursor, test_end)
        m = oos.metrics()
        windows.append({"test_start": str(cursor.date()), "test_end": str(test_end.date()),
                        "params": combos[best], "train_score": scores[best],
                        "oos_return_pct": m.get("return_pct", 0.0), "oos_trades": m["trades"]})
        if len(oos.equity):
            equity = float(oos.equity.iloc[-1])
            curves.append(oos.equity)
        all_trades.append(oos.trades)
        cursor = test_end

    eq = pd.concat(curves) if curves else pd.Series(dtype=float)
    eq = eq[~eq.index.duplicated(keep="last")]
    non_empty = [t for t in all_trades if len(t)]
    trades = pd.concat(non_empty, ignore_index=True) if non_empty else pd.DataFrame(columns=["pnl"])
    return {"windows": windows, "metrics": compute_metrics(eq, trades, initial), "equity": eq, "trades": trades}

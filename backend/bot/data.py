"""Market data from Binance USDT-M futures public REST API, with an on-disk kline cache.

All DataFrames are indexed by candle OPEN time (UTC, naive) and contain only CLOSED candles.
"""
import time
from typing import Optional

import pandas as pd
import requests

from .config import DATA_DIR, TF_SECONDS

BASE = "https://fapi.binance.com"
_session = requests.Session()


def _get(path: str, params: dict, retries: int = 4):
    for attempt in range(retries):
        try:
            r = _session.get(BASE + path, params=params, timeout=15)
            if r.status_code in (418, 429) or r.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Binance request failed after {retries} attempts: {path}")


def _to_ms(ts) -> int:
    return int(pd.Timestamp(ts).timestamp() * 1000)


def _frame(rows, now_ms: Optional[int] = None) -> pd.DataFrame:
    cols = ["open_time", "open", "high", "low", "close", "volume", "close_time"]
    df = pd.DataFrame([r[:7] for r in rows], columns=cols)
    if df.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    if now_ms is not None:
        df = df[df["close_time"].astype("int64") < now_ms]
    df.index = pd.to_datetime(df["open_time"].astype("int64"), unit="ms")
    df.index.name = "time"
    return df[["open", "high", "low", "close", "volume"]].astype(float)


def fetch_klines(symbol: str, tf: str, start_ms: int, end_ms: Optional[int] = None) -> pd.DataFrame:
    """Download closed klines from start_ms (paginated)."""
    now_ms = int(time.time() * 1000)
    end_ms = min(end_ms or now_ms, now_ms)
    step = TF_SECONDS[tf] * 1000
    frames = []
    cursor = start_ms
    while cursor < end_ms:
        rows = _get("/fapi/v1/klines", {
            "symbol": symbol, "interval": tf, "startTime": cursor, "endTime": end_ms, "limit": 1500,
        })
        if not rows:
            break
        frames.append(_frame(rows, now_ms))
        cursor = int(rows[-1][0]) + step
        if len(rows) < 1500:
            break
    if not frames:
        return _frame([])
    df = pd.concat(frames)
    return df[~df.index.duplicated(keep="last")].sort_index()


def load_klines(symbol: str, tf: str, start: str, end: Optional[str] = None,
                refresh: bool = True) -> pd.DataFrame:
    """Klines from the local cache, downloading whatever is missing."""
    cache_dir = DATA_DIR / "klines"
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}_{tf}.csv"
    start_ts = pd.Timestamp(start)
    df = None
    if path.exists():
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        if len(df) and df.index[0] > start_ts + pd.Timedelta(seconds=TF_SECONDS[tf]):
            # cache starts later than requested: only refetch if the exchange has older data
            older = fetch_klines(symbol, tf, _to_ms(start_ts), _to_ms(df.index[0]))
            if len(older):
                df = pd.concat([older, df])
    if df is None or df.empty:
        df = fetch_klines(symbol, tf, _to_ms(start_ts))
    elif refresh:
        new = fetch_klines(symbol, tf, _to_ms(df.index[-1]))
        df = pd.concat([df, new])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.to_csv(path)
    out = df[df.index >= start_ts]
    if end:
        out = out[out.index < pd.Timestamp(end)]
    return out


def recent_klines(symbol: str, tf: str, limit: int = 1500) -> pd.DataFrame:
    """Most recent CLOSED klines (for the live engine)."""
    rows = _get("/fapi/v1/klines", {"symbol": symbol, "interval": tf, "limit": min(limit + 1, 1500)})
    return _frame(rows, int(time.time() * 1000))


def klines_since(symbol: str, tf: str, start_ms: int) -> pd.DataFrame:
    """Klines from start_ms INCLUDING the candle still forming (for stop/target checks)."""
    rows = _get("/fapi/v1/klines", {"symbol": symbol, "interval": tf, "startTime": start_ms, "limit": 1500})
    return _frame(rows, None)


def last_price(symbol: str) -> float:
    return float(_get("/fapi/v1/ticker/price", {"symbol": symbol})["price"])


def load_funding(symbol: str, start: str) -> pd.Series:
    """Historical funding rates (cached). Index = funding time, value = rate."""
    cache_dir = DATA_DIR / "funding"
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}.csv"
    s = None
    if path.exists():
        s = pd.read_csv(path, index_col=0, parse_dates=True)["rate"]
    cursor = _to_ms(start) if s is None or s.empty or s.index[0] > pd.Timestamp(start) + pd.Timedelta(days=1) \
        else _to_ms(s.index[-1]) + 1
    parts = [] if s is None else [s]
    while True:
        rows = _get("/fapi/v1/fundingRate", {"symbol": symbol, "startTime": cursor, "limit": 1000})
        if not rows:
            break
        idx = pd.to_datetime([int(r["fundingTime"]) for r in rows], unit="ms")
        parts.append(pd.Series([float(r["fundingRate"]) for r in rows], index=idx, name="rate"))
        cursor = int(rows[-1]["fundingTime"]) + 1
        if len(rows) < 1000:
            break
    if not parts:
        return pd.Series(dtype=float, name="rate")
    s = pd.concat(parts)
    s = s[~s.index.duplicated(keep="last")].sort_index()
    s.name = "rate"
    s.to_csv(path, index_label="time")
    return s[s.index >= pd.Timestamp(start)]


def funding_since(symbol: str, start_ms: int) -> list:
    """Funding events after start_ms: list of (time_ms, rate, mark_price)."""
    rows = _get("/fapi/v1/fundingRate", {"symbol": symbol, "startTime": start_ms, "limit": 1000})
    return [(int(r["fundingTime"]), float(r["fundingRate"]), float(r.get("markPrice") or 0)) for r in rows]

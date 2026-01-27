"""
Technical indicators calculation using TA library.
"""
import numpy as np
import pandas as pd
import ta
from typing import Dict, Any, Optional

from config import (
    EMA_PERIOD,
    RSI_PERIOD,
    MACD_FAST,
    MACD_SLOW,
    MACD_SIGNAL,
    VOLUME_MA_PERIOD,
)


def calculate_ema(df: pd.DataFrame, period: int = EMA_PERIOD) -> pd.Series:
    """Calculate Exponential Moving Average."""
    return ta.trend.ema_indicator(df["close"], window=period)


def calculate_rsi(df: pd.DataFrame, period: int = RSI_PERIOD) -> pd.Series:
    """Calculate Relative Strength Index."""
    return ta.momentum.rsi(df["close"], window=period)


def calculate_macd(
    df: pd.DataFrame,
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal: int = MACD_SIGNAL,
) -> Dict[str, pd.Series]:
    """Calculate MACD indicator."""
    macd = ta.trend.MACD(df["close"], window_slow=slow, window_fast=fast, window_sign=signal)
    return {
        "macd": macd.macd(),
        "signal": macd.macd_signal(),
        "histogram": macd.macd_diff(),
    }


def calculate_volume_ma(df: pd.DataFrame, period: int = VOLUME_MA_PERIOD) -> pd.Series:
    """Calculate Volume Moving Average."""
    return df["volume"].rolling(window=period).mean()


def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Calculate Average True Range for dynamic SL/TP."""
    return ta.volatility.average_true_range(df["high"], df["low"], df["close"], window=period)


def calculate_fibonacci_levels(df: pd.DataFrame, lookback: int = 50) -> Optional[Dict[str, Any]]:
    """Calculate Fibonacci retracement levels based on recent swing high/low."""
    if df is None or len(df) < lookback:
        return None

    recent = df.tail(lookback)
    swing_high = recent["high"].max()
    swing_low = recent["low"].min()
    swing_high_idx = recent["high"].idxmax()
    swing_low_idx = recent["low"].idxmin()
    is_uptrend = swing_low_idx < swing_high_idx
    price_range = swing_high - swing_low
    if price_range == 0:
        return None

    current_price = df.iloc[-1]["close"]

    fib_ratios = {
        "0.0": 0.0, "23.6": 0.236, "38.2": 0.382,
        "50.0": 0.5, "61.8": 0.618, "78.6": 0.786, "100.0": 1.0,
    }

    levels = {}
    if is_uptrend:
        for name, ratio in fib_ratios.items():
            levels[name] = swing_high - (price_range * ratio)
    else:
        for name, ratio in fib_ratios.items():
            levels[name] = swing_low + (price_range * ratio)

    closest_level = None
    closest_distance = float("inf")
    closest_name = None
    for name, level in levels.items():
        distance = abs(current_price - level)
        if distance < closest_distance:
            closest_distance = distance
            closest_level = level
            closest_name = name

    distance_percent = ((current_price - closest_level) / current_price) * 100

    key_levels = ["38.2", "50.0", "61.8"]
    at_key_level = False
    near_key_level = False
    key_level_name = None
    for key in key_levels:
        level = levels[key]
        dist_pct = abs((current_price - level) / current_price) * 100
        if dist_pct < 0.5:
            at_key_level = True
            key_level_name = key
            break
        elif dist_pct < 1.5:
            near_key_level = True
            key_level_name = key

    if at_key_level:
        if is_uptrend:
            recommendation = f"ENTRADA OPTIMA - En soporte Fibo {key_level_name}%"
        else:
            recommendation = f"ENTRADA OPTIMA - En resistencia Fibo {key_level_name}%"
        entry_quality = "optimal"
    elif near_key_level:
        recommendation = f"Cerca de nivel Fibo {key_level_name}% - Buena zona"
        entry_quality = "good"
    else:
        recommendation = f"Lejos de niveles clave Fibo - Entrada agresiva"
        entry_quality = "aggressive"

    return {
        "swing_high": swing_high,
        "swing_low": swing_low,
        "is_uptrend": is_uptrend,
        "levels": levels,
        "current_price": current_price,
        "closest_level": closest_level,
        "closest_level_name": closest_name,
        "distance_to_closest": closest_distance,
        "distance_percent": distance_percent,
        "at_key_level": at_key_level,
        "near_key_level": near_key_level,
        "key_level_name": key_level_name,
        "entry_quality": entry_quality,
        "recommendation": recommendation,
    }


def detect_rsi_divergence(df: pd.DataFrame, lookback: int = 20) -> Optional[Dict[str, Any]]:
    """
    Detect RSI divergence.
    - Bearish divergence: price makes higher-high, RSI makes lower-high
    - Bullish divergence: price makes lower-low, RSI makes higher-low
    """
    if df is None or len(df) < lookback + 5:
        return None

    recent = df.tail(lookback)
    prices = recent["close"].values
    rsi_vals = recent["rsi"].values if "rsi" in recent.columns else None

    if rsi_vals is None or np.isnan(rsi_vals).any():
        return None

    # Find local peaks and troughs (simplified: compare halves)
    mid = lookback // 2
    first_half_prices = prices[:mid]
    second_half_prices = prices[mid:]
    first_half_rsi = rsi_vals[:mid]
    second_half_rsi = rsi_vals[mid:]

    first_price_high = np.max(first_half_prices)
    second_price_high = np.max(second_half_prices)
    first_rsi_high = np.max(first_half_rsi)
    second_rsi_high = np.max(second_half_rsi)

    first_price_low = np.min(first_half_prices)
    second_price_low = np.min(second_half_prices)
    first_rsi_low = np.min(first_half_rsi)
    second_rsi_low = np.min(second_half_rsi)

    result = {
        "bearish_divergence": False,
        "bullish_divergence": False,
        "type": None,
    }

    # Bearish divergence: price higher-high + RSI lower-high
    if second_price_high > first_price_high and second_rsi_high < first_rsi_high:
        result["bearish_divergence"] = True
        result["type"] = "bearish"

    # Bullish divergence: price lower-low + RSI higher-low
    if second_price_low < first_price_low and second_rsi_low > first_rsi_low:
        result["bullish_divergence"] = True
        result["type"] = "bullish"

    if not result["bearish_divergence"] and not result["bullish_divergence"]:
        return None

    return result


def add_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Add all technical indicators to the DataFrame."""
    df = df.copy()

    # EMA 200
    df["ema_200"] = calculate_ema(df, EMA_PERIOD)

    # RSI
    df["rsi"] = calculate_rsi(df, RSI_PERIOD)
    df["rsi_ma"] = df["rsi"].rolling(window=5).mean()

    # MACD
    macd_data = calculate_macd(df)
    df["macd"] = macd_data["macd"]
    df["macd_signal"] = macd_data["signal"]
    df["macd_histogram"] = macd_data["histogram"]

    # Volume
    df["volume_ma"] = calculate_volume_ma(df, VOLUME_MA_PERIOD)
    df["volume_ratio"] = df["volume"] / df["volume_ma"]

    # ATR for dynamic SL/TP
    df["atr"] = calculate_atr(df)

    return df


def to_python_type(value):
    """Convert numpy types to native Python types for JSON serialization."""
    if isinstance(value, (np.integer, np.int64)):
        return int(value)
    if isinstance(value, (np.floating, np.float64)):
        return float(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    return value


def get_latest_indicators(df: pd.DataFrame) -> Optional[Dict[str, Any]]:
    """Get the latest indicator values."""
    if df is None or len(df) < 2:
        return None

    latest = df.iloc[-1]
    previous = df.iloc[-2]

    # Smoothed RSI detection
    rsi_last_3 = df["rsi"].iloc[-4:-1].mean()
    rsi_smoothed_rising = latest["rsi"] > rsi_last_3
    rsi_smoothed_falling = latest["rsi"] < rsi_last_3

    result = {
        "price": latest["close"],
        "ema_200": latest["ema_200"],
        "price_above_ema": latest["close"] > latest["ema_200"],
        "rsi": latest["rsi"],
        "rsi_previous": previous["rsi"],
        "rsi_ma": latest["rsi_ma"],
        "rsi_avg_3": rsi_last_3,
        "rsi_above_ma": latest["rsi"] > latest["rsi_ma"],
        "rsi_rising": rsi_smoothed_rising,
        "rsi_falling": rsi_smoothed_falling,
        "macd": latest["macd"],
        "macd_signal": latest["macd_signal"],
        "macd_previous": previous["macd"],
        "macd_signal_previous": previous["macd_signal"],
        "macd_histogram": latest["macd_histogram"],
        "macd_crossover_bullish": (
            latest["macd"] > latest["macd_signal"]
            and previous["macd"] <= previous["macd_signal"]
        ),
        "macd_crossover_bearish": (
            latest["macd"] < latest["macd_signal"]
            and previous["macd"] >= previous["macd_signal"]
        ),
        "volume": latest["volume"],
        "volume_ma": latest["volume_ma"],
        "volume_above_average": latest["volume"] > latest["volume_ma"],
        "volume_ratio": latest["volume_ratio"],
        "atr": latest["atr"],
        "timestamp": df.index[-1].isoformat(),
    }

    # Calculate Fibonacci levels
    fib_data = calculate_fibonacci_levels(df)
    if fib_data:
        result["fibonacci"] = {
            "swing_high": fib_data["swing_high"],
            "swing_low": fib_data["swing_low"],
            "is_uptrend": fib_data["is_uptrend"],
            "levels": {k: to_python_type(v) for k, v in fib_data["levels"].items()},
            "closest_level": fib_data["closest_level"],
            "closest_level_name": fib_data["closest_level_name"],
            "distance_percent": fib_data["distance_percent"],
            "at_key_level": fib_data["at_key_level"],
            "near_key_level": fib_data["near_key_level"],
            "key_level_name": fib_data["key_level_name"],
            "entry_quality": fib_data["entry_quality"],
            "recommendation": fib_data["recommendation"],
        }

    # RSI Divergence detection
    divergence = detect_rsi_divergence(df)
    if divergence:
        result["divergence"] = divergence

    # Convert all numpy types to native Python types
    def convert_value(v):
        if isinstance(v, dict):
            return {k2: convert_value(v2) for k2, v2 in v.items()}
        return to_python_type(v)

    return {k: convert_value(v) for k, v in result.items()}

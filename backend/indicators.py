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
    """
    Calculate MACD indicator.

    Returns:
        Dict with 'macd', 'signal', and 'histogram' series
    """
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


def add_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add all technical indicators to the DataFrame.

    Args:
        df: DataFrame with OHLCV data

    Returns:
        DataFrame with added indicator columns
    """
    df = df.copy()

    # EMA 200
    df["ema_200"] = calculate_ema(df, EMA_PERIOD)

    # RSI
    df["rsi"] = calculate_rsi(df, RSI_PERIOD)
    df["rsi_ma"] = df["rsi"].rolling(window=5).mean()  # RSI moving average for crossover detection

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
    """
    Get the latest indicator values.

    Args:
        df: DataFrame with indicators already calculated

    Returns:
        Dict with latest values for all indicators
    """
    if df is None or len(df) < 2:
        return None

    latest = df.iloc[-1]
    previous = df.iloc[-2]

    result = {
        "price": latest["close"],
        "ema_200": latest["ema_200"],
        "price_above_ema": latest["close"] > latest["ema_200"],
        "rsi": latest["rsi"],
        "rsi_previous": previous["rsi"],
        "rsi_ma": latest["rsi_ma"],
        "rsi_above_ma": latest["rsi"] > latest["rsi_ma"],
        "rsi_rising": latest["rsi"] > previous["rsi"],
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

    # Convert all numpy types to native Python types
    return {k: to_python_type(v) for k, v in result.items()}

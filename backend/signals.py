"""
Signal detection logic for trading signals.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Any, Optional, List
from enum import Enum

from config import (
    RSI_OVERSOLD,
    RSI_OVERBOUGHT,
    STOP_LOSS_PERCENT,
    TAKE_PROFIT_PERCENT,
)


class SignalType(Enum):
    LONG = "LONG"
    SHORT = "SHORT"


@dataclass
class Signal:
    """Trading signal data class."""
    pair: str
    signal_type: SignalType
    entry_price: float
    take_profit: float
    stop_loss: float
    timestamp: str
    indicators: Dict[str, Any]
    timeframe: str = "4h"
    funding_info: Optional[Dict[str, Any]] = None
    fibonacci_info: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert signal to dictionary."""
        result = {
            "pair": self.pair,
            "side": self.signal_type.value,
            "entry": round(self.entry_price, 2),
            "takeProfit": round(self.take_profit, 2),
            "stopLoss": round(self.stop_loss, 2),
            "timestamp": self.timestamp,
            "timeframe": self.timeframe,
            "indicators": {
                "rsi": round(self.indicators.get("rsi", 0), 2),
                "macd": round(self.indicators.get("macd", 0), 4),
                "macd_signal": round(self.indicators.get("macd_signal", 0), 4),
                "ema_200": round(self.indicators.get("ema_200", 0), 2),
                "volume_ratio": round(self.indicators.get("volume_ratio", 0), 2),
            },
        }
        if self.funding_info:
            result["funding"] = {
                "rate_percent": round(self.funding_info.get("funding_rate_percent", 0), 4),
                "sentiment": self.funding_info.get("sentiment", "unknown"),
                "recommendation": self.funding_info.get("recommendation", ""),
            }
        if self.fibonacci_info:
            result["fibonacci"] = {
                "entry_quality": self.fibonacci_info.get("entry_quality", "unknown"),
                "recommendation": self.fibonacci_info.get("recommendation", ""),
                "closest_level": self.fibonacci_info.get("closest_level_name", ""),
                "distance_percent": round(self.fibonacci_info.get("distance_percent", 0), 2),
                "at_key_level": self.fibonacci_info.get("at_key_level", False),
                "swing_high": round(self.fibonacci_info.get("swing_high", 0), 2),
                "swing_low": round(self.fibonacci_info.get("swing_low", 0), 2),
            }
        return result


def calculate_tp_sl(
    entry: float,
    signal_type: SignalType,
    sl_percent: float = STOP_LOSS_PERCENT,
    tp_percent: float = TAKE_PROFIT_PERCENT,
    atr: Optional[float] = None,
    fibonacci: Optional[Dict[str, Any]] = None,
) -> tuple[float, float]:
    """
    Calculate Take Profit and Stop Loss levels.

    Args:
        entry: Entry price
        signal_type: LONG or SHORT
        sl_percent: Stop loss percentage
        tp_percent: Take profit percentage
        atr: Optional ATR for dynamic calculation
        fibonacci: Optional Fibonacci levels for smarter TP/SL

    Returns:
        Tuple of (take_profit, stop_loss)
    """
    # Try to use Fibonacci levels first
    if fibonacci and fibonacci.get("levels"):
        levels = fibonacci["levels"]
        sorted_levels = sorted(levels.values())

        if signal_type == SignalType.LONG:
            # For LONG: SL below entry, TP above entry
            # Find next level below entry for SL
            levels_below = [l for l in sorted_levels if l < entry]
            # Find next level above entry for TP
            levels_above = [l for l in sorted_levels if l > entry]

            if levels_below and levels_above:
                stop_loss = levels_below[-1] * 0.995  # Slightly below Fibo level
                take_profit = levels_above[0] if len(levels_above) == 1 else levels_above[1]  # Target 2nd level up
                return take_profit, stop_loss

        else:  # SHORT
            # For SHORT: SL above entry, TP below entry
            levels_above = [l for l in sorted_levels if l > entry]
            levels_below = [l for l in sorted_levels if l < entry]

            if levels_above and levels_below:
                stop_loss = levels_above[0] * 1.005  # Slightly above Fibo level
                take_profit = levels_below[-1] if len(levels_below) == 1 else levels_below[-2]  # Target 2nd level down
                return take_profit, stop_loss

    # Fallback to ATR or percentage-based
    if atr is not None:
        sl_distance = atr * 1.5
        tp_distance = atr * 3
    else:
        sl_distance = entry * (sl_percent / 100)
        tp_distance = entry * (tp_percent / 100)

    if signal_type == SignalType.LONG:
        take_profit = entry + tp_distance
        stop_loss = entry - sl_distance
    else:  # SHORT
        take_profit = entry - tp_distance
        stop_loss = entry + sl_distance

    return take_profit, stop_loss


def check_long_signal(indicators: Dict[str, Any]) -> bool:
    """
    Check if conditions for a LONG signal are met.

    Conditions:
    - Price > EMA 200
    - RSI < 40 and rising (crossing above its MA)
    - MACD bullish crossover (line crosses above signal)
    - Volume > 20-period average
    """
    if indicators is None:
        return False

    conditions = [
        indicators.get("price_above_ema", False),
        indicators.get("rsi", 100) < RSI_OVERSOLD,
        indicators.get("rsi_rising", False),
        indicators.get("macd_crossover_bullish", False),
        indicators.get("volume_above_average", False),
    ]

    return all(conditions)


def check_short_signal(indicators: Dict[str, Any]) -> bool:
    """
    Check if conditions for a SHORT signal are met.

    Conditions:
    - Price < EMA 200
    - RSI > 60 and falling
    - MACD bearish crossover (line crosses below signal)
    - Volume > 20-period average
    """
    if indicators is None:
        return False

    conditions = [
        not indicators.get("price_above_ema", True),
        indicators.get("rsi", 0) > RSI_OVERBOUGHT,
        not indicators.get("rsi_rising", True),
        indicators.get("macd_crossover_bearish", False),
        indicators.get("volume_above_average", False),
    ]

    return all(conditions)


def detect_signal(
    pair: str,
    indicators: Dict[str, Any],
    funding_data: Optional[Dict[str, Any]] = None
) -> Optional[Signal]:
    """
    Detect trading signal based on indicators, funding rate, and Fibonacci.

    Args:
        pair: Trading pair (e.g., 'BTC/USDT')
        indicators: Dictionary of indicator values
        funding_data: Optional funding rate data

    Returns:
        Signal object if conditions are met, None otherwise
    """
    if indicators is None:
        return None

    entry_price = indicators.get("price", 0)
    atr = indicators.get("atr")
    timestamp = indicators.get("timestamp", datetime.utcnow().isoformat())
    fibonacci = indicators.get("fibonacci")

    # Get funding sentiment
    funding_sentiment = funding_data.get("sentiment") if funding_data else None

    # Check LONG signal
    if check_long_signal(indicators):
        # Block LONG if too many longs (high positive funding)
        if funding_sentiment == "too_many_longs":
            print(f"LONG signal blocked for {pair}: funding too positive (too many longs)")
            return None

        tp, sl = calculate_tp_sl(entry_price, SignalType.LONG, atr=atr, fibonacci=fibonacci)
        return Signal(
            pair=pair,
            signal_type=SignalType.LONG,
            entry_price=entry_price,
            take_profit=tp,
            stop_loss=sl,
            timestamp=timestamp,
            indicators=indicators,
            funding_info=funding_data,
            fibonacci_info=fibonacci,
        )

    # Check SHORT signal
    if check_short_signal(indicators):
        # Block SHORT if too many shorts (high negative funding)
        if funding_sentiment == "too_many_shorts":
            print(f"SHORT signal blocked for {pair}: funding too negative (too many shorts)")
            return None

        tp, sl = calculate_tp_sl(entry_price, SignalType.SHORT, atr=atr, fibonacci=fibonacci)
        return Signal(
            pair=pair,
            signal_type=SignalType.SHORT,
            entry_price=entry_price,
            take_profit=tp,
            stop_loss=sl,
            timestamp=timestamp,
            indicators=indicators,
            funding_info=funding_data,
            fibonacci_info=fibonacci,
        )

    return None


class SignalHistory:
    """Manages signal history and cooldowns."""

    def __init__(self, cooldown_seconds: int = 14400):  # 4 hours default
        self.signals: List[Signal] = []
        self.last_signal_time: Dict[str, datetime] = {}
        self.cooldown = cooldown_seconds

    def can_send_signal(self, pair: str) -> bool:
        """Check if enough time has passed since last signal for this pair."""
        if pair not in self.last_signal_time:
            return True
        elapsed = (datetime.utcnow() - self.last_signal_time[pair]).total_seconds()
        return elapsed >= self.cooldown

    def add_signal(self, signal: Signal):
        """Add a signal to history."""
        self.signals.append(signal)
        self.last_signal_time[signal.pair] = datetime.utcnow()
        # Keep only last 100 signals
        if len(self.signals) > 100:
            self.signals = self.signals[-100:]

    def get_recent_signals(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get recent signals as list of dicts."""
        return [s.to_dict() for s in reversed(self.signals[-limit:])]

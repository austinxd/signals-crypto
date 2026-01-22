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

    def to_dict(self) -> Dict[str, Any]:
        """Convert signal to dictionary."""
        return {
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


def calculate_tp_sl(
    entry: float,
    signal_type: SignalType,
    sl_percent: float = STOP_LOSS_PERCENT,
    tp_percent: float = TAKE_PROFIT_PERCENT,
    atr: Optional[float] = None,
) -> tuple[float, float]:
    """
    Calculate Take Profit and Stop Loss levels.

    Args:
        entry: Entry price
        signal_type: LONG or SHORT
        sl_percent: Stop loss percentage
        tp_percent: Take profit percentage
        atr: Optional ATR for dynamic calculation

    Returns:
        Tuple of (take_profit, stop_loss)
    """
    if atr is not None:
        # Dynamic SL/TP based on ATR (1.5x ATR for SL, 3x ATR for TP)
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


def detect_signal(pair: str, indicators: Dict[str, Any]) -> Optional[Signal]:
    """
    Detect trading signal based on indicators.

    Args:
        pair: Trading pair (e.g., 'BTC/USDT')
        indicators: Dictionary of indicator values

    Returns:
        Signal object if conditions are met, None otherwise
    """
    if indicators is None:
        return None

    entry_price = indicators.get("price", 0)
    atr = indicators.get("atr")
    timestamp = indicators.get("timestamp", datetime.utcnow().isoformat())

    if check_long_signal(indicators):
        tp, sl = calculate_tp_sl(entry_price, SignalType.LONG, atr=atr)
        return Signal(
            pair=pair,
            signal_type=SignalType.LONG,
            entry_price=entry_price,
            take_profit=tp,
            stop_loss=sl,
            timestamp=timestamp,
            indicators=indicators,
        )

    if check_short_signal(indicators):
        tp, sl = calculate_tp_sl(entry_price, SignalType.SHORT, atr=atr)
        return Signal(
            pair=pair,
            signal_type=SignalType.SHORT,
            entry_price=entry_price,
            take_profit=tp,
            stop_loss=sl,
            timestamp=timestamp,
            indicators=indicators,
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

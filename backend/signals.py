"""
Signal detection logic for trading signals.
New paradigm: Base detection + Quality scoring
"""
from dataclasses import dataclass, field
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


class SignalQuality(Enum):
    TEMPRANA = "TEMPRANA"  # Early signal, low confluence
    BUENA = "BUENA"        # Good signal, medium confluence
    OPTIMA = "OPTIMA"      # Optimal signal, high confluence


# Dynamic cooldowns based on quality (in seconds)
COOLDOWNS = {
    SignalQuality.OPTIMA: 14400,    # 4 hours
    SignalQuality.BUENA: 7200,      # 2 hours
    SignalQuality.TEMPRANA: 3600,   # 1 hour
}


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
    quality: SignalQuality = SignalQuality.TEMPRANA
    score: float = 0.0
    score_details: Dict[str, float] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    timeframe: str = "4h"
    funding_info: Optional[Dict[str, Any]] = None
    fibonacci_info: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert signal to dictionary."""
        result = {
            "pair": self.pair,
            "side": self.signal_type.value,
            "quality": self.quality.value,
            "score": round(self.score, 1),
            "score_details": self.score_details,
            "warnings": self.warnings,
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
            levels_below = [l for l in sorted_levels if l < entry]
            levels_above = [l for l in sorted_levels if l > entry]

            if levels_below and levels_above:
                stop_loss = levels_below[-1] * 0.995
                take_profit = levels_above[0] if len(levels_above) == 1 else levels_above[1]
                return take_profit, stop_loss

        else:  # SHORT
            levels_above = [l for l in sorted_levels if l > entry]
            levels_below = [l for l in sorted_levels if l < entry]

            if levels_above and levels_below:
                stop_loss = levels_above[0] * 1.005
                take_profit = levels_below[-1] if len(levels_below) == 1 else levels_below[-2]
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


def check_long_base(indicators: Dict[str, Any]) -> bool:
    """
    Check BASE conditions for LONG signal (minimum to alert).
    Only 2 conditions: Price > EMA200 AND RSI rising
    """
    if indicators is None:
        return False

    return (
        indicators.get("price_above_ema", False) and
        indicators.get("rsi_rising", False)
    )


def check_short_base(indicators: Dict[str, Any]) -> bool:
    """
    Check BASE conditions for SHORT signal (minimum to alert).
    Only 2 conditions: Price < EMA200 AND RSI falling
    """
    if indicators is None:
        return False

    return (
        not indicators.get("price_above_ema", True) and
        indicators.get("rsi_falling", False)
    )


def calculate_long_score(
    indicators: Dict[str, Any],
    funding_data: Optional[Dict[str, Any]] = None
) -> tuple[float, Dict[str, float], List[str]]:
    """
    Calculate quality score for LONG signal.
    Returns: (total_score, score_details, warnings)
    """
    score = 0.0
    details = {}
    warnings = []

    # RSI in oversold zone (< 40)
    rsi = indicators.get("rsi", 50)
    if rsi < RSI_OVERSOLD:
        score += 1.0
        details["rsi_oversold"] = 1.0
    elif rsi < 50:
        score += 0.5
        details["rsi_neutral_low"] = 0.5

    # MACD bullish crossover
    if indicators.get("macd_crossover_bullish", False):
        score += 1.0
        details["macd_crossover"] = 1.0
    elif indicators.get("macd_histogram", 0) > 0:
        score += 0.5
        details["macd_positive"] = 0.5

    # Volume above average
    if indicators.get("volume_above_average", False):
        score += 1.0
        details["volume_high"] = 1.0
    elif indicators.get("volume_ratio", 0) > 0.8:
        score += 0.3
        details["volume_decent"] = 0.3

    # Funding rate analysis (no longer blocks, affects score)
    if funding_data:
        sentiment = funding_data.get("sentiment", "")
        if sentiment == "too_many_shorts":
            score += 0.5
            details["funding_favorable"] = 0.5
        elif sentiment == "too_many_longs":
            score -= 0.5
            details["funding_unfavorable"] = -0.5
            warnings.append("⚠️ Funding alto: mercado cargado de longs")
        elif sentiment in ("slightly_short", "balanced"):
            score += 0.25
            details["funding_neutral"] = 0.25

    # Fibonacci quality bonus
    fib = indicators.get("fibonacci")
    if fib:
        entry_quality = fib.get("entry_quality", "")
        if entry_quality == "optimal":
            score += 0.5
            details["fibo_optimal"] = 0.5
        elif entry_quality == "good":
            score += 0.25
            details["fibo_good"] = 0.25

    return score, details, warnings


def calculate_short_score(
    indicators: Dict[str, Any],
    funding_data: Optional[Dict[str, Any]] = None
) -> tuple[float, Dict[str, float], List[str]]:
    """
    Calculate quality score for SHORT signal.
    Returns: (total_score, score_details, warnings)
    """
    score = 0.0
    details = {}
    warnings = []

    # RSI in overbought zone (> 60)
    rsi = indicators.get("rsi", 50)
    if rsi > RSI_OVERBOUGHT:
        score += 1.0
        details["rsi_overbought"] = 1.0
    elif rsi > 50:
        score += 0.5
        details["rsi_neutral_high"] = 0.5

    # MACD bearish crossover
    if indicators.get("macd_crossover_bearish", False):
        score += 1.0
        details["macd_crossover"] = 1.0
    elif indicators.get("macd_histogram", 0) < 0:
        score += 0.5
        details["macd_negative"] = 0.5

    # Volume above average
    if indicators.get("volume_above_average", False):
        score += 1.0
        details["volume_high"] = 1.0
    elif indicators.get("volume_ratio", 0) > 0.8:
        score += 0.3
        details["volume_decent"] = 0.3

    # Funding rate analysis (no longer blocks, affects score)
    if funding_data:
        sentiment = funding_data.get("sentiment", "")
        if sentiment == "too_many_longs":
            score += 0.5
            details["funding_favorable"] = 0.5
        elif sentiment == "too_many_shorts":
            score -= 0.5
            details["funding_unfavorable"] = -0.5
            warnings.append("⚠️ Funding bajo: mercado cargado de shorts")
        elif sentiment in ("slightly_long", "balanced"):
            score += 0.25
            details["funding_neutral"] = 0.25

    # Fibonacci quality bonus
    fib = indicators.get("fibonacci")
    if fib:
        entry_quality = fib.get("entry_quality", "")
        if entry_quality == "optimal":
            score += 0.5
            details["fibo_optimal"] = 0.5
        elif entry_quality == "good":
            score += 0.25
            details["fibo_good"] = 0.25

    return score, details, warnings


def score_to_quality(score: float) -> SignalQuality:
    """Convert numeric score to quality level."""
    if score >= 3.0:
        return SignalQuality.OPTIMA
    elif score >= 1.5:
        return SignalQuality.BUENA
    else:
        return SignalQuality.TEMPRANA


def detect_signal(
    pair: str,
    indicators: Dict[str, Any],
    funding_data: Optional[Dict[str, Any]] = None
) -> Optional[Signal]:
    """
    Detect trading signal based on BASE conditions + SCORING.

    New paradigm:
    - BASE conditions (2) determine IF there's a signal
    - SCORING determines the QUALITY of the signal
    - Funding rate affects score, doesn't block

    Args:
        pair: Trading pair (e.g., 'BTC/USDT')
        indicators: Dictionary of indicator values
        funding_data: Optional funding rate data

    Returns:
        Signal object if base conditions are met, None otherwise
    """
    if indicators is None:
        return None

    entry_price = indicators.get("price", 0)
    atr = indicators.get("atr")
    timestamp = indicators.get("timestamp", datetime.utcnow().isoformat())
    fibonacci = indicators.get("fibonacci")

    # Check LONG base conditions
    if check_long_base(indicators):
        score, score_details, warnings = calculate_long_score(indicators, funding_data)
        quality = score_to_quality(score)

        tp, sl = calculate_tp_sl(entry_price, SignalType.LONG, atr=atr, fibonacci=fibonacci)

        print(f"LONG signal for {pair}: score={score:.1f}, quality={quality.value}")

        return Signal(
            pair=pair,
            signal_type=SignalType.LONG,
            entry_price=entry_price,
            take_profit=tp,
            stop_loss=sl,
            timestamp=timestamp,
            indicators=indicators,
            quality=quality,
            score=score,
            score_details=score_details,
            warnings=warnings,
            funding_info=funding_data,
            fibonacci_info=fibonacci,
        )

    # Check SHORT base conditions
    if check_short_base(indicators):
        score, score_details, warnings = calculate_short_score(indicators, funding_data)
        quality = score_to_quality(score)

        tp, sl = calculate_tp_sl(entry_price, SignalType.SHORT, atr=atr, fibonacci=fibonacci)

        print(f"SHORT signal for {pair}: score={score:.1f}, quality={quality.value}")

        return Signal(
            pair=pair,
            signal_type=SignalType.SHORT,
            entry_price=entry_price,
            take_profit=tp,
            stop_loss=sl,
            timestamp=timestamp,
            indicators=indicators,
            quality=quality,
            score=score,
            score_details=score_details,
            warnings=warnings,
            funding_info=funding_data,
            fibonacci_info=fibonacci,
        )

    return None


class SignalHistory:
    """Manages signal history and dynamic cooldowns."""

    def __init__(self):
        self.signals: List[Signal] = []
        self.last_signal_time: Dict[str, datetime] = {}
        self.last_signal_quality: Dict[str, SignalQuality] = {}

    def can_send_signal(self, pair: str, quality: SignalQuality = SignalQuality.TEMPRANA) -> bool:
        """
        Check if enough time has passed since last signal for this pair.
        Cooldown is dynamic based on the LAST signal's quality.
        """
        if pair not in self.last_signal_time:
            return True

        last_quality = self.last_signal_quality.get(pair, SignalQuality.TEMPRANA)
        cooldown = COOLDOWNS.get(last_quality, 3600)

        elapsed = (datetime.utcnow() - self.last_signal_time[pair]).total_seconds()
        return elapsed >= cooldown

    def get_cooldown_remaining(self, pair: str) -> int:
        """Get remaining cooldown time in seconds for a pair."""
        if pair not in self.last_signal_time:
            return 0

        last_quality = self.last_signal_quality.get(pair, SignalQuality.TEMPRANA)
        cooldown = COOLDOWNS.get(last_quality, 3600)

        elapsed = (datetime.utcnow() - self.last_signal_time[pair]).total_seconds()
        remaining = cooldown - elapsed
        return max(0, int(remaining))

    def add_signal(self, signal: Signal):
        """Add a signal to history."""
        self.signals.append(signal)
        key = f"{signal.pair}_{signal.timeframe}"
        self.last_signal_time[key] = datetime.utcnow()
        self.last_signal_quality[key] = signal.quality

        # Keep only last 100 signals
        if len(self.signals) > 100:
            self.signals = self.signals[-100:]

    def get_recent_signals(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get recent signals as list of dicts."""
        return [s.to_dict() for s in reversed(self.signals[-limit:])]

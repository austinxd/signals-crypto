"""
Signal detection logic for trading signals.
New paradigm: Base detection + Quality scoring + Exit signals
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
    TRAILING_STOP_ATR_MULTIPLIER,
)


class SignalType(Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class SignalQuality(Enum):
    TEMPRANA = "TEMPRANA"
    BUENA = "BUENA"
    OPTIMA = "OPTIMA"


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
) -> tuple:
    """Calculate Take Profit and Stop Loss levels."""
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
        else:
            levels_above = [l for l in sorted_levels if l > entry]
            levels_below = [l for l in sorted_levels if l < entry]
            if levels_above and levels_below:
                stop_loss = levels_above[0] * 1.005
                take_profit = levels_below[-1] if len(levels_below) == 1 else levels_below[-2]
                return take_profit, stop_loss

    if atr is not None:
        sl_distance = atr * 1.5
        tp_distance = atr * 3
    else:
        sl_distance = entry * (sl_percent / 100)
        tp_distance = entry * (tp_percent / 100)

    if signal_type == SignalType.LONG:
        take_profit = entry + tp_distance
        stop_loss = entry - sl_distance
    else:
        take_profit = entry - tp_distance
        stop_loss = entry + sl_distance

    return take_profit, stop_loss


def check_long_base(indicators: Dict[str, Any]) -> bool:
    """Check BASE conditions for LONG signal."""
    if indicators is None:
        return False
    return (
        indicators.get("price_above_ema", False) and
        indicators.get("rsi_rising", False)
    )


def check_short_base(indicators: Dict[str, Any]) -> bool:
    """Check BASE conditions for SHORT signal."""
    if indicators is None:
        return False
    return (
        not indicators.get("price_above_ema", True) and
        indicators.get("rsi_falling", False)
    )


def calculate_long_score(
    indicators: Dict[str, Any],
    funding_data: Optional[Dict[str, Any]] = None
) -> tuple:
    """Calculate quality score for LONG signal."""
    score = 0.0
    details = {}
    warnings = []

    rsi = indicators.get("rsi", 50)
    if rsi < RSI_OVERSOLD:
        score += 1.0
        details["rsi_oversold"] = 1.0
    elif rsi < 50:
        score += 0.5
        details["rsi_neutral_low"] = 0.5

    if indicators.get("macd_crossover_bullish", False):
        score += 1.0
        details["macd_crossover"] = 1.0
    elif indicators.get("macd_histogram", 0) > 0:
        score += 0.5
        details["macd_positive"] = 0.5

    if indicators.get("volume_above_average", False):
        score += 1.0
        details["volume_high"] = 1.0
    elif indicators.get("volume_ratio", 0) > 0.8:
        score += 0.3
        details["volume_decent"] = 0.3

    if funding_data:
        sentiment = funding_data.get("sentiment", "")
        if sentiment == "too_many_shorts":
            score += 0.5
            details["funding_favorable"] = 0.5
        elif sentiment == "too_many_longs":
            score -= 0.5
            details["funding_unfavorable"] = -0.5
            warnings.append("Funding alto: mercado cargado de longs")
        elif sentiment in ("slightly_short", "balanced"):
            score += 0.25
            details["funding_neutral"] = 0.25

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
) -> tuple:
    """Calculate quality score for SHORT signal."""
    score = 0.0
    details = {}
    warnings = []

    rsi = indicators.get("rsi", 50)
    if rsi > RSI_OVERBOUGHT:
        score += 1.0
        details["rsi_overbought"] = 1.0
    elif rsi > 50:
        score += 0.5
        details["rsi_neutral_high"] = 0.5

    if indicators.get("macd_crossover_bearish", False):
        score += 1.0
        details["macd_crossover"] = 1.0
    elif indicators.get("macd_histogram", 0) < 0:
        score += 0.5
        details["macd_negative"] = 0.5

    if indicators.get("volume_above_average", False):
        score += 1.0
        details["volume_high"] = 1.0
    elif indicators.get("volume_ratio", 0) > 0.8:
        score += 0.3
        details["volume_decent"] = 0.3

    if funding_data:
        sentiment = funding_data.get("sentiment", "")
        if sentiment == "too_many_longs":
            score += 0.5
            details["funding_favorable"] = 0.5
        elif sentiment == "too_many_shorts":
            score -= 0.5
            details["funding_unfavorable"] = -0.5
            warnings.append("Funding bajo: mercado cargado de shorts")
        elif sentiment in ("slightly_long", "balanced"):
            score += 0.25
            details["funding_neutral"] = 0.25

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
    """Detect trading signal based on BASE conditions + SCORING."""
    if indicators is None:
        return None

    entry_price = indicators.get("price", 0)
    atr = indicators.get("atr")
    timestamp = indicators.get("timestamp", datetime.utcnow().isoformat())
    fibonacci = indicators.get("fibonacci")

    if check_long_base(indicators):
        score, score_details, warnings = calculate_long_score(indicators, funding_data)
        quality = score_to_quality(score)
        tp, sl = calculate_tp_sl(entry_price, SignalType.LONG, atr=atr, fibonacci=fibonacci)
        print(f"LONG signal for {pair}: score={score:.1f}, quality={quality.value}")
        return Signal(
            pair=pair, signal_type=SignalType.LONG, entry_price=entry_price,
            take_profit=tp, stop_loss=sl, timestamp=timestamp, indicators=indicators,
            quality=quality, score=score, score_details=score_details, warnings=warnings,
            funding_info=funding_data, fibonacci_info=fibonacci,
        )

    if check_short_base(indicators):
        score, score_details, warnings = calculate_short_score(indicators, funding_data)
        quality = score_to_quality(score)
        tp, sl = calculate_tp_sl(entry_price, SignalType.SHORT, atr=atr, fibonacci=fibonacci)
        print(f"SHORT signal for {pair}: score={score:.1f}, quality={quality.value}")
        return Signal(
            pair=pair, signal_type=SignalType.SHORT, entry_price=entry_price,
            take_profit=tp, stop_loss=sl, timestamp=timestamp, indicators=indicators,
            quality=quality, score=score, score_details=score_details, warnings=warnings,
            funding_info=funding_data, fibonacci_info=fibonacci,
        )

    return None


# ============================================================
# Exit Signal Functions
# ============================================================

@dataclass
class ExitSignal:
    """An exit signal for a position."""
    alert_type: str  # TRAILING_BREAKEVEN, TRAILING_UPDATE, MACD_REVERSAL, RSI_EXTREME, RSI_DIVERGENCE
    message: str
    recommended_action: str  # MOVE_SL, CLOSE_50%, CLOSE_ALL
    new_sl_price: Optional[float] = None


def check_trailing_stop(
    position,
    current_price: float,
    atr: float,
) -> Optional[ExitSignal]:
    """
    Check trailing stop logic:
    1. Move SL to breakeven when price moves +1 ATR from entry
    2. Then trail SL at 1 ATR below highest/above lowest
    """
    if not atr or atr <= 0:
        return None

    multiplier = TRAILING_STOP_ATR_MULTIPLIER
    entry = position.entry_price
    side = position.side

    if side == "LONG":
        # Move to breakeven at +1 ATR
        if not position.breakeven_reached and current_price >= entry + atr * multiplier:
            return ExitSignal(
                alert_type="TRAILING_BREAKEVEN",
                message=f"Precio alcanzo +1 ATR. Mover SL a breakeven ${entry:.2f}",
                recommended_action="MOVE_SL",
                new_sl_price=entry,
            )

        # Trail SL below highest price
        if position.breakeven_reached and position.highest_price:
            new_sl = position.highest_price - atr * multiplier
            current_sl = position.current_stop_loss or entry
            if new_sl > current_sl:
                return ExitSignal(
                    alert_type="TRAILING_UPDATE",
                    message=f"Trailing stop: mover SL a ${new_sl:.2f} (high: ${position.highest_price:.2f})",
                    recommended_action="MOVE_SL",
                    new_sl_price=new_sl,
                )

    elif side == "SHORT":
        # Move to breakeven at -1 ATR
        if not position.breakeven_reached and current_price <= entry - atr * multiplier:
            return ExitSignal(
                alert_type="TRAILING_BREAKEVEN",
                message=f"Precio alcanzo -1 ATR. Mover SL a breakeven ${entry:.2f}",
                recommended_action="MOVE_SL",
                new_sl_price=entry,
            )

        # Trail SL above lowest price
        if position.breakeven_reached and position.lowest_price:
            new_sl = position.lowest_price + atr * multiplier
            current_sl = position.current_stop_loss or entry
            if new_sl < current_sl:
                return ExitSignal(
                    alert_type="TRAILING_UPDATE",
                    message=f"Trailing stop: mover SL a ${new_sl:.2f} (low: ${position.lowest_price:.2f})",
                    recommended_action="MOVE_SL",
                    new_sl_price=new_sl,
                )

    return None


def check_macd_reversal(side: str, indicators: Dict[str, Any]) -> Optional[ExitSignal]:
    """Check for MACD reversal against position direction."""
    if side == "LONG" and indicators.get("macd_crossover_bearish", False):
        return ExitSignal(
            alert_type="MACD_REVERSAL",
            message="MACD cruce bajista detectado. Considerar cerrar posicion LONG.",
            recommended_action="CLOSE_ALL",
        )
    if side == "SHORT" and indicators.get("macd_crossover_bullish", False):
        return ExitSignal(
            alert_type="MACD_REVERSAL",
            message="MACD cruce alcista detectado. Considerar cerrar posicion SHORT.",
            recommended_action="CLOSE_ALL",
        )
    return None


def check_rsi_extreme(side: str, rsi: float) -> Optional[ExitSignal]:
    """Check for RSI extreme values against position direction."""
    if side == "LONG" and rsi > 75:
        return ExitSignal(
            alert_type="RSI_EXTREME",
            message=f"RSI extremo ({rsi:.1f}). Considerar cerrar 50% de LONG.",
            recommended_action="CLOSE_50%",
        )
    if side == "SHORT" and rsi < 25:
        return ExitSignal(
            alert_type="RSI_EXTREME",
            message=f"RSI extremo ({rsi:.1f}). Considerar cerrar 50% de SHORT.",
            recommended_action="CLOSE_50%",
        )
    return None


def check_rsi_divergence(side: str, divergence: Optional[Dict[str, Any]]) -> Optional[ExitSignal]:
    """Check for RSI divergence against position direction."""
    if not divergence:
        return None

    if side == "LONG" and divergence.get("bearish_divergence"):
        return ExitSignal(
            alert_type="RSI_DIVERGENCE",
            message="Divergencia bajista RSI detectada. Considerar cerrar LONG.",
            recommended_action="CLOSE_ALL",
        )
    if side == "SHORT" and divergence.get("bullish_divergence"):
        return ExitSignal(
            alert_type="RSI_DIVERGENCE",
            message="Divergencia alcista RSI detectada. Considerar cerrar SHORT.",
            recommended_action="CLOSE_ALL",
        )
    return None


def evaluate_exit_signals(
    position,
    indicators: Dict[str, Any],
    atr: float,
    divergence: Optional[Dict[str, Any]] = None,
) -> List[ExitSignal]:
    """Evaluate all exit signals for a position."""
    signals = []
    current_price = indicators.get("price", 0)
    rsi = indicators.get("rsi", 50)

    # Trailing stop
    trailing = check_trailing_stop(position, current_price, atr)
    if trailing:
        signals.append(trailing)

    # MACD reversal
    macd = check_macd_reversal(position.side, indicators)
    if macd:
        signals.append(macd)

    # RSI extreme
    rsi_ext = check_rsi_extreme(position.side, rsi)
    if rsi_ext:
        signals.append(rsi_ext)

    # RSI divergence
    rsi_div = check_rsi_divergence(position.side, divergence)
    if rsi_div:
        signals.append(rsi_div)

    return signals


# ============================================================
# Signal History (unchanged)
# ============================================================

class SignalHistory:
    """Manages signal history and dynamic cooldowns using database."""

    def __init__(self, use_db: bool = True):
        self.use_db = use_db
        self.last_signal_time: Dict[str, datetime] = {}
        self.last_signal_quality: Dict[str, SignalQuality] = {}
        self._memory_signals: List[Signal] = []

    def can_send_signal(self, pair: str, quality: SignalQuality = SignalQuality.TEMPRANA) -> bool:
        if pair not in self.last_signal_time:
            return True
        last_quality = self.last_signal_quality.get(pair, SignalQuality.TEMPRANA)
        cooldown = COOLDOWNS.get(last_quality, 3600)
        elapsed = (datetime.utcnow() - self.last_signal_time[pair]).total_seconds()
        return elapsed >= cooldown

    def get_cooldown_remaining(self, pair: str) -> int:
        if pair not in self.last_signal_time:
            return 0
        last_quality = self.last_signal_quality.get(pair, SignalQuality.TEMPRANA)
        cooldown = COOLDOWNS.get(last_quality, 3600)
        elapsed = (datetime.utcnow() - self.last_signal_time[pair]).total_seconds()
        remaining = cooldown - elapsed
        return max(0, int(remaining))

    def add_signal(self, signal: Signal):
        key = f"{signal.pair}_{signal.timeframe}"
        self.last_signal_time[key] = datetime.utcnow()
        self.last_signal_quality[key] = signal.quality

        if self.use_db:
            try:
                from database import get_db, Signal as DBSignal, SignalQualityDB
                db = get_db()
                quality_map = {
                    SignalQuality.TEMPRANA: SignalQualityDB.TEMPRANA,
                    SignalQuality.BUENA: SignalQualityDB.BUENA,
                    SignalQuality.OPTIMA: SignalQualityDB.OPTIMA,
                }
                db_signal = DBSignal(
                    pair=signal.pair, timeframe=signal.timeframe,
                    side=signal.signal_type.value,
                    quality=quality_map.get(signal.quality, SignalQualityDB.TEMPRANA),
                    score=signal.score, score_details=signal.score_details,
                    warnings=signal.warnings, entry_price=signal.entry_price,
                    take_profit=signal.take_profit, stop_loss=signal.stop_loss,
                    indicators=signal.indicators, funding_info=signal.funding_info,
                    fibonacci_info=signal.fibonacci_info,
                )
                db.add(db_signal)
                db.commit()
                db.close()
                print(f"Signal saved to database: {signal.pair} {signal.signal_type.value}")
            except Exception as e:
                print(f"Error saving signal to database: {e}")
                self._memory_signals.append(signal)
        else:
            self._memory_signals.append(signal)
            if len(self._memory_signals) > 100:
                self._memory_signals = self._memory_signals[-100:]

    def get_recent_signals(self, limit: int = 20) -> List[Dict[str, Any]]:
        if self.use_db:
            try:
                from database import get_db, Signal as DBSignal
                db = get_db()
                db_signals = db.query(DBSignal).order_by(DBSignal.created_at.desc()).limit(limit).all()
                db.close()
                result = []
                for s in db_signals:
                    signal_dict = {
                        "pair": s.pair, "side": s.side,
                        "quality": s.quality.value if s.quality else "TEMPRANA",
                        "score": round(s.score, 1) if s.score else 0,
                        "score_details": s.score_details or {},
                        "warnings": s.warnings or [],
                        "entry": round(s.entry_price, 2) if s.entry_price else 0,
                        "takeProfit": round(s.take_profit, 2) if s.take_profit else 0,
                        "stopLoss": round(s.stop_loss, 2) if s.stop_loss else 0,
                        "timestamp": s.created_at.isoformat() if s.created_at else "",
                        "timeframe": s.timeframe or "4h",
                        "indicators": s.indicators or {},
                    }
                    if s.funding_info:
                        signal_dict["funding"] = s.funding_info
                    if s.fibonacci_info:
                        signal_dict["fibonacci"] = s.fibonacci_info
                    result.append(signal_dict)
                return result
            except Exception as e:
                print(f"Error getting signals from database: {e}")
                return [s.to_dict() for s in reversed(self._memory_signals[-limit:])]
        else:
            return [s.to_dict() for s in reversed(self._memory_signals[-limit:])]

    def load_cooldowns_from_db(self):
        if not self.use_db:
            return
        try:
            from database import get_db, Signal as DBSignal
            db = get_db()
            from sqlalchemy import func
            subq = db.query(
                DBSignal.pair, DBSignal.timeframe,
                func.max(DBSignal.created_at).label('max_created')
            ).group_by(DBSignal.pair, DBSignal.timeframe).subquery()
            latest_signals = db.query(DBSignal).join(
                subq,
                (DBSignal.pair == subq.c.pair) &
                (DBSignal.timeframe == subq.c.timeframe) &
                (DBSignal.created_at == subq.c.max_created)
            ).all()
            quality_map = {
                "TEMPRANA": SignalQuality.TEMPRANA,
                "BUENA": SignalQuality.BUENA,
                "OPTIMA": SignalQuality.OPTIMA,
            }
            for s in latest_signals:
                key = f"{s.pair}_{s.timeframe}"
                self.last_signal_time[key] = s.created_at
                quality_str = s.quality.value if s.quality else "TEMPRANA"
                self.last_signal_quality[key] = quality_map.get(quality_str, SignalQuality.TEMPRANA)
            db.close()
            print(f"Loaded cooldowns for {len(latest_signals)} pair/timeframe combinations from database")
        except Exception as e:
            print(f"Error loading cooldowns from database: {e}")

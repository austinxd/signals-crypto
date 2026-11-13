"""Risk engine and position management. Pure functions shared by the backtester and the live engine.

Nothing upstream (strategy, user approval, future AI layer) can bypass `evaluate()`.
"""
from dataclasses import dataclass
from typing import Optional

from .config import RiskConfig


@dataclass
class Verdict:
    ok: bool
    qty: float = 0.0
    reason: str = ""
    note: str = ""


def evaluate(cfg: RiskConfig, side: int, entry: float, sl: float, equity: float,
             open_positions: int, open_notional: float, day_start_equity: float,
             same_side_positions: int = 0) -> Verdict:
    """Decide whether a trade may be opened and with what size."""
    if equity <= 0:
        return Verdict(False, reason="no_equity")
    if (side > 0 and sl >= entry) or (side < 0 and sl <= entry):
        return Verdict(False, reason="stop_on_wrong_side")
    dist = abs(entry - sl)
    stop_pct = dist / entry
    if stop_pct < cfg.min_stop_pct:
        return Verdict(False, reason=f"stop_too_tight ({stop_pct:.2%})")
    if stop_pct > cfg.max_stop_pct:
        return Verdict(False, reason=f"stop_too_wide ({stop_pct:.2%})")
    if open_positions >= cfg.max_open_positions:
        return Verdict(False, reason="max_open_positions")
    if same_side_positions >= cfg.max_same_direction:
        return Verdict(False, reason="max_same_direction")  # one more would be the same bet again
    if day_start_equity > 0 and equity <= day_start_equity * (1 - cfg.daily_loss_limit):
        return Verdict(False, reason="daily_loss_limit")

    qty = equity * cfg.risk_per_trade / dist
    note = ""
    max_notional = equity * cfg.max_position_leverage
    if qty * entry > max_notional:
        qty = max_notional / entry
        note = "capped_by_position_leverage"
    room = equity * cfg.max_total_leverage - open_notional
    if qty * entry > room:
        qty = room / entry
        note = "capped_by_total_leverage"
    if qty * entry < cfg.min_notional:
        return Verdict(False, reason="below_min_notional")
    return Verdict(True, qty=qty, note=note)


def managed_stop(side: int, entry: float, sl0: float, sl: float, high_water: float, low_water: float,
                 atr: float, trail_atr: float, breakeven_r: float) -> float:
    """New stop after a closed bar. The stop only ever moves in the trade's favour.

    high_water / low_water are the best prices seen since entry (closed bars only).
    """
    new_sl = sl
    risk = abs(entry - sl0)
    if side > 0:
        if breakeven_r > 0 and high_water >= entry + breakeven_r * risk:
            new_sl = max(new_sl, entry)
        if trail_atr > 0 and atr == atr:
            new_sl = max(new_sl, high_water - trail_atr * atr)
    else:
        if breakeven_r > 0 and low_water <= entry - breakeven_r * risk:
            new_sl = min(new_sl, entry)
        if trail_atr > 0 and atr == atr:
            new_sl = min(new_sl, low_water + trail_atr * atr)
    return new_sl


def exit_fill(side: int, sl: float, tp: Optional[float], bar_open: float, bar_high: float, bar_low: float):
    """Did the stop or target trade inside this bar? Returns (price, reason) or None.

    Conservative: if both are touched in the same bar the stop is assumed to fill first,
    and a gap through the stop fills at the bar open.
    """
    has_tp = tp is not None and tp == tp
    if side > 0:
        if bar_open <= sl:
            return bar_open, "stop"
        if bar_low <= sl:
            return sl, "stop"
        if has_tp and bar_high >= tp:
            return max(tp, bar_open), "target"
    else:
        if bar_open >= sl:
            return bar_open, "stop"
        if bar_high >= sl:
            return sl, "stop"
        if has_tp and bar_low <= tp:
            return min(tp, bar_open), "target"
    return None

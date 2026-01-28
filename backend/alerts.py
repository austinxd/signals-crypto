"""
Passive criteria alerts system.

Alerts do NOT execute operations, do NOT suggest entering/exiting,
and do NOT replace trader decisions.

Their only purpose is to notify relevant changes in market or trade state.
"""
import requests
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timedelta
from enum import Enum as PyEnum

from sqlalchemy.orm import Session
from config import EXPO_PUSH_URL
from database import DBHelper, NotificationType


class AlertType(PyEnum):
    """Types of passive alerts."""
    # Context alerts (Market)
    HTF_BIAS_CHANGED = "htf_bias_changed"
    SCENARIO_CHANGED = "scenario_changed"
    VOLATILITY_CHANGED = "volatility_changed"
    PRICE_AT_KEY_ZONE = "price_at_key_zone"

    # Position alerts
    COHERENCE_CHANGED = "coherence_changed"
    THESIS_INVALIDATED = "thesis_invalidated"
    HTF_MOMENTUM_CHANGED = "htf_momentum_changed"

    # Meta alerts (discipline)
    MULTIPLE_AGAINST_CONTEXT = "multiple_against_context"
    HIGH_RISK_EXPOSURE = "high_risk_exposure"


# In-memory state cache for detecting changes
# Structure: { "pair_timeframe": { "htf_bias": "...", "scenario": "...", ... } }
_market_state_cache: Dict[str, Dict[str, Any]] = {}

# Position state cache
# Structure: { "user_id_symbol": { "coherence": "...", "invalidation_breached": False, ... } }
_position_state_cache: Dict[str, Dict[str, Any]] = {}

# Alert cooldown tracking (avoid spam)
# Structure: { "alert_key": datetime_of_last_alert }
_alert_cooldowns: Dict[str, datetime] = {}

# Cooldown duration per alert type (in minutes)
ALERT_COOLDOWNS = {
    AlertType.HTF_BIAS_CHANGED: 60,  # 1 hour minimum between bias alerts
    AlertType.SCENARIO_CHANGED: 30,  # 30 min
    AlertType.VOLATILITY_CHANGED: 60,
    AlertType.PRICE_AT_KEY_ZONE: 15,
    AlertType.COHERENCE_CHANGED: 30,
    AlertType.THESIS_INVALIDATED: 5,  # Urgent - short cooldown
    AlertType.HTF_MOMENTUM_CHANGED: 60,
    AlertType.MULTIPLE_AGAINST_CONTEXT: 120,
    AlertType.HIGH_RISK_EXPOSURE: 120,
}


def _is_on_cooldown(alert_type: AlertType, key: str) -> bool:
    """Check if an alert is still on cooldown."""
    full_key = f"{alert_type.value}:{key}"
    if full_key not in _alert_cooldowns:
        return False

    cooldown_minutes = ALERT_COOLDOWNS.get(alert_type, 30)
    last_alert = _alert_cooldowns[full_key]
    return datetime.utcnow() - last_alert < timedelta(minutes=cooldown_minutes)


def _set_cooldown(alert_type: AlertType, key: str):
    """Set cooldown for an alert."""
    full_key = f"{alert_type.value}:{key}"
    _alert_cooldowns[full_key] = datetime.utcnow()


def _alert_type_to_notification_type(alert_type: AlertType) -> NotificationType:
    """Convert AlertType to NotificationType for database storage."""
    mapping = {
        AlertType.HTF_BIAS_CHANGED: NotificationType.HTF_BIAS_CHANGED,
        AlertType.SCENARIO_CHANGED: NotificationType.SCENARIO_CHANGED,
        AlertType.VOLATILITY_CHANGED: NotificationType.VOLATILITY_CHANGED,
        AlertType.PRICE_AT_KEY_ZONE: NotificationType.PRICE_AT_KEY_ZONE,
        AlertType.COHERENCE_CHANGED: NotificationType.COHERENCE_CHANGED,
        AlertType.THESIS_INVALIDATED: NotificationType.THESIS_INVALIDATED,
        AlertType.HTF_MOMENTUM_CHANGED: NotificationType.HTF_MOMENTUM_CHANGED,
        AlertType.MULTIPLE_AGAINST_CONTEXT: NotificationType.MULTIPLE_AGAINST_CONTEXT,
        AlertType.HIGH_RISK_EXPOSURE: NotificationType.HIGH_RISK_EXPOSURE,
    }
    return mapping.get(alert_type, NotificationType.SCENARIO_CHANGED)


def _send_alert_notification(
    push_token: str,
    title: str,
    body: str,
    alert_type: AlertType,
    data: Dict[str, Any] = None,
    db: Session = None,
    user_id: int = None,
    symbol: str = None,
) -> Dict[str, Any]:
    """Send a passive alert push notification and optionally save to database."""
    # Save to database if db session and user_id are provided
    if db and user_id:
        try:
            notification_type = _alert_type_to_notification_type(alert_type)
            DBHelper.create_notification(
                db=db,
                user_id=user_id,
                notification_type=notification_type,
                title=title,
                message=body,
                symbol=symbol,
                data=data,
            )
        except Exception as e:
            print(f"Error saving notification to DB: {e}")

    # Send push notification
    if not push_token or not push_token.startswith("ExponentPushToken"):
        return {"status": "skipped", "reason": "invalid_token"}

    try:
        response = requests.post(
            EXPO_PUSH_URL,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=[{
                "to": push_token,
                "sound": "default",
                "title": title,
                "body": body,
                "data": {
                    "type": "passive_alert",
                    "alert_type": alert_type.value,
                    **(data or {})
                },
                "priority": "high",
                "channelId": "alerts",
            }],
            timeout=10,
        )
        response.raise_for_status()
        return {"status": "success"}
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": str(e)}


# =============================================================================
# CONTEXT ALERTS (Market)
# =============================================================================

def check_market_context_changes(
    pair: str,
    timeframe: str,
    current_analysis: Dict[str, Any],
    subscribed_tokens: List[Tuple[str, int]],  # List of (push_token, user_id)
    db: Session = None,
) -> List[Dict[str, Any]]:
    """
    Check for market context changes and generate alerts.

    Args:
        pair: Trading pair
        timeframe: Timeframe
        current_analysis: Current market analysis
        subscribed_tokens: List of (push_token, user_id) tuples
        db: Database session for saving notifications

    Returns list of alerts that were triggered.
    """
    if not current_analysis:
        return []

    cache_key = f"{pair}_{timeframe}"
    previous = _market_state_cache.get(cache_key, {})
    alerts_triggered = []

    pair_short = pair.replace("/USDT", "").replace(":USDT", "")

    # --- HTF Bias Changed ---
    current_bias = current_analysis.get("htf_bias")
    previous_bias = previous.get("htf_bias")

    if previous_bias and current_bias and current_bias != previous_bias:
        if not _is_on_cooldown(AlertType.HTF_BIAS_CHANGED, cache_key):
            bias_labels = {
                "alcista": "Alcista",
                "bajista": "Bajista",
                "mixto": "Mixto",
                "neutral": "Neutral"
            }
            new_label = bias_labels.get(current_bias, current_bias)
            old_label = bias_labels.get(previous_bias, previous_bias)

            title = f"{pair_short} {timeframe} - Cambio de sesgo"
            body = f"El sesgo HTF paso de {old_label} a {new_label}."

            for token, user_id in subscribed_tokens:
                _send_alert_notification(
                    token, title, body, AlertType.HTF_BIAS_CHANGED,
                    data={"pair": pair, "timeframe": timeframe, "old_bias": previous_bias, "new_bias": current_bias},
                    db=db, user_id=user_id, symbol=pair
                )

            _set_cooldown(AlertType.HTF_BIAS_CHANGED, cache_key)
            alerts_triggered.append({
                "type": AlertType.HTF_BIAS_CHANGED.value,
                "pair": pair, "timeframe": timeframe,
                "old": previous_bias, "new": current_bias
            })

    # --- Scenario Changed ---
    current_scenario = current_analysis.get("scenario")
    previous_scenario = previous.get("scenario")

    if previous_scenario and current_scenario and current_scenario != previous_scenario:
        if not _is_on_cooldown(AlertType.SCENARIO_CHANGED, cache_key):
            scenario_labels = {
                "favorable": "Favorable",
                "operable": "Operable",
                "alto_riesgo": "Alto Riesgo",
                "espera": "Espera"
            }
            new_label = scenario_labels.get(current_scenario, current_scenario)
            old_label = scenario_labels.get(previous_scenario, previous_scenario)

            # Determine if it's getting better or worse
            scenario_order = ["favorable", "operable", "espera", "alto_riesgo"]
            old_idx = scenario_order.index(previous_scenario) if previous_scenario in scenario_order else 2
            new_idx = scenario_order.index(current_scenario) if current_scenario in scenario_order else 2

            title = f"{pair_short} {timeframe} - Escenario cambio"
            body = f"El escenario paso de {old_label} a {new_label}."

            # Add context if direction preference changed
            direction = current_analysis.get("direction_preference")
            if direction and current_scenario in ["favorable", "operable"]:
                body += f" Preferencia: {direction.upper()}."

            for token, user_id in subscribed_tokens:
                _send_alert_notification(
                    token, title, body, AlertType.SCENARIO_CHANGED,
                    data={"pair": pair, "timeframe": timeframe, "old_scenario": previous_scenario, "new_scenario": current_scenario},
                    db=db, user_id=user_id, symbol=pair
                )

            _set_cooldown(AlertType.SCENARIO_CHANGED, cache_key)
            alerts_triggered.append({
                "type": AlertType.SCENARIO_CHANGED.value,
                "pair": pair, "timeframe": timeframe,
                "old": previous_scenario, "new": current_scenario
            })

    # --- Volatility Changed ---
    current_vol = current_analysis.get("volatility_state")
    previous_vol = previous.get("volatility_state")

    if previous_vol and current_vol and current_vol != previous_vol:
        # Only alert on significant changes (low->alta or alta->low)
        significant_change = (
            (previous_vol == "baja" and current_vol == "alta") or
            (previous_vol == "alta" and current_vol == "baja") or
            (previous_vol == "normal" and current_vol == "alta")
        )

        if significant_change and not _is_on_cooldown(AlertType.VOLATILITY_CHANGED, cache_key):
            title = f"{pair_short} - Volatilidad"
            if current_vol == "alta":
                body = "La volatilidad comenzo a expandirse."
            elif current_vol == "baja":
                body = "La volatilidad se comprimio significativamente."
            else:
                body = f"La volatilidad cambio a {current_vol}."

            for token, user_id in subscribed_tokens:
                _send_alert_notification(
                    token, title, body, AlertType.VOLATILITY_CHANGED,
                    data={"pair": pair, "timeframe": timeframe, "old_volatility": previous_vol, "new_volatility": current_vol},
                    db=db, user_id=user_id, symbol=pair
                )

            _set_cooldown(AlertType.VOLATILITY_CHANGED, cache_key)
            alerts_triggered.append({
                "type": AlertType.VOLATILITY_CHANGED.value,
                "pair": pair, "timeframe": timeframe,
                "old": previous_vol, "new": current_vol
            })

    # --- Price at Key Zone ---
    current_structure = current_analysis.get("htf_structure")
    previous_structure = previous.get("htf_structure")

    if current_structure == "en nivel clave" and previous_structure != "en nivel clave":
        if not _is_on_cooldown(AlertType.PRICE_AT_KEY_ZONE, cache_key):
            fibo_context = current_analysis.get("price_state", {}).get("fibo_context", "")

            title = f"{pair_short} - Zona de decision"
            body = f"El precio entro en zona clave."
            if fibo_context:
                body = f"{fibo_context}."

            for token, user_id in subscribed_tokens:
                _send_alert_notification(
                    token, title, body, AlertType.PRICE_AT_KEY_ZONE,
                    data={"pair": pair, "timeframe": timeframe, "structure": current_structure},
                    db=db, user_id=user_id, symbol=pair
                )

            _set_cooldown(AlertType.PRICE_AT_KEY_ZONE, cache_key)
            alerts_triggered.append({
                "type": AlertType.PRICE_AT_KEY_ZONE.value,
                "pair": pair, "timeframe": timeframe,
                "structure": current_structure
            })

    # Update cache
    _market_state_cache[cache_key] = {
        "htf_bias": current_bias,
        "scenario": current_scenario,
        "volatility_state": current_vol,
        "htf_structure": current_structure,
        "updated_at": datetime.utcnow().isoformat()
    }

    return alerts_triggered


# =============================================================================
# POSITION ALERTS
# =============================================================================

def check_position_state_changes(
    user_id: int,
    symbol: str,
    side: str,
    current_analysis: Dict[str, Any],
    push_token: str,
    db: Session = None,
) -> List[Dict[str, Any]]:
    """
    Check for position state changes and generate alerts.
    Only triggers if there's an actual position.

    Returns list of alerts that were triggered.
    """
    if not current_analysis or not push_token:
        return []

    cache_key = f"{user_id}_{symbol}"
    previous = _position_state_cache.get(cache_key, {})
    alerts_triggered = []

    symbol_short = symbol.replace("/USDT", "").replace(":USDT", "")

    # --- Thesis Invalidated ---
    current_invalidated = current_analysis.get("invalidation_breached", False)
    previous_invalidated = previous.get("invalidation_breached", False)

    if current_invalidated and not previous_invalidated:
        if not _is_on_cooldown(AlertType.THESIS_INVALIDATED, cache_key):
            title = f"{symbol_short} {side} - TESIS INVALIDADA"
            body = f"La estructura definida para este trade fue INVALIDADA segun las reglas establecidas."

            _send_alert_notification(
                push_token, title, body, AlertType.THESIS_INVALIDATED,
                data={"symbol": symbol, "side": side, "user_id": user_id},
                db=db, user_id=user_id, symbol=symbol
            )

            _set_cooldown(AlertType.THESIS_INVALIDATED, cache_key)
            alerts_triggered.append({
                "type": AlertType.THESIS_INVALIDATED.value,
                "symbol": symbol, "side": side
            })

    # --- Coherence Changed ---
    current_coherence = current_analysis.get("coherence")
    previous_coherence = previous.get("coherence")

    if previous_coherence and current_coherence and current_coherence != previous_coherence:
        # Only alert on significant coherence changes
        significant = (
            (previous_coherence == "a_favor" and current_coherence in ["contra", "neutral"]) or
            (previous_coherence != "contra" and current_coherence == "contra")
        )

        if significant and not _is_on_cooldown(AlertType.COHERENCE_CHANGED, cache_key):
            coherence_labels = {
                "a_favor": "A favor",
                "contra": "CONTRA contexto",
                "neutral": "Neutral"
            }
            new_label = coherence_labels.get(current_coherence, current_coherence)
            old_label = coherence_labels.get(previous_coherence, previous_coherence)

            title = f"{symbol_short} {side} - Coherencia cambio"
            body = f"Tu posicion paso de {old_label} a {new_label} segun HTF."

            _send_alert_notification(
                push_token, title, body, AlertType.COHERENCE_CHANGED,
                data={"symbol": symbol, "side": side, "old_coherence": previous_coherence, "new_coherence": current_coherence},
                db=db, user_id=user_id, symbol=symbol
            )

            _set_cooldown(AlertType.COHERENCE_CHANGED, cache_key)
            alerts_triggered.append({
                "type": AlertType.COHERENCE_CHANGED.value,
                "symbol": symbol, "side": side,
                "old": previous_coherence, "new": current_coherence
            })

    # --- HTF Momentum Changed Against Position ---
    current_htf_bias = current_analysis.get("htf_bias")
    previous_htf_bias = previous.get("htf_bias")

    if previous_htf_bias and current_htf_bias and current_htf_bias != previous_htf_bias:
        is_long = side.upper() == "LONG"
        momentum_against = (
            (is_long and current_htf_bias == "bajista" and previous_htf_bias != "bajista") or
            (not is_long and current_htf_bias == "alcista" and previous_htf_bias != "alcista")
        )

        if momentum_against and not _is_on_cooldown(AlertType.HTF_MOMENTUM_CHANGED, cache_key):
            title = f"{symbol_short} {side} - Momentum HTF"
            body = f"El sesgo HTF cambio a {'bajista' if is_long else 'alcista'}, en contra de la posicion."

            _send_alert_notification(
                push_token, title, body, AlertType.HTF_MOMENTUM_CHANGED,
                data={"symbol": symbol, "side": side, "new_bias": current_htf_bias},
                db=db, user_id=user_id, symbol=symbol
            )

            _set_cooldown(AlertType.HTF_MOMENTUM_CHANGED, cache_key)
            alerts_triggered.append({
                "type": AlertType.HTF_MOMENTUM_CHANGED.value,
                "symbol": symbol, "side": side,
                "new_bias": current_htf_bias
            })

    # Update cache
    _position_state_cache[cache_key] = {
        "coherence": current_coherence,
        "invalidation_breached": current_invalidated,
        "htf_bias": current_htf_bias,
        "updated_at": datetime.utcnow().isoformat()
    }

    return alerts_triggered


# =============================================================================
# META ALERTS (Discipline)
# =============================================================================

def check_meta_alerts(
    user_id: int,
    positions_data: List[Dict[str, Any]],
    push_token: str,
    db: Session = None,
) -> List[Dict[str, Any]]:
    """
    Check for discipline/meta alerts across all positions.

    Returns list of alerts that were triggered.
    """
    if not positions_data or not push_token:
        return []

    alerts_triggered = []
    cache_key = f"meta_{user_id}"

    # Count positions against context
    against_context_count = 0
    high_risk_count = 0

    for pos in positions_data:
        analysis = pos.get("analysis", {})
        if analysis.get("coherence") == "contra":
            against_context_count += 1
        if analysis.get("invalidation_breached"):
            high_risk_count += 1

    # --- Multiple Against Context ---
    if against_context_count >= 2:
        if not _is_on_cooldown(AlertType.MULTIPLE_AGAINST_CONTEXT, cache_key):
            title = "Exposicion contra contexto"
            body = f"Tienes {against_context_count} posiciones activas contra contexto HTF."

            _send_alert_notification(
                push_token, title, body, AlertType.MULTIPLE_AGAINST_CONTEXT,
                data={"count": against_context_count},
                db=db, user_id=user_id
            )

            _set_cooldown(AlertType.MULTIPLE_AGAINST_CONTEXT, cache_key)
            alerts_triggered.append({
                "type": AlertType.MULTIPLE_AGAINST_CONTEXT.value,
                "count": against_context_count
            })

    # --- High Risk Exposure ---
    if high_risk_count >= 2:
        if not _is_on_cooldown(AlertType.HIGH_RISK_EXPOSURE, cache_key):
            title = "Alto riesgo acumulado"
            body = f"Tienes {high_risk_count} posiciones con tesis invalidada."

            _send_alert_notification(
                push_token, title, body, AlertType.HIGH_RISK_EXPOSURE,
                data={"count": high_risk_count},
                db=db, user_id=user_id
            )

            _set_cooldown(AlertType.HIGH_RISK_EXPOSURE, cache_key)
            alerts_triggered.append({
                "type": AlertType.HIGH_RISK_EXPOSURE.value,
                "count": high_risk_count
            })

    return alerts_triggered


# =============================================================================
# STATE MANAGEMENT
# =============================================================================

def clear_position_state(user_id: int, symbol: str):
    """Clear cached state when a position is closed."""
    cache_key = f"{user_id}_{symbol}"
    if cache_key in _position_state_cache:
        del _position_state_cache[cache_key]


def get_current_states() -> Dict[str, Any]:
    """Get current state caches for debugging."""
    return {
        "market_states": _market_state_cache,
        "position_states": _position_state_cache,
        "cooldowns": {k: v.isoformat() for k, v in _alert_cooldowns.items()}
    }

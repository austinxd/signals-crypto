"""
AI Explainer Module - Contextual market explanations using Claude.

This module provides AI-generated explanations of market context.
It does NOT generate signals, predictions, or trading instructions.

Key principles:
- Explains what IS happening, not what WILL happen
- Describes conditions, not actions
- Uses cached responses based on market state
- Never contradicts existing app logic
"""

import os
import time
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone

logger = logging.getLogger("uvicorn.error")

# Try to import anthropic, but don't fail if not available
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning("Anthropic library not installed. AI explanations disabled.")

# Global cache for AI explanations
# Key: state_hash, Value: {"text": str, "timestamp": float, "state": dict}
_ai_cache: Dict[str, Dict[str, Any]] = {}

# Cache TTL in seconds
CACHE_TTL_NORMAL = 2 * 60 * 60      # 2 hours for normal volatility
CACHE_TTL_HIGH_VOL = 30 * 60        # 30 minutes for high volatility

# Reason-to-focus mapping for AI interpretation
REASON_FOCUS = {
    "momentum_extreme_against_trend": "agotamiento, rebotes fallidos, riesgo de persecucion de extension",
    "htf_ltf_conflict": "friccion entre marcos temporales, movimientos tacticos contra estructura principal",
    "scenario_downgrade": "perdida de eficiencia del contexto, entorno menos favorable que antes",
    "volatility_spike": "riesgo asimetrico, movimientos amplificados, trampas de volatilidad",
    "volume_divergence": "fragilidad estructural, absorcion, falta de confirmacion en volumen",
    "structural_friction": "tension entre estructura y momentum, zona de decision",
}

# System prompt for the AI
SYSTEM_PROMPT = """Eres un interprete de tension de mercado.

REGLA PRINCIPAL:
Solo debes interpretar el contexto DESDE el motivo de activacion (reason).
No expliques todo el contexto.
No cubras todos los estados.
Enfocate UNICAMENTE en la tension asociada al motivo.

Mapa de enfoque segun motivo:
- momentum_extreme_against_trend → agotamiento, rebotes fallidos, riesgo de persecucion
- htf_ltf_conflict → friccion, movimientos tacticos contra estructura
- scenario_downgrade → perdida de eficiencia, entorno menos favorable
- volatility_spike → riesgo asimetrico, movimientos amplificados
- volume_divergence → fragilidad estructural, absorcion
- structural_friction → tension estructura vs momentum, zona de decision

Estilo obligatorio:
- Interpreta SOLO desde el motivo dado.
- Condicional, no predictivo ("suele producir", "tiende a generar").
- Maximo 2-3 frases.
- Si el motivo no permite lectura clara, UNA frase o silencio.

Prohibiciones:
- No repitas estados.
- No expliques indicadores.
- No des recomendaciones.
- No uses numeros.

Responde solo en espanol."""


CACHE_VERSION = "v1"

# Normalization maps (Spanish → English, lowercase)
_BIAS_MAP = {
    "alcista": "bullish", "bullish": "bullish",
    "bajista": "bearish", "bearish": "bearish",
    "mixto": "mixed", "mixed": "mixed",
    "neutral": "neutral",
}
_SCENARIO_MAP = {
    "favorable": "favorable",
    "operable": "operable",
    "alto_riesgo": "high_risk", "high_risk": "high_risk",
    "espera": "wait", "wait": "wait",
}
_VOLATILITY_MAP = {
    "alta": "high", "high": "high",
    "normal": "normal",
    "baja": "low", "low": "low",
}
_DOMINANCE_MAP = {
    "buying": "buying", "compradora": "buying",
    "selling": "selling", "vendedora": "selling",
    "balanced": "balanced", "equilibrada": "balanced",
}
_MOMENTUM_STATE_MAP = {
    "strong": "strong", "fuerte": "strong",
    "weakening": "weakening", "debilitando": "weakening",
    "neutral": "neutral",
}
_RSI_STATE_MAP = {
    "extreme_overbought": "extreme_overbought",
    "overbought": "overbought", "sobrecompra": "overbought",
    "neutral": "neutral",
    "oversold": "oversold", "sobrevendido": "oversold",
    "extreme_oversold": "extreme_oversold",
}


def _normalize(value: str, mapping: Dict[str, str], default: str) -> str:
    """Normalize value using mapping, fallback to default."""
    return mapping.get(value.lower() if value else "", default)


def should_call_ai(state: Dict[str, Any]) -> Optional[str]:
    """
    Evaluate if the state has a relevant tension that warrants AI explanation.
    Returns a reason string if AI should be called, None otherwise.

    Silence = criteria. Only call AI when there's meaningful friction.
    """
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dom = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")

    # Get previous scenario if available (for downgrade detection)
    prev_scenario = state.get("prev_scenario")

    # 1. Momentum extreme against trend
    # RSI extreme + trend defined = potential exhaustion
    if htf_bias in ["bullish", "bearish"]:
        if htf_bias == "bullish" and rsi_state in ["overbought", "extreme_overbought"]:
            return "momentum_extreme_against_trend"
        if htf_bias == "bearish" and rsi_state in ["oversold", "extreme_oversold"]:
            return "momentum_extreme_against_trend"

    # 2. HTF/LTF conflict
    # Trend defined but momentum weakening significantly
    if htf_bias in ["bullish", "bearish"] and momentum_state == "weakening":
        # Check if volume contradicts trend
        if (htf_bias == "bullish" and volume_dom == "selling") or \
           (htf_bias == "bearish" and volume_dom == "buying"):
            return "htf_ltf_conflict"

    # 3. Scenario downgrade
    if prev_scenario:
        scenario_order = ["favorable", "operable", "high_risk", "wait"]
        prev_idx = scenario_order.index(prev_scenario) if prev_scenario in scenario_order else -1
        curr_idx = scenario_order.index(scenario) if scenario in scenario_order else -1
        if curr_idx > prev_idx and prev_idx >= 0:
            return "scenario_downgrade"

    # 4. Volatility spike
    if volatility == "high":
        # High volatility with extreme RSI = amplified risk
        if rsi_state in ["extreme_overbought", "extreme_oversold"]:
            return "volatility_spike"

    # 5. Volume divergence
    # Strong trend but volume not confirming
    if htf_bias in ["bullish", "bearish"] and momentum_state == "strong":
        if volume_dom == "balanced":
            return "volume_divergence"
        if (htf_bias == "bullish" and volume_dom == "selling") or \
           (htf_bias == "bearish" and volume_dom == "buying"):
            return "volume_divergence"

    # 6. Structural friction
    # Mixed bias = structure and momentum disagree
    if htf_bias == "mixed":
        return "structural_friction"

    # No relevant tension found
    return None


def _generate_cache_key(state: Dict[str, Any], reason: str) -> str:
    """
    Generate explicit cache key based on market state AND reason.

    Format: v1|{PAIR}|{REASON}|{BIAS}|{SCENARIO}|{VOL}|{DOMINANCE}|{MOMENTUM}|{RSI}
    Example: v1|BTCUSDT|momentum_extreme_against_trend|bearish|operable|high|selling|weakening|overbought

    Reason is part of the key because different reasons = different interpretations.
    """
    pair = state.get("pair", "UNKNOWN").replace("/", "").replace(":", "").upper()
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dominance = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")

    return f"{CACHE_VERSION}|{pair}|{reason}|{htf_bias}|{scenario}|{volatility}|{volume_dominance}|{momentum_state}|{rsi_state}"


def _is_cache_valid(cache_entry: Dict[str, Any], volatility: str = "normal") -> bool:
    """Check if a cache entry is still valid based on volatility."""
    if not cache_entry:
        return False
    age = time.time() - cache_entry.get("timestamp", 0)
    # Normalize volatility for TTL check
    vol_normalized = _normalize(volatility, _VOLATILITY_MAP, "normal")
    ttl = CACHE_TTL_HIGH_VOL if vol_normalized == "high" else CACHE_TTL_NORMAL
    return age < ttl


def _format_input_for_ai(state: Dict[str, Any], reason: str) -> str:
    """Format the market state as a prompt for the AI, focused on the reason."""
    pair = state.get("pair", "Unknown").replace("/USDT", "").replace(":USDT", "")

    # Normalize states
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dom = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")

    # Get focus description for this reason
    focus = REASON_FOCUS.get(reason, "tension del contexto")

    prompt = f"""Interpreta el contexto de {pair}.

MOTIVO DE ACTIVACION: {reason}
ENFOQUE: {focus}

Estados: sesgo={htf_bias}, momentum={momentum_state}, rsi={rsi_state}, volatilidad={volatility}, volumen={volume_dom}, escenario={scenario}

Interpreta SOLO desde el motivo indicado.
No describas el contexto completo.
No repitas estados visibles en la UI.
Maximo 2-3 frases."""

    return prompt


def _call_claude_api(prompt: str) -> Optional[str]:
    """Call Claude API to generate explanation."""
    if not ANTHROPIC_AVAILABLE:
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set. AI explanations disabled.")
        return None

    model = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

    try:
        client = anthropic.Anthropic(api_key=api_key)

        message = client.messages.create(
            model=model,
            max_tokens=500,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        if message.content and len(message.content) > 0:
            return message.content[0].text

        return None

    except Exception as e:
        logger.error(f"Error calling Claude API: {e}")
        return None


def get_ai_explanation(state: Dict[str, Any], reason: str, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Get AI explanation for the current market state, focused on a specific reason.

    Only call this if should_call_ai() returned a valid reason.

    Args:
        state: Market state dictionary with technical data
        reason: The activation reason (e.g., "momentum_extreme_against_trend")
        force_refresh: Force regeneration even if cache is valid

    Returns:
        Dictionary with:
        - text: The AI explanation
        - cached: Whether this was a cached response
        - cache_key: The cache key used
        - reason: The activation reason
        - generated_at: When the explanation was generated
    """
    cache_key = _generate_cache_key(state, reason)
    pair = state.get("pair", "Unknown")
    volatility = state.get("volatility", "normal")

    # Check cache first (shorter TTL for high volatility)
    vol_normalized = _normalize(volatility, _VOLATILITY_MAP, "normal")
    if not force_refresh and cache_key in _ai_cache:
        cache_entry = _ai_cache[cache_key]
        if _is_cache_valid(cache_entry, vol_normalized):
            logger.info(f"[AI] Cache hit: {cache_key}")
            return {
                "text": cache_entry["text"],
                "cached": True,
                "cache_key": cache_key,
                "reason": reason,
                "generated_at": cache_entry.get("generated_at"),
            }

    # Generate new explanation
    logger.info(f"[AI] Cache miss → IA ejecutada: {cache_key}")

    prompt = _format_input_for_ai(state, reason)
    explanation = _call_claude_api(prompt)

    if not explanation:
        # Fallback to reason-specific explanation
        explanation = _generate_fallback_explanation(state, reason)

    # Cache the result (shared across all users with same state + reason)
    generated_at = datetime.now(timezone.utc).isoformat()
    _ai_cache[cache_key] = {
        "text": explanation,
        "timestamp": time.time(),
        "reason": reason,
        "generated_at": generated_at,
    }

    # Clean old cache entries
    _cleanup_cache()

    return {
        "text": explanation,
        "cached": False,
        "cache_key": cache_key,
        "reason": reason,
        "generated_at": generated_at,
    }


def _generate_fallback_explanation(state: Dict[str, Any], reason: str) -> str:
    """Generate a reason-specific fallback explanation when API is unavailable."""

    # Reason-specific fallback messages
    fallbacks = {
        "momentum_extreme_against_trend": (
            "El momentum en zona extrema dentro de una tendencia definida suele producir "
            "rebotes cortos que no alteran la estructura principal. "
            "El riesgo de perseguir extension aumenta en este tipo de entornos."
        ),
        "htf_ltf_conflict": (
            "La friccion entre el marco principal y el timing genera movimientos tacticos "
            "que pueden confundir. Mientras la estructura mayor no ceda, "
            "los movimientos contrarios suelen ser correcciones."
        ),
        "scenario_downgrade": (
            "El contexto ha perdido eficiencia respecto a su estado anterior. "
            "Este tipo de transiciones suelen requerir pausa antes de retomar direccionalidad."
        ),
        "volatility_spike": (
            "La volatilidad elevada amplifica movimientos en ambas direcciones. "
            "Los falsos rompimientos y las trampas son mas frecuentes en este entorno."
        ),
        "volume_divergence": (
            "El volumen no confirma el movimiento estructural, lo que genera fragilidad. "
            "Este tipo de divergencias suele anticipar pausas o reversiones."
        ),
        "structural_friction": (
            "Estructura y momentum no coinciden, creando una zona de decision. "
            "El contexto suele resolverse cuando una fuerza toma control claro."
        ),
    }

    return fallbacks.get(reason, "Tension detectada en el contexto actual.")


def _cleanup_cache():
    """Remove expired cache entries (uses normal TTL for cleanup)."""
    global _ai_cache
    now = time.time()
    expired_keys = [
        key for key, entry in _ai_cache.items()
        if now - entry.get("timestamp", 0) > CACHE_TTL_NORMAL
    ]
    for key in expired_keys:
        del _ai_cache[key]

    if expired_keys:
        logger.info(f"[AI] Cleaned up {len(expired_keys)} expired cache entries")


def check_state_changed(new_state: Dict[str, Any], reason: str) -> bool:
    """
    Check if the market state has changed significantly enough to warrant
    a new AI explanation.

    Returns True if:
    - Cache key (state + reason) not found
    - Cache expired (30min for high vol, 2h for normal)
    """
    cache_key = _generate_cache_key(new_state, reason)
    volatility = new_state.get("volatility", "normal")

    # If we don't have this state+reason cached, it's new
    if cache_key not in _ai_cache:
        return True

    # If we have it cached but it's expired, regenerate
    vol_normalized = _normalize(volatility, _VOLATILITY_MAP, "normal")
    if not _is_cache_valid(_ai_cache[cache_key], vol_normalized):
        return True

    return False


def get_cache_stats() -> Dict[str, Any]:
    """Get statistics about the AI cache."""
    now = time.time()
    total = len(_ai_cache)
    # Count valid using normal TTL (conservative count)
    valid = sum(1 for entry in _ai_cache.values() if _is_cache_valid(entry, "normal"))
    expired = total - valid

    return {
        "total_entries": total,
        "valid_entries": valid,
        "expired_entries": expired,
        "cache_ttl_normal_hours": CACHE_TTL_NORMAL / 3600,
        "cache_ttl_high_vol_min": CACHE_TTL_HIGH_VOL / 60,
    }

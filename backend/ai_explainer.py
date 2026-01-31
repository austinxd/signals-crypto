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

# System prompt for the AI
SYSTEM_PROMPT = """Eres un narrador de contexto de mercado. Tu rol es traducir estados tecnicos a lenguaje humano comprensible.

REGLAS ABSOLUTAS:
1. NUNCA menciones numeros, precios, niveles, porcentajes ni valores de indicadores
2. NUNCA uses lenguaje imperativo ("compra", "vende", "entra", "sal", "espera")
3. NUNCA hagas predicciones ("va a subir", "caera", "llegara a")
4. NUNCA repitas datos tecnicos - el usuario ya los ve en la interfaz

TU UNICO ROL:
- Explicar QUE SIGNIFICA el estado actual, no que hacer
- Describir el TIPO de entorno (direccional, fragil, extendido, conflictivo)
- Identificar que FUERZAS dominan (estructura vs momentum, compradores vs vendedores)
- Mencionar RIESGOS contextuales (movimientos bruscos, agotamiento, falta de confirmacion)
- Indicar que tipo de CAMBIO invalidaria el contexto (sin mencionar precios)

TONO:
- Descriptivo y neutral
- Como un comentarista que narra lo que observa, no un asesor
- Refuerza el criterio del usuario, no lo reemplaza

FORMATO (4-6 lineas maximo):
1. Tipo de entorno actual
2. Fuerza dominante y su estado
3. Riesgo contextual principal (si existe)
4. Que cambio estructural alteraria este escenario

Responde SOLO en espanol. Sin emojis. Sin numeros."""


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


def _generate_cache_key(state: Dict[str, Any]) -> str:
    """
    Generate explicit cache key based on market state.

    Format: v1|{PAIR}|{TF}|{BIAS}|{SCENARIO}|{STRUCTURE}|{VOL}|{DOMINANCE}|{MOMENTUM}|{RSI}
    Example: v1|BTCUSDT|4H|bearish|operable|below_ema200|high|selling|weakening|overbought

    All values normalized to lowercase English enums.
    Any field change invalidates cache automatically.
    """
    pair = state.get("pair", "UNKNOWN").replace("/", "").replace(":", "").upper()
    htf_tf = state.get("htf_timeframe", "4H").upper()
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")
    structure = state.get("structure", "unknown").lower().replace(" ", "_")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dominance = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")

    return f"{CACHE_VERSION}|{pair}|{htf_tf}|{htf_bias}|{scenario}|{structure}|{volatility}|{volume_dominance}|{momentum_state}|{rsi_state}"


def _is_cache_valid(cache_entry: Dict[str, Any], volatility: str = "normal") -> bool:
    """Check if a cache entry is still valid based on volatility."""
    if not cache_entry:
        return False
    age = time.time() - cache_entry.get("timestamp", 0)
    # Normalize volatility for TTL check
    vol_normalized = _normalize(volatility, _VOLATILITY_MAP, "normal")
    ttl = CACHE_TTL_HIGH_VOL if vol_normalized == "high" else CACHE_TTL_NORMAL
    return age < ttl


def _format_input_for_ai(state: Dict[str, Any]) -> str:
    """Format the market state as a prompt for the AI (states only, no numbers)."""
    pair = state.get("pair", "Unknown").replace("/USDT", "").replace(":USDT", "")

    # Normalize states to descriptive terms
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dom = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")

    structure = state.get("structure", "unknown")
    momentum_state = state.get("momentum_state", "neutral")
    rsi_state = state.get("rsi_state", "neutral")

    # Build the prompt with STATES ONLY, no numbers
    prompt = f"""Describe el contexto actual de {pair} basandote en estos estados:

ESTADOS DEL MERCADO:
- Sesgo principal (4H): {htf_bias}
- Estructura: {structure}
- Estado del momentum: {momentum_state}
- Estado del RSI: {rsi_state}
- Volatilidad: {volatility}
- Dominancia de volumen: {volume_dom}
- Escenario clasificado: {scenario}

INSTRUCCIONES:
1. Describe el tipo de entorno actual (direccional, consolidacion, extendido, fragil, etc.)
2. Explica que fuerza domina ahora (estructura o momentum, compradores o vendedores)
3. Menciona el riesgo contextual si existe (agotamiento, confusion, falta de confirmacion)
4. Indica que tipo de cambio estructural alteraria este contexto

NO menciones numeros, precios ni niveles. El usuario ya los ve en la interfaz.
Narra el contexto como un observador neutral."""

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


def get_ai_explanation(state: Dict[str, Any], force_refresh: bool = False) -> Dict[str, Any]:
    """
    Get AI explanation for the current market state.

    Uses caching based on market state hash to avoid redundant API calls.
    Only generates new explanations when market state actually changes.

    Args:
        state: Market state dictionary with technical data
        force_refresh: Force regeneration even if cache is valid

    Returns:
        Dictionary with:
        - text: The AI explanation
        - cached: Whether this was a cached response
        - state_hash: The state hash used for caching
        - generated_at: When the explanation was generated
    """
    cache_key = _generate_cache_key(state)
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
                "generated_at": cache_entry.get("generated_at"),
            }

    # Generate new explanation
    logger.info(f"[AI] Cache miss → IA ejecutada: {cache_key}")

    prompt = _format_input_for_ai(state)
    explanation = _call_claude_api(prompt)

    if not explanation:
        # Fallback to a generic explanation based on state
        explanation = _generate_fallback_explanation(state)

    # Cache the result (shared across all users with same market state)
    generated_at = datetime.now(timezone.utc).isoformat()
    _ai_cache[cache_key] = {
        "text": explanation,
        "timestamp": time.time(),
        "volatility": volatility,
        "generated_at": generated_at,
    }

    # Clean old cache entries
    _cleanup_cache()

    return {
        "text": explanation,
        "cached": False,
        "cache_key": cache_key,
        "generated_at": generated_at,
    }


def _generate_fallback_explanation(state: Dict[str, Any]) -> str:
    """Generate a narrative explanation without AI when API is unavailable."""
    pair = state.get("pair", "Unknown").replace("/USDT", "").replace(":USDT", "")

    # Normalize all states
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dom = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    momentum_state = state.get("momentum_state", "neutral")
    rsi_state = state.get("rsi_state", "neutral")

    lines = []

    # Line 1: Type of environment
    if htf_bias == "bullish":
        lines.append(f"{pair} se encuentra en un entorno direccional alcista en el marco principal.")
    elif htf_bias == "bearish":
        lines.append(f"{pair} se encuentra en un entorno direccional bajista en el marco principal.")
    elif htf_bias == "mixed":
        lines.append(f"{pair} presenta un entorno conflictivo donde estructura y momentum no coinciden.")
    else:
        lines.append(f"{pair} se encuentra en un entorno sin direccion clara, en fase de definicion.")

    # Line 2: Dominant force
    if volume_dom == "buying":
        lines.append("La fuerza compradora domina el flujo reciente de volumen.")
    elif volume_dom == "selling":
        lines.append("La fuerza vendedora domina el flujo reciente de volumen.")
    elif momentum_state == "strong":
        lines.append("El momentum muestra fuerza sostenida en la direccion predominante.")
    elif momentum_state == "weakening":
        lines.append("El momentum muestra signos de debilitamiento respecto a la tendencia.")
    else:
        lines.append("No hay una fuerza claramente dominante en este momento.")

    # Line 3: Contextual risk
    if rsi_state in ["extreme_overbought", "extreme_oversold"]:
        lines.append("El momentum se encuentra en zona extrema, lo que refleja un entorno emocionalmente cargado con mayor riesgo de movimientos erraticos.")
    elif volatility == "high":
        lines.append("La volatilidad elevada incrementa el riesgo de movimientos bruscos e impredecibles.")
    elif scenario == "high_risk":
        lines.append("Multiples factores de riesgo confluyen en el contexto actual.")
    elif htf_bias == "mixed":
        lines.append("La falta de alineacion entre estructura y momentum genera un contexto fragil.")

    # Line 4: What would invalidate
    if htf_bias in ["bullish", "bearish"]:
        opposite = "bajista" if htf_bias == "bullish" else "alcista"
        lines.append(f"Un cambio estructural hacia sesgo {opposite} invalidaria el contexto actual.")
    else:
        lines.append("Se requiere definicion estructural clara para establecer un escenario direccional.")

    return "\n".join(lines)


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


def check_state_changed(new_state: Dict[str, Any]) -> bool:
    """
    Check if the market state has changed significantly enough to warrant
    a new AI explanation.

    Returns True if:
    - Any cache key component changed (htf_bias, scenario, structure, volatility, volume_dominance)
    - Cache expired (30min for high vol, 2h for normal)

    Cache key format: {PAIR}|{HTF_TIMEFRAME}|{HTF_BIAS}|{SCENARIO}|{STRUCTURE}|{VOLATILITY}|{VOLUME_DOMINANCE}
    """
    cache_key = _generate_cache_key(new_state)
    volatility = new_state.get("volatility", "normal")

    # If we don't have this state cached, it's a new state
    if cache_key not in _ai_cache:
        return True

    # If we have it cached but it's expired, regenerate
    if not _is_cache_valid(_ai_cache[cache_key], volatility):
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

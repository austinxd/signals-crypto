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
SYSTEM_PROMPT = """Eres un interprete de contexto de mercado. NO describes estados, INTERPRETAS lo que su combinacion significa.

PREGUNTA QUE DEBES RESPONDER IMPLICITAMENTE:
"Que suele caracterizar este tipo de entorno tecnico cuando estos estados coinciden?"

COMO DEBES RAZONAR:
- Relaciona los estados entre si, NO los listes uno por uno
- Identifica la TENSION interna del contexto (ej: sesgo fuerte + momentum debilitandose = friccion)
- Clasifica el tipo de entorno:
  * Continuacion tendencial
  * Agotamiento
  * Correccion dentro de tendencia
  * Zona fragil / inestable
  * Transicion de contexto
- Plantea escenarios condicionales:
  * Que mantiene el contexto actual
  * Que lo vuelve fragil
  * Que lo invalidaria
- Piensa en comportamientos recurrentes del mercado cuando esta combinacion aparece
- Describe la asimetria de riesgo del entorno (que tipo de movimiento suele ser mas peligroso aqui)
- Distingue entre:
  * Que mantiene el contexto
  * Que lo vuelve progresivamente mas fragil (antes de invalidarse)

ESTILO OBLIGATORIO:
- Interpretativo, NO enumerativo
- Condicional, NO predictivo ("suele derivar en...", "este tipo de contexto acostumbra a...", "mientras X se mantenga...")
- Sobrio, NO conclusivo
- Enfocate en dinamica de mercado, no en descripcion tecnica
- Maximo 5-7 lineas

PROHIBICIONES ABSOLUTAS:
- NO repitas cada input uno por uno
- NO expliques que es RSI, MACD o cualquier indicador
- NO listes estados como bullet points
- NO suenes como resumen tecnico
- NO uses numeros, precios ni porcentajes
- NO des instrucciones ni recomendaciones

REGLA FINAL:
Si no puedes interpretar la combinacion de estados, no digas nada generico.
La IA no describe datos. Interpreta contextos.

Responde SOLO en espanol. Sin emojis. Maximo 5-7 lineas."""


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
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")
    structure = state.get("structure", "unknown")

    # Build prompt that encourages INTERPRETATION, not listing
    prompt = f"""Interpreta el contexto de {pair}.

COMBINACION DE ESTADOS:
sesgo={htf_bias}, estructura={structure}, momentum={momentum_state}, rsi={rsi_state}, volatilidad={volatility}, volumen={volume_dom}, escenario={scenario}

RESPONDE EN 5-7 LINEAS:
- Que tipo de entorno dinamico representa esta combinacion y que comportamientos suele producir
- Que tension o alineacion existe entre los estados
- Donde se concentra la fragilidad o el riesgo dominante del entorno
- Que mantiene este contexto, que lo debilita, que lo invalidaria
- Usa lenguaje condicional ("suele", "acostumbra", "mientras se mantenga")

NO listes los estados. NO repitas los inputs. INTERPRETA su significado conjunto."""

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
    """Generate an interpretive explanation without AI when API is unavailable."""
    pair = state.get("pair", "Unknown").replace("/USDT", "").replace(":USDT", "")

    # Normalize all states
    htf_bias = _normalize(state.get("htf_bias", ""), _BIAS_MAP, "neutral")
    scenario = _normalize(state.get("scenario", ""), _SCENARIO_MAP, "wait")
    volatility = _normalize(state.get("volatility", ""), _VOLATILITY_MAP, "normal")
    volume_dom = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")

    # Interpret the COMBINATION of states
    is_trending = htf_bias in ["bullish", "bearish"]
    is_exhausted = rsi_state in ["extreme_overbought", "extreme_oversold"]
    is_weakening = momentum_state == "weakening"
    is_volatile = volatility == "high"
    has_tension = (is_trending and is_weakening) or (is_trending and is_exhausted)

    lines = []

    # Interpret context type based on combination
    if is_trending and not has_tension and momentum_state == "strong":
        direction = "alcista" if htf_bias == "bullish" else "bajista"
        lines.append(f"La combinacion de sesgo {direction} con momentum sostenido sugiere un entorno de continuacion tendencial.")
        lines.append("Este tipo de contexto suele favorecer la persistencia del movimiento mientras la estructura se mantenga.")
    elif is_trending and is_exhausted:
        lines.append("La combinacion de tendencia definida con momentum en zona extrema caracteriza un entorno de posible agotamiento.")
        lines.append("Este tipo de contextos suele derivar en pausas o retrocesos tecnicos, aunque la tendencia puede continuar.")
    elif is_trending and is_weakening:
        lines.append("El sesgo direccional coexiste con momentum debilitandose, lo que genera tension interna.")
        lines.append("Mientras la estructura no ceda, el contexto se mantiene, pero con mayor fragilidad ante movimientos bruscos.")
    elif htf_bias == "mixed":
        lines.append("La falta de alineacion entre estructura y momentum define un entorno de transicion o indefinicion.")
        lines.append("Este tipo de contextos suele resolverse cuando una de las fuerzas toma control claro.")
    else:
        lines.append("El contexto actual no muestra una direccion predominante clara.")
        lines.append("Suele requerirse definicion estructural antes de que emerja un escenario direccional.")

    # Add volatility context if relevant
    if is_volatile:
        lines.append("La volatilidad elevada amplifica tanto continuaciones como reversiones en este entorno.")

    # What would invalidate
    if is_trending:
        opposite = "alcista" if htf_bias == "bearish" else "bajista"
        lines.append(f"Un giro estructural hacia sesgo {opposite} alteraria completamente este escenario.")

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

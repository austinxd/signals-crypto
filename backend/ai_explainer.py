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

# Reason-to-behavior mapping for AI interpretation
REASON_FOCUS = {
    "momentum_extreme_against_trend": "rebotes breves que se agotan rapido, falsas recuperaciones que atraen entradas tardias, movimiento erratico que castiga a quienes persiguen sin confirmacion",
    "htf_ltf_conflict": "movimientos tacticos que confunden, retrocesos que parecen reversiones, barridas de stops antes de retomar direccion principal",
    "scenario_downgrade": "lateralizacion o pausas prolongadas, movimientos menos limpios, mayor frecuencia de falsos rompimientos",
    "volatility_spike": "movimientos amplificados en ambas direcciones, trampas frecuentes, barridas rapidas que sacan stops de ambos lados",
    "volume_divergence": "avances que pierden fuerza rapido, rechazos en zonas clave, absorcion silenciosa antes de giro",
    "structural_friction": "lateralizacion con barridas, movimientos erraticos sin direccion clara, resolucion explosiva cuando una fuerza toma control",
}

# System prompt for the AI
SYSTEM_PROMPT = """Eres un observador de comportamiento de mercado.

TU TAREA PRINCIPAL:
Describir patrones de comportamiento tipicos del precio y los participantes cuando esta tension aparece.
NO expliques que significa el contexto.
DESCRIBE que suele pasar en la practica.

PIENSA EN:
- Como suele moverse el precio (rebotes, compresion, barridas, continuacion)
- Que tipo de movimientos predominan (erraticos, limpios, lentos, explosivos)
- Donde suele fallar la mayoria (entradas tardias, stops muy cercanos, persecucion)
- Que tipo de reaccion es comun (rebote debil, falsa ruptura, lateralizacion, absorcion)

ESTO NO ES PREDICCION.
Es memoria de comportamiento de mercado.

ESTILO OBLIGATORIO:
- Habla de dinamicas observadas frecuentemente
- Usa: "suele", "es comun", "frecuentemente", "a menudo", "tipicamente"
- 3-5 lineas maximo (menos es mas)
- Concreto y practico, no abstracto
- SIEMPRE termina con una conclusion que conecte el comportamiento con el estado actual

FORMATO:
[Descripcion de comportamientos tipicos - 2-4 lineas]
[Conclusion que conecte con el estado actual - 1 linea]

La conclusion DEBE indicar donde esta el contexto ahora respecto al comportamiento descrito:
- "...y actualmente no hay confirmacion estructural"
- "...y por ahora el volumen no acompana"
- "...mientras la estructura no ceda, esto sigue vigente"
- "...y el momentum aun no muestra agotamiento"

PROHIBICIONES:
- No uses numeros ni precios
- No digas "podria subir / bajar"
- No recomiendes acciones
- No repitas los estados tecnicos
- No expliques indicadores

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
_MOMENTUM_MAP = {
    "alcista": "bullish", "bullish": "bullish",
    "bajista": "bearish", "bearish": "bearish",
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

    # Get behavioral focus for this reason
    behaviors = REASON_FOCUS.get(reason, "comportamiento tipico del precio")

    prompt = f"""Describe que suele pasar con el precio en {pair} cuando aparece esta tension.

TENSION DETECTADA: {reason}
COMPORTAMIENTOS TIPICOS: {behaviors}

ESTADO ACTUAL: sesgo={htf_bias}, momentum={momentum_state}, rsi={rsi_state}, volatilidad={volatility}, volumen={volume_dom}

Describe como suele moverse el precio y donde suelen fallar los participantes.
Termina conectando el comportamiento con el estado actual (ej: "...y actualmente no hay confirmacion", "...mientras el volumen no confirme", "...y por ahora la estructura se mantiene").
3-5 lineas maximo."""

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
    """Generate a reason-specific behavioral fallback when API is unavailable."""

    # Get current state for contextual conclusion
    momentum_state = _normalize(state.get("momentum_state", ""), _MOMENTUM_STATE_MAP, "neutral")
    volume_dom = _normalize(state.get("volume_dominance", ""), _DOMINANCE_MAP, "balanced")
    rsi_state = _normalize(state.get("rsi_state", ""), _RSI_STATE_MAP, "neutral")

    # Reason-specific behavioral patterns
    behaviors = {
        "momentum_extreme_against_trend": (
            "Cuando el momentum entra en zona extrema dentro de una tendencia definida, "
            "el precio suele mostrar rebotes breves y poco eficientes que se agotan rapido. "
            "Es comun ver falsas recuperaciones que atraen entradas tardias antes de que "
            "la presion dominante retome el control."
        ),
        "htf_ltf_conflict": (
            "Cuando el timing se mueve contra la estructura principal, es frecuente ver "
            "retrocesos que parecen reversiones pero terminan siendo barridas de stops. "
            "Los participantes tardios suelen quedar atrapados antes de que el precio "
            "retome la direccion del marco mayor."
        ),
        "scenario_downgrade": (
            "Cuando el contexto pierde eficiencia, el precio suele entrar en fases de "
            "lateralizacion o pausas prolongadas. Los movimientos se vuelven menos limpios "
            "y los falsos rompimientos mas frecuentes."
        ),
        "volatility_spike": (
            "Con volatilidad elevada, los movimientos se amplifican en ambas direcciones. "
            "Es frecuente ver barridas rapidas que sacan stops de compradores y vendedores "
            "en poco tiempo. Las trampas son comunes."
        ),
        "volume_divergence": (
            "Cuando el volumen no acompana el movimiento, los avances suelen perder fuerza "
            "rapidamente. Es comun ver rechazos en zonas clave donde se esperaba continuacion."
        ),
        "structural_friction": (
            "Cuando estructura y momentum no coinciden, el precio suele lateralizar con "
            "barridas en ambas direcciones. Los movimientos son erraticos y sin direccion clara."
        ),
    }

    # State-aware conclusions
    conclusions = {
        "momentum_extreme_against_trend": {
            "strong": "Actualmente el momentum sigue fuerte, aun no hay senal de agotamiento.",
            "weakening": "El momentum ya muestra debilidad, posible inicio de correccion.",
            "neutral": "Por ahora no hay confirmacion de cambio estructural.",
        },
        "htf_ltf_conflict": {
            "buying": "El volumen comprador aun no confirma el giro.",
            "selling": "El volumen vendedor aun no confirma el giro.",
            "balanced": "Mientras la estructura mayor no ceda, los retrocesos siguen siendo tacticos.",
        },
        "scenario_downgrade": {
            "default": "Por ahora el contexto sigue deteriorado, se requiere paciencia.",
        },
        "volatility_spike": {
            "default": "Mientras la volatilidad se mantenga elevada, el riesgo de trampas persiste.",
        },
        "volume_divergence": {
            "buying": "El volumen comprador no acompana, la subida carece de conviccion.",
            "selling": "El volumen vendedor no acompana, la caida carece de conviccion.",
            "balanced": "Sin volumen que confirme, el movimiento sigue siendo fragil.",
        },
        "structural_friction": {
            "default": "Mientras no haya resolucion, el precio seguira erratico.",
        },
    }

    behavior = behaviors.get(reason, "Tension detectada en el contexto.")

    # Get appropriate conclusion based on reason and state
    reason_conclusions = conclusions.get(reason, {"default": "El contexto sigue en tension."})
    if reason in ["momentum_extreme_against_trend"]:
        conclusion = reason_conclusions.get(momentum_state, reason_conclusions.get("neutral", ""))
    elif reason in ["htf_ltf_conflict", "volume_divergence"]:
        conclusion = reason_conclusions.get(volume_dom, reason_conclusions.get("balanced", ""))
    else:
        conclusion = reason_conclusions.get("default", "")

    return f"{behavior}\n{conclusion}"


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


# ============================================================
# POSITION AI ANALYSIS - Per user, per position
# ============================================================

# Separate cache for position analysis (per user)
_position_ai_cache: Dict[str, Dict[str, Any]] = {}
POSITION_CACHE_TTL = 15 * 60  # 15 minutes for position analysis

POSITION_SYSTEM_PROMPT = """Eres un asistente de gestion de posiciones de trading.

CONTEXTO:
El usuario tiene una posicion abierta. Tienes acceso a:
- Datos de la posicion (lado, entrada, PnL actual, leverage, liquidacion)
- Contexto de mercado (sesgo HTF, estructura, momentum LTF)
- Indicadores tecnicos (RSI, MACD, volumen)

TU TAREA:
Analizar la posicion en funcion del contexto actual y dar:
1. Una RECOMENDACION clara y accionable (1-2 lineas)
2. El MEJOR ESCENARIO realista (que pasaria si el mercado favorece)
3. El PEOR ESCENARIO realista (que pasaria si el mercado va en contra)

ESTILO:
- Directo y practico, sin rodeos
- Basado en datos, no en predicciones
- Reconoce cuando la posicion esta bien o mal posicionada
- Si hay riesgo alto, dilo claramente
- Si la posicion esta a favor del contexto, confirma

FORMATO OBLIGATORIO:
**Recomendacion:** [accion sugerida basada en el estado actual]

**Mejor escenario:** [que pasa si continua a favor - ser realista]

**Peor escenario:** [que pasa si va en contra - incluir niveles criticos]

PROHIBICIONES:
- No des precios exactos de entrada/salida
- No prometas resultados
- No uses lenguaje emocional o alarmista innecesario
- No repitas datos que el usuario ya ve en pantalla

Responde solo en espanol."""


def _generate_position_cache_key(user_id: int, position: Dict[str, Any], market_state: Dict[str, Any]) -> str:
    """
    Generate cache key for position analysis.
    Includes user_id to make it per-user.
    """
    symbol = position.get("symbol", "").replace("/", "").replace(":", "")
    side = position.get("side", "").upper()

    # PnL bucket (to invalidate cache when PnL changes significantly)
    pnl_pct = position.get("pnl_percent", 0)
    if pnl_pct < -10:
        pnl_bucket = "loss_big"
    elif pnl_pct < -3:
        pnl_bucket = "loss_med"
    elif pnl_pct < 0:
        pnl_bucket = "loss_small"
    elif pnl_pct < 3:
        pnl_bucket = "gain_small"
    elif pnl_pct < 10:
        pnl_bucket = "gain_med"
    else:
        pnl_bucket = "gain_big"

    # Market state components
    htf_bias = _normalize(market_state.get("htf_bias", "neutral"), _BIAS_MAP, "neutral")
    coherence = market_state.get("coherence", "neutral")
    momentum = _normalize(market_state.get("ltf_momentum", "neutral"), _MOMENTUM_MAP, "neutral")

    return f"pos|u{user_id}|{symbol}|{side}|{pnl_bucket}|{htf_bias}|{coherence}|{momentum}"


def _format_position_prompt(position: Dict[str, Any], market_state: Dict[str, Any]) -> str:
    """Format the position data for the AI prompt."""
    symbol = position.get("symbol", "?")
    side = position.get("side", "?").upper()
    entry = position.get("entry_price", 0)
    current = position.get("current_price", 0)
    pnl = position.get("unrealized_pnl", 0)
    pnl_pct = position.get("pnl_percent", 0)
    leverage = position.get("leverage", 1)
    liq_price = position.get("liquidation_price")
    liq_distance = position.get("liq_distance_pct")

    # Market context
    htf_bias = market_state.get("htf_bias", "neutral")
    htf_structure = market_state.get("htf_structure", "?")
    ltf_momentum = market_state.get("ltf_momentum", "neutral")
    coherence = market_state.get("coherence", "neutral")
    coherence_text = market_state.get("coherence_text", "")
    rsi = market_state.get("rsi")
    volatility = market_state.get("volatility", "normal")

    prompt = f"""POSICION ACTUAL:
- Par: {symbol}
- Lado: {side}
- Entrada: ${entry:.2f} → Actual: ${current:.2f}
- PnL: ${pnl:.2f} ({pnl_pct:+.2f}%)
- Leverage: {leverage}x
"""

    if liq_price and liq_distance:
        prompt += f"- Liquidacion: ${liq_price:.2f} (a {liq_distance:.1f}% de distancia)\n"

    prompt += f"""
CONTEXTO DE MERCADO:
- Sesgo HTF (4H): {htf_bias}
- Estructura: {htf_structure}
- Momentum LTF (15m): {ltf_momentum}
- Coherencia posicion vs mercado: {coherence}
- {coherence_text}
- Volatilidad: {volatility}
"""

    if rsi:
        prompt += f"- RSI: {rsi:.0f}\n"

    # Position alignment
    is_aligned = (side == "LONG" and htf_bias == "alcista") or (side == "SHORT" and htf_bias == "bajista")
    prompt += f"\nALINEACION: La posicion {'ESTA' if is_aligned else 'NO esta'} alineada con el sesgo HTF.\n"

    prompt += "\nAnaliza esta posicion y dame recomendacion + mejor/peor escenario:"

    return prompt


def get_position_ai_analysis(
    user_id: int,
    position: Dict[str, Any],
    market_state: Dict[str, Any],
    force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Get AI analysis for a specific position.

    Args:
        user_id: User ID (for per-user caching)
        position: Position data dict
        market_state: Current market analysis for the symbol
        force_refresh: Skip cache if True

    Returns:
        Dictionary with:
        - recommendation: Main recommendation
        - best_scenario: Best case scenario
        - worst_scenario: Worst case scenario
        - cached: Whether this was cached
        - generated_at: Timestamp
    """
    cache_key = _generate_position_cache_key(user_id, position, market_state)

    # Check cache
    if not force_refresh and cache_key in _position_ai_cache:
        entry = _position_ai_cache[cache_key]
        age = time.time() - entry.get("timestamp", 0)
        if age < POSITION_CACHE_TTL:
            logger.info(f"[AI-POS] Cache hit: {cache_key}")
            return {
                "recommendation": entry["recommendation"],
                "best_scenario": entry["best_scenario"],
                "worst_scenario": entry["worst_scenario"],
                "cached": True,
                "generated_at": entry.get("generated_at"),
            }

    # Generate new analysis
    logger.info(f"[AI-POS] Generating analysis: {cache_key}")

    if not ANTHROPIC_AVAILABLE:
        return _generate_position_fallback(position, market_state)

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return _generate_position_fallback(position, market_state)

        client = anthropic.Anthropic(api_key=api_key)
        prompt = _format_position_prompt(position, market_state)

        model = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

        response = client.messages.create(
            model=model,
            max_tokens=500,
            system=POSITION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text.strip()

        # Parse the response
        recommendation = ""
        best_scenario = ""
        worst_scenario = ""

        lines = text.split("\n")
        current_section = None

        for line in lines:
            line_lower = line.lower().strip()
            if "recomendacion" in line_lower or "recomendación" in line_lower:
                current_section = "rec"
                # Extract content after the colon if on same line
                if ":" in line:
                    recommendation = line.split(":", 1)[1].strip().lstrip("*").strip()
            elif "mejor escenario" in line_lower:
                current_section = "best"
                if ":" in line:
                    best_scenario = line.split(":", 1)[1].strip().lstrip("*").strip()
            elif "peor escenario" in line_lower:
                current_section = "worst"
                if ":" in line:
                    worst_scenario = line.split(":", 1)[1].strip().lstrip("*").strip()
            elif line.strip() and current_section:
                # Continuation of current section
                clean_line = line.strip().lstrip("*- ").strip()
                if current_section == "rec" and not recommendation:
                    recommendation = clean_line
                elif current_section == "best" and not best_scenario:
                    best_scenario = clean_line
                elif current_section == "worst" and not worst_scenario:
                    worst_scenario = clean_line

        # Fallback if parsing failed
        if not recommendation:
            recommendation = "Monitorear la posicion de cerca"
        if not best_scenario:
            best_scenario = "El precio continua a favor de la posicion"
        if not worst_scenario:
            worst_scenario = "El precio revierte y activa stop loss"

        generated_at = datetime.now(timezone.utc).isoformat()

        # Cache result
        _position_ai_cache[cache_key] = {
            "recommendation": recommendation,
            "best_scenario": best_scenario,
            "worst_scenario": worst_scenario,
            "timestamp": time.time(),
            "generated_at": generated_at,
        }

        # Cleanup old entries
        _cleanup_position_cache()

        return {
            "recommendation": recommendation,
            "best_scenario": best_scenario,
            "worst_scenario": worst_scenario,
            "cached": False,
            "generated_at": generated_at,
        }

    except Exception as e:
        logger.error(f"[AI-POS] Error calling API: {e}")
        return _generate_position_fallback(position, market_state)


def _generate_position_fallback(position: Dict[str, Any], market_state: Dict[str, Any]) -> Dict[str, Any]:
    """Generate fallback analysis when API is unavailable."""
    side = position.get("side", "").upper()
    pnl_pct = position.get("pnl_percent", 0)
    htf_bias = market_state.get("htf_bias", "neutral")
    coherence = market_state.get("coherence", "neutral")

    is_aligned = (side == "LONG" and htf_bias == "alcista") or (side == "SHORT" and htf_bias == "bajista")

    if pnl_pct > 5 and is_aligned:
        recommendation = "Posicion en ganancia y alineada - considera asegurar parciales"
        best = "Continuacion de tendencia HTF con expansion de ganancias"
        worst = "Retroceso que borra ganancias - ajustar SL a breakeven"
    elif pnl_pct > 0 and is_aligned:
        recommendation = "Posicion alineada con contexto - mantener con SL definido"
        best = "Impulso a favor que lleva a target"
        worst = "Perdida de momentum que invalida la entrada"
    elif pnl_pct < -5:
        recommendation = "Posicion en perdida significativa - evaluar si la tesis sigue valida"
        best = "Recuperacion que permite salir en breakeven"
        worst = "Continuacion en contra hacia liquidacion"
    elif not is_aligned:
        recommendation = "Posicion contra el sesgo HTF - gestionar riesgo de cerca"
        best = "Cambio de sesgo que valida la posicion"
        worst = "Continuacion de tendencia HTF en contra"
    else:
        recommendation = "Monitorear evolucion del precio respecto a niveles clave"
        best = "Resolucion a favor de la posicion"
        worst = "Invalidacion de la tesis de entrada"

    return {
        "recommendation": recommendation,
        "best_scenario": best,
        "worst_scenario": worst,
        "cached": False,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _cleanup_position_cache():
    """Remove expired position cache entries."""
    now = time.time()
    expired = [k for k, v in _position_ai_cache.items() if now - v.get("timestamp", 0) > POSITION_CACHE_TTL]
    for k in expired:
        del _position_ai_cache[k]
    if expired:
        logger.info(f"[AI-POS] Cleaned {len(expired)} expired entries")

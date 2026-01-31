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
import hashlib
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

# Cache TTL in seconds (2 hours default)
CACHE_TTL = 2 * 60 * 60

# System prompt for the AI
SYSTEM_PROMPT = """Eres un analista tecnico que explica el contexto actual del mercado de criptomonedas.

REGLAS ESTRICTAS:
1. NUNCA uses palabras como: "compra", "vende", "entra", "cierra", "senal", "entrada", "salida"
2. NUNCA hagas predicciones ("ira a", "va a subir", "caera")
3. NUNCA des instrucciones de trading o gestion de riesgo
4. NUNCA contradigas los datos tecnicos proporcionados

TU ROL:
- Explicar el estado ACTUAL del mercado usando los datos proporcionados
- Describir escenarios CONDICIONALES ("si el precio se mantiene sobre X...", "mientras permanezca bajo Y...")
- Ayudar a entender conceptos tecnicos (momentum, sesgo, volatilidad)
- Ser neutral y descriptivo

FORMATO DE RESPUESTA (maximo 6-8 lineas):
1. Estado actual del mercado (1-2 lineas)
2. Factor dominante ahora (estructura, momentum, o volumen)
3. Escenario principal (condicional)
4. Escenario alternativo (condicional)
5. Advertencia si el contexto es mixto o fragil

Responde SOLO en espanol. Se conciso y claro."""


def _generate_state_hash(state: Dict[str, Any]) -> str:
    """Generate a hash based on the market state for caching."""
    key_parts = [
        state.get("pair", ""),
        state.get("htf_bias", ""),
        state.get("scenario", ""),
        state.get("structure", ""),
        state.get("volatility", ""),
        state.get("momentum", {}).get("macd", ""),
    ]
    key_string = "|".join(str(p) for p in key_parts)
    return hashlib.md5(key_string.encode()).hexdigest()


def _is_cache_valid(cache_entry: Dict[str, Any]) -> bool:
    """Check if a cache entry is still valid."""
    if not cache_entry:
        return False
    age = time.time() - cache_entry.get("timestamp", 0)
    return age < CACHE_TTL


def _format_input_for_ai(state: Dict[str, Any]) -> str:
    """Format the market state as a prompt for the AI."""
    pair = state.get("pair", "Unknown")
    price = state.get("price", 0)
    htf_bias = state.get("htf_bias", "neutral")
    structure = state.get("structure", "unknown")
    scenario = state.get("scenario", "wait")
    momentum = state.get("momentum", {})
    volatility = state.get("volatility", "normal")
    key_levels = state.get("key_levels", {})
    volume = state.get("volume_executed", {})

    # Build the prompt
    prompt = f"""Analiza el contexto actual de {pair}:

DATOS TECNICOS:
- Precio actual: ${price:,.2f}
- Sesgo HTF (4H): {htf_bias}
- Estructura: {structure}
- Escenario clasificado: {scenario}
- RSI: {momentum.get('rsi', 'N/A')}
- MACD: {momentum.get('macd', 'N/A')}
- Volatilidad: {volatility}
- Soportes relevantes: {key_levels.get('support', [])}
- Resistencias relevantes: {key_levels.get('resistance', [])}
- Delta de volumen: {volume.get('delta', 'N/A')}
- Dominancia: {volume.get('dominance', 'balanced')}

Explica el contexto actual del mercado basandote UNICAMENTE en estos datos.
Recuerda: describe lo que ESTA pasando, no lo que VA a pasar."""

    return prompt


def _call_claude_api(prompt: str) -> Optional[str]:
    """Call Claude API to generate explanation."""
    if not ANTHROPIC_AVAILABLE:
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set. AI explanations disabled.")
        return None

    try:
        client = anthropic.Anthropic(api_key=api_key)

        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",  # Using Sonnet 3.5 for better reasoning
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
    state_hash = _generate_state_hash(state)
    pair = state.get("pair", "Unknown")

    # Check cache first
    cache_key = f"{pair}_{state_hash}"
    if not force_refresh and cache_key in _ai_cache:
        cache_entry = _ai_cache[cache_key]
        if _is_cache_valid(cache_entry):
            logger.info(f"[AI] Cache hit for {pair} (hash: {state_hash[:8]})")
            return {
                "text": cache_entry["text"],
                "cached": True,
                "state_hash": state_hash,
                "generated_at": cache_entry.get("generated_at"),
            }

    # Generate new explanation
    logger.info(f"[AI] Generating new explanation for {pair} (hash: {state_hash[:8]})")

    prompt = _format_input_for_ai(state)
    explanation = _call_claude_api(prompt)

    if not explanation:
        # Fallback to a generic explanation based on state
        explanation = _generate_fallback_explanation(state)

    # Cache the result
    generated_at = datetime.now(timezone.utc).isoformat()
    _ai_cache[cache_key] = {
        "text": explanation,
        "timestamp": time.time(),
        "state": state,
        "generated_at": generated_at,
    }

    # Clean old cache entries
    _cleanup_cache()

    return {
        "text": explanation,
        "cached": False,
        "state_hash": state_hash,
        "generated_at": generated_at,
    }


def _generate_fallback_explanation(state: Dict[str, Any]) -> str:
    """Generate a basic explanation without AI when API is unavailable."""
    pair = state.get("pair", "Unknown")
    htf_bias = state.get("htf_bias", "neutral")
    scenario = state.get("scenario", "espera")
    structure = state.get("structure", "unknown")
    volatility = state.get("volatility", "normal")
    momentum = state.get("momentum", {})
    rsi = momentum.get("rsi")
    macd = momentum.get("macd", "neutral")

    lines = []

    # Line 1-2: Current state
    if htf_bias == "alcista":
        lines.append(f"{pair} mantiene sesgo alcista en 4H con precio sobre la EMA200.")
    elif htf_bias == "bajista":
        lines.append(f"{pair} mantiene sesgo bajista en 4H con precio bajo la EMA200.")
    elif htf_bias == "mixto":
        lines.append(f"{pair} presenta sesgo mixto en 4H con estructura y momentum en conflicto.")
    else:
        lines.append(f"{pair} no muestra sesgo direccional claro en 4H.")

    # Line 3: Dominant factor
    if volatility == "alta":
        lines.append("La volatilidad elevada domina el contexto actual.")
    elif macd in ["bullish", "alcista"]:
        lines.append("El momentum alcista es el factor dominante actual.")
    elif macd in ["bearish", "bajista"]:
        lines.append("El momentum bajista es el factor dominante actual.")
    else:
        lines.append("No hay un factor claramente dominante en este momento.")

    # Line 4-5: Conditional scenarios
    if htf_bias in ["alcista", "bajista"]:
        direction = "alcista" if htf_bias == "alcista" else "bajista"
        opposite = "bajista" if htf_bias == "alcista" else "alcista"
        lines.append(f"Mientras se mantenga el sesgo {direction}, el contexto favorece continuacion.")
        lines.append(f"Un cambio de sesgo a {opposite} invalidaria el escenario actual.")
    else:
        lines.append("Sin sesgo claro, el mercado podria moverse en cualquier direccion.")
        lines.append("Se requiere definicion estructural para establecer un escenario.")

    # Line 6: Warning if needed
    if scenario == "alto_riesgo":
        lines.append("Precaucion: multiples factores de riesgo presentes.")
    elif volatility == "alta":
        lines.append("La volatilidad elevada aumenta el riesgo de movimientos bruscos.")
    elif htf_bias == "mixto":
        lines.append("Contexto fragil: estructura y momentum no coinciden.")

    return "\n".join(lines)


def _cleanup_cache():
    """Remove expired cache entries."""
    global _ai_cache
    now = time.time()
    expired_keys = [
        key for key, entry in _ai_cache.items()
        if now - entry.get("timestamp", 0) > CACHE_TTL
    ]
    for key in expired_keys:
        del _ai_cache[key]

    if expired_keys:
        logger.info(f"[AI] Cleaned up {len(expired_keys)} expired cache entries")


def check_state_changed(pair: str, new_state: Dict[str, Any]) -> bool:
    """
    Check if the market state has changed significantly enough to warrant
    a new AI explanation.

    Returns True if:
    - HTF bias changed
    - Scenario changed
    - Structure changed
    - Volatility state changed significantly
    """
    new_hash = _generate_state_hash(new_state)
    cache_key = f"{pair}_{new_hash}"

    # If we don't have this state cached, it's a new state
    if cache_key not in _ai_cache:
        return True

    # If we have it cached but it's expired, regenerate
    if not _is_cache_valid(_ai_cache[cache_key]):
        return True

    return False


def get_cache_stats() -> Dict[str, Any]:
    """Get statistics about the AI cache."""
    now = time.time()
    total = len(_ai_cache)
    valid = sum(1 for entry in _ai_cache.values() if _is_cache_valid(entry))
    expired = total - valid

    return {
        "total_entries": total,
        "valid_entries": valid,
        "expired_entries": expired,
        "cache_ttl_hours": CACHE_TTL / 3600,
    }

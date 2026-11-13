// Turns the analysis the server sends (full of trading terms) into sentences anyone can read.
import { colors } from './theme';

const MOVE = { alcista: 'subiendo', bajista: 'bajando' };

/**
 * explain(analysis) -> {
 *   headline: what to do, in a few words ("Buen momento para vender")
 *   color:    how good the moment is (green good, yellow so-so, red risky, grey wait) — never the direction
 *   action:   one sentence on what that means in practice
 *   reasons:  short sentences on what the price is doing and why that verdict
 * }
 */
export function explain(analysis) {
  const scenario = analysis?.scenario || 'espera';
  const dir = analysis?.direction_preference; // long | short | undefined
  const trend = analysis?.context?.htf_bias || 'neutral';
  const now = analysis?.timing?.ltf_momentum || 'neutral';
  const confirmed = !!analysis?.timing?.has_confirmation;
  const rsi = analysis?.timing?.rsi_zone;
  const volatile = analysis?.context?.volatility_state === 'alta';

  const reasons = [];
  if (MOVE[trend]) reasons.push(`En las últimas horas el precio viene ${MOVE[trend]}.`);
  else if (trend === 'mixto') reasons.push('La tendencia no está clara: unas señales apuntan arriba y otras abajo.');
  else reasons.push('El precio se mueve de lado, sin una tendencia clara.');

  if (MOVE[trend]) {
    if (confirmed) reasons.push(`En los últimos minutos sigue ${MOVE[trend]}: el movimiento se mantiene.`);
    else if (MOVE[now] && now !== trend) reasons.push(`Pero en los últimos minutos está ${MOVE[now]}, al revés que la tendencia. Conviene esperar a que vuelva a ir ${trend === 'alcista' ? 'hacia arriba' : 'hacia abajo'}.`);
    else reasons.push('En los últimos minutos está quieto: falta que el movimiento arranque.');
  } else if (MOVE[now]) {
    reasons.push(`En los últimos minutos está ${MOVE[now]}, pero sin una tendencia detrás que lo respalde.`);
  }

  if (rsi === 'sobrecompra') reasons.push('Ha subido muy rápido en poco tiempo; es fácil que frene o retroceda.');
  if (rsi === 'sobrevendido') reasons.push('Ha caído muy rápido en poco tiempo; es fácil que rebote.');
  if (volatile) reasons.push('El precio se está moviendo con brusquedad: más riesgo de lo normal.');

  const verb = dir === 'long' ? 'comprar' : 'vender';
  const means = dir === 'long'
    ? 'Comprar (long) gana si el precio sube.'
    : 'Vender (short) gana si el precio baja.';

  if (scenario === 'alto_riesgo') {
    return {
      headline: 'Riesgo alto: mejor no entrar', color: colors.danger, reasons,
      action: 'Las señales se contradicen o el mercado está demasiado movido. Lo prudente es quedarse fuera.',
    };
  }
  if ((scenario === 'favorable' || scenario === 'operable') && dir) {
    const good = scenario === 'favorable';
    return {
      headline: good ? `Buen momento para ${verb}` : `Se puede ${verb}, con cuidado`,
      color: good ? colors.accent : colors.warn,
      reasons,
      action: good
        ? `La tendencia y el momento coinciden. ${means}`
        : `Hay condiciones, pero no todas a favor: si entras, que sea con poco tamaño. ${means}`,
    };
  }
  if (scenario === 'favorable' || scenario === 'operable') {
    // There is a trend, but the price already ran too far to join it now.
    return {
      headline: 'Espera un mejor precio', color: colors.textMuted, reasons,
      action: `Hay tendencia, pero el precio ya ${trend === 'bajista' ? 'cayó' : 'subió'} demasiado rápido para entrar ahora.`,
    };
  }
  return {
    headline: 'Mejor esperar', color: colors.textMuted, reasons,
    action: 'Ahora mismo no hay una ventaja clara ni para comprar ni para vender.',
  };
}

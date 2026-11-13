// Turns the analysis the server sends (full of trading terms) into sentences anyone can read.
// Rule: every verdict names the action — long (bet it rises) or short (bet it falls) — so nobody has to guess.
// "Comprar/vender" are avoided on purpose: people read them as buying or selling the coins they own.
import { colors, fmtPrice } from './theme';

const SIDE = {
  long: {
    tag: 'long', open: 'abrir long', dont: 'No abras long', mark: '↑ LONG · apostar a que sube', color: colors.accent,
    going: 'subiendo', goes: 'sube', way: 'de subida',
    means: 'Long: una apuesta en futuros a que el precio sube. Ganas si sube, pierdes si baja. No es comprar la moneda.',
  },
  short: {
    tag: 'short', open: 'abrir short', dont: 'No abras short', mark: '↓ SHORT · apostar a que baja', color: colors.danger,
    going: 'bajando', goes: 'baja', way: 'de bajada',
    means: 'Short: una apuesta en futuros a que el precio baja. Ganas si baja, pierdes si sube. No es vender monedas que tengas.',
  },
};
const OF_TREND = { alcista: 'long', bajista: 'short' };
const WAIT_MARK = '— ESPERAR';

/**
 * explain(analysis) -> {
 *   side:     'long' | 'short' | null   the direction the idea points to, even when the advice is to wait
 *   act:      true when the analysis says it can be done now
 *   mark:     "↑ COMPRAR (long)" | "↓ VENDER (short)" | "— ESPERAR"   and markColor
 *   headline: the verdict in a few words; color = how good the moment is (never the direction)
 *   action:   what to do, in one or two sentences
 *   means:    what comprar/vender means, for whoever does not know (null when there is no direction)
 *   reasons:  why, in short sentences
 * }
 */
export function explain(analysis) {
  const scenario = analysis?.scenario || 'espera';
  const trend = analysis?.context?.htf_bias || 'neutral';
  const now = analysis?.timing?.ltf_momentum || 'neutral';
  const confirmed = !!analysis?.timing?.has_confirmation;
  const rsi = analysis?.timing?.rsi_zone;
  const volatile = analysis?.context?.volatility_state === 'alta';
  const idea = SIDE[analysis?.direction_preference] || SIDE[OF_TREND[trend]] || null; // where the trend points
  const stretched = !analysis?.direction_preference && !!idea && (scenario === 'favorable' || scenario === 'operable');

  const reasons = [];
  if (idea) {
    reasons.push(`El precio lleva días ${idea.going}, y lo normal es que siga: por eso la idea es ${idea.open}.`);
    if (confirmed) reasons.push(`En los últimos minutos también está ${idea.going}: acompaña a la idea de ${idea.open}.`);
    else if (now !== 'neutral' && OF_TREND[now] !== idea.tag) reasons.push(`Pero en los últimos minutos está ${SIDE[OF_TREND[now]].going}, al revés. Hay que esperar a que vuelva a ir ${idea.way}.`);
    else reasons.push(`En los últimos minutos está quieto: falta que empiece a moverse ${idea.way}.`);
  } else if (trend === 'mixto') {
    reasons.push('La tendencia no está clara: unas señales apuntan a subir y otras a bajar.');
  } else {
    reasons.push('Todavía no hay datos suficientes para ver hacia dónde va el precio.');
  }
  if (rsi === 'sobrecompra') reasons.push('Ha subido muy rápido en poco tiempo: es fácil que frene o retroceda. Mal momento para abrir long.');
  if (rsi === 'sobrevendido') reasons.push('Ha caído muy rápido en poco tiempo: es fácil que rebote. Mal momento para abrir short.');
  if (volatile) reasons.push('El precio se mueve con brusquedad: más riesgo de lo normal.');

  const wait = (headline, action, color = colors.textMuted) => ({
    side: idea ? idea.tag : null, act: false, mark: WAIT_MARK, markColor: colors.textDim,
    headline, color, action, means: idea ? idea.means : null, reasons,
  });

  if (scenario === 'alto_riesgo') {
    return wait('Riesgo alto: ni long ni short ahora',
      'Las señales se contradicen o el precio está demasiado movido. Lo prudente es no abrir ninguna operación.',
      colors.danger);
  }
  if (!idea || (scenario !== 'favorable' && scenario !== 'operable')) {
    return wait('Mejor esperar: ni long ni short', 'Ahora mismo no hay ventaja clara en ninguna de las dos direcciones.');
  }
  if (stretched) {
    return wait(`${idea.dont} todavía: ${idea.tag === 'long' ? 'subió' : 'cayó'} demasiado rápido`,
      `La idea sigue siendo ${idea.open}, pero no ahora: espera a que el precio ${idea.tag === 'long' ? 'baje un poco y vuelva a subir' : 'suba un poco y vuelva a bajar'}.`);
  }
  if (!confirmed) {
    return wait(`${idea.dont} todavía: espera`,
      `La tendencia es ${idea.way}, así que la idea es ${idea.open}. Pero ahora mismo el precio no ${idea.goes}: hazlo solo cuando vuelva a moverse ${idea.way}. Te avisaremos.`,
      colors.warn);
  }
  const good = scenario === 'favorable';
  return {
    side: idea.tag, act: true, mark: idea.mark, markColor: idea.color,
    headline: good ? `Buen momento para ${idea.open}` : `Se puede ${idea.open}, con cuidado`,
    color: good ? colors.accent : colors.warn,
    action: good
      ? `La tendencia y los últimos minutos apuntan a lo mismo: el precio ${idea.goes}.`
      : `Hay condiciones para ${idea.open}, pero no todas a favor. Si lo haces, usa la mitad del dinero que usarías normalmente.`,
    means: idea.means,
    reasons,
  };
}

/**
 * A concrete plan for the verdict above, from the price and the 4-hour ATR (the usual size of a move).
 * Same stop distance the bot uses (2.5 ATR). Returns null when there is nothing to do now or data is missing.
 */
export function tradePlan(view, price, atr) {
  if (!view?.act || !view.side || !(price > 0) || !(atr > 0)) return null;
  const up = view.side === 'long';
  const stop = up ? price - 2.5 * atr : price + 2.5 * atr;
  const pct = (Math.abs(stop - price) / price) * 100;
  if (stop <= 0 || pct > 25) return null;
  return {
    title: `Si decides abrir ${up ? 'long' : 'short'}`,
    rows: [
      { label: 'Abrir cerca de', value: fmtPrice(price) },
      {
        label: 'Cierre automático de pérdidas (stop) si', value: `${up ? 'baja' : 'sube'} a ${fmtPrice(stop)}`,
        help: `Está a un ${pct.toFixed(1).replace('.', ',')} % del precio. Pon esa orden de stop al abrir: es lo que limita la pérdida.`,
      },
      {
        label: 'Cuánto arriesgar', value: 'Máx. 1 % de tu dinero',
        help: 'Elige el tamaño para que, si salta el stop, no pierdas más del 1 % de tu cuenta.',
      },
    ],
    where: 'Dónde: en Binance Futuros, o pídeselo al bot en la pestaña Bot (“Abrir una operación a mano”), que calcula el tamaño y pone el stop por ti.',
  };
}

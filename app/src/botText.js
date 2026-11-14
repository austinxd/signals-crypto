// The bot writes its journal in short English codes ("stale_signal", "ai_veto: …", "kill_switch: …").
// This file is the only place where those codes become sentences. No code may reach the screen raw:
// what is not recognised comes back as { text: generic sentence, detail: the raw text } and the screen
// shows the detail in small print as "Detalle técnico".
import { pairName } from './theme';

// ---- numbers, Spanish style: 10.000,00 ----

export const es = (x, d = 2) => {
  if (x == null || Number.isNaN(Number(x))) return '-';
  const [int, dec] = Math.abs(Number(x)).toFixed(d).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${Number(x) < 0 ? '-' : ''}${grouped}${dec ? `,${dec}` : ''}`;
};
export const esSigned = (x, d = 2) =>
  x == null || Number.isNaN(Number(x)) ? '-' : `${Number(x) >= 0 ? '+' : ''}${es(x, d)}`;
export const usdt = (x, d = 2) => `${es(x, d)} USDT`;
/** A price with its currency: $64.000 · $1.931,56 · $0,5123 */
export const money = (x) => {
  if (x == null || Number.isNaN(Number(x))) return '-';
  const n = Number(x);
  return `$${es(n, n >= 1000 ? 0 : n >= 1 ? 2 : 4)}`;
};

// ---- who is reading and what money the bot moves. The screen sets this on every render. ----

let own = false; // true when the reader is the one who controls the bot: sentences then say "tú"
let unit = 'USDT'; // 'USDT simulados' | 'USDT de prueba' | 'USDT'
export const setReader = (canControl, moneyUnit) => {
  own = !!canControl;
  unit = moneyUnit || 'USDT';
};
const who = (you, owner) => (own ? you : owner);

const pct = (s) => String(s).replace('.', ',').replace('%', ' %');

// ---- one vocabulary for the two directions ----

export const SIDE = {
  1: {
    noun: 'Long', arrow: '↑', wins: 'gana si el precio sube', bet: 'apostar a que sube',
    against: 'baja', stopMove: 'Subió',
  },
  '-1': {
    noun: 'Short', arrow: '↓', wins: 'gana si el precio baja', bet: 'apostar a que baja',
    against: 'sube', stopMove: 'Bajó',
  },
};
export const sideOf = (s) => SIDE[s > 0 ? 1 : -1];

/** What the stop means in money: a loss while it is behind the entry, a locked gain once it is past it. */
export function stopOutcome(side, qty, entry, sl) {
  if ([qty, entry, sl].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  const result = (side > 0 ? 1 : -1) * qty * (sl - entry);
  return result >= 0
    ? `aseguraría unos ${esSigned(result, 2)} ${unit}`
    : `perdería unos ${es(Math.abs(result), 2)} ${unit}`;
}

// ---- A. decision reasons ----

const STANCE_WORD = { normal: 'postura normal', caution: 'postura de cautela', no_trade: 'postura de no operar' };
const AI_WOULD = { full: 'abierto la operación completa', half: 'abierto la operación a la mitad', skip: 'dejado pasar la operación' };
const AI_DID = {
  full: 'La IA dio el visto bueno.',
  half: 'La IA redujo la operación a la mitad.',
  skip: 'La IA frenó esta operación.',
};

/** Risk-engine codes, with the limits read from the bot's own configuration. */
function riskSentence(code, risk = {}) {
  const c = String(code || '').trim();
  const m = c.match(/\(([^)]+)\)/);
  if (c.startsWith('max_open_positions')) {
    return `Ya tiene el máximo de operaciones abiertas a la vez${risk.max_open_positions ? ` (${risk.max_open_positions})` : ''}.`;
  }
  if (c.startsWith('max_same_direction')) return 'Ya tiene demasiadas operaciones en la misma dirección.';
  if (c.startsWith('daily_loss_limit')) {
    return `Hoy ya perdió el máximo permitido${risk.daily_loss_limit ? ` (${es(risk.daily_loss_limit * 100, 0)} % del capital)` : ''}: no abre más hasta mañana.`;
  }
  if (c.startsWith('stop_too_tight')) {
    return `El cierre automático de pérdidas quedaría demasiado cerca del precio${m ? ` (${pct(m[1])})` : ''}: saltaría con cualquier movimiento.`;
  }
  if (c.startsWith('stop_too_wide')) {
    return `El cierre automático de pérdidas quedaría demasiado lejos${m ? ` (${pct(m[1])})` : ''}: arriesgaría de más.`;
  }
  if (c.startsWith('stop_on_wrong_side')) return 'El precio ya pasó el nivel de cierre automático: no tiene sentido abrir.';
  if (c.startsWith('below_min_notional')) {
    return `La operación saldría más pequeña que el mínimo${risk.min_notional ? ` (${es(risk.min_notional, 0)} USDT)` : ''}.`;
  }
  if (c.startsWith('no_equity')) return 'No queda capital.';
  return null;
}

/** "ai half, stance caution: <reason written by the model, already in Spanish>" */
function aiNote(note, shadowMult) {
  const m = String(note).match(/^ai (full|half|skip), stance (\w+)(?::\s*([\s\S]*))?$/);
  if (!m) {
    if (String(note).startsWith('ai_unavailable')) return { text: 'La IA no respondió; el bot siguió con sus reglas.' };
    return null;
  }
  const [, action, stance, why] = m;
  const text = shadowMult != null
    ? `La IA habría ${AI_WOULD[action] || 'opinado'} (${STANCE_WORD[stance] || 'sin postura'}), pero solo opina: no cambió nada.`
    : `${AI_DID[action] || 'La IA opinó.'}`;
  return { text, opinion: why ? why.trim() : null };
}

function onePart(part, risk) {
  const p = part.trim();
  if (!p) return null;
  if (p === 'signal') return { text: 'Se cumplieron las reglas de su estrategia.' };
  if (p === 'manual_by_user') return { text: who('La pediste tú a mano.', 'La pidió a mano el dueño del bot.') };
  if (p === 'approved_by_user') return { text: who('Aprobaste la propuesta.', 'El dueño del bot aprobó la propuesta.') };
  if (p === 'awaiting_approval') return { text: who('Espera tu respuesta: apruébala o recházala.', 'Espera a que el dueño del bot la apruebe o la rechace.') };
  if (p === 'capped_by_position_leverage') {
    return { text: `Entró con menos cantidad: una sola operación no puede superar ${risk.max_position_leverage ? es(risk.max_position_leverage, 0) : 'varias'} veces el capital.` };
  }
  if (p === 'capped_by_total_leverage') {
    return { text: `Entró con menos cantidad: entre todas las operaciones no puede superar ${risk.max_total_leverage ? es(risk.max_total_leverage, 0) : 'varias'} veces el capital.` };
  }
  const shadow = p.match(/^\[shadow x([\d.]+)\]\s*([\s\S]*)$/);
  if (shadow) return aiNote(shadow[2], Number(shadow[1])) || { text: 'La IA opinó, pero no cambió nada.', detail: p };
  if (p.startsWith('ai_veto:')) {
    const inner = aiNote(p.slice(8).trim());
    return { text: 'La IA frenó esta operación: no se abrió.', opinion: inner ? inner.opinion : null };
  }
  if (p.startsWith('ai_reduced_below_min_notional')) {
    const inner = aiNote(p.split(':').slice(1).join(':').trim());
    return {
      text: `La IA la redujo tanto que quedó por debajo del mínimo${risk.min_notional ? ` (${es(risk.min_notional, 0)} USDT)` : ''}: no se abrió.`,
      opinion: inner ? inner.opinion : null,
    };
  }
  if (p.startsWith('ai ') || p.startsWith('ai_unavailable')) return aiNote(p);
  const stale = p.match(/^stale_signal \((\d+) min/);
  if (stale) return { text: `La señal llegó ${stale[1]} minutos tarde (el bot estuvo sin conexión) y ya no era fiable: la dejó pasar.` };
  if (p.startsWith('stale_signal')) return { text: 'La señal llegó tarde y ya no era fiable: la dejó pasar.' };
  if (p.startsWith('paused')) return { text: 'El bot estaba en pausa: no abrió.' };
  if (p.startsWith('on_approval:')) {
    const r = riskSentence(p.slice(12), risk);
    return { text: `Al aprobarla ya no cumplía los límites. ${r || ''}`.trim(), detail: r ? null : p };
  }
  if (p.startsWith('manual:')) {
    const r = riskSentence(p.slice(7), risk);
    return { text: `No se abrió la operación pedida a mano. ${r || ''}`.trim(), detail: r ? null : p };
  }
  if (p.startsWith('order_failed')) return { text: 'La orden falló al enviarla. No se abrió nada.', detail: p };
  const r = riskSentence(p, risk);
  if (r) return { text: r };
  return { text: 'Motivo no reconocido.', detail: p };
}

const EXIT_WHY = {
  target: 'llegó al precio de ganancia previsto',
  time: 'llevaba demasiado tiempo abierta',
};
/** Why a trade closed. A stop that closes in profit is the trailing stop doing its job, so say so. */
export function exitWhy(reason, pnl) {
  if (reason === 'stop') {
    return pnl != null && pnl > 0
      ? 'el precio se dio la vuelta y se cerró sola asegurando ganancia'
      : 'el precio fue en contra y se cerró sola para limitar la pérdida';
  }
  if (reason === 'manual') return who('la cerraste tú a mano', 'la cerró a mano el dueño del bot');
  return EXIT_WHY[reason] || 'cierre automático';
}

export const ACTION = {
  ENTER: 'Abrió', EXIT: 'Cerró', SKIP: 'No abrió', REJECT: 'No abrió: lo impiden sus límites',
  PROPOSE: 'Propuso', MOVE_SL: 'Ajustó el cierre automático', ERROR: 'Fallo',
};

/**
 * decisionText(decision, risk) -> { text, opinion, detail }
 *   text     the reason in plain Spanish
 *   opinion  what the AI wrote (already Spanish), if any
 *   detail   raw text that could not be translated, if any
 */
export function decisionText(d, risk = {}) {
  const data = (d && d.data) || {};
  const reason = String((d && d.reason) || '');
  if (d && d.action === 'EXIT') {
    const why = exitWhy(reason, data.pnl);
    const result = data.pnl != null ? ` Resultado: ${esSigned(data.pnl)} ${unit}.` : '';
    return { text: `Motivo: ${why}.${result}` };
  }
  if (d && d.action === 'MOVE_SL') {
    const s = sideOf(d.side);
    return {
      text: data.from != null && data.to != null
        ? `${s.stopMove} el cierre automático de pérdidas de ${money(data.from)} a ${money(data.to)} para proteger la ganancia.`
        : 'Movió el cierre automático de pérdidas para proteger la ganancia.',
    };
  }
  const parts = reason.split('; ').map((p) => onePart(p, risk || {})).filter(Boolean);
  if (parts.length === 0) return { text: '' };
  const extra = [];
  if (d && d.action === 'ENTER' && data.entry != null && data.sl != null) {
    extra.push(`Entró a ${money(data.entry)}; se cierra sola si ${sideOf(d.side).against} a ${money(data.sl)}.`);
  }
  return {
    text: [...parts.map((p) => p.text), ...extra].filter(Boolean).join(' '),
    opinion: parts.map((p) => p.opinion).filter(Boolean).join(' ') || null,
    detail: parts.map((p) => p.detail).filter(Boolean).join(' · ') || null,
  };
}

// ---- pause reason ----

export function pauseText(reason) {
  const r = String(reason || '').trim();
  const k = r.match(/^kill_switch: drawdown ([\d.]+%) from peak \(limit ([\d.]+%)\)/);
  if (k) {
    return {
      text: `Se pausó solo por seguridad: el capital cayó un ${pct(k[1])} desde su mejor momento (el límite es ${pct(k[2])}). No abrirá operaciones nuevas hasta que ${who('pulses «Reanudar»', 'su dueño lo reanude')}.`,
    };
  }
  if (r.startsWith('kill_switch')) return { text: 'Se pausó solo por seguridad, porque el capital bajó demasiado.', detail: r };
  const by = who('Lo pausaste tú.', 'Lo pausó su dueño.');
  if (!r || r === 'manual' || r === 'desde la app') return { text: by };
  return { text: by, detail: r };
}

// ---- B. system events ----

const AI_MODE_EVENT = {
  off: 'IA apagada.', shadow: 'La IA solo opina.', reduce: 'La IA puede reducir o frenar operaciones.',
};
const STANCE_NAME = { normal: 'normal', caution: 'cautela', no_trade: 'no operar' };

export function eventText(e) {
  const kind = String((e && e.kind) || '');
  const msg = String((e && e.message) || '');
  const coin = () => pairName((msg.match(/^([A-Z0-9]+)[: ]/) || [])[1] || '') || 'una moneda';
  switch (kind) {
    case 'start': return { text: 'El bot se encendió.' };
    case 'stop': return { text: 'El bot se apagó desde el servidor.' };
    case 'resume': return { text: 'El bot se reanudó.' };
    case 'pause': {
      const p = pauseText(msg);
      return { text: `El bot se puso en pausa. ${p.text}`, detail: p.detail };
    }
    case 'mode':
      if (msg.endsWith('auto')) return { text: 'Ahora el bot decide solo.' };
      if (msg.endsWith('manual')) return { text: 'Ahora el bot pregunta antes de abrir.' };
      break;
    case 'ai': {
      const set = msg.match(/^ai set to (\w+)/);
      if (set && AI_MODE_EVENT[set[1]]) return { text: AI_MODE_EVENT[set[1]] };
      const st = msg.match(/^stance (\w+) -> (\w+):\s*([\s\S]*)$/);
      if (st) {
        return { text: `La IA cambió su postura de «${STANCE_NAME[st[1]] || st[1]}» a «${STANCE_NAME[st[2]] || st[2]}».`, opinion: st[3] };
      }
      if (msg.includes('review skipped')) {
        if (msg.includes('budget')) return { text: 'La IA no revisó: se agotó el presupuesto diario.' };
        if (msg.includes('API key') || msg.includes('api key')) return { text: 'La IA no está configurada en el servidor.' };
        return { text: 'La IA no revisó esta vez.', detail: msg };
      }
      if (msg.includes('gave no answer') || msg.includes('signal review')) {
        return { text: 'La IA no respondió; el bot siguió con sus reglas.' };
      }
      if (msg.startsWith('AI skipped more than')) return { text: 'La IA frenaba demasiadas operaciones: por seguridad ahora solo opina.' };
      if (msg.startsWith('wake-up limit')) return { text: 'La IA ya hizo el máximo de revisiones extra de hoy.' };
      return { text: 'Error interno de la IA; el bot siguió con sus reglas.', detail: msg };
    }
    case 'data': return { text: `Faltan datos de precio de ${coin()}; no pudo evaluarla.` };
    case 'order': return { text: `Falló una orden en ${coin()}. No se abrió nada.`, detail: msg };
    case 'tp_failed': return { text: `No se pudo poner el precio de ganancia en ${coin()}; el cierre automático de pérdidas sí está activo.` };
    case 'cancel_failed': return { text: 'No se pudo cancelar una orden antigua.', detail: msg };
    default: break;
  }
  return { text: 'Error interno del bot.', detail: msg };
}

// ---- C. command results ----

/** commandText(row from report.recent_commands, risk) -> { ok, text, detail } */
export function commandText(c, risk = {}) {
  const result = String((c && c.result) || '');
  if (c && c.status === 'failed') return { ok: false, text: 'Error interno; no se hizo nada.', detail: result };
  if (result === 'executed') return { ok: true, text: 'Hecho: operación abierta.' };
  if (result === 'rejected') return { ok: true, text: 'Propuesta rechazada.' };
  if (result.startsWith('closed')) return { ok: true, text: 'Operación cerrada.' };
  if (result.startsWith('no matching open position')) return { ok: false, text: 'Ya no había ninguna operación abierta en esa moneda.' };
  if (result.startsWith('proposal not pending')) return { ok: false, text: 'La propuesta ya había caducado o ya estaba respondida.' };
  if (result.startsWith('bot is paused')) return { ok: false, text: 'El bot está en pausa: reanúdalo y vuelve a intentarlo.' };
  if (result.startsWith('position already open')) return { ok: false, text: 'Ya hay una operación abierta en esa moneda.' };
  if (result.startsWith('price already reached the target')) return { ok: false, text: 'El precio ya llegó a donde iba la operación: se descartó.' };
  if (result.startsWith('risk engine rejected it:')) {
    const r = riskSentence(result.slice(24), risk || {});
    return { ok: false, text: `No se abrió. ${r || 'No cumple los límites de riesgo del bot.'}`, detail: r ? null : result };
  }
  if (result.startsWith('not enough candles')) return { ok: false, text: 'Faltan datos de precio para calcular el cierre automático de pérdidas.' };
  if (result.startsWith('order failed')) return { ok: false, text: 'La orden falló. No se abrió nada.' };
  if (result.includes('is not one of the bot')) return { ok: false, text: 'El bot no opera esa moneda.' };
  return { ok: false, text: 'El bot respondió algo que no reconozco.', detail: result };
}

/** Errors of an AI model call: never show the raw exception. */
export const aiErrorText = () => 'No respondió.';

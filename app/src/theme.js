// One palette, one scale. Every screen takes its colours, spacing and labels from here.

export const colors = {
  bg: '#0b0d12',
  surface: '#151821',
  surfaceAlt: '#1c2030',
  border: '#262b3b',
  text: '#f2f4f8',
  textDim: '#a3abbd',
  textMuted: '#6d7588',
  accent: '#19d3a2', // up, long, good, primary action
  danger: '#ff5b6b', // down, short, risk
  warn: '#f5b83d',
  info: '#5b9dff',
  onAccent: '#06110e', // text on top of a solid accent/warn/danger fill
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  bodyDim: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  small: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  number: { color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
};

/** Translucent version of a #rrggbb colour, for tinted backgrounds. */
export const tint = (hex, alpha = 0.14) =>
  hex + Math.round(alpha * 255).toString(16).padStart(2, '0');

// ---- What the analysis words mean, said plainly. Used by the market list and the pair detail. ----

export const SCENARIO = {
  favorable: { label: 'Buen momento', color: colors.accent, help: 'La tendencia y el momento de entrada coinciden.' },
  operable: { label: 'Se puede operar', color: colors.warn, help: 'Hay condiciones, pero no todas a favor. Tamaño prudente.' },
  alto_riesgo: { label: 'Riesgo alto', color: colors.danger, help: 'Las señales se contradicen o el mercado está muy movido.' },
  espera: { label: 'Mejor esperar', color: colors.textMuted, help: 'Ahora mismo no hay una ventaja clara.' },
};
export const scenarioOf = (key) => SCENARIO[key] || SCENARIO.espera;

export const TREND = {
  alcista: { label: 'Alcista', arrow: '↑', color: colors.accent },
  bajista: { label: 'Bajista', arrow: '↓', color: colors.danger },
  mixto: { label: 'Mixta', arrow: '↔', color: colors.warn },
  neutral: { label: 'Lateral', arrow: '→', color: colors.textMuted },
};
export const trendOf = (key) => TREND[key] || TREND.neutral;

export const DIRECTION = {
  long: { label: 'Comprar (long)', short: 'LONG', arrow: '↑', color: colors.accent },
  short: { label: 'Vender (short)', short: 'SHORT', arrow: '↓', color: colors.danger },
};

/** Short explanations shown under a technical term, so nobody needs to know the jargon. */
export const GLOSSARY = {
  context: 'La tendencia de fondo, medida en velas de 4 horas.',
  timing: 'El momento de entrada, medido en velas de 15 minutos.',
  structure: 'Cómo se están formando los máximos y mínimos del precio.',
  volatility: 'Cuánto se mueve el precio. Alta = movimientos bruscos.',
  momentum: 'La fuerza del movimiento ahora mismo.',
  rsi: 'De 0 a 100. Por encima de 70 el precio viene muy subido; por debajo de 30, muy caído.',
  confirmation: 'Si el movimiento corto ya acompaña a la tendencia de fondo.',
  funding: 'Lo que pagan los long a los short (o al revés) cada 8 h. Muy positivo = demasiada gente comprada.',
  levels: 'Precios donde antes hubo mucha compra o venta. Suelen frenar o rebotar el precio.',
  volume: 'Cuánto se negocia frente a lo normal. Más de 1,5x = movimiento con respaldo.',
  leverage: 'Cuántas veces se multiplica tu dinero en la posición. Multiplica ganancias y pérdidas.',
  liquidation: 'Precio al que el exchange cierra tu posición y pierdes el margen.',
  stop: 'Precio al que la posición se cierra sola para limitar la pérdida.',
  r: 'Resultado medido en “riesgos”: +1R es ganar lo que arriesgabas; -1R es perderlo.',
  drawdown: 'Cuánto ha bajado el capital desde su máximo.',
};

// ---- Formatting ----

export const pairName = (pair) =>
  (pair || '').replace('/USDT', '').replace(':USDT', '').replace(/USDT$/, '');

export const fmtPrice = (p) => {
  if (p == null || Number.isNaN(Number(p))) return '-';
  const n = Number(p);
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 10) return `$${n.toFixed(3)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

export const fmtNum = (x, d = 2) => (x == null || Number.isNaN(Number(x)) ? '-' : Number(x).toFixed(d));
export const fmtSigned = (x, d = 2) =>
  x == null || Number.isNaN(Number(x)) ? '-' : `${Number(x) >= 0 ? '+' : ''}${Number(x).toFixed(d)}`;
export const pnlColor = (x) => (x == null || Number(x) === 0 ? colors.textDim : Number(x) > 0 ? colors.accent : colors.danger);

/** "hace 5 min" from a Date, an ISO string, or a unix timestamp in seconds. */
export const timeAgo = (when) => {
  if (when == null || when === '') return '';
  const ms = typeof when === 'number' ? (when < 1e12 ? when * 1000 : when) : new Date(when).getTime();
  if (Number.isNaN(ms)) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'ahora';
  if (s < 5400) return `hace ${Math.round(s / 60)} min`;
  if (s < 172800) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};

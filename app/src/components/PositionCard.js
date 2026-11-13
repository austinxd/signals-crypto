import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getPositionAlerts, getPositionAIAnalysis } from '../services/api';
import { useSubscription } from '../context/SubscriptionContext';
import { Card, Chip, Row, Notice, Segment } from './ui';
import {
  colors, space, radius, type, tint,
  GLOSSARY, trendOf, pairName, fmtPrice, pnlColor, timeAgo,
} from '../theme';

// Everything is phrased from the side of the person holding the position.
const SIDE = {
  long: { name: 'compra (long)', Name: 'Compra (long)', wins: 'ganas si el precio sube', needs: 'sube', against: 'baja', color: colors.accent },
  short: { name: 'venta (short)', Name: 'Venta (short)', wins: 'ganas si el precio baja', needs: 'baja', against: 'sube', color: colors.danger },
};

const RISK_TONE = { low: 'good', medium: 'warn', high: 'danger' };

const SENTIMENT = {
  bullish: { label: 'Mercado alcista', arrow: '↑', color: colors.accent },
  bearish: { label: 'Mercado bajista', arrow: '↓', color: colors.danger },
  neutral: { label: 'Mercado lateral', arrow: '→', color: colors.textMuted },
};

const STRUCTURE = {
  consolidacion: 'Sin dirección, moviéndose de lado',
  indecision: 'Sin dirección clara',
  tendencia: 'Avanzando con la tendencia',
  retroceso: 'Corrigiendo dentro de la tendencia',
  extension: 'Muy alejado de su media',
  'en nivel clave': 'En un precio importante',
  en_nivel_clave: 'En un precio importante',
  sin_datos: 'Sin datos',
  error: 'Sin datos',
};

// Plain titles for the alert types the server sends.
const ALERT_TITLES = {
  htf_bias_changed: 'La tendencia de fondo cambió',
  htf_momentum_changed: 'La tendencia giró en contra de tu posición',
  scenario_changed: 'Cambió la situación del mercado',
  volatility_changed: 'El precio se mueve con más brusquedad',
  price_at_key_zone: 'El precio llegó a un nivel importante',
  coherence_changed: 'El mercado ya no acompaña a tu posición',
  thesis_invalidated: 'El motivo de tu posición ya no vale',
  multiple_against_context: 'Varias posiciones van contra la tendencia',
  high_risk_exposure: 'Varias posiciones perdieron su motivo',
  favorable_conditions: 'Condiciones a favor',
  trailing_breakeven: 'Conviene subir el cierre automático al precio de entrada',
  trailing_update: 'Conviene mover el cierre automático',
  macd_reversal: 'Posible giro en contra',
  rsi_extreme: 'El precio se movió muy rápido',
};
const ALERT_TONE = {
  thesis_invalidated: 'danger', multiple_against_context: 'danger', high_risk_exposure: 'danger',
  coherence_changed: 'warn', htf_bias_changed: 'warn', htf_momentum_changed: 'warn', volatility_changed: 'warn',
  macd_reversal: 'warn', rsi_extreme: 'warn',
  favorable_conditions: 'good', trailing_breakeven: 'good',
};

const TIMEFRAMES = [
  { key: '15m', label: '15 min' },
  { key: '1h', label: '1 hora' },
  { key: '4h', label: '4 horas' },
];

const cleanSymbol = (s) => (s ? s.split(':')[0] : s);
const words = (s) => (s ? String(s).replace(/_/g, ' ') : '-');
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** 1234.5 -> "1.234,50" (Spanish format), without relying on the device locale. */
const es = (x, d = 2) => {
  const n = Number(x);
  if (x == null || Number.isNaN(n)) return '-';
  const [int, dec] = Math.abs(n).toFixed(d).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `,${dec}` : ''}`;
};
const esSigned = (x, d = 2) => (x == null || Number.isNaN(Number(x)) ? '-' : `${Number(x) >= 0 ? '+' : ''}${es(x, d)}`);
const pct = (x, d = 1) => `${es(Math.abs(x), d)} %`;
const levelName = (name) =>
  (name ? String(name).replace(/^Fib(o)?\s*([\d.,]+)\s*%?/i, (m, o, n) => `Retroceso del ${String(n).replace('.', ',')} %`)
    .replace(/EMA\s*200(\s*\(aprox\))?/i, 'Media de 200 velas') : 'Nivel');
const qtyText = (q) => {
  const n = Math.abs(Number(q));
  if (!(n > 0)) return null;
  return es(n, n >= 100 ? 0 : n >= 1 ? 2 : 4);
};

/** Rewrites the server's technical suggestion as a sentence about this position. Null = unknown wording. */
const plainSuggestion = (text, side) => {
  const t = String(text || '');
  const rsi = (t.match(/RSI en (\d+)/) || [])[1];
  if (/tomar ganancias parciales/.test(t)) {
    return `El precio ha ${side === SIDE.long ? 'subido' : 'caído'} muy rápido${rsi ? ` (RSI ${rsi} de 100)` : ''} y puede darse la vuelta. Puedes plantearte cerrar una parte y asegurar ganancia.`;
  }
  if (/aproximandose a sobre/.test(t)) {
    return `El precio viene ${side === SIDE.long ? 'subiendo' : 'cayendo'} rápido${rsi ? ` (RSI ${rsi} de 100)` : ''}: va a tu favor, pero puede frenarse pronto.`;
  }
  if (/momentum contra posicion/.test(t)) return `En los últimos minutos el precio empuja en contra de tu ${side.name}.`;
  if (/Divergencia/.test(t)) return `El precio sigue a tu favor pero cada vez con menos fuerza: puede girarse en contra de tu ${side.name}.`;
  if (/estructura contra posicion/.test(t)) return `El precio está al otro lado de su media de largo plazo: la tendencia de fondo no apoya tu ${side.name}.`;
  if (/tendencia fuerte a favor/.test(t)) return `El precio ${side.needs} con fuerza y con mucho volumen: va a favor de tu ${side.name}.`;
  if (/posicion alineada con contexto/.test(t)) return `No hay señales de alarma: el mercado acompaña a tu ${side.name}.`;
  if (/vigilar niveles de invalidacion/.test(t)) return `Tu ${side.name} va contra la tendencia de fondo. Vigila el precio que rompe el motivo de la operación.`;
  if (/mantener posicion/.test(t)) return 'No hay señales de alarma por ahora.';
  return null;
};

const rsiColor = (v) => (v < 30 ? colors.accent : v > 70 ? colors.danger : colors.warn);
const rsiWord = (v) => (v < 30 ? 'muy caído' : v > 70 ? 'muy subido' : 'zona normal');

const RSIBar = ({ value }) => {
  if (value == null) return <Text style={styles.value}>-</Text>;
  const pct = Math.max(0, Math.min(100, Number(value)));
  const color = rsiColor(pct);
  return (
    <View style={styles.rsiWrap}>
      <View style={styles.rsiBar}>
        <View style={[styles.rsiFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.value, { color, marginLeft: space.sm }]}>{pct.toFixed(0)} · {rsiWord(pct)}</Text>
    </View>
  );
};

/** Tappable line that opens a block of detail inside the card. */
const Toggle = ({ label, open, onPress, right }) => (
  <TouchableOpacity style={styles.toggle} onPress={onPress} activeOpacity={0.7}>
    <Text style={[type.body, { flex: 1, fontWeight: '600' }]}>{label}</Text>
    {right}
    <Text style={styles.toggleAction}>{open ? 'Ocultar' : 'Ver'}</Text>
  </TouchableOpacity>
);

const SubTitle = ({ children }) => <Text style={[type.label, styles.subTitle]}>{children}</Text>;

const AIBlock = ({ title, text, color }) =>
  text ? (
    <View style={[styles.aiBlock, { borderLeftColor: color }]}>
      <Text style={[type.label, { marginBottom: 2 }]}>{title}</Text>
      <Text style={type.bodyDim}>{text}</Text>
    </View>
  ) : null;

const PositionCard = ({ position, totalCount = 1 }) => {
  const navigation = useNavigation();
  const { aiRemaining, refresh: refreshSubscription } = useSubscription();

  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [selectedTF, setSelectedTF] = useState('4h');
  // Open by default only when it is the only position
  const [expanded, setExpanded] = useState(totalCount <= 1);
  const [showDetail, setShowDetail] = useState(false);

  // AI analysis: only asked for when the user opens it
  const [showAI, setShowAI] = useState(false);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLimitError, setAiLimitError] = useState(false);

  const handleToggleAI = () => {
    if (!showAI && aiRemaining <= 0) {
      navigation.navigate('Upgrade');
      return;
    }
    setShowAI(!showAI);
  };

  const isLong = position?.side?.toUpperCase() === 'LONG';
  const side = isLong ? SIDE.long : SIDE.short;
  const coin = pairName(cleanSymbol(position?.symbol));
  const pnl = Number(position?.unrealized_pnl) || 0;
  const entry = position?.entry_price;
  const current = position?.current_price;
  const leverage = Number(position?.leverage) > 1 ? Number(position.leverage) : 1;
  const movePct = entry && current != null
    ? ((current - entry) / entry) * 100 * (isLong ? 1 : -1)
    : null;
  const pnlC = pnlColor(pnl);
  const liqPrice = position?.liquidation_price && position.liquidation_price > 0 ? position.liquidation_price : null;
  const qty = Math.abs(Number(position?.amount ?? position?.size ?? position?.quantity)) || null;
  const notional = Number(position?.notional) > 0 ? Number(position.notional) : (qty && entry ? qty * entry : null);
  const margin = Number(position?.initial_margin) > 0 ? Number(position.initial_margin) : null;
  const stopLoss = Number(position?.current_stop_loss ?? position?.stop_loss) > 0
    ? Number(position?.current_stop_loss ?? position?.stop_loss) : null;
  const takeProfit = Number(position?.current_take_profit ?? position?.take_profit) > 0
    ? Number(position?.current_take_profit ?? position?.take_profit) : null;
  // What the automatic closes are worth in USDT (negative = a loss)
  const outcomeAt = (level) => (qty && entry && level ? (level - entry) * qty * (isLong ? 1 : -1) : null);
  const stopOutcome = outcomeAt(stopLoss);
  const targetOutcome = outcomeAt(takeProfit);

  const analysis = position?.analysis || {};
  const isInvalidated = analysis.invalidation_breached === true;
  const bias = analysis.htf_bias;
  const trendWord = bias === 'alcista' ? 'de subida' : bias === 'bajista' ? 'de bajada' : null;
  // Does the market still back the position? One line for the header, one sentence for the card.
  const coherence = isInvalidated
    ? { label: 'El motivo de la operación ya no vale', color: colors.danger, tone: 'danger' }
    : analysis.coherence === 'a_favor'
      ? {
          label: 'La tendencia va a tu favor', color: colors.accent, tone: 'good',
          text: `Tu ${side.name} va a favor: la tendencia de fondo es ${trendWord || 'la misma'}.`,
        }
      : analysis.coherence === 'contra'
        ? {
            label: 'La tendencia va en tu contra', color: colors.danger, tone: 'danger',
            text: `Tu ${side.name} va en contra: la tendencia de fondo es ${trendWord || 'la contraria'}, así que es más fácil que pierdas.`,
          }
        : {
            label: 'Sin tendencia clara', color: colors.textMuted, tone: 'info',
            text: bias === 'mixto'
              ? `La tendencia de fondo no está clara: unas señales apuntan a subir y otras a bajar. Ni ayuda ni perjudica a tu ${side.name}.`
              : `Todavía no hay una tendencia de fondo clara que apoye o perjudique tu ${side.name}.`,
          };

  const timeframes = position?.timeframes || {};
  const ind = timeframes[selectedTF] || {};

  useEffect(() => {
    if (showAlerts && alerts.length === 0) {
      getPositionAlerts(position.symbol)
        .then((data) => setAlerts(data.alerts || []))
        .catch(() => {});
    }
  }, [showAlerts]);

  useEffect(() => {
    if (!showAI || !position?.symbol) return;

    const fetchAI = async () => {
      try {
        setAiLoading(true);
        setAiLimitError(false);
        const result = await getPositionAIAnalysis(position.symbol);
        setAiData(result);
        // A fresh answer uses one of the daily AI queries
        if (!result.cached) {
          refreshSubscription();
        }
      } catch (err) {
        console.error('Error fetching position AI:', err);
        if (err.status === 429) {
          setAiLimitError(true);
        }
        setAiData(null);
      } finally {
        setAiLoading(false);
      }
    };

    fetchAI();
  }, [showAI, position?.symbol, refreshSubscription]);

  const distance = (level) =>
    level && current ? pct((Math.abs(current - level) / current) * 100) : null;
  const liqDistance = distance(liqPrice);
  const invLevel = analysis.invalidation_level;
  const invDistance = distance(invLevel);

  const suggestion = plainSuggestion(analysis.suggestion, side);
  const sentiment = SENTIMENT[analysis.market_sentiment];
  const htf = trendOf(analysis.htf_bias === 'rango' ? 'neutral' : analysis.htf_bias);
  const ltf = trendOf(analysis.ltf_momentum);
  const observations = analysis.observations || [];
  const keyLevels = analysis.key_levels || [];

  return (
    <Card>
      {/* Header: what, which way, how it is going */}
      <TouchableOpacity style={styles.header} activeOpacity={0.7} onPress={() => setExpanded(!expanded)}>
        <View style={{ flex: 1 }}>
          <View style={styles.headerLine}>
            <Text style={styles.symbol}>{coin}</Text>
            <Chip label={isLong ? 'COMPRA · LONG' : 'VENTA · SHORT'} color={side.color} style={styles.headerChip} />
            {leverage > 1 && (
              <Chip label={`x${leverage} apalancado`} color={colors.textDim} style={styles.headerChip} />
            )}
          </View>
          <Text style={[type.small, { color: coherence.color, marginTop: 4 }]}>{coherence.label}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {!expanded && (
            <Text style={[styles.collapsedPnl, { color: pnlC }]}>{esSigned(pnl)} USDT</Text>
          )}
          <Text style={styles.toggleAction}>{expanded ? 'Ocultar' : 'Ver'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <>
          {/* 1. What it is and what makes it win */}
          <Text style={[type.body, { marginTop: space.sm }]}>
            {side.Name} de {coin}: {side.wins}.
          </Text>

          {/* 2. How it is going */}
          <View style={[styles.pnlBox, { backgroundColor: tint(pnlC, 0.1) }]}>
            <Text style={type.small}>{pnl >= 0 ? 'Vas ganando (aún sin cerrar)' : 'Vas perdiendo (aún sin cerrar)'}</Text>
            <Text style={[styles.pnlValue, { color: pnlC }]}>{esSigned(pnl)} USDT</Text>
            {movePct != null && (
              <Text style={[styles.pnlPercent, { color: pnlC }]}>
                El precio se movió {pct(movePct)} {movePct >= 0 ? 'a tu favor' : 'en tu contra'}
                {leverage > 1 ? ` (con x${leverage}, eso es ≈ ${esSigned(movePct * leverage, 0)} % sobre lo que pusiste)` : ''}
              </Text>
            )}
          </View>

          {/* 3. Where it closes by itself */}
          <SubTitle>Dónde se cierra sola</SubTitle>
          {stopLoss == null ? (
            <Notice tone="danger" title="No tiene cierre automático de pérdidas">
              Si el precio va en contra, nada detiene esta posición{liqPrice != null ? ' hasta la liquidación' : ''}. Puedes ponerle
              un stop desde Binance.
            </Notice>
          ) : (
            <Row
              first
              label="Cierre automático de pérdidas (stop)"
              value={fmtPrice(stopLoss)}
              color={colors.danger}
              help={
                stopOutcome == null
                  ? `Si el precio ${side.against} hasta aquí, la posición se cierra sola.`
                  : stopOutcome < 0
                    ? `Si el precio ${side.against} hasta aquí se cierra sola y pierdes ≈ ${es(Math.abs(stopOutcome))} USDT.`
                    : `Ya está en zona de ganancia: si el precio ${side.against} hasta aquí se cierra sola y aseguras ≈ ${esSigned(stopOutcome)} USDT.`
              }
            />
          )}
          {takeProfit != null && (
            <Row
              first={stopLoss == null}
              label="Cierre automático con ganancia (objetivo)"
              value={fmtPrice(takeProfit)}
              color={colors.accent}
              help={
                targetOutcome != null && targetOutcome > 0
                  ? `Si el precio ${side.needs} hasta aquí se cierra sola y ganas ≈ ${es(targetOutcome)} USDT.`
                  : `Si el precio ${side.needs} hasta aquí, la posición se cierra sola con ganancia.`
              }
            />
          )}
          {liqPrice != null && (
            <Row
              first={stopLoss == null && takeProfit == null}
              label="Precio en el que lo pierdes todo (liquidación)"
              value={fmtPrice(liqPrice)}
              color={colors.danger}
              help={`${liqDistance ? `Está a ${liqDistance} del precio actual. ` : ''}Si el precio llega ahí, Binance cierra la posición y pierdes el dinero que pusiste${margin ? ` (${es(margin)} USDT)` : ''}.`}
            />
          )}

          {/* 4. Does the reason to hold still stand */}
          <SubTitle>¿Sigue teniendo sentido?</SubTitle>
          {isInvalidated ? (
            <Notice tone="danger" title="El motivo de la operación ya no vale">
              {invLevel != null
                ? `El precio (${fmtPrice(current)}) ${isLong ? 'bajó de' : 'subió por encima de'} ${fmtPrice(invLevel)}, el nivel que sostenía tu ${side.name}. Mantenerla ya no tiene respaldo. Volvería a tener sentido si el precio cierra ${isLong ? 'por encima' : 'por debajo'} de ${fmtPrice(invLevel)}.`
                : `El precio rompió el nivel que sostenía tu ${side.name}. Mantenerla ya no tiene respaldo.`}
              {' '}La app no cierra nada por ti.
            </Notice>
          ) : (
            <>
              <Notice tone={coherence.tone} title={coherence.label}>
                {coherence.text}
              </Notice>
              {invLevel != null && (
                <Notice tone="info" title="Hasta dónde aguanta la idea">
                  {`Tu ${side.name} sigue teniendo sentido mientras el precio se mantenga ${isLong ? 'por encima' : 'por debajo'} de ${fmtPrice(invLevel)}${invDistance ? ` (está a ${invDistance})` : ''}.`}
                </Notice>
              )}
            </>
          )}
          {!!suggestion && (
            <Notice tone={RISK_TONE[analysis.risk_level] || 'info'} title="Ahora mismo">
              {suggestion}
            </Notice>
          )}

          {/* The plain facts of the position */}
          <SubTitle>Tu posición</SubTitle>
          <Row first label={isLong ? 'Compraste a' : 'Vendiste a'} value={fmtPrice(entry)} />
          <Row label="Precio ahora" value={fmtPrice(current)} />
          {qtyText(qty) != null && (
            <Row
              label="Cantidad"
              value={`${qtyText(qty)} ${coin}`}
              help={notional ? `Equivale a ≈ ${es(notional)} USDT.` : undefined}
            />
          )}
          {margin != null && (
            <Row
              label="Dinero tuyo en juego"
              value={`${es(margin)} USDT`}
              help={leverage > 1
                ? `Con x${leverage}, mueves ${leverage} veces ese dinero: las ganancias y las pérdidas se multiplican por ${leverage}.`
                : undefined}
            />
          )}

          <View style={{ height: space.md }} />

          {/* AI analysis */}
          <Toggle
            label="Análisis con IA"
            open={showAI}
            onPress={handleToggleAI}
            right={!showAI && aiRemaining <= 3 ? (
              <Chip
                label={aiRemaining > 0 ? `Quedan ${aiRemaining}` : 'Sin consultas'}
                color={aiRemaining > 0 ? colors.warn : colors.danger}
                style={{ alignSelf: 'center', marginRight: space.sm }}
              />
            ) : null}
          />
          {showAI && (
            <View style={styles.block}>
              {aiLoading ? (
                <View style={styles.aiLoading}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={[type.bodyDim, { marginLeft: space.sm }]}>Analizando tu posición…</Text>
                </View>
              ) : aiLimitError ? (
                <TouchableOpacity style={styles.tapLine} onPress={() => navigation.navigate('Upgrade')}>
                  <Text style={[type.bodyDim, { color: colors.warn }]}>
                    Has usado todas tus consultas de hoy. Toca para ver Premium.
                  </Text>
                </TouchableOpacity>
              ) : aiData ? (
                <>
                  <AIBlock title="Lectura" text={aiData.lectura} color={colors.info} />
                  <AIBlock title="Punto débil" text={aiData.fragilidad} color={colors.warn} />
                  <AIBlock title="↑ Si va a tu favor" text={aiData.si_favorece} color={colors.accent} />
                  <AIBlock title="↓ Si va en tu contra" text={aiData.si_contra} color={colors.danger} />
                  {!!aiData.generated_at && (
                    <Text style={[type.small, { textAlign: 'right' }]}>Generado {timeAgo(aiData.generated_at)}</Text>
                  )}
                </>
              ) : (
                <Text style={type.bodyDim}>No se pudo obtener el análisis. Inténtalo más tarde.</Text>
              )}
            </View>
          )}

          {/* Technical detail */}
          <Toggle label="Más detalle" open={showDetail} onPress={() => setShowDetail(!showDetail)} />
          {showDetail && (
            <View style={styles.block}>
              <SubTitle>Cómo está el mercado</SubTitle>
              <Row
                first
                label="Tendencia de fondo"
                value={`${htf.arrow} ${analysis.htf_bias === 'rango' ? 'En rango' : htf.label}`}
                color={analysis.htf_bias === 'rango' ? colors.warn : htf.color}
                help={GLOSSARY.context}
              />
              <Row
                label="Cómo se mueve el precio"
                value={STRUCTURE[analysis.htf_structure] || capital(words(analysis.htf_structure))}
                help={GLOSSARY.structure}
              />
              {invLevel != null && (
                <Row
                  label="Precio que rompe el motivo de la operación"
                  value={invDistance ? `${fmtPrice(invLevel)} · a ${invDistance}` : fmtPrice(invLevel)}
                  color={colors.warn}
                />
              )}
              {!!sentiment && (
                <Row label="Últimos minutos" value={`${sentiment.arrow} ${sentiment.label.replace('Mercado ', '')}`} color={sentiment.color} />
              )}

              {(!!analysis.coherence_text || !!analysis.thesis_status || !!analysis.suggestion) && (
                <>
                  <SubTitle>Lectura técnica del servidor</SubTitle>
                  {[analysis.coherence_text, analysis.thesis_status,
                    isInvalidated ? analysis.recovery_condition : analysis.invalidation_condition,
                    analysis.suggestion].filter(Boolean).map((line, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={[type.small, { flex: 1 }]}>{line}</Text>
                    </View>
                  ))}
                </>
              )}
              <Row
                label="Fuerza ahora"
                value={`${ltf.arrow} ${ltf.label}`}
                color={ltf.color}
                help={GLOSSARY.timing}
              />

              {observations.length > 0 && (
                <>
                  <SubTitle>Observaciones</SubTitle>
                  {observations.map((obs, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={[type.bodyDim, { flex: 1 }]}>{obs}</Text>
                    </View>
                  ))}
                </>
              )}

              {keyLevels.length > 0 && (
                <>
                  <SubTitle>Precios importantes</SubTitle>
                  <Text style={[type.small, { marginBottom: space.xs }]}>{GLOSSARY.levels}</Text>
                  {keyLevels.map((level, i) => (
                    <Row key={i} first={i === 0} label={levelName(level?.name)} value={fmtPrice(level?.price)} />
                  ))}
                </>
              )}

              <SubTitle>Indicadores técnicos</SubTitle>
              <Segment options={TIMEFRAMES} value={selectedTF} onChange={setSelectedTF} />
              <View style={styles.tfSentiments}>
                {TIMEFRAMES.map((tf) => {
                  const s = SENTIMENT[timeframes[tf.key]?.sentiment] || SENTIMENT.neutral;
                  return (
                    <Text key={tf.key} style={[type.small, styles.tfSentiment, { color: s.color }]}>
                      {s.arrow} {s.label.replace('Mercado ', '')}
                    </Text>
                  );
                })}
              </View>
              {ind.rsi != null ? (
                <>
                  <Row first label="RSI" help={GLOSSARY.rsi}>
                    <RSIBar value={ind.rsi} />
                  </Row>
                  <Row
                    label="MACD"
                    value={ind.macd_trend === 'bullish' ? '↑ Empuja hacia arriba' : ind.macd_trend === 'bearish' ? '↓ Empuja hacia abajo' : '→ Sin dirección'}
                    color={ind.macd_trend === 'bullish' ? colors.accent : ind.macd_trend === 'bearish' ? colors.danger : colors.textDim}
                    help="Compara dos medias del precio para ver hacia dónde empuja."
                  />
                  <Row
                    label="Media de 200 velas"
                    value={ind.price_above_ema ? 'Precio por encima' : 'Precio por debajo'}
                    color={ind.price_above_ema ? colors.accent : colors.danger}
                    help="Por encima suele indicar tendencia alcista; por debajo, bajista."
                  />
                  <Row
                    label="Volumen"
                    value={ind.volume_above_average ? 'Más de lo normal' : 'Normal'}
                    color={ind.volume_above_average ? colors.warn : colors.textDim}
                    help={GLOSSARY.volume}
                  />
                  {!!ind.fibonacci && (
                    <Row
                      label="Fibonacci"
                      value={`${ind.fibonacci.is_uptrend ? '↑ Tendencia alcista' : '↓ Tendencia bajista'}${
                        ind.fibonacci.closest_level_name ? ` · nivel ${ind.fibonacci.closest_level_name}%` : ''
                      }`}
                      color={ind.fibonacci.is_uptrend ? colors.accent : colors.danger}
                    />
                  )}
                </>
              ) : (
                <Text style={[type.bodyDim, { paddingVertical: space.md }]}>Sin datos para este plazo.</Text>
              )}
            </View>
          )}

          {/* Alerts */}
          <Toggle label="Avisos de esta posición" open={showAlerts} onPress={() => setShowAlerts(!showAlerts)} />
          {showAlerts && (
            <View style={styles.block}>
              {alerts.length === 0 ? (
                <Text style={type.bodyDim}>Sin avisos recientes.</Text>
              ) : (
                alerts.map((alert, i) => {
                  const kind = alert?.type || alert?.alert_type;
                  return (
                    <Notice
                      key={alert?.id || i}
                      tone={ALERT_TONE[kind] || 'info'}
                      title={ALERT_TITLES[kind] || alert?.title || 'Aviso'}
                      style={{ marginBottom: space.sm }}
                    >
                      <Text style={type.bodyDim}>{alert?.message}</Text>
                      {!!alert?.created_at && (
                        <Text style={[type.small, { marginTop: 2 }]}>{timeAgo(alert.created_at)}</Text>
                      )}
                    </Notice>
                  );
                })
              )}
            </View>
          )}
        </>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  headerLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  headerChip: { alignSelf: 'center', marginLeft: space.sm },
  symbol: { color: colors.text, fontSize: 20, fontWeight: '700' },
  collapsedPnl: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], marginBottom: 2 },
  pnlBox: { borderRadius: radius.md, padding: space.lg, marginTop: space.md, marginBottom: space.sm, alignItems: 'center' },
  pnlValue: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  pnlPercent: { fontSize: 13, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  toggle: {
    flexDirection: 'row', alignItems: 'center', minHeight: 48,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  toggleAction: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  block: { paddingBottom: space.md },
  subTitle: { marginTop: space.lg, marginBottom: space.sm },
  value: { color: colors.text, fontSize: 14, fontWeight: '600' },
  aiBlock: {
    borderLeftWidth: 3, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm,
    padding: space.md, marginBottom: space.sm,
  },
  aiLoading: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  tapLine: { minHeight: 44, justifyContent: 'center' },
  bulletRow: { flexDirection: 'row', marginBottom: space.xs },
  bullet: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginRight: space.sm },
  tfSentiments: { flexDirection: 'row', marginTop: space.xs, marginBottom: space.xs },
  tfSentiment: { flex: 1, textAlign: 'center' },
  rsiWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: space.md },
  rsiBar: { width: 72, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  rsiFill: { height: 6, borderRadius: 3 },
});

export default PositionCard;

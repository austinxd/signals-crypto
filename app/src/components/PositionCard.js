import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getPositionAlerts, getPositionAIAnalysis } from '../services/api';
import { useSubscription } from '../context/SubscriptionContext';
import { Card, Chip, Row, Notice, Segment } from './ui';
import {
  colors, space, radius, type, tint,
  DIRECTION, GLOSSARY, trendOf, pairName, fmtPrice, fmtSigned, pnlColor, timeAgo,
} from '../theme';

// How the position sits against the market trend, said plainly.
const COHERENCE = {
  a_favor: { label: 'A favor de la tendencia', color: colors.accent, tone: 'good' },
  contra: { label: 'En contra de la tendencia', color: colors.danger, tone: 'danger' },
  neutral: { label: 'Sin tendencia clara', color: colors.textMuted, tone: 'info' },
  invalidated: { label: 'Idea invalidada', color: colors.danger, tone: 'danger' },
};

const RISK_TONE = { low: 'good', medium: 'warn', high: 'danger' };
const RISK_LABEL = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto' };

const SENTIMENT = {
  bullish: { label: 'Mercado alcista', arrow: '↑', color: colors.accent },
  bearish: { label: 'Mercado bajista', arrow: '↓', color: colors.danger },
  neutral: { label: 'Mercado lateral', arrow: '→', color: colors.textMuted },
};

// Plain titles for the alert types the server sends.
const ALERT_TITLES = {
  htf_bias_changed: 'La tendencia de fondo cambió',
  htf_momentum_changed: 'La fuerza de la tendencia cambió',
  scenario_changed: 'Cambió la situación del mercado',
  volatility_changed: 'El precio se mueve distinto',
  price_at_key_zone: 'El precio llegó a una zona importante',
  coherence_changed: 'La tendencia cambió respecto a tu posición',
  thesis_invalidated: 'La idea de la operación ya no se sostiene',
  multiple_against_context: 'Varias posiciones van contra la tendencia',
  high_risk_exposure: 'Tienes mucho riesgo abierto',
  favorable_conditions: 'Condiciones favorables',
};
const ALERT_TONE = {
  thesis_invalidated: 'danger', multiple_against_context: 'danger', high_risk_exposure: 'danger',
  coherence_changed: 'warn', htf_bias_changed: 'warn', htf_momentum_changed: 'warn', volatility_changed: 'warn',
  favorable_conditions: 'good',
};

const TIMEFRAMES = [
  { key: '15m', label: '15 min' },
  { key: '1h', label: '1 hora' },
  { key: '4h', label: '4 horas' },
];

const cleanSymbol = (s) => (s ? s.split(':')[0] : s);
const words = (s) => (s ? String(s).replace(/_/g, ' ') : '-');
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
  const dir = isLong ? DIRECTION.long : DIRECTION.short;
  const pnl = Number(position?.unrealized_pnl) || 0;
  const entry = position?.entry_price;
  const current = position?.current_price;
  const pnlPercent = entry && current != null
    ? ((current - entry) / entry) * 100 * (isLong ? 1 : -1)
    : 0;
  const pnlC = pnlColor(pnl);
  const liqPrice = position?.liquidation_price && position.liquidation_price > 0 ? position.liquidation_price : null;

  const analysis = position?.analysis || {};
  const isInvalidated = analysis.invalidation_breached === true;
  const coherence = isInvalidated ? COHERENCE.invalidated : (COHERENCE[analysis.coherence] || COHERENCE.neutral);

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
    level && current ? `${((Math.abs(current - level) / current) * 100).toFixed(1)}%` : null;
  const liqDistance = distance(liqPrice);
  const invLevel = analysis.invalidation_level;
  const invDistance = distance(invLevel);

  const size = position?.size ?? position?.quantity ?? position?.contracts ?? position?.amount;
  const stopLoss = position?.stop_loss ?? position?.sl;
  const takeProfit = position?.take_profit ?? position?.tp;
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
            <Text style={styles.symbol}>{pairName(cleanSymbol(position?.symbol))}</Text>
            <Chip label={`${dir.arrow} ${dir.short}`} color={dir.color} style={styles.headerChip} />
            {position?.leverage > 1 && (
              <Chip label={`x${position.leverage}`} color={colors.textDim} style={styles.headerChip} />
            )}
          </View>
          <Text style={[type.small, { color: coherence.color, marginTop: 4 }]}>{coherence.label}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {!expanded && (
            <Text style={[styles.collapsedPnl, { color: pnlC }]}>{fmtSigned(pnl)} USDT</Text>
          )}
          <Text style={styles.toggleAction}>{expanded ? 'Ocultar' : 'Ver'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <>
          {/* The number that matters */}
          <View style={[styles.pnlBox, { backgroundColor: tint(pnlC, 0.1) }]}>
            <Text style={type.small}>{pnl >= 0 ? 'Vas ganando' : 'Vas perdiendo'}</Text>
            <Text style={[styles.pnlValue, { color: pnlC }]}>{fmtSigned(pnl)} USDT</Text>
            <Text style={[styles.pnlPercent, { color: pnlC }]}>
              {fmtSigned(pnlPercent)}% de movimiento del precio
            </Text>
          </View>

          <Row first label="Entrada" value={fmtPrice(entry)} />
          <Row label="Precio actual" value={fmtPrice(current)} />
          {size != null && <Row label="Tamaño" value={String(size)} />}
          {position?.initial_margin > 0 && (
            <Row label="Dinero puesto (margen)" value={`$${Number(position.initial_margin).toFixed(2)}`} />
          )}
          {position?.leverage > 1 && (
            <Row label="Apalancamiento" value={`x${position.leverage}`} help={GLOSSARY.leverage} />
          )}
          {stopLoss != null && stopLoss > 0 && (
            <Row label="Stop" value={fmtPrice(stopLoss)} color={colors.danger} help={GLOSSARY.stop} />
          )}
          {takeProfit != null && takeProfit > 0 && (
            <Row label="Objetivo" value={fmtPrice(takeProfit)} color={colors.accent} />
          )}
          {liqPrice != null && (
            <Row
              label="Liquidación"
              value={liqDistance ? `${fmtPrice(liqPrice)} · a ${liqDistance}` : fmtPrice(liqPrice)}
              color={colors.danger}
              help={GLOSSARY.liquidation}
            />
          )}
          {invLevel != null && (
            <Row
              label="Nivel de invalidación"
              value={invDistance ? `${fmtPrice(invLevel)} · a ${invDistance}` : fmtPrice(invLevel)}
              color={colors.warn}
              help="Si el precio cruza este nivel, la idea de la operación deja de tener sentido."
            />
          )}

          <View style={{ height: space.md }} />

          {/* What to do */}
          {isInvalidated && (
            <Notice tone="danger" title="La idea de la operación ya no se sostiene">
              El precio cruzó el nivel de invalidación. Revisa si quieres seguir dentro.
            </Notice>
          )}

          {!!analysis.suggestion && (
            <Notice
              tone={RISK_TONE[analysis.risk_level] || 'info'}
              title={RISK_LABEL[analysis.risk_level] ? `Sugerencia · ${RISK_LABEL[analysis.risk_level]}` : 'Sugerencia'}
            >
              <Text style={type.bodyDim}>{analysis.suggestion}</Text>
              {!!sentiment && (
                <Text style={[type.small, { color: sentiment.color, marginTop: 4 }]}>
                  {sentiment.arrow} {sentiment.label}
                </Text>
              )}
            </Notice>
          )}

          <Notice tone={coherence.tone} title={coherence.label}>
            {analysis.coherence_text || 'Todavía no hay datos para comparar tu posición con la tendencia.'}
          </Notice>

          {/* Thesis */}
          {!!analysis.thesis_status && (
            <Notice tone={isInvalidated ? 'danger' : 'good'} title={isInvalidated ? 'Estado actual' : 'La idea de la operación'}>
              {analysis.thesis_status}
            </Notice>
          )}
          {isInvalidated && !!analysis.recovery_condition && (
            <Notice tone="warn" title="Qué tendría que pasar para recuperarla">
              {analysis.recovery_condition}
            </Notice>
          )}
          {!isInvalidated && !!analysis.invalidation_condition && (
            <Notice tone="warn" title="Cuándo dejaría de valer">
              {analysis.invalidation_condition}
            </Notice>
          )}

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
              <Row label="Estructura" value={capital(words(analysis.htf_structure))} help={GLOSSARY.structure} />
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
                    <Row key={i} first={i === 0} label={level?.name || 'Nivel'} value={fmtPrice(level?.price)} />
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
                    value={ind.macd_trend === 'bullish' ? '↑ Alcista' : '↓ Bajista'}
                    color={ind.macd_trend === 'bullish' ? colors.accent : colors.danger}
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
          <Toggle label="Alertas de esta posición" open={showAlerts} onPress={() => setShowAlerts(!showAlerts)} />
          {showAlerts && (
            <View style={styles.block}>
              {alerts.length === 0 ? (
                <Text style={type.bodyDim}>Sin alertas recientes.</Text>
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
  pnlPercent: { fontSize: 13, fontWeight: '600', marginTop: 2 },
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

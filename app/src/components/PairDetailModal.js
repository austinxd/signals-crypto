import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getUnifiedMarketData, getVolumeProfile, getAIExplanation } from '../services/api';
import { explain, tradePlan } from '../explain';
import { useSubscription } from '../context/SubscriptionContext';
import {
  colors, space, radius, type, tint,
  GLOSSARY, pairName, fmtPrice,
} from '../theme';
import {
  ModalHeader, Card, SectionTitle, Chip, Button, Segment, Stat, StatRow, Row, Notice, Collapsible, Loading, Help,
} from './ui';

const VOLATILITY = {
  alta: { label: 'Alta', color: colors.danger },
  baja: { label: 'Baja', color: colors.warn },
  normal: { label: 'Normal', color: colors.textDim },
};

const RSI_ZONE = {
  sobrecompra: { label: 'Muy subido', color: colors.danger },
  sobrevendido: { label: 'Muy caído', color: colors.accent },
  neutral: { label: 'Normal', color: colors.textDim },
};

const RSI_STATE = {
  normal: { label: 'Movimiento normal', color: colors.textDim },
  momentum_extendido: { label: 'Movimiento muy estirado', color: colors.warn },
  agotamiento_potencial: { label: 'Posible agotamiento', color: colors.danger },
};

const ZONE = {
  oferta: { label: 'Posible techo (por encima)', color: colors.textDim },
  demanda: { label: 'Posible suelo (por debajo)', color: colors.textDim },
};
const zoneOf = (t) => ZONE[t] || { label: 'Justo en el precio actual', color: colors.textDim };

const AI_REASON = {
  momentum_extreme_against_trend: 'Movimiento muy fuerte en contra de la tendencia',
  htf_ltf_conflict: 'Los últimos minutos van en contra de la tendencia',
  scenario_downgrade: 'La situación ha empeorado',
  volatility_spike: 'El precio se mueve con mucha brusquedad',
  volume_divergence: 'El volumen no acompaña al precio',
  structural_friction: 'Hay un nivel de precio que puede frenarlo',
};
const STRUCTURE = {
  extension: 'Alejándose, a favor de la tendencia',
  retroceso: 'Retrocediendo dentro de la tendencia',
  consolidacion: 'Quieto en un rango',
  'en nivel clave': 'En un precio importante',
};

const BUY = colors.info;
const SELL = colors.warn;

const BIAS_TEXT = {
  alcista: 'De subida (a favor de long)',
  bajista: 'De bajada (a favor de short)',
  mixto: 'No está clara',
  neutral: 'Sin datos suficientes',
};
const NOW_TEXT = { alcista: 'Subiendo', bajista: 'Bajando', neutral: 'Quieto' };

const words = (s) => (s == null ? '' : String(s).replace(/_/g, ' '));
const capital = (s) => {
  const w = words(s);
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
};
const fixed = (x, d) => (typeof x === 'number' && !Number.isNaN(x) ? x.toFixed(d) : '—');
const signedPct = (x, d = 2) => (typeof x === 'number' && !Number.isNaN(x) ? `${x > 0 ? '+' : ''}${x.toFixed(d)}%` : '');

const formatVolume = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '$0';
  const v = Number(value);
  const abs = Math.abs(v);
  if (abs >= 1000000) return `$${(v / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const Reason = ({ children }) => (
  <View style={styles.reason}>
    <Text style={styles.reasonDot}>•</Text>
    <Text style={[type.bodyDim, { flex: 1 }]}>{children}</Text>
  </View>
);

const PairDetailModal = ({ visible, onClose, pair, data: initialData, onRemove }) => {
  const navigation = useNavigation();
  const { aiRemaining, isPremium, refresh: refreshSubscription } = useSubscription();
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Volume profile: fetched only when the reader asks for it
  const [showVolumeProfile, setShowVolumeProfile] = useState(false);
  const [volumeData, setVolumeData] = useState(null);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeTf, setVolumeTf] = useState('4h');

  // AI explanation: fetched only when the reader asks for it
  const [showAIExplanation, setShowAIExplanation] = useState(false);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiLimit, setAiLimit] = useState(false);

  const goPremium = () => {
    onClose && onClose();
    // Wait for this modal to finish closing; iOS drops a screen presented while another is dismissing.
    setTimeout(() => navigation.navigate('Upgrade'), 400);
  };
  // Out of AI uses: offer Premium instead of asking the server for an answer it will refuse.
  const askAI = () => (!isPremium && aiRemaining <= 0 ? goPremium() : setShowAIExplanation(true));
  // The bot tab opens with this coin and side already chosen; the bot decides the size and sets the stop.
  const practiceWithBot = (side) => {
    navigation.navigate('Bot', { symbol: `${pairName(pair)}USDT`, side, ts: Date.now() });
    onClose && onClose();
  };

  // Fresh data while the modal is open
  useEffect(() => {
    if (!visible || !pair) {
      setLiveData(null);
      setLastUpdate(null);
      setShowVolumeProfile(false);
      setVolumeData(null);
      setShowAIExplanation(false);
      setAiData(null);
      setAiError(null);
      setAiLimit(false);
      return;
    }

    const fetchPairData = async () => {
      try {
        setLoading(true);
        const freshData = await getUnifiedMarketData([pair], true);
        if (freshData?.pairs?.[pair]) {
          setLiveData(freshData.pairs[pair]);
          setLastUpdate(new Date());
        }
      } catch (err) {
        console.error('Error fetching pair data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPairData();
    const interval = setInterval(fetchPairData, 15000);
    return () => clearInterval(interval);
  }, [visible, pair]);

  useEffect(() => {
    if (!showVolumeProfile || !pair) return;

    const fetchVolume = async () => {
      try {
        setVolumeLoading(true);
        const result = await getVolumeProfile(pair, volumeTf);
        setVolumeData(result);
      } catch (err) {
        console.error('Error fetching volume profile:', err);
        setVolumeData(null);
      } finally {
        setVolumeLoading(false);
      }
    };

    fetchVolume();
  }, [showVolumeProfile, pair, volumeTf]);

  useEffect(() => {
    if (!showAIExplanation || !pair) return;

    const fetchAI = async () => {
      try {
        setAiLoading(true);
        setAiError(null);
        setAiLimit(false);
        const result = await getAIExplanation(pair);
        setAiData(result);
        if (!result?.cached) refreshSubscription && refreshSubscription();
      } catch (err) {
        console.error('Error fetching AI explanation:', err);
        if (err.status === 429) setAiLimit(true);
        setAiError(err.message || 'No se pudo obtener la explicación');
        setAiData(null);
      } finally {
        setAiLoading(false);
      }
    };

    fetchAI();
  }, [showAIExplanation, pair]);

  const data = liveData || initialData;
  const name = pairName(pair) || 'Par';

  if (!data || !data.analysis) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.container}>
          <ModalHeader title={name} onClose={onClose} />
          {loading ? (
            <Loading label="Cargando el análisis…" />
          ) : (
            <View style={styles.body}>
              <Notice tone="info" title="Sin datos por ahora">
                Todavía no hay análisis de este par. Vuelve a abrirlo en un momento.
              </Notice>
            </View>
          )}
        </View>
      </Modal>
    );
  }

  const { analysis, htf_indicators: htfInd, ltf_indicators: ltfInd, funding, price } = data;

  const view = explain(analysis);
  const plan = tradePlan(view, price, htfInd?.atr);
  const hasConfirmation = !!analysis?.timing?.has_confirmation;
  const rsiZoneKey = analysis?.timing?.rsi_zone || 'neutral';
  const rsiZone = RSI_ZONE[rsiZoneKey] || RSI_ZONE.neutral;
  const volatilityKey = analysis?.context?.volatility_state || analysis?.volatility_state || 'normal';
  const volatility = VOLATILITY[volatilityKey] || VOLATILITY.normal;
  const htfStructure = analysis?.context?.htf_structure || analysis?.htf_structure || null;

  const keyLevels = Array.isArray(analysis?.key_levels) ? analysis.key_levels : [];
  const zones = Array.isArray(analysis?.structural_zones) ? analysis.structural_zones.slice(0, 4) : [];
  const rsiState = analysis?.rsi_htf_state || null;
  const rsiStateStyle = rsiState ? RSI_STATE[rsiState.label] || RSI_STATE.agotamiento_potencial : null;
  const gap = data?.gap;
  const gapOpen = !!(gap?.exists && !gap?.filled);

  const fundingRate = funding?.funding_rate_percent;
  const fundingText =
    typeof fundingRate !== 'number' ? null
      : fundingRate > 0.05 ? { text: 'Muy positiva: hay mucha más gente en long que en short.', color: colors.danger }
      : fundingRate < -0.05 ? { text: 'Muy negativa: hay mucha más gente en short que en long.', color: colors.accent }
      : { text: 'En rango normal.', color: colors.textDim };

  const distanceTo = (level) =>
    typeof price === 'number' && price > 0 && typeof level === 'number' ? ((level - price) / price) * 100 : null;

  const summary = volumeData?.summary;
  const profile = Array.isArray(volumeData?.volume_profile) ? volumeData.volume_profile.slice(-10) : [];
  const barWidth = (part, level) => {
    const total = Number(level?.total) || 0;
    const pct = total > 0 ? (Number(part) / total) * (Number(level?.percent) || 0) : 0;
    return `${Math.max(0, Math.min(100, pct))}%`;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ModalHeader
          title={name}
          subtitle={fmtPrice(price)}
          onClose={onClose}
          right={loading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
        />

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* 1. The answer and why */}
          <Card>
            <Text style={[styles.mark, { color: view.markColor }]}>{view.mark}</Text>
            <Chip label={view.headline} color={view.color} solid style={styles.bigChip} />
            <Text style={[type.body, { marginTop: space.md, marginBottom: space.md }]}>{view.action}</Text>
            {view.reasons.map((r, i) => <Reason key={i}>{r}</Reason>)}
            {!!view.means && (
              <Help label={`¿Qué es ${view.side}?`} style={{ marginTop: space.sm }}>{view.means}</Help>
            )}
          </Card>

          {/* 2. What to do with it: a suggestion, and the two places to act on it */}
          {plan && (
            <>
              <SectionTitle>{plan.title}</SectionTitle>
              <Card>
                {plan.rows.map((r, i) => (
                  <Row key={r.label} first={i === 0} label={r.label} value={r.value} help={r.help} />
                ))}
                <Text style={[type.small, { marginTop: space.sm }]}>
                  Es una sugerencia, no una orden. Vale mientras el veredicto no cambie.
                </Text>
                <View style={styles.exits}>
                  <Text style={type.bodyDim}>
                    <Text style={styles.exitName}>Con dinero real: </Text>lo haces tú en Binance Futuros.
                  </Text>
                  <Text style={[type.bodyDim, { marginTop: space.xs }]}>
                    <Text style={styles.exitName}>Sin dinero: </Text>el bot lo abre con dinero simulado.
                  </Text>
                  <Button
                    label="Practicar con el bot (simulado)"
                    kind="secondary"
                    onPress={() => practiceWithBot(view.side)}
                    style={{ marginTop: space.md }}
                  />
                </View>
              </Card>
            </>
          )}

          {/* 3. AI explanation */}
          <Card>
            {!showAIExplanation ? (
              <>
                <View style={styles.aiRow}>
                  <Text style={[type.heading, { flex: 1 }]}>Explicación con IA</Text>
                  <Button label="Pedir" kind="secondary" small onPress={askAI} />
                </View>
                {!isPremium && typeof aiRemaining === 'number' && (
                  <Text style={[type.small, { marginTop: space.xs }]}>
                    {aiRemaining > 0
                      ? `Te quedan ${aiRemaining} gratis.`
                      : 'Ya usaste las gratis. Con Premium tienes 100 al mes.'}
                  </Text>
                )}
              </>
            ) : aiLoading ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={[type.bodyDim, { marginLeft: space.sm }]}>Analizando el contexto…</Text>
              </View>
            ) : aiLimit ? (
              <>
                <Notice tone="warn" title="Llegaste al límite de explicaciones" style={{ marginBottom: 0 }}>
                  Con Premium puedes pedir todas las que quieras.
                </Notice>
                <Button label="Ver Premium" onPress={goPremium} style={{ marginTop: space.md }} />
              </>
            ) : aiError ? (
              <>
                <Notice tone="warn" title="No se pudo obtener la explicación" style={{ marginBottom: 0 }}>
                  {String(aiError)}
                </Notice>
                <Button
                  label="Ocultar"
                  kind="ghost"
                  small
                  onPress={() => setShowAIExplanation(false)}
                  style={styles.ghostAction}
                />
              </>
            ) : aiData?.explanation ? (
              <>
                {!!aiData.reason && <Chip label={AI_REASON[aiData.reason] || 'Algo no encaja'} color={colors.info} style={{ marginBottom: space.sm }} />}
                <Text style={type.body}>{aiData.explanation}</Text>
                <Button
                  label="Ocultar"
                  kind="ghost"
                  small
                  onPress={() => setShowAIExplanation(false)}
                  style={styles.ghostAction}
                />
              </>
            ) : aiData ? (
              <Notice tone="good" title="Sin contradicciones" style={{ marginBottom: 0 }}>
                La IA no ve nada que contradiga lo que dice el análisis de arriba.
              </Notice>
            ) : null}
          </Card>

          {/* 4. Everything behind the verdict, closed by default */}
          <Collapsible title="Análisis completo" hint="Tendencia, precios donde suele frenar e indicadores">
            <Text style={type.label}>Tendencia de los últimos días</Text>
            <Row first label="Hacia dónde va" value={BIAS_TEXT[analysis?.context?.htf_bias] || 'Sin datos'} />
            <Row
              label="En qué punto está"
              value={htfStructure ? STRUCTURE[htfStructure] || capital(htfStructure) : 'Sin datos'}
            />
            <Row label="Volatilidad" value={volatility.label} color={volatility.color} />
            {htfInd?.price_above_ema !== undefined && htfInd?.price_above_ema !== null && (
              <Row
                label="Precio frente a su media larga"
                value={htfInd.price_above_ema ? 'Por encima' : 'Por debajo'}
                color={htfInd.price_above_ema ? colors.accent : colors.danger}
              />
            )}
            {rsiState && rsiState.label !== 'normal' && (
              <View style={styles.subBox}>
                <Text style={[styles.subBoxTitle, { color: rsiStateStyle.color }]}>{rsiStateStyle.label}</Text>
                <Text style={type.bodyDim}>
                  Lleva días moviéndose en la misma dirección casi sin descanso: es fácil que frene o retroceda.
                </Text>
              </View>
            )}

            <Text style={[type.label, styles.group]}>Últimos minutos</Text>
            <Row first label="Ahora mismo" value={NOW_TEXT[analysis?.timing?.ltf_momentum] || 'Quieto'} />
            <Row label="RSI" value={rsiZone.label} color={rsiZone.color} />
            <Row
              label="¿Acompaña a la tendencia?"
              value={hasConfirmation ? 'Sí' : 'Todavía no'}
              color={hasConfirmation ? colors.accent : colors.textDim}
            />
            <Help label="¿Qué significan estos datos?" style={{ marginTop: space.sm }}>
              {`${GLOSSARY.context} ${GLOSSARY.timing} Volatilidad: ${GLOSSARY.volatility.charAt(0).toLowerCase()}${GLOSSARY.volatility.slice(1)} `
                + `La media larga es la de las últimas 200 velas (EMA200): por encima suele indicar tendencia alcista. RSI: ${GLOSSARY.rsi.charAt(0).toLowerCase()}${GLOSSARY.rsi.slice(1)} `
                + `“Acompaña”: ${GLOSSARY.confirmation.charAt(0).toLowerCase()}${GLOSSARY.confirmation.slice(1)}`}
            </Help>

            <Text style={[type.label, styles.group]}>Precios donde suele frenar</Text>
            {(analysis?.distance_to_zone?.state === 'en_zona' || analysis?.distance_to_zone?.state === 'cercano') && (
              <Notice tone="warn" style={{ marginTop: space.sm, marginBottom: 0 }}>
                {analysis.distance_to_zone.state === 'en_zona'
                  ? 'El precio está justo en uno de estos niveles: espera a ver hacia dónde sale antes de abrir long o short.'
                  : 'Hay uno de estos niveles muy cerca del precio: ahí puede frenarse.'}
              </Notice>
            )}

            {(zones.length > 0 ? [] : keyLevels).map((level, idx) => {
              const d = distanceTo(level?.price);
              return (
                <Row
                  key={`k${idx}`}
                  first={idx === 0}
                  label={level?.name || 'Nivel'}
                  help={d == null ? undefined : `${signedPct(d, 1)} desde el precio actual`}
                  value={fmtPrice(level?.price)}
                />
              );
            })}

            {zones.map((zone, idx) => {
              const z = zoneOf(zone?.type);
              const d = typeof zone?.distance_percent === 'number' ? zone.distance_percent : distanceTo(zone?.price);
              const confluence = Array.isArray(zone?.confluence) ? zone.confluence.join(' + ') : '';
              return (
                <View key={`z${idx}`} style={[styles.row, idx === 0 && { borderTopWidth: 0 }]}>
                  <View style={styles.rowLine}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.zoneLabel, { color: z.color }]}>{z.label}</Text>
                      {!!confluence && <Text style={type.small}>{confluence}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.value}>{fmtPrice(zone?.price)}</Text>
                      {d != null && <Text style={type.small}>{signedPct(d, 1)}</Text>}
                    </View>
                  </View>
                </View>
              );
            })}

            {keyLevels.length === 0 && zones.length === 0 && (
              <Text style={[type.bodyDim, { marginTop: space.sm }]}>No hay niveles cercanos destacados ahora mismo.</Text>
            )}
            <Help label="¿Qué son estos precios?" style={{ marginTop: space.sm }}>{GLOSSARY.levels}</Help>

            {gapOpen && (
              <>
                <Text style={[type.label, styles.group]}>Hueco de precio pendiente</Text>
                <Row first label="Zona" value={`${fmtPrice(gap.low)} – ${fmtPrice(gap.high)}`} />
                {typeof gap.distance_pct === 'number' && (
                  <Row
                    label={
                      gap.position === 'above' ? 'El precio está por encima'
                        : gap.position === 'below' ? 'El precio está por debajo'
                        : 'El precio está dentro'
                    }
                    value={`${gap.distance_pct.toFixed(1)}%`}
                  />
                )}
                <Help label="¿Qué es un hueco?" style={{ marginTop: space.sm }}>
                  Un tramo de precios por el que el mercado pasó sin negociar (velas diarias). A menudo el precio vuelve a visitarlo.
                </Help>
              </>
            )}

          {/* 5. Technical data */}
            <View style={{ marginTop: space.lg }} />
            <Collapsible plain title="Para expertos" hint="Indicadores, tasa de fondeo y volumen">
            <Text style={type.label}>Indicadores</Text>
            <View style={styles.indicatorGrid}>
              <View style={styles.indicatorCol}>
                <Text style={styles.indicatorColTitle}>4 horas</Text>
                <Row first label="RSI" value={fixed(htfInd?.rsi, 1)} />
                <Row
                  label="MACD"
                  value={fixed(htfInd?.macd_histogram, 2)}
                  color={htfInd?.macd_histogram > 0 ? colors.accent : htfInd?.macd_histogram < 0 ? colors.danger : undefined}
                />
                <Row
                  label="EMA200"
                  value={htfInd?.price_above_ema === true ? 'Encima' : htfInd?.price_above_ema === false ? 'Debajo' : '—'}
                />
              </View>
              <View style={styles.indicatorCol}>
                <Text style={styles.indicatorColTitle}>15 minutos</Text>
                <Row first label="RSI" value={fixed(ltfInd?.rsi, 1)} />
                <Row
                  label="MACD"
                  value={fixed(ltfInd?.macd_histogram, 4)}
                  color={ltfInd?.macd_histogram > 0 ? colors.accent : ltfInd?.macd_histogram < 0 ? colors.danger : undefined}
                />
                <Row
                  label="Volumen"
                  value={typeof ltfInd?.volume_ratio === 'number' ? `${ltfInd.volume_ratio.toFixed(1)}x` : '—'}
                />
              </View>
            </View>
            <Help label="¿Cómo se leen?" style={{ marginTop: space.sm }}>{`RSI: ${GLOSSARY.rsi} Volumen: ${GLOSSARY.volume}`}</Help>

            {funding && (
              <>
                <Text style={[type.label, { marginTop: space.lg }]}>Tasa de fondeo (funding)</Text>
                <Row
                  first
                  label="Tasa actual"
                  value={typeof fundingRate === 'number' ? `${fundingRate >= 0 ? '+' : ''}${fundingRate.toFixed(4)}%` : '—'}
                  color={fundingRate > 0 ? colors.danger : fundingRate < 0 ? colors.accent : undefined}
                />
                {fundingText && (
                  <Text style={[type.bodyDim, { color: fundingText.color, marginTop: space.xs }]}>{fundingText.text}</Text>
                )}
                <Help label="¿Qué es el fondeo?" style={{ marginTop: space.xs }}>{GLOSSARY.funding}</Help>
              </>
            )}

            <Text style={[type.label, { marginTop: space.lg }]}>Volumen negociado</Text>
            {!showVolumeProfile ? (
              <>
                <Button
                  label="Ver volumen"
                  kind="secondary"
                  onPress={() => setShowVolumeProfile(true)}
                  style={{ marginTop: space.md }}
                />
              </>
            ) : (
              <View style={{ marginTop: space.sm }}>
                <Segment
                  value={volumeTf}
                  onChange={setVolumeTf}
                  options={[{ key: '15m', label: '15 minutos' }, { key: '4h', label: '4 horas' }]}
                />

                {volumeLoading ? (
                  <View style={[styles.inlineLoading, { marginTop: space.md }]}>
                    <ActivityIndicator color={colors.textDim} size="small" />
                    <Text style={[type.bodyDim, { marginLeft: space.sm }]}>Cargando volumen…</Text>
                  </View>
                ) : volumeData ? (
                  <>
                    <Text
                      style={[type.bodyDim, {
                        marginTop: space.md,
                        color: summary?.dominant_side === 'compradora' ? BUY
                          : summary?.dominant_side === 'vendedora' ? SELL : colors.textDim,
                      }]}
                    >
                      {summary?.description || 'Sin datos'}
                    </Text>
                    <StatRow style={{ marginTop: space.md }}>
                      <Stat label="Compras" value={formatVolume(summary?.total_buy_volume)} color={BUY} />
                      <Stat label="Ventas" value={formatVolume(summary?.total_sell_volume)} color={SELL} />
                      <Stat
                        label="Diferencia"
                        value={`${summary?.net_delta > 0 ? '+' : summary?.net_delta < 0 ? '-' : ''}${formatVolume(Math.abs(summary?.net_delta || 0)).replace('$', '')}`}
                        color={summary?.dominant_side === 'equilibrada' ? colors.textDim : summary?.net_delta > 0 ? BUY : SELL}
                      />
                    </StatRow>

                    {profile.length > 0 && (
                      <View style={{ marginTop: space.lg }}>
                        <Text style={type.bodyDim}>Volumen por precio</Text>
                        <Text style={[type.small, { marginBottom: space.sm }]}>
                          Barras más largas = precios donde se negoció más.
                        </Text>
                        {profile.map((level, idx) => (
                          <View key={idx} style={styles.volBar}>
                            <Text style={styles.volBarPrice} numberOfLines={1}>{fmtPrice(level?.price)}</Text>
                            <View style={styles.volBarTrack}>
                              <View style={[styles.volBarFill, { backgroundColor: BUY, width: barWidth(level?.buy, level) }]} />
                              <View style={[styles.volBarFill, { backgroundColor: SELL, width: barWidth(level?.sell, level) }]} />
                            </View>
                          </View>
                        ))}
                        <View style={styles.legend}>
                          <View style={[styles.legendDot, { backgroundColor: BUY }]} />
                          <Text style={[type.small, { marginRight: space.lg }]}>Compras</Text>
                          <View style={[styles.legendDot, { backgroundColor: SELL }]} />
                          <Text style={type.small}>Ventas</Text>
                        </View>
                      </View>
                    )}

                    <Text style={[type.small, { marginTop: space.md }]}>
                      El volumen muestra lo que ya ocurrió, no lo que va a ocurrir. Úsalo como contexto, no como señal.
                    </Text>
                  </>
                ) : (
                  <Text style={[type.bodyDim, { marginTop: space.md }]}>No hay datos de volumen disponibles.</Text>
                )}

                <Button
                  label="Ocultar volumen"
                  kind="ghost"
                  small
                  onPress={() => setShowVolumeProfile(false)}
                  style={styles.ghostAction}
                />
              </View>
            )}
            </Collapsible>
          </Collapsible>

          {!!onRemove && (
            <Button label={`Quitar ${name} de mi lista`} kind="ghost" onPress={onRemove} />
          )}

          <Text style={styles.footnote}>
            {lastUpdate ? `Actualizado a las ${lastUpdate.toLocaleTimeString('es-ES')}. ` : ''}
            Solo futuros de Binance. Lectura automática que puede fallar; no es una recomendación de inversión.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 56 },
  mark: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, marginBottom: space.sm },
  bigChip: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  ghostAction: { alignSelf: 'flex-start', marginTop: space.sm, minHeight: 44, paddingHorizontal: 0 },
  reason: { flexDirection: 'row', marginBottom: space.xs },
  reasonDot: { width: 16, fontSize: 14, lineHeight: 20, color: colors.textMuted },
  exits: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  exitName: { color: colors.text, fontWeight: '700' },
  aiRow: { flexDirection: 'row', alignItems: 'center' },
  group: { marginTop: space.xl },
  subBox: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
  },
  subBoxTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  rowLine: { flexDirection: 'row', alignItems: 'center' },
  zoneLabel: { fontSize: 14, fontWeight: '600' },
  value: { color: colors.text, fontSize: 15, fontWeight: '600' },
  indicatorGrid: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  indicatorCol: { flex: 1 },
  indicatorColTitle: { color: colors.textDim, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  volBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  volBarPrice: { width: 78, color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  volBarTrack: {
    flex: 1, height: 12, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', backgroundColor: tint(colors.textMuted, 0.15),
  },
  volBarFill: { height: 12 },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  footnote: { ...type.small, textAlign: 'center', marginTop: space.md, paddingHorizontal: space.md },
});

export default PairDetailModal;

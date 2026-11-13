import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getUnifiedMarketData, getVolumeProfile, getAIExplanation } from '../services/api';
import { useSubscription } from '../context/SubscriptionContext';
import {
  colors, space, radius, type, tint,
  scenarioOf, trendOf, DIRECTION, GLOSSARY, pairName, fmtPrice,
} from '../theme';
import {
  ModalHeader, Card, SectionTitle, Chip, Button, Segment, Stat, StatRow, Row, Notice, Collapsible, Loading,
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
  oferta: { label: 'Zona de venta', color: colors.danger },
  demanda: { label: 'Zona de compra', color: colors.accent },
};
const zoneOf = (t) => ZONE[t] || { label: 'Zona actual', color: colors.textDim };

const BUY = colors.info;
const SELL = colors.warn;

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

const Bullet = ({ children, color = colors.textMuted }) => (
  <View style={styles.bullet}>
    <Text style={[styles.bulletDot, { color }]}>•</Text>
    <Text style={[type.bodyDim, { flex: 1 }]}>{children}</Text>
  </View>
);

const PairDetailModal = ({ visible, onClose, pair, data: initialData }) => {
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

  const scenario = scenarioOf(analysis?.scenario);
  const direction = DIRECTION[analysis?.direction_preference] || null;
  const bias = trendOf(analysis?.context?.htf_bias || analysis?.htf_bias);
  const momentum = trendOf(analysis?.timing?.ltf_momentum);
  const hasConfirmation = !!analysis?.timing?.has_confirmation;
  const rsiZoneKey = analysis?.timing?.rsi_zone || 'neutral';
  const rsiZone = RSI_ZONE[rsiZoneKey] || RSI_ZONE.neutral;
  const volatilityKey = analysis?.context?.volatility_state || analysis?.volatility_state || 'normal';
  const volatility = VOLATILITY[volatilityKey] || VOLATILITY.normal;
  const htfStructure = analysis?.context?.htf_structure || analysis?.htf_structure || null;

  const observations = Array.isArray(analysis?.observations) ? analysis.observations : [];
  const keyLevels = Array.isArray(analysis?.key_levels) ? analysis.key_levels : [];
  const zones = Array.isArray(analysis?.structural_zones) ? analysis.structural_zones.slice(0, 4) : [];
  const checklist = analysis?.checklist || null;
  const rsiState = analysis?.rsi_htf_state || null;
  const rsiStateStyle = rsiState ? RSI_STATE[rsiState.label] || RSI_STATE.agotamiento_potencial : null;
  const gap = data?.gap;
  const gapOpen = !!(gap?.exists && !gap?.filled);

  const fundingRate = funding?.funding_rate_percent;
  const fundingText =
    typeof fundingRate !== 'number' ? null
      : fundingRate > 0.05 ? { text: 'Muy positiva: hay mucha más gente comprada que vendida.', color: colors.danger }
      : fundingRate < -0.05 ? { text: 'Muy negativa: hay mucha más gente vendida que comprada.', color: colors.accent }
      : { text: 'En rango normal.', color: colors.textDim };

  const distanceTo = (level) =>
    typeof price === 'number' && price > 0 && typeof level === 'number' ? ((level - price) / price) * 100 : null;

  const checkRows = (group, allowWarning) =>
    Object.entries(group || {}).map(([key, item]) => {
      const warn = allowWarning && item?.warning;
      const color = warn ? colors.warn : item?.checked ? colors.accent : colors.textMuted;
      return (
        <View key={key} style={styles.checkItem}>
          <Text style={[styles.checkMark, { color }]}>{warn ? '!' : item?.checked ? '✓' : '×'}</Text>
          <Text style={[type.bodyDim, { flex: 1, color: item?.checked || warn ? colors.text : colors.textMuted }]}>
            {item?.label}
          </Text>
        </View>
      );
    });

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
          {/* 1. What to do now */}
          <SectionTitle>Qué hacer ahora</SectionTitle>
          <Card>
            <Chip label={scenario.label} color={scenario.color} solid style={styles.bigChip} />
            <Text style={[type.bodyDim, { marginTop: space.sm }]}>{scenario.help}</Text>

            <View style={styles.directionBox}>
              <Text style={type.small}>Dirección sugerida</Text>
              {direction ? (
                <Text style={[styles.direction, { color: direction.color }]}>
                  {direction.arrow} {direction.label}
                </Text>
              ) : (
                <Text style={[styles.direction, { color: colors.textDim }]}>Sin dirección clara</Text>
              )}
            </View>

            {!!analysis?.unified_reading && (
              <Text style={[type.body, { marginTop: space.md }]}>{analysis.unified_reading}</Text>
            )}
            {!!analysis?.scenario_reason && (
              <Text style={[type.bodyDim, { marginTop: space.sm }]}>{analysis.scenario_reason}</Text>
            )}
          </Card>

          {/* 2. AI explanation */}
          <SectionTitle>Explicación con IA</SectionTitle>
          <Card>
            {!showAIExplanation ? (
              <>
                <Text style={type.bodyDim}>
                  Un resumen en lenguaje sencillo de lo que está pasando con {name} y qué vigilar.
                </Text>
                <Button
                  label="Pedir explicación"
                  kind="secondary"
                  onPress={askAI}
                  style={{ marginTop: space.md }}
                />
                {!isPremium && typeof aiRemaining === 'number' && (
                  <Text style={[type.small, { marginTop: space.sm, textAlign: 'center' }]}>
                    {aiRemaining > 0
                      ? `Te quedan ${aiRemaining} explicaciones gratis.`
                      : 'Ya usaste tus explicaciones gratis. Con Premium no hay límite.'}
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
                {!!aiData.reason && <Chip label={capital(aiData.reason)} color={colors.info} style={{ marginBottom: space.sm }} />}
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
              <Notice tone="good" title="Todo apunta en la misma dirección" style={{ marginBottom: 0 }}>
                La IA no ve contradicciones relevantes entre la tendencia y el momento actual.
              </Notice>
            ) : null}
          </Card>

          {/* 3. Why */}
          <SectionTitle>Por qué</SectionTitle>
          <Card title="Tendencia de fondo (4 horas)">
            <Text style={[type.small, { marginBottom: space.sm }]}>{GLOSSARY.context}</Text>
            <Row first label="Tendencia" value={`${bias.arrow} ${bias.label}`} color={bias.color} />
            <Row
              label="Estructura"
              value={htfStructure ? capital(htfStructure) : 'Sin datos'}
              help={GLOSSARY.structure}
            />
            <Row label="Volatilidad" value={volatility.label} color={volatility.color} help={GLOSSARY.volatility} />
            {htfInd?.price_above_ema !== undefined && htfInd?.price_above_ema !== null && (
              <Row
                label="Precio frente a su media larga"
                value={htfInd.price_above_ema ? 'Por encima' : 'Por debajo'}
                color={htfInd.price_above_ema ? colors.accent : colors.danger}
                help="La media de las últimas 200 velas (EMA200). Por encima suele indicar tendencia alcista."
              />
            )}
            {rsiState && (
              <View style={styles.subBox}>
                <Text style={[styles.subBoxTitle, { color: rsiStateStyle.color }]}>{rsiStateStyle.label}</Text>
                {!!rsiState.description && <Text style={type.bodyDim}>{rsiState.description}</Text>}
              </View>
            )}
          </Card>

          <Card title="Momento de entrada (15 minutos)">
            <Text style={[type.small, { marginBottom: space.sm }]}>{GLOSSARY.timing}</Text>
            <Row first label="Fuerza" value={`${momentum.arrow} ${momentum.label}`} color={momentum.color} help={GLOSSARY.momentum} />
            <Row label="RSI" value={rsiZone.label} color={rsiZone.color} help={GLOSSARY.rsi} />
            <Row
              label="Confirmación"
              value={hasConfirmation ? 'Sí' : 'Todavía no'}
              color={hasConfirmation ? colors.accent : colors.textDim}
              help={GLOSSARY.confirmation}
            />
          </Card>

          {observations.length > 0 && (
            <Card title="A tener en cuenta">
              {observations.map((obs, idx) => (
                <Bullet key={idx}>{obs}</Bullet>
              ))}
            </Card>
          )}

          {checklist && (
            <Card title="Lista de comprobación">
              <Text style={[type.label, { marginBottom: space.xs }]}>Tendencia de fondo (4 h)</Text>
              {checkRows(checklist.context_4h, true)}
              <Text style={[type.label, { marginTop: space.md, marginBottom: space.xs }]}>Momento de entrada (15 min)</Text>
              {checkRows(checklist.timing_15m, false)}
              {!!checklist.summary && (
                <View style={styles.subBox}>
                  <Text style={type.bodyDim}>{checklist.summary}</Text>
                </View>
              )}
            </Card>
          )}

          {/* 4. Important levels */}
          <SectionTitle>Niveles importantes</SectionTitle>
          <Card>
            <Text style={[type.small, { marginBottom: space.sm }]}>{GLOSSARY.levels}</Text>

            {!!analysis?.distance_to_zone?.description && (
              <Notice
                tone={analysis.distance_to_zone.state === 'en_zona' || analysis.distance_to_zone.state === 'cercano' ? 'warn' : 'info'}
              >
                {analysis.distance_to_zone.description}
              </Notice>
            )}

            {keyLevels.map((level, idx) => {
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
                <View key={`z${idx}`} style={[styles.row, keyLevels.length === 0 && idx === 0 && { borderTopWidth: 0 }]}>
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
              <Text style={type.bodyDim}>No hay niveles cercanos destacados ahora mismo.</Text>
            )}
          </Card>

          <Card title="Hueco de precio pendiente">
            <Text style={[type.small, { marginBottom: space.sm }]}>
              Un tramo de precios por el que el mercado pasó sin negociar (velas diarias). A menudo el precio vuelve a visitarlo.
            </Text>
            {gapOpen ? (
              <>
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
              </>
            ) : (
              <Text style={type.bodyDim}>No hay ninguno abierto.</Text>
            )}
          </Card>

          {/* 5. Technical data */}
          <Collapsible title="Datos técnicos" hint="Indicadores, tasa de fondeo y volumen">
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
            <Text style={[type.small, { marginTop: space.sm }]}>{GLOSSARY.rsi}</Text>
            <Text style={[type.small, { marginTop: space.xs }]}>{GLOSSARY.volume}</Text>

            {funding && (
              <>
                <Text style={[type.label, { marginTop: space.lg }]}>Tasa de fondeo (funding)</Text>
                <Row
                  first
                  label="Tasa actual"
                  value={typeof fundingRate === 'number' ? `${fundingRate >= 0 ? '+' : ''}${fundingRate.toFixed(4)}%` : '—'}
                  color={fundingRate > 0 ? colors.danger : fundingRate < 0 ? colors.accent : undefined}
                  help={GLOSSARY.funding}
                />
                {fundingText && (
                  <Text style={[type.bodyDim, { color: fundingText.color, marginTop: space.xs }]}>{fundingText.text}</Text>
                )}
              </>
            )}

            <Text style={[type.label, { marginTop: space.lg }]}>Volumen negociado</Text>
            {!showVolumeProfile ? (
              <>
                <Text style={[type.small, { marginTop: space.xs }]}>
                  Cuánto se compró y se vendió, y a qué precios hubo más actividad.
                </Text>
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

          <Text style={styles.footnote}>
            {lastUpdate ? `Actualizado a las ${lastUpdate.toLocaleTimeString('es-ES')}. ` : ''}
            Esta información describe el estado actual del mercado. No es una recomendación de inversión.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 56 },
  bigChip: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  directionBox: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
  },
  direction: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  ghostAction: { alignSelf: 'flex-start', marginTop: space.sm, minHeight: 44, paddingHorizontal: 0 },
  bullet: { flexDirection: 'row', marginBottom: space.sm },
  bulletDot: { width: 16, fontSize: 14, lineHeight: 20 },
  subBox: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
  },
  subBoxTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  checkItem: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
  checkMark: { width: 22, fontSize: 15, fontWeight: '700', lineHeight: 20 },
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

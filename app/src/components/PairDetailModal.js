import React from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

// Scenario classification styles
const SCENARIO_STYLES = {
  favorable: { label: 'Favorable', color: '#00d4aa', bg: '#00d4aa20', desc: 'Contexto alineado, buena zona de entrada' },
  operable: { label: 'Operable', color: '#ffd93d', bg: '#ffd93d20', desc: 'Contexto presente pero entrada no ideal' },
  alto_riesgo: { label: 'Alto Riesgo', color: '#ff4757', bg: '#ff475720', desc: 'Multiples senales conflictivas' },
  espera: { label: 'Espera', color: '#888', bg: '#88888820', desc: 'Sin sesgo claro, esperar confirmacion' },
};

// HTF bias styles
const BIAS_STYLES = {
  alcista: { label: 'Alcista', color: '#00d4aa', icon: '↑' },
  bajista: { label: 'Bajista', color: '#ff4757', icon: '↓' },
  mixto: { label: 'Mixto', color: '#ffd93d', icon: '↔' },
  neutral: { label: 'Neutral', color: '#888', icon: '−' },
};

// Signal bars component (like iOS WiFi indicator)
const SignalBars = ({ level, color = '#fff', size = 12 }) => {
  const barWidth = size / 4;
  const gap = size / 8;
  const heights = [size * 0.4, size * 0.7, size];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: size, gap: gap }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: barWidth,
            height: heights[i],
            backgroundColor: i < level ? color : '#444',
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
};

const TRADING_MODE_CONFIG = {
  conservative: { label: 'Conservador', level: 1, color: '#00d4aa', description: 'Solo señales Óptimas (≥2.5 pts)' },
  balanced: { label: 'Balanceado', level: 2, color: '#ffd93d', description: 'Óptimas + Buenas (≥1.5 pts)' },
  aggressive: { label: 'Agresivo', level: 3, color: '#ff9f43', description: 'Todas las señales' },
};

const PairDetailModal = ({ visible, onClose, pair, data, subscription }) => {
  if (!data || !data.indicators) {
    return (
      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.container}>
            <Text style={styles.title}>{pair}</Text>
            <Text style={styles.noData}>Sin datos disponibles</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const ind = data.indicators;
  const funding = data.funding;
  const analysis = data.analysis;

  // Get scenario and bias styles
  const scenario = analysis?.scenario || 'espera';
  const scenarioStyle = SCENARIO_STYLES[scenario] || SCENARIO_STYLES.espera;
  const htfBias = analysis?.htf_bias || 'neutral';
  const biasStyle = BIAS_STYLES[htfBias] || BIAS_STYLES.neutral;
  const directionPref = analysis?.direction_preference;

  // Funding helpers
  const getFundingWarning = () => {
    if (!funding) return null;

    if (funding.sentiment === 'too_many_longs') {
      return {
        emoji: '⚠️',
        title: 'Precaución con LONG',
        text: 'Funding muy positivo indica demasiados longs. Riesgo de dump/liquidaciones en cascada.',
        color: '#ff4757',
        bgColor: 'rgba(255, 71, 87, 0.1)',
      };
    }
    if (funding.sentiment === 'too_many_shorts') {
      return {
        emoji: '⚠️',
        title: 'Precaución con SHORT',
        text: 'Funding muy negativo indica demasiados shorts. Riesgo de short squeeze.',
        color: '#00d4aa',
        bgColor: 'rgba(0, 212, 170, 0.1)',
      };
    }
    return null;
  };

  const fundingWarning = getFundingWarning();

  // Determine actual RSI direction for display
  const rsiDirection = ind.rsi_rising ? '↑ Subiendo' : (ind.rsi_falling ? '↓ Bajando' : '→ Estable');

  // BASE conditions (2 required for signal)
  const longBase = {
    ema: {
      label: 'Precio > EMA200',
      met: ind.price_above_ema,
      detail: `$${ind.price?.toLocaleString()} vs $${ind.ema_200?.toFixed(0)}`,
    },
    rsiDirection: {
      label: 'RSI subiendo',
      met: ind.rsi_rising,
      detail: rsiDirection,
    },
  };

  const shortBase = {
    ema: {
      label: 'Precio < EMA200',
      met: !ind.price_above_ema,
      detail: `$${ind.price?.toLocaleString()} vs $${ind.ema_200?.toFixed(0)}`,
    },
    rsiDirection: {
      label: 'RSI bajando',
      met: ind.rsi_falling,
      detail: rsiDirection,
    },
  };

  // QUALITY factors (contribute to score)
  const qualityFactors = {
    rsiZoneLong: {
      label: 'RSI en zona de compra (<40)',
      met: ind.rsi < 40,
      points: 1,
      detail: `RSI: ${ind.rsi?.toFixed(1)}`,
      forLong: true,
    },
    rsiZoneShort: {
      label: 'RSI en zona de venta (>60)',
      met: ind.rsi > 60,
      points: 1,
      detail: `RSI: ${ind.rsi?.toFixed(1)}`,
      forLong: false,
    },
    macdLong: {
      label: 'MACD cruce alcista',
      met: ind.macd_crossover_bullish,
      points: 1,
      detail: `Hist: ${ind.macd_histogram?.toFixed(4)}`,
      forLong: true,
    },
    macdShort: {
      label: 'MACD cruce bajista',
      met: ind.macd_crossover_bearish,
      points: 1,
      detail: `Hist: ${ind.macd_histogram?.toFixed(4)}`,
      forLong: false,
    },
    volume: {
      label: 'Volumen > promedio',
      met: ind.volume_above_average,
      points: 1,
      detail: `Ratio: ${ind.volume_ratio?.toFixed(2)}x`,
      forLong: null, // applies to both
    },
    fundingLong: {
      label: 'Funding favorece LONG',
      met: funding?.sentiment === 'too_many_shorts',
      points: 0.5,
      detail: funding ? `${funding.funding_rate_percent?.toFixed(4)}%` : 'N/A',
      forLong: true,
    },
    fundingShort: {
      label: 'Funding favorece SHORT',
      met: funding?.sentiment === 'too_many_longs',
      points: 0.5,
      detail: funding ? `${funding.funding_rate_percent?.toFixed(4)}%` : 'N/A',
      forLong: false,
    },
    fiboKey: {
      label: 'En nivel Fibonacci clave',
      met: ind.fibonacci?.at_key_level,
      points: 0.5,
      detail: ind.fibonacci?.closest_level_name ? `Nivel ${ind.fibonacci.closest_level_name}%` : 'N/A',
      forLong: null,
    },
    fiboNear: {
      label: 'Cerca de nivel Fibonacci',
      met: ind.fibonacci?.near_key_level && !ind.fibonacci?.at_key_level,
      points: 0.25,
      detail: ind.fibonacci?.closest_level_name ? `Nivel ${ind.fibonacci.closest_level_name}%` : 'N/A',
      forLong: null,
    },
  };

  // Calculate if base conditions are met
  const longBaseMet = Object.values(longBase).filter(c => c.met).length;
  const shortBaseMet = Object.values(shortBase).filter(c => c.met).length;
  const isLongSignal = longBaseMet === 2;
  const isShortSignal = shortBaseMet === 2;

  // Calculate scores
  const calculateScore = (forLong) => {
    let score = 0;
    Object.values(qualityFactors).forEach(f => {
      if (f.met && (f.forLong === forLong || f.forLong === null)) {
        score += f.points;
      }
    });
    return score;
  };

  const longScore = calculateScore(true);
  const shortScore = calculateScore(false);

  const getQualityLabel = (score) => {
    if (score >= 2.5) return { label: 'Óptima', color: '#00d4aa', emoji: '✅' };
    if (score >= 1.5) return { label: 'Buena', color: '#ffd93d', emoji: '' };
    return { label: 'Alto Riesgo', color: '#ff4757', emoji: '' };
  };

  const renderBaseCondition = (condition, key, color) => (
    <View key={key} style={styles.baseConditionRow}>
      <Text style={[styles.baseConditionIcon, { color: condition.met ? color : '#666' }]}>
        {condition.met ? '✓' : '○'}
      </Text>
      <View style={styles.baseConditionContent}>
        <Text style={[styles.baseConditionLabel, condition.met && { color }]}>
          {condition.label}
        </Text>
        <Text style={styles.baseConditionDetail}>{condition.detail}</Text>
      </View>
    </View>
  );

  const renderQualityFactor = (factor, key) => (
    <View key={key} style={styles.qualityFactorRow}>
      <Text style={[styles.qualityFactorIcon, { color: factor.met ? '#00d4aa' : '#444' }]}>
        {factor.met ? '✓' : '○'}
      </Text>
      <Text style={[styles.qualityFactorLabel, factor.met && styles.qualityFactorLabelMet]}>
        {factor.label}
      </Text>
      <Text style={styles.qualityFactorPoints}>
        {factor.met ? `+${factor.points}` : ''}
      </Text>
    </View>
  );

  const renderSignalStatus = (baseMet, isSignal, score, type) => {
    const color = type === 'LONG' ? '#00d4aa' : '#ff4757';
    const quality = getQualityLabel(score);

    return (
      <View style={styles.signalStatusContainer}>
        <View style={[styles.signalStatusBadge, {
          backgroundColor: isSignal ? color + '20' : '#2a2a4a',
          borderColor: isSignal ? color : '#444'
        }]}>
          <Text style={[styles.signalStatusText, { color: isSignal ? color : '#666' }]}>
            {isSignal ? `${type === 'LONG' ? '🟢' : '🔴'} SEÑAL ACTIVA` : `Sin señal (${baseMet}/2 base)`}
          </Text>
        </View>
        {isSignal && (
          <View style={[styles.qualityBadge, { backgroundColor: quality.color + '20', borderColor: quality.color }]}>
            <Text style={[styles.qualityBadgeText, { color: quality.color }]}>
              {quality.emoji} {quality.label} ({score.toFixed(1)} pts)
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{pair}</Text>
            <Text style={styles.price}>${ind.price?.toLocaleString()}</Text>
            <View style={styles.headerBadges}>
              <Text style={styles.timeframe}>{data.timeframe}</Text>
              <View style={[styles.signalBadge, { backgroundColor: scenarioStyle.bg, borderColor: scenarioStyle.color }]}>
                <Text style={[styles.signalBadgeText, { color: scenarioStyle.color }]}>
                  {scenarioStyle.label.toUpperCase()}
                  {directionPref && ` ${directionPref.toUpperCase()}`}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* 3-Layer Analysis Summary */}
            {analysis && (
              <View style={styles.analysisSection}>
                {/* Scenario Classification */}
                <View style={[styles.scenarioBox, { backgroundColor: scenarioStyle.bg, borderColor: scenarioStyle.color }]}>
                  <View style={styles.scenarioBoxHeader}>
                    <Text style={[styles.scenarioBoxLabel, { color: scenarioStyle.color }]}>
                      {scenarioStyle.label.toUpperCase()}
                    </Text>
                    {directionPref && (
                      <View style={[styles.directionBadge, {
                        backgroundColor: directionPref === 'long' ? '#00d4aa30' : '#ff475730',
                        borderColor: directionPref === 'long' ? '#00d4aa' : '#ff4757',
                      }]}>
                        <Text style={[styles.directionText, {
                          color: directionPref === 'long' ? '#00d4aa' : '#ff4757'
                        }]}>
                          {directionPref.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.scenarioReason}>{analysis.scenario_reason}</Text>
                </View>

                {/* HTF Context Row */}
                <View style={styles.htfContextRow}>
                  <View style={styles.htfContextItem}>
                    <Text style={styles.htfContextLabel}>Sesgo HTF</Text>
                    <View style={[styles.htfBiasBadge, { borderColor: biasStyle.color }]}>
                      <Text style={[styles.htfBiasText, { color: biasStyle.color }]}>
                        {biasStyle.icon} {biasStyle.label}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.htfContextItem}>
                    <Text style={styles.htfContextLabel}>Estructura</Text>
                    <Text style={styles.htfContextValue}>
                      {analysis.htf_structure?.replace(/_/g, ' ') || 'Sin datos'}
                    </Text>
                  </View>
                  <View style={styles.htfContextItem}>
                    <Text style={styles.htfContextLabel}>Volatilidad</Text>
                    <Text style={[styles.htfContextValue, {
                      color: analysis.volatility_state === 'alta' ? '#ff4757' :
                             analysis.volatility_state === 'baja' ? '#ffd93d' : '#888'
                    }]}>
                      {analysis.volatility_state?.charAt(0).toUpperCase() + analysis.volatility_state?.slice(1)}
                    </Text>
                  </View>
                </View>

                {/* Price Interpretation */}
                {analysis.price_interpretation && (
                  <View style={styles.priceInterpBox}>
                    <Text style={styles.priceInterpText}>
                      {analysis.price_interpretation}
                    </Text>
                  </View>
                )}

                {/* Observations */}
                {analysis.observations && analysis.observations.length > 0 && (
                  <View style={styles.observationsBox}>
                    <Text style={styles.observationsTitle}>Observaciones</Text>
                    {analysis.observations.map((obs, idx) => (
                      <View key={idx} style={styles.observationRow}>
                        <Text style={styles.observationBullet}>•</Text>
                        <Text style={styles.observationText}>{obs}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Subscription Alert Mode */}
            {subscription && (
              <View style={styles.alertModeSection}>
                <Text style={styles.alertModeLabel}>🔔 Modo de Alertas</Text>
                <View style={[
                  styles.alertModeBadge,
                  { backgroundColor: TRADING_MODE_CONFIG[subscription.trading_mode]?.color + '20',
                    borderColor: TRADING_MODE_CONFIG[subscription.trading_mode]?.color }
                ]}>
                  <View style={styles.alertModeEmoji}>
                    <SignalBars
                      level={TRADING_MODE_CONFIG[subscription.trading_mode]?.level || 2}
                      color={TRADING_MODE_CONFIG[subscription.trading_mode]?.color}
                      size={24}
                    />
                  </View>
                  <View>
                    <Text style={[styles.alertModeText, { color: TRADING_MODE_CONFIG[subscription.trading_mode]?.color }]}>
                      {TRADING_MODE_CONFIG[subscription.trading_mode]?.label}
                    </Text>
                    <Text style={styles.alertModeDesc}>
                      {TRADING_MODE_CONFIG[subscription.trading_mode]?.description}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Tasa de Fondeo Warning */}
            {fundingWarning && (
              <View style={[styles.warningBox, { backgroundColor: fundingWarning.bgColor, borderColor: fundingWarning.color }]}>
                <Text style={styles.warningEmoji}>{fundingWarning.emoji}</Text>
                <View style={styles.warningContent}>
                  <Text style={[styles.warningTitle, { color: fundingWarning.color }]}>{fundingWarning.title}</Text>
                  <Text style={styles.warningText}>{fundingWarning.text}</Text>
                </View>
              </View>
            )}

            {/* Tasa de Fondeo Section */}
            {funding && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📊 Tasa de Fondeo</Text>
                <View style={styles.fundingBox}>
                  <View style={styles.fundingRow}>
                    <Text style={styles.fundingLabel}>Tasa actual:</Text>
                    <Text style={[
                      styles.fundingValue,
                      { color: funding.funding_rate_percent > 0 ? '#ff4757' : funding.funding_rate_percent < 0 ? '#00d4aa' : '#888' }
                    ]}>
                      {funding.funding_rate_percent >= 0 ? '+' : ''}{funding.funding_rate_percent?.toFixed(4)}%
                    </Text>
                  </View>
                  <View style={styles.fundingRow}>
                    <Text style={styles.fundingLabel}>Sentimiento:</Text>
                    <Text style={styles.fundingValue}>{funding.sentiment?.replace(/_/g, ' ')}</Text>
                  </View>
                  <View style={styles.fundingRecommendation}>
                    <Text style={styles.fundingRecLabel}>Recomendación:</Text>
                    <Text style={styles.fundingRecText}>{funding.recommendation}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* LONG Signal Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🟢 LONG</Text>
              {renderSignalStatus(longBaseMet, isLongSignal, longScore, 'LONG')}

              <Text style={styles.subsectionTitle}>Condiciones Base (2 requeridas)</Text>
              <View style={styles.baseConditionsBox}>
                {Object.entries(longBase).map(([key, condition]) =>
                  renderBaseCondition(condition, `long-base-${key}`, '#00d4aa')
                )}
              </View>

              {isLongSignal && (
                <>
                  <Text style={styles.subsectionTitle}>Factores de Calidad</Text>
                  <View style={styles.qualityFactorsBox}>
                    {Object.entries(qualityFactors)
                      .filter(([_, f]) => f.forLong === true || f.forLong === null)
                      .map(([key, factor]) => renderQualityFactor(factor, `long-quality-${key}`))}
                  </View>
                </>
              )}
            </View>

            {/* SHORT Signal Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔴 SHORT</Text>
              {renderSignalStatus(shortBaseMet, isShortSignal, shortScore, 'SHORT')}

              <Text style={styles.subsectionTitle}>Condiciones Base (2 requeridas)</Text>
              <View style={styles.baseConditionsBox}>
                {Object.entries(shortBase).map(([key, condition]) =>
                  renderBaseCondition(condition, `short-base-${key}`, '#ff4757')
                )}
              </View>

              {isShortSignal && (
                <>
                  <Text style={styles.subsectionTitle}>Factores de Calidad</Text>
                  <View style={styles.qualityFactorsBox}>
                    {Object.entries(qualityFactors)
                      .filter(([_, f]) => f.forLong === false || f.forLong === null)
                      .map(([key, factor]) => renderQualityFactor(factor, `short-quality-${key}`))}
                  </View>
                </>
              )}
            </View>

            {/* Fibonacci Levels - Informativo */}
            {ind.fibonacci && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📐 Niveles Fibonacci</Text>
                <View style={styles.fiboBox}>
                  <View style={styles.fiboInfoRow}>
                    <Text style={styles.fiboInfoLabel}>Tendencia (50 velas):</Text>
                    <Text style={[styles.fiboInfoValue, { color: ind.fibonacci.is_uptrend ? '#00d4aa' : '#ff4757' }]}>
                      {ind.fibonacci.is_uptrend ? 'Alcista' : 'Bajista'}
                    </Text>
                  </View>

                  <View style={styles.fiboLevelsContainer}>
                    <Text style={styles.fiboLevelsTitle}>Niveles:</Text>
                    {ind.fibonacci.levels && Object.entries(ind.fibonacci.levels)
                      .sort(([,a], [,b]) => b - a)
                      .map(([name, level]) => {
                        const isClosest = name === ind.fibonacci.closest_level_name;
                        const isCurrent = Math.abs(ind.price - level) / ind.price < 0.005;
                        return (
                          <View key={name} style={[styles.fiboLevelRow, isClosest && styles.fiboLevelRowActive]}>
                            <Text style={[styles.fiboLevelName, isClosest && styles.fiboLevelNameActive]}>
                              {name}%
                            </Text>
                            <View style={styles.fiboLevelBar}>
                              {isCurrent && <View style={styles.fiboCurrentMarker} />}
                            </View>
                            <Text style={[styles.fiboLevelPrice, isClosest && styles.fiboLevelPriceActive]}>
                              ${level?.toLocaleString(undefined, {maximumFractionDigits: 2})}
                            </Text>
                          </View>
                        );
                      })}
                  </View>

                  <View style={styles.fiboSwingInfo}>
                    <Text style={styles.fiboSwingText}>
                      Swing High: ${ind.fibonacci.swing_high?.toLocaleString()}
                    </Text>
                    <Text style={styles.fiboSwingText}>
                      Swing Low: ${ind.fibonacci.swing_low?.toLocaleString()}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Raw Indicators */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Indicadores</Text>
              <View style={styles.indicatorGrid}>
                <View style={styles.indicatorItem}>
                  <Text style={styles.indicatorLabel}>EMA 200</Text>
                  <Text style={styles.indicatorValue}>${ind.ema_200?.toFixed(2)}</Text>
                </View>
                <View style={styles.indicatorItem}>
                  <Text style={styles.indicatorLabel}>RSI (14)</Text>
                  <Text style={[
                    styles.indicatorValue,
                    ind.rsi < 40 ? styles.oversold : ind.rsi > 60 ? styles.overbought : null
                  ]}>
                    {ind.rsi?.toFixed(1)}
                  </Text>
                </View>
                <View style={styles.indicatorItem}>
                  <Text style={styles.indicatorLabel}>MACD</Text>
                  <Text style={styles.indicatorValue}>{ind.macd_line?.toFixed(4)}</Text>
                </View>
                <View style={styles.indicatorItem}>
                  <Text style={styles.indicatorLabel}>MACD Signal</Text>
                  <Text style={styles.indicatorValue}>{ind.macd_signal?.toFixed(4)}</Text>
                </View>
                <View style={styles.indicatorItem}>
                  <Text style={styles.indicatorLabel}>Histograma</Text>
                  <Text style={[
                    styles.indicatorValue,
                    ind.macd_histogram > 0 ? styles.positive : styles.negative
                  ]}>
                    {ind.macd_histogram?.toFixed(4)}
                  </Text>
                </View>
                <View style={styles.indicatorItem}>
                  <Text style={styles.indicatorLabel}>Vol. Ratio</Text>
                  <Text style={[
                    styles.indicatorValue,
                    ind.volume_above_average ? styles.positive : null
                  ]}>
                    {ind.volume_ratio?.toFixed(2)}x
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  price: {
    color: '#00d4aa',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 8,
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  timeframe: {
    color: '#888',
    fontSize: 14,
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  signalBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  signalBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  noSignalBadge: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  noSignalBadgeText: {
    color: '#666',
    fontSize: 13,
  },
  analysisSection: {
    marginBottom: 20,
  },
  scenarioBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  scenarioBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  scenarioBoxLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  scenarioReason: {
    color: '#aaa',
    fontSize: 14,
  },
  directionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  directionText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  htfContextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#151525',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  htfContextItem: {
    alignItems: 'center',
    flex: 1,
  },
  htfContextLabel: {
    color: '#666',
    fontSize: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  htfBiasBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  htfBiasText: {
    fontSize: 13,
    fontWeight: '600',
  },
  htfContextValue: {
    color: '#aaa',
    fontSize: 13,
    textTransform: 'capitalize',
  },
  priceInterpBox: {
    backgroundColor: '#1a1a30',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  priceInterpText: {
    color: '#ccc',
    fontSize: 14,
    fontStyle: 'italic',
  },
  observationsBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 12,
  },
  observationsTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  observationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  observationBullet: {
    color: '#666',
    fontSize: 12,
    marginRight: 8,
    marginTop: 1,
  },
  observationText: {
    color: '#999',
    fontSize: 13,
    flex: 1,
  },
  alertModeSection: {
    marginBottom: 16,
  },
  alertModeLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  alertModeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  alertModeEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  alertModeText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  alertModeDesc: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  subsectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  signalStatusContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  signalStatusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  signalStatusText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  qualityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  qualityBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  baseConditionsBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 12,
  },
  baseConditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  baseConditionIcon: {
    fontSize: 18,
    fontWeight: 'bold',
    width: 28,
  },
  baseConditionContent: {
    flex: 1,
  },
  baseConditionLabel: {
    color: '#ccc',
    fontSize: 15,
    fontWeight: '500',
  },
  baseConditionDetail: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  qualityFactorsBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 12,
  },
  qualityFactorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  qualityFactorIcon: {
    fontSize: 14,
    width: 24,
  },
  qualityFactorLabel: {
    color: '#666',
    fontSize: 13,
    flex: 1,
  },
  qualityFactorLabelMet: {
    color: '#aaa',
  },
  qualityFactorPoints: {
    color: '#00d4aa',
    fontSize: 13,
    fontWeight: 'bold',
    width: 40,
    textAlign: 'right',
  },
  indicatorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  indicatorItem: {
    width: '50%',
    paddingVertical: 8,
    paddingRight: 8,
  },
  indicatorLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 2,
  },
  indicatorValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  oversold: {
    color: '#00d4aa',
  },
  overbought: {
    color: '#ff4757',
  },
  positive: {
    color: '#00d4aa',
  },
  negative: {
    color: '#ff4757',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  warningEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  warningText: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
  },
  fundingBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
  },
  fundingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fundingLabel: {
    color: '#888',
    fontSize: 14,
  },
  fundingValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fundingRecommendation: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  fundingRecLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  fundingRecText: {
    color: '#00d4aa',
    fontSize: 14,
    fontWeight: '600',
  },
  fiboBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
  },
  fiboRecommendationBanner: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    alignItems: 'center',
  },
  fiboRecPosition: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  fiboRecSubtitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  fiboRecQuality: {
    fontSize: 14,
    fontWeight: '600',
  },
  tradeSetupBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  tradeSetupTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  tradeSetupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  tradeSetupLabel: {
    color: '#888',
    fontSize: 13,
    flex: 1,
  },
  tradeSetupValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  tradeSetupPercent: {
    fontSize: 12,
    fontWeight: '600',
  },
  tradeSetupRatio: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  tradeSetupRatioLabel: {
    color: '#888',
    fontSize: 13,
    marginRight: 8,
  },
  tradeSetupRatioValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  tradeSetupNote: {
    color: '#666',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
  },
  fiboInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fiboInfoLabel: {
    color: '#888',
    fontSize: 14,
  },
  fiboInfoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  fiboRec: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 16,
    padding: 10,
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
  },
  fiboLevelsContainer: {
    marginTop: 8,
  },
  fiboLevelsTitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  fiboLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  fiboLevelRowActive: {
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
  },
  fiboLevelName: {
    color: '#666',
    fontSize: 13,
    width: 50,
  },
  fiboLevelNameActive: {
    color: '#00d4aa',
    fontWeight: 'bold',
  },
  fiboLevelBar: {
    flex: 1,
    height: 2,
    backgroundColor: '#2a2a4a',
    marginHorizontal: 10,
    position: 'relative',
  },
  fiboCurrentMarker: {
    position: 'absolute',
    width: 8,
    height: 8,
    backgroundColor: '#00d4aa',
    borderRadius: 4,
    top: -3,
    left: '50%',
  },
  fiboLevelPrice: {
    color: '#888',
    fontSize: 13,
    textAlign: 'right',
    width: 100,
  },
  fiboLevelPriceActive: {
    color: '#00d4aa',
    fontWeight: 'bold',
  },
  fiboSwingInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  fiboSwingText: {
    color: '#666',
    fontSize: 11,
  },
  closeButton: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#2a2a4a',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  noData: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    padding: 40,
  },
});

export default PairDetailModal;

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

const PairDetailModal = ({ visible, onClose, pair, data }) => {
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
      detail: ind.rsi_rising ? '↑ Subiendo' : '↓ Bajando',
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
      detail: ind.rsi_falling ? '↓ Bajando' : '↑ Subiendo',
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
    if (score >= 2.5) return { label: 'Mejor momento', color: '#00d4aa', emoji: '🔥' };
    if (score >= 1.5) return { label: 'Operable', color: '#ffd93d', emoji: '🟡' };
    return { label: 'Alto Riesgo', color: '#ff4757', emoji: '⚠️' };
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
            <Text style={styles.timeframe}>{data.timeframe}</Text>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Funding Rate Warning */}
            {fundingWarning && (
              <View style={[styles.warningBox, { backgroundColor: fundingWarning.bgColor, borderColor: fundingWarning.color }]}>
                <Text style={styles.warningEmoji}>{fundingWarning.emoji}</Text>
                <View style={styles.warningContent}>
                  <Text style={[styles.warningTitle, { color: fundingWarning.color }]}>{fundingWarning.title}</Text>
                  <Text style={styles.warningText}>{fundingWarning.text}</Text>
                </View>
              </View>
            )}

            {/* Funding Rate Section */}
            {funding && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📊 Funding Rate</Text>
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

            {/* Fibonacci Levels */}
            {ind.fibonacci && (() => {
              // Use indicator signals to determine direction, not just Fibonacci trend
              const fiboIsLong = longBaseMet >= shortBaseMet;

              return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📐 Análisis Fibonacci</Text>
                <View style={styles.fiboBox}>
                  {/* Recommendation Banner - based on indicators, not Fibo trend */}
                  <View style={[styles.fiboRecommendationBanner, {
                    backgroundColor: fiboIsLong ? 'rgba(0, 212, 170, 0.15)' : 'rgba(255, 71, 87, 0.15)',
                    borderColor: fiboIsLong ? '#00d4aa' : '#ff4757'
                  }]}>
                    <Text style={[styles.fiboRecPosition, { color: fiboIsLong ? '#00d4aa' : '#ff4757' }]}>
                      {fiboIsLong ? '📈 Setup LONG' : '📉 Setup SHORT'}
                    </Text>
                    <Text style={styles.fiboRecSubtitle}>
                      Basado en condiciones base ({fiboIsLong ? longBaseMet : shortBaseMet}/2)
                    </Text>
                    <Text style={[styles.fiboRecQuality, {
                      color: ind.fibonacci.entry_quality === 'optimal' ? '#00d4aa' :
                             ind.fibonacci.entry_quality === 'good' ? '#ffd93d' : '#ff9f43'
                    }]}>
                      {ind.fibonacci.entry_quality === 'optimal' ? '🔥 Entrada Óptima' :
                       ind.fibonacci.entry_quality === 'good' ? '🟡 Entrada Buena' : '⚡ Entrada Temprana'}
                    </Text>
                  </View>

                  {/* Trade Setup Based on Fibonacci */}
                  {ind.fibonacci.levels && (() => {
                    const levels = Object.entries(ind.fibonacci.levels)
                      .map(([name, price]) => ({ name, price }))
                      .sort((a, b) => a.price - b.price);

                    const currentPrice = ind.price;
                    const isLong = fiboIsLong;

                    // Find levels above and below current price
                    const levelsBelow = levels.filter(l => l.price < currentPrice);
                    const levelsAbove = levels.filter(l => l.price > currentPrice);

                    let entry, stopLoss, takeProfit;

                    if (isLong) {
                      // LONG: Entry at support, SL below, TP above
                      entry = levelsBelow.length > 0 ? levelsBelow[levelsBelow.length - 1] : null;
                      stopLoss = levelsBelow.length > 1 ? levelsBelow[levelsBelow.length - 2] : null;
                      takeProfit = levelsAbove.length > 1 ? levelsAbove[1] : (levelsAbove.length > 0 ? levelsAbove[0] : null);
                    } else {
                      // SHORT: Entry at resistance, SL above, TP below
                      entry = levelsAbove.length > 0 ? levelsAbove[0] : null;
                      stopLoss = levelsAbove.length > 1 ? levelsAbove[1] : null;
                      takeProfit = levelsBelow.length > 1 ? levelsBelow[levelsBelow.length - 2] : (levelsBelow.length > 0 ? levelsBelow[levelsBelow.length - 1] : null);
                    }

                    // Calculate percentages
                    const slPercent = stopLoss && entry ? Math.abs((stopLoss.price - entry.price) / entry.price * 100) : null;
                    const tpPercent = takeProfit && entry ? Math.abs((takeProfit.price - entry.price) / entry.price * 100) : null;
                    const riskReward = slPercent && tpPercent ? (tpPercent / slPercent).toFixed(1) : null;

                    return (
                      <View style={styles.tradeSetupBox}>
                        <Text style={styles.tradeSetupTitle}>
                          {isLong ? '🟢 Setup LONG' : '🔴 Setup SHORT'}
                        </Text>

                        <View style={styles.tradeSetupRow}>
                          <Text style={styles.tradeSetupLabel}>📍 Entrada (Fibo {entry?.name}%):</Text>
                          <Text style={styles.tradeSetupValue}>
                            ${entry?.price?.toLocaleString(undefined, {maximumFractionDigits: 2}) || 'N/A'}
                          </Text>
                        </View>

                        <View style={styles.tradeSetupRow}>
                          <Text style={styles.tradeSetupLabel}>🎯 Take Profit (Fibo {takeProfit?.name}%):</Text>
                          <Text style={[styles.tradeSetupValue, { color: '#00d4aa' }]}>
                            ${takeProfit?.price?.toLocaleString(undefined, {maximumFractionDigits: 2}) || 'N/A'}
                            {tpPercent && <Text style={styles.tradeSetupPercent}> (+{tpPercent.toFixed(1)}%)</Text>}
                          </Text>
                        </View>

                        <View style={styles.tradeSetupRow}>
                          <Text style={styles.tradeSetupLabel}>🛑 Stop Loss (Fibo {stopLoss?.name}%):</Text>
                          <Text style={[styles.tradeSetupValue, { color: '#ff4757' }]}>
                            ${stopLoss?.price?.toLocaleString(undefined, {maximumFractionDigits: 2}) || 'N/A'}
                            {slPercent && <Text style={styles.tradeSetupPercent}> (-{slPercent.toFixed(1)}%)</Text>}
                          </Text>
                        </View>

                        {riskReward && (
                          <View style={styles.tradeSetupRatio}>
                            <Text style={styles.tradeSetupRatioLabel}>Riesgo/Beneficio:</Text>
                            <Text style={[styles.tradeSetupRatioValue, {
                              color: parseFloat(riskReward) >= 2 ? '#00d4aa' : parseFloat(riskReward) >= 1.5 ? '#ffd93d' : '#ff9f43'
                            }]}>
                              1:{riskReward}
                            </Text>
                          </View>
                        )}

                        <Text style={styles.tradeSetupNote}>
                          Precio actual: ${currentPrice?.toLocaleString(undefined, {maximumFractionDigits: 2})}
                        </Text>
                      </View>
                    );
                  })()}

                  <View style={styles.fiboInfoRow}>
                    <Text style={styles.fiboInfoLabel}>Tendencia (50 velas):</Text>
                    <Text style={[styles.fiboInfoValue, { color: ind.fibonacci.is_uptrend ? '#00d4aa' : '#ff4757' }]}>
                      {ind.fibonacci.is_uptrend ? 'Alcista' : 'Bajista'}
                    </Text>
                  </View>
                  <View style={styles.fiboInfoRow}>
                    <Text style={styles.fiboInfoLabel}>Niveles Fibo actúan como:</Text>
                    <Text style={styles.fiboInfoValue}>
                      {ind.fibonacci.is_uptrend ? 'Soporte' : 'Resistencia'}
                    </Text>
                  </View>
                  <Text style={styles.fiboRec}>{ind.fibonacci.recommendation}</Text>

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
              );
            })()}

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
  timeframe: {
    color: '#888',
    fontSize: 14,
    marginTop: 4,
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

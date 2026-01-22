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

  // Calculate signal proximity for LONG
  const longConditions = {
    ema: {
      label: 'Precio > EMA200',
      met: ind.price_above_ema,
      value: ind.price,
      target: ind.ema_200,
      progress: ind.price_above_ema ? 100 : Math.min(99, (ind.price / ind.ema_200) * 100),
      detail: `$${ind.price?.toLocaleString()} / $${ind.ema_200?.toFixed(2)}`,
    },
    rsi: {
      label: 'RSI < 40 (sobreventa)',
      met: ind.rsi < 40,
      value: ind.rsi,
      target: 40,
      progress: ind.rsi < 40 ? 100 : Math.max(0, ((70 - ind.rsi) / 30) * 100),
      detail: `RSI: ${ind.rsi?.toFixed(1)}`,
    },
    rsiRising: {
      label: 'RSI subiendo',
      met: ind.rsi_rising,
      value: ind.rsi_rising,
      progress: ind.rsi_rising ? 100 : 0,
      detail: ind.rsi_rising ? 'Subiendo' : 'Bajando',
    },
    macd: {
      label: 'MACD cruce alcista',
      met: ind.macd_crossover_bullish,
      value: ind.macd_histogram,
      progress: ind.macd_crossover_bullish ? 100 : Math.max(0, Math.min(99, 50 + (ind.macd_histogram / Math.abs(ind.macd_signal || 1)) * 50)),
      detail: `Hist: ${ind.macd_histogram?.toFixed(4)}`,
    },
    volume: {
      label: 'Volumen > promedio',
      met: ind.volume_above_average,
      value: ind.volume_ratio,
      target: 1.0,
      progress: Math.min(100, (ind.volume_ratio || 0) * 100),
      detail: `Ratio: ${ind.volume_ratio?.toFixed(2)}x`,
    },
  };

  // Calculate signal proximity for SHORT
  const shortConditions = {
    ema: {
      label: 'Precio < EMA200',
      met: !ind.price_above_ema,
      value: ind.price,
      target: ind.ema_200,
      progress: !ind.price_above_ema ? 100 : Math.min(99, (ind.ema_200 / ind.price) * 100),
      detail: `$${ind.price?.toLocaleString()} / $${ind.ema_200?.toFixed(2)}`,
    },
    rsi: {
      label: 'RSI > 60 (sobrecompra)',
      met: ind.rsi > 60,
      value: ind.rsi,
      target: 60,
      progress: ind.rsi > 60 ? 100 : Math.max(0, ((ind.rsi - 30) / 30) * 100),
      detail: `RSI: ${ind.rsi?.toFixed(1)}`,
    },
    rsiFalling: {
      label: 'RSI bajando',
      met: ind.rsi_falling,
      value: ind.rsi_falling,
      progress: ind.rsi_falling ? 100 : 0,
      detail: ind.rsi_falling ? 'Bajando' : 'Subiendo',
    },
    macd: {
      label: 'MACD cruce bajista',
      met: ind.macd_crossover_bearish,
      value: ind.macd_histogram,
      progress: ind.macd_crossover_bearish ? 100 : Math.max(0, Math.min(99, 50 - (ind.macd_histogram / Math.abs(ind.macd_signal || 1)) * 50)),
      detail: `Hist: ${ind.macd_histogram?.toFixed(4)}`,
    },
    volume: {
      label: 'Volumen > promedio',
      met: ind.volume_above_average,
      value: ind.volume_ratio,
      target: 1.0,
      progress: Math.min(100, (ind.volume_ratio || 0) * 100),
      detail: `Ratio: ${ind.volume_ratio?.toFixed(2)}x`,
    },
  };

  const longMet = Object.values(longConditions).filter(c => c.met).length;
  const shortMet = Object.values(shortConditions).filter(c => c.met).length;
  const totalConditions = 5;

  const renderCondition = (condition, key) => (
    <View key={key} style={styles.conditionRow}>
      <View style={styles.conditionHeader}>
        <Text style={[styles.conditionLabel, condition.met && styles.conditionMet]}>
          {condition.met ? '✓' : '○'} {condition.label}
        </Text>
        <Text style={styles.conditionDetail}>{condition.detail}</Text>
      </View>
      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${condition.progress}%` },
            condition.met ? styles.progressMet : styles.progressPending
          ]}
        />
      </View>
    </View>
  );

  const renderSignalGauge = (met, total, type) => {
    const percentage = (met / total) * 100;
    const color = type === 'LONG' ? '#00d4aa' : '#ff4757';

    return (
      <View style={styles.gaugeContainer}>
        <View style={styles.gaugeOuter}>
          <View
            style={[
              styles.gaugeInner,
              {
                width: `${percentage}%`,
                backgroundColor: color,
              }
            ]}
          />
        </View>
        <Text style={[styles.gaugeText, { color }]}>
          {met}/{total} condiciones
        </Text>
        {met === total && (
          <Text style={[styles.signalReady, { color }]}>
            {type === 'LONG' ? '🟢' : '🔴'} SEÑAL LISTA
          </Text>
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
              {renderSignalGauge(longMet, totalConditions, 'LONG')}
              {Object.entries(longConditions).map(([key, condition]) =>
                renderCondition(condition, `long-${key}`)
              )}
            </View>

            {/* SHORT Signal Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔴 SHORT</Text>
              {renderSignalGauge(shortMet, totalConditions, 'SHORT')}
              {Object.entries(shortConditions).map(([key, condition]) =>
                renderCondition(condition, `short-${key}`)
              )}
            </View>

            {/* Fibonacci Levels */}
            {ind.fibonacci && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📐 Análisis Fibonacci</Text>
                <View style={styles.fiboBox}>
                  {/* Recommendation Banner */}
                  <View style={[styles.fiboRecommendationBanner, {
                    backgroundColor: ind.fibonacci.is_uptrend ? 'rgba(0, 212, 170, 0.15)' : 'rgba(255, 71, 87, 0.15)',
                    borderColor: ind.fibonacci.is_uptrend ? '#00d4aa' : '#ff4757'
                  }]}>
                    <Text style={[styles.fiboRecPosition, { color: ind.fibonacci.is_uptrend ? '#00d4aa' : '#ff4757' }]}>
                      {ind.fibonacci.is_uptrend ? '📈 Favorable LONG' : '📉 Favorable SHORT'}
                    </Text>
                    <Text style={[styles.fiboRecQuality, {
                      color: ind.fibonacci.entry_quality === 'optimal' ? '#00d4aa' :
                             ind.fibonacci.entry_quality === 'good' ? '#ffd93d' : '#ff4757'
                    }]}>
                      {ind.fibonacci.entry_quality === 'optimal' ? '✅ Entrada Óptima' :
                       ind.fibonacci.entry_quality === 'good' ? '⚠️ Con Precaución' : '🚫 No Operar'}
                    </Text>
                  </View>

                  {/* Trade Setup Based on Fibonacci */}
                  {ind.fibonacci.levels && (() => {
                    const levels = Object.entries(ind.fibonacci.levels)
                      .map(([name, price]) => ({ name, price }))
                      .sort((a, b) => a.price - b.price);

                    const currentPrice = ind.price;
                    const isLong = ind.fibonacci.is_uptrend;

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
  gaugeContainer: {
    marginBottom: 16,
    alignItems: 'center',
  },
  gaugeOuter: {
    width: '100%',
    height: 24,
    backgroundColor: '#2a2a4a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  gaugeInner: {
    height: '100%',
    borderRadius: 12,
  },
  gaugeText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  signalReady: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: 'bold',
  },
  conditionRow: {
    marginBottom: 12,
  },
  conditionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  conditionLabel: {
    color: '#888',
    fontSize: 14,
  },
  conditionMet: {
    color: '#00d4aa',
  },
  conditionDetail: {
    color: '#666',
    fontSize: 12,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressMet: {
    backgroundColor: '#00d4aa',
  },
  progressPending: {
    backgroundColor: '#ff9f43',
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
    marginBottom: 4,
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

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const PairCard = ({ pair, data, onPress, embedded = false }) => {
  const cardStyle = embedded ? styles.cardEmbedded : styles.card;

  if (!data) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.pair}>{pair}</Text>
        <Text style={styles.loading}>Cargando...</Text>
      </TouchableOpacity>
    );
  }

  const { price, indicators, funding } = data;

  const formatPrice = (p) => {
    if (p == null) return '$0.00';
    // Use more decimals for small prices (< $1)
    const decimals = p < 1 ? 4 : p < 10 ? 3 : 2;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(p);
  };

  const formatPriceShort = (p) => {
    if (p == null) return '$0';
    // Smart formatting based on price magnitude
    if (p < 0.01) return `$${p.toFixed(6)}`;
    if (p < 1) return `$${p.toFixed(4)}`;
    if (p < 10) return `$${p.toFixed(3)}`;
    if (p < 1000) return `$${p.toFixed(2)}`;
    return `$${p.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  };

  const getRsiColor = (rsi) => {
    if (rsi < 30) return '#00d4aa';
    if (rsi > 70) return '#ff4757';
    return '#ffd93d';
  };

  const getTrendColor = (priceAboveEma) => {
    return priceAboveEma ? '#00d4aa' : '#ff4757';
  };

  const getFundingColor = (sentiment) => {
    if (sentiment === 'too_many_longs') return '#ff4757';
    if (sentiment === 'too_many_shorts') return '#00d4aa';
    if (sentiment === 'slightly_long') return '#ffd93d';
    if (sentiment === 'slightly_short') return '#ffd93d';
    return '#888';
  };

  const getFundingLabel = (sentiment) => {
    if (sentiment === 'too_many_longs') return 'Muchos Longs';
    if (sentiment === 'too_many_shorts') return 'Muchos Shorts';
    if (sentiment === 'slightly_long') return 'Leve Long';
    if (sentiment === 'slightly_short') return 'Leve Short';
    return 'Equilibrado';
  };

  const getFundingEmoji = (sentiment) => {
    if (sentiment === 'too_many_longs') return '🔴';
    if (sentiment === 'too_many_shorts') return '🟢';
    return '⚖️';
  };

  // Check BASE conditions (2 required for signal)
  const checkLongBase = () => {
    if (!indicators) return { met: false, conditions: [] };
    const conditions = [];
    if (indicators.price_above_ema) conditions.push('EMA ✓');
    if (indicators.rsi_rising) conditions.push('RSI ↑');
    return { met: conditions.length === 2, conditions };
  };

  const checkShortBase = () => {
    if (!indicators) return { met: false, conditions: [] };
    const conditions = [];
    if (!indicators.price_above_ema) conditions.push('EMA ✓');
    if (indicators.rsi_falling) conditions.push('RSI ↓');
    return { met: conditions.length === 2, conditions };
  };

  // Calculate SCORE for quality
  const calculateLongScore = () => {
    if (!indicators) return 0;
    let score = 0;
    if (indicators.rsi < 40) score += 1;           // RSI zone
    if (indicators.macd_crossover_bullish) score += 1;  // MACD crossover
    if (indicators.volume_above_average) score += 1;    // Volume
    if (funding?.sentiment === 'too_many_shorts') score += 0.5;  // Funding
    if (indicators.fibonacci?.at_key_level) score += 0.5;  // Fibo en nivel clave
    else if (indicators.fibonacci?.near_key_level) score += 0.25;  // Fibo cerca
    return score;
  };

  const calculateShortScore = () => {
    if (!indicators) return 0;
    let score = 0;
    if (indicators.rsi > 60) score += 1;           // RSI zone
    if (indicators.macd_crossover_bearish) score += 1;  // MACD crossover
    if (indicators.volume_above_average) score += 1;    // Volume
    if (funding?.sentiment === 'too_many_longs') score += 0.5;  // Funding
    if (indicators.fibonacci?.at_key_level) score += 0.5;  // Fibo en nivel clave
    else if (indicators.fibonacci?.near_key_level) score += 0.25;  // Fibo cerca
    return score;
  };

  const getQuality = (score) => {
    if (score >= 3.0) return { label: 'Mejor momento', color: '#00d4aa', emoji: '🔥' };
    if (score >= 1.5) return { label: 'Operable', color: '#ffd93d', emoji: '🟠' };
    return { label: 'Alto Riesgo', color: '#ff4757', emoji: '🔴' };
  };

  const longBase = checkLongBase();
  const shortBase = checkShortBase();
  const longScore = calculateLongScore();
  const shortScore = calculateShortScore();

  // Determine which signal is active
  const isLongSignal = longBase.met;
  const isShortSignal = shortBase.met;
  const hasSignal = isLongSignal || isShortSignal;
  const signalType = isLongSignal ? 'LONG' : (isShortSignal ? 'SHORT' : null);
  const activeScore = isLongSignal ? longScore : shortScore;
  const quality = getQuality(activeScore);

  // For UI display - which direction has more conditions
  const longMet = longBase.conditions.length;
  const shortMet = shortBase.conditions.length;

  return (
    <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
      {/* Header solo si no está embebido (ya se muestra en subscriptionHeader) */}
      {!embedded && (
        <View style={styles.header}>
          <View>
            <Text style={styles.pair}>{pair}</Text>
            <Text style={styles.tapHint}>Toca para ver detalles</Text>
          </View>
          <Text style={styles.price}>{formatPrice(price)}</Text>
        </View>
      )}

      {indicators && (
        <>
          {/* Funding Rate Indicator */}
          {funding && (
            <View style={styles.fundingContainer}>
              <View style={styles.fundingHeader}>
                <Text style={styles.fundingLabel}>Funding Rate</Text>
                <Text style={[styles.fundingRate, { color: getFundingColor(funding.sentiment) }]}>
                  {funding.funding_rate_percent >= 0 ? '+' : ''}{funding.funding_rate_percent?.toFixed(4)}%
                </Text>
              </View>
              <View style={styles.fundingStatus}>
                <Text style={styles.fundingEmoji}>{getFundingEmoji(funding.sentiment)}</Text>
                <Text style={[styles.fundingSentiment, { color: getFundingColor(funding.sentiment) }]}>
                  {getFundingLabel(funding.sentiment)}
                </Text>
                <Text style={styles.fundingRec}>{funding.recommendation}</Text>
              </View>
            </View>
          )}

          {/* Fibonacci - Solo niveles informativos */}
          {indicators.fibonacci && indicators.fibonacci.levels && (() => {
            const levels = indicators.fibonacci.levels;
            const currentPrice = price;

            const levelEntries = Object.entries(levels)
              .map(([name, p]) => ({ name, price: parseFloat(p) }))
              .sort((a, b) => a.price - b.price);

            const supports = levelEntries.filter(l => l.price < currentPrice);
            const resistances = levelEntries.filter(l => l.price > currentPrice);

            const nearestSupport = supports.length > 0 ? supports[supports.length - 1] : null;
            const nearestResistance = resistances.length > 0 ? resistances[0] : null;

            const supportDist = nearestSupport ? ((currentPrice - nearestSupport.price) / currentPrice * 100) : null;
            const resistanceDist = nearestResistance ? ((nearestResistance.price - currentPrice) / currentPrice * 100) : null;

            return (
              <View style={styles.fiboContainer}>
                <Text style={styles.fiboLabel}>📐 Fibonacci</Text>
                <View style={styles.fiboLevels}>
                  {nearestResistance && (
                    <View style={styles.fiboLevelRow}>
                      <Text style={styles.fiboLevelLabel}>↑ Resistencia {nearestResistance.name}%</Text>
                      <Text style={[styles.fiboLevelPrice, { color: '#ff4757' }]}>
                        {formatPriceShort(nearestResistance.price)} (+{resistanceDist?.toFixed(1)}%)
                      </Text>
                    </View>
                  )}
                  <View style={styles.fiboLevelRow}>
                    <Text style={styles.fiboLevelLabel}>● Precio actual</Text>
                    <Text style={styles.fiboLevelPriceCurrent}>
                      {formatPriceShort(currentPrice)}
                    </Text>
                  </View>
                  {nearestSupport && (
                    <View style={styles.fiboLevelRow}>
                      <Text style={styles.fiboLevelLabel}>↓ Soporte {nearestSupport.name}%</Text>
                      <Text style={[styles.fiboLevelPrice, { color: '#00d4aa' }]}>
                        {formatPriceShort(nearestSupport.price)} (-{supportDist?.toFixed(1)}%)
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          <View style={styles.signalProximity}>
            {hasSignal ? (
              <>
                <View style={styles.signalHeader}>
                  <Text style={[styles.signalType, { color: signalType === 'LONG' ? '#00d4aa' : '#ff4757' }]}>
                    {signalType === 'LONG' ? '🟢' : '🔴'} Señal {signalType}
                  </Text>
                  <View style={[styles.qualityBadge, { backgroundColor: quality.color + '20', borderColor: quality.color }]}>
                    <Text style={[styles.qualityText, { color: quality.color }]}>
                      {quality.emoji} {quality.label}
                    </Text>
                  </View>
                </View>

                {/* Entry/TP/SL basado en ATR */}
                {indicators.atr && (() => {
                  const atr = indicators.atr;
                  const entry = price;
                  const slDistance = atr * 1.5;
                  const tpDistance = atr * 3;

                  const stopLoss = signalType === 'LONG' ? entry - slDistance : entry + slDistance;
                  const takeProfit = signalType === 'LONG' ? entry + tpDistance : entry - tpDistance;

                  const tpPercent = ((takeProfit - entry) / entry * 100);
                  const slPercent = ((stopLoss - entry) / entry * 100);

                  return (
                    <View style={styles.tradeSetupCompact}>
                      <View style={styles.tradeSetupItem}>
                        <Text style={styles.tradeSetupItemLabel}>📍 Entrada</Text>
                        <Text style={styles.tradeSetupItemValue}>
                          {formatPriceShort(entry)}
                        </Text>
                      </View>
                      <View style={styles.tradeSetupItem}>
                        <Text style={styles.tradeSetupItemLabel}>🎯 TP ({tpPercent > 0 ? '+' : ''}{tpPercent.toFixed(1)}%)</Text>
                        <Text style={[styles.tradeSetupItemValue, { color: '#00d4aa' }]}>
                          {formatPriceShort(takeProfit)}
                        </Text>
                      </View>
                      <View style={styles.tradeSetupItem}>
                        <Text style={styles.tradeSetupItemLabel}>🛑 SL ({slPercent > 0 ? '+' : ''}{slPercent.toFixed(1)}%)</Text>
                        <Text style={[styles.tradeSetupItemValue, { color: '#ff4757' }]}>
                          {formatPriceShort(stopLoss)}
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                <View style={styles.scoreContainer}>
                  <Text style={styles.scoreLabel}>Score: {activeScore.toFixed(1)} pts</Text>
                  <View style={styles.scoreBar}>
                    <View style={[styles.scoreFill, { width: `${Math.min((activeScore / 4) * 100, 100)}%`, backgroundColor: quality.color }]} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.proximityLabel}>Condiciones base:</Text>
                <View style={styles.baseConditions}>
                  <View style={styles.baseItem}>
                    <Text style={styles.baseLabel}>LONG</Text>
                    <Text style={[styles.baseStatus, { color: longBase.met ? '#00d4aa' : '#666' }]}>
                      {longBase.conditions.join(' ')} ({longMet}/2)
                    </Text>
                  </View>
                  <View style={styles.baseItem}>
                    <Text style={styles.baseLabel}>SHORT</Text>
                    <Text style={[styles.baseStatus, { color: shortBase.met ? '#ff4757' : '#666' }]}>
                      {shortBase.conditions.join(' ')} ({shortMet}/2)
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>

          <View style={styles.indicatorsGrid}>
            <View style={styles.indicatorItem}>
              <Text style={styles.indicatorLabel}>EMA 200</Text>
              <View style={styles.indicatorValue}>
                <View
                  style={[
                    styles.trendDot,
                    { backgroundColor: getTrendColor(indicators.price_above_ema) },
                  ]}
                />
                <Text style={styles.indicatorText}>
                  {indicators.price_above_ema ? 'Arriba' : 'Abajo'}
                </Text>
              </View>
            </View>

            <View style={styles.indicatorItem}>
              <Text style={styles.indicatorLabel}>RSI</Text>
              <Text style={[styles.indicatorText, { color: getRsiColor(indicators.rsi) }]}>
                {indicators.rsi?.toFixed(1)}
              </Text>
            </View>

            <View style={styles.indicatorItem}>
              <Text style={styles.indicatorLabel}>MACD</Text>
              <Text
                style={[
                  styles.indicatorText,
                  { color: indicators.macd_histogram > 0 ? '#00d4aa' : '#ff4757' },
                ]}
              >
                {indicators.macd_histogram > 0 ? '+' : ''}
                {indicators.macd_histogram?.toFixed(2)}
              </Text>
            </View>

            <View style={styles.indicatorItem}>
              <Text style={styles.indicatorLabel}>Volumen</Text>
              <Text
                style={[
                  styles.indicatorText,
                  { color: indicators.volume_above_average ? '#00d4aa' : '#888' },
                ]}
              >
                {indicators.volume_ratio?.toFixed(1)}x
              </Text>
            </View>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardEmbedded: {
    padding: 12,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pair: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  tapHint: {
    color: '#666',
    fontSize: 11,
    marginTop: 2,
  },
  price: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  loading: {
    color: '#888',
    fontSize: 14,
  },
  fundingContainer: {
    backgroundColor: '#151525',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  fundingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  fundingLabel: {
    color: '#888',
    fontSize: 12,
  },
  fundingRate: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  fundingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fundingEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  fundingSentiment: {
    fontSize: 13,
    fontWeight: '600',
    marginRight: 8,
  },
  fundingRec: {
    color: '#666',
    fontSize: 11,
    flex: 1,
  },
  fiboContainer: {
    backgroundColor: '#151525',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  fiboHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  fiboLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  distanceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  fiboDetail: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
  },
  fiboLevels: {
    marginTop: 10,
  },
  fiboLevelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  fiboLevelLabel: {
    color: '#888',
    fontSize: 12,
  },
  fiboLevelPrice: {
    fontSize: 13,
    fontWeight: '600',
  },
  fiboLevelPriceCurrent: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  fiboQuality: {
    fontSize: 13,
    fontWeight: '600',
  },
  fiboStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tradeSetupCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  tradeSetupItem: {
    alignItems: 'center',
    flex: 1,
  },
  tradeSetupItemLabel: {
    color: '#666',
    fontSize: 10,
    marginBottom: 2,
  },
  tradeSetupItemValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  fiboLevel: {
    color: '#aaa',
    fontSize: 12,
  },
  fiboDistance: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  signalProximity: {
    backgroundColor: '#151525',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  proximityLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  signalType: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  qualityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  qualityText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  scoreContainer: {
    marginTop: 4,
  },
  scoreLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 4,
  },
  scoreBar: {
    height: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 3,
  },
  baseConditions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  baseItem: {
    flex: 1,
    marginHorizontal: 4,
  },
  baseLabel: {
    color: '#666',
    fontSize: 10,
    marginBottom: 2,
  },
  baseStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  indicatorsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  indicatorItem: {
    width: '50%',
    paddingVertical: 8,
  },
  indicatorLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  indicatorValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indicatorText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  trendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
});

export default PairCard;

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const PairCard = ({ pair, data, onPress }) => {
  if (!data) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.pair}>{pair}</Text>
        <Text style={styles.loading}>Cargando...</Text>
      </TouchableOpacity>
    );
  }

  const { price, indicators, funding } = data;

  const formatPrice = (p) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(p);
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

  const getFiboColor = (quality) => {
    if (quality === 'optimal') return '#00d4aa';
    if (quality === 'good') return '#ffd93d';
    return '#ff4757';
  };

  const getFiboEmoji = (quality) => {
    if (quality === 'optimal') return '✅';
    if (quality === 'good') return '⚠️';
    return '🚫';
  };

  // Count met conditions for signal proximity
  const countLongConditions = () => {
    if (!indicators) return 0;
    let count = 0;
    if (indicators.price_above_ema) count++;
    if (indicators.rsi < 40) count++;
    if (indicators.rsi_rising) count++;
    if (indicators.macd_crossover_bullish) count++;
    if (indicators.volume_above_average) count++;
    return count;
  };

  const countShortConditions = () => {
    if (!indicators) return 0;
    let count = 0;
    if (!indicators.price_above_ema) count++;
    if (indicators.rsi > 60) count++;
    if (indicators.rsi_falling) count++;
    if (indicators.macd_crossover_bearish) count++;
    if (indicators.volume_above_average) count++;
    return count;
  };

  const longMet = countLongConditions();
  const shortMet = countShortConditions();
  const bestSignal = longMet >= shortMet ? { type: 'LONG', count: longMet } : { type: 'SHORT', count: shortMet };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View>
          <Text style={styles.pair}>{pair}</Text>
          <Text style={styles.tapHint}>Toca para ver detalles</Text>
        </View>
        <Text style={styles.price}>{formatPrice(price)}</Text>
      </View>

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

          {/* Fibonacci Indicator with Trade Setup */}
          {indicators.fibonacci && indicators.fibonacci.levels && (() => {
            const fib = indicators.fibonacci;
            const levels = Object.entries(fib.levels)
              .map(([name, p]) => ({ name, price: p }))
              .sort((a, b) => a.price - b.price);

            const currentPrice = price;
            const isLong = fib.is_uptrend;

            const levelsBelow = levels.filter(l => l.price < currentPrice);
            const levelsAbove = levels.filter(l => l.price > currentPrice);

            let entry, stopLoss, takeProfit;

            if (isLong) {
              entry = levelsBelow.length > 0 ? levelsBelow[levelsBelow.length - 1] : null;
              stopLoss = levelsBelow.length > 1 ? levelsBelow[levelsBelow.length - 2] : null;
              takeProfit = levelsAbove.length > 1 ? levelsAbove[1] : (levelsAbove.length > 0 ? levelsAbove[0] : null);
            } else {
              entry = levelsAbove.length > 0 ? levelsAbove[0] : null;
              stopLoss = levelsAbove.length > 1 ? levelsAbove[1] : null;
              takeProfit = levelsBelow.length > 1 ? levelsBelow[levelsBelow.length - 2] : (levelsBelow.length > 0 ? levelsBelow[levelsBelow.length - 1] : null);
            }

            return (
              <View style={styles.fiboContainer}>
                <View style={styles.fiboHeader}>
                  <Text style={[styles.fiboSetupType, { color: isLong ? '#00d4aa' : '#ff4757' }]}>
                    {isLong ? '📈 LONG' : '📉 SHORT'}
                  </Text>
                  <Text style={[styles.fiboEntryRec, { color: getFiboColor(fib.entry_quality) }]}>
                    {getFiboEmoji(fib.entry_quality)} {fib.entry_quality === 'optimal' ? 'Óptima' : fib.entry_quality === 'good' ? 'Precaución' : 'No operar'}
                  </Text>
                </View>

                <View style={styles.tradeSetupCompact}>
                  <View style={styles.tradeSetupItem}>
                    <Text style={styles.tradeSetupItemLabel}>📍 Entrada</Text>
                    <Text style={styles.tradeSetupItemValue}>
                      ${entry?.price?.toLocaleString(undefined, {maximumFractionDigits: 0}) || '-'}
                    </Text>
                  </View>
                  <View style={styles.tradeSetupItem}>
                    <Text style={styles.tradeSetupItemLabel}>🎯 TP</Text>
                    <Text style={[styles.tradeSetupItemValue, { color: '#00d4aa' }]}>
                      ${takeProfit?.price?.toLocaleString(undefined, {maximumFractionDigits: 0}) || '-'}
                    </Text>
                  </View>
                  <View style={styles.tradeSetupItem}>
                    <Text style={styles.tradeSetupItemLabel}>🛑 SL</Text>
                    <Text style={[styles.tradeSetupItemValue, { color: '#ff4757' }]}>
                      ${stopLoss?.price?.toLocaleString(undefined, {maximumFractionDigits: 0}) || '-'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })()}

          <View style={styles.signalProximity}>
            <Text style={styles.proximityLabel}>Proximidad señal:</Text>
            <View style={styles.proximityBars}>
              <View style={styles.proximityItem}>
                <Text style={styles.proximityType}>LONG</Text>
                <View style={styles.miniBar}>
                  <View style={[styles.miniFill, styles.longFill, { width: `${(longMet / 5) * 100}%` }]} />
                </View>
                <Text style={styles.proximityCount}>{longMet}/5</Text>
              </View>
              <View style={styles.proximityItem}>
                <Text style={styles.proximityType}>SHORT</Text>
                <View style={styles.miniBar}>
                  <View style={[styles.miniFill, styles.shortFill, { width: `${(shortMet / 5) * 100}%` }]} />
                </View>
                <Text style={styles.proximityCount}>{shortMet}/5</Text>
              </View>
            </View>
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
    color: '#888',
    fontSize: 12,
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
  fiboSetupType: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  fiboEntryRec: {
    fontSize: 12,
    fontWeight: '600',
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
  proximityBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  proximityItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  proximityType: {
    color: '#666',
    fontSize: 10,
    width: 40,
  },
  miniBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 3,
    marginHorizontal: 6,
    overflow: 'hidden',
  },
  miniFill: {
    height: '100%',
    borderRadius: 3,
  },
  longFill: {
    backgroundColor: '#00d4aa',
  },
  shortFill: {
    backgroundColor: '#ff4757',
  },
  proximityCount: {
    color: '#888',
    fontSize: 10,
    width: 24,
    textAlign: 'right',
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

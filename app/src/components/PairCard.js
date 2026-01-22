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

  const { price, indicators } = data;

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

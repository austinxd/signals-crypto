import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const PairCard = ({ pair, data }) => {
  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.pair}>{pair}</Text>
        <Text style={styles.loading}>Cargando...</Text>
      </View>
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

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.pair}>{pair}</Text>
        <Text style={styles.price}>{formatPrice(price)}</Text>
      </View>

      {indicators && (
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
      )}
    </View>
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
  price: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  loading: {
    color: '#888',
    fontSize: 14,
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

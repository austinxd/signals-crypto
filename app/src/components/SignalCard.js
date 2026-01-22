import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SignalCard = ({ signal }) => {
  const isLong = signal.side === 'LONG';
  const accentColor = isLong ? '#00d4aa' : '#ff4757';
  const emoji = isLong ? '🟢' : '🔴';

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(price);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{emoji}</Text>
        <View style={styles.headerText}>
          <Text style={styles.pair}>{signal.pair}</Text>
          <Text style={[styles.side, { color: accentColor }]}>{signal.side}</Text>
        </View>
        <Text style={styles.time}>{formatTime(signal.timestamp)}</Text>
      </View>

      <View style={styles.priceRow}>
        <View style={styles.priceItem}>
          <Text style={styles.priceLabel}>Entrada</Text>
          <Text style={styles.priceValue}>{formatPrice(signal.entry)}</Text>
        </View>
        <View style={styles.priceItem}>
          <Text style={styles.priceLabel}>TP</Text>
          <Text style={[styles.priceValue, styles.tpValue]}>{formatPrice(signal.takeProfit)}</Text>
        </View>
        <View style={styles.priceItem}>
          <Text style={styles.priceLabel}>SL</Text>
          <Text style={[styles.priceValue, styles.slValue]}>{formatPrice(signal.stopLoss)}</Text>
        </View>
      </View>

      {signal.indicators && (
        <View style={styles.indicators}>
          <Text style={styles.indicatorText}>
            RSI: {signal.indicators.rsi} | MACD: {signal.indicators.macd > 0 ? '+' : ''}{signal.indicators.macd}
          </Text>
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
    borderLeftWidth: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  emoji: {
    fontSize: 24,
    marginRight: 10,
  },
  headerText: {
    flex: 1,
  },
  pair: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  side: {
    fontSize: 14,
    fontWeight: '600',
  },
  time: {
    color: '#888',
    fontSize: 12,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  priceItem: {
    alignItems: 'center',
  },
  priceLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  priceValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tpValue: {
    color: '#00d4aa',
  },
  slValue: {
    color: '#ff4757',
  },
  indicators: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  indicatorText: {
    color: '#888',
    fontSize: 12,
  },
});

export default SignalCard;

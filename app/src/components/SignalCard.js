import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SignalCard = ({ signal }) => {
  const isLong = signal.side === 'LONG';
  const accentColor = isLong ? '#00d4aa' : '#ff4757';

  // Quality-based styling
  const getQualityConfig = (quality) => {
    switch (quality) {
      case 'OPTIMA':
        return { emoji: '🔥', color: '#00d4aa', label: 'Óptima' };
      case 'BUENA':
        return { emoji: '🟡', color: '#ffd93d', label: 'Buena' };
      case 'TEMPRANA':
      default:
        return { emoji: '⚡', color: '#ff9f43', label: 'Temprana' };
    }
  };

  const qualityConfig = getQualityConfig(signal.quality);
  const sideEmoji = isLong ? '🟢' : '🔴';

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
    });
  };

  // Calculate percentages
  const tpPercent = ((signal.takeProfit - signal.entry) / signal.entry * 100).toFixed(1);
  const slPercent = ((signal.stopLoss - signal.entry) / signal.entry * 100).toFixed(1);

  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      {/* Header with quality badge */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.sideEmoji}>{sideEmoji}</Text>
          <View>
            <Text style={styles.pair}>{signal.pair}</Text>
            <Text style={[styles.side, { color: accentColor }]}>
              {signal.side} • {signal.timeframe}
            </Text>
          </View>
        </View>
        <View style={[styles.qualityBadge, { backgroundColor: qualityConfig.color + '20', borderColor: qualityConfig.color }]}>
          <Text style={styles.qualityEmoji}>{qualityConfig.emoji}</Text>
          <Text style={[styles.qualityText, { color: qualityConfig.color }]}>
            {qualityConfig.label}
          </Text>
        </View>
      </View>

      {/* Score display */}
      {signal.score !== undefined && (
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>Confluencia:</Text>
          <View style={styles.scoreBar}>
            <View style={[styles.scoreFill, { width: `${Math.min(100, (signal.score / 4) * 100)}%`, backgroundColor: qualityConfig.color }]} />
          </View>
          <Text style={[styles.scoreValue, { color: qualityConfig.color }]}>{signal.score}/4</Text>
        </View>
      )}

      {/* Prices */}
      <View style={styles.priceRow}>
        <View style={styles.priceItem}>
          <Text style={styles.priceLabel}>📍 Entrada</Text>
          <Text style={styles.priceValue}>{formatPrice(signal.entry)}</Text>
        </View>
        <View style={styles.priceItem}>
          <Text style={styles.priceLabel}>🎯 TP</Text>
          <Text style={[styles.priceValue, styles.tpValue]}>
            {formatPrice(signal.takeProfit)}
          </Text>
          <Text style={styles.percentText}>+{Math.abs(tpPercent)}%</Text>
        </View>
        <View style={styles.priceItem}>
          <Text style={styles.priceLabel}>🛑 SL</Text>
          <Text style={[styles.priceValue, styles.slValue]}>
            {formatPrice(signal.stopLoss)}
          </Text>
          <Text style={styles.percentText}>{slPercent}%</Text>
        </View>
      </View>

      {/* Warnings */}
      {signal.warnings && signal.warnings.length > 0 && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>{signal.warnings[0]}</Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.time}>{formatTime(signal.timestamp)}</Text>
        {signal.indicators && (
          <Text style={styles.indicatorText}>
            RSI: {signal.indicators.rsi} | Vol: {signal.indicators.volume_ratio}x
          </Text>
        )}
      </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideEmoji: {
    fontSize: 24,
    marginRight: 10,
  },
  pair: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  side: {
    fontSize: 13,
    fontWeight: '600',
  },
  qualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  qualityEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  qualityText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  scoreLabel: {
    color: '#888',
    fontSize: 12,
    marginRight: 8,
  },
  scoreBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 3,
  },
  scoreValue: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
    width: 30,
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
    fontSize: 11,
    marginBottom: 4,
  },
  priceValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  percentText: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
  tpValue: {
    color: '#00d4aa',
  },
  slValue: {
    color: '#ff4757',
  },
  warningBox: {
    backgroundColor: 'rgba(255, 159, 67, 0.15)',
    borderRadius: 8,
    padding: 8,
    marginTop: 12,
  },
  warningText: {
    color: '#ff9f43',
    fontSize: 12,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  time: {
    color: '#666',
    fontSize: 11,
  },
  indicatorText: {
    color: '#666',
    fontSize: 11,
  },
});

export default SignalCard;

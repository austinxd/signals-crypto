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

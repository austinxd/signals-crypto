import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { getPositionAlerts } from '../services/api';

const formatPrice = (p) => {
  if (p == null) return '-';
  if (p < 0.01) return `$${p.toFixed(6)}`;
  if (p < 1) return `$${p.toFixed(4)}`;
  if (p < 10) return `$${p.toFixed(3)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const ALERT_URGENCY = {
  MACD_REVERSAL: { icon: '🚨', color: '#ff4757' },
  RSI_DIVERGENCE: { icon: '🚨', color: '#ff4757' },
  RSI_EXTREME: { icon: '⚠️', color: '#ffd93d' },
  TRAILING_BREAKEVEN: { icon: 'ℹ️', color: '#888' },
  TRAILING_UPDATE: { icon: 'ℹ️', color: '#888' },
};

const PositionCard = ({ position }) => {
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);

  const isLong = position.side === 'long';
  const pnl = position.unrealized_pnl || 0;
  const pnlPercent = position.entry_price
    ? ((position.current_price - position.entry_price) / position.entry_price * 100 * (isLong ? 1 : -1))
    : 0;
  const pnlColor = pnl >= 0 ? '#00d4aa' : '#ff4757';
  const sideColor = isLong ? '#00d4aa' : '#ff4757';

  useEffect(() => {
    if (showAlerts && alerts.length === 0) {
      getPositionAlerts(position.symbol)
        .then((data) => setAlerts(data.alerts || []))
        .catch(() => {});
    }
  }, [showAlerts]);

  // SL/TP progress bar
  const sl = position.current_stop_loss;
  const tp = position.current_take_profit;
  const current = position.current_price;
  let progress = 0.5;
  if (sl != null && tp != null && tp !== sl) {
    progress = Math.max(0, Math.min(1, (current - sl) / (tp - sl)));
  }

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.symbol}>{position.symbol}</Text>
          <View style={[styles.sideBadge, { backgroundColor: sideColor + '30', borderColor: sideColor }]}>
            <Text style={[styles.sideText, { color: sideColor }]}>
              {isLong ? 'LONG' : 'SHORT'}
            </Text>
          </View>
          {position.leverage && (
            <View style={styles.leverageBadge}>
              <Text style={styles.leverageText}>{position.leverage}x</Text>
            </View>
          )}
        </View>
        {position.mode === 'bot' ? (
          <Text style={styles.modeIcon}>🤖</Text>
        ) : (
          <Text style={styles.modeIcon}>📋</Text>
        )}
      </View>

      {/* Prices */}
      <View style={styles.priceRow}>
        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>Entrada</Text>
          <Text style={styles.priceValue}>{formatPrice(position.entry_price)}</Text>
        </View>
        <Text style={[styles.arrow, { color: pnlColor }]}>{pnl >= 0 ? '→' : '→'}</Text>
        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>Actual</Text>
          <Text style={[styles.priceValue, { color: pnlColor }]}>{formatPrice(current)}</Text>
        </View>
      </View>

      {/* PnL */}
      <View style={styles.pnlRow}>
        <Text style={[styles.pnlValue, { color: pnlColor }]}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
        </Text>
        <Text style={[styles.pnlPercent, { color: pnlColor }]}>
          ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
        </Text>
      </View>

      {/* SL / TP bar */}
      {sl != null && tp != null && (
        <View style={styles.slTpSection}>
          <View style={styles.slTpLabels}>
            <Text style={styles.slLabel}>SL {formatPrice(sl)}</Text>
            <Text style={styles.tpLabel}>TP {formatPrice(tp)}</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]}>
              <View style={styles.progressMarker} />
            </View>
          </View>
        </View>
      )}

      {/* Alerts toggle */}
      <TouchableOpacity
        style={styles.alertsToggle}
        onPress={() => setShowAlerts(!showAlerts)}
      >
        <Text style={styles.alertsToggleText}>
          {showAlerts ? '▼ Alertas' : '▶ Alertas'}
        </Text>
      </TouchableOpacity>

      {showAlerts && alerts.length > 0 && (
        <View style={styles.alertsList}>
          {alerts.map((alert, i) => {
            const urgency = ALERT_URGENCY[alert.alert_type] || { icon: 'ℹ️', color: '#888' };
            return (
              <View key={alert.id || i} style={[styles.alertItem, { borderLeftColor: urgency.color }]}>
                <Text style={styles.alertIcon}>{urgency.icon}</Text>
                <View style={styles.alertContent}>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  {alert.was_executed && (
                    <Text style={styles.alertExecuted}>Ejecutado ✓</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {showAlerts && alerts.length === 0 && (
        <Text style={styles.noAlerts}>Sin alertas recientes</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a2e',
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  sideText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  leverageBadge: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  leverageText: {
    color: '#888',
    fontSize: 11,
    fontWeight: 'bold',
  },
  modeIcon: {
    fontSize: 20,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  priceCol: {
    flex: 1,
  },
  priceLabel: {
    color: '#666',
    fontSize: 11,
    marginBottom: 2,
  },
  priceValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  arrow: {
    fontSize: 16,
    marginHorizontal: 8,
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  pnlValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  pnlPercent: {
    fontSize: 14,
  },
  slTpSection: {
    marginBottom: 12,
  },
  slTpLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  slLabel: {
    color: '#ff4757',
    fontSize: 11,
  },
  tpLabel: {
    color: '#00d4aa',
    fontSize: 11,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00d4aa',
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  progressMarker: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    marginRight: -5,
  },
  alertsToggle: {
    paddingVertical: 6,
  },
  alertsToggleText: {
    color: '#888',
    fontSize: 13,
  },
  alertsList: {
    marginTop: 8,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
  },
  alertIcon: {
    fontSize: 14,
    marginRight: 8,
    marginTop: 1,
  },
  alertContent: {
    flex: 1,
  },
  alertMessage: {
    color: '#ccc',
    fontSize: 13,
  },
  alertExecuted: {
    color: '#00d4aa',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  noAlerts: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
});

export default PositionCard;

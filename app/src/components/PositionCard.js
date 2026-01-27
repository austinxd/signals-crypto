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
  MACD_REVERSAL: { icon: '\u{1F6A8}', color: '#ff4757' },
  RSI_DIVERGENCE: { icon: '\u{1F6A8}', color: '#ff4757' },
  RSI_EXTREME: { icon: '\u26A0\uFE0F', color: '#ffd93d' },
  TRAILING_BREAKEVEN: { icon: '\u2139\uFE0F', color: '#888' },
  TRAILING_UPDATE: { icon: '\u2139\uFE0F', color: '#888' },
};

const RISK_COLORS = {
  low: '#00d4aa',
  medium: '#ffd93d',
  high: '#ff4757',
};

const SENTIMENT_LABELS = {
  bullish: { text: 'Alcista', color: '#00d4aa' },
  bearish: { text: 'Bajista', color: '#ff4757' },
  neutral: { text: 'Neutral', color: '#888' },
};

const RSIBar = ({ value }) => {
  if (value == null) return <Text style={styles.indicatorValue}>-</Text>;
  const pct = Math.max(0, Math.min(100, value));
  let color = '#ffd93d';
  if (pct < 30) color = '#00d4aa';
  else if (pct > 70) color = '#ff4757';

  return (
    <View style={styles.rsiContainer}>
      <View style={styles.rsiBar}>
        <View style={[styles.rsiFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.rsiValue, { color }]}>{pct.toFixed(0)}</Text>
    </View>
  );
};

const cleanSymbol = (s) => s ? s.split(':')[0] : s;

const calcLiquidationPrice = (entry, leverage, side) => {
  if (!entry || !leverage || leverage <= 0) return null;
  // Approximate: ignores fees/maintenance margin
  const rate = 1 / leverage;
  if (side === 'long') return entry * (1 - rate);
  return entry * (1 + rate);
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
  const displaySymbol = cleanSymbol(position.symbol);
  const liqPrice = calcLiquidationPrice(position.entry_price, position.leverage, position.side);

  const ind = position.indicators || {};
  const riskColor = RISK_COLORS[position.risk_level] || '#888';
  const sentimentInfo = SENTIMENT_LABELS[position.market_sentiment] || SENTIMENT_LABELS.neutral;

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
          <Text style={styles.symbol}>{displaySymbol}</Text>
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
          <Text style={styles.modeIcon}>{'\u{1F916}'}</Text>
        ) : (
          <Text style={styles.modeIcon}>{'\u{1F4CB}'}</Text>
        )}
      </View>

      {/* Prices */}
      <View style={styles.priceRow}>
        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>Entrada</Text>
          <Text style={styles.priceValue}>{formatPrice(position.entry_price)}</Text>
        </View>
        <Text style={[styles.arrow, { color: pnlColor }]}>{'\u2192'}</Text>
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

      {/* Liquidation price */}
      {liqPrice != null && (
        <View style={styles.liqRow}>
          <Text style={styles.liqLabel}>Liq. estimada</Text>
          <Text style={styles.liqValue}>{formatPrice(liqPrice)}</Text>
        </View>
      )}

      {/* Indicators */}
      {ind.rsi != null && (
        <View style={styles.indicatorsSection}>
          <Text style={styles.sectionTitle}>Indicadores (15m)</Text>
          <View style={styles.indicatorRow}>
            <Text style={styles.indicatorLabel}>RSI</Text>
            <RSIBar value={ind.rsi} />
          </View>
          <View style={styles.indicatorRow}>
            <Text style={styles.indicatorLabel}>MACD</Text>
            <Text style={[styles.indicatorValue, { color: ind.macd_trend === 'bullish' ? '#00d4aa' : '#ff4757' }]}>
              {ind.macd_trend === 'bullish' ? 'Bullish \u2191' : 'Bearish \u2193'}
            </Text>
          </View>
          <View style={styles.indicatorRow}>
            <Text style={styles.indicatorLabel}>EMA200</Text>
            <Text style={[styles.indicatorValue, { color: ind.price_above_ema ? '#00d4aa' : '#ff4757' }]}>
              {ind.price_above_ema ? 'Por encima \u2713' : 'Por debajo \u2717'}
            </Text>
          </View>
          <View style={styles.indicatorRow}>
            <Text style={styles.indicatorLabel}>Volumen</Text>
            <Text style={[styles.indicatorValue, { color: ind.volume_above_average ? '#ffd93d' : '#888' }]}>
              {ind.volume_above_average ? 'Alto' : 'Normal'}
            </Text>
          </View>
        </View>
      )}

      {/* Suggestion */}
      {position.suggestion && (
        <View style={[styles.suggestionBox, { borderLeftColor: riskColor }]}>
          <View style={styles.suggestionHeader}>
            <Text style={styles.suggestionText}>{position.suggestion}</Text>
            <View style={[styles.sentimentBadge, { backgroundColor: sentimentInfo.color + '25', borderColor: sentimentInfo.color }]}>
              <Text style={[styles.sentimentText, { color: sentimentInfo.color }]}>
                {sentimentInfo.text}
              </Text>
            </View>
          </View>
        </View>
      )}

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
          {showAlerts ? '\u25BC Alertas' : '\u25B6 Alertas'}
        </Text>
      </TouchableOpacity>

      {showAlerts && alerts.length > 0 && (
        <View style={styles.alertsList}>
          {alerts.map((alert, i) => {
            const urgency = ALERT_URGENCY[alert.alert_type] || { icon: '\u2139\uFE0F', color: '#888' };
            return (
              <View key={alert.id || i} style={[styles.alertItem, { borderLeftColor: urgency.color }]}>
                <Text style={styles.alertIcon}>{urgency.icon}</Text>
                <View style={styles.alertContent}>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  {alert.was_executed && (
                    <Text style={styles.alertExecuted}>Ejecutado \u2713</Text>
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
  liqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  liqLabel: {
    color: '#666',
    fontSize: 12,
  },
  liqValue: {
    color: '#ff6b81',
    fontSize: 13,
    fontWeight: '600',
  },
  // Indicators section
  indicatorsSection: {
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  indicatorLabel: {
    color: '#999',
    fontSize: 13,
    width: 60,
  },
  indicatorValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  rsiContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rsiBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  rsiFill: {
    height: '100%',
    borderRadius: 3,
  },
  rsiValue: {
    fontSize: 13,
    fontWeight: 'bold',
    width: 30,
    textAlign: 'right',
  },
  // Suggestion section
  suggestionBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderLeftWidth: 3,
  },
  suggestionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  suggestionText: {
    color: '#ccc',
    fontSize: 13,
    flex: 1,
  },
  sentimentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  sentimentText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  // SL/TP
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

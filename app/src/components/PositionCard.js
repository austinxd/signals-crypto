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

const FIB_KEY_LEVELS = ['23.6', '38.2', '50.0', '61.8', '78.6'];
const FIB_COLORS = {
  '0.0': '#ff4757',
  '23.6': '#ff6b81',
  '38.2': '#ffd93d',
  '50.0': '#ffa502',
  '61.8': '#2ed573',
  '78.6': '#1e90ff',
  '100.0': '#5352ed',
};

const RSIBar = ({ value }) => {
  if (value == null) return <Text style={styles.indicatorValue}>-</Text>;
  const pct = Math.max(0, Math.min(100, value));
  let color = '#ffd93d';
  let label = 'Neutral';
  if (pct < 30) { color = '#00d4aa'; label = 'Sobrevendido'; }
  else if (pct < 45) { color = '#2ed573'; label = 'Bajo'; }
  else if (pct > 70) { color = '#ff4757'; label = 'Sobrecomprado'; }
  else if (pct > 55) { color = '#ff6b81'; label = 'Alto'; }

  return (
    <View style={styles.rsiContainer}>
      <View style={styles.rsiBar}>
        <View style={[styles.rsiFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.rsiValue, { color }]}>{pct.toFixed(0)}</Text>
    </View>
  );
};

const FibonacciChart = ({ fib, currentPrice, entryPrice }) => {
  if (!fib || !fib.levels) return null;

  const levels = fib.levels;
  const high = fib.swing_high;
  const low = fib.swing_low;
  const range = high - low;
  if (range <= 0) return null;

  // Positions as percentage from bottom
  const priceToPercent = (p) => Math.max(0, Math.min(100, ((p - low) / range) * 100));

  const currentPct = priceToPercent(currentPrice);
  const entryPct = entryPrice ? priceToPercent(entryPrice) : null;

  return (
    <View style={styles.fibSection}>
      <Text style={styles.sectionTitle}>Fibonacci (15m)</Text>
      <View style={styles.fibChart}>
        {/* Level lines */}
        {FIB_KEY_LEVELS.map((name) => {
          const price = levels[name];
          if (price == null) return null;
          const pct = priceToPercent(price);
          const color = FIB_COLORS[name] || '#555';
          return (
            <View key={name} style={[styles.fibLevel, { bottom: `${pct}%` }]}>
              <View style={[styles.fibLine, { backgroundColor: color + '60' }]} />
              <Text style={[styles.fibLabel, { color }]}>{name}%</Text>
              <Text style={[styles.fibPrice, { color: '#666' }]}>{formatPrice(price)}</Text>
            </View>
          );
        })}

        {/* Current price marker */}
        <View style={[styles.fibMarker, { bottom: `${currentPct}%` }]}>
          <View style={styles.fibMarkerDot} />
          <Text style={styles.fibMarkerLabel}>Actual</Text>
        </View>

        {/* Entry price marker */}
        {entryPct != null && Math.abs(entryPct - currentPct) > 3 && (
          <View style={[styles.fibMarker, styles.fibEntryMarker, { bottom: `${entryPct}%` }]}>
            <View style={[styles.fibMarkerDot, { backgroundColor: '#ffd93d' }]} />
            <Text style={[styles.fibMarkerLabel, { color: '#ffd93d' }]}>Entrada</Text>
          </View>
        )}
      </View>
      {fib.at_key_level && (
        <Text style={styles.fibNote}>En nivel clave Fib {fib.key_level_name}%</Text>
      )}
      {!fib.at_key_level && fib.near_key_level && (
        <Text style={styles.fibNote}>Cerca de Fib {fib.key_level_name}%</Text>
      )}
    </View>
  );
};

const cleanSymbol = (s) => s ? s.split(':')[0] : s;

const calcLiquidationPrice = (entry, leverage, side) => {
  if (!entry || !leverage || leverage <= 0) return null;
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

  const sl = position.current_stop_loss;
  const tp = position.current_take_profit;
  const current = position.current_price;
  let progress = 0.5;
  if (sl != null && tp != null && tp !== sl) {
    progress = Math.max(0, Math.min(1, (current - sl) / (tp - sl)));
  }

  return (
    <View style={styles.card}>
      {/* ===== HEADER ===== */}
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
        <View style={styles.headerRight}>
          <View style={[styles.sentimentBadge, { backgroundColor: sentimentInfo.color + '20', borderColor: sentimentInfo.color }]}>
            <Text style={[styles.sentimentText, { color: sentimentInfo.color }]}>
              {sentimentInfo.text}
            </Text>
          </View>
          {position.mode === 'bot' ? (
            <Text style={styles.modeIcon}>{'\u{1F916}'}</Text>
          ) : (
            <Text style={styles.modeIcon}>{'\u{1F4CB}'}</Text>
          )}
        </View>
      </View>

      {/* ===== PRECIOS + PNL ===== */}
      <View style={styles.priceBox}>
        <View style={styles.priceRow}>
          <View style={styles.priceCol}>
            <Text style={styles.priceLabel}>Entrada</Text>
            <Text style={styles.priceValue}>{formatPrice(position.entry_price)}</Text>
          </View>
          <Text style={styles.arrow}>{'\u2192'}</Text>
          <View style={styles.priceCol}>
            <Text style={styles.priceLabel}>Actual</Text>
            <Text style={styles.priceValue}>{formatPrice(current)}</Text>
          </View>
          <View style={[styles.pnlBox, { backgroundColor: pnlColor + '15', borderColor: pnlColor + '40' }]}>
            <Text style={styles.pnlBoxLabel}>PnL</Text>
            <Text style={[styles.pnlBoxValue, { color: pnlColor }]}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
            </Text>
            <Text style={[styles.pnlBoxPercent, { color: pnlColor }]}>
              {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
            </Text>
          </View>
        </View>

        {/* Liquidation + extra info */}
        <View style={styles.detailRow}>
          {liqPrice != null && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Liq. estimada</Text>
              <Text style={styles.detailValue}>{formatPrice(liqPrice)}</Text>
            </View>
          )}
          {position.entry_atr != null && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>ATR entrada</Text>
              <Text style={styles.detailValue}>${position.entry_atr.toFixed(2)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ===== SL / TP ===== */}
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

      {/* ===== INDICADORES ===== */}
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
              {ind.macd_trend === 'bullish' ? 'Alcista \u2191' : 'Bajista \u2193'}
            </Text>
          </View>
          <View style={styles.indicatorRow}>
            <Text style={styles.indicatorLabel}>EMA200</Text>
            <Text style={[styles.indicatorValue, { color: ind.price_above_ema ? '#00d4aa' : '#ff4757' }]}>
              {ind.price_above_ema ? 'Precio por encima \u2713' : 'Precio por debajo \u2717'}
            </Text>
          </View>
          <View style={styles.indicatorRow}>
            <Text style={styles.indicatorLabel}>Volumen</Text>
            <Text style={[styles.indicatorValue, { color: ind.volume_above_average ? '#ffd93d' : '#888' }]}>
              {ind.volume_above_average ? 'Por encima del promedio' : 'Normal'}
            </Text>
          </View>
        </View>
      )}

      {/* ===== FIBONACCI ===== */}
      <FibonacciChart
        fib={ind.fibonacci}
        currentPrice={current}
        entryPrice={position.entry_price}
      />

      {/* ===== RECOMENDACIÓN ===== */}
      {position.suggestion && (
        <View style={[styles.suggestionBox, { borderLeftColor: riskColor }]}>
          <View style={styles.suggestionTitleRow}>
            <Text style={styles.suggestionTitle}>{'Recomendaci\u00F3n seg\u00FAn indicadores'}</Text>
            <View style={[styles.riskBadge, { backgroundColor: riskColor + '25' }]}>
              <Text style={[styles.riskBadgeText, { color: riskColor }]}>
                {position.risk_level === 'high' ? 'Riesgo alto' : position.risk_level === 'medium' ? 'Riesgo medio' : 'Riesgo bajo'}
              </Text>
            </View>
          </View>
          <Text style={styles.suggestionText}>{position.suggestion}</Text>
        </View>
      )}

      {/* ===== ALERTAS ===== */}
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
                    <Text style={styles.alertExecuted}>{'Ejecutado \u2713'}</Text>
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
  // Header
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
  headerRight: {
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
    fontSize: 18,
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
  // Price box
  priceBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 15,
    fontWeight: '600',
  },
  arrow: {
    color: '#444',
    fontSize: 16,
    marginHorizontal: 6,
  },
  pnlBox: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 80,
  },
  pnlBoxLabel: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
  },
  pnlBoxValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  pnlBoxPercent: {
    fontSize: 11,
  },
  detailRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 16,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailLabel: {
    color: '#555',
    fontSize: 11,
  },
  detailValue: {
    color: '#ff6b81',
    fontSize: 11,
    fontWeight: '600',
  },
  // SL/TP
  slTpSection: {
    marginBottom: 10,
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
  // Indicators
  indicatorsSection: {
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    padding: 12,
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
  // Fibonacci
  fibSection: {
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  fibChart: {
    height: 160,
    position: 'relative',
    marginVertical: 8,
    marginLeft: 4,
  },
  fibLevel: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 1,
  },
  fibLine: {
    flex: 1,
    height: 1,
  },
  fibLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 6,
    width: 36,
  },
  fibPrice: {
    fontSize: 9,
    marginLeft: 2,
  },
  fibMarker: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 1,
    zIndex: 10,
  },
  fibEntryMarker: {
    zIndex: 5,
  },
  fibMarkerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 4,
  },
  fibMarkerLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  fibNote: {
    color: '#ffd93d',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Suggestion
  suggestionBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 3,
  },
  suggestionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  suggestionTitle: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  riskBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  suggestionText: {
    color: '#ddd',
    fontSize: 13,
    lineHeight: 18,
  },
  // Alerts
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

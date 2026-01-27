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

const RISK_COLORS = { low: '#00d4aa', medium: '#ffd93d', high: '#ff4757' };

const SENTIMENT_LABELS = {
  bullish: { text: 'Alcista', color: '#00d4aa' },
  bearish: { text: 'Bajista', color: '#ff4757' },
  neutral: { text: 'Neutral', color: '#888' },
};

const TIMEFRAMES = ['15m', '1h', '4h'];

const FIB_LEVELS_DISPLAY = [
  { key: '78.6', color: '#1e90ff' },
  { key: '61.8', color: '#2ed573' },
  { key: '50.0', color: '#ffa502' },
  { key: '38.2', color: '#ffd93d' },
  { key: '23.6', color: '#ff6b81' },
];

const RSIBar = ({ value }) => {
  if (value == null) return <Text style={styles.indicatorValue}>-</Text>;
  const pct = Math.max(0, Math.min(100, value));
  let color = '#ffd93d';
  if (pct < 30) color = '#00d4aa';
  else if (pct > 70) color = '#ff4757';
  else if (pct > 55) color = '#ff6b81';
  else if (pct < 45) color = '#2ed573';
  return (
    <View style={styles.rsiContainer}>
      <View style={styles.rsiBar}>
        <View style={[styles.rsiFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.rsiValue, { color }]}>{pct.toFixed(0)}</Text>
    </View>
  );
};

const SentimentDot = ({ sentiment }) => {
  const info = SENTIMENT_LABELS[sentiment] || SENTIMENT_LABELS.neutral;
  return <View style={[styles.tfDot, { backgroundColor: info.color }]} />;
};

const MultiTFSummary = ({ timeframes, side }) => {
  if (!timeframes) return null;
  const isShort = side === 'short' || side === 'SHORT';
  return (
    <View style={styles.tfSummary}>
      {TIMEFRAMES.map((tf) => {
        const data = timeframes[tf];
        if (!data || !data.sentiment) return null;
        const s = data.sentiment;
        const info = SENTIMENT_LABELS[s] || SENTIMENT_LABELS.neutral;
        const against = (s === 'bullish' && isShort) || (s === 'bearish' && !isShort);
        const favor = (s === 'bullish' && !isShort) || (s === 'bearish' && isShort);
        return (
          <View key={tf} style={[styles.tfChip, { borderColor: info.color + '60', backgroundColor: info.color + '10' }]}>
            <Text style={styles.tfChipLabel}>{tf}</Text>
            <Text style={[styles.tfChipValue, { color: info.color }]}>{info.text}</Text>
            {against && <Text style={styles.tfChipIcon}>{'\u26A0'}</Text>}
            {favor && <Text style={styles.tfChipIcon}>{'\u2713'}</Text>}
          </View>
        );
      })}
    </View>
  );
};

const FibonacciSection = ({ fib, currentPrice, entryPrice, side }) => {
  if (!fib || !fib.levels) return null;
  const levels = fib.levels;
  const high = fib.swing_high;
  const low = fib.swing_low;
  const isShort = side === 'short' || side === 'SHORT';

  return (
    <View style={styles.fibSection}>
      <View style={styles.fibSwingRow}>
        <Text style={styles.fibSwingLabel}>Rango: {formatPrice(low)} - {formatPrice(high)}</Text>
        <Text style={styles.fibSwingTrend}>{fib.is_uptrend ? 'Tendencia \u2191' : 'Tendencia \u2193'}</Text>
      </View>
      <View style={styles.fibLevels}>
        {FIB_LEVELS_DISPLAY.map(({ key, color }) => {
          const price = levels[key];
          if (price == null) return null;
          const isCurrent = currentPrice && Math.abs(currentPrice - price) / currentPrice < 0.005;
          const isEntry = entryPrice && Math.abs(entryPrice - price) / entryPrice < 0.005;
          const isAbove = currentPrice > price;
          let relevance = '#444';
          if (isShort) { relevance = isAbove ? color : '#333'; }
          else { relevance = isAbove ? '#333' : color; }
          return (
            <View key={key} style={styles.fibLevelRow}>
              <Text style={[styles.fibLevelName, { color }]}>{key}%</Text>
              <View style={styles.fibBarContainer}>
                <View style={[styles.fibBarFill, { backgroundColor: relevance, width: '100%' }]} />
                {isCurrent && <View style={styles.fibCurrentDot} />}
                {isEntry && <View style={styles.fibEntryDot} />}
              </View>
              <Text style={[styles.fibLevelPrice, isCurrent && { color: '#fff', fontWeight: 'bold' }]}>
                {formatPrice(price)}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={styles.fibLegend}>
        <View style={styles.fibLegendItem}>
          <View style={[styles.fibLegendDot, { backgroundColor: '#fff' }]} />
          <Text style={styles.fibLegendText}>Actual</Text>
        </View>
        <View style={styles.fibLegendItem}>
          <View style={[styles.fibLegendDot, { backgroundColor: '#ffd93d' }]} />
          <Text style={styles.fibLegendText}>Entrada</Text>
        </View>
      </View>
      {fib.at_key_level && (
        <View style={styles.fibNoteBox}>
          <Text style={styles.fibNoteText}>En nivel clave Fib {fib.key_level_name}%</Text>
        </View>
      )}
      {!fib.at_key_level && fib.near_key_level && (
        <View style={[styles.fibNoteBox, { borderLeftColor: '#ffd93d' }]}>
          <Text style={styles.fibNoteText}>Cerca de Fib {fib.key_level_name}%</Text>
        </View>
      )}
    </View>
  );
};

const cleanSymbol = (s) => s ? s.split(':')[0] : s;

const PositionCard = ({ position }) => {
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [selectedTF, setSelectedTF] = useState('1h');

  const isLong = position.side === 'long';
  const pnl = position.unrealized_pnl || 0;
  const pnlPercent = position.entry_price
    ? ((position.current_price - position.entry_price) / position.entry_price * 100 * (isLong ? 1 : -1))
    : 0;
  const pnlColor = pnl >= 0 ? '#00d4aa' : '#ff4757';
  const sideColor = isLong ? '#00d4aa' : '#ff4757';
  const displaySymbol = cleanSymbol(position.symbol);
  const liqPrice = position.liquidation_price && position.liquidation_price > 0 ? position.liquidation_price : null;

  const timeframes = position.timeframes || {};
  const ind = timeframes[selectedTF] || {};
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
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.symbol}>{displaySymbol}</Text>
          <View style={[styles.sideBadge, { backgroundColor: sideColor + '30', borderColor: sideColor }]}>
            <Text style={[styles.sideText, { color: sideColor }]}>{isLong ? 'LONG' : 'SHORT'}</Text>
          </View>
          {position.leverage > 1 && (
            <View style={styles.leverageBadge}>
              <Text style={styles.leverageText}>{position.leverage}x</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.sentimentBadge, { backgroundColor: sentimentInfo.color + '20', borderColor: sentimentInfo.color }]}>
            <Text style={[styles.sentimentText, { color: sentimentInfo.color }]}>{sentimentInfo.text}</Text>
          </View>
          {position.mode === 'bot' && <Text style={styles.modeIcon}>{'\u{1F916}'}</Text>}
        </View>
      </View>

      {/* PRECIOS + PNL */}
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
        <View style={styles.detailRow}>
          {liqPrice != null && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Liquidaci{'\u00F3'}n</Text>
              <Text style={styles.detailValue}>{formatPrice(liqPrice)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* SL / TP */}
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

      {/* MULTI-TIMEFRAME SUMMARY */}
      <MultiTFSummary timeframes={timeframes} side={position.side} />

      {/* TIMEFRAME SELECTOR + INDICATORS */}
      <View style={styles.indicatorsSection}>
        <View style={styles.tfSelector}>
          {TIMEFRAMES.map((tf) => (
            <TouchableOpacity
              key={tf}
              style={[styles.tfTab, selectedTF === tf && styles.tfTabActive]}
              onPress={() => setSelectedTF(tf)}
            >
              <Text style={[styles.tfTabText, selectedTF === tf && styles.tfTabTextActive]}>{tf}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {ind.rsi != null ? (
          <>
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
                {ind.price_above_ema ? 'Por encima \u2713' : 'Por debajo \u2717'}
              </Text>
            </View>
            <View style={styles.indicatorRow}>
              <Text style={styles.indicatorLabel}>Volumen</Text>
              <Text style={[styles.indicatorValue, { color: ind.volume_above_average ? '#ffd93d' : '#888' }]}>
                {ind.volume_above_average ? 'Sobre promedio' : 'Normal'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.noData}>Sin datos para {selectedTF}</Text>
        )}
      </View>

      {/* FIBONACCI for selected TF */}
      {ind.fibonacci && (
        <View style={styles.fibWrapper}>
          <Text style={styles.sectionTitle}>Fibonacci ({selectedTF})</Text>
          <FibonacciSection fib={ind.fibonacci} currentPrice={current} entryPrice={position.entry_price} side={position.side} />
        </View>
      )}

      {/* RECOMENDACIÓN */}
      {position.suggestion && (
        <View style={[styles.suggestionBox, { borderLeftColor: riskColor }]}>
          <View style={styles.suggestionTitleRow}>
            <Text style={styles.suggestionTitle}>{'Recomendaci\u00F3n'}</Text>
            <View style={[styles.riskBadge, { backgroundColor: riskColor + '25' }]}>
              <Text style={[styles.riskBadgeText, { color: riskColor }]}>
                {position.risk_level === 'high' ? 'Riesgo alto' : position.risk_level === 'medium' ? 'Riesgo medio' : 'Riesgo bajo'}
              </Text>
            </View>
          </View>
          <Text style={styles.suggestionText}>{position.suggestion}</Text>
        </View>
      )}

      {/* ALERTAS */}
      <TouchableOpacity style={styles.alertsToggle} onPress={() => setShowAlerts(!showAlerts)}>
        <Text style={styles.alertsToggleText}>{showAlerts ? '\u25BC Alertas' : '\u25B6 Alertas'}</Text>
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
                  {alert.was_executed && <Text style={styles.alertExecuted}>{'Ejecutado \u2713'}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}
      {showAlerts && alerts.length === 0 && <Text style={styles.noAlerts}>Sin alertas recientes</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  symbol: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  sideBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  sideText: { fontSize: 12, fontWeight: 'bold' },
  leverageBadge: { backgroundColor: '#2a2a4a', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  leverageText: { color: '#888', fontSize: 11, fontWeight: 'bold' },
  modeIcon: { fontSize: 18 },
  sentimentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  sentimentText: { fontSize: 11, fontWeight: 'bold' },
  // Price
  priceBox: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10 },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  priceCol: { flex: 1 },
  priceLabel: { color: '#666', fontSize: 11, marginBottom: 2 },
  priceValue: { color: '#fff', fontSize: 15, fontWeight: '600' },
  arrow: { color: '#444', fontSize: 16, marginHorizontal: 6 },
  pnlBox: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, minWidth: 80 },
  pnlBoxLabel: { color: '#888', fontSize: 10, fontWeight: '600' },
  pnlBoxValue: { fontSize: 14, fontWeight: 'bold' },
  pnlBoxPercent: { fontSize: 11 },
  detailRow: { flexDirection: 'row', marginTop: 8, gap: 16 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailLabel: { color: '#555', fontSize: 11 },
  detailValue: { color: '#ff6b81', fontSize: 11, fontWeight: '600' },
  // SL/TP
  slTpSection: { marginBottom: 10 },
  slTpLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  slLabel: { color: '#ff4757', fontSize: 11 },
  tpLabel: { color: '#00d4aa', fontSize: 11 },
  progressBar: { height: 6, backgroundColor: '#2a2a4a', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#00d4aa', borderRadius: 3, justifyContent: 'center', alignItems: 'flex-end' },
  progressMarker: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', marginRight: -5 },
  // Multi-TF summary
  tfSummary: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 10 },
  tfChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1 },
  tfChipLabel: { color: '#888', fontSize: 11, fontWeight: 'bold' },
  tfChipValue: { fontSize: 11, fontWeight: '600' },
  tfChipIcon: { fontSize: 10 },
  tfDot: { width: 6, height: 6, borderRadius: 3 },
  // TF selector + indicators
  indicatorsSection: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10 },
  tfSelector: { flexDirection: 'row', marginBottom: 10, gap: 4 },
  tfTab: { flex: 1, paddingVertical: 6, borderRadius: 6, backgroundColor: '#1a1a2e', alignItems: 'center' },
  tfTabActive: { backgroundColor: '#00d4aa20' },
  tfTabText: { color: '#666', fontSize: 12, fontWeight: '600' },
  tfTabTextActive: { color: '#00d4aa' },
  sectionTitle: { color: '#888', fontSize: 11, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  indicatorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  indicatorLabel: { color: '#999', fontSize: 13, width: 60 },
  indicatorValue: { fontSize: 13, fontWeight: '600' },
  noData: { color: '#555', fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  rsiContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rsiBar: { flex: 1, height: 6, backgroundColor: '#2a2a4a', borderRadius: 3, overflow: 'hidden' },
  rsiFill: { height: '100%', borderRadius: 3 },
  rsiValue: { fontSize: 13, fontWeight: 'bold', width: 30, textAlign: 'right' },
  // Fibonacci
  fibWrapper: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10 },
  fibSection: {},
  fibSwingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  fibSwingLabel: { color: '#666', fontSize: 11 },
  fibSwingTrend: { color: '#888', fontSize: 11, fontWeight: '600' },
  fibLevels: { gap: 6 },
  fibLevelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fibLevelName: { fontSize: 11, fontWeight: 'bold', width: 38, textAlign: 'right' },
  fibBarContainer: { flex: 1, height: 8, backgroundColor: '#1a1a2e', borderRadius: 4, overflow: 'hidden', justifyContent: 'center' },
  fibBarFill: { height: '100%', borderRadius: 4, opacity: 0.4 },
  fibCurrentDot: { position: 'absolute', right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  fibEntryDot: { position: 'absolute', left: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ffd93d' },
  fibLevelPrice: { color: '#666', fontSize: 11, width: 70, textAlign: 'right' },
  fibLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#1a1a2e' },
  fibLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fibLegendDot: { width: 6, height: 6, borderRadius: 3 },
  fibLegendText: { color: '#666', fontSize: 10 },
  fibNoteBox: { marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#ffd93d15', borderRadius: 6, borderLeftWidth: 2, borderLeftColor: '#ffa502' },
  fibNoteText: { color: '#ffd93d', fontSize: 12, fontWeight: '600' },
  // Suggestion
  suggestionBox: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 3 },
  suggestionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  suggestionTitle: { color: '#888', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  riskBadgeText: { fontSize: 10, fontWeight: 'bold' },
  suggestionText: { color: '#ddd', fontSize: 13, lineHeight: 18 },
  // Alerts
  alertsToggle: { paddingVertical: 6 },
  alertsToggleText: { color: '#888', fontSize: 13 },
  alertsList: { marginTop: 8 },
  alertItem: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#0f0f1a', borderRadius: 8, padding: 10, marginBottom: 6, borderLeftWidth: 3 },
  alertIcon: { fontSize: 14, marginRight: 8, marginTop: 1 },
  alertContent: { flex: 1 },
  alertMessage: { color: '#ccc', fontSize: 13 },
  alertExecuted: { color: '#00d4aa', fontSize: 11, marginTop: 4, fontWeight: '600' },
  noAlerts: { color: '#555', fontSize: 13, textAlign: 'center', paddingVertical: 8 },
});

export default PositionCard;

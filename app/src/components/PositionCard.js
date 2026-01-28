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

const COHERENCE_STYLES = {
  a_favor: { label: 'A favor', color: '#00d4aa', icon: '\u2713' },
  contra: { label: 'Contra contexto', color: '#ff4757', icon: '\u26A0' },
  neutral: { label: 'Neutral', color: '#888', icon: '\u2022' },
  invalidated: { label: 'INVALIDADO', color: '#ff4757', icon: '\u2717' },
};

const BIAS_STYLES = {
  alcista: { color: '#00d4aa' },
  bajista: { color: '#ff4757' },
  mixto: { color: '#ffd93d' },
  rango: { color: '#ffd93d' },
  neutral: { color: '#888' },
};

const RISK_COLORS = {
  low: '#00d4aa',
  medium: '#ffd93d',
  high: '#ff4757',
};

const SENTIMENT_STYLES = {
  bullish: { label: 'Alcista', color: '#00d4aa', icon: '\u2191' },
  bearish: { label: 'Bajista', color: '#ff4757', icon: '\u2193' },
  neutral: { label: 'Neutral', color: '#888', icon: '\u2022' },
};

const TIMEFRAMES = ['15m', '1h', '4h'];

const cleanSymbol = (s) => s ? s.split(':')[0] : s;

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

const PositionCard = ({ position }) => {
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [selectedTF, setSelectedTF] = useState('4h');
  const [expanded, setExpanded] = useState(true);
  const [showIndicators, setShowIndicators] = useState(false);

  const isLong = position.side?.toUpperCase() === 'LONG';
  const pnl = position.unrealized_pnl || 0;
  const pnlPercent = position.entry_price
    ? ((position.current_price - position.entry_price) / position.entry_price * 100 * (isLong ? 1 : -1))
    : 0;
  const pnlColor = pnl >= 0 ? '#00d4aa' : '#ff4757';
  const sideColor = isLong ? '#00d4aa' : '#ff4757';
  const displaySymbol = cleanSymbol(position.symbol);
  const liqPrice = position.liquidation_price && position.liquidation_price > 0 ? position.liquidation_price : null;
  const current = position.current_price;

  const analysis = position.analysis || {};
  const isInvalidated = analysis.invalidation_breached === true;
  const coherenceStyle = isInvalidated
    ? COHERENCE_STYLES.invalidated
    : (COHERENCE_STYLES[analysis.coherence] || COHERENCE_STYLES.neutral);
  const biasStyle = BIAS_STYLES[analysis.htf_bias] || BIAS_STYLES.neutral;

  const timeframes = position.timeframes || {};
  const ind = timeframes[selectedTF] || {};

  useEffect(() => {
    if (showAlerts && alerts.length === 0) {
      getPositionAlerts(position.symbol)
        .then((data) => setAlerts(data.alerts || []))
        .catch(() => {});
    }
  }, [showAlerts]);

  // Distance to liquidation
  const liqDistance = liqPrice && current
    ? ((Math.abs(current - liqPrice) / current) * 100).toFixed(1)
    : null;

  // Distance to invalidation
  const invLevel = analysis.invalidation_level;
  const invDistance = invLevel && current
    ? ((Math.abs(current - invLevel) / current) * 100).toFixed(1)
    : null;

  return (
    <View style={styles.card}>
      {/* HEADER */}
      <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded(!expanded)}>
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
            {!expanded && (
              <Text style={[styles.collapsedPnl, { color: pnlColor }]}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
              </Text>
            )}
            <View style={[styles.coherenceBadge, { backgroundColor: coherenceStyle.color + '20', borderColor: coherenceStyle.color }]}>
              <Text style={styles.coherenceIcon}>{coherenceStyle.icon}</Text>
              <Text style={[styles.coherenceText, { color: coherenceStyle.color }]}>{coherenceStyle.label}</Text>
            </View>
            <Text style={styles.expandIcon}>{expanded ? '\u25B2' : '\u25BC'}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {!expanded ? null : <>

      {/* 1. ESTADO FACTUAL */}
      <View style={styles.section}>
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
          {position.initial_margin > 0 && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Margen</Text>
              <Text style={styles.detailValueNeutral}>${position.initial_margin.toFixed(2)}</Text>
            </View>
          )}
          {liqPrice != null && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Liquidaci{'\u00F3'}n</Text>
              <Text style={styles.detailValueDanger}>{formatPrice(liqPrice)} ({liqDistance}%)</Text>
            </View>
          )}
          {invLevel != null && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Invalidaci{'\u00F3'}n</Text>
              <Text style={styles.detailValueWarning}>{formatPrice(invLevel)} ({invDistance}%)</Text>
            </View>
          )}
        </View>
      </View>

      {/* 2. CONTEXTO HTF */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONTEXTO DE MERCADO (4H)</Text>
        <View style={styles.contextRow}>
          <View style={styles.contextItem}>
            <Text style={styles.contextLabel}>Sesgo HTF</Text>
            <Text style={[styles.contextValue, { color: biasStyle.color }]}>
              {(analysis.htf_bias || 'neutral').toUpperCase()}
            </Text>
          </View>
          <View style={styles.contextItem}>
            <Text style={styles.contextLabel}>Estructura</Text>
            <Text style={styles.contextValue}>{analysis.htf_structure || '-'}</Text>
          </View>
          <View style={styles.contextItem}>
            <Text style={styles.contextLabel}>Momentum LTF</Text>
            <Text style={[styles.contextValue, { color: BIAS_STYLES[analysis.ltf_momentum]?.color || '#888' }]}>
              {(analysis.ltf_momentum || 'neutral').toUpperCase()}
            </Text>
          </View>
        </View>
      </View>

      {/* 2.5 SUGERENCIA */}
      {analysis.suggestion && (
        <View style={[styles.suggestionBox, { borderLeftColor: RISK_COLORS[analysis.risk_level] || '#888' }]}>
          <View style={styles.suggestionHeader}>
            <Text style={styles.suggestionLabel}>SUGERENCIA</Text>
            {analysis.market_sentiment && (
              <View style={[styles.sentimentBadge, { backgroundColor: (SENTIMENT_STYLES[analysis.market_sentiment]?.color || '#888') + '20' }]}>
                <Text style={[styles.sentimentText, { color: SENTIMENT_STYLES[analysis.market_sentiment]?.color || '#888' }]}>
                  {SENTIMENT_STYLES[analysis.market_sentiment]?.icon} {SENTIMENT_STYLES[analysis.market_sentiment]?.label}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.suggestionText, { color: RISK_COLORS[analysis.risk_level] || '#ccc' }]}>
            {analysis.suggestion}
          </Text>
        </View>
      )}

      {/* 3. COHERENCIA TRADE vs CONTEXTO */}
      <View style={[styles.coherenceBox, { borderLeftColor: coherenceStyle.color }]}>
        <Text style={[styles.coherenceMainText, { color: coherenceStyle.color }]}>
          {analysis.coherence_text || 'Sin datos de coherencia'}
        </Text>
      </View>

      {/* 4. OBSERVACIONES FACTUALES */}
      {analysis.observations && analysis.observations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>OBSERVACIONES</Text>
          {analysis.observations.map((obs, i) => (
            <View key={i} style={styles.observationRow}>
              <Text style={styles.observationBullet}>{'\u2022'}</Text>
              <Text style={styles.observationText}>{obs}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 5. ESTADO DE LA TESIS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ESTADO DE LA TESIS</Text>

        {analysis.invalidation_breached && (
          <View style={styles.breachedWarning}>
            <Text style={styles.breachedIcon}>{'\u26A0'}</Text>
            <Text style={styles.breachedText}>TESIS INVALIDADA</Text>
          </View>
        )}

        {analysis.thesis_status ? (
          <View style={[styles.scenarioBox, { borderLeftColor: analysis.invalidation_breached ? '#ff4757' : '#00d4aa' }]}>
            <Text style={styles.scenarioLabel}>
              {analysis.invalidation_breached ? 'Estado actual' : 'Tesis'}
            </Text>
            <Text style={styles.scenarioText}>{analysis.thesis_status}</Text>
          </View>
        ) : null}

        {analysis.invalidation_breached && analysis.recovery_condition ? (
          <View style={[styles.scenarioBox, { borderLeftColor: '#ffd93d' }]}>
            <Text style={styles.scenarioLabel}>Condici{'\u00F3'}n de recuperaci{'\u00F3'}n</Text>
            <Text style={styles.scenarioText}>{analysis.recovery_condition}</Text>
          </View>
        ) : null}

        {!analysis.invalidation_breached && analysis.invalidation_condition ? (
          <View style={[styles.scenarioBox, { borderLeftColor: '#ff4757' }]}>
            <Text style={styles.scenarioLabel}>Condici{'\u00F3'}n de invalidaci{'\u00F3'}n</Text>
            <Text style={styles.scenarioText}>{analysis.invalidation_condition}</Text>
          </View>
        ) : null}
      </View>

      {/* 6. NIVELES CLAVE */}
      {analysis.key_levels && analysis.key_levels.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NIVELES CLAVE</Text>
          <View style={styles.levelsRow}>
            {analysis.key_levels.map((level, i) => (
              <View key={i} style={styles.levelChip}>
                <Text style={styles.levelName}>{level.name}</Text>
                <Text style={styles.levelPrice}>{formatPrice(level.price)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 7. INDICADORES POR TIMEFRAME (colapsable) */}
      <TouchableOpacity onPress={() => setShowIndicators(!showIndicators)}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleText}>
            {showIndicators ? '\u25BC' : '\u25B6'} Indicadores t{'\u00E9'}cnicos
          </Text>
        </View>
      </TouchableOpacity>

      {showIndicators && (
        <View style={styles.indicatorsSection}>
          <View style={styles.tfSelector}>
            {TIMEFRAMES.map((tf) => {
              const tfData = timeframes[tf];
              const s = tfData?.sentiment;
              const color = s === 'bullish' ? '#00d4aa' : s === 'bearish' ? '#ff4757' : '#888';
              const isActive = selectedTF === tf;
              return (
                <TouchableOpacity
                  key={tf}
                  style={[styles.tfTab, isActive && { backgroundColor: color + '20' }]}
                  onPress={() => setSelectedTF(tf)}
                >
                  <View style={[styles.tfDotIndicator, { backgroundColor: color }]} />
                  <Text style={[styles.tfTabText, isActive && { color }]}>{tf}</Text>
                </TouchableOpacity>
              );
            })}
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
                  {ind.price_above_ema ? 'Por encima' : 'Por debajo'}
                </Text>
              </View>
              <View style={styles.indicatorRow}>
                <Text style={styles.indicatorLabel}>Volumen</Text>
                <Text style={[styles.indicatorValue, { color: ind.volume_above_average ? '#ffd93d' : '#888' }]}>
                  {ind.volume_above_average ? 'Sobre promedio' : 'Normal'}
                </Text>
              </View>
              {ind.fibonacci && (
                <View style={styles.indicatorRow}>
                  <Text style={styles.indicatorLabel}>Fibo</Text>
                  <Text style={[styles.indicatorValue, { color: ind.fibonacci.is_uptrend ? '#00d4aa' : '#ff4757' }]}>
                    {ind.fibonacci.is_uptrend ? 'Tendencia \u2191' : 'Tendencia \u2193'}
                    {ind.fibonacci.closest_level_name ? ` \u2022 ${ind.fibonacci.closest_level_name}%` : ''}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <Text style={styles.noData}>Sin datos para {selectedTF}</Text>
          )}
        </View>
      )}

      {/* ALERTAS */}
      <TouchableOpacity style={styles.alertsToggle} onPress={() => setShowAlerts(!showAlerts)}>
        <Text style={styles.alertsToggleText}>{showAlerts ? '\u25BC Alertas' : '\u25B6 Alertas'}</Text>
      </TouchableOpacity>
      {showAlerts && alerts.length > 0 && (
        <View style={styles.alertsList}>
          {alerts.map((alert, i) => (
            <View key={alert.id || i} style={styles.alertItem}>
              <Text style={styles.alertMessage}>{alert.message}</Text>
            </View>
          ))}
        </View>
      )}
      {showAlerts && alerts.length === 0 && <Text style={styles.noAlerts}>Sin alertas recientes</Text>}

      </>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 12 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  symbol: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  sideBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  sideText: { fontSize: 12, fontWeight: 'bold' },
  leverageBadge: { backgroundColor: '#2a2a4a', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  leverageText: { color: '#888', fontSize: 11, fontWeight: 'bold' },
  collapsedPnl: { fontSize: 13, fontWeight: 'bold' },
  expandIcon: { color: '#555', fontSize: 10 },
  coherenceBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, gap: 4 },
  coherenceIcon: { fontSize: 10 },
  coherenceText: { fontSize: 10, fontWeight: 'bold' },

  // Sections
  section: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10 },
  sectionTitle: { color: '#666', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },

  // Price row
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  priceCol: { flex: 1 },
  priceLabel: { color: '#666', fontSize: 11, marginBottom: 2 },
  priceValue: { color: '#fff', fontSize: 15, fontWeight: '600' },
  arrow: { color: '#444', fontSize: 16, marginHorizontal: 6 },
  pnlBox: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, minWidth: 80 },
  pnlBoxLabel: { color: '#888', fontSize: 10, fontWeight: '600' },
  pnlBoxValue: { fontSize: 14, fontWeight: 'bold' },
  pnlBoxPercent: { fontSize: 11 },

  // Detail row
  detailRow: { flexDirection: 'row', marginTop: 10, gap: 16, flexWrap: 'wrap' },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailLabel: { color: '#555', fontSize: 11 },
  detailValueNeutral: { color: '#ccc', fontSize: 11, fontWeight: '600' },
  detailValueDanger: { color: '#ff4757', fontSize: 11, fontWeight: '600' },
  detailValueWarning: { color: '#ffd93d', fontSize: 11, fontWeight: '600' },

  // Context
  contextRow: { flexDirection: 'row', justifyContent: 'space-between' },
  contextItem: { alignItems: 'center', flex: 1 },
  contextLabel: { color: '#666', fontSize: 10, marginBottom: 4 },
  contextValue: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Coherence box
  coherenceBox: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 3 },
  coherenceMainText: { fontSize: 13, fontWeight: '600' },

  // Suggestion box
  suggestionBox: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 3 },
  suggestionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  suggestionLabel: { color: '#666', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  suggestionText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  sentimentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  sentimentText: { fontSize: 11, fontWeight: '600' },

  // Observations
  observationRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'flex-start' },
  observationBullet: { color: '#666', fontSize: 12, marginRight: 6, marginTop: 1 },
  observationText: { color: '#aaa', fontSize: 12, flex: 1, lineHeight: 18 },

  // Scenarios
  breachedWarning: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff475720', borderRadius: 8, padding: 10, marginBottom: 10, gap: 8 },
  breachedIcon: { fontSize: 16 },
  breachedText: { color: '#ff4757', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  scenarioBox: { backgroundColor: '#0a0a14', borderRadius: 8, padding: 10, marginBottom: 8, borderLeftWidth: 3 },
  scenarioLabel: { color: '#888', fontSize: 10, fontWeight: '700', marginBottom: 4 },
  scenarioText: { color: '#ccc', fontSize: 12, lineHeight: 18 },

  // Levels
  levelsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  levelChip: { backgroundColor: '#1a1a2e', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: 'center' },
  levelName: { color: '#888', fontSize: 10 },
  levelPrice: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Toggle
  toggleRow: { paddingVertical: 8 },
  toggleText: { color: '#888', fontSize: 13 },

  // Indicators
  indicatorsSection: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, marginBottom: 10 },
  tfSelector: { flexDirection: 'row', marginBottom: 10, gap: 4 },
  tfTab: { flex: 1, flexDirection: 'row', paddingVertical: 6, borderRadius: 6, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', gap: 5 },
  tfTabText: { color: '#666', fontSize: 12, fontWeight: '600' },
  tfDotIndicator: { width: 6, height: 6, borderRadius: 3 },
  indicatorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  indicatorLabel: { color: '#999', fontSize: 13, width: 60 },
  indicatorValue: { fontSize: 13, fontWeight: '600' },
  noData: { color: '#555', fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  rsiContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rsiBar: { flex: 1, height: 6, backgroundColor: '#2a2a4a', borderRadius: 3, overflow: 'hidden' },
  rsiFill: { height: '100%', borderRadius: 3 },
  rsiValue: { fontSize: 13, fontWeight: 'bold', width: 30, textAlign: 'right' },

  // Alerts
  alertsToggle: { paddingVertical: 6 },
  alertsToggleText: { color: '#888', fontSize: 13 },
  alertsList: { marginTop: 8 },
  alertItem: { backgroundColor: '#0f0f1a', borderRadius: 8, padding: 10, marginBottom: 6 },
  alertMessage: { color: '#ccc', fontSize: 13 },
  noAlerts: { color: '#555', fontSize: 13, textAlign: 'center', paddingVertical: 8 },
});

export default PositionCard;

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

// Scenario classification styles
const SCENARIO_STYLES = {
  favorable: { label: 'Favorable', color: '#00d4aa', bg: '#00d4aa20' },
  operable: { label: 'Operable', color: '#ffd93d', bg: '#ffd93d20' },
  alto_riesgo: { label: 'Alto Riesgo', color: '#ff4757', bg: '#ff475720' },
  espera: { label: 'Espera', color: '#888', bg: '#88888820' },
};

// HTF bias styles
const BIAS_STYLES = {
  alcista: { label: 'Alcista', color: '#00d4aa', icon: '↑' },
  bajista: { label: 'Bajista', color: '#ff4757', icon: '↓' },
  mixto: { label: 'Mixto', color: '#ffd93d', icon: '↔' },
  neutral: { label: 'Neutral', color: '#888', icon: '−' },
};

// LTF momentum styles
const MOMENTUM_STYLES = {
  alcista: { label: 'Alcista', color: '#00d4aa', icon: '↑' },
  bajista: { label: 'Bajista', color: '#ff4757', icon: '↓' },
  neutral: { label: 'Neutral', color: '#888', icon: '−' },
};

const PairCard = ({ pair, data, onPress, embedded = false, unified = false }) => {
  const cardStyle = embedded ? styles.cardEmbedded : styles.card;

  if (!data) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.pair}>{pair}</Text>
        <Text style={styles.loading}>Cargando...</Text>
      </TouchableOpacity>
    );
  }

  const { price, analysis, htf_indicators, ltf_indicators, funding } = data;

  const formatPrice = (p) => {
    if (p == null) return '$0.00';
    const decimals = p < 1 ? 4 : p < 10 ? 3 : 2;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(p);
  };

  const formatPriceShort = (p) => {
    if (p == null) return '$0';
    if (p < 0.01) return `$${p.toFixed(6)}`;
    if (p < 1) return `$${p.toFixed(4)}`;
    if (p < 10) return `$${p.toFixed(3)}`;
    if (p < 1000) return `$${p.toFixed(2)}`;
    return `$${p.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  };

  // Get scenario styles
  const scenario = analysis?.scenario || 'espera';
  const scenarioStyle = SCENARIO_STYLES[scenario] || SCENARIO_STYLES.espera;

  // Get context (4H) styles
  const htfBias = analysis?.context?.htf_bias || 'neutral';
  const biasStyle = BIAS_STYLES[htfBias] || BIAS_STYLES.neutral;

  // Get timing (15m) styles
  const ltfMomentum = analysis?.timing?.ltf_momentum || 'neutral';
  const momentumStyle = MOMENTUM_STYLES[ltfMomentum] || MOMENTUM_STYLES.neutral;
  const hasConfirmation = analysis?.timing?.has_confirmation || false;

  // Direction preference
  const directionPref = analysis?.direction_preference;

  return (
    <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
      {/* Header only if not embedded */}
      {!embedded && (
        <View style={styles.header}>
          <View>
            <Text style={styles.pair}>{pair}</Text>
            <Text style={styles.tapHint}>Toca para ver detalles</Text>
          </View>
          <Text style={styles.price}>{formatPrice(price)}</Text>
        </View>
      )}

      {analysis ? (
        <>
          {/* SCENARIO + UNIFIED READING (top priority) */}
          <View style={[styles.scenarioBadge, { backgroundColor: scenarioStyle.bg, borderColor: scenarioStyle.color }]}>
            <View style={styles.scenarioHeader}>
              <Text style={[styles.scenarioLabel, { color: scenarioStyle.color }]}>
                {scenarioStyle.label.toUpperCase()}
              </Text>
              {directionPref && (
                <View style={[styles.directionBadge, {
                  backgroundColor: directionPref === 'long' ? '#00d4aa30' : '#ff475730',
                  borderColor: directionPref === 'long' ? '#00d4aa' : '#ff4757',
                }]}>
                  <Text style={[styles.directionText, {
                    color: directionPref === 'long' ? '#00d4aa' : '#ff4757'
                  }]}>
                    {directionPref === 'long' ? 'LONG' : 'SHORT'}
                  </Text>
                </View>
              )}
            </View>
            {/* Unified Reading - the main interpretation */}
            {analysis.unified_reading && (
              <Text style={styles.unifiedReading}>{analysis.unified_reading}</Text>
            )}
            <Text style={styles.scenarioReason}>{analysis.scenario_reason}</Text>
          </View>

          {/* TWO-LAYER ANALYSIS: Context (4H) + Timing (15m) */}
          <View style={styles.layersContainer}>
            {/* CONTEXT LAYER (4H) */}
            <View style={styles.layerBox}>
              <View style={styles.layerHeader}>
                <Text style={styles.layerTitle}>CONTEXTO</Text>
                <View style={styles.tfBadge}>
                  <Text style={styles.tfBadgeText}>4H</Text>
                </View>
              </View>
              <View style={styles.layerContent}>
                <View style={styles.layerItem}>
                  <Text style={styles.layerLabel}>Sesgo</Text>
                  <View style={[styles.valueBadge, { borderColor: biasStyle.color }]}>
                    <Text style={[styles.valueText, { color: biasStyle.color }]}>
                      {biasStyle.icon} {biasStyle.label}
                    </Text>
                  </View>
                </View>
                <View style={styles.layerItem}>
                  <Text style={styles.layerLabel}>Estructura</Text>
                  <Text style={styles.valueTextPlain}>
                    {analysis.context?.htf_structure?.replace(/_/g, ' ') || 'Sin datos'}
                  </Text>
                </View>
                <View style={styles.layerItem}>
                  <Text style={styles.layerLabel}>Volatilidad</Text>
                  <Text style={[styles.valueTextPlain, {
                    color: analysis.context?.volatility_state === 'alta' ? '#ff4757' :
                           analysis.context?.volatility_state === 'baja' ? '#ffd93d' : '#888'
                  }]}>
                    {analysis.context?.volatility_state?.charAt(0).toUpperCase() +
                     analysis.context?.volatility_state?.slice(1) || 'Normal'}
                  </Text>
                </View>
              </View>
            </View>

            {/* TIMING LAYER (15m) */}
            <View style={styles.layerBox}>
              <View style={styles.layerHeader}>
                <Text style={styles.layerTitle}>TIMING</Text>
                <View style={[styles.tfBadge, { backgroundColor: '#ff9f4320', borderColor: '#ff9f43' }]}>
                  <Text style={[styles.tfBadgeText, { color: '#ff9f43' }]}>15m</Text>
                </View>
              </View>
              <View style={styles.layerContent}>
                <View style={styles.layerItem}>
                  <Text style={styles.layerLabel}>Momentum</Text>
                  <View style={[styles.valueBadge, { borderColor: momentumStyle.color }]}>
                    <Text style={[styles.valueText, { color: momentumStyle.color }]}>
                      {momentumStyle.icon} {momentumStyle.label}
                    </Text>
                  </View>
                </View>
                <View style={styles.layerItem}>
                  <Text style={styles.layerLabel}>RSI</Text>
                  <Text style={[styles.valueTextPlain, {
                    color: analysis.timing?.rsi_zone === 'sobrecompra' ? '#ff4757' :
                           analysis.timing?.rsi_zone === 'sobrevendido' ? '#00d4aa' : '#888'
                  }]}>
                    {analysis.timing?.rsi_zone?.charAt(0).toUpperCase() +
                     analysis.timing?.rsi_zone?.slice(1) || 'N/A'}
                  </Text>
                </View>
                <View style={styles.layerItem}>
                  <Text style={styles.layerLabel}>Confirmacion</Text>
                  <Text style={[styles.valueTextPlain, {
                    color: hasConfirmation ? '#00d4aa' : '#666'
                  }]}>
                    {hasConfirmation ? 'Si' : 'No'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Observations */}
          {analysis.observations && analysis.observations.length > 0 && (
            <View style={styles.observations}>
              {analysis.observations.slice(0, 4).map((obs, idx) => (
                <View key={idx} style={styles.observationItem}>
                  <Text style={styles.observationBullet}>•</Text>
                  <Text style={styles.observationText}>{obs}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Funding Rate */}
          {analysis.funding && (
            <View style={styles.fundingRow}>
              <Text style={styles.fundingLabel}>Funding</Text>
              <Text style={[styles.fundingValue, {
                color: analysis.funding.rate_percent > 0.01 ? '#ff4757' :
                       analysis.funding.rate_percent < -0.01 ? '#00d4aa' : '#888'
              }]}>
                {analysis.funding.rate_percent >= 0 ? '+' : ''}{analysis.funding.rate_percent?.toFixed(4)}%
              </Text>
            </View>
          )}

          {/* Key Levels */}
          {analysis.key_levels && analysis.key_levels.length > 0 && (
            <View style={styles.levelsContainer}>
              <Text style={styles.levelsTitle}>Niveles Clave</Text>
              <View style={styles.levelsRow}>
                {analysis.key_levels.slice(0, 3).map((level, idx) => (
                  <View key={idx} style={styles.levelItem}>
                    <Text style={styles.levelLabel}>{level.name}</Text>
                    <Text style={styles.levelPrice}>{formatPriceShort(level.price)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Raw Indicators */}
          <View style={styles.indicatorsRow}>
            {htf_indicators?.rsi != null && (
              <View style={styles.indicatorChip}>
                <Text style={styles.indicatorChipLabel}>RSI 4H</Text>
                <Text style={[styles.indicatorChipValue, {
                  color: htf_indicators.rsi > 70 ? '#ff4757' : htf_indicators.rsi < 30 ? '#00d4aa' : '#fff'
                }]}>
                  {htf_indicators.rsi.toFixed(0)}
                </Text>
              </View>
            )}
            {ltf_indicators?.rsi != null && (
              <View style={styles.indicatorChip}>
                <Text style={styles.indicatorChipLabel}>RSI 15m</Text>
                <Text style={[styles.indicatorChipValue, {
                  color: ltf_indicators.rsi > 70 ? '#ff4757' : ltf_indicators.rsi < 30 ? '#00d4aa' : '#fff'
                }]}>
                  {ltf_indicators.rsi.toFixed(0)}
                </Text>
              </View>
            )}
            {ltf_indicators?.volume_ratio != null && (
              <View style={styles.indicatorChip}>
                <Text style={styles.indicatorChipLabel}>Vol</Text>
                <Text style={[styles.indicatorChipValue, {
                  color: ltf_indicators.volume_ratio > 1.5 ? '#00d4aa' : '#888'
                }]}>
                  {ltf_indicators.volume_ratio.toFixed(1)}x
                </Text>
              </View>
            )}
          </View>
        </>
      ) : (
        // Fallback when no analysis available
        <View style={styles.noAnalysis}>
          <Text style={styles.noAnalysisText}>Esperando datos de analisis...</Text>
        </View>
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
  cardEmbedded: {
    padding: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
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

  // Scenario Badge
  scenarioBadge: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  scenarioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  scenarioLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  unifiedReading: {
    color: '#ccc',
    fontSize: 13,
    marginBottom: 6,
    lineHeight: 18,
  },
  scenarioReason: {
    color: '#888',
    fontSize: 12,
    fontStyle: 'italic',
  },
  directionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  directionText: {
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Two-Layer Analysis Container
  layersContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  layerBox: {
    flex: 1,
    backgroundColor: '#151525',
    borderRadius: 8,
    padding: 10,
  },
  layerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  layerTitle: {
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  tfBadge: {
    backgroundColor: '#00d4aa20',
    borderWidth: 1,
    borderColor: '#00d4aa',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tfBadgeText: {
    color: '#00d4aa',
    fontSize: 9,
    fontWeight: 'bold',
  },
  layerContent: {
    gap: 6,
  },
  layerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  layerLabel: {
    color: '#666',
    fontSize: 10,
  },
  valueBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  valueText: {
    fontSize: 10,
    fontWeight: '600',
  },
  valueTextPlain: {
    color: '#aaa',
    fontSize: 10,
    textTransform: 'capitalize',
  },

  // Observations
  observations: {
    marginBottom: 10,
  },
  observationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  observationBullet: {
    color: '#666',
    fontSize: 12,
    marginRight: 6,
    marginTop: 1,
  },
  observationText: {
    color: '#999',
    fontSize: 12,
    flex: 1,
  },

  // Funding
  fundingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
    marginBottom: 8,
  },
  fundingLabel: {
    color: '#666',
    fontSize: 12,
  },
  fundingValue: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Key Levels
  levelsContainer: {
    marginBottom: 10,
  },
  levelsTitle: {
    color: '#666',
    fontSize: 11,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  levelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  levelItem: {
    alignItems: 'center',
  },
  levelLabel: {
    color: '#888',
    fontSize: 10,
    marginBottom: 2,
  },
  levelPrice: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
  },

  // Indicators Row
  indicatorsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  indicatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#252535',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 6,
  },
  indicatorChipLabel: {
    color: '#666',
    fontSize: 10,
  },
  indicatorChipValue: {
    fontSize: 12,
    fontWeight: '600',
  },

  // No analysis fallback
  noAnalysis: {
    padding: 20,
    alignItems: 'center',
  },
  noAnalysisText: {
    color: '#666',
    fontSize: 13,
  },
});

export default PairCard;

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

const PairCard = ({ pair, data, onPress, embedded = false }) => {
  const cardStyle = embedded ? styles.cardEmbedded : styles.card;

  if (!data) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.pair}>{pair}</Text>
        <Text style={styles.loading}>Cargando...</Text>
      </TouchableOpacity>
    );
  }

  const { price, indicators, funding, analysis } = data;

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

  // Get HTF bias styles
  const htfBias = analysis?.htf_bias || 'neutral';
  const biasStyle = BIAS_STYLES[htfBias] || BIAS_STYLES.neutral;

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
          {/* LAYER 3: Scenario Classification Badge (top priority) */}
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
            <Text style={styles.scenarioReason}>{analysis.scenario_reason}</Text>
          </View>

          {/* LAYER 1: HTF Context */}
          <View style={styles.htfContext}>
            <Text style={styles.sectionTitle}>Contexto HTF</Text>
            <View style={styles.htfRow}>
              <View style={styles.htfItem}>
                <Text style={styles.htfLabel}>Sesgo</Text>
                <View style={[styles.htfValueBadge, { borderColor: biasStyle.color }]}>
                  <Text style={[styles.htfValue, { color: biasStyle.color }]}>
                    {biasStyle.icon} {biasStyle.label}
                  </Text>
                </View>
              </View>
              <View style={styles.htfItem}>
                <Text style={styles.htfLabel}>Estructura</Text>
                <Text style={styles.htfValueText}>
                  {analysis.htf_structure?.replace(/_/g, ' ') || 'Sin datos'}
                </Text>
              </View>
              <View style={styles.htfItem}>
                <Text style={styles.htfLabel}>Volatilidad</Text>
                <Text style={[styles.htfValueText, {
                  color: analysis.volatility_state === 'alta' ? '#ff4757' :
                         analysis.volatility_state === 'baja' ? '#ffd93d' : '#888'
                }]}>
                  {analysis.volatility_state?.charAt(0).toUpperCase() + analysis.volatility_state?.slice(1)}
                </Text>
              </View>
            </View>
          </View>

          {/* LAYER 2: Price Interpretation */}
          {analysis.price_interpretation && (
            <View style={styles.priceInterpretation}>
              <Text style={styles.interpretationText}>
                {analysis.price_interpretation}
              </Text>
            </View>
          )}

          {/* Observations */}
          {analysis.observations && analysis.observations.length > 0 && (
            <View style={styles.observations}>
              {analysis.observations.map((obs, idx) => (
                <View key={idx} style={styles.observationItem}>
                  <Text style={styles.observationBullet}>•</Text>
                  <Text style={styles.observationText}>{obs}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Funding Rate */}
          {funding && (
            <View style={styles.fundingRow}>
              <Text style={styles.fundingLabel}>Funding</Text>
              <Text style={[styles.fundingValue, {
                color: funding.funding_rate_percent > 0.01 ? '#ff4757' :
                       funding.funding_rate_percent < -0.01 ? '#00d4aa' : '#888'
              }]}>
                {funding.funding_rate_percent >= 0 ? '+' : ''}{funding.funding_rate_percent?.toFixed(4)}%
              </Text>
            </View>
          )}

          {/* Key Fibonacci Levels */}
          {indicators?.fibonacci?.levels && (() => {
            const levels = indicators.fibonacci.levels;
            const currentPrice = price;
            const levelEntries = Object.entries(levels)
              .map(([name, p]) => ({ name, price: parseFloat(p) }))
              .sort((a, b) => a.price - b.price);

            const supports = levelEntries.filter(l => l.price < currentPrice);
            const resistances = levelEntries.filter(l => l.price > currentPrice);
            const nearestSupport = supports.length > 0 ? supports[supports.length - 1] : null;
            const nearestResistance = resistances.length > 0 ? resistances[0] : null;

            return (
              <View style={styles.levelsContainer}>
                <Text style={styles.levelsTitle}>Niveles Clave</Text>
                <View style={styles.levelsRow}>
                  {nearestResistance && (
                    <View style={styles.levelItem}>
                      <Text style={styles.levelLabel}>Resistencia {nearestResistance.name}%</Text>
                      <Text style={[styles.levelPrice, { color: '#ff4757' }]}>
                        {formatPriceShort(nearestResistance.price)}
                      </Text>
                    </View>
                  )}
                  {nearestSupport && (
                    <View style={styles.levelItem}>
                      <Text style={styles.levelLabel}>Soporte {nearestSupport.name}%</Text>
                      <Text style={[styles.levelPrice, { color: '#00d4aa' }]}>
                        {formatPriceShort(nearestSupport.price)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Raw Indicators (collapsed style) */}
          <View style={styles.indicatorsRow}>
            {indicators?.rsi != null && (
              <View style={styles.indicatorChip}>
                <Text style={styles.indicatorChipLabel}>RSI</Text>
                <Text style={[styles.indicatorChipValue, {
                  color: indicators.rsi > 70 ? '#ff4757' : indicators.rsi < 30 ? '#00d4aa' : '#fff'
                }]}>
                  {indicators.rsi.toFixed(0)}
                </Text>
              </View>
            )}
            {indicators?.macd_histogram != null && (
              <View style={styles.indicatorChip}>
                <Text style={styles.indicatorChipLabel}>MACD</Text>
                <Text style={[styles.indicatorChipValue, {
                  color: indicators.macd_histogram > 0 ? '#00d4aa' : '#ff4757'
                }]}>
                  {indicators.macd_histogram > 0 ? '+' : ''}{indicators.macd_histogram.toFixed(2)}
                </Text>
              </View>
            )}
            {indicators?.volume_ratio != null && (
              <View style={styles.indicatorChip}>
                <Text style={styles.indicatorChipLabel}>Vol</Text>
                <Text style={[styles.indicatorChipValue, {
                  color: indicators.volume_ratio > 1.5 ? '#00d4aa' : '#888'
                }]}>
                  {indicators.volume_ratio.toFixed(1)}x
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

  // Scenario Badge (Layer 3 - top priority)
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
  scenarioReason: {
    color: '#aaa',
    fontSize: 13,
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

  // HTF Context (Layer 1)
  htfContext: {
    backgroundColor: '#151525',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  htfRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  htfItem: {
    flex: 1,
    alignItems: 'center',
  },
  htfLabel: {
    color: '#666',
    fontSize: 10,
    marginBottom: 4,
  },
  htfValueBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  htfValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  htfValueText: {
    color: '#aaa',
    fontSize: 12,
    textTransform: 'capitalize',
  },

  // Price Interpretation (Layer 2)
  priceInterpretation: {
    backgroundColor: '#1a1a30',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  interpretationText: {
    color: '#ccc',
    fontSize: 13,
    fontStyle: 'italic',
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

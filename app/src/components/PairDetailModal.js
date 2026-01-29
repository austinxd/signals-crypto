import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { getUnifiedMarketData, getVolumeProfile } from '../services/api';

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

// Descriptive RSI zone labels
const getRsiZoneLabel = (zone) => {
  const labels = {
    sobrecompra: 'Sobrecompra',
    sobrevendido: 'Sobrevendido',
    neutral: 'Neutral',
  };
  return labels[zone] || 'Sin datos';
};

// Descriptive volatility labels
const getVolatilityLabel = (state) => {
  const labels = {
    alta: 'Alta',
    baja: 'Baja',
    normal: 'Normal',
  };
  return labels[state] || 'Normal';
};

// Format volume with K/M suffix
const formatVolume = (value) => {
  if (value == null) return '$0';
  const absValue = Math.abs(value);
  if (absValue >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (absValue >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
};

// Format price with appropriate decimals
const formatPrice = (price) => {
  if (price == null) return '$0';
  if (price >= 10000) return `$${price.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; // BTC: $102,345
  if (price >= 100) return `$${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; // ETH: $3,456.78
  if (price >= 1) return `$${price.toFixed(3)}`; // SOL: $123.456
  if (price >= 0.01) return `$${price.toFixed(4)}`; // DOGE: $0.1234
  return `$${price.toFixed(6)}`; // SHIB: $0.000012
};

const PairDetailModal = ({ visible, onClose, pair, data: initialData }) => {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Volume profile state (advanced, hidden by default)
  // Default 4H for Mercado modal (context view)
  const [showVolumeProfile, setShowVolumeProfile] = useState(false);
  const [volumeData, setVolumeData] = useState(null);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeTf, setVolumeTf] = useState('4h');

  // Fetch fresh data when modal opens
  useEffect(() => {
    if (!visible || !pair) {
      setLiveData(null);
      setLastUpdate(null);
      setShowVolumeProfile(false);
      setVolumeData(null);
      return;
    }

    const fetchPairData = async () => {
      try {
        setLoading(true);
        const freshData = await getUnifiedMarketData([pair], true);
        if (freshData?.pairs?.[pair]) {
          setLiveData(freshData.pairs[pair]);
          setLastUpdate(new Date());
        }
      } catch (err) {
        console.error('Error fetching pair data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPairData();
    const interval = setInterval(fetchPairData, 15000);
    return () => clearInterval(interval);
  }, [visible, pair]);

  // Fetch volume profile when expanded
  useEffect(() => {
    if (!showVolumeProfile || !pair) return;

    const fetchVolume = async () => {
      try {
        setVolumeLoading(true);
        const data = await getVolumeProfile(pair, volumeTf);
        setVolumeData(data);
      } catch (err) {
        console.error('Error fetching volume profile:', err);
        setVolumeData(null);
      } finally {
        setVolumeLoading(false);
      }
    };

    fetchVolume();
  }, [showVolumeProfile, pair, volumeTf]);

  const data = liveData || initialData;

  if (!data || !data.analysis) {
    return (
      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.title}>{pair}</Text>
              {loading && <ActivityIndicator color="#00d4aa" style={{ marginTop: 10 }} />}
            </View>
            <Text style={styles.noData}>{loading ? 'Cargando datos...' : 'Sin datos disponibles'}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const { analysis, htf_indicators: htfInd, ltf_indicators: ltfInd, funding, price } = data;

  // Extract analysis data
  const scenario = analysis?.scenario || 'espera';
  const scenarioStyle = SCENARIO_STYLES[scenario] || SCENARIO_STYLES.espera;
  const htfBias = analysis?.context?.htf_bias || analysis?.htf_bias || 'neutral';
  const biasStyle = BIAS_STYLES[htfBias] || BIAS_STYLES.neutral;
  const directionPref = analysis?.direction_preference;
  const ltfMomentum = analysis?.timing?.ltf_momentum || 'neutral';
  const momentumStyle = MOMENTUM_STYLES[ltfMomentum] || MOMENTUM_STYLES.neutral;
  const hasConfirmation = analysis?.timing?.has_confirmation || false;
  const rsiZone = analysis?.timing?.rsi_zone || 'neutral';
  const volatilityState = analysis?.context?.volatility_state || analysis?.volatility_state || 'normal';
  const htfStructure = analysis?.context?.htf_structure || analysis?.htf_structure || 'Sin datos';

  // Funding description (informative, not directive)
  const getFundingDescription = () => {
    if (!funding) return null;
    const rate = funding.funding_rate_percent;
    if (rate > 0.05) return { text: 'Funding elevado positivo - predominan posiciones largas en el mercado', color: '#ff4757' };
    if (rate < -0.05) return { text: 'Funding elevado negativo - predominan posiciones cortas en el mercado', color: '#00d4aa' };
    return { text: 'Funding en rango neutral', color: '#888' };
  };

  const fundingDesc = getFundingDescription();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{pair?.replace('/USDT', '')}</Text>
            <Text style={styles.price}>${price?.toLocaleString()}</Text>
            <View style={styles.headerBadges}>
              <Text style={styles.timeframeLabel}>4H + 15m</Text>
              {loading && <ActivityIndicator color="#00d4aa" size="small" />}
            </View>
            {lastUpdate && (
              <Text style={styles.lastUpdateText}>
                Actualizado: {lastUpdate.toLocaleTimeString('es-ES')}
              </Text>
            )}
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* a) Justificacion del Escenario */}
            <View style={styles.justificationBox}>
              <View style={styles.justificationHeader}>
                <Text style={styles.justificationTitle}>
                  Escenario clasificado como{' '}
                  <Text style={{ color: scenarioStyle.color, fontWeight: 'bold' }}>
                    {scenarioStyle.label}
                  </Text>
                  {directionPref && (
                    <Text style={{ color: '#888' }}>
                      {' '}con preferencia{' '}
                      <Text style={{ color: directionPref === 'long' ? '#00d4aa' : '#ff4757', fontWeight: 'bold' }}>
                        {directionPref.toUpperCase()}
                      </Text>
                    </Text>
                  )}
                </Text>
              </View>

              {/* Causal Reasons */}
              <View style={styles.reasonsList}>
                {/* HTF Context Reason */}
                <View style={styles.reasonItem}>
                  <Text style={styles.reasonBullet}>–</Text>
                  <Text style={styles.reasonText}>
                    El contexto 4H mantiene sesgo{' '}
                    <Text style={{ color: biasStyle.color }}>{biasStyle.label.toLowerCase()}</Text>
                    {htfStructure && htfStructure !== 'Sin datos' && (
                      <Text> en {htfStructure.toLowerCase().replace(/_/g, ' ')}</Text>
                    )}
                  </Text>
                </View>

                {/* EMA Position Reason */}
                {htfInd?.price_above_ema !== undefined && (
                  <View style={styles.reasonItem}>
                    <Text style={styles.reasonBullet}>–</Text>
                    <Text style={styles.reasonText}>
                      El precio se encuentra{' '}
                      <Text style={{ color: htfInd.price_above_ema ? '#00d4aa' : '#ff4757' }}>
                        {htfInd.price_above_ema ? 'sobre' : 'bajo'}
                      </Text>
                      {' '}la EMA200 en 4H
                    </Text>
                  </View>
                )}

                {/* LTF Alignment Reason */}
                <View style={styles.reasonItem}>
                  <Text style={styles.reasonBullet}>–</Text>
                  <Text style={styles.reasonText}>
                    El timing 15m {hasConfirmation ? 'presenta' : 'no presenta'} alineacion con el contexto
                    {ltfMomentum !== 'neutral' && (
                      <Text> (momentum <Text style={{ color: momentumStyle.color }}>{momentumStyle.label.toLowerCase()}</Text>)</Text>
                    )}
                  </Text>
                </View>

                {/* Volatility Factor if relevant */}
                {volatilityState === 'alta' && (
                  <View style={styles.reasonItem}>
                    <Text style={styles.reasonBullet}>–</Text>
                    <Text style={styles.reasonText}>
                      <Text style={{ color: '#ff4757' }}>Volatilidad elevada</Text> incrementa el nivel de riesgo
                    </Text>
                  </View>
                )}

                {/* RSI Zone if extreme */}
                {(rsiZone === 'sobrecompra' || rsiZone === 'sobrevendido') && (
                  <View style={styles.reasonItem}>
                    <Text style={styles.reasonBullet}>–</Text>
                    <Text style={styles.reasonText}>
                      RSI en zona de{' '}
                      <Text style={{ color: rsiZone === 'sobrecompra' ? '#ff4757' : '#00d4aa' }}>
                        {rsiZone === 'sobrecompra' ? 'sobrecompra' : 'sobreventa'}
                      </Text>
                    </Text>
                  </View>
                )}
              </View>

              {/* Additional scenario reason if provided */}
              {analysis.scenario_reason && (
                <Text style={styles.additionalReason}>{analysis.scenario_reason}</Text>
              )}
            </View>

            {/* b) Contexto HTF (4H) + c) Timing LTF (15m) */}
            <View style={styles.twoLayerContainer}>
              {/* Context Layer (4H) */}
              <View style={styles.layerBox}>
                <View style={styles.layerHeader}>
                  <Text style={styles.layerTitle}>CONTEXTO</Text>
                  <View style={styles.tfBadge}>
                    <Text style={styles.tfBadgeText}>4H</Text>
                  </View>
                </View>
                <View style={styles.layerContent}>
                  <View style={styles.layerRow}>
                    <Text style={styles.layerLabel}>Sesgo</Text>
                    <View style={[styles.valueBadge, { borderColor: biasStyle.color }]}>
                      <Text style={[styles.valueBadgeText, { color: biasStyle.color }]}>
                        {biasStyle.icon} {biasStyle.label}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.layerRow}>
                    <Text style={styles.layerLabel}>Estructura</Text>
                    <Text style={styles.layerValue}>
                      {htfStructure?.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <View style={styles.layerRow}>
                    <Text style={styles.layerLabel}>Volatilidad</Text>
                    <Text style={[styles.layerValue, {
                      color: volatilityState === 'alta' ? '#ff4757' :
                             volatilityState === 'baja' ? '#ffd93d' : '#888'
                    }]}>
                      {getVolatilityLabel(volatilityState)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Timing Layer (15m) */}
              <View style={styles.layerBox}>
                <View style={styles.layerHeader}>
                  <Text style={styles.layerTitle}>TIMING</Text>
                  <View style={[styles.tfBadge, { backgroundColor: '#ff9f4320', borderColor: '#ff9f43' }]}>
                    <Text style={[styles.tfBadgeText, { color: '#ff9f43' }]}>15m</Text>
                  </View>
                </View>
                <View style={styles.layerContent}>
                  <View style={styles.layerRow}>
                    <Text style={styles.layerLabel}>Momentum</Text>
                    <View style={[styles.valueBadge, { borderColor: momentumStyle.color }]}>
                      <Text style={[styles.valueBadgeText, { color: momentumStyle.color }]}>
                        {momentumStyle.icon} {momentumStyle.label}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.layerRow}>
                    <Text style={styles.layerLabel}>RSI</Text>
                    <Text style={[styles.layerValue, {
                      color: rsiZone === 'sobrecompra' ? '#ff4757' :
                             rsiZone === 'sobrevendido' ? '#00d4aa' : '#888'
                    }]}>
                      {getRsiZoneLabel(rsiZone)}
                    </Text>
                  </View>
                  <View style={styles.layerRow}>
                    <Text style={styles.layerLabel}>Alineacion</Text>
                    <Text style={[styles.layerValue, {
                      color: hasConfirmation ? '#00d4aa' : '#666',
                      fontWeight: hasConfirmation ? '600' : 'normal'
                    }]}>
                      {hasConfirmation ? 'Presente' : 'Ausente'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Observations */}
            {analysis.observations && analysis.observations.length > 0 && (
              <View style={styles.observationsBox}>
                <Text style={styles.observationsTitle}>Observaciones</Text>
                {analysis.observations.map((obs, idx) => (
                  <View key={idx} style={styles.observationRow}>
                    <Text style={styles.observationBullet}>•</Text>
                    <Text style={styles.observationText}>{obs}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Funding Info (descriptive only) */}
            {funding && (
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Tasa de Fondeo</Text>
                <View style={styles.infoBox}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Tasa actual</Text>
                    <Text style={[styles.infoValue, {
                      color: funding.funding_rate_percent > 0 ? '#ff4757' :
                             funding.funding_rate_percent < 0 ? '#00d4aa' : '#888'
                    }]}>
                      {funding.funding_rate_percent >= 0 ? '+' : ''}{funding.funding_rate_percent?.toFixed(4)}%
                    </Text>
                  </View>
                  {fundingDesc && (
                    <Text style={[styles.infoDescription, { color: fundingDesc.color }]}>
                      {fundingDesc.text}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Indicadores (descriptive, no interpretation) */}
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>Indicadores Tecnicos</Text>
              <View style={styles.indicatorGrid}>
                <View style={styles.indicatorColumn}>
                  <Text style={styles.indicatorColumnTitle}>4H</Text>
                  <View style={styles.indicatorRow}>
                    <Text style={styles.indicatorLabel}>RSI</Text>
                    <Text style={styles.indicatorValue}>{htfInd?.rsi?.toFixed(1) || '—'}</Text>
                  </View>
                  <View style={styles.indicatorRow}>
                    <Text style={styles.indicatorLabel}>MACD</Text>
                    <Text style={[styles.indicatorValue, {
                      color: htfInd?.macd_histogram > 0 ? '#00d4aa' : htfInd?.macd_histogram < 0 ? '#ff4757' : '#888'
                    }]}>
                      {htfInd?.macd_histogram?.toFixed(2) || '—'}
                    </Text>
                  </View>
                  <View style={styles.indicatorRow}>
                    <Text style={styles.indicatorLabel}>vs EMA200</Text>
                    <Text style={styles.indicatorValue}>
                      {htfInd?.price_above_ema === true ? 'Sobre' : htfInd?.price_above_ema === false ? 'Bajo' : '—'}
                    </Text>
                  </View>
                </View>
                <View style={styles.indicatorColumn}>
                  <Text style={styles.indicatorColumnTitle}>15m</Text>
                  <View style={styles.indicatorRow}>
                    <Text style={styles.indicatorLabel}>RSI</Text>
                    <Text style={styles.indicatorValue}>{ltfInd?.rsi?.toFixed(1) || '—'}</Text>
                  </View>
                  <View style={styles.indicatorRow}>
                    <Text style={styles.indicatorLabel}>MACD</Text>
                    <Text style={[styles.indicatorValue, {
                      color: ltfInd?.macd_histogram > 0 ? '#00d4aa' : ltfInd?.macd_histogram < 0 ? '#ff4757' : '#888'
                    }]}>
                      {ltfInd?.macd_histogram?.toFixed(4) || '—'}
                    </Text>
                  </View>
                  <View style={styles.indicatorRow}>
                    <Text style={styles.indicatorLabel}>Volumen</Text>
                    <Text style={styles.indicatorValue}>
                      {ltfInd?.volume_ratio ? `${ltfInd.volume_ratio.toFixed(1)}x` : '—'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Volumen Ejecutado (Avanzado) - Collapsible */}
            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowVolumeProfile(!showVolumeProfile)}
              activeOpacity={0.7}
            >
              <Text style={styles.advancedToggleText}>
                {showVolumeProfile ? '▼' : '▶'} Volumen Ejecutado (Avanzado)
              </Text>
            </TouchableOpacity>

            {showVolumeProfile && (
              <View style={styles.volumeSection}>
                {/* Timeframe selector */}
                <View style={styles.volumeTfSelector}>
                  {['15m', '4h'].map((tf) => (
                    <TouchableOpacity
                      key={tf}
                      style={[styles.volumeTfButton, volumeTf === tf && styles.volumeTfButtonActive]}
                      onPress={() => setVolumeTf(tf)}
                    >
                      <Text style={[styles.volumeTfText, volumeTf === tf && styles.volumeTfTextActive]}>
                        {tf}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {volumeLoading ? (
                  <View style={styles.volumeLoading}>
                    <ActivityIndicator color="#888" size="small" />
                    <Text style={styles.volumeLoadingText}>Cargando volumen...</Text>
                  </View>
                ) : volumeData ? (
                  <>
                    {/* Summary */}
                    <View style={styles.volumeSummary}>
                      <Text style={styles.volumeSummaryTitle}>Resumen del Periodo</Text>
                      <Text style={[styles.volumeSummaryText, {
                        color: volumeData.summary?.dominant_side === 'compradora' ? '#5b9bd5' :
                               volumeData.summary?.dominant_side === 'vendedora' ? '#ed7d31' : '#888'
                      }]}>
                        {volumeData.summary?.description || 'Sin datos'}
                      </Text>
                      <View style={styles.volumeStats}>
                        <View style={styles.volumeStat}>
                          <Text style={styles.volumeStatLabel}>Compras</Text>
                          <Text style={[styles.volumeStatValue, { color: '#5b9bd5' }]}>
                            {formatVolume(volumeData.summary?.total_buy_volume)}
                          </Text>
                        </View>
                        <View style={styles.volumeStat}>
                          <Text style={styles.volumeStatLabel}>Ventas</Text>
                          <Text style={[styles.volumeStatValue, { color: '#ed7d31' }]}>
                            {formatVolume(volumeData.summary?.total_sell_volume)}
                          </Text>
                        </View>
                        <View style={styles.volumeStat}>
                          <Text style={styles.volumeStatLabel}>Delta</Text>
                          <Text style={[styles.volumeStatValue, {
                            color: volumeData.summary?.dominant_side === 'equilibrada' ? '#888' :
                                   volumeData.summary?.net_delta > 0 ? '#5b9bd5' : '#ed7d31'
                          }]}>
                            {volumeData.summary?.net_delta > 0 ? '+' : ''}{formatVolume(Math.abs(volumeData.summary?.net_delta || 0)).replace('$', '')}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Volume Profile Histogram */}
                    {volumeData.volume_profile?.length > 0 && (
                      <View style={styles.volumeProfile}>
                        <Text style={styles.volumeProfileTitle}>Volumen por Precio</Text>
                        <Text style={styles.volumeProfileHint}>
                          Muestra donde hubo mayor volumen ejecutado
                        </Text>
                        {volumeData.volume_profile.slice(-10).map((level, idx) => (
                          <View key={idx} style={styles.volumeBar}>
                            <Text style={styles.volumeBarPrice}>
                              {formatPrice(level.price)}
                            </Text>
                            <View style={styles.volumeBarContainer}>
                              {/* Buy bar */}
                              <View style={[styles.volumeBarFill, styles.volumeBarBuy, {
                                width: `${(level.buy / level.total) * level.percent}%`
                              }]} />
                              {/* Sell bar */}
                              <View style={[styles.volumeBarFill, styles.volumeBarSell, {
                                width: `${(level.sell / level.total) * level.percent}%`
                              }]} />
                            </View>
                          </View>
                        ))}
                        <View style={styles.volumeLegend}>
                          <View style={styles.volumeLegendItem}>
                            <View style={[styles.volumeLegendDot, { backgroundColor: '#5b9bd5' }]} />
                            <Text style={styles.volumeLegendText}>Compras</Text>
                          </View>
                          <View style={styles.volumeLegendItem}>
                            <View style={[styles.volumeLegendDot, { backgroundColor: '#ed7d31' }]} />
                            <Text style={styles.volumeLegendText}>Ventas</Text>
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Interpretive note */}
                    <View style={styles.volumeNote}>
                      <Text style={styles.volumeNoteText}>
                        El volumen ejecutado muestra lo que ocurrio, no lo que ocurrira.
                        Usalo para contextualizar estructura, no para tomar decisiones.
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={styles.volumeNoData}>No hay datos de volumen disponibles</Text>
                )}
              </View>
            )}

            {/* Disclaimer */}
            <View style={styles.disclaimerBox}>
              <Text style={styles.disclaimerText}>
                Esta informacion describe el estado actual del mercado. No constituye una recomendacion de inversion.
              </Text>
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
    backgroundColor: 'rgba(0,0,0,0.85)',
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
    fontSize: 28,
    fontWeight: 'bold',
  },
  price: {
    color: '#00d4aa',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 4,
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  timeframeLabel: {
    color: '#666',
    fontSize: 13,
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  lastUpdateText: {
    color: '#555',
    fontSize: 11,
    marginTop: 6,
  },
  content: {
    padding: 16,
  },
  noData: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    padding: 40,
  },

  // Justification Box
  justificationBox: {
    backgroundColor: '#151525',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#00d4aa',
  },
  justificationHeader: {
    marginBottom: 14,
  },
  justificationTitle: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 22,
  },
  reasonsList: {
    gap: 8,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  reasonBullet: {
    color: '#666',
    fontSize: 14,
    marginRight: 10,
    marginTop: 1,
  },
  reasonText: {
    color: '#aaa',
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
  additionalReason: {
    color: '#777',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },

  // Two Layer Container
  twoLayerContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  layerBox: {
    flex: 1,
    backgroundColor: '#151525',
    borderRadius: 12,
    padding: 12,
  },
  layerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  layerTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  tfBadge: {
    backgroundColor: '#00d4aa20',
    borderWidth: 1,
    borderColor: '#00d4aa',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tfBadgeText: {
    color: '#00d4aa',
    fontSize: 10,
    fontWeight: 'bold',
  },
  layerContent: {
    gap: 10,
  },
  layerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  layerLabel: {
    color: '#666',
    fontSize: 12,
  },
  layerValue: {
    color: '#aaa',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  valueBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  valueBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Observations
  observationsBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  observationsTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  observationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  observationBullet: {
    color: '#555',
    fontSize: 12,
    marginRight: 8,
    marginTop: 1,
  },
  observationText: {
    color: '#999',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },

  // Info Sections
  infoSection: {
    marginBottom: 16,
  },
  infoSectionTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  infoBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    color: '#888',
    fontSize: 13,
  },
  infoValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  infoDescription: {
    fontSize: 12,
    marginTop: 10,
    lineHeight: 16,
  },

  // Indicators Grid
  indicatorGrid: {
    flexDirection: 'row',
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  indicatorColumn: {
    flex: 1,
    padding: 12,
  },
  indicatorColumnTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  indicatorLabel: {
    color: '#666',
    fontSize: 12,
  },
  indicatorValue: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '500',
  },

  // Disclaimer
  disclaimerBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  disclaimerText: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Advanced Volume Section
  advancedToggle: {
    paddingVertical: 12,
    marginBottom: 8,
  },
  advancedToggleText: {
    color: '#666',
    fontSize: 13,
  },
  volumeSection: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  volumeTfSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  volumeTfButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1a1a2e',
  },
  volumeTfButtonActive: {
    backgroundColor: '#2a2a4a',
  },
  volumeTfText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  volumeTfTextActive: {
    color: '#fff',
  },
  volumeLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  volumeLoadingText: {
    color: '#666',
    fontSize: 13,
  },
  volumeNoData: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  volumeSummary: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  volumeSummaryTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  volumeSummaryText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  volumeStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  volumeStat: {
    alignItems: 'center',
  },
  volumeStatLabel: {
    color: '#666',
    fontSize: 10,
    marginBottom: 4,
  },
  volumeStatValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  volumeProfile: {
    marginBottom: 14,
  },
  volumeProfileTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  volumeProfileHint: {
    color: '#555',
    fontSize: 10,
    marginBottom: 10,
  },
  volumeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  volumeBarPrice: {
    color: '#888',
    fontSize: 10,
    width: 60,
    textAlign: 'right',
    marginRight: 8,
  },
  volumeBarContainer: {
    flex: 1,
    height: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  volumeBarFill: {
    height: '100%',
  },
  volumeBarBuy: {
    backgroundColor: '#5b9bd5',  // Neutral blue - no "good" connotation
  },
  volumeBarSell: {
    backgroundColor: '#ed7d31',  // Neutral orange - no "bad" connotation
  },
  volumeLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 10,
  },
  volumeLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  volumeLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  volumeLegendText: {
    color: '#666',
    fontSize: 10,
  },
  volumeNote: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  volumeNoteText: {
    color: '#555',
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
  },

  // Close Button
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
});

export default PairDetailModal;

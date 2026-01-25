import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import {
  getMarketData,
  getSignals,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  getPairData,
  getNotificationHistoryFromServer,
  clearSignals,
  clearNotifications,
} from '../services/api';
import { getStoredPushToken } from '../services/notifications';
import SignalCard from '../components/SignalCard';
import PairCard from '../components/PairCard';
import PairDetailModal from '../components/PairDetailModal';
import AddSubscriptionModal from '../components/AddSubscriptionModal';

// Signal bars component (like iOS WiFi indicator)
const SignalBars = ({ level, color = '#fff', size = 12 }) => {
  // level: 1 = conservative, 2 = balanced, 3 = aggressive
  const barWidth = size / 4;
  const gap = size / 8;
  const heights = [size * 0.4, size * 0.7, size];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: size, gap: gap }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: barWidth,
            height: heights[i],
            backgroundColor: i < level ? color : '#444',
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
};

const TRADING_MODE_LABELS = {
  conservative: { label: 'Conservador', level: 1 },
  balanced: { label: 'Balanceado', level: 2 },
  aggressive: { label: 'Agresivo', level: 3 },
};

const getModeColor = (mode) => {
  switch (mode) {
    case 'conservative': return '#00d4aa';
    case 'balanced': return '#ffd93d';
    case 'aggressive': return '#ff9f43';
    default: return '#888';
  }
};

const formatRelativeTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Ahora';
  } else if (diffMins < 60) {
    return `Hace ${diffMins} min`;
  } else if (diffHours < 24) {
    return `Hace ${diffHours}h`;
  } else if (diffDays < 7) {
    return `Hace ${diffDays} día${diffDays > 1 ? 's' : ''}`;
  } else {
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
};

const formatPrice = (p) => {
  if (p == null) return '$0';
  if (p < 0.01) return `$${p.toFixed(6)}`;
  if (p < 1) return `$${p.toFixed(4)}`;
  if (p < 10) return `$${p.toFixed(3)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
};

const HomeScreen = () => {
  const [activeTab, setActiveTab] = useState('market');
  const [marketData, setMarketData] = useState({});
  const [signals, setSignals] = useState([]);  // For signals list (filtered by user)
  const [badgeSignals, setBadgeSignals] = useState([]);  // For badges (current market state)
  const [notifications, setNotifications] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [pushToken, setPushToken] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [expandedSubs, setExpandedSubs] = useState({});  // Track expanded subscriptions

  const toggleExpanded = (subId) => {
    setExpandedSubs(prev => {
      // Si es undefined, tratarlo como true (expandido por defecto)
      const currentState = prev[subId] !== false;
      return {
        ...prev,
        [subId]: !currentState
      };
    });
  };

  // Get push token on mount
  useEffect(() => {
    const loadToken = async () => {
      const token = await getStoredPushToken();
      setPushToken(token);
    };
    loadToken();
  }, []);

  const fetchData = useCallback(async (forceRefresh = false) => {
    try {
      setError(null);

      if (activeTab === 'market') {
        // Load subscriptions from server
        let subs = [];
        if (pushToken) {
          try {
            const result = await getSubscriptions(pushToken);
            subs = result.subscriptions || [];
            setSubscriptions(subs);
          } catch (err) {
            console.log('Could not fetch subscriptions, using empty list');
            setSubscriptions([]);
          }
        }

        // Get unique timeframes from subscriptions
        const uniqueTimeframes = [...new Set(subs.map(s => s.timeframe))];
        if (uniqueTimeframes.length === 0) {
          uniqueTimeframes.push('4h'); // Default
        }

        // Fetch market data for each timeframe and combine
        const combinedData = {};
        for (const tf of uniqueTimeframes) {
          try {
            const data = await getMarketData(tf, forceRefresh);
            const pairs = data.pairs || {};
            // Key by pair_timeframe to distinguish same pair in different timeframes
            for (const [pair, pairData] of Object.entries(pairs)) {
              combinedData[`${pair}_${tf}`] = { ...pairData, timeframe: tf };
            }
          } catch (err) {
            console.log(`Could not fetch data for ${tf}:`, err);
          }
        }
        setMarketData(combinedData);
        setLastUpdate(new Date());

        // Load signals for badges (current market state, no user filter)
        const badgeData = await getSignals(50, null, null);
        setBadgeSignals(badgeData.signals || []);
      } else if (activeTab === 'signals') {
        // Get signals filtered by user's subscriptions and cleared date
        const data = await getSignals(20, null, pushToken);
        setSignals(data.signals || []);
        // Also update badge signals
        const badgeData = await getSignals(50, null, null);
        setBadgeSignals(badgeData.signals || []);
      } else {
        // Get notification history from server
        if (pushToken) {
          const data = await getNotificationHistoryFromServer(pushToken);
          setNotifications(data.notifications || []);
        } else {
          setNotifications([]);
        }
        // Also update badge signals
        const badgeData = await getSignals(50, null, null);
        setBadgeSignals(badgeData.signals || []);
      }
    } catch (err) {
      setError('Error conectando al servidor');
      console.error('Fetch error:', err);
    }
  }, [activeTab, pushToken]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  }, [fetchData]);

  const handleAddSubscription = async (pair, timeframe, tradingMode) => {
    if (!pushToken) {
      Alert.alert('Error', 'No se ha registrado el token de notificaciones');
      return;
    }

    try {
      await addSubscription(pushToken, pair, timeframe, tradingMode);
      fetchData(true);
    } catch (err) {
      console.error('Error adding subscription:', err);
      Alert.alert('Error', 'No se pudo agregar la suscripción');
    }
  };

  const handleRemoveSubscription = async (subscriptionId) => {
    if (!pushToken) return;

    Alert.alert(
      'Eliminar suscripción',
      '¿Estás seguro de que quieres eliminar esta suscripción?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSubscription(pushToken, subscriptionId);
              fetchData(true);
            } catch (err) {
              console.error('Error removing subscription:', err);
              Alert.alert('Error', 'No se pudo eliminar la suscripción');
            }
          },
        },
      ]
    );
  };

  const renderContent = () => {
    if (error) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'market') {
      if (subscriptions.length === 0) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyText}>No tienes suscripciones</Text>
            <Text style={styles.emptyHint}>Agrega pares para recibir notificaciones</Text>
            <TouchableOpacity
              style={styles.addFirstButton}
              onPress={() => setAddModalVisible(true)}
            >
              <Text style={styles.addFirstText}>+ Agregar mi primer par</Text>
            </TouchableOpacity>
          </View>
        );
      }

      // Helper to check if there's an active signal based on current indicators
      const checkActiveSignal = (indicators) => {
        if (!indicators) return { hasSignal: false, side: null };

        // Check LONG base conditions (need 2/2)
        const longConditions = [
          indicators.price_above_ema,
          indicators.rsi_rising
        ].filter(Boolean).length;

        // Check SHORT base conditions (need 2/2)
        const shortConditions = [
          !indicators.price_above_ema,
          indicators.rsi_falling
        ].filter(Boolean).length;

        if (longConditions === 2) return { hasSignal: true, side: 'LONG' };
        if (shortConditions === 2) return { hasSignal: true, side: 'SHORT' };
        return { hasSignal: false, side: null };
      };

      // Helper to calculate score from current indicators (same logic as PairCard)
      const calculateScore = (indicators, funding, isLong) => {
        if (!indicators) return 0;
        let score = 0;
        if (isLong) {
          if (indicators.rsi < 40) score += 1;
          if (indicators.macd_crossover_bullish) score += 1;
          if (funding?.sentiment === 'too_many_shorts') score += 0.5;
        } else {
          if (indicators.rsi > 60) score += 1;
          if (indicators.macd_crossover_bearish) score += 1;
          if (funding?.sentiment === 'too_many_longs') score += 0.5;
        }
        if (indicators.volume_above_average) score += 1;
        if (indicators.fibonacci?.at_key_level) score += 0.5;
        else if (indicators.fibonacci?.near_key_level) score += 0.25;
        return score;
      };

      // Helper to get quality badge config from score (real-time calculation)
      const getQualityFromScore = (score) => {
        if (score >= 2.5) return { label: 'Óptima', color: '#00d4aa', emoji: '✅' };
        if (score >= 1.5) return { label: 'Buena', color: '#ffd93d', emoji: '' };
        return { label: 'Alto Riesgo', color: '#ff4757', emoji: '' };
      };

      return (
        <>
          {subscriptions.map((sub) => {
            const isExpanded = expandedSubs[sub.id] !== false; // Default expanded
            const pairData = marketData[`${sub.pair}_${sub.timeframe}`];
            const price = pairData?.price;

            // Check for active signal based on CURRENT indicators (not backend signal)
            const activeSignal = checkActiveSignal(pairData?.indicators);

            // Calculate real-time quality from current indicators
            const realTimeScore = activeSignal.hasSignal && pairData?.indicators
              ? calculateScore(pairData.indicators, pairData.funding, activeSignal.side === 'LONG')
              : 0;
            const realTimeQuality = getQualityFromScore(realTimeScore);

            return (
              <View key={sub.id} style={styles.subscriptionWrapper}>
                {/* Compact header - always visible */}
                <TouchableOpacity
                  style={styles.subscriptionHeader}
                  onPress={() => toggleExpanded(sub.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.subscriptionLeft}>
                    <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
                    <View style={styles.modeIconMini}>
                      <SignalBars
                        level={TRADING_MODE_LABELS[sub.trading_mode]?.level || 2}
                        color={getModeColor(sub.trading_mode)}
                        size={14}
                      />
                    </View>
                    <Text style={styles.subscriptionPairName}>{sub.pair.replace('/USDT', '')}</Text>
                    {price && (
                      <Text style={styles.subscriptionPrice}>{formatPrice(price)}</Text>
                    )}
                  </View>
                  <View style={styles.subscriptionRight}>
                    <View style={styles.subscriptionBadges}>
                      <View style={styles.timeframeBadgeSmall}>
                        <Text style={styles.timeframeBadgeText}>{sub.timeframe}</Text>
                      </View>
                      {/* Signal indicator: green for LONG, red for SHORT, gray for none */}
                      {activeSignal.hasSignal ? (
                        <>
                          <View style={[styles.signalIndicator, { backgroundColor: activeSignal.side === 'LONG' ? '#00d4aa' : '#ff4757' }]}>
                            <Text style={styles.signalIndicatorText}>
                              {activeSignal.side === 'LONG' ? '🟢' : '🔴'}
                            </Text>
                          </View>
                          <View style={[styles.qualityBadgeSmall, { backgroundColor: realTimeQuality.color + '30', borderColor: realTimeQuality.color }]}>
                            <Text style={[styles.qualityBadgeTextSmall, { color: realTimeQuality.color }]}>
                              {realTimeQuality.emoji} {realTimeQuality.label}
                            </Text>
                          </View>
                        </>
                      ) : (
                        <View style={styles.noSignalIndicator}>
                          <Text style={styles.noSignalText}>⚪</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleRemoveSubscription(sub.id)}
                    >
                      <Text style={styles.deleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>

                {/* Expanded content */}
                {isExpanded && (
                  <PairCard
                    pair={sub.pair}
                    data={pairData}
                    timeframe={sub.timeframe}
                    embedded={true}
                    onPress={() => {
                      setSelectedPair(sub.pair);
                      setSelectedSubscription(sub);
                      setModalVisible(true);
                    }}
                  />
                )}
              </View>
            );
          })}
          <TouchableOpacity
            style={styles.addPairButton}
            onPress={() => setAddModalVisible(true)}
          >
            <Text style={styles.addPairIcon}>+</Text>
            <Text style={styles.addPairText}>Agregar par</Text>
          </TouchableOpacity>
        </>
      );
    }

    if (activeTab === 'signals') {
      if (signals.length === 0) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyText}>No hay señales recientes</Text>
            <Text style={styles.emptyHint}>Las señales aparecerán cuando se detecten oportunidades</Text>
          </View>
        );
      }
      return (
        <>
          <TouchableOpacity
            style={styles.clearButtonTop}
            onPress={() => {
              Alert.alert(
                'Limpiar Señales',
                '¿Estás seguro de que quieres limpiar todas las señales?',
                [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Limpiar',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        if (pushToken) {
                          await clearSignals(pushToken);
                        }
                        setSignals([]);
                      } catch (e) {
                        console.error('Error clearing signals:', e);
                        setSignals([]); // Clear locally even if server fails
                      }
                    }
                  },
                ]
              );
            }}
          >
            <Text style={styles.clearButtonText}>🗑️ Limpiar señales</Text>
          </TouchableOpacity>
          {signals.map((signal, index) => (
            <SignalCard key={`${signal.timestamp}-${index}`} signal={signal} />
          ))}
        </>
      );
    }

    if (notifications.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>No hay notificaciones</Text>
          <Text style={styles.emptyHint}>Las notificaciones push aparecerán aquí</Text>
        </View>
      );
    }

    return (
      <>
        <TouchableOpacity
          style={styles.clearButtonTop}
          onPress={() => {
            Alert.alert(
              'Limpiar Historial',
              '¿Estás seguro de que quieres limpiar todo el historial de notificaciones?',
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Limpiar',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      if (pushToken) {
                        await clearNotifications(pushToken);
                      }
                      setNotifications([]);
                    } catch (e) {
                      console.error('Error clearing notifications:', e);
                      setNotifications([]); // Clear locally even if server fails
                    }
                  }
                },
              ]
            );
          }}
        >
          <Text style={styles.clearButtonText}>🗑️ Limpiar historial</Text>
        </TouchableOpacity>
        {notifications.map((notif) => {
          // Transform notification to signal format for SignalCard
          const signalData = {
            pair: notif.pair,
            side: notif.side,
            timeframe: notif.timeframe,
            quality: notif.quality,
            score: notif.score,
            entry: notif.entry_price,
            takeProfit: notif.take_profit,
            stopLoss: notif.stop_loss,
            timestamp: notif.receivedAt,
          };
          return <SignalCard key={notif.id} signal={signalData} />;
        })}
      </>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Text style={styles.logoIconText}>📈</Text>
            </View>
            <View>
              <Text style={styles.title}>Señales Crypto</Text>
              <TouchableOpacity
                style={styles.subtitleLink}
                onPress={() => Linking.openURL('https://www.instagram.com/austin.app')}
              >
                <Text style={styles.instagramIcon}>📷</Text>
                <Text style={styles.subtitle}>@austin.app</Text>
              </TouchableOpacity>
            </View>
          </View>
          {subscriptions.length > 0 && activeTab === 'market' && (
            <View style={styles.headerRight}>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{subscriptions.length} pares</Text>
              </View>
            </View>
          )}
        </View>
        {lastUpdate && activeTab === 'market' && (
          <Text style={styles.lastUpdate}>
            Actualizado: {lastUpdate.toLocaleTimeString('es-ES')}
          </Text>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { key: 'market', label: 'Mercado', icon: '📊' },
          { key: 'signals', label: 'Señales', icon: '🎯' },
          { key: 'history', label: 'Historial', icon: '📜' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.activeTab]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00d4aa"
            colors={['#00d4aa']}
          />
        }
      >
        {renderContent()}
      </ScrollView>

      {/* Modals */}
      <PairDetailModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setSelectedSubscription(null);
        }}
        pair={selectedPair}
        data={selectedPair && selectedSubscription ? marketData[`${selectedPair}_${selectedSubscription.timeframe}`] : null}
        subscription={selectedSubscription}
        signal={selectedPair && selectedSubscription ? badgeSignals.find(s => s.pair === selectedPair && s.timeframe === selectedSubscription.timeframe) : null}
      />

      <AddSubscriptionModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onAdd={handleAddSubscription}
        existingSubscriptions={subscriptions}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#0f0f1a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logoIconText: {
    fontSize: 24,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  subtitleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  instagramIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  subtitle: {
    color: '#00d4aa',
    fontSize: 12,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  countBadge: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#00d4aa',
  },
  countText: {
    color: '#00d4aa',
    fontSize: 12,
    fontWeight: '600',
  },
  lastUpdate: {
    color: '#666',
    fontSize: 11,
    marginTop: 8,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0f0f1a',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
  },
  activeTab: {
    backgroundColor: '#00d4aa',
  },
  tabIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#0a0a14',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
  },
  emptyHint: {
    color: '#555',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: '#00d4aa',
    borderRadius: 12,
  },
  retryText: {
    color: '#0a0a14',
    fontWeight: '600',
    fontSize: 16,
  },
  subscriptionWrapper: {
    marginBottom: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  subscriptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  subscriptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  expandIcon: {
    color: '#666',
    fontSize: 10,
    marginRight: 10,
  },
  subscriptionPairName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 6,
  },
  modeIconMini: {
    marginRight: 8,
  },
  subscriptionPrice: {
    color: '#888',
    fontSize: 14,
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00d4aa',
    marginLeft: 8,
  },
  signalIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalIndicatorText: {
    fontSize: 14,
  },
  qualityBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  qualityBadgeTextSmall: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  noSignalIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noSignalText: {
    fontSize: 12,
  },
  subscriptionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subscriptionBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  timeframeBadgeSmall: {
    backgroundColor: '#00d4aa',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  timeframeBadgeText: {
    color: '#0a0a14',
    fontSize: 11,
    fontWeight: 'bold',
  },
  modeBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  modeBadgeTextSmall: {
    fontSize: 12,
  },
  deleteButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#ff4757',
    fontSize: 12,
    fontWeight: 'bold',
  },
  addFirstButton: {
    marginTop: 20,
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: '#00d4aa',
    borderRadius: 12,
  },
  addFirstText: {
    color: '#0a0a14',
    fontSize: 16,
    fontWeight: '600',
  },
  addPairButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 2,
    borderColor: '#2a2a4a',
    borderStyle: 'dashed',
  },
  addPairIcon: {
    color: '#00d4aa',
    fontSize: 24,
    marginRight: 8,
  },
  addPairText: {
    color: '#888',
    fontSize: 14,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a4a',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    marginBottom: 8,
  },
  clearButtonTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a4a',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  clearButtonText: {
    color: '#ff4757',
    fontSize: 14,
    fontWeight: '600',
  },
  notificationCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  notificationTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  notificationBody: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 8,
  },
  notificationTime: {
    color: '#666',
    fontSize: 12,
  },
});

export default HomeScreen;

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
} from '../services/api';
import { getNotificationHistory, getStoredPushToken } from '../services/notifications';
import SignalCard from '../components/SignalCard';
import PairCard from '../components/PairCard';
import PairDetailModal from '../components/PairDetailModal';
import AddSubscriptionModal from '../components/AddSubscriptionModal';

const TRADING_MODE_LABELS = {
  conservative: { label: 'Conservador', emoji: '🔥' },
  balanced: { label: 'Balanceado', emoji: '🟡' },
  aggressive: { label: 'Agresivo', emoji: '⚠️' },
};

const getModeColor = (mode) => {
  switch (mode) {
    case 'conservative': return '#00d4aa';
    case 'balanced': return '#ffd93d';
    case 'aggressive': return '#ff9f43';
    default: return '#888';
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
  const [signals, setSignals] = useState([]);
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
    setExpandedSubs(prev => ({
      ...prev,
      [subId]: !prev[subId]
    }));
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
      } else if (activeTab === 'signals') {
        // Get signals filtered by user's subscriptions
        const data = await getSignals(20, null, pushToken);
        setSignals(data.signals || []);
      } else {
        const history = await getNotificationHistory();
        setNotifications(history);
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

      return (
        <>
          {subscriptions.map((sub) => {
            const modeInfo = TRADING_MODE_LABELS[sub.trading_mode] || TRADING_MODE_LABELS.balanced;
            const isExpanded = expandedSubs[sub.id] !== false; // Default expanded
            const pairData = marketData[`${sub.pair}_${sub.timeframe}`];
            const price = pairData?.price;
            const hasSignal = pairData?.indicators && (
              (pairData.indicators.price_above_ema && pairData.indicators.rsi_rising) ||
              (!pairData.indicators.price_above_ema && pairData.indicators.rsi_falling)
            );

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
                    <Text style={styles.subscriptionPairName}>{sub.pair.replace('/USDT', '')}</Text>
                    {price && (
                      <Text style={styles.subscriptionPrice}>{formatPrice(price)}</Text>
                    )}
                    {hasSignal && (
                      <View style={styles.signalDot} />
                    )}
                  </View>
                  <View style={styles.subscriptionRight}>
                    <View style={styles.subscriptionBadges}>
                      <View style={styles.timeframeBadgeSmall}>
                        <Text style={styles.timeframeBadgeText}>{sub.timeframe}</Text>
                      </View>
                      <View style={[styles.modeBadgeSmall, { backgroundColor: getModeColor(sub.trading_mode) }]}>
                        <Text style={styles.modeBadgeTextSmall}>{modeInfo.emoji}</Text>
                      </View>
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
      return signals.map((signal, index) => (
        <SignalCard key={`${signal.timestamp}-${index}`} signal={signal} />
      ));
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

    return notifications.map((notif) => (
      <View key={notif.id} style={styles.notificationCard}>
        <Text style={styles.notificationTitle}>{notif.title}</Text>
        <Text style={styles.notificationBody}>{notif.body}</Text>
        <Text style={styles.notificationTime}>
          {new Date(notif.receivedAt).toLocaleString('es-ES')}
        </Text>
      </View>
    ));
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
    marginBottom: 8,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 4,
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
    marginRight: 10,
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

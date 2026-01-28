import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  Animated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import {
  getUnifiedMarketData,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
} from '../services/api';
import { getStoredPushToken } from '../services/notifications';
import PairCard from '../components/PairCard';
import PairDetailModal from '../components/PairDetailModal';
import AddSubscriptionModal from '../components/AddSubscriptionModal';
import NotificationsModal from '../components/NotificationsModal';

// Alert type styles for AlertCard
const ALERT_STYLES = {
  htf_bias_changed: { icon: '📊', color: '#ffd93d', label: 'Sesgo HTF' },
  scenario_changed: { icon: '🎯', color: '#00d4aa', label: 'Escenario' },
  volatility_changed: { icon: '📈', color: '#ff9f43', label: 'Volatilidad' },
  price_at_key_zone: { icon: '🔑', color: '#00d4aa', label: 'Zona Clave' },
  coherence_changed: { icon: '⚠️', color: '#ffd93d', label: 'Coherencia' },
  thesis_invalidated: { icon: '🚨', color: '#ff4757', label: 'Tesis Invalidada' },
  htf_momentum_changed: { icon: '💫', color: '#ff9f43', label: 'Momentum HTF' },
  multiple_against_context: { icon: '⚡', color: '#ff4757', label: 'Riesgo' },
  high_risk_exposure: { icon: '🔥', color: '#ff4757', label: 'Alto Riesgo' },
};

const formatTimeAgo = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'Ahora';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

// AlertCard component for displaying notifications
const AlertCard = ({ notification }) => {
  const style = ALERT_STYLES[notification.type] || { icon: '📣', color: '#888', label: 'Alerta' };
  const symbolShort = notification.symbol?.replace('/USDT', '').replace(':USDT', '');

  return (
    <View style={[alertStyles.card, !notification.is_read && alertStyles.cardUnread]}>
      <View style={[alertStyles.iconContainer, { backgroundColor: style.color + '20' }]}>
        <Text style={alertStyles.icon}>{style.icon}</Text>
      </View>
      <View style={alertStyles.content}>
        <View style={alertStyles.header}>
          <Text style={alertStyles.title} numberOfLines={1}>{notification.title}</Text>
          <Text style={alertStyles.time}>{formatTimeAgo(notification.created_at)}</Text>
        </View>
        <Text style={alertStyles.message} numberOfLines={2}>{notification.message}</Text>
        {symbolShort && (
          <View style={[alertStyles.symbolBadge, { borderColor: style.color }]}>
            <Text style={[alertStyles.symbolText, { color: style.color }]}>{symbolShort}</Text>
          </View>
        )}
      </View>
      {!notification.is_read && <View style={[alertStyles.unreadDot, { backgroundColor: style.color }]} />}
    </View>
  );
};

const alertStyles = {
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardUnread: {
    backgroundColor: '#1e1e35',
    borderLeftWidth: 3,
    borderLeftColor: '#00d4aa',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 18,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  time: {
    color: '#666',
    fontSize: 11,
  },
  message: {
    color: '#999',
    fontSize: 13,
    lineHeight: 18,
  },
  symbolBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 8,
  },
  symbolText: {
    fontSize: 11,
    fontWeight: '600',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
    marginTop: 6,
  },
};

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
  const [notifications, setNotifications] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [pushToken, setPushToken] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [notificationsModalVisible, setNotificationsModalVisible] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
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

        // Get unique pairs from subscriptions (ignore timeframe - we now show unified analysis)
        const uniquePairs = [...new Set(subs.map(s => s.pair))];

        // Fetch unified market data (4H + 15m combined) for all pairs
        if (uniquePairs.length > 0) {
          try {
            const data = await getUnifiedMarketData(uniquePairs, forceRefresh);
            const unifiedPairs = data.pairs || {};
            // Key by pair only (not timeframe)
            setMarketData(unifiedPairs);
          } catch (err) {
            console.log('Could not fetch unified market data:', err);
            setMarketData({});
          }
        } else {
          setMarketData({});
        }
        setLastUpdate(new Date());
      } else if (activeTab === 'alerts') {
        // Get alerts from the new notifications system
        try {
          const data = await getNotifications(100);
          setNotifications(data.notifications || []);
          setUnreadNotifications(data.unread_count || 0);
        } catch (err) {
          console.log('Could not fetch alerts:', err);
          setNotifications([]);
        }
      }
    } catch (err) {
      setError('Error conectando al servidor');
      console.error('Fetch error:', err);
    }
  }, [activeTab, pushToken]);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds with forceRefresh=true to bypass cache
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Fetch unread notifications count
  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setUnreadNotifications(data.unread_count || 0);
    } catch (err) {
      // Ignore errors - not critical
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    // Refresh count every 60 seconds
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

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

      // Scenario styles for header badges
      const SCENARIO_STYLES = {
        favorable: { label: 'Favorable', color: '#00d4aa' },
        operable: { label: 'Operable', color: '#ffd93d' },
        alto_riesgo: { label: 'Alto Riesgo', color: '#ff4757' },
        espera: { label: 'Espera', color: '#888' },
      };

      // Render right swipe action (delete)
      const renderRightActions = (progress, dragX, subId) => {
        const scale = dragX.interpolate({
          inputRange: [-100, 0],
          outputRange: [1, 0.5],
          extrapolate: 'clamp',
        });
        return (
          <TouchableOpacity
            style={styles.swipeDeleteAction}
            onPress={() => handleRemoveSubscription(subId)}
          >
            <Animated.Text style={[styles.swipeDeleteText, { transform: [{ scale }] }]}>
              🗑️
            </Animated.Text>
          </TouchableOpacity>
        );
      };

      // Get unique pairs from subscriptions
      const uniquePairs = [...new Set(subscriptions.map(s => s.pair))];

      return (
        <>
          {uniquePairs.map((pair) => {
            // Find the first subscription for this pair (for trading mode display)
            const sub = subscriptions.find(s => s.pair === pair);
            const isExpanded = expandedSubs[pair] !== false; // Default expanded, key by pair
            const pairData = marketData[pair];
            const price = pairData?.price;
            const analysis = pairData?.analysis;

            // Get scenario from backend analysis
            const scenario = analysis?.scenario || 'espera';
            const scenarioStyle = SCENARIO_STYLES[scenario] || SCENARIO_STYLES.espera;
            const directionPref = analysis?.direction_preference;

            // Get HTF bias for display
            const htfBias = analysis?.context?.htf_bias || 'neutral';

            return (
              <Swipeable
                key={pair}
                renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, sub?.id)}
                rightThreshold={40}
              >
                <View style={styles.subscriptionWrapper}>
                  {/* Compact header - always visible */}
                  <TouchableOpacity
                    style={styles.subscriptionHeader}
                    onPress={() => toggleExpanded(pair)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.subscriptionLeft}>
                      <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
                      <View style={styles.modeIconMini}>
                        <SignalBars
                          level={TRADING_MODE_LABELS[sub?.trading_mode]?.level || 2}
                          color={getModeColor(sub?.trading_mode)}
                          size={14}
                        />
                      </View>
                      <Text style={styles.subscriptionPairName}>{pair.replace('/USDT', '')}</Text>
                      {price && (
                        <Text style={styles.subscriptionPrice}>{formatPrice(price)}</Text>
                      )}
                      {/* Show 4H+15m badge instead of single timeframe */}
                      <View style={styles.unifiedBadge}>
                        <Text style={styles.unifiedBadgeText}>4H+15m</Text>
                      </View>
                    </View>
                    <View style={styles.subscriptionBadges}>
                      {/* Direction preference indicator */}
                      {directionPref && (
                        <View style={[styles.signalIndicator, { backgroundColor: directionPref === 'long' ? '#00d4aa' : '#ff4757' }]}>
                          <Text style={styles.signalIndicatorText}>
                            {directionPref === 'long' ? '↑' : '↓'}
                          </Text>
                        </View>
                      )}
                      {/* Scenario badge */}
                      <View style={[styles.qualityBadgeSmall, { backgroundColor: scenarioStyle.color + '30', borderColor: scenarioStyle.color }]}>
                        <Text style={[styles.qualityBadgeTextSmall, { color: scenarioStyle.color }]}>
                          {scenarioStyle.label}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Expanded content */}
                  {isExpanded && (
                    <PairCard
                      pair={pair}
                      data={pairData}
                      unified={true}
                      embedded={true}
                      onPress={() => {
                        setSelectedPair(pair);
                        setSelectedSubscription(sub);
                        setModalVisible(true);
                      }}
                    />
                  )}
                </View>
              </Swipeable>
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

    // Alerts tab (activeTab === 'alerts')
    if (notifications.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>Sin alertas</Text>
          <Text style={styles.emptyHint}>Las alertas de cambios en contexto, posiciones y riesgo apareceran aqui</Text>
        </View>
      );
    }

    return (
      <>
        <TouchableOpacity
          style={styles.clearButtonTop}
          onPress={async () => {
            try {
              await markAllNotificationsRead();
              setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
              setUnreadNotifications(0);
            } catch (e) {
              console.error('Error marking all read:', e);
            }
          }}
        >
          <Text style={styles.clearButtonText}>✓ Marcar todas como leidas</Text>
        </TouchableOpacity>
        {notifications.map((notif) => (
          <AlertCard key={notif.id} notification={notif} />
        ))}
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
              <Text style={styles.title}>Crypto Criterios</Text>
              <TouchableOpacity
                style={styles.subtitleLink}
                onPress={() => Linking.openURL('https://www.instagram.com/austin.app')}
              >
                <Text style={styles.instagramIcon}>📷</Text>
                <Text style={styles.subtitle}>@austin.app</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.headerRight}>
            {/* Bell icon for notifications */}
            <TouchableOpacity
              style={styles.bellButton}
              onPress={() => setNotificationsModalVisible(true)}
            >
              <Text style={styles.bellIcon}>🔔</Text>
              {unreadNotifications > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            {subscriptions.length > 0 && activeTab === 'market' && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{[...new Set(subscriptions.map(s => s.pair))].length} pares</Text>
              </View>
            )}
          </View>
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
          { key: 'alerts', label: 'Alertas', icon: '🔔' },
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
        data={selectedPair ? marketData[selectedPair] : null}
        subscription={selectedSubscription}
      />

      <AddSubscriptionModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onAdd={handleAddSubscription}
        existingSubscriptions={subscriptions}
      />

      <NotificationsModal
        visible={notificationsModalVisible}
        onClose={() => setNotificationsModalVisible(false)}
        onUnreadCountChange={setUnreadNotifications}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bellButton: {
    position: 'relative',
    padding: 8,
  },
  bellIcon: {
    fontSize: 22,
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#ff4757',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  bellBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
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
  subscriptionBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeframeBadgeSmall: {
    backgroundColor: '#00d4aa',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 12,
  },
  timeframeBadgeText: {
    color: '#0a0a14',
    fontSize: 11,
    fontWeight: 'bold',
  },
  unifiedBadge: {
    backgroundColor: '#2a2a5a',
    borderWidth: 1,
    borderColor: '#00d4aa',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 12,
  },
  unifiedBadgeText: {
    color: '#00d4aa',
    fontSize: 10,
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
  swipeDeleteAction: {
    backgroundColor: '#ff4757',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 12,
    borderRadius: 12,
  },
  swipeDeleteText: {
    fontSize: 24,
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

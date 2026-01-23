import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Image,
  Linking,
} from 'react-native';
import { getMarketData, getSignals, getUserPairs, getUserTimeframe } from '../services/api';
import { getNotificationHistory } from '../services/notifications';
import SignalCard from '../components/SignalCard';
import PairCard from '../components/PairCard';
import PairDetailModal from '../components/PairDetailModal';
import PairSelectorModal from '../components/PairSelectorModal';

const HomeScreen = () => {
  const [activeTab, setActiveTab] = useState('market');
  const [marketData, setMarketData] = useState({});
  const [signals, setSignals] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [userPairs, setUserPairs] = useState([]);
  const [timeframe, setTimeframe] = useState('4h');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [pairSelectorVisible, setPairSelectorVisible] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    try {
      setError(null);
      const pairs = await getUserPairs();
      setUserPairs(pairs);

      const tf = await getUserTimeframe();
      setTimeframe(tf);

      if (activeTab === 'market') {
        const data = await getMarketData(null, forceRefresh);
        setMarketData(data.pairs || {});
        setLastUpdate(new Date());
      } else if (activeTab === 'signals') {
        const data = await getSignals(20);
        setSignals(data.signals || []);
      } else {
        const history = await getNotificationHistory();
        setNotifications(history);
      }
    } catch (err) {
      setError('Error conectando al servidor');
      console.error('Fetch error:', err);
    }
  }, [activeTab]);

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

  const handlePairsSaved = (newPairs) => {
    setUserPairs(newPairs);
    fetchData(true);
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
      return (
        <>
          {userPairs.map((pair) => (
            <PairCard
              key={pair}
              pair={pair}
              data={marketData[pair]}
              onPress={() => {
                setSelectedPair(pair);
                setModalVisible(true);
              }}
            />
          ))}
          <TouchableOpacity
            style={styles.addPairButton}
            onPress={() => setPairSelectorVisible(true)}
          >
            <Text style={styles.addPairIcon}>+</Text>
            <Text style={styles.addPairText}>Agregar o quitar pares</Text>
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
          <View style={styles.headerRight}>
            <View style={styles.timeframeBadge}>
              <Text style={styles.timeframeText}>{timeframe}</Text>
            </View>
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
        onClose={() => setModalVisible(false)}
        pair={selectedPair}
        data={selectedPair ? marketData[selectedPair] : null}
      />

      <PairSelectorModal
        visible={pairSelectorVisible}
        onClose={() => setPairSelectorVisible(false)}
        onSave={handlePairsSaved}
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
  timeframeBadge: {
    backgroundColor: '#00d4aa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  timeframeText: {
    color: '#0a0a14',
    fontSize: 14,
    fontWeight: 'bold',
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

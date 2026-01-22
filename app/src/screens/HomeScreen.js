import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { getMarketData, getSignals, getUserPairs } from '../services/api';
import { getNotificationHistory } from '../services/notifications';
import SignalCard from '../components/SignalCard';
import PairCard from '../components/PairCard';

const HomeScreen = () => {
  const [activeTab, setActiveTab] = useState('market');
  const [marketData, setMarketData] = useState({});
  const [signals, setSignals] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [userPairs, setUserPairs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    try {
      setError(null);
      const pairs = await getUserPairs();
      setUserPairs(pairs);

      if (activeTab === 'market') {
        const data = await getMarketData(null, forceRefresh);
        console.log('Market data received:', JSON.stringify(data).substring(0, 200));
        console.log('Pairs keys:', Object.keys(data.pairs || {}));
        setMarketData(data.pairs || {});
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
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true); // Force refresh from Binance API
    setRefreshing(false);
  }, [fetchData]);

  const renderContent = () => {
    if (error) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'market') {
      console.log('Rendering market - userPairs:', userPairs, 'marketData keys:', Object.keys(marketData));
      return userPairs.map((pair) => (
        <PairCard key={pair} pair={pair} data={marketData[pair]} />
      ));
    }

    if (activeTab === 'signals') {
      if (signals.length === 0) {
        return (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No hay señales recientes</Text>
          </View>
        );
      }
      return signals.map((signal, index) => (
        <SignalCard key={`${signal.timestamp}-${index}`} signal={signal} />
      ));
    }

    // Notifications tab
    if (notifications.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No hay notificaciones</Text>
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
      <View style={styles.header}>
        <Text style={styles.title}>Señales Crypto</Text>
        <Text style={styles.subtitle}>by austin</Text>
      </View>

      <View style={styles.tabs}>
        {['market', 'signals', 'history'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab === 'market' ? 'Mercado' : tab === 'signals' ? 'Señales' : 'Historial'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00d4aa" />}
      >
        {renderContent()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#00d4aa',
    fontSize: 14,
    marginTop: 4,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: '#1e1e2e',
  },
  activeTab: {
    backgroundColor: '#00d4aa',
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#0f0f1a',
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
    paddingVertical: 40,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#00d4aa',
    borderRadius: 8,
  },
  retryText: {
    color: '#0f0f1a',
    fontWeight: '600',
  },
  notificationCard: {
    backgroundColor: '#1e1e2e',
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
    color: '#888',
    fontSize: 12,
  },
});

export default HomeScreen;

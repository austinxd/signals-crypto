import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPositions } from '../services/api';
import PositionCard from '../components/PositionCard';

const PositionsScreen = ({ navigation }) => {
  const [positions, setPositions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [totalPnl, setTotalPnl] = useState(0);
  const [mode, setMode] = useState(null);

  const fetchPositions = useCallback(async () => {
    try {
      setError(null);
      const data = await getPositions();
      const pos = data.positions || [];
      setPositions(pos);
      setMode(data.mode || null);
      const pnl = pos.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
      setTotalPnl(pnl);
    } catch (err) {
      if (err.status === 401) {
        setError('Inicia sesión para ver posiciones');
      } else {
        setError('Error cargando posiciones');
      }
      console.error('Positions error:', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPositions();
    }, [fetchPositions])
  );

  useEffect(() => {
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPositions();
    setRefreshing(false);
  }, [fetchPositions]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Posiciones</Text>
        {positions.length > 0 && (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>{positions.length} abiertas</Text>
            <Text style={[styles.summaryPnl, { color: totalPnl >= 0 ? '#00d4aa' : '#ff4757' }]}>
              {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USDT
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00d4aa"
          />
        }
      >
        {error ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⚠️</Text>
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : positions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>No hay posiciones abiertas</Text>
            <Text style={styles.emptyHint}>
              Conecta tu cuenta de Binance en Ajustes
            </Text>
            <TouchableOpacity
              style={styles.configButton}
              onPress={() => navigation?.navigate?.('Settings')}
            >
              <Text style={styles.configButtonText}>Configurar Binance</Text>
            </TouchableOpacity>
          </View>
        ) : (
          positions.map((pos) => (
            <PositionCard key={pos.id || pos.symbol} position={{ ...pos, mode }} />
          ))
        )}
      </ScrollView>
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
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  summaryLabel: {
    color: '#888',
    fontSize: 14,
  },
  summaryPnl: {
    fontSize: 16,
    fontWeight: 'bold',
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
  configButton: {
    marginTop: 20,
    backgroundColor: '#00d4aa',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  configButtonText: {
    color: '#0a0a14',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default PositionsScreen;

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import {
  getUnifiedMarketData,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  getUnreadCount,
} from '../services/api';
import PairCard from '../components/PairCard';
import PairDetailModal from '../components/PairDetailModal';
import AddSubscriptionModal from '../components/AddSubscriptionModal';
import NotificationsModal from '../components/NotificationsModal';
import LockedPairCard from '../components/LockedPairCard';
import { Screen, Button, Empty, Loading, Notice, Help } from '../components/ui';
import { explain } from '../explain';
import { useSubscription } from '../context/SubscriptionContext';
import { colors, space, radius, type, pairName, timeAgo } from '../theme';

/** Header buttons: add a coin, and open the alerts list (with how many are unread). */
const HeaderButtons = ({ unread, onAdd, onAlerts }) => (
  <View style={styles.headerButtons}>
    <TouchableOpacity style={styles.headButton} onPress={onAdd} activeOpacity={0.75}>
      <Text style={styles.headButtonText}>+ Moneda</Text>
    </TouchableOpacity>
    <TouchableOpacity style={styles.headButton} onPress={onAlerts} activeOpacity={0.75}>
      <Text style={styles.headButtonText}>Avisos</Text>
      {unread > 0 && (
        <View style={styles.alertsBadge}>
          <Text style={styles.alertsBadgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  </View>
);

const WHAT_IS = 'Son apuestas en futuros, no compras de monedas. Long: ganas si el precio sube y pierdes si baja. '
  + 'Short: ganas si baja y pierdes si sube.';
const WHAT_ANALYZES = 'Solo futuros de Binance (USDT-M). No mira ni toca las monedas que tengas compradas en tu billetera spot. '
  + 'Lo que ves es una sugerencia, no una orden: aquí no se mueve dinero de nadie.';

const HomeScreen = () => {
  const navigation = useNavigation();
  const { isPremium } = useSubscription();

  const [marketData, setMarketData] = useState({});
  const [subscriptions, setSubscriptions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [notificationsModalVisible, setNotificationsModalVisible] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    // On a failure keep whatever was loaded before: a network blip must not look like an empty account.
    try {
      const result = await getSubscriptions();
      const subs = result?.subscriptions || [];
      setSubscriptions(subs);

      // One unified analysis (4h + 15m) per coin
      const pairs = [...new Set(subs.map((s) => s.pair))];
      if (pairs.length > 0) {
        const data = await getUnifiedMarketData(pairs, forceRefresh);
        setMarketData(data?.pairs || {});
      } else {
        setMarketData({});
      }
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError('No se pudo conectar con el servidor.');
      console.log('Fetch error:', err?.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds, bypassing the cache
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setUnreadNotifications(data?.unread_count || 0);
    } catch (err) {
      // Not critical
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  }, [fetchData]);

  const handleAddSubscription = async (pair) => {
    try {
      await addSubscription(pair);
      fetchData(true);
    } catch (err) {
      console.error('Error adding subscription:', err);
      Alert.alert('No se pudo añadir', 'Inténtalo de nuevo en unos segundos.');
    }
  };

  const handleRemoveSubscription = (subscriptionId, pair) => {
    if (subscriptionId == null) return;
    Alert.alert(
      `Dejar de seguir ${pairName(pair) || 'esta moneda'}`,
      'Ya no verás su análisis ni recibirás sus avisos. Puedes volver a añadirla cuando quieras.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Dejar de seguir',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSubscription(subscriptionId);
              fetchData(true);
            } catch (err) {
              console.error('Error removing subscription:', err);
              Alert.alert('No se pudo quitar', 'Inténtalo de nuevo en unos segundos.');
            }
          },
        },
      ]
    );
  };

  const uniquePairs = [...new Set(subscriptions.map((s) => s.pair))];

  const renderContent = () => {
    if (!loaded) return <Loading label="Cargando el mercado…" />;

    if (error && !lastUpdate) {
      return <Empty title="Sin conexión" hint="No se pudo conectar con el servidor. Comprueba tu conexión." actionLabel="Reintentar" onAction={onRefresh} />;
    }

    if (uniquePairs.length === 0) {
      return (
        <>
          <Empty
            title="Aún no sigues ninguna moneda"
            hint="Añade una y verás si es momento de abrir long (apostar a que sube), short (apostar a que baja) o de esperar."
            actionLabel="Añadir mi primera moneda"
            onAction={() => setAddModalVisible(true)}
          />
          <View style={styles.tour}>
            <Text style={styles.tourLine}><Text style={styles.tourName}>Mercado: </Text>análisis de futuros. No mueve dinero.</Text>
            <Text style={styles.tourLine}><Text style={styles.tourName}>Mi Binance: </Text>tus futuros abiertos, con dinero real.</Text>
            <Text style={styles.tourLine}><Text style={styles.tourName}>Bot: </Text>práctica automática con dinero simulado.</Text>
          </View>
        </>
      );
    }

    // Free plan: only the first coin added is analysed, the rest are locked. Among the visible ones,
    // those that can be opened now go first.
    const rows = uniquePairs.map((pair, index) => {
      const locked = !isPremium && index > 0;
      const analysis = locked ? null : marketData?.[pair]?.analysis;
      return { pair, index, locked, view: analysis ? explain(analysis) : null, sub: subscriptions.find((s) => s.pair === pair) };
    });
    const rank = (r) => (r.locked ? 2 : r.view?.act ? 0 : 1);
    rows.sort((a, b) => rank(a) - rank(b) || a.index - b.index);

    const analysed = rows.filter((r) => r.view);
    const ready = analysed.filter((r) => r.view.act);
    const summary = analysed.length === 0 ? null
      : ready.length === 0
        ? (analysed.length === 1 ? 'Ahora toca esperar.' : `Ninguna de las ${analysed.length} con buen momento ahora: toca esperar.`)
        : `${ready.length} de ${analysed.length} con momento para abrir: ${ready.map((r) => `${pairName(r.pair)} ${r.view.side}`).join(', ')}.`;

    return (
      <>
        {!!error && (
          <Notice tone="warn">Sin conexión. Se muestra lo último recibido.</Notice>
        )}
        {!!summary && <Text style={[styles.summary, ready.length > 0 && { color: colors.text }]}>{summary}</Text>}

        {rows.map(({ pair, locked, sub }) => {
          if (locked) {
            return (
              <LockedPairCard
                key={pair}
                pair={pair}
                onPress={() => navigation.navigate('Upgrade')}
                onRemove={() => handleRemoveSubscription(sub?.id, pair)}
              />
            );
          }
          return (
            <Swipeable
              key={pair}
              rightThreshold={40}
              renderRightActions={() => (
                <TouchableOpacity
                  style={styles.swipeAction}
                  onPress={() => handleRemoveSubscription(sub?.id, pair)}
                >
                  <Text style={styles.swipeText}>Quitar</Text>
                </TouchableOpacity>
              )}
            >
              <PairCard
                pair={pair}
                data={marketData?.[pair]}
                onPress={() => {
                  setSelectedPair(pair);
                  setSelectedSubscription(sub);
                  setModalVisible(true);
                }}
                onLongPress={() => handleRemoveSubscription(sub?.id, pair)}
              />
            </Swipeable>
          );
        })}

        <Button label="Añadir otra moneda" kind="secondary" onPress={() => setAddModalVisible(true)} style={{ marginTop: space.xs }} />

        <Help label="¿Qué es long y short?" style={styles.help}>{WHAT_IS}</Help>
        <Help label="¿Qué analiza la app?" style={styles.help}>{WHAT_ANALYZES}</Help>
        <Text style={styles.legal}>Lectura automática que puede fallar. No es una recomendación de inversión.</Text>
      </>
    );
  };

  const subtitle = uniquePairs.length === 0
    ? 'Las monedas que sigues'
    : `${uniquePairs.length} ${uniquePairs.length === 1 ? 'moneda' : 'monedas'}${lastUpdate ? ` · ${timeAgo(lastUpdate)}` : ''}`;

  return (
    <>
      <Screen
        title="Mercado"
        subtitle={subtitle}
        money="market"
        right={(
          <HeaderButtons
            unread={unreadNotifications}
            onAdd={() => setAddModalVisible(true)}
            onAlerts={() => setNotificationsModalVisible(true)}
          />
        )}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {renderContent()}
      </Screen>

      <PairDetailModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setSelectedSubscription(null);
        }}
        pair={selectedPair}
        data={selectedPair ? marketData?.[selectedPair] : null}
        subscription={selectedSubscription}
        onRemove={selectedSubscription?.id != null ? () => {
          setModalVisible(false);
          handleRemoveSubscription(selectedSubscription.id, selectedPair);
          setSelectedSubscription(null);
        } : undefined}
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
    </>
  );
};

const styles = StyleSheet.create({
  headerButtons: { flexDirection: 'row', gap: space.sm, marginLeft: space.md },
  headButton: {
    flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 10,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  headButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  alertsBadge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, marginLeft: 6,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  alertsBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  summary: { ...type.bodyDim, fontWeight: '600', marginBottom: space.md, paddingHorizontal: space.xs },
  swipeAction: {
    width: 96, marginBottom: space.sm, marginLeft: space.sm, borderRadius: radius.lg,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  swipeText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  help: { marginTop: space.lg, paddingHorizontal: space.xs },
  legal: { ...type.small, textAlign: 'center', marginTop: space.xl },
  tour: { paddingHorizontal: space.lg, gap: space.sm },
  tourLine: { ...type.bodyDim },
  tourName: { color: colors.text, fontWeight: '700' },
});

export default HomeScreen;

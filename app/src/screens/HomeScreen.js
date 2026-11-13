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
import { Screen, Button, Empty, Loading, Notice } from '../components/ui';
import { useSubscription } from '../context/SubscriptionContext';
import { colors, space, radius, type, pairName, timeAgo } from '../theme';

/** Header button that opens the alerts list; shows how many are unread. */
const AlertsButton = ({ unread, onPress }) => (
  <TouchableOpacity style={styles.alertsButton} onPress={onPress} activeOpacity={0.75}>
    <Text style={styles.alertsText}>Avisos</Text>
    {unread > 0 && (
      <View style={styles.alertsBadge}>
        <Text style={styles.alertsBadgeText}>{unread > 99 ? '99+' : unread}</Text>
      </View>
    )}
  </TouchableOpacity>
);

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
        <Empty
          title="Aún no sigues ninguna moneda"
          hint="Añade una y te diremos si es buen momento para abrir long (apostar a que sube), short (apostar a que baja) o si es mejor esperar, y por qué. Es para futuros en Binance: la operación la haces tú, la app solo analiza."
          actionLabel="Añadir mi primera moneda"
          onAction={() => setAddModalVisible(true)}
        />
      );
    }

    return (
      <>
        {!!error && (
          <Notice tone="warn">Sin conexión. Se muestra lo último recibido.</Notice>
        )}
        <Text style={styles.intro}>
          Para futuros en Binance. Long = apostar a que sube; short = apostar a que baja. La app analiza y avisa; la
          operación la haces tú (o el bot, en su pestaña).
        </Text>
        {uniquePairs.map((pair, index) => {
          // Free plan: only the first coin is visible, the rest are locked
          const isLocked = !isPremium && index > 0;
          if (isLocked) {
            const lockedSub = subscriptions.find((s) => s.pair === pair);
            return (
              <LockedPairCard
                key={pair}
                pair={pair}
                onPress={() => navigation.navigate('Upgrade')}
                onRemove={() => handleRemoveSubscription(lockedSub?.id, pair)}
              />
            );
          }

          const sub = subscriptions.find((s) => s.pair === pair);
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

        <Button label="Añadir otra moneda" kind="secondary" onPress={() => setAddModalVisible(true)} />
        <Text style={styles.hint}>
          Toca una moneda para ver por qué y qué hacer. Mantén pulsada (o desliza a la izquierda) para dejar de seguirla.
        </Text>
        <Notice tone="info" style={{ marginTop: space.lg }}>
          Es una lectura automática de indicadores y puede fallar. No es una recomendación de inversión: nunca arriesgues dinero que no puedas perder.
        </Notice>
      </>
    );
  };

  const subtitle = uniquePairs.length === 0
    ? 'Las monedas que sigues'
    : `${uniquePairs.length} ${uniquePairs.length === 1 ? 'moneda' : 'monedas'}${lastUpdate ? ` · actualizado ${timeAgo(lastUpdate)}` : ''}`;

  return (
    <>
      <Screen
        title="Mercado"
        subtitle={subtitle}
        right={<AlertsButton unread={unreadNotifications} onPress={() => setNotificationsModalVisible(true)} />}
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
  intro: { ...type.small, marginBottom: space.md, paddingHorizontal: space.xs },
  alertsButton: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: space.md,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    marginLeft: space.md,
  },
  alertsText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  alertsBadge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, marginLeft: space.sm,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  alertsBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  swipeAction: {
    width: 96, marginBottom: space.md, marginLeft: space.sm, borderRadius: radius.lg,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  swipeText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  hint: { ...type.small, textAlign: 'center', marginTop: space.md },
});

export default HomeScreen;

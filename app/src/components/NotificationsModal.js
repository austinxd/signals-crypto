import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../services/api';
import { ModalHeader, Chip, Empty, Loading } from './ui';
import { colors, space, radius, type, pairName, timeAgo, MONEY } from '../theme';

// What each kind of alert is about, in plain words.
const KIND = {
  // Market
  htf_bias_changed: { label: 'Cambio de tendencia', color: colors.warn },
  scenario_changed: { label: 'Nuevo veredicto', color: colors.info },
  confirmation_gained: { label: 'El precio acompaña', color: colors.accent },
  confirmation_lost: { label: 'El precio se frenó', color: colors.warn },
  volatility_changed: { label: 'Movimiento brusco', color: colors.warn },
  price_at_key_zone: { label: 'Precio en nivel importante', color: colors.info },
  favorable_conditions: { label: 'Buen momento', color: colors.accent },
  // Your positions
  coherence_changed: { label: 'Tu posición y el mercado', color: colors.warn },
  thesis_invalidated: { label: 'El motivo de tu posición ya no vale', color: colors.danger },
  htf_momentum_changed: { label: 'Cambio de fuerza', color: colors.warn },
  multiple_against_context: { label: 'Varias posiciones en contra', color: colors.danger },
  high_risk_exposure: { label: 'Demasiado riesgo abierto', color: colors.danger },
  // Exits
  trailing_breakeven: { label: 'Stop en precio de entrada', color: colors.accent },
  trailing_update: { label: 'Stop movido', color: colors.info },
  macd_reversal: { label: 'Posible giro', color: colors.warn },
  rsi_extreme: { label: 'Precio muy estirado', color: colors.danger },
  // Signals
  bot_trade: { label: 'Bot', color: colors.info },
  bot_alert: { label: 'Bot: atención', color: colors.danger },
  new_signal: { label: 'Señal nueva', color: colors.accent },
  signal_improved: { label: 'Señal mejorada', color: colors.accent },
  signal_long: { label: 'Sugerencia de long', color: colors.accent },
  signal_short: { label: 'Sugerencia de short', color: colors.danger },
};
const kindOf = (key) => KIND[String(key || '').toLowerCase()] || { label: 'Aviso', color: colors.textDim };

const POSITION_KINDS = [
  'coherence_changed', 'thesis_invalidated', 'htf_momentum_changed', 'multiple_against_context', 'high_risk_exposure',
  'trailing_breakeven', 'trailing_update', 'macd_reversal', 'rsi_extreme',
];
const BOT_ORIGIN = {
  live: { label: 'Bot · dinero real', color: MONEY.live.color },
  demo: { label: 'Bot · demo', color: MONEY.demo.color },
  paper: { label: 'Bot · simulado', color: MONEY.sim.color },
};

/** Extra data stored with an alert; the server may send it as an object or as JSON text. */
const dataOf = (notification) => {
  const d = notification?.data;
  if (d && typeof d === 'object') return d;
  if (typeof d === 'string') {
    try { return JSON.parse(d) || {}; } catch (e) { return {}; }
  }
  return {};
};

/**
 * Where an alert comes from, which is also whose money it talks about, and the tab that shows it:
 * the bot (simulated unless told otherwise), your own Binance positions (real), or the market analysis (no money).
 */
const originOf = (notification) => {
  const key = String(notification?.type || '').toLowerCase();
  if (key.startsWith('bot_')) return { ...(BOT_ORIGIN[dataOf(notification).broker] || BOT_ORIGIN.paper), tab: 'Bot' };
  if (POSITION_KINDS.includes(key)) return { label: 'Tu posición · real', color: MONEY.real.color, tab: 'Positions' };
  return { label: 'Mercado · análisis', color: MONEY.market.color, tab: 'Home' };
};

const NotificationItem = ({ notification, onPress }) => {
  const kind = kindOf(notification?.type);
  const origin = originOf(notification);
  const unread = !notification?.is_read;
  const symbol = pairName(notification?.symbol);

  return (
    <TouchableOpacity
      style={[styles.item, unread && { borderLeftColor: kind.color, backgroundColor: colors.surfaceAlt }]}
      onPress={() => onPress(notification)}
      activeOpacity={0.75}
    >
      <View style={styles.itemTop}>
        <View style={styles.itemChips}>
          <Chip label={origin.label} color={origin.color} />
          {!!symbol && <Chip label={symbol} color={colors.textDim} />}
          {unread && <Chip label="Nuevo" color={kind.color} solid />}
        </View>
        <Text style={type.small}>{timeAgo(notification?.created_at)}</Text>
      </View>
      <Text style={[styles.itemKind, { color: kind.color }]}>{kind.label}</Text>
      <Text style={[styles.itemTitle, !unread && { color: colors.textDim }]}>{notification?.title}</Text>
      {!!notification?.message && <Text style={type.bodyDim}>{notification.message}</Text>}
    </TouchableOpacity>
  );
};

const NotificationsModal = ({ visible, onClose, onUnreadCountChange }) => {
  const navigation = useNavigation();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getNotifications(100);
      setNotifications(data?.notifications || []);
      setUnreadCount(data?.unread_count || 0);
      if (onUnreadCountChange) {
        onUnreadCountChange(data?.unread_count || 0);
      }
    } catch (error) {
      console.log('Error fetching notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onUnreadCountChange]);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      fetchNotifications();
    }
  }, [visible, fetchNotifications]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  // Tapping an alert marks it read and opens the tab that shows its current state.
  const handleNotificationPress = async (notification) => {
    const tab = originOf(notification).tab;
    onClose && onClose();
    if (tab !== 'Home') navigation.navigate(tab);
    if (notification && !notification.is_read) {
      try {
        await markNotificationRead(notification.id);
        setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)));
        const newCount = Math.max(0, unreadCount - 1);
        setUnreadCount(newCount);
        if (onUnreadCountChange) {
          onUnreadCountChange(newCount);
        }
      } catch (error) {
        console.log('Error marking notification read:', error);
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      if (onUnreadCountChange) {
        onUnreadCountChange(0);
      }
    } catch (error) {
      console.log('Error marking all read:', error);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ModalHeader
          title="Avisos"
          subtitle={unreadCount > 0 ? `${unreadCount} sin leer · toca uno para ver cómo está ahora` : 'Toca uno para ver cómo está ahora'}
          onClose={onClose}
          right={
            unreadCount > 0 ? (
              <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAll}>
                <Text style={styles.markAllText}>Marcar todo leído</Text>
              </TouchableOpacity>
            ) : null
          }
        />

        {loading ? (
          <Loading label="Cargando avisos…" />
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item, index) => String(item?.id ?? index)}
            renderItem={({ item }) => <NotificationItem notification={item} onPress={handleNotificationPress} />}
            ListEmptyComponent={
              <Empty
                title="Aún no hay avisos"
                hint="Aquí verás los cambios en las monedas que sigues, en tus posiciones de Binance y en el bot. Para que te lleguen al teléfono, actívalos en Ajustes."
                actionLabel="Activar avisos"
                onAction={() => {
                  onClose && onClose();
                  navigation.navigate('Settings');
                }}
              />
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            }
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: space.lg, paddingBottom: 48, flexGrow: 1 },
  markAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  markAllText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  item: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.border,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  itemChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, flex: 1, marginRight: space.sm },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  itemKind: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
});

export default NotificationsModal;

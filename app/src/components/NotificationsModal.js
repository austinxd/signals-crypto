import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../services/api';
import { ModalHeader, Chip, Empty, Loading } from './ui';
import { colors, space, radius, type, pairName, timeAgo } from '../theme';

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
  signal_long: { label: 'Señal de compra', color: colors.accent },
  signal_short: { label: 'Señal de venta', color: colors.danger },
};
const kindOf = (key) => KIND[String(key || '').toLowerCase()] || { label: 'Aviso', color: colors.textDim };

const NotificationItem = ({ notification, onPress }) => {
  const kind = kindOf(notification?.type);
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
          <Chip label={kind.label} color={kind.color} />
          {!!symbol && <Chip label={symbol} color={colors.textDim} />}
        </View>
        <Text style={type.small}>{timeAgo(notification?.created_at)}</Text>
      </View>
      <Text style={[styles.itemTitle, !unread && { color: colors.textDim }]}>{notification?.title}</Text>
      {!!notification?.message && <Text style={type.bodyDim}>{notification.message}</Text>}
      {unread && <Text style={styles.itemHint}>Nuevo · toca para marcarlo como leído. Un aviso antiguo puede no valer ya: mira el estado actual en Mercado.</Text>}
    </TouchableOpacity>
  );
};

const NotificationsModal = ({ visible, onClose, onUnreadCountChange }) => {
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

  const handleNotificationPress = async (notification) => {
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
          subtitle={unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo leído'}
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
                hint="Aquí verás los cambios importantes en las monedas que sigues y en tus posiciones. Para que lleguen, activa los avisos en Ajustes."
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
  itemHint: { color: colors.textMuted, fontSize: 12, marginTop: space.sm },
});

export default NotificationsModal;

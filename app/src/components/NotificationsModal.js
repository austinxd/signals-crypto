import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../services/api';

// Notification type icons and colors
const NOTIFICATION_STYLES = {
  // Context alerts
  htf_bias_changed: { icon: '📊', color: '#ffd93d', label: 'Sesgo HTF' },
  scenario_changed: { icon: '🎯', color: '#00d4aa', label: 'Escenario' },
  volatility_changed: { icon: '📈', color: '#ff9f43', label: 'Volatilidad' },
  price_at_key_zone: { icon: '🔑', color: '#00d4aa', label: 'Zona Clave' },
  // Position alerts
  coherence_changed: { icon: '⚠️', color: '#ffd93d', label: 'Coherencia' },
  thesis_invalidated: { icon: '🚨', color: '#ff4757', label: 'Tesis Invalidada' },
  htf_momentum_changed: { icon: '💫', color: '#ff9f43', label: 'Momentum HTF' },
  // Meta alerts
  multiple_against_context: { icon: '⚡', color: '#ff4757', label: 'Riesgo' },
  high_risk_exposure: { icon: '🔥', color: '#ff4757', label: 'Alto Riesgo' },
  // Exit alerts
  trailing_breakeven: { icon: '✅', color: '#00d4aa', label: 'Breakeven' },
  trailing_update: { icon: '📍', color: '#ffd93d', label: 'Trailing' },
  macd_reversal: { icon: '↩️', color: '#ff9f43', label: 'MACD' },
  rsi_extreme: { icon: '📉', color: '#ff4757', label: 'RSI' },
  // Signal alerts
  new_signal: { icon: '🔔', color: '#00d4aa', label: 'Signal' },
  signal_improved: { icon: '⬆️', color: '#00d4aa', label: 'Signal' },
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

const NotificationItem = ({ notification, onPress }) => {
  const style = NOTIFICATION_STYLES[notification.type] || { icon: '📣', color: '#888', label: 'Alerta' };

  return (
    <TouchableOpacity
      style={[styles.notificationItem, !notification.is_read && styles.notificationUnread]}
      onPress={() => onPress(notification)}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: style.color + '20' }]}>
        <Text style={styles.icon}>{style.icon}</Text>
      </View>
      <View style={styles.notificationContent}>
        <View style={styles.notificationHeader}>
          <Text style={styles.notificationTitle} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.notificationTime}>{formatTimeAgo(notification.created_at)}</Text>
        </View>
        <Text style={styles.notificationMessage} numberOfLines={2}>
          {notification.message}
        </Text>
        {notification.symbol && (
          <View style={[styles.symbolBadge, { borderColor: style.color }]}>
            <Text style={[styles.symbolText, { color: style.color }]}>
              {notification.symbol.replace('/USDT', '').replace(':USDT', '')}
            </Text>
          </View>
        )}
      </View>
      {!notification.is_read && <View style={[styles.unreadDot, { backgroundColor: style.color }]} />}
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
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
      if (onUnreadCountChange) {
        onUnreadCountChange(data.unread_count || 0);
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
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.id);
        setNotifications(prev =>
          prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n)
        );
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
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
      if (onUnreadCountChange) {
        onUnreadCountChange(0);
      }
    } catch (error) {
      console.log('Error marking all read:', error);
    }
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🔔</Text>
      <Text style={styles.emptyTitle}>Sin notificaciones</Text>
      <Text style={styles.emptyText}>
        Las alertas de cambios en contexto, posiciones y riesgo apareceran aqui.
      </Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Notificaciones</Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </View>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllButton}>
                <Text style={styles.markAllText}>Marcar leidas</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#00d4aa" />
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <NotificationItem notification={item} onPress={handleNotificationPress} />
              )}
              ListEmptyComponent={renderEmpty}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor="#00d4aa"
                  colors={['#00d4aa']}
                />
              }
              contentContainerStyle={notifications.length === 0 ? styles.emptyList : null}
            />
          )}

          {/* Close Button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '60%',
    paddingBottom: 30,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  unreadBadge: {
    backgroundColor: '#ff4757',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  markAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2a2a4a',
    borderRadius: 8,
  },
  markAllText: {
    color: '#00d4aa',
    fontSize: 13,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  notificationUnread: {
    backgroundColor: '#1e1e35',
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
    fontSize: 20,
  },
  notificationContent: {
    flex: 1,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  notificationTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  notificationTime: {
    color: '#666',
    fontSize: 12,
  },
  notificationMessage: {
    color: '#aaa',
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
  closeButton: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#2a2a4a',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default NotificationsModal;

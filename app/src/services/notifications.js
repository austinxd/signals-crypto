import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Storage keys
const PUSH_TOKEN_KEY = '@push_token';
const NOTIFICATION_HISTORY_KEY = '@notification_history';
const PUSH_ASKED_KEY = '@push_asked';

/**
 * Android shows notifications through channels. The server sends to `signals` and `alerts`, so both must exist;
 * the user sees one name for both.
 */
export async function ensureNotificationChannels() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('signals', {
      name: 'Avisos de Criterio',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#19d3a2',
      sound: 'notification.wav',
    });
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Avisos de Criterio',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#19d3a2',
    });
  } catch (error) {
    console.log('Could not create notification channels:', error && error.message);
  }
}

/** What the phone says about notifications for this app: 'granted' | 'denied' | 'undetermined'. */
export async function getPushPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' || status === 'denied' ? status : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/** Whether we already showed our own "¿Te avisamos?" question on this phone. */
export async function wasPushAsked() {
  try {
    return (await AsyncStorage.getItem(PUSH_ASKED_KEY)) === '1';
  } catch {
    return true; // if storage fails, do not nag
  }
}

export async function markPushAsked() {
  try {
    await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');
  } catch {
    // ignore
  }
}

const POSITION_ALERTS = [
  'coherence_changed', 'thesis_invalidated', 'htf_momentum_changed', 'multiple_against_context',
  'high_risk_exposure', 'trailing_breakeven', 'trailing_update', 'macd_reversal', 'rsi_extreme', 'exit_alert',
];

/** Which tab a tapped notification belongs to: 'Bot' | 'Positions' | 'Home'. */
export function tabForNotification(data) {
  const type = String((data && data.type) || '').toLowerCase();
  const alert = String((data && data.alert_type) || '').toLowerCase();
  if (type.startsWith('bot')) return 'Bot';
  if (POSITION_ALERTS.includes(alert) || POSITION_ALERTS.includes(type)) return 'Positions';
  if (data && data.symbol && !data.pair && data.side) return 'Positions';
  return 'Home';
}

/** The notification that opened the app from closed, if any. */
export async function getLaunchNotificationData() {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response ? response.notification.request.content.data || {} : null;
  } catch {
    return null;
  }
}

/**
 * Register for push notifications and get the token
 */
export async function registerForPushNotifications() {
  let token;

  await ensureNotificationChannels();

  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Failed to get push notification permissions');
    return null;
  }

  try {
    // Try to get token without projectId first (works in Expo Go for development)
    try {
      token = (await Notifications.getExpoPushTokenAsync()).data;
    } catch {
      // If that fails, try with projectId
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (projectId) {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      }
    }

    if (!token) {
      console.log('Could not get push token');
      return null;
    }

    // Store token locally
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

    return token;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

/**
 * Get stored push token
 */
export async function getStoredPushToken() {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Add notification listener
 */
export function addNotificationListener(callback) {
  const subscription = Notifications.addNotificationReceivedListener(notification => {
    // Store notification in history
    saveNotificationToHistory(notification.request.content);
    callback(notification);
  });
  return subscription;
}

/**
 * Add response listener (when user taps notification)
 */
export function addNotificationResponseListener(callback) {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    callback(response);
  });
  return subscription;
}

/**
 * Save notification to local history
 */
export async function saveNotificationToHistory(content) {
  try {
    const historyJson = await AsyncStorage.getItem(NOTIFICATION_HISTORY_KEY);
    const history = historyJson ? JSON.parse(historyJson) : [];

    const newNotification = {
      id: Date.now().toString(),
      title: content.title,
      body: content.body,
      data: content.data,
      receivedAt: new Date().toISOString(),
    };

    // Keep only last 50 notifications
    const updatedHistory = [newNotification, ...history].slice(0, 50);
    await AsyncStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify(updatedHistory));
  } catch (error) {
    console.error('Error saving notification:', error);
  }
}

/**
 * Get notification history
 */
export async function getNotificationHistory() {
  try {
    const historyJson = await AsyncStorage.getItem(NOTIFICATION_HISTORY_KEY);
    return historyJson ? JSON.parse(historyJson) : [];
  } catch {
    return [];
  }
}

/**
 * Clear notification history
 */
export async function clearNotificationHistory() {
  try {
    await AsyncStorage.removeItem(NOTIFICATION_HISTORY_KEY);
    return true;
  } catch {
    return false;
  }
}

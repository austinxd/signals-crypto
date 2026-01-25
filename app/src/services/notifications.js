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

/**
 * Register for push notifications and get the token
 */
export async function registerForPushNotifications() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('signals', {
      name: 'Trading Signals',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00d4aa',
      sound: 'notification.wav',
    });
  }

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

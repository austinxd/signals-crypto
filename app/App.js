import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PositionsScreen from './src/screens/PositionsScreen';
import AuthScreen from './src/screens/AuthScreen';
import {
  getStoredPushToken,
  addNotificationListener,
  addNotificationResponseListener,
  saveNotificationToHistory,
} from './src/services/notifications';
import { registerPushToken, getUserPairs, getUserTimeframe, isAuthenticated } from './src/services/api';

const Tab = createBottomTabNavigator();

const HomeIcon = ({ focused }) => (
  <Text style={[styles.icon, focused && styles.iconActive]}>📊</Text>
);
const PositionsIcon = ({ focused }) => (
  <Text style={[styles.icon, focused && styles.iconActive]}>💼</Text>
);
const SettingsIcon = ({ focused }) => (
  <Text style={[styles.icon, focused && styles.iconActive]}>⚙️</Text>
);

async function syncPushToken() {
  try {
    const token = await getStoredPushToken();
    if (token) {
      const pairs = await getUserPairs();
      const timeframe = await getUserTimeframe();
      await registerPushToken(token, pairs, timeframe);
      console.log('Push token synced with server');
    }
  } catch (error) {
    console.log('Could not sync push token:', error.message);
  }
}

export default function App() {
  const [authed, setAuthed] = useState(null); // null = loading

  useEffect(() => {
    isAuthenticated().then(setAuthed);
  }, []);

  useEffect(() => {
    if (!authed) return;

    syncPushToken();

    const notificationListener = addNotificationListener((notification) => {
      console.log('Notification received:', notification.request.content.title);
    });

    const responseListener = addNotificationResponseListener((response) => {
      const content = response.notification.request.content;
      saveNotificationToHistory(content);
      console.log('Notification tapped:', content.title);
    });

    return () => {
      notificationListener.remove();
      responseListener.remove();
    };
  }, [authed]);

  if (authed === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a14', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00d4aa" />
      </View>
    );
  }

  if (!authed) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <AuthScreen onAuthSuccess={() => setAuthed(true)} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: styles.tabBar,
            tabBarActiveTintColor: '#00d4aa',
            tabBarInactiveTintColor: '#888',
            tabBarLabelStyle: styles.tabLabel,
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{
              tabBarLabel: 'Inicio',
              tabBarIcon: ({ focused }) => <HomeIcon focused={focused} />,
            }}
          />
          <Tab.Screen
            name="Positions"
            component={PositionsScreen}
            options={{
              tabBarLabel: 'Posiciones',
              tabBarIcon: ({ focused }) => <PositionsIcon focused={focused} />,
            }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              tabBarLabel: 'Ajustes',
              tabBarIcon: ({ focused }) => <SettingsIcon focused={focused} />,
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#1e1e2e',
    borderTopColor: '#333',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 24,
    height: 80,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  icon: {
    fontSize: 24,
  },
  iconActive: {
    transform: [{ scale: 1.1 }],
  },
});

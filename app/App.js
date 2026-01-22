import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet } from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { getStoredPushToken } from './src/services/notifications';
import { registerPushToken, getUserPairs, getUserTimeframe } from './src/services/api';

const Tab = createBottomTabNavigator();

// Simple icon components
const HomeIcon = ({ focused }) => (
  <Text style={[styles.icon, focused && styles.iconActive]}>📊</Text>
);

const SettingsIcon = ({ focused }) => (
  <Text style={[styles.icon, focused && styles.iconActive]}>⚙️</Text>
);

// Auto-sync push token with server on app startup
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

  useEffect(() => {
    // Auto-sync push token on startup
    syncPushToken();
  }, []);

  return (
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
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarLabel: 'Ajustes',
            tabBarIcon: ({ focused }) => <SettingsIcon focused={focused} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
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

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PositionsScreen from './src/screens/PositionsScreen';
import BotScreen from './src/screens/BotScreen';
import AuthScreen from './src/screens/AuthScreen';
import UpgradeScreen from './src/screens/UpgradeScreen';
import { colors } from './src/theme';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import {
  getStoredPushToken,
  addNotificationListener,
  addNotificationResponseListener,
  saveNotificationToHistory,
} from './src/services/notifications';
import { registerPushToken, getUserPairs, getUserTimeframe, isAuthenticated, setOnAuthFailed } from './src/services/api';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Lets the Settings tab log the user out without re-creating the navigator on every render.
const LogoutContext = React.createContext(() => {});
const SettingsTab = () => <SettingsScreen onLogout={React.useContext(LogoutContext)} />;

// Text-only tab bar: the active tab gets a short accent bar above its label.
const tabIcon = ({ focused }) => <View style={[styles.tabMark, focused && styles.tabMarkOn]} />;

const TABS = [
  { name: 'Home', label: 'Mercado', component: HomeScreen },
  { name: 'Positions', label: 'Posiciones', component: PositionsScreen },
  { name: 'Bot', label: 'Bot', component: BotScreen },
  { name: 'Settings', label: 'Ajustes', component: SettingsTab },
];

const TabNavigator = () => {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, { height: 58 + insets.bottom, paddingBottom: insets.bottom + 6 }],
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: tabIcon,
      }}
    >
      {TABS.map((t) => (
        <Tab.Screen key={t.name} name={t.name} component={t.component} options={{ tabBarLabel: t.label }} />
      ))}
    </Tab.Navigator>
  );
};

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
  const logout = useCallback(() => setAuthed(false), []);

  useEffect(() => {
    isAuthenticated().then(setAuthed);

    // Handle when token refresh fails - redirect to login
    setOnAuthFailed(() => {
      console.log('Auth failed, redirecting to login');
      setAuthed(false);
    });
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
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!authed) {
    return (
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="light" />
          <AuthScreen onAuthSuccess={() => setAuthed(true)} />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SubscriptionProvider>
          <LogoutContext.Provider value={logout}>
            <NavigationContainer theme={navTheme}>
              <StatusBar style="light" />
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Main" component={TabNavigator} />
                <Stack.Screen name="Upgrade" component={UpgradeScreen} options={{ presentation: 'modal' }} />
              </Stack.Navigator>
            </NavigationContainer>
          </LogoutContext.Provider>
        </SubscriptionProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, primary: colors.accent, text: colors.text },
};

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  tabBar: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 6 },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabMark: { width: 24, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabMarkOn: { backgroundColor: colors.accent },
});

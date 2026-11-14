import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, ActivityIndicator, View, Alert } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PositionsScreen from './src/screens/PositionsScreen';
import BotScreen from './src/screens/BotScreen';
import AuthScreen from './src/screens/AuthScreen';
import UpgradeScreen from './src/screens/UpgradeScreen';
import { colors } from './src/theme';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import {
  registerForPushNotifications,
  ensureNotificationChannels,
  getPushPermission,
  wasPushAsked,
  markPushAsked,
  addNotificationListener,
  addNotificationResponseListener,
  tabForNotification,
  getLaunchNotificationData,
} from './src/services/notifications';
import { registerPushToken, isAuthenticated, setOnAuthFailed } from './src/services/api';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

// Lets the Settings tab log the user out without re-creating the navigator on every render.
const LogoutContext = React.createContext(() => {});
const SettingsTab = () => <SettingsScreen onLogout={React.useContext(LogoutContext)} />;

// Text-only tab bar: the active tab gets a short accent bar above its label.
const tabIcon = ({ focused }) => <View style={[styles.tabMark, focused && styles.tabMarkOn]} />;

const TABS = [
  { name: 'Home', label: 'Mercado', component: HomeScreen },
  { name: 'Positions', label: 'Mi Binance', component: PositionsScreen },
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

/** Gets this phone's push token and ties it to the logged-in account. Only works once permission is granted. */
async function registerThisPhone() {
  try {
    const token = await registerForPushNotifications();
    if (token) await registerPushToken(token);
  } catch (error) {
    console.log('Could not register for notifications:', error && error.message);
  }
}

/**
 * After login: if the phone already allows notifications, register quietly. If it has never been asked,
 * explain what the alerts are for first, and only then let the system ask for permission.
 */
async function setUpNotifications() {
  await ensureNotificationChannels();
  const permission = await getPushPermission();
  if (permission === 'granted') {
    await registerThisPhone();
    return;
  }
  if (permission !== 'undetermined' || (await wasPushAsked())) return;
  await markPushAsked();
  Alert.alert(
    '¿Te avisamos cuando algo cambie?',
    'Criterio puede avisarte cuando cambie la valoración de una moneda que sigues o pase algo con tus posiciones. '
      + 'Son avisos informativos; puedes activarlos más tarde en Ajustes.',
    [
      { text: 'Ahora no', style: 'cancel' },
      { text: 'Activar avisos', onPress: registerThisPhone },
    ],
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null); // null = loading
  const [authNotice, setAuthNotice] = useState(null); // shown on the login screen, e.g. after the session expires
  const pendingTab = useRef(null); // tab asked for by a tapped notification before the navigator was ready
  const logout = useCallback(() => setAuthed(false), []);

  const openTab = useCallback((tab) => {
    if (!tab) return;
    if (navigationRef.isReady()) {
      navigationRef.navigate('Main', { screen: tab });
    } else {
      pendingTab.current = tab;
    }
  }, []);

  const onNavigationReady = useCallback(() => {
    if (pendingTab.current) {
      navigationRef.navigate('Main', { screen: pendingTab.current });
      pendingTab.current = null;
    }
  }, []);

  useEffect(() => {
    isAuthenticated().then(setAuthed);

    // The login could not be renewed: back to the login screen, saying why
    setOnAuthFailed(() => {
      setAuthNotice('Tu sesión caducó. Vuelve a entrar para continuar.');
      setAuthed(false);
    });
  }, []);

  useEffect(() => {
    if (!authed) return;

    setUpNotifications();

    const notificationListener = addNotificationListener(() => {});

    // Tapping a notification opens the tab it talks about
    const responseListener = addNotificationResponseListener((response) => {
      openTab(tabForNotification(response?.notification?.request?.content?.data));
    });

    // Same when the tap is what opened the app
    getLaunchNotificationData().then((data) => {
      if (data) openTab(tabForNotification(data));
    });

    return () => {
      notificationListener.remove();
      responseListener.remove();
    };
  }, [authed, openTab]);

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
          <AuthScreen
            notice={authNotice}
            onAuthSuccess={() => {
              setAuthNotice(null);
              setAuthed(true);
            }}
          />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SubscriptionProvider>
          <LogoutContext.Provider value={logout}>
            <NavigationContainer theme={navTheme} ref={navigationRef} onReady={onNavigationReady}>
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

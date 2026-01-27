import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getApiUrl,
  setApiUrl,
  registerPushToken,
  sendTestNotification,
  getProfile,
  updateBinanceKeys,
  updateAccountSettings,
  logout,
} from '../services/api';
import {
  registerForPushNotifications,
  getStoredPushToken,
  clearNotificationHistory,
} from '../services/notifications';

const SettingsScreen = () => {
  const [apiUrl, setApiUrlState] = useState('');
  const [pushToken, setPushToken] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);

  // Account
  const [profile, setProfile] = useState(null);

  // Binance keys
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');

  // Mode & Risk
  const [botMode, setBotMode] = useState(false);
  const [riskPercent, setRiskPercent] = useState('2');
  const [riskFixedUsdt, setRiskFixedUsdt] = useState('');
  const [maxLeverage, setMaxLeverage] = useState('10');

  // Reload settings every time the screen is focused
  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  const loadSettings = async () => {
    try {
      setLoading(true);

      const url = await getApiUrl();
      setApiUrlState(url);

      const token = await getStoredPushToken();
      setPushToken(token);
      if (token) setIsRegistered(true);

      // Load profile
      try {
        const p = await getProfile();
        console.log('Profile loaded:', JSON.stringify(p));
        setProfile(p);
        setBotMode(p.mode === 'bot');
        if (p.risk_percent != null) setRiskPercent(String(p.risk_percent));
        if (p.risk_fixed_usdt != null) setRiskFixedUsdt(String(p.risk_fixed_usdt));
        if (p.max_leverage != null) setMaxLeverage(String(p.max_leverage));
      } catch (e) {
        console.log('Profile load error:', e.message);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveApiUrl = async () => {
    try {
      await setApiUrl(apiUrl);
      Alert.alert('Guardado', 'URL del servidor actualizada');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la URL');
    }
  };

  const handleRegisterPush = async () => {
    setLoading(true);
    try {
      const token = await registerForPushNotifications();
      if (token) {
        setPushToken(token);
        await registerPushToken(token);
        setIsRegistered(true);
        Alert.alert('Registrado', 'Notificaciones push activadas.');
      } else {
        Alert.alert('Error', 'No se pudo obtener el token de notificaciones');
      }
    } catch {
      Alert.alert('Error', 'Error registrando notificaciones');
    }
    setLoading(false);
  };

  const handleTestNotification = async () => {
    if (!pushToken) {
      Alert.alert('Error', 'Primero registra las notificaciones');
      return;
    }
    setLoading(true);
    try {
      await sendTestNotification(pushToken);
      Alert.alert('Enviado', 'Notificacion de prueba enviada');
    } catch {
      Alert.alert('Error', 'No se pudo enviar la notificacion');
    }
    setLoading(false);
  };

  const handleClearHistory = async () => {
    Alert.alert('Confirmar', 'Eliminar todo el historial?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await clearNotificationHistory();
          Alert.alert('Listo', 'Historial eliminado');
        },
      },
    ]);
  };

  const handleSaveBinanceKeys = async () => {
    if (!binanceKey.trim() || !binanceSecret.trim()) {
      Alert.alert('Error', 'Ingresa API Key y Secret');
      return;
    }
    try {
      const result = await updateBinanceKeys(binanceKey.trim(), binanceSecret.trim());
      Alert.alert('Guardado', result.message || 'API keys guardadas');
      setBinanceKey('');
      setBinanceSecret('');
      // Reload profile to reflect changes
      try {
        const p = await getProfile();
        console.log('Profile after save:', JSON.stringify(p));
        setProfile(p);
      } catch (e) {
        console.log('Profile reload error:', e.message);
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudieron guardar las keys');
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateAccountSettings({
        mode: botMode ? 'bot' : 'recommendations',
        risk_percent: parseFloat(riskPercent) || 2,
        risk_fixed_usdt: riskFixedUsdt ? parseFloat(riskFixedUsdt) : null,
        max_leverage: parseInt(maxLeverage) || 10,
      });
      Alert.alert('Guardado', 'Configuración actualizada');
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo guardar');
    }
  };

  const handleLogout = () => {
    Alert.alert('Cerrar Sesión', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar Sesión',
        style: 'destructive',
        onPress: async () => {
          await logout();
          // Force reload - in a real app you'd use context/navigation
          // For now the user needs to restart the app
          Alert.alert('Sesión cerrada', 'Reinicia la app para iniciar sesión de nuevo');
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#00d4aa" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Configuracion</Text>
        <Text style={styles.subtitle}>Binance Futures USDT-M</Text>
      </View>

      {/* Account */}
      {profile && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cuenta</Text>
          <Text style={styles.infoText}>{profile.email}</Text>
          <TouchableOpacity style={styles.dangerButton} onPress={handleLogout}>
            <Text style={styles.dangerButtonText}>Cerrar Sesión</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Binance API Keys */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Binance API</Text>
        {profile && profile.has_binance_keys === true ? (
          <View style={styles.keysStatus}>
            <Text style={styles.keysStatusIcon}>✅</Text>
            <Text style={styles.keysStatusText}>API Keys configuradas y encriptadas</Text>
          </View>
        ) : (
          <Text style={styles.helperText}>Conecta tu cuenta de Binance Futures</Text>
        )}
        <TextInput
          style={styles.input}
          placeholder="API Key"
          placeholderTextColor="#666"
          value={binanceKey}
          onChangeText={setBinanceKey}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="API Secret"
          placeholderTextColor="#666"
          value={binanceSecret}
          onChangeText={setBinanceSecret}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <TouchableOpacity style={styles.button} onPress={handleSaveBinanceKeys}>
          <Text style={styles.buttonText}>Guardar Keys</Text>
        </TouchableOpacity>
      </View>

      {/* Operation Mode */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Modo de Operación</Text>
        <View style={styles.modeRow}>
          <View style={styles.modeInfo}>
            <Text style={styles.modeLabel}>{botMode ? '🤖 Bot (Auto-SL)' : '📋 Recomendaciones'}</Text>
            <Text style={styles.modeHint}>
              {botMode
                ? 'El bot moverá tu SL automáticamente'
                : 'Solo muestra recomendaciones, no ejecuta'}
            </Text>
          </View>
          <Switch
            value={botMode}
            onValueChange={setBotMode}
            trackColor={{ false: '#333', true: '#00d4aa' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Risk Limits */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Límites de Riesgo</Text>

        <Text style={styles.fieldLabel}>% del balance por operación</Text>
        <TextInput
          style={styles.input}
          placeholder="2"
          placeholderTextColor="#666"
          value={riskPercent}
          onChangeText={setRiskPercent}
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Monto fijo USDT (alternativo)</Text>
        <TextInput
          style={styles.input}
          placeholder="Opcional"
          placeholderTextColor="#666"
          value={riskFixedUsdt}
          onChangeText={setRiskFixedUsdt}
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Leverage máximo</Text>
        <TextInput
          style={styles.input}
          placeholder="10"
          placeholderTextColor="#666"
          value={maxLeverage}
          onChangeText={setMaxLeverage}
          keyboardType="numeric"
        />

        <TouchableOpacity style={styles.button} onPress={handleSaveSettings}>
          <Text style={styles.buttonText}>Guardar Configuración</Text>
        </TouchableOpacity>
      </View>

      {/* Server URL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Servidor</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0, marginRight: 8 }]}
            value={apiUrl}
            onChangeText={setApiUrlState}
            placeholder="http://localhost:8000"
            placeholderTextColor="#666"
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveApiUrl}>
            <Text style={styles.saveButtonText}>Guardar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Push Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notificaciones Push</Text>
        {pushToken ? (
          <View>
            <Text style={styles.tokenText}>Token registrado</Text>
            <Text style={styles.tokenValue} numberOfLines={1}>{pushToken}</Text>
          </View>
        ) : (
          <Text style={styles.helperText}>Registra tu dispositivo para recibir señales</Text>
        )}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={handleRegisterPush} disabled={loading}>
            <Text style={styles.buttonText}>{isRegistered ? 'Actualizar Registro' : 'Registrar'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={handleTestNotification} disabled={loading}>
            <Text style={styles.buttonText}>Probar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Data Management */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Datos</Text>
        <TouchableOpacity style={styles.dangerButton} onPress={handleClearHistory}>
          <Text style={styles.dangerButtonText}>Limpiar historial</Text>
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informacion</Text>
        <Text style={styles.infoText}>Version: 1.0.0</Text>
        <Text style={styles.infoText}>Mercado: Binance Futures USDT-M</Text>
        <Text style={styles.infoText}>Estrategia: EMA200 + RSI + MACD + Vol + Fibo</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#00d4aa',
    fontSize: 14,
    marginTop: 4,
  },
  section: {
    backgroundColor: '#1e1e2e',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  fieldLabel: {
    color: '#888',
    fontSize: 13,
    marginBottom: 4,
    marginTop: 8,
  },
  helperText: {
    color: '#888',
    fontSize: 14,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: '#00d4aa',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveButtonText: {
    color: '#0f0f1a',
    fontWeight: '600',
  },
  tokenText: {
    color: '#00d4aa',
    fontSize: 14,
    marginBottom: 4,
  },
  tokenValue: {
    color: '#666',
    fontSize: 12,
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  button: {
    flex: 1,
    backgroundColor: '#00d4aa',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
  },
  buttonSecondary: {
    backgroundColor: '#333',
    marginRight: 0,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#ff4757',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  dangerButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  infoText: {
    color: '#888',
    fontSize: 14,
    marginBottom: 4,
  },
  keysStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00d4aa20',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  keysStatusIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  keysStatusText: {
    color: '#00d4aa',
    fontSize: 14,
    fontWeight: '600',
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeInfo: {
    flex: 1,
    marginRight: 12,
  },
  modeLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modeHint: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
});

export default SettingsScreen;

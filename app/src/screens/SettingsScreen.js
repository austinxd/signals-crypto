import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  getApiUrl,
  setApiUrl,
  registerPushToken,
  sendTestNotification,
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

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      const url = await getApiUrl();
      setApiUrlState(url);

      const token = await getStoredPushToken();
      setPushToken(token);
      if (token) setIsRegistered(true);
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
    } catch (err) {
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
        Alert.alert('Registrado', 'Notificaciones push activadas. Ahora agrega pares en Mercado.');
      } else {
        Alert.alert('Error', 'No se pudo obtener el token de notificaciones');
      }
    } catch (err) {
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
    } catch (err) {
      Alert.alert('Error', 'No se pudo enviar la notificacion');
    }
    setLoading(false);
  };

  const handleClearHistory = async () => {
    Alert.alert(
      'Confirmar',
      'Eliminar todo el historial de notificaciones?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await clearNotificationHistory();
            Alert.alert('Listo', 'Historial eliminado');
          },
        },
      ]
    );
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

      {/* Server URL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Servidor</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
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
            <Text style={styles.tokenValue} numberOfLines={1}>
              {pushToken}
            </Text>
          </View>
        ) : (
          <Text style={styles.helperText}>
            Registra tu dispositivo para recibir señales
          </Text>
        )}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.button}
            onPress={handleRegisterPush}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {isRegistered ? 'Actualizar Registro' : 'Registrar'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={handleTestNotification}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Probar</Text>
          </TouchableOpacity>
        </View>
        {isRegistered && (
          <Text style={styles.hintText}>
            Configura tus pares y notificaciones en la pestaña Mercado
          </Text>
        )}
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
        <Text style={styles.infoTextHint}>
          Los pares, temporalidades y tipo de notificaciones se configuran individualmente en Mercado.
        </Text>
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
  helperText: {
    color: '#888',
    fontSize: 14,
    marginBottom: 12,
  },
  hintText: {
    color: '#00d4aa',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    marginRight: 8,
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
  infoTextHint: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
});

export default SettingsScreen;

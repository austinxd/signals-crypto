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
  getUserPairs,
  setUserPairs,
  getUserTimeframe,
  setUserTimeframe,
  registerPushToken,
  updatePreferences,
  sendTestNotification,
  getConfig,
} from '../services/api';
import {
  registerForPushNotifications,
  getStoredPushToken,
  clearNotificationHistory,
} from '../services/notifications';

const SettingsScreen = () => {
  const [apiUrl, setApiUrlState] = useState('');
  const [pushToken, setPushToken] = useState(null);
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState('4h');
  const [availablePairs, setAvailablePairs] = useState([]);
  const [availableTimeframes, setAvailableTimeframes] = useState([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      // Load local settings
      const url = await getApiUrl();
      setApiUrlState(url);

      const token = await getStoredPushToken();
      setPushToken(token);
      if (token) setIsRegistered(true);

      const pairs = await getUserPairs();
      setSelectedPairs(pairs);

      const timeframe = await getUserTimeframe();
      setSelectedTimeframe(timeframe);

      // Fetch available options from server
      try {
        const config = await getConfig();
        setAvailablePairs(config.available_pairs || []);
        setAvailableTimeframes(config.available_timeframes || ['15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
      } catch (err) {
        // Use defaults if server not available
        setAvailablePairs([
          'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
          'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
        ]);
        setAvailableTimeframes(['15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
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
      loadSettings(); // Reload config from new server
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
        await registerPushToken(token, selectedPairs, selectedTimeframe);
        setIsRegistered(true);
        Alert.alert('Registrado', 'Notificaciones push activadas');
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

  const togglePair = async (pair) => {
    let newPairs;
    if (selectedPairs.includes(pair)) {
      newPairs = selectedPairs.filter((p) => p !== pair);
    } else {
      newPairs = [...selectedPairs, pair];
    }

    if (newPairs.length === 0) {
      Alert.alert('Error', 'Debes seleccionar al menos un par');
      return;
    }

    setSelectedPairs(newPairs);
    await setUserPairs(newPairs);

    if (pushToken && isRegistered) {
      try {
        await updatePreferences(pushToken, newPairs, selectedTimeframe);
      } catch (err) {
        console.error('Error updating preferences:', err);
      }
    }
  };

  const selectTimeframe = async (tf) => {
    setSelectedTimeframe(tf);
    await setUserTimeframe(tf);

    if (pushToken && isRegistered) {
      try {
        await updatePreferences(pushToken, selectedPairs, tf);
      } catch (err) {
        console.error('Error updating timeframe:', err);
      }
    }
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
      </View>

      {/* Timeframe Selection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Temporalidad</Text>
        <Text style={styles.helperText}>
          Selecciona el timeframe para las señales
        </Text>
        <View style={styles.timeframeGrid}>
          {availableTimeframes.map((tf) => (
            <TouchableOpacity
              key={tf}
              style={[
                styles.timeframeChip,
                selectedTimeframe === tf && styles.timeframeChipActive,
              ]}
              onPress={() => selectTimeframe(tf)}
            >
              <Text
                style={[
                  styles.timeframeChipText,
                  selectedTimeframe === tf && styles.timeframeChipTextActive,
                ]}
              >
                {tf}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Trading Pairs */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pares de Trading</Text>
        <Text style={styles.helperText}>
          Selecciona los pares para recibir señales ({selectedPairs.length} seleccionados)
        </Text>
        <View style={styles.pairsGrid}>
          {availablePairs.map((pair) => (
            <TouchableOpacity
              key={pair}
              style={[
                styles.pairChip,
                selectedPairs.includes(pair) && styles.pairChipActive,
              ]}
              onPress={() => togglePair(pair)}
            >
              <Text
                style={[
                  styles.pairChipText,
                  selectedPairs.includes(pair) && styles.pairChipTextActive,
                ]}
              >
                {pair.replace('/USDT', '')}
              </Text>
            </TouchableOpacity>
          ))}
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
        <Text style={styles.infoText}>Timeframe: {selectedTimeframe}</Text>
        <Text style={styles.infoText}>Estrategia: EMA200 + RSI + MACD + Vol</Text>
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
  buttonDisabled: {
    backgroundColor: '#333',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  timeframeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  timeframeChip: {
    backgroundColor: '#0f0f1a',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  timeframeChipActive: {
    backgroundColor: '#00d4aa',
    borderColor: '#00d4aa',
  },
  timeframeChipText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 16,
  },
  timeframeChipTextActive: {
    color: '#0f0f1a',
  },
  pairsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  pairChip: {
    backgroundColor: '#0f0f1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  pairChipActive: {
    backgroundColor: '#00d4aa',
    borderColor: '#00d4aa',
  },
  pairChipText: {
    color: '#888',
    fontWeight: '600',
  },
  pairChipTextActive: {
    color: '#0f0f1a',
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
});

export default SettingsScreen;

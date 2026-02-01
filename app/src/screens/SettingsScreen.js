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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  registerPushToken,
  sendTestNotification,
  getProfile,
  updateBinanceKeys,
  verifyBinanceKeys,
  deleteBinanceKeys,
  updateAccountSettings,
  logout,
} from '../services/api';
import {
  registerForPushNotifications,
  getStoredPushToken,
  clearNotificationHistory,
} from '../services/notifications';
import { useSubscription } from '../context/SubscriptionContext';

const SettingsScreen = ({ onLogout }) => {
  const navigation = useNavigation();
  const { isPremium, status, aiUsage, aiLimit, aiRemaining } = useSubscription();

  const [pushToken, setPushToken] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);

  // Account
  const [profile, setProfile] = useState(null);

  // Binance keys
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');

  // Reference parameters
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

      const token = await getStoredPushToken();
      setPushToken(token);
      if (token) setIsRegistered(true);

      // Load profile
      try {
        const p = await getProfile();
        setProfile(p);
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

  const handleRegisterPush = async () => {
    setLoading(true);
    try {
      const token = await registerForPushNotifications();
      if (token) {
        setPushToken(token);
        await registerPushToken(token);
        setIsRegistered(true);
        Alert.alert('Registrado', 'Notificaciones activadas.');
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
    Alert.alert('Confirmar', 'Eliminar todo el historial local?', [
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
        setProfile(p);
      } catch (e) {
        console.log('Profile reload error:', e.message);
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudieron guardar las keys');
    }
  };

  const handleSaveReferenceParams = async () => {
    try {
      await updateAccountSettings({
        mode: 'recommendations', // Always recommendations mode
        risk_percent: parseFloat(riskPercent) || 2,
        risk_fixed_usdt: riskFixedUsdt ? parseFloat(riskFixedUsdt) : null,
        max_leverage: parseInt(maxLeverage) || 10,
      });
      Alert.alert('Guardado', 'Parametros de referencia actualizados');
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo guardar');
    }
  };

  const handleLogout = () => {
    Alert.alert('Cerrar Sesion', 'Estas seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar Sesion',
        style: 'destructive',
        onPress: async () => {
          await logout();
          if (onLogout) {
            onLogout();
          }
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
        <Text style={styles.subtitle}>Herramienta de analisis</Text>
      </View>

      {/* Account */}
      {profile && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cuenta</Text>
          <Text style={styles.infoText}>{profile.email}</Text>
          <TouchableOpacity style={styles.dangerButton} onPress={handleLogout}>
            <Text style={styles.dangerButtonText}>Cerrar Sesion</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Plan */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Plan</Text>
        <View style={styles.planRow}>
          <Text style={styles.planLabel}>Plan actual:</Text>
          <Text style={[styles.planValue, isPremium && styles.planValuePremium]}>
            {isPremium ? 'Premium mensual' : 'Free'}
          </Text>
        </View>
        <View style={styles.planRow}>
          <Text style={styles.planLabel}>Consultas IA:</Text>
          <Text style={styles.planValue}>
            {aiUsage} / {aiLimit} ({aiRemaining} restantes)
          </Text>
        </View>
        {!isPremium && (
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={() => navigation.navigate('Upgrade')}
          >
            <Text style={styles.upgradeButtonText}>Desbloquear Premium</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Assistance Mode */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Modo de Asistencia</Text>
        <View style={styles.modeCard}>
          <View style={styles.modeIconContainer}>
            <Text style={styles.modeIcon}>📘</Text>
          </View>
          <View style={styles.modeContent}>
            <Text style={styles.modeLabel}>Analisis y alertas</Text>
            <Text style={styles.modeDescription}>
              La app analiza el mercado y notifica cambios de estado.
            </Text>
          </View>
          <View style={styles.activeIndicator}>
            <Text style={styles.activeIndicatorText}>Activo</Text>
          </View>
        </View>
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            La app no ejecuta operaciones automaticamente.{'\n'}
            Este modo solo analiza y envia alertas.
          </Text>
        </View>
      </View>

      {/* Binance Connection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Conexion Binance</Text>
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Las API se usan unicamente para lectura y analisis.{'\n'}
            Esta app no ejecuta ordenes automaticamente.
          </Text>
        </View>
        {profile && profile.has_binance_keys === true ? (
          <>
            <View style={styles.keysStatus}>
              <Text style={styles.keysStatusIcon}>✓</Text>
              <View style={styles.keysStatusContent}>
                <Text style={styles.keysStatusText}>Conexion activa (solo lectura)</Text>
                {profile.api_key_hint ? (
                  <Text style={styles.keysHint}>Key: ****{profile.api_key_hint}</Text>
                ) : null}
              </View>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.button}
                onPress={async () => {
                  try {
                    const result = await verifyBinanceKeys();
                    Alert.alert(
                      result.status === 'ok' ? 'Conexion OK' : 'Error',
                      result.message
                    );
                  } catch (err) {
                    Alert.alert('Error', err.message);
                  }
                }}
              >
                <Text style={styles.buttonText}>Verificar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonDanger]}
                onPress={() => {
                  Alert.alert('Eliminar Keys', 'Seguro que quieres eliminar la conexion?', [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Eliminar',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await deleteBinanceKeys();
                          const p = await getProfile();
                          setProfile(p);
                          Alert.alert('Listo', 'Conexion eliminada');
                        } catch (err) {
                          Alert.alert('Error', err.message);
                        }
                      },
                    },
                  ]);
                }}
              >
                <Text style={styles.buttonText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Reemplazar conexion:</Text>
          </>
        ) : (
          <Text style={styles.helperText}>Conecta tu cuenta para ver posiciones y precios</Text>
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
          <Text style={styles.buttonText}>Guardar Conexion</Text>
        </TouchableOpacity>
        <Text style={styles.permissionNote}>
          Permisos requeridos: Lectura de cuenta y posiciones.{'\n'}
          No se requieren permisos de trading.
        </Text>
      </View>

      {/* Reference Parameters */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Parametros de referencia de riesgo</Text>
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Estos valores se usan solo como referencia analitica y para alertas.{'\n'}
            No abren, cierran ni modifican operaciones.
          </Text>
        </View>

        <Text style={styles.fieldLabel}>% del balance por operacion (referencia)</Text>
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

        <Text style={styles.fieldLabel}>Leverage maximo de referencia</Text>
        <TextInput
          style={styles.input}
          placeholder="10"
          placeholderTextColor="#666"
          value={maxLeverage}
          onChangeText={setMaxLeverage}
          keyboardType="numeric"
        />

        <TouchableOpacity style={styles.button} onPress={handleSaveReferenceParams}>
          <Text style={styles.buttonText}>Guardar Parametros</Text>
        </TouchableOpacity>
      </View>

      {/* Alerts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alertas</Text>
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Las alertas informan cambios de estado, no instrucciones de trading.
          </Text>
        </View>

        <View style={styles.alertItem}>
          <View style={styles.alertInfo}>
            <Text style={styles.alertLabel}>Cambio de escenario (Mercado)</Text>
            <Text style={styles.alertHint}>Favorable, Operable, Alto Riesgo, Espera</Text>
          </View>
          <View style={styles.alertStatus}>
            <Text style={styles.alertStatusText}>Activo</Text>
          </View>
        </View>

        <View style={styles.alertItem}>
          <View style={styles.alertInfo}>
            <Text style={styles.alertLabel}>Cambio de coherencia (Posiciones)</Text>
            <Text style={styles.alertHint}>A favor, Contra contexto, Neutral</Text>
          </View>
          <View style={styles.alertStatus}>
            <Text style={styles.alertStatusText}>Activo</Text>
          </View>
        </View>

        <View style={styles.alertItem}>
          <View style={styles.alertInfo}>
            <Text style={styles.alertLabel}>Invalidacion estructural</Text>
            <Text style={styles.alertHint}>Cuando la tesis de un trade se invalida</Text>
          </View>
          <View style={styles.alertStatus}>
            <Text style={styles.alertStatusText}>Activo</Text>
          </View>
        </View>

        <View style={styles.alertItem}>
          <View style={styles.alertInfo}>
            <Text style={styles.alertLabel}>Exposicion de riesgo</Text>
            <Text style={styles.alertHint}>Multiples posiciones contra contexto</Text>
          </View>
          <View style={styles.alertStatus}>
            <Text style={styles.alertStatusText}>Activo</Text>
          </View>
        </View>

        {/* Push Notifications */}
        <View style={styles.pushSection}>
          <Text style={styles.fieldLabel}>Notificaciones Push</Text>
          {pushToken ? (
            <Text style={styles.tokenRegistered}>Dispositivo registrado</Text>
          ) : (
            <Text style={styles.helperText}>Registra tu dispositivo para recibir alertas</Text>
          )}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={handleRegisterPush} disabled={loading}>
              <Text style={styles.buttonText}>{isRegistered ? 'Actualizar' : 'Registrar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={handleTestNotification} disabled={loading}>
              <Text style={styles.buttonText}>Probar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Data */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Datos</Text>
        <TouchableOpacity style={styles.dangerButton} onPress={handleClearHistory}>
          <Text style={styles.dangerButtonText}>Limpiar historial local</Text>
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informacion</Text>
        <Text style={styles.infoText}>Version: 1.0.0</Text>
        <Text style={styles.infoText}>Mercado: Binance Futures USDT-M</Text>
        <View style={styles.principleBox}>
          <Text style={styles.principleTitle}>Principio de la app</Text>
          <Text style={styles.principleText}>
            Settings define el marco.{'\n'}
            Mercado describe el terreno.{'\n'}
            Posiciones evalua la tesis.{'\n'}
            El usuario decide.
          </Text>
        </View>
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
    color: '#888',
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
  buttonDanger: {
    backgroundColor: '#ff4757',
    marginRight: 0,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#ff475730',
    borderWidth: 1,
    borderColor: '#ff4757',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  dangerButtonText: {
    color: '#ff4757',
    fontWeight: '600',
  },
  infoText: {
    color: '#888',
    fontSize: 14,
    marginBottom: 4,
  },

  // Plan section
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  planLabel: {
    color: '#888',
    fontSize: 14,
  },
  planValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  planValuePremium: {
    color: '#00d4aa',
  },
  upgradeButton: {
    backgroundColor: '#00d4aa',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  upgradeButtonText: {
    color: '#0a0a14',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Disclaimer box
  disclaimer: {
    backgroundColor: '#1a1a30',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#ffd93d',
  },
  disclaimerText: {
    color: '#aaa',
    fontSize: 12,
    lineHeight: 18,
  },

  // Mode card
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00d4aa15',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#00d4aa40',
  },
  modeIconContainer: {
    marginRight: 12,
  },
  modeIcon: {
    fontSize: 28,
  },
  modeContent: {
    flex: 1,
  },
  modeLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modeDescription: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  activeIndicator: {
    backgroundColor: '#00d4aa',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeIndicatorText: {
    color: '#0f0f1a',
    fontSize: 11,
    fontWeight: '700',
  },

  // Keys status
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
    color: '#00d4aa',
    marginRight: 10,
    fontWeight: 'bold',
  },
  keysStatusContent: {
    flex: 1,
  },
  keysStatusText: {
    color: '#00d4aa',
    fontSize: 14,
    fontWeight: '600',
  },
  keysHint: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  permissionNote: {
    color: '#666',
    fontSize: 11,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Alerts
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  alertInfo: {
    flex: 1,
  },
  alertLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  alertHint: {
    color: '#666',
    fontSize: 11,
    marginTop: 2,
  },
  alertStatus: {
    backgroundColor: '#00d4aa20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  alertStatusText: {
    color: '#00d4aa',
    fontSize: 11,
    fontWeight: '600',
  },
  pushSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  tokenRegistered: {
    color: '#00d4aa',
    fontSize: 13,
    marginBottom: 8,
  },

  // Principle box
  principleBox: {
    backgroundColor: '#1a1a30',
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
  },
  principleTitle: {
    color: '#888',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  principleText: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
  },
});

export default SettingsScreen;

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
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
import {
  Screen, Card, SectionTitle, Chip, Button, Row, Notice, Collapsible, Loading,
} from '../components/ui';
import { colors, space, radius, type, GLOSSARY } from '../theme';

// What the app warns about. These are always on; the list is here so people know what to expect.
const ALERT_KINDS = [
  { label: 'Cambio de escenario', help: 'Un par pasa a buen momento, operable, riesgo alto o espera.' },
  { label: 'Posición contra el mercado', help: 'Una posición tuya deja de ir a favor de la tendencia.' },
  { label: 'Idea invalidada', help: 'El motivo por el que se abrió una operación ya no se cumple.' },
  { label: 'Demasiado riesgo', help: 'Tienes varias posiciones en contra del mercado a la vez.' },
];

/** Result of the last action in a section, shown right under its buttons. */
const Feedback = ({ value }) =>
  value ? (
    <Notice tone={value.ok ? 'good' : 'danger'} style={{ marginTop: space.md, marginBottom: 0 }}>
      {value.text}
    </Notice>
  ) : null;

const Field = ({ label, help, ...input }) => (
  <View style={{ marginBottom: space.md }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput style={styles.input} placeholderTextColor={colors.textMuted} {...input} />
    {!!help && <Text style={[type.small, { marginTop: 4 }]}>{help}</Text>}
  </View>
);

const SettingsScreen = ({ onLogout }) => {
  const navigation = useNavigation();
  const { isPremium, aiUsage, aiLimit, aiRemaining } = useSubscription();

  const [pushToken, setPushToken] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [busy, setBusy] = useState(null); // which action is running
  const [feedback, setFeedback] = useState({}); // section -> { ok, text }

  // Account
  const [profile, setProfile] = useState(null);

  // Binance keys
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');

  // Reference parameters
  const [riskPercent, setRiskPercent] = useState('2');
  const [riskFixedUsdt, setRiskFixedUsdt] = useState('');
  const [maxLeverage, setMaxLeverage] = useState('10');

  const say = (section, ok, text) => setFeedback((f) => ({ ...f, [section]: { ok, text } }));

  // Reload settings every time the screen is focused
  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  const loadSettings = async () => {
    try {
      if (!loadedOnce.current) setLoading(true);

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
      loadedOnce.current = true;
      setLoading(false);
    }
  };

  const handleRegisterPush = async () => {
    setBusy('push');
    try {
      const token = await registerForPushNotifications();
      if (token) {
        setPushToken(token);
        await registerPushToken(token);
        setIsRegistered(true);
        say('push', true, 'Notificaciones activadas en este dispositivo.');
      } else {
        say('push', false, 'No se pudieron activar. Revisa que la app tenga permiso de notificaciones en los ajustes del teléfono.');
      }
    } catch {
      say('push', false, 'No se pudieron activar las notificaciones. Inténtalo de nuevo.');
    }
    setBusy(null);
  };

  const handleTestNotification = async () => {
    if (!pushToken) {
      say('push', false, 'Primero activa las notificaciones.');
      return;
    }
    setBusy('test');
    try {
      await sendTestNotification(pushToken);
      say('push', true, 'Notificación de prueba enviada. Debería llegarte en unos segundos.');
    } catch {
      say('push', false, 'No se pudo enviar la notificación de prueba.');
    }
    setBusy(null);
  };

  const handleClearHistory = () => {
    Alert.alert('Borrar historial', 'Se borrará el historial de notificaciones guardado en este teléfono.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearNotificationHistory();
            say('advanced', true, 'Historial borrado.');
          } catch {
            say('advanced', false, 'No se pudo borrar el historial.');
          }
        },
      },
    ]);
  };

  const handleSaveBinanceKeys = async () => {
    if (!binanceKey.trim() || !binanceSecret.trim()) {
      say('binance', false, 'Escribe la API Key y el API Secret.');
      return;
    }
    setBusy('saveKeys');
    try {
      const result = await updateBinanceKeys(binanceKey.trim(), binanceSecret.trim());
      say('binance', true, (result && result.message) || 'Conexión guardada.');
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
      say('binance', false, (err && err.message) || 'No se pudo guardar la conexión.');
    }
    setBusy(null);
  };

  const handleVerifyBinance = async () => {
    setBusy('verify');
    try {
      const result = await verifyBinanceKeys();
      const ok = result && result.status === 'ok';
      say('binance', ok, (result && result.message) || (ok ? 'La conexión funciona.' : 'La conexión no funciona.'));
    } catch (err) {
      say('binance', false, (err && err.message) || 'No se pudo verificar la conexión.');
    }
    setBusy(null);
  };

  const handleDeleteBinance = () => {
    Alert.alert('Desconectar Binance', 'Se borrarán tus claves del servidor y dejarás de ver tus posiciones.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await deleteBinanceKeys();
            const p = await getProfile();
            setProfile(p);
            say('binance', true, 'Binance desconectado.');
          } catch (err) {
            say('binance', false, (err && err.message) || 'No se pudo desconectar.');
          }
          setBusy(null);
        },
      },
    ]);
  };

  const handleSaveReferenceParams = async () => {
    setBusy('risk');
    try {
      await updateAccountSettings({
        mode: 'recommendations', // Always recommendations mode
        risk_percent: parseFloat(riskPercent) || 2,
        risk_fixed_usdt: riskFixedUsdt ? parseFloat(riskFixedUsdt) : null,
        max_leverage: parseInt(maxLeverage) || 10,
      });
      say('risk', true, 'Preferencias guardadas.');
    } catch (err) {
      say('risk', false, (err && err.message) || 'No se pudieron guardar.');
    }
    setBusy(null);
  };

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Seguro que quieres salir de tu cuenta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
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
      <Screen title="Ajustes" scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const connected = !!profile && profile.has_binance_keys === true;
  const version = (Constants.expoConfig && Constants.expoConfig.version) || '';

  return (
    <Screen title="Ajustes">
      <SectionTitle>Tu cuenta</SectionTitle>
      <Card>
        <Row first label="Correo" value={(profile && profile.email) || '-'} />
        <Row label="Plan">
          <Chip label={isPremium ? 'Premium' : 'Gratis'} color={isPremium ? colors.accent : colors.textDim} solid={isPremium} />
        </Row>
        <Row
          label="Consultas a la IA este mes"
          value={`${aiUsage ?? 0} de ${aiLimit ?? 0}`}
          help={`Te quedan ${aiRemaining ?? 0}. Se gastan al pedir una explicación de un par o de una posición.`}
        />
        {!isPremium && (
          <Button label="Pasar a Premium" onPress={() => navigation.navigate('Upgrade')} style={{ marginTop: space.md }} />
        )}
      </Card>

      <SectionTitle>Notificaciones</SectionTitle>
      <Card
        title="Avisos en este teléfono"
        right={<Chip label={pushToken ? 'Activadas' : 'Desactivadas'} color={pushToken ? colors.accent : colors.warn} />}
      >
        <Text style={type.bodyDim}>
          {pushToken
            ? 'Te avisamos cuando cambia algo importante. Son avisos informativos, no órdenes de compra o venta.'
            : 'Actívalas para enterarte cuando cambie algo importante en el mercado o en tus posiciones.'}
        </Text>
        <View style={styles.buttons}>
          <Button
            label={isRegistered ? 'Volver a activar' : 'Activar'}
            kind={isRegistered ? 'secondary' : 'primary'}
            onPress={handleRegisterPush}
            loading={busy === 'push'}
            disabled={!!busy}
            style={{ flex: 1 }}
          />
          <Button
            label="Enviar prueba"
            kind="secondary"
            onPress={handleTestNotification}
            loading={busy === 'test'}
            disabled={!!busy}
            style={{ flex: 1 }}
          />
        </View>
        <Feedback value={feedback.push} />
      </Card>
      <Collapsible title="Qué te avisamos" hint="Los cuatro tipos de aviso, siempre activos">
        {ALERT_KINDS.map((a, i) => (
          <Row key={a.label} first={i === 0} label={a.label} help={a.help}>
            <Chip label="Activo" color={colors.accent} />
          </Row>
        ))}
      </Collapsible>

      <SectionTitle>Conexión con Binance</SectionTitle>
      <Card
        title="Tu cuenta de Binance"
        right={<Chip label={connected ? 'Conectado' : 'Sin conectar'} color={connected ? colors.accent : colors.textDim} />}
      >
        <Text style={type.bodyDim}>
          Sirve para mostrar tus posiciones y analizarlas. Las claves se usan solo para leer: la app no abre ni
          cierra operaciones con ellas.
        </Text>
        {connected && (
          <>
            {!!profile.api_key_hint && (
              <Text style={[type.small, { marginTop: space.sm }]}>Clave guardada: ****{profile.api_key_hint}</Text>
            )}
            <View style={styles.buttons}>
              <Button
                label="Comprobar"
                kind="secondary"
                onPress={handleVerifyBinance}
                loading={busy === 'verify'}
                disabled={!!busy}
                style={{ flex: 1 }}
              />
              <Button
                label="Desconectar"
                kind="danger"
                onPress={handleDeleteBinance}
                loading={busy === 'delete'}
                disabled={!!busy}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}

        <Text style={[type.label, { marginTop: space.lg, marginBottom: space.md }]}>
          {connected ? 'Cambiar las claves' : 'Conectar'}
        </Text>
        <Field
          label="API Key"
          placeholder="Pega aquí tu API Key"
          value={binanceKey}
          onChangeText={setBinanceKey}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="API Secret"
          placeholder="Pega aquí tu API Secret"
          value={binanceSecret}
          onChangeText={setBinanceSecret}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          help="En Binance, crea la clave solo con permiso de lectura. No actives trading ni retiros."
        />
        <Button
          label={connected ? 'Guardar claves nuevas' : 'Conectar Binance'}
          onPress={handleSaveBinanceKeys}
          loading={busy === 'saveKeys'}
          disabled={!!busy}
        />
        <Feedback value={feedback.binance} />
      </Card>

      <SectionTitle>Preferencias</SectionTitle>
      <Card title="Tu riesgo de referencia">
        <Text style={[type.bodyDim, { marginBottom: space.lg }]}>
          Con estos números la app calcula si una posición es grande para ti y cuándo avisarte. No abren, cierran
          ni modifican operaciones.
        </Text>
        <Field
          label="Riesgo por operación (% del saldo)"
          placeholder="2"
          value={riskPercent}
          onChangeText={setRiskPercent}
          keyboardType="numeric"
          help="Cuánto de tu saldo aceptas perder en una sola operación. Lo habitual es entre 1 y 2."
        />
        <Field
          label="O una cantidad fija en USDT (opcional)"
          placeholder="Vacío = usar el porcentaje"
          value={riskFixedUsdt}
          onChangeText={setRiskFixedUsdt}
          keyboardType="numeric"
          help="Si la rellenas, se usa en lugar del porcentaje."
        />
        <Field
          label="Apalancamiento máximo"
          placeholder="10"
          value={maxLeverage}
          onChangeText={setMaxLeverage}
          keyboardType="numeric"
          help={GLOSSARY.leverage}
        />
        <Button label="Guardar preferencias" onPress={handleSaveReferenceParams} loading={busy === 'risk'} disabled={!!busy} />
        <Feedback value={feedback.risk} />
      </Card>

      <Collapsible title="Avanzado" hint="Datos guardados e información de la app">
        <Row first label="Versión" value={version || '-'} />
        <Row label="Mercado" value="Binance Futures USDT-M" />
        <Row
          label="Cómo funciona"
          help="La app analiza el mercado y te avisa de los cambios. No ejecuta operaciones con tu cuenta: tú decides."
        >
          <View />
        </Row>
        <Button label="Borrar historial de notificaciones" kind="secondary" onPress={handleClearHistory} style={{ marginTop: space.md }} />
        <Feedback value={feedback.advanced} />
      </Collapsible>

      <Button label="Cerrar sesión" kind="secondary" onPress={handleLogout} style={{ marginTop: space.md }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  fieldLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: space.md,
  },
});

export default SettingsScreen;

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, Linking } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import {
  registerPushToken,
  sendTestNotification,
  getProfile,
  updateBinanceKeys,
  verifyBinanceKeys,
  deleteBinanceKeys,
  logout,
} from '../services/api';
import {
  registerForPushNotifications,
  getStoredPushToken,
  getPushPermission,
} from '../services/notifications';
import { useSubscription } from '../context/SubscriptionContext';
import {
  Screen, Card, SectionTitle, Chip, Button, Row, Notice, Collapsible, Loading,
} from '../components/ui';
import { colors, space, radius, type } from '../theme';
import { friendlyError, binanceOkText } from '../errors';

// What the app warns about. These are always on; the list is here so people know what to expect.
const ALERT_KINDS = [
  { label: 'Cambia la valoración de una moneda', help: 'Pasa a ser buen momento para abrir long o short, o deja de serlo.' },
  { label: 'El precio llega a un nivel importante', help: 'Un precio donde otras veces se frenó o rebotó.' },
  { label: 'Tu operación real ya no va a favor', help: 'La tendencia del mercado deja de acompañar a una operación tuya en Binance.' },
  { label: 'El motivo de tu operación ya no vale', help: 'El precio rompió el nivel que la sostenía.' },
  { label: 'Varias operaciones en riesgo a la vez', help: 'Tienes más de una operación en contra del mercado.' },
  { label: 'Lo que hace el bot', help: 'Solo si administras el bot: cuándo abre o cierra una operación (hoy, simulada).' },
];

const BINANCE_STEPS = [
  'En Binance: Perfil > Gestión de API > Crear API.',
  'Para solo ver tus operaciones: deja marcado solo “Habilitar lectura”.',
  'Si además quieres que el bot opere en tu cuenta: marca también “Habilitar Futuros”. Nunca marques retiros.',
  'Copia la API Key y la Secret Key y pégalas aquí.',
];

/** Result of the last action in a section, shown right under its buttons. */
const Feedback = ({ value }) =>
  value ? (
    <Notice tone={value.ok ? 'good' : 'danger'} style={{ marginTop: space.md, marginBottom: 0 }}>
      {value.text}
    </Notice>
  ) : null;

/** A fact with its explanation underneath (no value on the right). */
const Info = ({ title, text, first = false }) => (
  <View style={[styles.info, first && { borderTopWidth: 0 }]}>
    <Text style={[type.body, { fontWeight: '600' }]}>{title}</Text>
    <Text style={[type.small, { marginTop: 2 }]}>{text}</Text>
  </View>
);

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
  const [permission, setPermission] = useState('undetermined'); // what the phone itself says
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [busy, setBusy] = useState(null); // which action is running
  const [feedback, setFeedback] = useState({}); // section -> { ok, text }

  // Account
  const [profile, setProfile] = useState(null);

  // Binance keys
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');

  const [binanceOk, setBinanceOk] = useState(null); // result of the last check: null = not checked
  const [changingKeys, setChangingKeys] = useState(false);
  // Over-the-air update check (hooks must stay above the early return below)
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

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

      setPermission(await getPushPermission());
      setPushToken(await getStoredPushToken());

      // Load profile
      try {
        const p = await getProfile();
        setProfile(p);
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
        say('push', true, 'Avisos activados en este teléfono.');
      } else {
        say('push', false, 'No se pudieron activar. Revisa que la app tenga permiso de notificaciones en los ajustes del teléfono.');
      }
    } catch (err) {
      say('push', false, friendlyError(err, 'push'));
    }
    setPermission(await getPushPermission());
    setBusy(null);
  };

  const handleTestNotification = async () => {
    if (!pushToken) {
      say('push', false, 'Primero activa los avisos.');
      return;
    }
    setBusy('test');
    try {
      await sendTestNotification(pushToken);
      say('push', true, 'Aviso de prueba enviado. Debería llegarte en unos segundos.');
    } catch (err) {
      say('push', false, friendlyError(err, 'push'));
    }
    setBusy(null);
  };

  const handleSaveBinanceKeys = async () => {
    if (!binanceKey.trim() || !binanceSecret.trim()) {
      say('binance', false, 'Escribe la API Key y el API Secret.');
      return;
    }
    setBusy('saveKeys');
    try {
      const result = await updateBinanceKeys(binanceKey.trim(), binanceSecret.trim());
      const ok = !!result && result.status === 'ok';
      setBinanceOk(ok);
      // The server saves the keys even when Binance refuses them: that is not a success
      say('binance', ok, ok
        ? 'Conexión correcta. Tus futuros abiertos están en la pestaña Mi Binance.'
        : 'Las claves se guardaron pero Binance las rechaza. Revisa que estén bien copiadas y que tengan permiso de lectura de Futuros.');
      setBinanceKey('');
      setBinanceSecret('');
      setChangingKeys(false);
      // Reload profile to reflect changes
      try {
        const p = await getProfile();
        setProfile(p);
      } catch (e) {
        console.log('Profile reload error:', e.message);
      }
    } catch (err) {
      say('binance', false, friendlyError(err, 'binance'));
    }
    setBusy(null);
  };

  const handleVerifyBinance = async () => {
    setBusy('verify');
    try {
      const result = await verifyBinanceKeys();
      const ok = !!result && result.status === 'ok';
      setBinanceOk(ok);
      say('binance', ok, ok ? binanceOkText(result.message) : friendlyError(null, 'binance'));
    } catch (err) {
      say('binance', false, friendlyError(err, 'binance'));
    }
    setBusy(null);
  };

  const handleDeleteBinance = () => {
    Alert.alert('Desconectar Binance', 'Se borrarán tus claves del servidor y dejarás de ver tus operaciones de Binance. No se cierra nada en Binance.', [
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
            setBinanceOk(null);
            say('binance', true, 'Binance desconectado.');
          } catch (err) {
            say('binance', false, friendlyError(err));
          }
          setBusy(null);
        },
      },
    ]);
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
  const pushOn = permission === 'granted' && !!pushToken;
  const pushBlocked = permission === 'denied';
  const pushChip = pushOn
    ? { label: 'Activados', color: colors.accent }
    : pushBlocked
      ? { label: 'Bloqueados', color: colors.danger }
      : { label: 'Desactivados', color: colors.warn };
  const binanceChip = !connected
    ? { label: 'Sin conectar', color: colors.textDim }
    : binanceOk === false
      ? { label: 'Claves rechazadas', color: colors.danger }
      : { label: 'Conectado', color: colors.accent };
  const keyHint = String((profile && profile.api_key_hint) || '').replace(/^[.*…\s]+/, '');
  const version = (Constants.expoConfig && Constants.expoConfig.version) || '';
  // Over-the-air updates: say which one is running and let the reader fetch the newest without reopening twice.
  let updateLabel = 'Esta versión no recibe actualizaciones automáticas: instala la última desde TestFlight.';
  try {
    if (Updates.isEnabled) {
      const made = Updates.createdAt ? new Date(Updates.createdAt) : null;
      updateLabel = made && !Updates.isEmbeddedLaunch
        ? `Actualización del ${made.toLocaleDateString('es-ES')} a las ${made.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
        : 'Sin actualizaciones aplicadas todavía.';
    }
  } catch (e) { /* keep the default label */ }
  const checkUpdate = async () => {
    setUpdating(true);
    setUpdateMsg('');
    try {
      if (!Updates.isEnabled) {
        setUpdateMsg('Esta versión no admite actualizaciones automáticas. Instala la última desde TestFlight.');
        return;
      }
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) {
        setUpdateMsg('Ya tienes la última versión.');
        return;
      }
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e) {
      setUpdateMsg('No se pudo buscar la actualización. Comprueba tu conexión e inténtalo de nuevo.');
    } finally {
      setUpdating(false);
    }
  };

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
          help={`Te quedan ${aiRemaining ?? 0}. Se gastan al pedir una explicación de una moneda o de una operación.`}
        />
        {!isPremium && (
          <Button label="Pasar a Premium" onPress={() => navigation.navigate('Upgrade')} style={{ marginTop: space.md }} />
        )}
      </Card>

      <SectionTitle>Avisos</SectionTitle>
      <Card title="Avisos en este teléfono" right={<Chip label={pushChip.label} color={pushChip.color} />}>
        {!pushOn && (
          <Text style={type.bodyDim}>
            {pushBlocked
              ? 'El teléfono tiene bloqueadas las notificaciones de Criterio. Actívalas en los ajustes del teléfono y vuelve aquí.'
              : 'Actívalos para enterarte cuando cambie algo en una moneda que sigues o en tus operaciones. Sin esto no llega ningún aviso.'}
          </Text>
        )}
        <View style={[styles.buttons, pushOn && { marginTop: 0 }]}>
          {pushBlocked ? (
            <Button label="Abrir ajustes del teléfono" onPress={() => Linking.openSettings()} style={{ flex: 1 }} />
          ) : !pushOn ? (
            <Button label="Activar avisos" onPress={handleRegisterPush} loading={busy === 'push'} disabled={!!busy} style={{ flex: 1 }} />
          ) : (
            <>
              <Button
                label="Enviar prueba"
                kind="secondary"
                onPress={handleTestNotification}
                loading={busy === 'test'}
                disabled={!!busy}
                style={{ flex: 1 }}
              />
              <Button label="Ajustes del teléfono" kind="secondary" onPress={() => Linking.openSettings()} style={{ flex: 1 }} />
            </>
          )}
        </View>
        <Feedback value={feedback.push} />
      </Card>
      <Collapsible title="Qué te avisamos" hint="Los tipos de aviso; llegan todos">
        {ALERT_KINDS.map((a, i) => (
          <Info key={a.label} first={i === 0} title={a.label} text={a.help} />
        ))}
      </Collapsible>

      <SectionTitle>Conexión con Binance</SectionTitle>
      <Card
        title="Tu cuenta de Binance"
        right={<Chip label={binanceChip.label} color={binanceChip.color} />}
      >
        <Text style={type.bodyDim}>
          Para ver y analizar tus operaciones reales en la pestaña Mi Binance. Solo lee tus futuros (USDT-M). No ve
          tu billetera spot. Con tus claves solo opera el bot real, y solo si lo activas tú en la pestaña Bot.
        </Text>
        {connected && (
          <>
            {!!keyHint && (
              <Text style={[type.small, { marginTop: space.sm }]}>Clave guardada: termina en {keyHint}</Text>
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

        {connected && !changingKeys ? (
          <Button
            label="Cambiar las claves"
            kind="ghost"
            small
            onPress={() => setChangingKeys(true)}
            style={{ marginTop: space.sm, alignSelf: 'flex-start', paddingHorizontal: 0 }}
          />
        ) : (
          <>
        <Text style={[type.label, { marginTop: space.lg, marginBottom: space.md }]}>
          {connected ? 'Claves nuevas' : 'Conectar'}
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
          </>
        )}
        <Feedback value={feedback.binance} />
      </Card>
      <Collapsible
        key={connected ? 'keys-connected' : 'keys-missing'}
        title="Cómo conseguir tus claves"
        hint="Tres pasos en la web o la app de Binance"
        defaultOpen={!connected}
      >
        {BINANCE_STEPS.map((step, i) => (
          <View key={step} style={styles.step}>
            <Text style={styles.stepNumber}>{i + 1}.</Text>
            <Text style={[type.bodyDim, { flex: 1 }]}>{step}</Text>
          </View>
        ))}
        <Text style={[type.small, { marginTop: space.sm }]}>
          Con una clave solo de lectura nadie puede operar ni retirar dinero de tu cuenta, tampoco esta app. Con
          “Habilitar Futuros”, el bot puede abrir y cerrar operaciones de futuros, pero solo si lo activas tú en la
          pestaña Bot. Sin el permiso de retiros, nadie puede sacar dinero.
        </Text>
      </Collapsible>

      <Collapsible title="Acerca de Criterio" hint="Versión y cómo funciona">
        <Row first label="Versión" value={version || '-'} help={updateLabel} />
        <Button small kind="secondary" label="Buscar actualización" loading={updating} onPress={checkUpdate} style={{ marginVertical: space.sm, alignSelf: 'flex-start' }} />
        {!!updateMsg && <Text style={[type.small, { marginBottom: space.sm }]}>{updateMsg}</Text>}
        <Row label="Mercado" value="Futuros de Binance (USDT-M)" />
        <Info title="Qué mira" text="Solo futuros. No analiza ni lee las monedas que tengas compradas en spot." />
        <Info title="Qué dinero toca" text="Ninguno. Mercado es análisis, Mi Binance muestra tus operaciones reales sin tocarlas y el bot de práctica usa dinero simulado. Solo el bot real, si lo activas tú en la pestaña Bot, opera con tu dinero." />
      </Collapsible>

      <Button label="Cerrar sesión" kind="secondary" onPress={handleLogout} style={{ marginTop: space.md }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  info: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  step: { flexDirection: 'row', marginBottom: space.sm },
  stepNumber: { color: colors.accent, fontSize: 14, fontWeight: '700', width: 22, lineHeight: 20 },
  fieldLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: space.md,
  },
});

export default SettingsScreen;

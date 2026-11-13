import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, Linking } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
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
  { label: 'Cambia la valoración de una moneda', help: 'Pasa a ser buen momento para comprar o para vender, o deja de serlo.' },
  { label: 'El precio llega a un nivel importante', help: 'Un precio donde otras veces se frenó o rebotó.' },
  { label: 'Tu posición ya no va a favor', help: 'La tendencia del mercado deja de acompañar a una posición tuya.' },
  { label: 'El motivo de tu posición ya no vale', help: 'El precio rompió el nivel que sostenía la operación.' },
  { label: 'Varias posiciones en riesgo a la vez', help: 'Tienes más de una posición en contra del mercado.' },
];

const BINANCE_STEPS = [
  'En Binance: Perfil > Gestión de API > Crear API.',
  'Deja marcado solo “Habilitar lectura”. No marques trading ni retiros.',
  'Copia la API Key y la Secret Key y pégalas aquí.',
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
        ? 'Conexión correcta. Ya puedes ver tus posiciones en la pestaña Posiciones.'
        : 'Las claves se guardaron pero Binance las rechaza. Revisa que estén bien copiadas y que tengan permiso de lectura de Futuros.');
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
          help={`Te quedan ${aiRemaining ?? 0}. Se gastan al pedir una explicación de una moneda o de una posición.`}
        />
        {!isPremium && (
          <Button label="Pasar a Premium" onPress={() => navigation.navigate('Upgrade')} style={{ marginTop: space.md }} />
        )}
      </Card>

      <SectionTitle>Avisos</SectionTitle>
      <Card title="Avisos en este teléfono" right={<Chip label={pushChip.label} color={pushChip.color} />}>
        <Text style={type.bodyDim}>
          {pushOn
            ? 'Te avisamos cuando cambia algo importante. Son avisos informativos: la app no compra ni vende por ti. Para dejar de recibirlos, desactívalos en los ajustes del teléfono.'
            : pushBlocked
              ? 'El teléfono tiene bloqueadas las notificaciones de Criterio. Actívalas en los ajustes del teléfono y vuelve aquí.'
              : 'Actívalos para enterarte cuando cambie algo importante en el mercado o en tus posiciones. Sin esto, la lista de avisos se queda vacía.'}
        </Text>
        <View style={styles.buttons}>
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
          <Row key={a.label} first={i === 0} label={a.label} help={a.help}>
            <View />
          </Row>
        ))}
      </Collapsible>

      <SectionTitle>Conexión con Binance</SectionTitle>
      <Card
        title="Tu cuenta de Binance"
        right={<Chip label={binanceChip.label} color={binanceChip.color} />}
      >
        <Text style={type.bodyDim}>
          Sirve para mostrar tus posiciones y analizarlas. Las claves se usan solo para leer: la app no abre ni
          cierra operaciones con ellas.
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
      <Collapsible title="Cómo conseguir tus claves" hint="Tres pasos en la web o la app de Binance">
        {BINANCE_STEPS.map((step, i) => (
          <View key={step} style={styles.step}>
            <Text style={styles.stepNumber}>{i + 1}.</Text>
            <Text style={[type.bodyDim, { flex: 1 }]}>{step}</Text>
          </View>
        ))}
        <Text style={[type.small, { marginTop: space.sm }]}>
          Con una clave solo de lectura nadie puede operar ni retirar dinero de tu cuenta, tampoco esta app.
        </Text>
      </Collapsible>

      <Collapsible title="Acerca de Criterio" hint="Versión y cómo funciona">
        <Row first label="Versión" value={version || '-'} />
        <Row label="Mercado" value="Binance Futures USDT-M" />
        <Row
          label="Cómo funciona"
          help="La app analiza el mercado y te avisa de los cambios. No ejecuta operaciones con tu cuenta: tú decides."
        >
          <View />
        </Row>
      </Collapsible>

      <Button label="Cerrar sesión" kind="secondary" onPress={handleLogout} style={{ marginTop: space.md }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  step: { flexDirection: 'row', marginBottom: space.sm },
  stepNumber: { color: colors.accent, fontSize: 14, fontWeight: '700', width: 22, lineHeight: 20 },
  fieldLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: space.md,
  },
});

export default SettingsScreen;

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription } from '../context/SubscriptionContext';
import { getOfferings, purchasePackage, restorePurchases } from '../services/purchases';
import { ModalHeader, Card, Chip, Button, Notice, Loading } from '../components/ui';
import { colors, space, type } from '../theme';
import { friendlyError } from '../errors';

const PREMIUM = [
  'Todas las monedas que quieras en Mercado',
  'Todas tus operaciones de Binance visibles',
  'Avisos de todas tus monedas y operaciones',
  '100 consultas a la IA al mes',
  'Cancela cuando quieras',
];
const FREE = [
  { text: '1 moneda en Mercado', included: true },
  { text: '1 operación de Binance visible', included: true },
  { text: '5 consultas a la IA al mes', included: true },
  { text: 'Avisos de esa moneda', included: true },
  { text: 'No incluye el bot: es una prueba del equipo', included: false },
];

const Feature = ({ text, included = true }) => (
  <View style={styles.feature}>
    <Text style={[styles.featureMark, { color: included ? colors.accent : colors.textMuted }]}>
      {included ? '✓' : '✕'}
    </Text>
    <Text style={[type.body, { flex: 1 }, !included && { color: colors.textMuted }]}>{text}</Text>
  </View>
);

const UpgradeScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { isPremium, refresh } = useSubscription();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadOfferings();
  }, []);

  const loadOfferings = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('[UpgradeScreen] Loading offerings...');
      const pkgs = (await getOfferings()) || [];
      console.log('[UpgradeScreen] Packages received:', pkgs.length);
      if (pkgs.length === 0) {
        setError('La suscripción aún no está disponible en este dispositivo.');
      }
      setPackages(pkgs);
    } catch (err) {
      console.error('[UpgradeScreen] Error loading offerings:', err);
      setError(err && err.storeUnavailable
        ? friendlyError(err, 'store')
        : 'No se pudo conectar con la tienda. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (pkg) => {
    setPurchasing(true);
    try {
      const result = await purchasePackage(pkg);

      if (result.success) {
        Alert.alert(
          'Compra completada',
          'Ya tienes acceso a todas las funciones Premium.',
          [{ text: 'OK', onPress: () => {
            refresh();
            navigation.goBack();
          }}]
        );
      } else if (result.cancelled) {
        // User cancelled, do nothing
      } else {
        Alert.alert('No se pudo comprar', 'No se pudo completar la compra. No se te ha cobrado nada. Inténtalo de nuevo.');
      }
    } catch (err) {
      Alert.alert('No se pudo comprar', 'Ocurrió un error al procesar la compra.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const result = await restorePurchases();

      if (result.success && result.isPremium) {
        Alert.alert(
          'Compra restaurada',
          'Tu suscripción Premium ha sido restaurada.',
          [{ text: 'OK', onPress: () => {
            refresh();
            navigation.goBack();
          }}]
        );
      } else if (result.success) {
        Alert.alert('Sin compras', 'No se encontraron compras anteriores para restaurar.');
      } else {
        Alert.alert('No se pudo restaurar', 'No se pudieron restaurar las compras. Inténtalo de nuevo.');
      }
    } catch (err) {
      Alert.alert('No se pudo restaurar', 'Ocurrió un error al restaurar las compras.');
    } finally {
      setRestoring(false);
    }
  };

  // Get the monthly package (or first available)
  const monthlyPackage = packages.find((p) => p.identifier === '$rc_monthly') || packages[0];
  const priceString = monthlyPackage?.product?.priceString || null; // no package from the store = no price to show
  const store = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

  return (
    <View style={styles.container}>
      <ModalHeader title="Premium" subtitle="Más monedas, operaciones y explicaciones" onClose={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
        {isPremium && (
          <Notice tone="good" title="Ya eres Premium">
            Tienes todas las funciones activas. Gracias por tu apoyo.
          </Notice>
        )}

        <Card
          title="Premium"
          right={<Chip label={isPremium ? 'Tu plan' : 'Recomendado'} color={colors.accent} solid />}
          style={{ borderColor: colors.accent }}
        >
          {PREMIUM.map((t) => <Feature key={t} text={t} />)}
          {!!priceString && (
            <View style={styles.priceLine}>
              <Text style={[styles.price, { color: colors.accent }]}>{priceString}</Text>
              <Text style={type.bodyDim}> al mes</Text>
            </View>
          )}
        </Card>

        {loading && <Loading label="Cargando opciones de la tienda…" />}

        {!!error && !loading && (
          <Notice tone="danger" title="Tienda no disponible">
            <Text style={type.bodyDim}>{error}</Text>
            <Button label="Reintentar" kind="secondary" small onPress={loadOfferings} style={{ marginTop: space.md, alignSelf: 'flex-start' }} />
          </Notice>
        )}

        {!isPremium && !loading && (
          <Button
            label={!monthlyPackage ? 'No disponible' : priceString ? `Pasar a Premium · ${priceString}/mes` : 'Pasar a Premium'}
            onPress={() => monthlyPackage && handlePurchase(monthlyPackage)}
            disabled={!monthlyPackage || restoring}
            loading={purchasing}
          />
        )}

        <Text style={[type.small, { marginTop: space.md, marginBottom: space.sm }]}>
          {isPremium ? 'Plan gratis: ' : 'Tu plan ahora (gratis): '}
          {FREE.filter((f) => f.included !== false).map((f) => f.text).join(' · ')}.
        </Text>

        <Button
          label="Restaurar compras"
          kind="ghost"
          onPress={handleRestore}
          loading={restoring}
          disabled={purchasing}
          style={{ marginTop: space.sm }}
        />

        <Text style={[type.small, styles.terms]}>
          La suscripción se renueva automáticamente cada mes. Puedes cancelarla en cualquier momento desde los
          ajustes de tu cuenta de {store}.
          {'\n\n'}
          Al suscribirte, aceptas nuestros Términos de Servicio y nuestra Política de Privacidad.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg },
  feature: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
  featureMark: { width: 24, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.md },
  price: { color: colors.text, fontSize: 28, fontWeight: '800' },
  terms: { textAlign: 'center', marginTop: space.lg, paddingHorizontal: space.sm },
});

export default UpgradeScreen;

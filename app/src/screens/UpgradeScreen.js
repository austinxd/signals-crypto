import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useSubscription } from '../context/SubscriptionContext';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
} from '../services/purchases';

const FeatureRow = ({ included, text }) => (
  <View style={styles.featureRow}>
    <Text style={[styles.featureIcon, { color: included ? '#00d4aa' : '#555' }]}>
      {included ? '\u2713' : '\u2717'}
    </Text>
    <Text style={[styles.featureText, !included && styles.featureTextDisabled]}>
      {text}
    </Text>
  </View>
);

const UpgradeScreen = ({ navigation }) => {
  const { isPremium, refresh } = useSubscription();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadOfferings();
  }, []);

  const loadOfferings = async () => {
    setLoading(true);
    try {
      const pkgs = await getOfferings();
      setPackages(pkgs);
    } catch (err) {
      console.error('Error loading offerings:', err);
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
          'Compra exitosa',
          'Ahora tienes acceso a todas las funciones Premium.',
          [{ text: 'OK', onPress: () => {
            refresh();
            navigation.goBack();
          }}]
        );
      } else if (result.cancelled) {
        // User cancelled, do nothing
      } else {
        Alert.alert('Error', result.error || 'No se pudo completar la compra');
      }
    } catch (err) {
      Alert.alert('Error', 'Ocurrio un error al procesar la compra');
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
          'Tu suscripcion Premium ha sido restaurada.',
          [{ text: 'OK', onPress: () => {
            refresh();
            navigation.goBack();
          }}]
        );
      } else if (result.success) {
        Alert.alert('Sin compras', 'No se encontraron compras anteriores para restaurar.');
      } else {
        Alert.alert('Error', result.error || 'No se pudieron restaurar las compras');
      }
    } catch (err) {
      Alert.alert('Error', 'Ocurrio un error al restaurar las compras');
    } finally {
      setRestoring(false);
    }
  };

  // Get the monthly package (or first available)
  const monthlyPackage = packages.find(p => p.identifier === '$rc_monthly') || packages[0];
  const priceString = monthlyPackage?.product?.priceString || '$4.99';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.closeButtonText}>{'\u2715'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Premium</Text>
          <Text style={styles.subtitle}>Desbloquea todo el potencial</Text>
        </View>

        {/* Current Plan Badge */}
        <View style={styles.currentPlanBadge}>
          <Text style={styles.currentPlanLabel}>Plan actual:</Text>
          <Text style={[styles.currentPlanValue, isPremium && styles.premiumText]}>
            {isPremium ? 'Premium' : 'Free'}
          </Text>
        </View>

        {/* Plans Comparison */}
        <View style={styles.plansContainer}>
          {/* FREE Plan */}
          <View style={[styles.planCard, !isPremium && styles.planCardActive]}>
            <Text style={styles.planTitle}>FREE</Text>
            <View style={styles.featuresContainer}>
              <FeatureRow included={true} text="1 par en Mercado" />
              <FeatureRow included={true} text="1 posicion visible" />
              <FeatureRow included={false} text="Sin alertas" />
              <FeatureRow included={true} text="5 consultas IA / mes" />
            </View>
            <View style={styles.priceContainer}>
              <Text style={styles.price}>$0</Text>
              <Text style={styles.pricePeriod}>/ siempre</Text>
            </View>
          </View>

          {/* PREMIUM Plan */}
          <View style={[styles.planCard, styles.planCardPremium, isPremium && styles.planCardActive]}>
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>RECOMENDADO</Text>
            </View>
            <Text style={[styles.planTitle, styles.premiumText]}>PREMIUM</Text>
            <View style={styles.featuresContainer}>
              <FeatureRow included={true} text="Todos los pares" />
              <FeatureRow included={true} text="Todas las posiciones" />
              <FeatureRow included={true} text="Alertas ilimitadas" />
              <FeatureRow included={true} text="100 consultas IA / mes" />
              <FeatureRow included={true} text="Cancela cuando quieras" />
            </View>
            <View style={styles.priceContainer}>
              <Text style={[styles.price, styles.premiumText]}>{priceString}</Text>
              <Text style={styles.pricePeriod}>/ mes</Text>
            </View>
          </View>
        </View>

        {/* Loading */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#00d4aa" />
            <Text style={styles.loadingText}>Cargando opciones...</Text>
          </View>
        )}

        {/* Upgrade Button */}
        {!isPremium && !loading && (
          <TouchableOpacity
            style={[styles.upgradeButton, purchasing && styles.upgradeButtonDisabled]}
            onPress={() => monthlyPackage && handlePurchase(monthlyPackage)}
            disabled={purchasing || !monthlyPackage}
          >
            {purchasing ? (
              <ActivityIndicator size="small" color="#0a0a14" />
            ) : (
              <Text style={styles.upgradeButtonText}>
                {monthlyPackage ? `Desbloquear Premium - ${priceString}/mes` : 'No disponible'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* Restore Purchases */}
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestore}
          disabled={restoring}
        >
          {restoring ? (
            <ActivityIndicator size="small" color="#888" />
          ) : (
            <Text style={styles.restoreButtonText}>Restaurar compra</Text>
          )}
        </TouchableOpacity>

        {/* Terms */}
        <Text style={styles.terms}>
          La suscripcion se renueva automaticamente cada mes. Puedes cancelar en cualquier momento
          desde la configuracion de tu cuenta de {Platform.OS === 'ios' ? 'App Store' : 'Google Play'}.
          {'\n\n'}
          Al suscribirte, aceptas nuestros Terminos de Servicio y Politica de Privacidad.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: 10,
  },
  closeButtonText: {
    color: '#888',
    fontSize: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#00d4aa',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
  },
  currentPlanBadge: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    padding: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
  },
  currentPlanLabel: {
    color: '#888',
    fontSize: 14,
  },
  currentPlanValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  premiumText: {
    color: '#00d4aa',
  },
  plansContainer: {
    gap: 16,
    marginBottom: 24,
  },
  planCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  planCardActive: {
    borderColor: '#00d4aa',
  },
  planCardPremium: {
    backgroundColor: '#0f1f1a',
    borderColor: '#00d4aa40',
  },
  recommendedBadge: {
    position: 'absolute',
    top: -12,
    right: 20,
    backgroundColor: '#00d4aa',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
  },
  recommendedText: {
    color: '#0a0a14',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  planTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  featuresContainer: {
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  featureIcon: {
    fontSize: 16,
    width: 20,
  },
  featureText: {
    color: '#ccc',
    fontSize: 14,
  },
  featureTextDisabled: {
    color: '#555',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  price: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  pricePeriod: {
    fontSize: 14,
    color: '#666',
  },
  loadingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
  upgradeButton: {
    backgroundColor: '#00d4aa',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  upgradeButtonDisabled: {
    backgroundColor: '#00d4aa80',
  },
  upgradeButtonText: {
    color: '#0a0a14',
    fontSize: 18,
    fontWeight: 'bold',
  },
  restoreButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  restoreButtonText: {
    color: '#888',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  terms: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default UpgradeScreen;

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useSubscription } from '../context/SubscriptionContext';

const FeatureRow = ({ included, text }) => (
  <View style={styles.featureRow}>
    <Text style={[styles.featureIcon, { color: included ? '#00d4aa' : '#555' }]}>
      {included ? '✓' : '✕'}
    </Text>
    <Text style={[styles.featureText, !included && styles.featureTextDisabled]}>
      {text}
    </Text>
  </View>
);

const UpgradeScreen = ({ navigation }) => {
  const { isPremium, status } = useSubscription();

  const handleUpgrade = () => {
    // TODO: Integrate with payment provider (App Store / Google Play)
    console.log('Upgrade pressed - payment integration pending');
  };

  const handleRestore = () => {
    // TODO: Restore purchases from App Store / Google Play
    console.log('Restore pressed - payment integration pending');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.closeButtonText}>✕</Text>
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
              <Text style={[styles.price, styles.premiumText]}>$4.99</Text>
              <Text style={styles.pricePeriod}>/ mes</Text>
            </View>
          </View>
        </View>

        {/* Upgrade Button */}
        {!isPremium && (
          <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
            <Text style={styles.upgradeButtonText}>Desbloquear Premium</Text>
          </TouchableOpacity>
        )}

        {/* Restore Purchases */}
        <TouchableOpacity style={styles.restoreButton} onPress={handleRestore}>
          <Text style={styles.restoreButtonText}>Restaurar compra</Text>
        </TouchableOpacity>

        {/* Terms */}
        <Text style={styles.terms}>
          La suscripcion se renueva automaticamente. Puedes cancelar en cualquier momento desde la configuracion de tu cuenta de App Store o Google Play.
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
  upgradeButton: {
    backgroundColor: '#00d4aa',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
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

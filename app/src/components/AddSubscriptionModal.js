import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { getConfig } from '../services/api';

// Signal bars component (like iOS WiFi indicator)
const SignalBars = ({ level, color = '#fff', size = 12 }) => {
  const barWidth = size / 4;
  const gap = size / 8;
  const heights = [size * 0.4, size * 0.7, size];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: size, gap: gap }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: barWidth,
            height: heights[i],
            backgroundColor: i < level ? color : '#444',
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
};

const TRADING_MODES = [
  { id: 'conservative', name: 'Conservador', level: 1, color: '#00d4aa', description: 'Solo alertas criticas' },
  { id: 'balanced', name: 'Balanceado', level: 2, color: '#ffd93d', description: 'Alertas importantes (Recomendado)' },
  { id: 'aggressive', name: 'Agresivo', level: 3, color: '#ff9f43', description: 'Todas las alertas' },
];

const AddSubscriptionModal = ({ visible, onClose, onAdd, existingSubscriptions = [] }) => {
  const [step, setStep] = useState(1);
  const [selectedPair, setSelectedPair] = useState(null);
  const [selectedMode, setSelectedMode] = useState('balanced');
  const [availablePairs, setAvailablePairs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadConfig();
      // Reset state
      setStep(1);
      setSelectedPair(null);
      setSelectedMode('balanced');
    }
  }, [visible]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const config = await getConfig();
      setAvailablePairs(config.available_pairs || []);
    } catch (err) {
      setAvailablePairs([
        'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
        'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Check if pair is already subscribed (ignore timeframe - we now use unified)
  const isAlreadySubscribed = (pair) => {
    return existingSubscriptions.some(sub => sub.pair === pair);
  };

  const handleNext = () => {
    if (step === 1 && selectedPair) {
      setStep(2);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleAdd = () => {
    if (selectedPair && selectedMode) {
      // Use "4h" as default timeframe for backend compatibility
      // The frontend now shows unified 4H+15m analysis regardless
      onAdd(selectedPair, '4h', selectedMode);
      onClose();
    }
  };

  const renderStep1 = () => (
    <>
      <Text style={styles.stepTitle}>1. Selecciona el par</Text>
      <Text style={styles.stepDescription}>
        Cada par muestra analisis unificado 4H (contexto) + 15m (timing)
      </Text>
      <ScrollView style={styles.optionsList}>
        {availablePairs.map((pair) => {
          const pairShort = pair.replace('/USDT', '');
          const alreadyExists = isAlreadySubscribed(pair);
          return (
            <TouchableOpacity
              key={pair}
              style={[
                styles.optionItem,
                selectedPair === pair && styles.optionItemSelected,
                alreadyExists && styles.optionItemDisabled,
              ]}
              onPress={() => !alreadyExists && setSelectedPair(pair)}
              disabled={alreadyExists}
            >
              <View>
                <Text style={[
                  styles.optionText,
                  selectedPair === pair && styles.optionTextSelected,
                  alreadyExists && styles.optionTextDisabled,
                ]}>
                  {pairShort}
                </Text>
                <Text style={styles.optionSubtext}>{pair}</Text>
              </View>
              {alreadyExists && (
                <Text style={styles.alreadyAddedText}>Ya agregado</Text>
              )}
              {selectedPair === pair && !alreadyExists && (
                <Text style={styles.checkMark}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );

  const renderStep2 = () => (
    <>
      <Text style={styles.stepTitle}>2. Nivel de alertas</Text>
      <Text style={styles.selectedInfo}>Par: {selectedPair?.replace('/USDT', '')}</Text>
      <View style={styles.modesList}>
        {TRADING_MODES.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            style={[
              styles.modeItem,
              selectedMode === mode.id && styles.modeItemSelected,
            ]}
            onPress={() => setSelectedMode(mode.id)}
          >
            <View style={styles.modeHeader}>
              <View style={styles.modeEmoji}>
                <SignalBars
                  level={mode.level}
                  color={selectedMode === mode.id ? mode.color : '#666'}
                  size={20}
                />
              </View>
              <Text style={[
                styles.modeName,
                selectedMode === mode.id && styles.modeNameSelected,
              ]}>
                {mode.name}
              </Text>
              {selectedMode === mode.id && (
                <Text style={styles.modeCheck}>✓</Text>
              )}
            </View>
            <Text style={styles.modeDescription}>{mode.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Alertas que recibiras:</Text>
        <Text style={styles.infoText}>• Cambios de sesgo HTF (4H)</Text>
        <Text style={styles.infoText}>• Cambios de escenario</Text>
        <Text style={styles.infoText}>• Volatilidad significativa</Text>
        <Text style={styles.infoText}>• Zonas clave de decision</Text>
      </View>
    </>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Agregar Par</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Progress indicator - now only 2 steps */}
          <View style={styles.progress}>
            {[1, 2].map((s) => (
              <View
                key={s}
                style={[
                  styles.progressDot,
                  step >= s && styles.progressDotActive,
                ]}
              />
            ))}
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#00d4aa" />
            </View>
          ) : (
            <View style={styles.content}>
              {step === 1 && renderStep1()}
              {step === 2 && renderStep2()}
            </View>
          )}

          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Text style={styles.backButtonText}>Atras</Text>
              </TouchableOpacity>
            )}
            {step < 2 ? (
              <TouchableOpacity
                style={[
                  styles.nextButton,
                  !selectedPair && styles.buttonDisabled,
                ]}
                onPress={handleNext}
                disabled={!selectedPair}
              >
                <Text style={styles.nextButtonText}>Siguiente</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAdd}
              >
                <Text style={styles.addButtonText}>Agregar Par</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    color: '#888',
    fontSize: 20,
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333',
  },
  progressDotActive: {
    backgroundColor: '#00d4aa',
  },
  loadingContainer: {
    padding: 60,
    alignItems: 'center',
  },
  content: {
    padding: 20,
    minHeight: 300,
  },
  stepTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  stepDescription: {
    color: '#888',
    fontSize: 13,
    marginBottom: 16,
  },
  selectedInfo: {
    color: '#00d4aa',
    fontSize: 14,
    marginBottom: 16,
  },
  optionsList: {
    maxHeight: 300,
  },
  optionItem: {
    backgroundColor: '#0f0f1a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#333',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionItemSelected: {
    borderColor: '#00d4aa',
    backgroundColor: '#0f1a1a',
  },
  optionItemDisabled: {
    opacity: 0.5,
  },
  optionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: '#00d4aa',
  },
  optionTextDisabled: {
    color: '#666',
  },
  optionSubtext: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  alreadyAddedText: {
    color: '#ff9f43',
    fontSize: 12,
  },
  checkMark: {
    color: '#00d4aa',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modesList: {
    gap: 10,
  },
  modeItem: {
    backgroundColor: '#0f0f1a',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333',
  },
  modeItemSelected: {
    borderColor: '#00d4aa',
    backgroundColor: '#0f1a1a',
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  modeEmoji: {
    marginRight: 10,
  },
  modeName: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  modeNameSelected: {
    color: '#fff',
  },
  modeCheck: {
    color: '#00d4aa',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modeDescription: {
    color: '#666',
    fontSize: 13,
    marginLeft: 30,
  },
  infoBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    borderLeftWidth: 3,
    borderLeftColor: '#00d4aa',
  },
  infoTitle: {
    color: '#00d4aa',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoText: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  backButton: {
    flex: 1,
    backgroundColor: '#333',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  nextButton: {
    flex: 2,
    backgroundColor: '#00d4aa',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  nextButtonText: {
    color: '#0a0a14',
    fontSize: 16,
    fontWeight: '600',
  },
  addButton: {
    flex: 2,
    backgroundColor: '#00d4aa',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#0a0a14',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    backgroundColor: '#333',
  },
});

export default AddSubscriptionModal;

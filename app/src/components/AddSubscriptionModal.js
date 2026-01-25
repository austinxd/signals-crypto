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

const TRADING_MODES = [
  { id: 'conservative', name: 'Conservador', emoji: '│', description: 'Solo Óptimas' },
  { id: 'balanced', name: 'Balanceado', emoji: '││', description: 'Óptimas + Buenas' },
  { id: 'aggressive', name: 'Agresivo', emoji: '│││', description: 'Todas las señales' },
];

const AddSubscriptionModal = ({ visible, onClose, onAdd, existingSubscriptions = [] }) => {
  const [step, setStep] = useState(1);
  const [selectedPair, setSelectedPair] = useState(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState(null);
  const [selectedMode, setSelectedMode] = useState('balanced');
  const [availablePairs, setAvailablePairs] = useState([]);
  const [availableTimeframes, setAvailableTimeframes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadConfig();
      // Reset state
      setStep(1);
      setSelectedPair(null);
      setSelectedTimeframe(null);
      setSelectedMode('balanced');
    }
  }, [visible]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const config = await getConfig();
      setAvailablePairs(config.available_pairs || []);
      setAvailableTimeframes(config.available_timeframes || []);
    } catch (err) {
      setAvailablePairs([
        'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
        'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
      ]);
      setAvailableTimeframes(['15m', '30m', '1h', '4h', '1d']);
    } finally {
      setLoading(false);
    }
  };

  const isAlreadySubscribed = (pair, timeframe) => {
    return existingSubscriptions.some(
      sub => sub.pair === pair && sub.timeframe === timeframe
    );
  };

  const handleNext = () => {
    if (step === 1 && selectedPair) {
      setStep(2);
    } else if (step === 2 && selectedTimeframe) {
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleAdd = () => {
    if (selectedPair && selectedTimeframe && selectedMode) {
      onAdd(selectedPair, selectedTimeframe, selectedMode);
      onClose();
    }
  };

  const renderStep1 = () => (
    <>
      <Text style={styles.stepTitle}>1. Selecciona el par</Text>
      <ScrollView style={styles.optionsList}>
        {availablePairs.map((pair) => {
          const pairShort = pair.replace('/USDT', '');
          return (
            <TouchableOpacity
              key={pair}
              style={[
                styles.optionItem,
                selectedPair === pair && styles.optionItemSelected,
              ]}
              onPress={() => setSelectedPair(pair)}
            >
              <Text style={[
                styles.optionText,
                selectedPair === pair && styles.optionTextSelected,
              ]}>
                {pairShort}
              </Text>
              <Text style={styles.optionSubtext}>{pair}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );

  const renderStep2 = () => (
    <>
      <Text style={styles.stepTitle}>2. Selecciona la temporalidad</Text>
      <Text style={styles.selectedInfo}>Par: {selectedPair}</Text>
      <ScrollView style={styles.optionsList}>
        {availableTimeframes.map((tf) => {
          const alreadyExists = isAlreadySubscribed(selectedPair, tf);
          return (
            <TouchableOpacity
              key={tf}
              style={[
                styles.optionItem,
                selectedTimeframe === tf && styles.optionItemSelected,
                alreadyExists && styles.optionItemDisabled,
              ]}
              onPress={() => !alreadyExists && setSelectedTimeframe(tf)}
              disabled={alreadyExists}
            >
              <Text style={[
                styles.optionText,
                selectedTimeframe === tf && styles.optionTextSelected,
                alreadyExists && styles.optionTextDisabled,
              ]}>
                {tf}
              </Text>
              {alreadyExists && (
                <Text style={styles.alreadyAddedText}>Ya agregado</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );

  const renderStep3 = () => (
    <>
      <Text style={styles.stepTitle}>3. Tipo de notificaciones</Text>
      <Text style={styles.selectedInfo}>{selectedPair} - {selectedTimeframe}</Text>
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
              <Text style={styles.modeEmoji}>{mode.emoji}</Text>
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

          {/* Progress indicator */}
          <View style={styles.progress}>
            {[1, 2, 3].map((s) => (
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
              {step === 3 && renderStep3()}
            </View>
          )}

          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Text style={styles.backButtonText}>Atrás</Text>
              </TouchableOpacity>
            )}
            {step < 3 ? (
              <TouchableOpacity
                style={[
                  styles.nextButton,
                  !(step === 1 ? selectedPair : selectedTimeframe) && styles.buttonDisabled,
                ]}
                onPress={handleNext}
                disabled={!(step === 1 ? selectedPair : selectedTimeframe)}
              >
                <Text style={styles.nextButtonText}>Siguiente</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAdd}
              >
                <Text style={styles.addButtonText}>Agregar</Text>
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
  },
  alreadyAddedText: {
    color: '#ff9f43',
    fontSize: 12,
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
    fontSize: 20,
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

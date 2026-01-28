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

const AddSubscriptionModal = ({ visible, onClose, onAdd, existingSubscriptions = [] }) => {
  const [selectedPair, setSelectedPair] = useState(null);
  const [availablePairs, setAvailablePairs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadConfig();
      setSelectedPair(null);
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

  // Check if pair is already subscribed
  const isAlreadySubscribed = (pair) => {
    return existingSubscriptions.some(sub => sub.pair === pair);
  };

  const handleAdd = () => {
    if (selectedPair) {
      onAdd(selectedPair);
      onClose();
    }
  };

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

          <Text style={styles.description}>
            Selecciona el par para monitorear. Recibiras alertas de cambios en contexto (4H) y timing (15m).
          </Text>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#00d4aa" />
            </View>
          ) : (
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
          )}

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Alertas que recibiras:</Text>
            <Text style={styles.infoText}>• Cambios de sesgo HTF (4H)</Text>
            <Text style={styles.infoText}>• Cambios de escenario</Text>
            <Text style={styles.infoText}>• Volatilidad significativa</Text>
            <Text style={styles.infoText}>• Zonas clave de decision</Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.addButton, !selectedPair && styles.buttonDisabled]}
              onPress={handleAdd}
              disabled={!selectedPair}
            >
              <Text style={styles.addButtonText}>Agregar Par</Text>
            </TouchableOpacity>
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
    maxHeight: '80%',
    paddingBottom: 30,
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
  description: {
    color: '#888',
    fontSize: 13,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    lineHeight: 18,
  },
  loadingContainer: {
    padding: 60,
    alignItems: 'center',
  },
  optionsList: {
    maxHeight: 280,
    paddingHorizontal: 20,
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
  infoBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 16,
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
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  addButton: {
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

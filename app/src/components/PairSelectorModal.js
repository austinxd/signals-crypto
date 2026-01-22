import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { getUserPairs, setUserPairs, getConfig } from '../services/api';

const PairSelectorModal = ({ visible, onClose, onSave }) => {
  const [availablePairs, setAvailablePairs] = useState([]);
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible]);

  const loadData = async () => {
    setLoading(true);
    try {
      const pairs = await getUserPairs();
      setSelectedPairs(pairs);

      try {
        const config = await getConfig();
        setAvailablePairs(config.available_pairs || []);
      } catch {
        setAvailablePairs([
          'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
          'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
          'DOT/USDT', 'MATIC/USDT', 'LINK/USDT', 'UNI/USDT',
          'ATOM/USDT', 'LTC/USDT', 'ETC/USDT', 'FIL/USDT',
        ]);
      }
    } catch (err) {
      console.error('Error loading pairs:', err);
    }
    setLoading(false);
  };

  const togglePair = (pair) => {
    if (selectedPairs.includes(pair)) {
      if (selectedPairs.length > 1) {
        setSelectedPairs(selectedPairs.filter(p => p !== pair));
      }
    } else {
      setSelectedPairs([...selectedPairs, pair]);
    }
  };

  const handleSave = async () => {
    await setUserPairs(selectedPairs);
    onSave(selectedPairs);
    onClose();
  };

  const selectAll = () => {
    setSelectedPairs([...availablePairs]);
  };

  const selectNone = () => {
    setSelectedPairs([availablePairs[0]]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Seleccionar Pares</Text>
            <Text style={styles.subtitle}>{selectedPairs.length} seleccionados</Text>
          </View>

          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickButton} onPress={selectAll}>
              <Text style={styles.quickButtonText}>Todos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickButton} onPress={selectNone}>
              <Text style={styles.quickButtonText}>Mínimo</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.pairsGrid}>
              {availablePairs.map((pair) => {
                const isSelected = selectedPairs.includes(pair);
                const symbol = pair.replace('/USDT', '');
                return (
                  <TouchableOpacity
                    key={pair}
                    style={[styles.pairChip, isSelected && styles.pairChipActive]}
                    onPress={() => togglePair(pair)}
                  >
                    <Text style={[styles.pairSymbol, isSelected && styles.pairSymbolActive]}>
                      {symbol}
                    </Text>
                    <Text style={[styles.pairSuffix, isSelected && styles.pairSuffixActive]}>
                      /USDT
                    </Text>
                    {isSelected && (
                      <View style={styles.checkmark}>
                        <Text style={styles.checkmarkText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>Guardar</Text>
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
    backgroundColor: 'rgba(0,0,0,0.8)',
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
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#00d4aa',
    fontSize: 14,
    marginTop: 4,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  quickButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#2a2a4a',
    borderRadius: 20,
  },
  quickButtonText: {
    color: '#888',
    fontSize: 14,
  },
  content: {
    padding: 16,
    maxHeight: 400,
  },
  pairsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  pairChip: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#2a2a4a',
  },
  pairChipActive: {
    backgroundColor: 'rgba(0, 212, 170, 0.1)',
    borderColor: '#00d4aa',
  },
  pairSymbol: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  pairSymbolActive: {
    color: '#00d4aa',
  },
  pairSuffix: {
    color: '#666',
    fontSize: 12,
    marginLeft: 2,
  },
  pairSuffixActive: {
    color: '#00d4aa',
    opacity: 0.7,
  },
  checkmark: {
    marginLeft: 'auto',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#00d4aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#0f0f1a',
    fontWeight: 'bold',
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    backgroundColor: '#2a2a4a',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 16,
    backgroundColor: '#00d4aa',
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#0f0f1a',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PairSelectorModal;

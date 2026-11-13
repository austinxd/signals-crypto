import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getUserPairs, setUserPairs, getConfig } from '../services/api';
import { ModalHeader, Button, Loading } from './ui';
import { colors, space, radius, type, tint, pairName } from '../theme';

const FALLBACK_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
  'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
  'DOT/USDT', 'MATIC/USDT', 'LINK/USDT', 'UNI/USDT',
  'ATOM/USDT', 'LTC/USDT', 'ETC/USDT', 'FIL/USDT',
];

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
      setSelectedPairs(pairs || []);

      try {
        const config = await getConfig();
        setAvailablePairs(config?.available_pairs || []);
      } catch {
        setAvailablePairs(FALLBACK_PAIRS);
      }
    } catch (err) {
      console.error('Error loading pairs:', err);
    }
    setLoading(false);
  };

  // At least one coin always stays selected.
  const togglePair = (pair) => {
    if (selectedPairs.includes(pair)) {
      if (selectedPairs.length > 1) {
        setSelectedPairs(selectedPairs.filter((p) => p !== pair));
      }
    } else {
      setSelectedPairs([...selectedPairs, pair]);
    }
  };

  const handleSave = async () => {
    await setUserPairs(selectedPairs);
    if (onSave) onSave(selectedPairs);
    onClose();
  };

  const selectAll = () => setSelectedPairs([...availablePairs]);
  const selectNone = () => setSelectedPairs(availablePairs.length ? [availablePairs[0]] : []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ModalHeader
          title="Elegir monedas"
          subtitle={`${selectedPairs.length} elegidas · mínimo una`}
          onClose={onClose}
        />

        {loading ? (
          <Loading label="Cargando monedas…" />
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.quick}>
              <Button label="Elegir todas" kind="secondary" small onPress={selectAll} style={{ flex: 1 }} />
              <Button label="Dejar solo una" kind="secondary" small onPress={selectNone} style={{ flex: 1 }} />
            </View>
            <View style={styles.grid}>
              {availablePairs.map((pair) => {
                const on = selectedPairs.includes(pair);
                return (
                  <TouchableOpacity
                    key={pair}
                    style={[styles.item, on && styles.itemOn]}
                    onPress={() => togglePair(pair)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.itemName, on && { color: colors.accent }]}>{pairName(pair)}</Text>
                    <Text style={type.small}>{on ? 'Elegida' : 'Tocar para elegir'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Button label="Cancelar" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button label="Guardar" onPress={handleSave} disabled={loading} style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg },
  quick: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  item: {
    width: '48%', minHeight: 60, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  itemOn: { borderColor: colors.accent, backgroundColor: tint(colors.accent, 0.1) },
  itemName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  footer: {
    flexDirection: 'row', gap: space.sm, padding: space.lg, paddingBottom: space.xl,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
});

export default PairSelectorModal;

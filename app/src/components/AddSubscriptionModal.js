import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getConfig } from '../services/api';
import { ModalHeader, Button, Loading, Notice } from './ui';
import { colors, space, radius, type, tint, pairName } from '../theme';

const FALLBACK_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
  'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
];

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
      setAvailablePairs(config?.available_pairs || []);
    } catch (err) {
      setAvailablePairs(FALLBACK_PAIRS);
    } finally {
      setLoading(false);
    }
  };

  const isAlreadySubscribed = (pair) => (existingSubscriptions || []).some((sub) => sub?.pair === pair);

  const handleAdd = () => {
    if (selectedPair) {
      onAdd(selectedPair);
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ModalHeader title="Añadir moneda" subtitle="Elige una para seguirla" onClose={onClose} />

        {loading ? (
          <Loading label="Cargando monedas…" />
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <Notice tone="info" title="Qué pasa al añadirla">
              Verás su análisis en Mercado y recibirás un aviso cuando cambie la tendencia, aparezca un buen
              momento, el precio se mueva bruscamente o llegue a un nivel importante.
            </Notice>

            {availablePairs.map((pair) => {
              const added = isAlreadySubscribed(pair);
              const on = selectedPair === pair;
              return (
                <TouchableOpacity
                  key={pair}
                  style={[styles.option, on && styles.optionOn, added && { opacity: 0.45 }]}
                  onPress={() => setSelectedPair(pair)}
                  disabled={added}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionName}>{pairName(pair)}</Text>
                    <Text style={type.small}>{pair}</Text>
                  </View>
                  <Text style={[styles.optionState, on && { color: colors.accent }]}>
                    {added ? 'Ya la sigues' : on ? 'Elegida' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Button
            label={selectedPair ? `Añadir ${pairName(selectedPair)}` : 'Elige una moneda'}
            onPress={handleAdd}
            disabled={!selectedPair}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, paddingBottom: space.xl },
  option: {
    flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: space.sm,
  },
  optionOn: { borderColor: colors.accent, backgroundColor: tint(colors.accent, 0.1) },
  optionName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  optionState: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginLeft: space.md },
  footer: {
    padding: space.lg, paddingBottom: space.xl, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});

export default AddSubscriptionModal;

import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getConfig } from '../services/api';
import { ModalHeader, Loading } from './ui';
import { useSubscription } from '../context/SubscriptionContext';
import { colors, space, radius, type, pairName } from '../theme';

const FALLBACK_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
  'XRP/USDT', 'ADA/USDT', 'DOGE/USDT', 'AVAX/USDT',
];

/** Pick a coin to follow: one tap on a row adds it and closes. */
const AddSubscriptionModal = ({ visible, onClose, onAdd, existingSubscriptions = [] }) => {
  const { isPremium } = useSubscription();
  const [availablePairs, setAvailablePairs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) loadConfig();
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

  const followed = (existingSubscriptions || []).filter((s) => s?.pair);
  const isAlreadySubscribed = (pair) => followed.some((sub) => sub.pair === pair);

  const add = (pair) => {
    onAdd(pair);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ModalHeader title="Añadir moneda" subtitle="Toca una para seguirla" onClose={onClose} />

        {loading ? (
          <Loading label="Cargando monedas…" />
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[type.small, { marginBottom: space.md }]}>
              Verás su análisis en Mercado. Para que te lleguen sus avisos, actívalos en Ajustes.
              {!isPremium && followed.length >= 1 ? ' Con el plan gratis solo se analiza tu primera moneda; las demás quedan bloqueadas hasta pasar a Premium.' : ''}
            </Text>

            {availablePairs.map((pair) => {
              const added = isAlreadySubscribed(pair);
              return (
                <TouchableOpacity
                  key={pair}
                  style={[styles.option, added && { opacity: 0.45 }]}
                  onPress={() => add(pair)}
                  disabled={added}
                  activeOpacity={0.75}
                >
                  <Text style={styles.optionName}>{pairName(pair)}</Text>
                  <Text style={[styles.optionState, !added && { color: colors.accent }]}>
                    {added ? 'Ya la sigues' : 'Añadir'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, paddingBottom: 48 },
  option: {
    flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.lg, paddingVertical: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: space.sm,
  },
  optionName: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  optionState: { color: colors.textMuted, fontSize: 14, fontWeight: '600', marginLeft: space.md },
});

export default AddSubscriptionModal;

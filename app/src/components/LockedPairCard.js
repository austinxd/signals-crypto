import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './ui';
import { colors, space, radius, type, pairName } from '../theme';

/** A coin the free plan cannot see. Tapping it opens the Premium screen. */
const LockedPairCard = ({ pair, onPress }) => (
  <TouchableOpacity onPress={onPress} style={styles.card} activeOpacity={0.75}>
    <View style={styles.top}>
      <Text style={styles.name}>{pairName(pair) || 'Moneda'}</Text>
      <Chip label="Premium" color={colors.warn} />
    </View>
    <Text style={[type.bodyDim, { marginTop: space.sm }]}>
      El plan gratuito muestra el análisis de una sola moneda.
    </Text>
    <Text style={styles.more}>Desbloquear con Premium</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', minHeight: 44,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: colors.textDim, fontSize: 20, fontWeight: '700' },
  more: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: space.md },
});

export default LockedPairCard;

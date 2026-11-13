import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './ui';
import { colors, space, radius, type, pairName } from '../theme';

/** A coin the free plan cannot see. Tapping it opens the Premium screen. */
const LockedPairCard = ({ pair, onPress, onRemove }) => (
  <TouchableOpacity onPress={onPress} style={styles.card} activeOpacity={0.75}>
    <View style={styles.top}>
      <Text style={styles.name}>{pairName(pair) || 'Moneda'}</Text>
      <Chip label="Premium" color={colors.warn} />
    </View>
    <Text style={[type.bodyDim, { marginTop: space.sm }]}>
      El plan gratuito muestra el análisis de una sola moneda: la primera que añadiste.
    </Text>
    <View style={styles.actions}>
      <Text style={styles.more}>Desbloquear con Premium</Text>
      {!!onRemove && (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.remove}>Quitar</Text>
        </TouchableOpacity>
      )}
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', minHeight: 44,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: colors.textDim, fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md },
  more: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  remove: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
});

export default LockedPairCard;

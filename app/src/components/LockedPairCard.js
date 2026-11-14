import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './ui';
import { colors, space, radius, type, pairName } from '../theme';

/** A coin the free plan cannot see. Tapping it opens the Premium screen. */
const LockedPairCard = ({ pair, onPress, onRemove }) => (
  <TouchableOpacity onPress={onPress} style={styles.card} activeOpacity={0.75}>
    <View style={styles.top}>
      <Text style={styles.name}>{pairName(pair) || 'Moneda'}</Text>
      <Chip label="Premium" color={colors.warn} style={{ marginLeft: space.md }} />
      <View style={{ flex: 1 }} />
      {!!onRemove && (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.remove}>Quitar</Text>
        </TouchableOpacity>
      )}
    </View>
    <Text style={[type.small, { marginTop: space.xs }]}>
      El plan gratis solo analiza tu primera moneda. Toca para ver Premium.
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md,
    marginBottom: space.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', minHeight: 44,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.textDim, fontSize: 19, fontWeight: '700' },
  remove: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
});

export default LockedPairCard;

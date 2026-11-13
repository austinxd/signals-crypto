import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './ui';
import { colors, space, radius, type, pairName, fmtPrice } from '../theme';
import { explain } from '../explain';

/**
 * Summary of one coin: what it costs, whether it is a good moment, and why in one sentence.
 * The full analysis lives in PairDetailModal, opened by tapping the card.
 */
const PairCard = ({ pair, data, onPress, onLongPress }) => {
  const analysis = data?.analysis;
  const view = explain(analysis);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      activeOpacity={0.75}
    >
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{pairName(pair)}</Text>
          <Text style={type.small}>{pair}</Text>
        </View>
        <Text style={styles.price}>{data?.price != null ? fmtPrice(data.price) : '…'}</Text>
      </View>

      {!data ? (
        <Text style={[type.bodyDim, { marginTop: space.md }]}>Cargando el análisis…</Text>
      ) : !analysis ? (
        <Text style={[type.bodyDim, { marginTop: space.md }]}>Todavía no hay análisis para esta moneda.</Text>
      ) : (
        <>
          <Chip label={view.headline} color={view.color} solid style={styles.verdict} />
          <Text style={[type.body, { marginTop: space.md }]}>{view.reasons.slice(0, 2).join(' ')}</Text>
          <View style={styles.footer}>
            <Text style={styles.more}>Ver por qué</Text>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 20, fontWeight: '700' },
  price: { ...type.number, marginLeft: space.md },
  verdict: { marginTop: space.md, paddingVertical: 6, paddingHorizontal: 12 },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border,
  },
  more: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});

export default PairCard;

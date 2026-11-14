import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './ui';
import { colors, space, radius, type, pairName, fmtPrice } from '../theme';
import { explain } from '../explain';

/**
 * One coin in the market list, answer first: name, what to do (long / short / wait), price, verdict and one sentence.
 * Everything else lives in PairDetailModal, opened by tapping the row.
 */
const PairCard = ({ pair, data, onPress, onLongPress }) => {
  const analysis = data?.analysis;
  const view = explain(analysis);
  const shortMark = String(view.mark || '').split(' · ')[0]; // "↑ LONG" | "↓ SHORT" | "— ESPERAR"

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      activeOpacity={0.75}
    >
      <View style={styles.top}>
        <Text style={styles.name}>{pairName(pair)}</Text>
        {!!analysis && <Text style={[styles.mark, { color: view.markColor }]}>{shortMark}</Text>}
        <Text style={styles.price}>{data?.price != null ? fmtPrice(data.price) : '…'}</Text>
      </View>

      {!data ? (
        <Text style={[type.small, { marginTop: space.sm }]}>Cargando el análisis…</Text>
      ) : !analysis ? (
        <Text style={[type.small, { marginTop: space.sm }]}>Todavía no hay análisis para esta moneda.</Text>
      ) : (
        <>
          <Chip label={view.headline} color={view.color} solid style={styles.verdict} />
          <Text style={[type.bodyDim, { marginTop: space.sm }]} numberOfLines={2}>{view.action}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md,
    marginBottom: space.sm, borderWidth: 1, borderColor: colors.border,
  },
  top: { flexDirection: 'row', alignItems: 'baseline' },
  name: { color: colors.text, fontSize: 19, fontWeight: '700' },
  mark: { flex: 1, marginLeft: space.md, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  price: { ...type.number, fontSize: 17, marginLeft: 'auto', paddingLeft: space.md },
  verdict: { marginTop: space.sm, paddingVertical: 5, paddingHorizontal: 12 },
});

export default PairCard;

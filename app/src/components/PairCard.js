import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './ui';
import { colors, space, radius, type, scenarioOf, trendOf, DIRECTION, pairName, fmtPrice } from '../theme';

/**
 * Summary of one coin: what it costs, whether it is a good moment, and why in one sentence.
 * The full analysis lives in PairDetailModal, opened by tapping the card.
 */
const PairCard = ({ pair, data, onPress, onLongPress }) => {
  const analysis = data?.analysis;
  const scenario = scenarioOf(analysis?.scenario);
  const direction = DIRECTION[analysis?.direction_preference];
  const trend = trendOf(analysis?.context?.htf_bias);
  const reading = analysis?.unified_reading || analysis?.scenario_reason;

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
          <View style={styles.chips}>
            <Chip label={scenario.label} color={scenario.color} solid />
            {direction ? (
              <Chip label={`${direction.arrow} ${direction.label}`} color={direction.color} />
            ) : (
              <Chip label="Sin dirección clara" color={colors.textMuted} />
            )}
          </View>

          <Text style={[type.body, { marginTop: space.md }]} numberOfLines={3}>
            {reading || scenario.help}
          </Text>

          <View style={styles.footer}>
            <Text style={type.small}>
              Tendencia de fondo:{' '}
              <Text style={{ color: trend.color, fontWeight: '700' }}>{trend.arrow} {trend.label}</Text>
            </Text>
            <Text style={styles.more}>Ver análisis</Text>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border,
  },
  more: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});

export default PairCard;

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Chip, Button } from './ui';
import { colors, space, type } from '../theme';

/** Stands in for a position the free plan does not show. Tapping anywhere opens the Premium screen. */
const LockedPositionCard = ({ onPress }) => (
  <Card onPress={onPress}>
    <View style={styles.head}>
      <View style={styles.dim}>
        <Text style={styles.symbol}>•••</Text>
      </View>
      <Chip label="Solo Premium" color={colors.warn} style={{ alignSelf: 'center' }} />
    </View>
    <Text style={[type.bodyDim, { marginTop: space.sm, marginBottom: space.sm }]}>
      Con el plan gratis ves una operación. Premium muestra todas, con su riesgo y sus avisos.
    </Text>
    <Text style={[type.small, { color: colors.warn, marginBottom: space.md }]}>
      Esta operación sigue abierta en Binance con dinero real, aunque aquí no la veas.
    </Text>
    <Button label="Ver Premium" kind="secondary" onPress={onPress} />
  </Card>
);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  dim: { opacity: 0.4 },
  symbol: { color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 2 },
});

export default LockedPositionCard;

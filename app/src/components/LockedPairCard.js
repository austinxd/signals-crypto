import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const LockedPairCard = ({ pair, onPress }) => {
  const pairShort = pair?.replace('/USDT', '').replace(':USDT', '') || 'PAR';

  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={styles.blurOverlay}>
        <View style={styles.content}>
          <Text style={styles.pairName}>{pairShort}</Text>
          <View style={styles.fakePrice}>
            <Text style={styles.fakePriceText}>$••,•••</Text>
          </View>
        </View>
        <View style={styles.lockOverlay}>
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.lockText}>Premium</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  blurOverlay: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    position: 'relative',
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    opacity: 0.3,
  },
  pairName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  fakePrice: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  fakePriceText: {
    color: '#555',
    fontSize: 16,
    fontWeight: '600',
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  lockIcon: {
    fontSize: 20,
  },
  lockText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default LockedPairCard;

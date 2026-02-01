import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const LockedPositionCard = ({ onPress }) => {
  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={styles.blurOverlay}>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <View style={styles.fakePair}>
              <Text style={styles.fakePairText}>•••</Text>
            </View>
            <View style={styles.fakeSide}>
              <Text style={styles.fakeSideText}>••••</Text>
            </View>
          </View>
          <View style={styles.fakeValues}>
            <View style={styles.fakeValue}>
              <Text style={styles.fakeLabel}>Entrada</Text>
              <Text style={styles.fakeValueText}>$••,•••</Text>
            </View>
            <View style={styles.fakeValue}>
              <Text style={styles.fakeLabel}>PnL</Text>
              <Text style={styles.fakeValueText}>+•.••%</Text>
            </View>
          </View>
        </View>
        <View style={styles.lockOverlay}>
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.lockText}>Posicion bloqueada</Text>
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
    minHeight: 100,
  },
  content: {
    opacity: 0.3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  fakePair: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fakePairText: {
    color: '#555',
    fontSize: 18,
    fontWeight: 'bold',
  },
  fakeSide: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  fakeSideText: {
    color: '#555',
    fontSize: 12,
  },
  fakeValues: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fakeValue: {
    alignItems: 'flex-start',
  },
  fakeLabel: {
    color: '#444',
    fontSize: 11,
    marginBottom: 4,
  },
  fakeValueText: {
    color: '#555',
    fontSize: 14,
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

export default LockedPositionCard;

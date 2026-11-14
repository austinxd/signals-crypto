// Shared building blocks. Screens are assembled from these so the whole app looks and behaves the same.
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, radius, type, tint, MONEY } from '../theme';

/** Page frame: big title, optional subtitle and right-hand action, scrolling body with pull-to-refresh. */
export const Screen = ({ title, subtitle, right, money, children, refreshing = false, onRefresh, scroll = true, footer }) => {
  const insets = useSafeAreaInsets();
  const head = (
    <View style={[styles.screenHead, { paddingTop: insets.top + space.md }]}>
      <View style={{ flex: 1 }}>
        <Text style={type.title}>{title}</Text>
        {!!subtitle && <Text style={[type.bodyDim, { marginTop: 2 }]}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
  return (
    <View style={styles.screen}>
      {head}
      {!!money && <MoneyBand kind={money} />}
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.screenBody}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer}
    </View>
  );
};

/**
 * Fixed strip under a screen title saying whose money the figures below are. It does not scroll away.
 * kind: real | sim | demo | market (see MONEY in theme).
 */
export const MoneyBand = ({ kind, style }) => {
  const m = MONEY[kind];
  if (!m) return null;
  return (
    <View style={[styles.band, { backgroundColor: tint(m.color, 0.16), borderColor: tint(m.color, 0.5) }, style]}>
      <Text style={[styles.bandLabel, { color: m.color }]}>{m.label.toUpperCase()}</Text>
      <Text style={styles.bandText} numberOfLines={2}>{m.note}</Text>
    </View>
  );
};

/** Small tag for one card or line: "Simulado", "Dinero real"… */
export const MoneyTag = ({ kind, style }) => {
  const m = MONEY[kind];
  return m ? <Chip label={m.label} color={m.color} style={style} /> : null;
};

/** A question the reader can tap to read its answer. For explanations nobody needs twice. */
export const Help = ({ label, children, style }) => {
  const [open, setOpen] = useState(false);
  return (
    <View style={style}>
      <TouchableOpacity onPress={() => setOpen(!open)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.helpLabel}>{label} {open ? '▴' : '▾'}</Text>
      </TouchableOpacity>
      {open && (typeof children === 'string'
        ? <Text style={[type.bodyDim, { marginTop: space.xs }]}>{children}</Text>
        : <View style={{ marginTop: space.xs }}>{children}</View>)}
    </View>
  );
};

/** Header of a full-screen modal: title on the left, "Cerrar" on the right. */
export const ModalHeader = ({ title, subtitle, onClose, right }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.modalHead, { paddingTop: Math.max(insets.top, space.lg) }]}>
      <View style={{ flex: 1 }}>
        <Text style={type.heading} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={type.small} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
      {onClose && (
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.closeBtn}>
          <Text style={styles.closeText}>Cerrar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export const Card = ({ title, right, children, style, onPress }) => {
  const inner = (
    <>
      {(title || right) && (
        <View style={styles.cardHead}>
          <Text style={[type.heading, { flex: 1 }]}>{title}</Text>
          {right}
        </View>
      )}
      {children}
    </>
  );
  return onPress ? (
    <TouchableOpacity style={[styles.card, style]} onPress={onPress} activeOpacity={0.75}>{inner}</TouchableOpacity>
  ) : (
    <View style={[styles.card, style]}>{inner}</View>
  );
};

/** Small uppercase heading between groups of cards. */
export const SectionTitle = ({ children, right }) => (
  <View style={styles.sectionTitle}>
    <Text style={type.label}>{children}</Text>
    {right}
  </View>
);

/** Coloured tag. `solid` for the one status that matters most on a card; tinted otherwise. */
export const Chip = ({ label, color = colors.textDim, solid = false, style }) => (
  <View style={[styles.chip, { backgroundColor: solid ? color : tint(color) }, style]}>
    <Text style={[styles.chipText, { color: solid ? colors.onAccent : color }]} numberOfLines={1}>{label}</Text>
  </View>
);

const BUTTON_FILL = { primary: colors.accent, warn: colors.warn, danger: colors.danger };

/** kind: primary | warn | danger (filled) · secondary (outlined) · ghost (text only). */
export const Button = ({ label, onPress, kind = 'primary', disabled = false, loading = false, small = false, style }) => {
  const fill = BUTTON_FILL[kind];
  const textColor = fill ? colors.onAccent : kind === 'ghost' ? colors.accent : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.button,
        small && styles.buttonSmall,
        fill ? { backgroundColor: fill } : kind === 'secondary' ? styles.buttonOutline : null,
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: textColor }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

/** Pick one of a few options. options: [{ key, label }]. */
export const Segment = ({ options, value, onChange, disabled = false }) => (
  <View style={[styles.segment, disabled && { opacity: 0.5 }]}>
    {options.map((o) => {
      const on = value === o.key;
      return (
        <TouchableOpacity
          key={o.key}
          disabled={disabled}
          style={[styles.segmentItem, on && styles.segmentItemOn]}
          onPress={() => !on && onChange(o.key)}
        >
          <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>{o.label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

/** A number with its label on top. Put several in a <StatRow>. */
export const Stat = ({ label, value, color, hint }) => (
  <View style={{ flex: 1 }}>
    <Text style={type.small}>{label}</Text>
    <Text style={[type.number, color && { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    {!!hint && <Text style={type.small}>{hint}</Text>}
  </View>
);
export const StatRow = ({ children, style }) => <View style={[styles.statRow, style]}>{children}</View>;

/** "Label ........ value" line, with an optional plain-language explanation underneath. */
export const Row = ({ label, value, color, help, first = false, children }) => (
  <View style={[styles.row, first && { borderTopWidth: 0 }]}>
    <View style={styles.rowLine}>
      <Text style={[type.bodyDim, { flex: 1 }]}>{label}</Text>
      {children || <Text style={[styles.rowValue, color && { color }]}>{value}</Text>}
    </View>
    {!!help && <Text style={[type.small, { marginTop: 2 }]}>{help}</Text>}
  </View>
);

/** Tinted box for a message the reader should not miss. tone: info | warn | danger | good. */
export const Notice = ({ tone = 'info', title, children, style }) => {
  const c = { info: colors.info, warn: colors.warn, danger: colors.danger, good: colors.accent }[tone] || colors.info;
  return (
    <View style={[styles.notice, { backgroundColor: tint(c, 0.1), borderLeftColor: c }, style]}>
      {!!title && <Text style={[styles.noticeTitle, { color: c }]}>{title}</Text>}
      {typeof children === 'string' ? <Text style={type.bodyDim}>{children}</Text> : children}
    </View>
  );
};

/** Section that starts closed: for detail most people do not need. */
export const Collapsible = ({ title, hint, right, rightColor, plain = false, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={plain ? styles.collapsePlain : styles.card}>
      <TouchableOpacity style={styles.collapseHead} onPress={() => setOpen(!open)} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={plain ? styles.collapsePlainTitle : type.heading}>{title}</Text>
          {!!hint && !open && <Text style={type.small}>{hint}</Text>}
        </View>
        {right != null && <Text style={[styles.rowValue, rightColor && { color: rightColor }]}>{right}</Text>}
        <Text style={styles.collapseToggle}>{open ? 'Ocultar' : 'Ver'}</Text>
      </TouchableOpacity>
      {open && <View style={{ marginTop: space.md }}>{children}</View>}
    </View>
  );
};

/** What to show when there is nothing to show, with the next step as a button. */
export const Empty = ({ title, hint, actionLabel, onAction }) => (
  <View style={styles.empty}>
    <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
    {!!hint && <Text style={[type.bodyDim, { textAlign: 'center', marginTop: space.sm }]}>{hint}</Text>}
    {!!actionLabel && <Button label={actionLabel} onPress={onAction} style={{ marginTop: space.lg, alignSelf: 'center', paddingHorizontal: space.xl }} />}
  </View>
);

export const Loading = ({ label = 'Cargando…' }) => (
  <View style={styles.empty}>
    <ActivityIndicator color={colors.accent} />
    <Text style={[type.bodyDim, { marginTop: space.md }]}>{label}</Text>
  </View>
);

export const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenHead: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.lg, paddingBottom: space.md,
  },
  screenBody: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: 48 },
  modalHead: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.md,
    backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeBtn: { marginLeft: space.md },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  sectionTitle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: space.md, marginBottom: space.sm, paddingHorizontal: space.xs,
  },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  chipText: { fontSize: 12, fontWeight: '700' },
  button: {
    minHeight: 48, paddingHorizontal: space.lg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  buttonSmall: { minHeight: 38, paddingHorizontal: space.md },
  buttonOutline: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  buttonText: { fontSize: 16, fontWeight: '700' },
  segment: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.border },
  segmentItem: { flex: 1, minHeight: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentItemOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.textDim, fontWeight: '600', fontSize: 14 },
  segmentTextOn: { color: colors.onAccent },
  statRow: { flexDirection: 'row', gap: space.md },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  rowLine: { flexDirection: 'row', alignItems: 'center' },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '600', marginLeft: space.md, flexShrink: 1, textAlign: 'right' },
  notice: { borderLeftWidth: 3, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  noticeTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  band: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm,
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.md, borderWidth: 1,
  },
  bandLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  bandText: { color: colors.textDim, fontSize: 12, flex: 1 },
  helpLabel: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  collapsePlain: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  collapsePlainTitle: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  collapseHead: { flexDirection: 'row', alignItems: 'center' },
  collapseToggle: { color: colors.accent, fontSize: 14, fontWeight: '600', marginLeft: space.md },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: space.xl },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
});

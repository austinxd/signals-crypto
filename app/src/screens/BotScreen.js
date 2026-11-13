import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getBotReport,
  setBotPaused,
  setBotMode,
  setBotAi,
  answerBotProposal,
  closeBotPosition,
} from '../services/api';

const GREEN = '#00d4aa';
const RED = '#ff4757';
const AMBER = '#ffa502';

const STANCE = {
  normal: { label: 'Normal', color: GREEN, hint: 'Entradas a tamaño completo' },
  caution: { label: 'Cautela', color: AMBER, hint: 'Entradas a mitad de tamaño' },
  no_trade: { label: 'No operar', color: RED, hint: 'Sin entradas nuevas' },
};
const AI_MODES = [
  { key: 'off', label: 'Apagada' },
  { key: 'shadow', label: 'Sombra' },
  { key: 'reduce', label: 'Reduce' },
];
const AI_HINT = {
  off: 'No se consulta a ningún modelo.',
  shadow: 'La IA opina y se registra, pero no cambia ninguna operación.',
  reduce: 'La IA puede reducir o descartar entradas. Nunca abre ni amplía.',
};
const VERDICT = {
  full: 'entera', half: 'media', skip: 'descartar',
  normal: 'normal', caution: 'cautela', no_trade: 'no operar',
};
const KIND = { daily: 'Diaria', event: 'Evento', signal: 'Señal' };
const ACTION = {
  ENTER: 'Entrada', EXIT: 'Salida', SKIP: 'Omitida', REJECT: 'Rechazada',
  PROPOSE: 'Propuesta', MOVE_SL: 'Stop movido', ERROR: 'Error',
};
const EXIT_REASON = { stop: 'stop', target: 'objetivo', manual: 'manual', time: 'tiempo' };

const num = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
const signed = (x, d = 2) => (x == null ? '-' : `${x >= 0 ? '+' : ''}${Number(x).toFixed(d)}`);
const price = (x) => (x == null ? '-' : Number(x) >= 100 ? Number(x).toFixed(1) : Number(x).toPrecision(5));
const sideLabel = (s) => (s > 0 ? 'LONG' : 'SHORT');
const sideColor = (s) => (s > 0 ? GREEN : RED);

function ago(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 90) return 'ahora';
  if (s < 5400) return `hace ${Math.round(s / 60)} min`;
  if (s < 172800) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

function until(ts) {
  const s = ts - Date.now() / 1000;
  if (s <= 0) return 'ya';
  return s < 5400 ? `en ${Math.round(s / 60)} min` : `en ${Math.round(s / 3600)} h`;
}

const Card = ({ title, right, children }) => (
  <View style={styles.card}>
    {(title || right) && (
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {right}
      </View>
    )}
    {children}
  </View>
);

const Stat = ({ label, value, color }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, color && { color }]}>{value}</Text>
  </View>
);

const Segment = ({ options, value, onChange, disabled }) => (
  <View style={styles.segment}>
    {options.map((o) => (
      <TouchableOpacity
        key={o.key}
        disabled={disabled}
        style={[styles.segmentItem, value === o.key && styles.segmentItemActive]}
        onPress={() => value !== o.key && onChange(o.key)}
      >
        <Text style={[styles.segmentText, value === o.key && styles.segmentTextActive]}>{o.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const BotScreen = () => {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await getBotReport());
      setError(null);
    } catch (err) {
      setError('No se pudo leer el bot');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      Alert.alert('No se pudo aplicar', err.message || 'Error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = (title, message, label, fn, destructive = false) =>
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: label, style: destructive ? 'destructive' : 'default', onPress: () => run(fn) },
    ]);

  const body = () => {
    if (error && !report) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      );
    }
    if (!report) return null;

    const s = report.status || {};
    const a = report.account || {};
    const ai = report.ai || {};
    const stanceInfo = ai.stance || null;
    const stanceFresh = stanceInfo && Date.now() / 1000 - stanceInfo.ts < 26 * 3600;
    const stance = STANCE[stanceFresh ? stanceInfo.stance : 'normal'];
    const started = s.mode != null;
    const perf = report.performance || {};
    const aiMode = ai.mode || 'off';
    const paper = s.broker === 'paper';
    const canControl = report.can_control === true;
    const locked = busy || !canControl;
    const dim = !canControl && { opacity: 0.45 };

    return (
      <>
        {!canControl && (
          <Text style={styles.banner}>
            Modo lectura: ves todo lo que hace el bot. Solo el administrador puede pausarlo o cambiar sus ajustes.
          </Text>
        )}
        <Card
          title="Motor"
          right={
            <View style={[styles.pill, { backgroundColor: s.running ? GREEN : RED }]}>
              <Text style={styles.pillText}>{s.running ? 'EN MARCHA' : 'PARADO'}</Text>
            </View>
          }
        >
          {!started ? (
            <Text style={styles.muted}>El bot todavía no se ha arrancado en el servidor.</Text>
          ) : (
            <>
              <Text style={styles.muted}>
                {paper ? 'Dinero simulado (paper)' : s.broker === 'demo' ? 'Cuenta demo de Binance' : 'DINERO REAL'}
                {' · '}{s.strategy} · {(s.symbols || []).map((x) => x.replace('USDT', '')).join(', ')}
              </Text>
              {!s.running && (
                <Text style={[styles.note, { color: RED }]}>
                  Sin latido desde {ago(Date.now() / 1000 - (s.heartbeat_age_s || 0))}. Revisa el servicio en el servidor.
                </Text>
              )}
              <View style={styles.statsRow}>
                <Stat label="Capital" value={num(a.equity)} />
                <Stat label="Hoy" value={`${signed(a.day_pnl_pct)}%`} color={a.day_pnl_pct >= 0 ? GREEN : RED} />
                <Stat label="Caída" value={`${num(a.drawdown_pct, 1)}%`} color={a.drawdown_pct > 5 ? AMBER : undefined} />
              </View>

              {s.paused && (
                <Text style={[styles.note, { color: AMBER }]}>
                  En pausa: {s.pause_reason || 'manual'}. No abre operaciones nuevas; las abiertas mantienen su stop.
                </Text>
              )}
              <TouchableOpacity
                disabled={locked}
                style={[styles.button, { backgroundColor: s.paused ? GREEN : AMBER }, dim]}
                onPress={() =>
                  s.paused
                    ? confirm('Reanudar el bot', 'Volverá a abrir operaciones cuando haya señal.', 'Reanudar',
                        () => setBotPaused(false))
                    : confirm('Pausar el bot', 'No abrirá operaciones nuevas. Las abiertas siguen con su stop.',
                        'Pausar', () => setBotPaused(true))
                }
              >
                <Text style={styles.buttonText}>{s.paused ? 'Reanudar' : 'Pausar entradas'}</Text>
              </TouchableOpacity>

              <Text style={styles.label}>Quién decide las entradas</Text>
              <Segment
                disabled={locked}
                value={s.mode}
                options={[{ key: 'auto', label: 'Automático' }, { key: 'manual', label: 'Manual' }]}
                onChange={(m) => run(() => setBotMode(m))}
              />
              <Text style={styles.hint}>
                {s.mode === 'auto'
                  ? 'El bot abre las operaciones por su cuenta.'
                  : 'El bot propone y tú apruebas cada operación aquí.'}
              </Text>
            </>
          )}
        </Card>

        {(report.pending_proposals || []).length > 0 && (
          <Card title="Propuestas pendientes">
            {report.pending_proposals.map((p) => (
              <View key={p.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>
                    {p.symbol} <Text style={{ color: sideColor(p.side) }}>{sideLabel(p.side)}</Text>
                  </Text>
                  <Text style={styles.muted}>caduca {until(p.expires_at)}</Text>
                </View>
                <Text style={styles.muted}>ref {price(p.ref_price)} · stop {price(p.sl)}</Text>
                <View style={styles.rowButtons}>
                  <TouchableOpacity
                    disabled={locked}
                    style={[styles.smallButton, { backgroundColor: GREEN }, dim]}
                    onPress={() => confirm('Aprobar', `${sideLabel(p.side)} ${p.symbol}. El motor de riesgo la revisa de nuevo.`,
                      'Aprobar', () => answerBotProposal(p.id, 'approve'))}
                  >
                    <Text style={styles.buttonText}>Aprobar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={locked}
                    style={[styles.smallButton, styles.ghost, dim]}
                    onPress={() => run(() => answerBotProposal(p.id, 'reject'))}
                  >
                    <Text style={styles.ghostText}>Rechazar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </Card>
        )}

        <Card title={`Operaciones abiertas (${(report.open_trades || []).length})`}>
          {(report.open_trades || []).length === 0 ? (
            <Text style={styles.muted}>Ninguna. El bot espera una señal de la estrategia.</Text>
          ) : (
            report.open_trades.map((t) => (
              <View key={t.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>
                    {t.symbol} <Text style={{ color: sideColor(t.side) }}>{sideLabel(t.side)}</Text>
                  </Text>
                  <Text style={[styles.rowTitle, { color: t.open_pnl >= 0 ? GREEN : RED }]}>
                    {signed(t.open_pnl)} ({signed(t.open_r)}R)
                  </Text>
                </View>
                <Text style={styles.muted}>
                  entrada {price(t.entry)} · ahora {price(t.price)} · stop {price(t.sl)} · {ago(t.entry_ts)}
                </Text>
                <TouchableOpacity
                  disabled={locked}
                  style={[styles.smallButton, styles.ghost, { alignSelf: 'flex-start', marginTop: 8 }, dim]}
                  onPress={() => confirm('Cerrar posición', `Se cerrará ${t.symbol} a mercado.`, 'Cerrar',
                    () => closeBotPosition(t.symbol), true)}
                >
                  <Text style={[styles.ghostText, { color: RED }]}>Cerrar a mercado</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </Card>

        <Card
          title="Mesa de IA"
          right={
            <View style={[styles.pill, { backgroundColor: aiMode === 'off' ? '#555' : stance.color }]}>
              <Text style={styles.pillText}>{aiMode === 'off' ? 'APAGADA' : stance.label.toUpperCase()}</Text>
            </View>
          }
        >
          {aiMode !== 'off' && (
            stanceFresh ? (
              <>
                <Text style={styles.text}>{stanceInfo.reason}</Text>
                {(stanceInfo.key_facts || []).map((f, i) => (
                  <Text key={i} style={styles.fact}>• {f}</Text>
                ))}
                <Text style={styles.hint}>
                  {stance.hint}{aiMode === 'shadow' ? ' (solo si la IA tuviera autoridad)' : ''} · {stanceInfo.model} · {ago(stanceInfo.ts)}
                </Text>
              </>
            ) : (
              <Text style={styles.muted}>Sin revisión vigente. La próxima es la diaria.</Text>
            )
          )}
          <Text style={styles.label}>Autoridad de la IA</Text>
          <Segment
            disabled={locked}
            value={aiMode}
            options={AI_MODES}
            onChange={(m) =>
              m === 'reduce'
                ? confirm('Dar autoridad a la IA',
                    'Podrá reducir o descartar entradas. Todavía no ha demostrado que acierte: lo recomendado es dejarla en sombra.',
                    'Dar autoridad', () => setBotAi(m), true)
                : run(() => setBotAi(m))
            }
          />
          <Text style={styles.hint}>{AI_HINT[aiMode]}</Text>
          <Text style={styles.hint}>Gasto en modelos, 30 días: {num(ai.cost_usd_30d)} USD</Text>
        </Card>

        {(ai.recent_calls || []).length > 0 && (
          <Card title="Últimas respuestas de los modelos">
            {ai.recent_calls.map((c) => (
              <View key={c.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>
                    {c.model}{c.role === 'primary' ? ' ★' : ''}
                  </Text>
                  <Text style={[styles.rowTitle, { color: c.error ? RED : '#fff' }]}>
                    {c.error ? 'error' : VERDICT[c.verdict] || c.verdict}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  {KIND[c.kind] || c.kind}{c.symbol ? ` ${c.symbol}` : ''} · {ago(c.ts)}{c.applied ? ' · aplicada' : ''}
                </Text>
                <Text style={styles.small} numberOfLines={c.error ? 2 : 6}>
                  {c.error || (c.answer && c.answer.reason) || ''}
                </Text>
              </View>
            ))}
            <Text style={styles.hint}>★ modelo principal. Los demás responden en sombra para compararlos.</Text>
          </Card>
        )}

        <Card title="Resultados (operaciones cerradas)">
          {[['Todo', perf.all], ['30 días', perf.last_30d], ['7 días', perf.last_7d]].map(([label, st]) => (
            <View key={label} style={styles.perfRow}>
              <Text style={styles.perfLabel}>{label}</Text>
              {st && st.trades ? (
                <Text style={styles.text}>
                  {st.trades} ops · <Text style={{ color: st.pnl >= 0 ? GREEN : RED }}>{signed(st.pnl)}</Text>
                  {' · '}acierto {num(st.win_rate_pct, 0)}% · {signed(st.avg_r)}R
                </Text>
              ) : (
                <Text style={styles.muted}>sin operaciones</Text>
              )}
            </View>
          ))}
          {(report.recent_trades || []).map((t) => (
            <View key={t.id} style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle}>
                  {t.symbol} <Text style={{ color: sideColor(t.side) }}>{sideLabel(t.side)}</Text>
                </Text>
                <Text style={[styles.rowTitle, { color: t.pnl >= 0 ? GREEN : RED }]}>
                  {signed(t.pnl)} ({signed(t.r)}R)
                </Text>
              </View>
              <Text style={styles.muted}>
                {price(t.entry)} → {price(t.exit)} · {EXIT_REASON[t.exit_reason] || t.exit_reason} · {ago(t.exit_ts)}
              </Text>
            </View>
          ))}
        </Card>

        {(report.recent_decisions || []).length > 0 && (
          <Card title="Decisiones recientes">
            {report.recent_decisions.map((d) => (
              <View key={d.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>
                    {ACTION[d.action] || d.action} {d.symbol}{' '}
                    <Text style={{ color: sideColor(d.side) }}>{sideLabel(d.side)}</Text>
                  </Text>
                  <Text style={styles.muted}>{ago(d.ts)}</Text>
                </View>
                <Text style={styles.small} numberOfLines={3}>{d.reason}</Text>
              </View>
            ))}
          </Card>
        )}

        {(report.recent_events || []).length > 0 && (
          <Card title="Eventos">
            {report.recent_events.slice(0, 8).map((e) => (
              <Text key={e.id} style={[styles.small, e.level !== 'info' && { color: e.level === 'error' ? RED : AMBER }]}
                numberOfLines={3}>
                {ago(e.ts)} · {e.message}
              </Text>
            ))}
          </Card>
        )}

        {error && <Text style={[styles.hint, { textAlign: 'center' }]}>Sin conexión; mostrando lo último recibido.</Text>}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Bot</Text>
          <Text style={styles.muted}>
            {!report ? '' : report.can_control ? 'Administrador' : 'Solo lectura'}
          </Text>
        </View>
        {body()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a14' },
  content: { padding: 16, paddingBottom: 100 },
  header: {
    paddingTop: 44, paddingBottom: 16, paddingHorizontal: 4,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  card: { backgroundColor: '#1e1e2e', borderRadius: 14, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  pillText: { color: '#0a0a14', fontSize: 11, fontWeight: '800' },
  statsRow: { flexDirection: 'row', marginTop: 14, marginBottom: 6 },
  stat: { flex: 1 },
  statLabel: { color: '#888', fontSize: 12 },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  text: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  fact: { color: '#bbb', fontSize: 13, lineHeight: 19, marginTop: 4 },
  muted: { color: '#888', fontSize: 13 },
  small: { color: '#aaa', fontSize: 12, lineHeight: 17, marginTop: 4 },
  hint: { color: '#666', fontSize: 12, marginTop: 8, lineHeight: 17 },
  note: { fontSize: 13, marginTop: 10, lineHeight: 18 },
  label: { color: '#888', fontSize: 12, marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  button: { marginTop: 14, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#0a0a14', fontWeight: '700', fontSize: 15 },
  smallButton: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  ghost: { borderWidth: 1, borderColor: '#444' },
  ghostText: { color: '#ccc', fontWeight: '600', fontSize: 14 },
  banner: {
    color: '#bbb', fontSize: 13, lineHeight: 18, backgroundColor: '#1e1e2e', borderRadius: 12,
    borderLeftWidth: 3, borderLeftColor: AMBER, padding: 12, marginBottom: 14,
  },
  segment: { flexDirection: 'row', backgroundColor: '#12121c', borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentItemActive: { backgroundColor: GREEN },
  segmentText: { color: '#888', fontWeight: '600', fontSize: 14 },
  segmentTextActive: { color: '#0a0a14' },
  row: { borderTopWidth: 1, borderTopColor: '#2a2a3c', paddingTop: 10, marginTop: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  rowButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  perfRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  perfLabel: { color: '#888', fontSize: 13, width: 64 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#888', fontSize: 16, textAlign: 'center' },
});

export default BotScreen;

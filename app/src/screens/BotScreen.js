import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getBotReport,
  setBotPaused,
  setBotMode,
  setBotAi,
  answerBotProposal,
  closeBotPosition,
} from '../services/api';
import {
  Screen, Card, SectionTitle, Chip, Button, Segment, Stat, StatRow, Row, Notice, Collapsible, Empty, Loading,
} from '../components/ui';
import {
  colors, space, type, GLOSSARY, DIRECTION, pairName, fmtNum, fmtSigned, pnlColor, timeAgo,
} from '../theme';

const STANCE = {
  normal: { label: 'Normal', color: colors.accent, hint: 'No ve motivos para frenar: entradas a tamaño completo.' },
  caution: { label: 'Cautela', color: colors.warn, hint: 'Ve riesgo: recomienda entrar con la mitad del tamaño.' },
  no_trade: { label: 'No operar', color: colors.danger, hint: 'Recomienda no abrir operaciones nuevas.' },
};
const AI_MODES = [
  { key: 'off', label: 'Apagada' },
  { key: 'shadow', label: 'Solo opina' },
  { key: 'reduce', label: 'Puede frenar' },
];
const AI_HINT = {
  off: 'No se consulta a ningún modelo de IA.',
  shadow: 'La IA opina y queda registrado, pero no cambia ninguna operación. Sirve para medir si acierta.',
  reduce: 'La IA puede reducir o descartar una entrada. Nunca abre, amplía ni cierra operaciones.',
};
const VERDICT = {
  full: 'Entrar completo', half: 'Entrar a la mitad', skip: 'No entrar',
  normal: 'Normal', caution: 'Cautela', no_trade: 'No operar',
};
const KIND = { daily: 'Revisión diaria', event: 'Revisión por evento', signal: 'Señal' };
const ACTION = {
  ENTER: 'Abrió', EXIT: 'Cerró', SKIP: 'Dejó pasar', REJECT: 'Rechazada por riesgo',
  PROPOSE: 'Propuso', MOVE_SL: 'Movió el stop', ERROR: 'Error',
};
const EXIT_REASON = { stop: 'saltó el stop', target: 'llegó al objetivo', manual: 'cierre manual', time: 'por tiempo' };
const BROKER = {
  paper: { label: 'Dinero simulado', color: colors.info, text: 'Opera con dinero simulado: nada de esto es dinero real.' },
  demo: { label: 'Cuenta demo', color: colors.info, text: 'Opera en la cuenta demo de Binance: no es dinero real.' },
  live: { label: 'Dinero real', color: colors.danger, text: 'Opera con dinero real.' },
};

const price = (x) => (x == null ? '-' : Number(x) >= 100 ? Number(x).toFixed(1) : Number(x).toPrecision(5));
const sideOf = (s) => (s > 0 ? DIRECTION.long : DIRECTION.short);
const until = (ts) => {
  const s = ts - Date.now() / 1000;
  if (s <= 0) return 'ya';
  return s < 5400 ? `en ${Math.round(s / 60)} min` : `en ${Math.round(s / 3600)} h`;
};

const Item = ({ title, right, rightColor, sub, children, first }) => (
  <View style={[styles.item, first && { borderTopWidth: 0, paddingTop: 0, marginTop: 0 }]}>
    <View style={styles.itemTop}>
      <View style={styles.itemTitle}>{typeof title === 'string' ? <Text style={styles.itemTitleText}>{title}</Text> : title}</View>
      {!!right && <Text style={[styles.itemRight, rightColor && { color: rightColor }]}>{right}</Text>}
    </View>
    {!!sub && <Text style={[type.small, { marginTop: 2 }]}>{sub}</Text>}
    {children}
  </View>
);

const Trade = ({ symbol, side }) => (
  <View style={styles.tradeTitle}>
    <Text style={styles.itemTitleText}>{pairName(symbol)}</Text>
    <Chip label={sideOf(side).short} color={sideOf(side).color} style={{ marginLeft: space.sm }} />
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
    if (!report) {
      return error
        ? <Empty title={error} hint="Comprueba tu conexión. Si sigue igual, puede que el servidor esté reiniciándose." actionLabel="Reintentar" onAction={load} />
        : <Loading label="Leyendo el bot…" />;
    }

    const s = report.status || {};
    const a = report.account || {};
    const ai = report.ai || {};
    const perf = report.performance || {};
    const open = report.open_trades || [];
    const proposals = report.pending_proposals || [];
    const closed = report.recent_trades || [];
    const decisions = report.recent_decisions || [];
    const events = report.recent_events || [];
    const calls = ai.recent_calls || [];

    const started = s.mode != null;
    const canControl = report.can_control === true;
    const locked = busy || !canControl;
    const broker = BROKER[s.broker] || BROKER.live;
    const aiMode = ai.mode || 'off';
    const stanceInfo = ai.stance || null;
    const stanceFresh = !!stanceInfo && Date.now() / 1000 - stanceInfo.ts < 26 * 3600;
    const stance = STANCE[stanceFresh ? stanceInfo.stance : 'normal'] || STANCE.normal;

    const state = !started
      ? { label: 'Sin arrancar', color: colors.textMuted }
      : !s.running
        ? { label: 'Parado', color: colors.danger }
        : s.paused
          ? { label: 'En pausa', color: colors.warn }
          : { label: 'En marcha', color: colors.accent };

    const summary = !started
      ? 'El bot todavía no se ha arrancado en el servidor.'
      : [
          !s.running
            ? 'El bot no responde: no está vigilando el mercado.'
            : s.paused
              ? 'El bot está en pausa: no abre operaciones nuevas, pero las abiertas mantienen su stop.'
              : s.mode === 'auto'
                ? 'El bot vigila el mercado y abre operaciones por su cuenta cuando su estrategia da señal.'
                : 'El bot vigila el mercado y propone operaciones; no abre nada sin aprobación.',
          broker.text,
        ].join(' ');

    return (
      <>
        <Card>
          <View style={styles.stateRow}>
            <Chip label={state.label.toUpperCase()} color={state.color} solid />
            {started && <Chip label={broker.label} color={broker.color} style={{ marginLeft: space.sm }} />}
          </View>
          <Text style={[type.body, { marginTop: space.md }]}>{summary}</Text>
          {started && (
            <>
              <Text style={[type.small, { marginTop: space.sm }]}>
                Sigue: {(s.symbols || []).map(pairName).join(', ') || '-'}
                {!s.running && s.heartbeat_age_s != null
                  ? ` · última señal de vida ${timeAgo(Date.now() / 1000 - s.heartbeat_age_s)}` : ''}
              </Text>
              <StatRow style={{ marginTop: space.lg }}>
                <Stat label="Capital" value={fmtNum(a.equity)} hint="USDT" />
                <Stat label="Hoy" value={`${fmtSigned(a.day_pnl_pct)}%`} color={pnlColor(a.day_pnl_pct)} />
                <Stat
                  label="Caída"
                  value={`${fmtNum(a.drawdown_pct, 1)}%`}
                  color={a.drawdown_pct > 5 ? colors.warn : undefined}
                  hint="desde el máximo"
                />
              </StatRow>
            </>
          )}
          {started && s.paused && !!s.pause_reason && (
            <Text style={[type.small, { marginTop: space.md, color: colors.warn }]}>Motivo de la pausa: {s.pause_reason}</Text>
          )}
        </Card>

        {proposals.length > 0 && (
          <>
            <SectionTitle>Esperan respuesta</SectionTitle>
            <Card>
              {proposals.map((p, i) => (
                <Item
                  key={p.id}
                  first={i === 0}
                  title={<Trade symbol={p.symbol} side={p.side} />}
                  right={`caduca ${until(p.expires_at)}`}
                  sub={`Precio de referencia ${price(p.ref_price)} · stop en ${price(p.sl)}`}
                >
                  <View style={styles.buttons}>
                    <Button
                      small label="Aprobar" disabled={locked} style={{ flex: 1 }}
                      onPress={() => confirm('Aprobar operación',
                        `${sideOf(p.side).short} en ${pairName(p.symbol)}. El control de riesgo la revisa otra vez antes de abrirla.`,
                        'Aprobar', () => answerBotProposal(p.id, 'approve'))}
                    />
                    <Button
                      small kind="secondary" label="Rechazar" disabled={locked} style={{ flex: 1 }}
                      onPress={() => run(() => answerBotProposal(p.id, 'reject'))}
                    />
                  </View>
                </Item>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>Operaciones abiertas</SectionTitle>
        <Card>
          {open.length === 0 ? (
            <Text style={type.bodyDim}>Ninguna ahora mismo. El bot espera a que su estrategia dé una señal.</Text>
          ) : (
            open.map((t, i) => (
              <Item
                key={t.id}
                first={i === 0}
                title={<Trade symbol={t.symbol} side={t.side} />}
                right={`${fmtSigned(t.open_pnl)} USDT`}
                rightColor={pnlColor(t.open_pnl)}
                sub={`Entró a ${price(t.entry)} ${timeAgo(t.entry_ts)} · ahora ${price(t.price)} · stop en ${price(t.sl)}`}
              >
                <Button
                  small kind="secondary" label="Cerrar ahora" disabled={locked}
                  style={{ alignSelf: 'flex-start', marginTop: space.sm }}
                  onPress={() => confirm('Cerrar operación',
                    `Se cerrará ${pairName(t.symbol)} al precio de mercado.`, 'Cerrar', () => closeBotPosition(t.symbol), true)}
                />
              </Item>
            ))
          )}
        </Card>

        <SectionTitle>Qué opina la IA</SectionTitle>
        <Card>
          {aiMode === 'off' ? (
            <Text style={type.bodyDim}>La IA está apagada. El bot decide solo con sus reglas.</Text>
          ) : stanceFresh ? (
            <>
              <Chip label={stance.label.toUpperCase()} color={stance.color} solid />
              <Text style={[type.small, { marginTop: space.sm }]}>{stance.hint}</Text>
              {!!stanceInfo.reason && <Text style={[type.body, { marginTop: space.md }]}>{stanceInfo.reason}</Text>}
              {(stanceInfo.key_facts || []).map((f, i) => (
                <Text key={i} style={[type.bodyDim, { marginTop: space.xs }]}>• {f}</Text>
              ))}
              <Text style={[type.small, { marginTop: space.md }]}>
                {aiMode === 'shadow' ? 'Solo es una opinión: hoy no cambia lo que hace el bot. ' : 'Esta opinión se aplica a las entradas nuevas. '}
                Revisado {timeAgo(stanceInfo.ts)}.
              </Text>
            </>
          ) : (
            <Text style={type.bodyDim}>Aún no hay una revisión vigente. La IA revisa el mercado una vez al día y cuando pasa algo importante.</Text>
          )}
        </Card>

        <SectionTitle>Resultados</SectionTitle>
        <Card>
          {[['Desde el inicio', perf.all], ['Últimos 30 días', perf.last_30d], ['Últimos 7 días', perf.last_7d]].map(([label, st], i) => (
            <Row
              key={label}
              first={i === 0}
              label={label}
              value={st && st.trades ? `${fmtSigned(st.pnl)} USDT` : 'Sin operaciones'}
              color={st && st.trades ? pnlColor(st.pnl) : colors.textMuted}
              help={st && st.trades
                ? `${st.trades} operaciones · acierta ${fmtNum(st.win_rate_pct, 0)}% · media ${fmtSigned(st.avg_r)}R`
                : undefined}
            />
          ))}
          <Text style={[type.small, { marginTop: space.sm }]}>{GLOSSARY.r}</Text>
        </Card>

        <SectionTitle>Controles</SectionTitle>
        {!canControl && (
          <Notice tone="warn" title="Solo lectura">
            Puedes ver todo lo que hace el bot. Solo el administrador puede cambiar estos ajustes.
          </Notice>
        )}
        <Card>
          <Text style={type.heading}>Entradas nuevas</Text>
          <Text style={[type.small, { marginTop: 2, marginBottom: space.md }]}>
            Pausar no cierra nada: solo impide abrir operaciones nuevas.
          </Text>
          <Button
            kind={s.paused ? 'primary' : 'warn'}
            label={s.paused ? 'Reanudar el bot' : 'Pausar el bot'}
            disabled={locked || !started}
            onPress={() =>
              s.paused
                ? confirm('Reanudar el bot', 'Volverá a abrir operaciones cuando haya señal.', 'Reanudar', () => setBotPaused(false))
                : confirm('Pausar el bot', 'No abrirá operaciones nuevas. Las abiertas siguen con su stop.', 'Pausar', () => setBotPaused(true))
            }
          />

          <View style={styles.control}>
            <Text style={type.heading}>Quién aprueba las operaciones</Text>
            <View style={{ marginTop: space.md }}>
              <Segment
                disabled={locked || !started}
                value={s.mode}
                options={[{ key: 'auto', label: 'El bot solo' }, { key: 'manual', label: 'Una a una' }]}
                onChange={(m) => run(() => setBotMode(m))}
              />
            </View>
            <Text style={[type.small, { marginTop: space.sm }]}>
              {s.mode === 'manual'
                ? 'El bot propone y espera a que el administrador apruebe cada operación en esta pantalla.'
                : 'El bot abre las operaciones por su cuenta, siempre dentro de los límites de riesgo.'}
            </Text>
          </View>

          <View style={styles.control}>
            <Text style={type.heading}>Cuánto manda la IA</Text>
            <View style={{ marginTop: space.md }}>
              <Segment
                disabled={locked}
                value={aiMode}
                options={AI_MODES}
                onChange={(m) =>
                  m === 'reduce'
                    ? confirm('Dejar que la IA frene entradas',
                        'Podrá reducir o descartar entradas. Todavía no ha demostrado que acierte: lo recomendado es dejarla en “Solo opina”.',
                        'Dar autoridad', () => setBotAi(m), true)
                    : run(() => setBotAi(m))
                }
              />
            </View>
            <Text style={[type.small, { marginTop: space.sm }]}>{AI_HINT[aiMode]}</Text>
            <Text style={[type.small, { marginTop: space.xs }]}>Gasto en IA, últimos 30 días: {fmtNum(ai.cost_usd_30d)} USD</Text>
          </View>
        </Card>

        <SectionTitle>Historial</SectionTitle>
        <Collapsible title="Operaciones cerradas" hint={closed.length ? `${closed.length} más recientes` : 'Todavía ninguna'}>
          {closed.length === 0 ? (
            <Text style={type.bodyDim}>El bot aún no ha cerrado ninguna operación.</Text>
          ) : closed.map((t, i) => (
            <Item
              key={t.id}
              first={i === 0}
              title={<Trade symbol={t.symbol} side={t.side} />}
              right={`${fmtSigned(t.pnl)} USDT`}
              rightColor={pnlColor(t.pnl)}
              sub={`${price(t.entry)} → ${price(t.exit)} · ${EXIT_REASON[t.exit_reason] || t.exit_reason || ''} · ${fmtSigned(t.r)}R · ${timeAgo(t.exit_ts)}`}
            />
          ))}
        </Collapsible>

        <Collapsible title="Decisiones del bot" hint="Qué hizo y por qué, paso a paso">
          {decisions.length === 0 ? (
            <Text style={type.bodyDim}>Todavía no ha tomado ninguna decisión.</Text>
          ) : decisions.map((d, i) => (
            <Item
              key={d.id}
              first={i === 0}
              title={`${ACTION[d.action] || d.action} · ${pairName(d.symbol)} ${d.side ? sideOf(d.side).short : ''}`}
              right={timeAgo(d.ts)}
            >
              {!!d.reason && <Text style={[type.small, { marginTop: 2 }]} numberOfLines={4}>{d.reason}</Text>}
            </Item>
          ))}
        </Collapsible>

        {calls.length > 0 && (
          <Collapsible title="Respuestas de cada IA" hint="Para comparar qué modelo acierta más">
            {calls.map((c, i) => (
              <Item
                key={c.id}
                first={i === 0}
                title={`${c.model}${c.role === 'primary' ? ' (principal)' : ''}`}
                right={c.error ? 'Falló' : VERDICT[c.verdict] || c.verdict}
                rightColor={c.error ? colors.danger : colors.text}
                sub={`${KIND[c.kind] || c.kind}${c.symbol ? ` · ${pairName(c.symbol)}` : ''} · ${timeAgo(c.ts)}${c.applied ? ' · se aplicó' : ''}`}
              >
                <Text style={[type.small, { marginTop: 2 }]} numberOfLines={c.error ? 2 : 6}>
                  {c.error || (c.answer && c.answer.reason) || ''}
                </Text>
              </Item>
            ))}
            <Text style={[type.small, { marginTop: space.md }]}>
              Solo el modelo principal puede influir en el bot. Los demás responden para compararlos.
            </Text>
          </Collapsible>
        )}

        {events.length > 0 && (
          <Collapsible title="Avisos del sistema" hint="Arranques, errores y cambios de ajustes">
            {events.slice(0, 12).map((e, i) => (
              <Item
                key={e.id}
                first={i === 0}
                title={e.message}
                right={timeAgo(e.ts)}
                rightColor={e.level === 'error' ? colors.danger : e.level !== 'info' ? colors.warn : undefined}
              />
            ))}
          </Collapsible>
        )}

        {!!error && <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>Sin conexión: se muestra lo último recibido.</Text>}
      </>
    );
  };

  return (
    <Screen
      title="Bot"
      subtitle={!report ? 'Operativa automática' : report.can_control ? 'Eres administrador' : 'Solo lectura'}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {body()}
    </Screen>
  );
};

const styles = StyleSheet.create({
  stateRow: { flexDirection: 'row', alignItems: 'center' },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.md },
  itemTop: { flexDirection: 'row', alignItems: 'center' },
  itemTitle: { flex: 1 },
  itemTitleText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  itemRight: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginLeft: space.md },
  tradeTitle: { flexDirection: 'row', alignItems: 'center' },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  control: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: space.lg, paddingTop: space.lg },
});

export default BotScreen;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getBotReport,
  setBotPaused,
  setBotMode,
  setBotAi,
  answerBotProposal,
  closeBotPosition,
  openBotTrade,
} from '../services/api';
import {
  Screen, Card, SectionTitle, Chip, Button, Segment, Stat, StatRow, Row, Notice, Collapsible, Empty, Loading,
} from '../components/ui';
import { colors, space, type, pairName, pnlColor, timeAgo } from '../theme';
import {
  es, esSigned, usdt, money, sideOf, stopOutcome, exitWhy, ACTION,
  decisionText, pauseText, eventText, commandText, aiErrorText,
} from '../botText';

const STANCE = {
  normal: { label: 'Normal', color: colors.accent, hint: 'No ve motivos para frenar: el bot opera con normalidad.' },
  caution: { label: 'Cautela', color: colors.warn, hint: 'Ve riesgo: recomienda que las operaciones nuevas arriesguen la mitad.' },
  no_trade: { label: 'No operar', color: colors.danger, hint: 'Recomienda no abrir operaciones nuevas hoy.' },
};
const AI_MODES = [
  { key: 'off', label: 'Apagada' },
  { key: 'shadow', label: 'Solo opina' },
  { key: 'reduce', label: 'Puede frenar' },
];
const AI_HINT = {
  off: 'No se consulta a ninguna IA. El bot decide solo con sus reglas.',
  shadow: 'La IA opina y queda registrado, pero no cambia ninguna operación. Sirve para medir si acierta.',
  reduce: 'La IA puede reducir o frenar una operación nueva. Nunca abre, amplía ni cierra operaciones.',
};
const VERDICT = {
  full: 'Abrir completa', half: 'Abrir a la mitad', skip: 'No abrir',
  normal: 'Normal', caution: 'Cautela', no_trade: 'No operar',
};
const KIND = { daily: 'Revisión diaria', event: 'Revisión por una noticia o movimiento', signal: 'Opinión sobre una operación' };

// What kind of money the bot is moving. An unknown broker is never assumed to be real or simulated.
const BROKER = {
  paper: {
    chip: 'Dinero simulado', color: colors.info, tone: 'info', word: 'dinero simulado', capital: 'Capital simulado',
    title: 'Simulación', banner: 'El bot practica con dinero ficticio. No toca tu cuenta de Binance.',
  },
  demo: {
    chip: 'Cuenta demo', color: colors.info, tone: 'info', word: 'dinero de la cuenta demo', capital: 'Capital de prueba',
    title: 'Cuenta demo de Binance', banner: 'El bot opera en la cuenta de pruebas de Binance. No es dinero real.',
  },
  live: {
    chip: 'Dinero real', color: colors.danger, tone: 'danger', word: 'dinero real', capital: 'Capital real',
    title: 'Dinero real', banner: 'El bot opera con dinero de verdad en Binance.',
  },
  unknown: {
    chip: 'Cuenta desconocida', color: colors.textMuted, tone: 'warn', word: 'dinero de un tipo de cuenta desconocido',
    capital: 'Capital', title: 'Tipo de cuenta desconocido',
    banner: 'El servidor no dice si el bot usa dinero simulado o real. Trátalo como real hasta confirmarlo.',
  },
};

const until = (ts) => {
  const s = ts - Date.now() / 1000;
  if (s <= 0) return 'ya';
  return s < 5400 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.round(s / 3600)} h`;
};

/** Translated text + what the AI said + untranslatable remainder, always in that order. */
const Explained = ({ value, lines }) => {
  if (!value) return null;
  return (
    <>
      {!!value.text && <Text style={[type.small, { marginTop: 2 }]} numberOfLines={lines}>{value.text}</Text>}
      {!!value.opinion && (
        <Text style={[type.small, { marginTop: 2 }]} numberOfLines={5}>Opinión de la IA: {value.opinion}</Text>
      )}
      {!!value.detail && (
        <Text style={styles.detail} numberOfLines={2}>Detalle técnico: {value.detail}</Text>
      )}
    </>
  );
};

const Item = ({ title, right, rightColor, lines, children, first }) => (
  <View style={[styles.item, first && { borderTopWidth: 0, paddingTop: 0, marginTop: 0 }]}>
    <View style={styles.itemTop}>
      <Text style={[styles.itemTitleText, { flex: 1 }]}>{title}</Text>
      {!!right && <Text style={[styles.itemRight, rightColor && { color: rightColor }]}>{right}</Text>}
    </View>
    {(lines || []).filter(Boolean).map((l, i) => (
      <Text key={i} style={[type.small, { marginTop: 3 }]}>{l}</Text>
    ))}
    {children}
  </View>
);

/** "BTC · Compra (long)" — the same first words on every trade in this tab. */
const tradeTitle = (symbol, side) => `${pairName(symbol)} · ${sideOf(side).noun}`;

const BotScreen = () => {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null); // coin chosen in "Abrir una operación a mano"
  const [pending, setPending] = useState(null); // { id, label, since } order sent, waiting for the bot
  const [outcome, setOutcome] = useState(null); // { ok, text, detail, label } what the bot answered
  const riskRef = useRef({});

  const load = useCallback(async () => {
    try {
      const r = await getBotReport();
      setReport(r);
      setError(null);
      return r;
    } catch (err) {
      setError(err && err.status === 403 ? 'forbidden' : 'offline');
      return null;
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  // An order is only queued by the server: the bot executes it on its next round (about 20 s).
  // Keep asking until the bot has answered that exact order, then say what it answered.
  useEffect(() => {
    if (!pending) return undefined;
    const check = async () => {
      const r = await load();
      const row = ((r && r.recent_commands) || []).find((c) => c.id === pending.id);
      if (row && row.status !== 'pending') {
        setOutcome({ ...commandText(row, riskRef.current), label: pending.label });
        setPending(null);
      } else if (Date.now() - pending.since > 90000) {
        setOutcome({
          ok: false, label: pending.label,
          text: 'El bot no ha contestado en 90 segundos. Puede que esté parado: la orden sigue en cola y se ejecutará cuando vuelva a funcionar.',
        });
        setPending(null);
      }
    };
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [pending, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /** Runs a control. `label` names it in the "order sent / result" notice. */
  const run = async (fn, label) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res && res.command_id != null) {
        setOutcome(null);
        setPending({ id: res.command_id, label: label || 'Orden', since: Date.now() });
      }
      await load();
    } catch (err) {
      Alert.alert('No se pudo enviar', err && err.status === 403
        ? 'Solo el administrador puede hacer esto.'
        : 'No hubo conexión con el servidor. No se ha hecho nada; inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = (title, message, label, fn, destructive = false) =>
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: label, style: destructive ? 'destructive' : 'default', onPress: () => run(fn, title) },
    ]);

  const body = () => {
    if (!report) {
      return error
        ? (error === 'forbidden'
          ? <Empty title="El servidor aún no deja ver el bot" hint="El servidor tiene una versión anterior, que solo deja entrar al administrador. Se arregla actualizando el servidor; en la app no hay que hacer nada." actionLabel="Reintentar" onAction={load} />
          : <Empty title="No se pudo leer el bot" hint="Comprueba tu conexión. Si sigue igual, puede que el servidor esté reiniciándose." actionLabel="Reintentar" onAction={load} />)
        : <Loading label="Leyendo el bot…" />;
    }

    const s = report.status || {};
    const a = report.account || {};
    const ai = report.ai || {};
    const risk = s.risk || {};
    riskRef.current = risk;
    const perf = report.performance || {};
    const open = report.open_trades || [];
    const proposals = report.pending_proposals || [];
    const closed = report.recent_trades || [];
    const decisions = report.recent_decisions || [];
    const events = report.recent_events || [];
    const calls = ai.recent_calls || [];
    const evaluations = report.latest_evaluations || [];

    const started = s.mode != null;
    const canControl = report.can_control === true;
    const locked = busy || !!pending;
    const broker = BROKER[s.broker] || BROKER.unknown;
    const aiMode = ai.mode || 'off';
    const stanceInfo = ai.stance || null;
    const stanceFresh = !!stanceInfo && Date.now() / 1000 - stanceInfo.ts < 26 * 3600;
    const stance = STANCE[stanceFresh ? stanceInfo.stance : 'normal'] || STANCE.normal;
    const symbols = s.symbols || [];
    const coins = symbols.map(pairName).join(', ');
    const canAct = started && !!s.running && !s.paused; // the bot would execute a new trade right now
    const whyNot = !started ? 'El bot no está encendido.'
      : !s.running ? 'El bot está parado: no puede ejecutar órdenes.'
        : s.paused ? 'El bot está en pausa: reanúdalo para poder abrir.' : null;

    const riskUsdt = a.equity != null && risk.risk_per_trade != null ? a.equity * risk.risk_per_trade : null;
    const riskPct = risk.risk_per_trade != null ? es(risk.risk_per_trade * 100, 1) : null;
    const dayUsdt = a.equity != null && a.day_pnl_pct != null ? a.equity - a.equity / (1 + a.day_pnl_pct / 100) : null;

    const picked = symbols.includes(pick) ? pick : symbols[0];
    const pickedBusy = open.some((t) => t.symbol === picked);
    const askOpen = (side) => {
      const sd = sideOf(side === 'long' ? 1 : -1);
      const coin = pairName(picked);
      confirm(
        `${sd.noun} de ${coin}`,
        `Vas a ${sd.bet.replace('sube', `${coin} sube`).replace('baja', `${coin} baja`)}. `
          + `El bot elige la cantidad y pone un cierre automático de pérdidas: si el precio ${sd.against} hasta ahí, la operación se cierra sola`
          + (riskUsdt != null ? ` y pierdes unos ${usdt(riskUsdt, 0)} (${riskPct} % del capital). ` : '. ')
          + 'No tiene un precio de ganancia fijo: el bot va moviendo ese cierre a tu favor mientras el precio acompaña. '
          + `Es ${broker.word}. El bot puede negarse si no cumple sus límites; te lo dirá aquí.`,
        'Abrir',
        () => openBotTrade(picked, side),
      );
    };

    const state = !started
      ? { label: 'Sin encender', color: colors.textMuted }
      : !s.running
        ? { label: 'Parado', color: colors.danger }
        : s.paused
          ? { label: 'En pausa', color: colors.warn }
          : { label: 'En marcha', color: colors.accent };

    const silentFor = s.heartbeat_age_s != null ? timeAgo(Date.now() / 1000 - s.heartbeat_age_s).replace('hace ', '') : null;
    const summary = !started
      ? 'El bot nunca se ha encendido en el servidor. Hasta entonces esta pantalla estará vacía; desde la app no se puede encender.'
      : !s.running
        ? `El bot lleva ${silentFor && silentFor !== 'ahora' ? silentFor : 'un rato'} sin dar señal de vida. No abre ni cierra operaciones. `
          + (s.broker === 'live' || s.broker === 'demo'
            ? 'Las órdenes de cierre automático de pérdidas siguen puestas en Binance. '
            : '')
          + 'Hay que reiniciarlo en el servidor; desde la app no se puede.'
        : s.paused
          ? 'El bot está en pausa: no abre operaciones nuevas. Las que ya están abiertas siguen con su cierre automático de pérdidas.'
          : s.mode === 'auto'
            ? `El bot vigila ${coins || 'el mercado'} y abre operaciones por su cuenta cuando se cumplen sus reglas.`
            : `El bot vigila ${coins || 'el mercado'} y propone operaciones; no abre nada sin que el administrador lo apruebe.`;

    const lastEval = evaluations.reduce((m, e) => (e && e.ts > (m ? m.ts : 0) ? e : m), null);
    const emptyOpen = !started ? 'Ninguna. El bot no está encendido.'
      : !s.running ? 'Ninguna. El bot no está funcionando.'
        : s.paused ? 'Ninguna. El bot está en pausa y no abrirá operaciones hasta que se reanude.'
          : `Ninguna ahora mismo. El bot revisa ${coins || 'sus monedas'} cada pocas horas y solo abre cuando se cumplen sus reglas; pueden pasar días sin operar.`
            + (lastEval ? ` Última revisión: ${timeAgo(lastEval.ts)}${lastEval.sig ? '' : ', sin señal'}.` : '');

    const proposalInfo = (pid) => {
      const d = decisions.find((x) => x.action === 'PROPOSE' && x.data && x.data.proposal_id === pid);
      return (d && d.data) || {};
    };
    const whyOpened = (tid) => {
      const d = decisions.find((x) => x.action === 'ENTER' && x.data && x.data.trade_id === tid);
      return d ? decisionText({ ...d, data: {} }, risk) : null;
    };

    const perfRows = [['Desde el inicio', perf.all], ['Últimos 30 días', perf.last_30d], ['Últimos 7 días', perf.last_7d]];

    return (
      <>
        <Notice tone={broker.tone} title={broker.title}>{broker.banner}</Notice>

        {!!pending && (
          <Notice tone="info" title={`${pending.label}: orden enviada`}>
            <View style={styles.pendingRow}>
              <ActivityIndicator size="small" color={colors.info} />
              <Text style={[type.bodyDim, { flex: 1, marginLeft: space.sm }]}>
                El bot la ejecuta en unos 20 segundos. Aquí verás el resultado; no hace falta volver a pulsar.
              </Text>
            </View>
          </Notice>
        )}
        {!pending && !!outcome && (
          <Notice tone={outcome.ok ? 'good' : 'warn'} title={outcome.label}>
            <Text style={type.bodyDim}>{outcome.text}</Text>
            {!!outcome.detail && <Text style={styles.detail} numberOfLines={3}>Detalle técnico: {outcome.detail}</Text>}
            <Button small kind="ghost" label="Entendido" onPress={() => setOutcome(null)} style={styles.dismiss} />
          </Notice>
        )}

        <Card>
          <View style={styles.stateRow}>
            <Chip label={state.label.toUpperCase()} color={state.color} solid />
            <Chip label={broker.chip} color={broker.color} style={{ marginLeft: space.sm }} />
          </View>
          <Text style={[type.body, { marginTop: space.md }]}>{summary}</Text>
          {started && !!s.paused && (
            <View style={{ marginTop: space.sm }}>
              <Explained value={pauseText(s.pause_reason)} />
            </View>
          )}
          {started && (
            <StatRow style={{ marginTop: space.lg }}>
              <Stat label={broker.capital} value={es(a.equity, 0)} hint="USDT, con lo abierto" />
              <Stat
                label="Hoy"
                value={dayUsdt != null ? esSigned(dayUsdt, 0) : '-'}
                color={pnlColor(dayUsdt)}
                hint={a.day_pnl_pct != null ? `USDT (${esSigned(a.day_pnl_pct, 2)} %)` : 'USDT'}
              />
              <Stat
                label="Bajo su máximo"
                value={a.drawdown_pct != null ? `${es(a.drawdown_pct, 1)} %` : '-'}
                color={a.drawdown_pct > 5 ? colors.warn : undefined}
                hint={risk.max_drawdown_halt != null ? `se pausa al ${es(risk.max_drawdown_halt * 100, 0)} %` : undefined}
              />
            </StatRow>
          )}
        </Card>

        {proposals.length > 0 && (
          <>
            <SectionTitle>El bot propone operar: falta respuesta</SectionTitle>
            <Card>
              {proposals.map((p, i) => {
                const sd = sideOf(p.side);
                const info = proposalInfo(p.id);
                const out = stopOutcome(p.side, info.qty, p.ref_price, p.sl);
                const coin = pairName(p.symbol);
                const aiSaid = info.ai ? decisionText({ action: 'PROPOSE', reason: info.ai }, risk) : null;
                return (
                  <Item
                    key={p.id}
                    first={i === 0}
                    title={`${tradeTitle(p.symbol, p.side)}: ${sd.wins}`}
                    lines={[
                      `Precio ahora ≈ ${money(p.ref_price)}.`,
                      `Si ${sd.against} a ${money(p.sl)} se cierra sola${out ? ` y ${out}` : ''}.`,
                      `Si nadie responde, la propuesta se descarta en ${until(p.expires_at)}.`,
                    ]}
                  >
                    <Explained value={aiSaid} />
                    {canControl ? (
                      <>
                        <View style={styles.buttons}>
                          <Button
                            small label="Aprobar" disabled={locked || !canAct} style={{ flex: 1 }}
                            onPress={() => confirm(`Aprobar ${sd.noun.toLowerCase()} de ${coin}`,
                              `Se abrirá una ${sd.noun.toLowerCase()} de ${coin} con ${broker.word}.`
                                + (out ? ` Si sale mal ${out.replace('perdería', 'pierde')}.` : '')
                                + ' El bot puede negarse si ya no cumple sus límites.',
                              'Aprobar', () => answerBotProposal(p.id, 'approve'))}
                          />
                          <Button
                            small kind="secondary" label="Rechazar" disabled={locked} style={{ flex: 1 }}
                            onPress={() => confirm(`Rechazar ${sd.noun.toLowerCase()} de ${coin}`,
                              'La propuesta se descarta y no se abre nada.', 'Rechazar',
                              () => answerBotProposal(p.id, 'reject'), true)}
                          />
                        </View>
                        {!canAct && !!whyNot && <Text style={[type.small, { marginTop: space.sm }]}>{whyNot}</Text>}
                      </>
                    ) : (
                      <Text style={[type.small, { marginTop: space.sm }]}>Solo el administrador puede responder.</Text>
                    )}
                  </Item>
                );
              })}
            </Card>
          </>
        )}

        <SectionTitle>Operaciones abiertas del bot</SectionTitle>
        <Card>
          {open.length === 0 ? (
            <Text style={type.bodyDim}>{emptyOpen}</Text>
          ) : (
            open.map((t, i) => {
              const sd = sideOf(t.side);
              const out = stopOutcome(t.side, t.qty, t.entry, t.sl);
              const coin = pairName(t.symbol);
              const winning = t.open_pnl != null && t.open_pnl >= 0;
              const why = whyOpened(t.id);
              return (
                <Item
                  key={t.id}
                  first={i === 0}
                  title={`${tradeTitle(t.symbol, t.side)}: ${sd.wins}`}
                  lines={[
                    `${sd.bought} a ${money(t.entry)} ${timeAgo(t.entry_ts)}. Precio ahora ${money(t.price)}.`,
                    `Se cierra sola si ${sd.against} a ${money(t.sl)}${out ? `: ${out}` : ''}.`,
                    t.tp != null
                      ? `Se cierra con ganancia si llega a ${money(t.tp)}.`
                      : 'Sin precio de ganancia fijo: el cierre automático va siguiendo al precio.',
                  ]}
                >
                  <Text style={[styles.result, { color: pnlColor(t.open_pnl) }]}>
                    {winning ? 'Va ganando' : 'Va perdiendo'} {usdt(Math.abs(t.open_pnl || 0))} (aún sin cerrar)
                  </Text>
                  {!!(why && why.text) && (
                    <View style={{ marginTop: space.xs }}>
                      <Text style={type.small}>Por qué la abrió:</Text>
                      <Explained value={why} />
                    </View>
                  )}
                  {canControl && (
                    <Button
                      small kind="secondary" label="Cerrar ahora" disabled={locked}
                      style={{ alignSelf: 'flex-start', marginTop: space.md }}
                      onPress={() => confirm(`Cerrar ${sd.noun.toLowerCase()} de ${coin}`,
                        `Se cerrará al precio actual (≈ ${money(t.price)}). Resultado aproximado: ${esSigned(t.open_pnl)} USDT (${broker.word}). `
                          + 'No se puede deshacer. El bot lo hace en unos 20 segundos.',
                        'Cerrar', () => closeBotPosition(t.symbol), true)}
                    />
                  )}
                </Item>
              );
            })
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
                {aiMode === 'shadow'
                  ? 'Solo es una opinión: hoy no cambia lo que hace el bot. '
                  : 'Esta opinión se aplica a las operaciones nuevas. '}
                Revisado {timeAgo(stanceInfo.ts)}.
              </Text>
            </>
          ) : (
            <Text style={type.bodyDim}>
              Aún no hay una revisión vigente. La IA revisa el mercado una vez al día y cuando pasa algo importante.
            </Text>
          )}
        </Card>

        <SectionTitle>Resultados del bot</SectionTitle>
        <Card>
          {perfRows.map(([label, st], i) => {
            const n = st && st.trades ? st.trades : 0;
            const wins = n ? Math.round(((st.win_rate_pct || 0) * n) / 100) : 0;
            return (
              <Row
                key={label}
                first={i === 0}
                label={label}
                value={n ? `${esSigned(st.pnl)} USDT` : 'Sin operaciones cerradas'}
                color={n ? pnlColor(st.pnl) : colors.textMuted}
                help={n
                  ? `${n} ${n === 1 ? 'operación cerrada' : 'operaciones cerradas'} · ganó ${wins} y perdió ${n - wins} · media ${esSigned(st.pnl / n)} USDT por operación`
                  : undefined}
              />
            );
          })}
          <Text style={[type.small, { marginTop: space.sm }]}>
            Resultados con {broker.word}, ya descontadas las comisiones. Es normal que pierda más veces de las que
            gana: sus ganancias suelen ser más grandes que sus pérdidas.
          </Text>
        </Card>

        {canControl ? (
          <>
            <SectionTitle>Controlar el bot</SectionTitle>
            <Card>
              <Text style={type.heading}>Abrir una operación a mano</Text>
              <Text style={[type.small, { marginTop: 2, marginBottom: space.md }]}>
                Normalmente el bot abre solo. Aquí puedes pedirle una: eliges la moneda y hacia dónde apuestas, y el
                bot pone la cantidad y el cierre automático de pérdidas con sus límites de riesgo.
                {riskUsdt != null ? ` Cada operación arriesga unos ${usdt(riskUsdt, 0)} (${riskPct} % del capital).` : ''}
              </Text>
              {symbols.length > 1 && (
                <View style={{ marginBottom: space.md }}>
                  <Segment
                    disabled={locked}
                    value={picked}
                    options={symbols.map((x) => ({ key: x, label: pairName(x) }))}
                    onChange={setPick}
                  />
                </View>
              )}
              <Button
                kind="secondary" label="Apostar a que sube (comprar · long)"
                disabled={locked || !canAct || pickedBusy || !picked}
                onPress={() => askOpen('long')}
              />
              <Button
                kind="secondary" label="Apostar a que baja (vender · short)" style={{ marginTop: space.sm }}
                disabled={locked || !canAct || pickedBusy || !picked}
                onPress={() => askOpen('short')}
              />
              <Text style={[type.small, { marginTop: space.sm }]}>
                {pickedBusy
                  ? `Ya hay una operación abierta en ${pairName(picked)}. Ciérrala antes de abrir otra.`
                  : whyNot || 'Vender aquí no es cerrar una compra: es abrir una apuesta a que el precio baja. No hace falta tener la moneda.'}
              </Text>

              <View style={styles.control}>
                <Text style={type.heading}>Pausar o reanudar</Text>
                <Text style={[type.small, { marginTop: 2, marginBottom: space.md }]}>
                  Pausar no cierra nada: las operaciones abiertas siguen con su cierre automático de pérdidas. Solo deja
                  de abrir nuevas.
                </Text>
                <Button
                  kind={s.paused ? 'primary' : 'warn'}
                  label={s.paused ? 'Reanudar el bot' : 'Pausar el bot'}
                  disabled={locked || !started}
                  onPress={() =>
                    s.paused
                      ? confirm('Reanudar el bot', `Volverá a abrir operaciones con ${broker.word} cuando se cumplan sus reglas.`, 'Reanudar', () => setBotPaused(false))
                      : confirm('Pausar el bot', 'No abrirá operaciones nuevas. Las abiertas siguen con su cierre automático de pérdidas.', 'Pausar', () => setBotPaused(true))
                  }
                />
              </View>

              <View style={styles.control}>
                <Text style={type.heading}>Quién decide abrir</Text>
                <View style={{ marginTop: space.md }}>
                  <Segment
                    disabled={locked || !started}
                    value={s.mode}
                    options={[{ key: 'auto', label: 'El bot decide solo' }, { key: 'manual', label: 'Me pregunta antes' }]}
                    onChange={(m) =>
                      m === 'auto'
                        ? confirm('Dejar que el bot decida solo',
                            `A partir de ahora el bot abrirá operaciones sin preguntar, con ${broker.word}.`
                              + (riskPct ? ` Cada una arriesga como mucho el ${riskPct} % del capital.` : '')
                              + (proposals.length ? ' Las propuestas pendientes siguen esperando tu respuesta.' : ''),
                            'Aceptar', () => setBotMode(m), s.broker === 'live')
                        : run(() => setBotMode(m))
                    }
                  />
                </View>
                <Text style={[type.small, { marginTop: space.sm }]}>
                  {s.mode === 'manual'
                    ? 'El bot propone cada operación y espera a que la apruebes en esta pantalla. Te llega un aviso.'
                    : 'El bot abre las operaciones por su cuenta, siempre dentro de sus límites de riesgo.'}
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
                        ? confirm('Dejar que la IA frene operaciones',
                            'Podrá reducir o frenar operaciones nuevas. Todavía no ha demostrado que acierte: lo recomendado es dejarla en «Solo opina».',
                            'Dar autoridad', () => setBotAi(m), true)
                        : run(() => setBotAi(m))
                    }
                  />
                </View>
                <Text style={[type.small, { marginTop: space.sm }]}>{AI_HINT[aiMode]}</Text>
                <Text style={[type.small, { marginTop: space.xs }]}>
                  Coste real de las consultas a la IA (se paga aunque el bot opere en simulado): {es(ai.cost_usd_30d)} USD
                  en 30 días.
                </Text>
              </View>
            </Card>
          </>
        ) : (
          <Notice tone="info" title="Solo puedes mirar">
            Ves todo lo que hace el bot. El administrador es quien lo pausa, abre o cierra operaciones y cambia sus ajustes.
          </Notice>
        )}

        <SectionTitle>Historial</SectionTitle>
        <Collapsible title="Operaciones cerradas" hint={closed.length ? `Las ${closed.length} más recientes` : 'Todavía ninguna'}>
          {closed.length === 0 ? (
            <Text style={type.bodyDim}>El bot aún no ha cerrado ninguna operación.</Text>
          ) : closed.map((t, i) => (
            <Item
              key={t.id}
              first={i === 0}
              title={tradeTitle(t.symbol, t.side)}
              right={`${esSigned(t.pnl)} USDT`}
              rightColor={pnlColor(t.pnl)}
              lines={[
                `${sideOf(t.side).bought} a ${money(t.entry)}, cerró a ${money(t.exit)} · ${timeAgo(t.exit_ts)}.`,
                `Motivo: ${exitWhy(t.exit_reason, t.pnl)}.`,
              ]}
            />
          ))}
        </Collapsible>

        <Collapsible title="Qué hizo el bot y por qué" hint="Sus últimas decisiones, paso a paso">
          {decisions.length === 0 ? (
            <Text style={type.bodyDim}>Todavía no ha tomado ninguna decisión.</Text>
          ) : decisions.map((d, i) => (
            <Item
              key={d.id}
              first={i === 0}
              title={`${ACTION[d.action] || 'Decisión'} · ${pairName(d.symbol)}${d.side ? ` · ${sideOf(d.side).noun}` : ''}`}
              right={timeAgo(d.ts)}
            >
              <Explained value={decisionText(d, risk)} lines={5} />
            </Item>
          ))}
        </Collapsible>

        <Collapsible title="Registro técnico" hint="Avisos del sistema y respuestas de cada IA">
          <Text style={type.label}>Avisos del sistema</Text>
          {events.length === 0 ? (
            <Text style={[type.bodyDim, { marginTop: space.sm }]}>Sin avisos.</Text>
          ) : events.slice(0, 12).map((e, i) => {
            const t = eventText(e);
            return (
              <Item
                key={e.id}
                first={i === 0}
                title={t.text}
                right={timeAgo(e.ts)}
                rightColor={e.level === 'error' ? colors.danger : e.level !== 'info' ? colors.warn : undefined}
              >
                <Explained value={{ opinion: t.opinion, detail: t.detail }} />
              </Item>
            );
          })}

          {calls.length > 0 && (
            <>
              <Text style={[type.label, { marginTop: space.xl }]}>Comparativa de modelos de IA</Text>
              <Text style={[type.small, { marginTop: 2 }]}>
                Varias IA responden a lo mismo para ver cuál acierta más. Solo la principal puede influir en el bot.
              </Text>
              {calls.map((c, i) => (
                <Item
                  key={c.id}
                  first={i === 0}
                  title={`${c.model}${c.role === 'primary' ? ' (principal)' : ''}`}
                  right={c.error ? aiErrorText(c.error) : VERDICT[c.verdict] || 'Sin veredicto'}
                  rightColor={c.error ? colors.danger : colors.text}
                  lines={[
                    `${KIND[c.kind] || 'Consulta'}${c.symbol ? ` · ${pairName(c.symbol)}` : ''} · ${timeAgo(c.ts)}${c.applied ? ' · se aplicó' : ''}`,
                  ]}
                >
                  {!c.error && !!(c.answer && c.answer.reason) && (
                    <Text style={[type.small, { marginTop: 2 }]} numberOfLines={6}>{c.answer.reason}</Text>
                  )}
                </Item>
              ))}
            </>
          )}
        </Collapsible>

        {!!error && <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>Sin conexión: se muestra lo último recibido.</Text>}
      </>
    );
  };

  return (
    <Screen
      title="Bot"
      subtitle={!report ? 'Opera solo, con reglas fijas' : report.can_control ? 'Eres administrador' : 'Solo puedes mirar'}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {body()}
    </Screen>
  );
};

const styles = StyleSheet.create({
  stateRow: { flexDirection: 'row', alignItems: 'center' },
  pendingRow: { flexDirection: 'row', alignItems: 'center' },
  dismiss: { alignSelf: 'flex-start', marginTop: space.xs, paddingHorizontal: 0, minHeight: 44 },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.md },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start' },
  itemTitleText: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  itemRight: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginLeft: space.md, lineHeight: 21 },
  result: { fontSize: 14, fontWeight: '700', marginTop: space.sm },
  detail: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  control: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: space.lg, paddingTop: space.lg },
});

export default BotScreen;

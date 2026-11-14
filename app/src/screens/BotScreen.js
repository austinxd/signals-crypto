import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getBotReport,
  setBotPaused,
  setBotMode,
  setBotAi,
  answerBotProposal,
  closeBotPosition,
  openBotTrade,
  setBotReal,
} from '../services/api';
import {
  Screen, Card, SectionTitle, Chip, Button, Segment, Stat, StatRow, Row, Notice, Collapsible, Empty, Loading,
  MoneyTag, Help,
} from '../components/ui';
import { colors, space, type, pairName, pnlColor, timeAgo, MONEY, moneyOfBroker } from '../theme';
import {
  es, esSigned, money, sideOf, stopOutcome, exitWhy, ACTION, setReader,
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

// Words for the kind of money the bot is moving, by MONEY key. An unknown broker is never assumed to be
// simulated: it gets no band, a warning, and is treated as real in confirmations.
const WORDS = {
  sim: { adj: 'simuladas', results: 'Resultados simulados', word: 'dinero simulado', paren: 'simulado', capital: 'Capital simulado' },
  demo: { adj: 'de prueba', results: 'Resultados de prueba', word: 'dinero de prueba', paren: 'demo', capital: 'Capital de prueba' },
  live: { adj: 'reales', results: 'Resultados reales', word: 'dinero real', paren: 'dinero real', capital: 'Capital real' },
  unknown: { adj: 'del bot', results: 'Resultados del bot', word: 'dinero de un tipo de cuenta desconocido', paren: 'cuenta desconocida', capital: 'Capital' },
};
const KNOWN_BROKERS = ['paper', 'demo', 'live'];

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

/** "BTC · Short ↓" — the same first words on every trade in this tab. */
const tradeTitle = (symbol, side) => `${pairName(symbol)} · ${sideOf(side).noun} ${sideOf(side).arrow}`;

/** One open trade: the result is always visible, the rest opens with a tap. */
// One outcome of a trade, as a coloured tile: what closes it, at which price, and what it would pay.
const Outcome = ({ label, value, price, color, note }) => (
  <View style={[styles.outcome, { backgroundColor: `${color}1f`, borderColor: `${color}66` }]}>
    <Text style={[styles.outcomeLabel, { color }]}>{label}</Text>
    <Text style={[styles.outcomeValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    {!!price && <Text style={styles.outcomePrice}>{price}</Text>}
    {!!note && <Text style={styles.outcomeNote}>{note}</Text>}
  </View>
);

const Dot = ({ color, label, value }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color }]} />
    <Text style={styles.legendText}>{label} <Text style={{ color: colors.text, fontWeight: '600' }}>{value}</Text></Text>
  </View>
);

const Step = ({ color, children }) => (
  <View style={styles.step}>
    <View style={[styles.stepBar, { backgroundColor: color }]} />
    <Text style={[type.small, { flex: 1, color: colors.textDim }]}>{children}</Text>
  </View>
);

/**
 * The inside of an open trade: where it would lose, where it is, where it would win, drawn on one line
 * that always reads left = loses, right = wins, whatever the direction of the trade.
 */
const TradeDetail = ({ t, unit, equity, atr, params, maxLev, lev, size, move }) => {
  const side = t.side > 0 ? 1 : -1;
  const sd = sideOf(side);
  const r = Math.abs(t.entry - t.sl0) || Math.abs(t.entry - t.sl) || 1; // what it risked, in price
  const end = t.tp != null ? t.tp : t.entry + side * 3 * r; // right edge: the target, or 3x the risk when there is none
  const at = (p) => Math.max(0, Math.min(1, (side * (p - t.sl0)) / (side * (end - t.sl0) || 1)));
  const pct = (p) => `${(100 * at(p)).toFixed(1)}%`;
  const stopResult = side * t.qty * (t.sl - t.entry);
  const tpResult = t.tp != null ? side * t.qty * (t.tp - t.entry) : null;
  const moved = Math.abs(t.sl - t.sl0) > 1e-9;
  const safe = stopResult >= -1e-9; // the stop is at the entry or better: it can no longer close at a loss
  const stopColor = safe ? colors.accent : colors.danger;
  const be = Number(params.breakeven_r) > 0 ? Number(params.breakeven_r) : null;
  const beAt = be ? t.entry + side * be * r : null;
  const trail = Number(params.trail_atr) > 0 ? Number(params.trail_atr) : null;
  const pnl = t.open_pnl || 0;
  const dir = side > 0 ? 'sube' : 'baja';
  const past = side > 0 ? 'por encima' : 'por debajo';
  const toStop = t.price ? (100 * Math.abs(t.sl - t.price)) / t.price : null;
  const toTp = t.tp != null && t.price ? (100 * Math.abs(t.tp - t.price)) / t.price : null;
  return (
    <View style={{ marginTop: space.md }}>
      <View style={styles.outcomes}>
        <Outcome
          label={safe ? 'SI SE DA LA VUELTA' : 'SI SALE MAL'}
          color={stopColor}
          value={`${esSigned(stopResult, 2)}`}
          price={`stop ${money(t.sl)}`}
          note={toStop != null ? `a ${es(toStop, 1)} %` : null}
        />
        <Outcome
          label="AHORA"
          color={pnl >= 0 ? colors.accent : colors.danger}
          value={`${esSigned(pnl, 2)}`}
          price={money(t.price)}
          note={move != null ? `${esSigned(move, 2)} % a favor` : null}
        />
        <Outcome
          label="SI SALE BIEN"
          color={t.tp != null ? colors.accent : colors.info}
          value={tpResult != null ? `${esSigned(tpResult, 2)}` : 'Sin tope'}
          price={t.tp != null ? `objetivo ${money(t.tp)}` : `mientras ${dir}`}
          note={toTp != null ? `a ${es(toTp, 1)} %` : null}
        />
      </View>
      <Text style={[type.small, { marginTop: 6, textAlign: 'center' }]}>Importes en {unit}</Text>

      <View style={styles.track}>
        <View style={[styles.trackLoss, { width: pct(t.entry) }]} />
        <View style={[styles.trackWin, { left: pct(t.entry) }]} />
        {moved && <View style={[styles.trackGone, { width: pct(t.sl) }]} />}
        <View style={[styles.tick, { left: pct(t.entry), backgroundColor: colors.textDim }]} />
        <View style={[styles.tick, styles.tickStop, { left: pct(t.sl), backgroundColor: stopColor }]} />
        <View style={[styles.now, { left: pct(t.price) }]} />
      </View>
      <View style={styles.trackEnds}>
        <Text style={[styles.trackEnd, { color: colors.danger }]}>◀ pierde</Text>
        <Text style={[styles.trackEnd, { color: colors.accent }]}>gana ▶</Text>
      </View>
      <View style={styles.legend}>
        <Dot color={stopColor} label="Stop" value={money(t.sl)} />
        <Dot color={colors.textDim} label="Entrada" value={money(t.entry)} />
        <Dot color={colors.text} label="Ahora" value={money(t.price)} />
        {t.tp != null && <Dot color={colors.accent} label="Objetivo" value={money(t.tp)} />}
      </View>

      <Text style={[type.label, { marginTop: space.lg, marginBottom: space.xs }]}>Qué hará el bot</Text>
      <Step color={stopColor}>
        {moved
          ? `Stop ya movido a tu favor: empezó en ${money(t.sl0)} y está en ${money(t.sl)}.`
          : `Stop sin cambios desde que abrió, en ${money(t.sl)}.`}
        {safe ? ' Esta operación ya no puede cerrar en pérdida.' : ''}
      </Step>
      {beAt != null && !safe && (
        <Step color={colors.warn}>
          Cuando una vela de 4 h cierre {past} de {money(beAt)}, el stop pasa a la entrada ({money(t.entry)}) y deja de poder perder.
        </Step>
      )}
      {trail != null && (
        <Step color={colors.info}>
          Mientras el precio {dir}, cada 4 h el stop lo sigue a {es(trail, 0)} ATR
          {atr != null && t.price ? ` (≈ ${es((100 * trail * atr) / t.price, 1)} %)` : ''} de distancia. Nunca retrocede.
        </Step>
      )}
      <Step color={colors.accent}>
        {t.tp != null
          ? `Si llega a ${money(t.tp)} cierra sola con la ganancia. Ese objetivo no se mueve.`
          : 'No tiene objetivo: la deja correr y cierra cuando el precio se da la vuelta hasta el stop.'}
      </Step>

      <View style={styles.facts}>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>TAMAÑO</Text>
          <Text style={styles.factValue}>{es(size, 0)}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>APALANCAMIENTO</Text>
          <Text style={styles.factValue}>{lev != null ? `${es(lev, 1)}x` : '-'}{maxLev != null ? <Text style={styles.factDim}> de {es(maxLev, 0)}x</Text> : null}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>ABIERTA</Text>
          <Text style={styles.factValue}>{timeAgo(t.entry_ts)}</Text>
        </View>
      </View>
      <Text style={[type.small, { marginTop: space.sm }]}>
        {sd.noun}: {sd.wins}.
        {equity > 0 ? ` El resultado de ahora es ${esSigned((100 * pnl) / equity, 2)} % del capital, sin descontar comisiones.` : ''}
        {atr != null && t.price ? ` Una vela de 4 h suele mover el precio ${es((100 * atr) / t.price, 1)} % (ATR ${money(atr)}).` : ''}
      </Text>
    </View>
  );
};

const Fold = ({ title, right, rightColor, summary, first, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.item, first && { borderTopWidth: 0, paddingTop: 0, marginTop: 0 }]}>
      <TouchableOpacity onPress={() => setOpen(!open)} activeOpacity={0.7}>
        <View style={styles.itemTop}>
          <Text style={[styles.itemTitleText, { flex: 1 }]}>{title}</Text>
          {!!right && <Text style={[styles.itemRight, { fontSize: 15 }, rightColor && { color: rightColor }]}>{right}</Text>}
        </View>
        {!!summary && <Text style={[type.small, { marginTop: 3 }]}>{summary}</Text>}
        <Text style={styles.foldToggle}>{open ? 'Ocultar detalle' : 'Ver detalle'}</Text>
      </TouchableOpacity>
      {open && children}
    </View>
  );
};

const BotScreen = ({ route, navigation }) => {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null); // coin chosen in "Abrir operación"
  const [idea, setIdea] = useState(null); // { coin, side } when the reader comes from a coin's analysis
  const [pending, setPending] = useState(null); // { id, label, since } order sent, waiting for the bot
  const [outcome, setOutcome] = useState(null); // { ok, text, detail, label } what the bot answered
  const riskRef = useRef({});
  // Two bots can run on the server: 'sim' practises with simulated money, 'real' trades a Binance account.
  const [account, setAccount] = useState('sim');
  const switchAccount = (a) => {
    setAccount(a);
    setReport(null);
    setError(null);
    setPending(null);
    setOutcome(null);
  };

  // "Practicar con el bot" in a coin's analysis sends { symbol, side, ts }: arrive with that coin chosen.
  const asked = route && route.params;
  const askedTs = asked && asked.ts;
  useEffect(() => {
    if (!asked || !asked.symbol) return;
    const coin = pairName(String(asked.symbol).toUpperCase());
    setPick(coin);
    setIdea({ coin, side: asked.side === 'short' ? 'short' : asked.side === 'long' ? 'long' : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedTs, asked && asked.symbol]);

  const load = useCallback(async () => {
    try {
      let r = await getBotReport(account);
      // A server from before the two-bot version ignores the account and answers with the simulated bot.
      if (account === 'real' && r && r.bot !== 'real' && r.account !== 'real') r = { bot: 'real', configured: false, outdated: true, can_control: r.can_control };
      setReport(r);
      setError(null);
      return r;
    } catch (err) {
      setError(err && err.status === 403 ? 'forbidden' : 'offline');
      return null;
    }
  }, [account]);

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
        ? 'Solo el dueño del bot puede hacer esto.'
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

  const brokerName = report && report.status ? report.status.broker : null;
  const known = KNOWN_BROKERS.includes(brokerName);
  const kind = known ? moneyOfBroker(brokerName) : null; // MONEY key, or null when the server does not say

  const notSetUp = !!report && report.configured === false;

  const accountPicker = (
    <View style={{ marginBottom: space.md }}>
      <Segment
        options={[{ key: 'sim', label: 'Práctica (simulado)' }, { key: 'real', label: 'Binance (real)' }]}
        value={account}
        onChange={switchAccount}
      />
    </View>
  );

  const isReal = account === 'real';
  const real = (report && report.real) || {};

  const turnRealOn = () => Alert.alert(
    'Activar el bot en tu Binance',
    'El bot abrirá operaciones de futuros con tu dinero real, usando las claves que guardaste en Ajustes. Puedes perder dinero. '
      + 'Empieza en modo manual: te propone cada operación y no abre nada hasta que la apruebes.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Activar', style: 'destructive', onPress: () => run(() => setBotReal(true)) },
    ],
  );
  const turnRealOff = () => Alert.alert(
    'Apagar el bot real',
    'Dejará de abrir y de vigilar operaciones. No cierra nada: lo que tengas abierto sigue en Binance con su cierre automático de pérdidas, y pasas a gestionarlo tú.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: () => run(() => setBotReal(false)) },
    ],
  );

  /** Why the real bot could not start, in plain words. */
  const startErrorText = (code) => ({
    hedge_mode: 'Tu cuenta de futuros está en modo "hedge" (cobertura). Cámbiala a modo "one-way" (unidireccional) en Binance Futuros > Preferencias > Modo de posición.',
    keys_rejected: 'Binance rechazó tus claves para operar. La clave necesita el permiso "Habilitar Futuros". Crea una nueva con ese permiso (sin retiros) y guárdala en Ajustes.',
    keys_unreadable: 'No se pudieron leer tus claves guardadas. Vuelve a guardarlas en Ajustes.',
  }[code] || `No pudo arrancar. Detalle técnico: ${String(code).replace(/^other: /, '')}`);

  /** Shown while the account's real bot has never run: what it is, what is missing, and the switch. */
  const realIntro = () => {
    const ready = real.runner_alive && real.live_allowed;
    return (
      <>
        <Card title="Bot en tu Binance (dinero real)">
          <Text style={type.bodyDim}>
            Es el mismo bot que el de práctica, con las mismas reglas, pero abre operaciones de futuros de verdad en tu
            cuenta de Binance, con las claves que guardaste en Ajustes. Sus resultados nunca se mezclan con los simulados.
          </Text>
          <Text style={[type.bodyDim, { marginTop: space.sm }]}>
            Arriesga como máximo un 0,5 % de tu saldo de futuros por operación y empieza en modo manual: te propone cada
            operación y espera a que la apruebes.
          </Text>
        </Card>

        {report.outdated ? (
          <Notice tone="warn" title="Falta actualizar el servidor">El servidor tiene una versión anterior que no conoce el bot real.</Notice>
        ) : (
          <Card title="Qué hace falta">
            <Row first label="1. Tus claves de Binance" value={real.has_keys ? 'Guardadas' : 'Faltan'} color={real.has_keys ? colors.accent : colors.warn}
              help={'La clave debe tener el permiso "Habilitar Futuros" (y nunca el de retiros). Una clave solo de lectura sirve para ver tus operaciones, pero no para el bot.'} />
            <Row label="2. Cuenta en modo one-way" value="Compruébalo"
              help={'En Binance Futuros > Preferencias > Modo de posición: "unidireccional". Es el modo por defecto.'} />
            <Row label="3. Servicio de bots reales" value={ready ? 'En marcha' : 'Apagado'} color={ready ? colors.accent : colors.warn}
              help={ready ? undefined : 'Lo enciende quien administra el servidor (python -m bot real-setup). Mientras esté apagado, nadie opera con dinero real.'} />
            {real.enabled ? (
              real.start_error
                ? <Notice tone="danger" title="Tu bot está activado pero no pudo arrancar" style={{ marginTop: space.md, marginBottom: 0 }}>{startErrorText(real.start_error)}</Notice>
                : <Notice tone="info" title="Activado" style={{ marginTop: space.md, marginBottom: 0 }}>{ready ? 'Está arrancando. Tarda menos de un minuto: desliza hacia abajo para actualizar.' : 'Arrancará en cuanto el servicio de bots reales esté en marcha.'}</Notice>
            ) : null}
            <View style={styles.buttons}>
              {!real.has_keys && <Button style={{ flex: 1 }} kind="secondary" label="Ir a Ajustes" onPress={() => navigation && navigation.navigate('Settings')} />}
              {real.enabled
                ? <Button style={{ flex: 1 }} kind="secondary" label="Apagar" disabled={busy} onPress={turnRealOff} />
                : <Button style={{ flex: 1 }} kind="danger" label="Activar con dinero real" disabled={busy || !real.has_keys} onPress={turnRealOn} />}
            </View>
          </Card>
        )}
      </>
    );
  };

  const body = () => {
    if (notSetUp) return realIntro();
    if (!report) {
      return error
        ? (error === 'forbidden'
          ? <Empty title="El servidor aún no deja ver el bot" hint="El servidor tiene una versión anterior. Se arregla actualizando el servidor; en la app no hay que hacer nada." actionLabel="Reintentar" onAction={load} />
          : <Empty title="No se pudo leer el bot" hint="Comprueba tu conexión. Si sigue igual, puede que el servidor esté reiniciándose." actionLabel="Reintentar" onAction={load} />)
        : <Loading label="Leyendo el bot…" />;
    }

    const s = report.status || {};
    const a = report.account && typeof report.account === 'object' ? report.account : {};
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
    const w = WORDS[kind || 'unknown'];
    const unit = kind ? MONEY[kind].unit : 'USDT';
    setReader(canControl, unit); // botText sentences say "tú" to the owner and name the kind of money
    const cur = 'USDT'; // short form next to tight figures; the long one says whether it is simulated
    const amount = (x, d = 2) => `${es(x, d)} ${unit}`;
    const signed = (x, d = 2) => `${esSigned(x, d)} ${unit}`;
    const tag = kind ? <MoneyTag kind={kind} /> : null;

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
    const all = perf.all || {};
    const openPnl = open.reduce((sum, t) => sum + (t.open_pnl || 0), 0);
    // What the bot started with, to turn amounts into percentages of its capital.
    const startCap = a.equity != null ? a.equity - (all.pnl || 0) - openPnl : null;
    const pctOfStart = (x) => (startCap > 0 && x != null ? `${esSigned((100 * x) / startCap, 2)} %` : null);
    // Per trade: how far the price moved in its favour, how big it is, and how many times the capital that is.
    const numbers = (t, last) => {
      const size = t.qty * t.entry;
      return {
        move: last != null && t.entry ? (100 * t.side * (last - t.entry)) / t.entry : null,
        size,
        lev: a.equity > 0 ? size / a.equity : null,
      };
    };
    const totalLev = a.equity > 0 ? open.reduce((sum, t) => sum + t.qty * t.entry, 0) / a.equity : null;

    const picked = symbols.find((x) => x === pick || pairName(x) === pick) || symbols[0];
    const coin = pairName(picked);
    const pickedBusy = open.some((t) => t.symbol === picked);
    const ideaHere = idea && idea.coin === coin ? idea : null;
    const ideaMissing = idea && !symbols.some((x) => pairName(x) === idea.coin) ? idea.coin : null;
    const askOpen = (side) => {
      const sd = sideOf(side === 'long' ? 1 : -1);
      confirm(
        `${sd.noun} de ${coin} (${w.paren})`,
        `Gana si ${coin} ${sd.against === 'baja' ? 'sube' : 'baja'}. `
          + `Si ${sd.against} hasta el cierre automático de pérdidas, se cierra sola`
          + (riskUsdt != null ? ` y pierdes unos ${amount(riskUsdt, 0)} (${riskPct} % del capital). ` : '. ')
          + 'El bot puede negarse si no cumple sus límites; te lo dirá aquí.',
        'Abrir',
        () => openBotTrade(picked, side, account),
        kind === 'live' || !kind,
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
      ? 'El bot nunca se ha encendido en el servidor. Desde la app no se puede encender.'
      : !s.running
        ? `Lleva ${silentFor && silentFor !== 'ahora' ? silentFor : 'un rato'} sin dar señal de vida: no abre ni cierra operaciones. `
          + (s.broker === 'live' || s.broker === 'demo' ? 'Los cierres automáticos de pérdidas siguen puestos en Binance. ' : '')
          + 'Hay que reiniciarlo en el servidor.'
        : s.paused
          ? 'No abre operaciones nuevas. Las abiertas siguen con su cierre automático de pérdidas.'
          : s.mode === 'auto'
            ? `Vigila ${coins || 'el mercado'} y abre operaciones solo.`
            : `Vigila ${coins || 'el mercado'} y propone operaciones: no abre nada sin ${canControl ? 'tu aprobación' : 'la aprobación de su dueño'}.`;

    const lastEval = evaluations.reduce((m, e) => (e && e.ts > (m ? m.ts : 0) ? e : m), null);
    const emptyOpen = !started ? 'Ninguna. El bot no está encendido.'
      : !s.running ? 'Ninguna. El bot no está funcionando.'
        : s.paused ? 'Ninguna. El bot está en pausa.'
          : 'Ninguna ahora mismo. El bot solo abre cuando se cumplen sus reglas; pueden pasar días sin operar.'
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
    const askPause = () => (s.paused
      ? confirm('Reanudar el bot', `Volverá a abrir operaciones con ${w.word} cuando se cumplan sus reglas.`, 'Reanudar', () => setBotPaused(false, account), kind === 'live' || !kind)
      : confirm('Pausar el bot', 'No abrirá operaciones nuevas. Las abiertas no se cierran: siguen con su cierre automático de pérdidas.', 'Pausar', () => setBotPaused(true, account)));

    return (
      <>
        {!kind && started && (
          <Notice tone="warn" title="Tipo de dinero desconocido">
            El servidor no dice si el bot usa dinero simulado o real. Trátalo como real hasta confirmarlo.
          </Notice>
        )}

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

        {/* 1. The answer first: is it running, how much it has, how it is doing — and the pause button. */}
        <Card>
          <View style={styles.stateRow}>
            <Chip label={state.label.toUpperCase()} color={state.color} solid />
            {canControl && started && (
              <Button
                small kind={s.paused ? 'primary' : 'secondary'} label={s.paused ? 'Reanudar' : 'Pausar'}
                disabled={locked} onPress={askPause}
              />
            )}
          </View>
          <Text style={[type.bodyDim, { marginTop: space.sm }]}>{summary}</Text>
          {started && !!s.paused && (
            <View style={{ marginTop: space.xs }}>
              <Explained value={pauseText(s.pause_reason)} />
            </View>
          )}
          {started && (
            <>
              <Text style={[type.label, { marginTop: space.lg }]}>Cuenta · en {unit}</Text>
              <StatRow style={{ marginTop: space.sm }}>
                <Stat label={w.capital} value={es(a.equity, 0)} hint="incluye operaciones abiertas" />
                <Stat
                  label="Hoy"
                  value={dayUsdt != null ? esSigned(dayUsdt, 0) : '-'}
                  color={pnlColor(dayUsdt)}
                  hint={a.day_pnl_pct != null ? `${esSigned(a.day_pnl_pct, 2)} %` : undefined}
                />
                <Stat
                  label="Desde el inicio"
                  value={all.trades ? esSigned(all.pnl, 0) : '-'}
                  color={all.trades ? pnlColor(all.pnl) : undefined}
                  hint={all.trades ? `${pctOfStart(all.pnl) || ''} · ${all.trades} ${all.trades === 1 ? 'cerrada' : 'cerradas'}` : 'sin cerradas'}
                />
              </StatRow>
              <Text style={[type.label, { marginTop: space.lg }]}>Ganado o perdido por el bot · en {unit}</Text>
              <StatRow style={{ marginTop: space.sm }}>
                <Stat
                  label="En abiertas"
                  value={open.length ? esSigned(openPnl, 2) : '-'}
                  color={open.length ? pnlColor(openPnl) : undefined}
                  hint={open.length ? `${pctOfStart(openPnl) || ''} · aún sin cerrar` : 'sin abiertas'}
                />
                <Stat
                  label="Ya cerrado"
                  value={all.trades ? esSigned(all.pnl, 2) : '-'}
                  color={all.trades ? pnlColor(all.pnl) : undefined}
                  hint={all.trades ? `${pctOfStart(all.pnl) || ''} · con comisiones` : 'sin cerradas'}
                />
                <Stat
                  label="Total"
                  value={open.length || all.trades ? esSigned(openPnl + (all.pnl || 0), 2) : '-'}
                  color={open.length || all.trades ? pnlColor(openPnl + (all.pnl || 0)) : undefined}
                  hint={pctOfStart(openPnl + (all.pnl || 0)) || undefined}
                />
              </StatRow>
              <Text style={[type.small, { marginTop: space.md }]}>
                {a.drawdown_pct != null
                  ? `Caída desde su mejor momento: ${es(a.drawdown_pct, 1)} %`
                    + (risk.max_drawdown_halt != null ? ` (se pausa solo al ${es(risk.max_drawdown_halt * 100, 0)} %).` : '.')
                  : ''}
              </Text>
            </>
          )}
        </Card>

        {/* 2. What is waiting for an answer. */}
        {proposals.length > 0 && (
          <>
            <SectionTitle right={tag}>El bot propone operar: falta respuesta</SectionTitle>
            <Card>
              {proposals.map((p, i) => {
                const sd = sideOf(p.side);
                const info = proposalInfo(p.id);
                const out = stopOutcome(p.side, info.qty, p.ref_price, p.sl);
                const pc = pairName(p.symbol);
                const aiSaid = info.ai ? decisionText({ action: 'PROPOSE', reason: info.ai }, risk) : null;
                return (
                  <Item
                    key={p.id}
                    first={i === 0}
                    title={`${tradeTitle(p.symbol, p.side)}: ${sd.wins}`}
                    lines={[
                      `Precio ahora ≈ ${money(p.ref_price)}.`,
                      `Si ${sd.against} a ${money(p.sl)} se cierra sola${out ? ` y ${out}` : ''}.`,
                      `Si nadie responde, se descarta en ${until(p.expires_at)}.`,
                    ]}
                  >
                    <Explained value={aiSaid} />
                    {canControl ? (
                      <>
                        <View style={styles.buttons}>
                          <Button
                            small label="Aprobar" disabled={locked || !canAct} style={{ flex: 1 }}
                            onPress={() => confirm(`Aprobar ${sd.noun.toLowerCase()} de ${pc} (${w.paren})`,
                              `Se abrirá un ${sd.noun.toLowerCase()} de ${pc} con ${w.word}.`
                                + (out ? ` Si sale mal ${out.replace('perdería', 'pierdes')}.` : '')
                                + ' El bot puede negarse si ya no cumple sus límites.',
                              'Aprobar', () => answerBotProposal(p.id, 'approve', account))}
                          />
                          <Button
                            small kind="secondary" label="Rechazar" disabled={locked} style={{ flex: 1 }}
                            onPress={() => confirm(`Rechazar ${sd.noun.toLowerCase()} de ${pc}`,
                              'La propuesta se descarta y no se abre nada.', 'Rechazar',
                              () => answerBotProposal(p.id, 'reject', account), true)}
                          />
                        </View>
                        {!canAct && !!whyNot && <Text style={[type.small, { marginTop: space.sm }]}>{whyNot}</Text>}
                      </>
                    ) : (
                      <Text style={[type.small, { marginTop: space.sm }]}>Solo el dueño del bot puede responder.</Text>
                    )}
                  </Item>
                );
              })}
            </Card>
          </>
        )}

        {/* 3. Open a trade by hand. */}
        {started && symbols.length > 0 && (
          <Card title="Abrir operación" right={tag} style={ideaHere || ideaMissing ? styles.fromMarket : null}>
            {canControl ? (
              <>
                {!!ideaHere && (
                  <Text style={[type.bodyDim, { marginBottom: space.md }]}>
                    Vienes del análisis de {coin}
                    {ideaHere.side ? `: la idea era ${ideaHere.side === 'long' ? 'long (apostar a que sube)' : 'short (apostar a que baja)'}.` : '.'}
                  </Text>
                )}
                {!!ideaMissing && (
                  <Text style={[type.bodyDim, { marginBottom: space.md }]}>
                    El bot no opera {ideaMissing}. Solo opera {coins}.
                  </Text>
                )}
                <Segment
                  disabled={locked}
                  value={picked}
                  options={symbols.map((x) => ({ key: x, label: pairName(x) }))}
                  onChange={setPick}
                />
                <View style={styles.buttons}>
                  <Button
                    label={`Long ↑ ${coin}`} style={{ flex: 1 }}
                    disabled={locked || !canAct || pickedBusy}
                    onPress={() => askOpen('long')}
                  />
                  <Button
                    kind="danger" label={`Short ↓ ${coin}`} style={{ flex: 1 }}
                    disabled={locked || !canAct || pickedBusy}
                    onPress={() => askOpen('short')}
                  />
                </View>
                <Text style={[type.small, { marginTop: space.sm }]}>
                  {pickedBusy
                    ? `Ya hay una operación abierta en ${coin}. Ciérrala antes de abrir otra.`
                    : whyNot || (riskUsdt != null
                      ? `Arriesga unos ${amount(riskUsdt, 0)} (${riskPct} % del capital). El bot pone la cantidad y el cierre automático de pérdidas.`
                      : 'El bot pone la cantidad y el cierre automático de pérdidas.')}
                </Text>
                <Help label="¿Qué es long y short?" style={{ marginTop: space.sm }}>
                  Son apuestas sobre el precio en futuros, no comprar la moneda. Long gana si el precio sube; short gana
                  si baja. Para abrir un short no hace falta tener la moneda.
                </Help>
              </>
            ) : (
              <Text style={type.bodyDim}>Solo el dueño del bot puede abrir operaciones. Tú puedes ver todo lo que hace.</Text>
            )}
          </Card>
        )}

        {/* 4. What it holds now. */}
        <SectionTitle right={tag}>{`Operaciones ${w.adj} abiertas`}</SectionTitle>
        <Card>
          {open.length === 0 ? (
            <Text style={type.bodyDim}>{emptyOpen}</Text>
          ) : (
            <>
              {open.length > 1 && (
                <Text style={[styles.result, { color: pnlColor(openPnl), marginTop: 0, marginBottom: space.md }]}>
                  Entre todas {openPnl >= 0 ? 'va ganando' : 'va perdiendo'} {amount(Math.abs(openPnl))} (sin cerrar)
                  {totalLev != null ? ` · apalancamiento total ${es(totalLev, 1)}x${risk.max_total_leverage != null ? ` de ${es(risk.max_total_leverage, 0)}x máximo` : ''}` : ''}
                </Text>
              )}
              {open.map((t, i) => {
                const sd = sideOf(t.side);
                const tc = pairName(t.symbol);
                const why = whyOpened(t.id);
                const nb = numbers(t, t.price);
                const ev = (report.latest_evaluations || []).find((e) => e.symbol === t.symbol);
                const st = {
                  moved: t.sl != null && t.sl0 != null && Math.abs(t.sl - t.sl0) > 1e-9,
                  away: t.price ? (100 * Math.abs(t.sl - t.price)) / t.price : null,
                  atr: ev && ev.features && ev.features.atr > 0 && t.price ? ev.features.atr : null,
                };
                return (
                  <Fold
                    key={t.id}
                    first={i === 0}
                    title={tradeTitle(t.symbol, t.side)}
                    right={`${esSigned(t.open_pnl || 0)} ${cur}${nb.move != null ? ` (${esSigned(nb.move, 2)} %)` : ''}`}
                    rightColor={pnlColor(t.open_pnl)}
                    summary={`${nb.lev != null ? `${es(nb.lev, 1)}x · ` : ''}abierta ${timeAgo(t.entry_ts)} · stop ${money(t.sl)}${st.moved ? ' (movido a favor)' : ''}${t.tp != null ? ` · objetivo ${money(t.tp)}` : ''}`}
                  >
                    <TradeDetail
                      t={t} unit={unit} equity={a.equity} atr={st.atr} params={s.params || {}}
                      maxLev={risk.max_position_leverage} lev={nb.lev} size={nb.size} move={nb.move}
                    />
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
                        onPress={() => confirm(`Cerrar ${sd.noun.toLowerCase()} de ${tc} (${w.paren})`,
                          `Se cerrará al precio actual (≈ ${money(t.price)}). Resultado aproximado: ${signed(t.open_pnl)}. `
                            + 'No se puede deshacer.',
                          'Cerrar', () => closeBotPosition(t.symbol, account), true)}
                      />
                    )}
                  </Fold>
                );
              })}
            </>
          )}
        </Card>

        {/* 5. Everything else, closed until asked for. */}
        <SectionTitle>Más detalle</SectionTitle>

        <Collapsible
          title={w.results}
          right={all.trades ? esSigned(all.pnl, 0) : undefined}
          rightColor={all.trades ? pnlColor(all.pnl) : undefined}
          hint={all.trades ? `${all.trades} operaciones cerradas, en ${unit}` : 'Todavía no ha cerrado ninguna operación'}
        >
          {perfRows.map(([label, st], i) => {
            const n = st && st.trades ? st.trades : 0;
            const wins = n ? Math.round(((st.win_rate_pct || 0) * n) / 100) : 0;
            return (
              <Row
                key={label}
                first={i === 0}
                label={label}
                value={n ? `${signed(st.pnl)}${pctOfStart(st.pnl) ? ` (${pctOfStart(st.pnl)})` : ''}` : 'Sin operaciones cerradas'}
                color={n ? pnlColor(st.pnl) : colors.textMuted}
                help={n
                  ? `${n} ${n === 1 ? 'cerrada' : 'cerradas'} · ganó ${wins} y perdió ${n - wins} · media ${esSigned(st.pnl / n)} por operación`
                  : undefined}
              />
            );
          })}
          <Text style={[type.small, { marginTop: space.sm }]}>
            Con {w.word}, ya descontadas las comisiones. Es normal que pierda más veces de las que gana: sus ganancias
            suelen ser más grandes que sus pérdidas.
            {report.other_broker_trades > 0
              ? ` No se cuentan ${report.other_broker_trades} operaciones hechas antes con otro tipo de dinero.`
              : ''}
          </Text>
        </Collapsible>

        {!isReal && (
        <Collapsible
          title="Qué opina la IA"
          right={aiMode === 'off' ? 'Apagada' : stanceFresh ? stance.label : undefined}
          rightColor={aiMode === 'off' ? colors.textMuted : stance.color}
          hint={aiMode === 'shadow' ? 'Solo opina: no cambia lo que hace el bot' : undefined}
        >
          {aiMode === 'off' ? (
            <Text style={type.bodyDim}>La IA está apagada. El bot decide solo con sus reglas.</Text>
          ) : stanceFresh ? (
            <>
              <Text style={type.small}>{stance.hint}</Text>
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
        </Collapsible>
        )}

        {canControl && (
          <Collapsible title="Ajustes del bot" hint={isReal ? 'Quién decide abrir' : 'Quién decide abrir y cuánto manda la IA'}>
            <View style={[styles.control, styles.controlFirst]}>
              <Text style={type.heading}>Quién decide abrir</Text>
              <View style={{ marginTop: space.md }}>
                <Segment
                  disabled={locked || !started}
                  value={s.mode}
                  options={[{ key: 'auto', label: 'El bot decide solo' }, { key: 'manual', label: 'Me pregunta antes' }]}
                  onChange={(m) =>
                    m === 'auto'
                      ? confirm('Dejar que el bot decida solo',
                          `El bot abrirá operaciones sin preguntar, con ${w.word}.`
                            + (riskPct ? ` Cada una arriesga como mucho el ${riskPct} % del capital.` : '')
                            + (proposals.length ? ' Las propuestas pendientes siguen esperando tu respuesta.' : ''),
                          'Aceptar', () => setBotMode(m, account), kind === 'live' || !kind)
                      : run(() => setBotMode(m, account))
                  }
                />
              </View>
              <Text style={[type.small, { marginTop: space.sm }]}>
                {s.mode === 'manual'
                  ? 'El bot propone cada operación y espera a que la apruebes aquí. Te llega un aviso.'
                  : 'El bot abre las operaciones por su cuenta, siempre dentro de sus límites de riesgo.'}
              </Text>
            </View>

            {!isReal && (
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
                          'Dar autoridad', () => setBotAi(m, account), true)
                      : run(() => setBotAi(m, account))
                  }
                />
              </View>
              <Text style={[type.small, { marginTop: space.sm }]}>{AI_HINT[aiMode]}</Text>
            </View>
            )}

            {!isReal && (
            <Notice tone="warn" title="Esto sí es dinero real" style={{ marginTop: space.lg, marginBottom: 0 }}>
              {`Las consultas a la IA se pagan de verdad, aunque el bot opere con ${w.word}: ${es(ai.cost_usd_30d)} USD en los últimos 30 días.`}
            </Notice>
            )}
          </Collapsible>
        )}

        <Collapsible
          title={`Operaciones ${w.adj} cerradas`}
          hint={closed.length ? `Las ${closed.length} más recientes, en ${unit}` : 'Todavía ninguna'}
        >
          {closed.length === 0 ? (
            <Text style={type.bodyDim}>El bot aún no ha cerrado ninguna operación.</Text>
          ) : closed.map((t, i) => (
            <Item
              key={t.id}
              first={i === 0}
              title={tradeTitle(t.symbol, t.side)}
              right={`${esSigned(t.pnl)}${t.exit && t.entry ? ` (${esSigned((100 * t.side * (t.exit - t.entry)) / t.entry, 2)} %)` : ''}`}
              rightColor={pnlColor(t.pnl)}
              lines={[
                `Tamaño ${es(t.qty * t.entry, 0)} ${unit}${a.equity > 0 ? ` · apalancamiento ≈ ${es((t.qty * t.entry) / a.equity, 1)}x` : ''}${pctOfStart(t.pnl) ? ` · ${pctOfStart(t.pnl)} del capital` : ''}.`,
                `Entró a ${money(t.entry)}, cerró a ${money(t.exit)} · ${timeAgo(t.exit_ts)}.`,
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
      subtitle={report ? undefined : 'Opera solo, con reglas fijas'}
      money={notSetUp ? undefined : kind || undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {accountPicker}
      {isReal && !notSetUp && !!report && (
        real.enabled
          ? (!real.runner_alive && <Notice tone="warn" title="El servicio de bots reales está parado">Tu bot no está vigilando ahora. Lo que tengas abierto sigue en Binance con su cierre automático de pérdidas.</Notice>)
          : (
            <Notice tone="warn" title="Tu bot real está apagado">
              <Text style={type.bodyDim}>No abre ni vigila operaciones. Abajo ves lo que hizo mientras estuvo encendido.</Text>
              <Button small kind="secondary" label="Volver a activarlo" disabled={busy} onPress={turnRealOn} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
            </Notice>
          )
      )}
      {body()}
      {isReal && !notSetUp && !!report && real.enabled && (
        <Button kind="secondary" label="Apagar el bot real" disabled={busy} onPress={turnRealOff} style={{ marginTop: space.md }} />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  stateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fromMarket: { borderColor: colors.accent },
  foldToggle: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: space.xs },
  pendingRow: { flexDirection: 'row', alignItems: 'center' },
  dismiss: { alignSelf: 'flex-start', marginTop: space.xs, paddingHorizontal: 0, minHeight: 44 },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.md },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start' },
  itemTitleText: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  itemRight: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginLeft: space.md, lineHeight: 21 },
  result: { fontSize: 14, fontWeight: '700', marginTop: space.sm },
  outcomes: { flexDirection: 'row', gap: space.sm },
  outcome: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: space.sm, paddingHorizontal: 6, alignItems: 'center' },
  outcomeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textAlign: 'center' },
  outcomeValue: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  outcomePrice: { color: colors.textDim, fontSize: 11, marginTop: 3, textAlign: 'center' },
  outcomeNote: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt, marginTop: space.lg, marginHorizontal: 7 },
  trackLoss: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: `${colors.danger}55`, borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  trackWin: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: `${colors.accent}55`, borderTopRightRadius: 5, borderBottomRightRadius: 5 },
  trackGone: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.surfaceAlt, borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  tick: { position: 'absolute', top: -3, width: 2, height: 16, marginLeft: -1 },
  tickStop: { width: 4, marginLeft: -2, top: -4, height: 18, borderRadius: 2 },
  now: { position: 'absolute', top: -3, width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: colors.text, borderWidth: 3, borderColor: colors.surface },
  trackEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  trackEnd: { fontSize: 11, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm, columnGap: space.lg, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { color: colors.textDim, fontSize: 12 },
  step: { flexDirection: 'row', marginTop: 6 },
  stepBar: { width: 3, borderRadius: 2, marginRight: space.sm },
  facts: { flexDirection: 'row', marginTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
  fact: { flex: 1 },
  factLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  factValue: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  factDim: { color: colors.textMuted, fontWeight: '400', fontSize: 12 },
  detail: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  control: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: space.lg, paddingTop: space.lg },
  controlFirst: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
});

export default BotScreen;

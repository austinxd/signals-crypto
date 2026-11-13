"""Live engine. One process, one loop:

    every tick      -> heartbeat, user commands, stop/target sync, equity + kill switch
    every new bar   -> run the strategy on closed candles, manage open trades, act on signals

Modes (journal state `mode`):
    auto    the bot opens trades itself
    manual  the bot writes a proposal and waits for `python -m bot approve <id>`
Pause (journal state `paused`): no new entries; open positions keep their stops and trailing.
Every signal ends in exactly one journal decision: ENTER, PROPOSE, REJECT, SKIP or ERROR.
AI desk (journal state `ai`: off | shadow | reduce, see desk.py): woken by signals and events. It runs
after the risk engine and can only shrink or skip an entry; if it fails, the rules signal is taken as is.
"""
import time
from datetime import datetime, timezone
from typing import Optional

from . import data, risk as risk_mod
from .broker import make_broker, _next_minute_ms
from .config import BotConfig, TF_SECONDS, load_config
from .desk import Desk
from .journal import Journal
from .strategies import make_strategy


def _num(x) -> Optional[float]:
    return None if x is None or x != x else float(x)


def _px(x: float) -> str:
    return f"{x:,.0f}" if x >= 1000 else f"{x:,.2f}" if x >= 1 else f"{x:.4f}"


def _coin(symbol: str) -> str:
    return symbol[:-4] if symbol.endswith("USDT") else symbol


SIDE_ES = {1: "compra (long)", -1: "venta (short)"}
EXIT_ES = {"stop": "saltó el stop", "target": "llegó al objetivo", "manual": "cierre manual", "time": "por tiempo"}


class Engine:
    def __init__(self, cfg: Optional[BotConfig] = None, journal: Optional[Journal] = None, broker=None,
                 notifier=None):
        self.cfg = cfg or load_config()
        self.j = journal or Journal()
        self.strategy = make_strategy(self.cfg.strategy, **self.cfg.params)
        self.tf = self.strategy.timeframe
        self.tf_s = TF_SECONDS[self.tf]
        self.broker = broker or make_broker(self.cfg, self.j)
        if self.j.get_state("mode") is None:
            self.j.set_state("mode", "auto" if self.broker.name == "paper" else "manual")
        if self.j.get_state("paused") is None:
            self.j.set_state("paused", False)
        self.j.set_state("config", {**self.cfg.to_dict(), "params": self.strategy.p})
        self.j.set_state("broker", self.broker.name)
        if self.j.get_state("ai") is None:
            self.j.set_state("ai", "off")
        self.desk = Desk(self.cfg, self.j, self.strategy)
        self._last_snapshot = 0.0
        self._notifier = notifier  # callable(title, body, kind, symbol); None = stay silent (tests, backtests)
        self._last_funding = 0.0

    def _tell(self, title: str, body: str, kind: str = "bot_trade", symbol: str = None):
        """Push + in-app notice to the admins. Never lets a notification problem touch the trading loop."""
        if not self._notifier:
            return
        try:
            money = {"paper": "Dinero simulado.", "demo": "Cuenta demo."}.get(self.broker.name, "Dinero real.")
            self._notifier(f"Bot: {title}", f"{body} {money}", kind, symbol)
        except Exception as e:
            self.j.event("warn", "notify", repr(e)[:200])

    # -- main loop ----------------------------------------------------------------------------
    def run(self, once: bool = False):
        self.j.event("info", "start", f"engine started: {self.cfg.strategy} {self.tf} {self.cfg.symbols} "
                                      f"broker={self.broker.name} mode={self.j.get_state('mode')}")
        while True:
            try:
                self.tick()
            except KeyboardInterrupt:
                raise
            except Exception as e:  # keep running; the stop orders protect open positions meanwhile
                self.j.event("error", "tick", repr(e))
            if once:
                return
            try:
                time.sleep(self.cfg.tick_seconds)
            except KeyboardInterrupt:
                self.j.event("info", "stop", "engine stopped by user")
                return

    def tick(self):
        self.j.set_state("heartbeat", time.time())
        self._commands()
        self._funding()
        self._sync_trades()
        self._account_checks()
        self._bars()
        self._expire_proposals()
        try:
            self.desk.tick()
        except Exception as e:  # the desk is optional; it must never stop the trading loop
            self.j.event("error", "ai", repr(e)[:300])

    # -- account ------------------------------------------------------------------------------
    def _account_checks(self):
        acct = self.broker.account()
        equity = acct["equity"]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.j.get_state("day") != today:
            self.j.set_state("day", today)
            self.j.set_state("day_start_equity", equity)
        peak = max(self.j.get_state("peak_equity", equity), equity)
        self.j.set_state("peak_equity", peak)
        limit = self.cfg.risk.max_drawdown_halt
        if peak > 0 and equity <= peak * (1 - limit) and not self.j.get_state("paused"):
            self.j.set_paused(True, f"kill_switch: drawdown {1 - equity / peak:.1%} from peak (limit {limit:.0%})")
            self.j.set_state("peak_equity", equity)  # re-arm from here once the user resumes
            self._tell("se pausó por seguridad", f"El capital cayó {1 - equity / peak:.1%} desde su máximo (límite "
                       f"{limit:.0%}). No abrirá operaciones nuevas hasta que lo reanudes.", "bot_alert")
        if time.time() - self._last_snapshot >= 300:
            self.j.equity_point(equity, acct["balance"], acct["open_pnl"])
            self._last_snapshot = time.time()
        return acct

    def _risk(self, side: int, price: float, sl: float) -> risk_mod.Verdict:
        acct = self.broker.account()
        trades = self.j.open_trades()
        notional = sum(t["qty"] * t["entry"] for t in trades)
        return risk_mod.evaluate(self.cfg.risk, side, price, sl, acct["equity"], len(trades), notional,
                                 self.j.get_state("day_start_equity", acct["equity"]))

    # -- trades -------------------------------------------------------------------------------
    def _enter(self, symbol: str, side: int, qty: float, sl: float, tp: Optional[float], bar_time: str,
               note: str = "", briefing_id: Optional[int] = None) -> bool:
        try:
            fill = self.broker.open(symbol, side, qty, sl, tp)
        except Exception as e:
            self.j.decision(symbol, bar_time, "ERROR", side, f"order_failed: {e!r}")
            self.j.event("error", "order", f"{symbol}: {e!r}")
            return False
        now = time.time()
        tid = self.j.open_trade(
            symbol=symbol, side=side, qty=fill["qty"], strategy=self.cfg.strategy, broker=self.broker.name,
            entry_ts=now, entry=fill["entry"], sl0=sl, sl=sl, tp=tp, high_water=fill["entry"],
            low_water=fill["entry"], fees=fill["fee"], last_check_ms=_next_minute_ms(),
            last_funding_ms=int(now * 1000), orders=fill["orders"])
        self.desk.link_trade(briefing_id, tid)
        self.j.decision(symbol, bar_time, "ENTER", side, note or "signal",
                        {"trade_id": tid, "entry": fill["entry"], "qty": fill["qty"], "sl": sl, "tp": tp})
        risk = fill["qty"] * abs(fill["entry"] - sl)
        self._tell(f"abrió {SIDE_ES[side]} en {_coin(symbol)}",
                   f"Entrada {_px(fill['entry'])}, stop en {_px(sl)}. Si salta el stop pierde unos {risk:,.0f} USDT.",
                   "bot_trade", symbol)
        return True

    def _record_close(self, trade: dict, out: dict, reason: str):
        gross = trade["side"] * trade["qty"] * (out["exit"] - trade["entry"])
        fees = (trade["fees"] or 0) + out["fee"]
        pnl = gross - fees + (trade["funding"] or 0)
        r = pnl / (trade["qty"] * abs(trade["entry"] - trade["sl0"]))
        self.j.update_trade(trade["id"], status="closed", exit_ts=time.time(), exit=out["exit"],
                            exit_reason=reason, fees=fees, pnl=pnl, r=r)
        self.j.decision(trade["symbol"], "", "EXIT", trade["side"], reason,
                        {"trade_id": trade["id"], "exit": out["exit"], "pnl": pnl, "r": r})
        self._tell(f"cerró {_coin(trade['symbol'])} con {'ganancia' if pnl >= 0 else 'pérdida'} de {abs(pnl):,.2f} USDT",
                   f"{SIDE_ES[trade['side']].capitalize()} de {_px(trade['entry'])} a {_px(out['exit'])}. "
                   f"Motivo: {EXIT_ES.get(reason, reason)}.", "bot_trade", trade["symbol"])

    def _sync_trades(self):
        for trade in self.j.open_trades():
            out = self.broker.sync(trade)
            if out:
                self._record_close(trade, out, out["reason"])

    def _funding(self):
        if time.time() - self._last_funding < 300:
            return
        self._last_funding = time.time()
        for trade in self.j.open_trades():
            paid = self.broker.funding(trade)
            if paid:
                self.j.update_trade(trade["id"], funding=(trade["funding"] or 0) + paid)

    def _manage(self, trade: dict, row, bar_time: str):
        """Trailing / breakeven / time stop, evaluated on the bar that just closed."""
        p = self.strategy.p
        side = trade["side"]
        bars = (trade["bars"] or 0) + 1
        hw, lw = max(trade["high_water"], row["high"]), min(trade["low_water"], row["low"])
        self.j.update_trade(trade["id"], bars=bars, high_water=hw, low_water=lw)
        max_bars = int(p.get("max_bars") or 0)
        if max_bars and bars >= max_bars:
            self._record_close(trade, self.broker.close(trade), "time")
            return
        new_sl = risk_mod.managed_stop(side, trade["entry"], trade["sl0"], trade["sl"], hw, lw, _num(row["atr"]) or
                                       float("nan"), float(p.get("trail_atr") or 0), float(p.get("breakeven_r") or 0))
        if new_sl == trade["sl"]:
            return
        price = data.last_price(trade["symbol"])
        if (side > 0 and new_sl >= price) or (side < 0 and new_sl <= price):
            self._record_close(trade, self.broker.close(trade), "stop")  # price already through the new stop
            return
        orders = self.broker.move_stop(trade, new_sl)
        self.j.update_trade(trade["id"], sl=new_sl, orders=orders, last_check_ms=_next_minute_ms())
        self.j.decision(trade["symbol"], bar_time, "MOVE_SL", side, "trailing",
                        {"trade_id": trade["id"], "from": trade["sl"], "to": new_sl})

    # -- strategy -----------------------------------------------------------------------------
    def _bars(self):
        now = time.time()
        expected = (int(now) // self.tf_s - 1) * self.tf_s  # open time of the latest closed bar
        for symbol in self.cfg.symbols:
            key = f"last_bar:{symbol}"
            if (self.j.get_state(key) or 0) >= expected:
                continue
            df = data.recent_klines(symbol, self.tf)
            if len(df) < self.strategy.warmup + 10:
                self.j.event("warn", "data", f"{symbol}: only {len(df)} candles, need {self.strategy.warmup + 10}")
                self.j.set_state(key, expected)
                continue
            if int(df.index[-1].timestamp()) < expected:
                continue  # exchange has not published the bar yet; retry next tick
            prepared = self.strategy.prepare(df)
            row = prepared.iloc[-1]
            bar_time = str(df.index[-1])
            sig = int(row["sig"])
            self.j.evaluation(symbol, bar_time, sig, {f: _num(row.get(f)) for f in self.strategy.features})
            self.j.set_state(key, expected)

            trade = next((t for t in self.j.open_trades() if t["symbol"] == symbol), None)
            if trade:
                self._manage(trade, row, bar_time)
            elif sig != 0:
                age = now - (expected + self.tf_s)
                if age > max(300, self.tf_s * 0.1):
                    self.j.decision(symbol, bar_time, "SKIP", sig, f"stale_signal ({age / 60:.0f} min after bar close)")
                else:
                    self._signal(symbol, bar_time, sig, float(row["sl"]), _num(row["tp"]), prepared)

    def _signal(self, symbol: str, bar_time: str, side: int, sl: float, tp: Optional[float], prepared=None):
        if self.j.get_state("paused"):
            self.j.decision(symbol, bar_time, "SKIP", side, f"paused: {self.j.get_state('pause_reason', '')}")
            return
        price = data.last_price(symbol)
        v = self._risk(side, price, sl)
        if not v.ok:
            self.j.decision(symbol, bar_time, "REJECT", side, v.reason, {"price": price, "sl": sl})
            return
        mult, ai_note, bid = (1.0, "", None)
        if prepared is not None:
            try:
                mult, ai_note, bid = self.desk.review_signal(symbol, bar_time, side, sl, prepared)
            except Exception as e:
                self.j.event("error", "ai", f"signal review: {e!r}"[:300])
        if self.j.get_state("mode") == "manual":  # in manual mode the AI only advises; the user decides
            expires = (int(time.time()) // self.tf_s + 1) * self.tf_s
            pid = self.j.add_proposal(symbol, side, price, sl, tp, expires, bar_time)
            self.j.decision(symbol, bar_time, "PROPOSE", side, "awaiting_approval",
                            {"proposal_id": pid, "price": price, "sl": sl, "tp": tp, "qty": v.qty, "ai": ai_note})
            self._tell(f"propone {SIDE_ES[side]} en {_coin(symbol)}",
                       f"Precio {_px(price)}, stop en {_px(sl)}. Entra a la pestaña Bot para aprobarla o rechazarla; "
                       f"caduca en unas horas.", "bot_trade", symbol)
            return
        qty = v.qty * mult
        if mult <= 0 or qty * price < self.cfg.risk.min_notional:
            self.j.decision(symbol, bar_time, "SKIP", side, f"ai_veto: {ai_note}" if mult <= 0 else
                            f"ai_reduced_below_min_notional: {ai_note}", {"price": price, "sl": sl, "rules_qty": v.qty})
            return
        note = "; ".join(x for x in (v.note, ai_note) if x)
        self._enter(symbol, side, qty, sl, tp, bar_time, note, bid)

    # -- user commands ------------------------------------------------------------------------
    def _expire_proposals(self):
        for p in self.j.pending_proposals():
            if p["expires_at"] < time.time():
                self.j.set_proposal(p["id"], "expired")

    def _approve(self, pid: int) -> str:
        p = next((x for x in self.j.pending_proposals() if x["id"] == pid), None)
        if not p or p["expires_at"] < time.time():
            return "proposal not pending (expired or already handled)"
        if self.j.get_state("paused"):
            return "bot is paused; resume it before approving"
        if any(t["symbol"] == p["symbol"] for t in self.j.open_trades()):
            self.j.set_proposal(pid, "rejected", "position_already_open")
            return "position already open on this symbol"
        price, side, tp = data.last_price(p["symbol"]), p["side"], p["tp"]
        if tp is not None and side * (price - tp) >= 0:
            self.j.set_proposal(pid, "rejected", "price_past_target")
            return "price already reached the target; proposal discarded"
        v = self._risk(side, price, p["sl"])  # the user's approval does not bypass the risk engine
        if not v.ok:
            self.j.set_proposal(pid, "rejected", v.reason)
            self.j.decision(p["symbol"], p["bar_time"], "REJECT", side, f"on_approval: {v.reason}")
            return f"risk engine rejected it: {v.reason}"
        if not self._enter(p["symbol"], side, v.qty, p["sl"], tp, p["bar_time"], "approved_by_user"):
            return "order failed, see events"
        self.j.set_proposal(pid, "executed")
        return "executed"

    def _open_manual(self, symbol: str, side: int) -> str:
        """A trade the user asks for. Same stop distance as the strategy, same risk engine, same management."""
        if symbol not in self.cfg.symbols:
            return f"{symbol} is not one of the bot's symbols {self.cfg.symbols}"
        if side not in (1, -1):
            return "side must be long or short"
        if self.j.get_state("paused"):
            return "bot is paused; resume it before opening a trade"
        if any(t["symbol"] == symbol for t in self.j.open_trades()):
            return "position already open on this symbol"
        prepared = self.strategy.prepare(data.recent_klines(symbol, self.tf))
        atr = _num(prepared.iloc[-1]["atr"]) if len(prepared) else None
        if not atr:
            return "not enough candles to place a stop"
        price = data.last_price(symbol)
        sl = price - side * float(self.strategy.p.get("sl_atr") or 2.5) * atr
        v = self._risk(side, price, sl)  # asking by hand does not bypass the risk engine
        if not v.ok:
            self.j.decision(symbol, "", "REJECT", side, f"manual: {v.reason}", {"price": price, "sl": sl})
            return f"risk engine rejected it: {v.reason}"
        if not self._enter(symbol, side, v.qty, sl, None, "", "manual_by_user"):
            return "order failed, see events"
        return "executed"

    def _commands(self):
        for c in self.j.pending_commands():
            args = c.get("args") or {}
            try:
                if c["cmd"] == "approve":
                    result = self._approve(int(args["proposal_id"]))
                elif c["cmd"] == "reject":
                    self.j.set_proposal(int(args["proposal_id"]), "rejected", "by_user")
                    result = "rejected"
                elif c["cmd"] == "close":
                    target = str(args.get("symbol", "")).upper()
                    closed = []
                    for t in self.j.open_trades():
                        if target in ("ALL", t["symbol"]):
                            self._record_close(t, self.broker.close(t), "manual")
                            closed.append(t["symbol"])
                    result = f"closed {closed}" if closed else "no matching open position"
                elif c["cmd"] == "open":
                    result = self._open_manual(str(args.get("symbol", "")).upper(), int(args.get("side", 0)))
                else:
                    result = f"unknown command {c['cmd']}"
                self.j.finish_command(c["id"], "done", result)
            except Exception as e:
                self.j.finish_command(c["id"], "failed", repr(e))
                self.j.event("error", "command", f"{c['cmd']} {args}: {e!r}")

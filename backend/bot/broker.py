"""Brokers. Both expose the same small interface used by the engine:

    account()                      -> {"equity", "balance", "open_pnl"}
    open(symbol, side, qty, sl, tp)-> {"entry", "qty", "fee", "orders"}   (stop is live before returning)
    move_stop(trade, new_sl)       -> orders dict
    set_target(trade, tp)          -> orders dict (take profit added to an open position)
    close(trade)                   -> {"exit", "fee"}
    sync(trade)                    -> None while open, or {"exit", "fee", "reason"} once stopped/target hit
    funding(trade)                 -> funding paid(-)/received(+) since the last call

PaperBroker simulates fills against live Binance prices and is the default.
BinanceBroker sends real orders (demo or live account).
"""
import math
import os
import time
from typing import Any, Dict, Optional

from . import data, risk as risk_mod
from .config import BotConfig
from .journal import Journal


def _next_minute_ms() -> int:
    return (int(time.time()) // 60 + 1) * 60_000


class PaperBroker:
    name = "paper"

    def __init__(self, cfg: BotConfig, journal: Journal):
        self.cfg, self.j = cfg, journal
        if journal.get_state("paper_balance") is None:
            journal.set_state("paper_balance", cfg.paper_balance)

    def _balance(self) -> float:
        return float(self.j.get_state("paper_balance"))

    def _add(self, amount: float):
        self.j.set_state("paper_balance", self._balance() + amount)

    def account(self) -> Dict[str, float]:
        balance = self._balance()
        open_pnl = 0.0
        for t in self.j.open_trades():
            open_pnl += t["side"] * t["qty"] * (data.last_price(t["symbol"]) - t["entry"])
        return {"equity": balance + open_pnl, "balance": balance, "open_pnl": open_pnl}

    def open(self, symbol: str, side: int, qty: float, sl: float, tp: Optional[float]) -> Dict[str, Any]:
        entry = data.last_price(symbol) * (1 + self.cfg.costs.slippage * side)
        fee = qty * entry * self.cfg.costs.taker_fee
        self._add(-fee)
        return {"entry": entry, "qty": qty, "fee": fee, "orders": {}}

    def move_stop(self, trade: dict, new_sl: float) -> dict:
        return trade.get("orders") or {}

    def set_target(self, trade: dict, tp: float) -> dict:
        return trade.get("orders") or {}  # the journal's tp is what sync() checks

    def _exit(self, trade: dict, price: float) -> Dict[str, float]:
        price = price * (1 - self.cfg.costs.slippage * trade["side"])
        fee = trade["qty"] * price * self.cfg.costs.taker_fee
        self._add(trade["side"] * trade["qty"] * (price - trade["entry"]) - fee)
        return {"exit": price, "fee": fee}

    def close(self, trade: dict) -> Dict[str, float]:
        return self._exit(trade, data.last_price(trade["symbol"]))

    def sync(self, trade: dict) -> Optional[Dict[str, Any]]:
        """Check the stop/target against every 1m candle since the last check (wicks included)."""
        side, sl, tp = trade["side"], trade["sl"], trade["tp"]
        bars = data.klines_since(trade["symbol"], "1m", int(trade["last_check_ms"]))
        for ts, bar in bars.iterrows():
            hit = risk_mod.exit_fill(side, sl, tp, bar["open"], bar["high"], bar["low"])
            if hit:
                return {**self._exit(trade, hit[0]), "reason": hit[1]}
        if len(bars):
            # re-check the candle still forming next time
            self.j.update_trade(trade["id"], last_check_ms=int(bars.index[-1].timestamp() * 1000))
        else:
            # entry minute not finished yet: fall back to the last traded price
            price = data.last_price(trade["symbol"])
            hit = risk_mod.exit_fill(side, sl, tp, price, price, price)
            if hit:
                return {**self._exit(trade, hit[0]), "reason": hit[1]}
        return None

    def funding(self, trade: dict) -> float:
        total = 0.0
        last = int(trade["last_funding_ms"])
        for ts, rate, mark in data.funding_since(trade["symbol"], last + 1):
            mark = mark or trade["entry"]
            total += -trade["side"] * trade["qty"] * mark * rate
            last = ts
        if total:
            self._add(total)
        if last != int(trade["last_funding_ms"]):
            self.j.update_trade(trade["id"], last_funding_ms=last)
        return total


class BinanceBroker:
    """Real orders on Binance USDT-M futures through ccxt (one-way position mode only).

    Keys are passed in (an app account's own, see users.py) or come from BOT_BINANCE_KEY / BOT_BINANCE_SECRET. `demo=True` targets Binance demo trading.
    NOT YET EXERCISED AGAINST AN ACCOUNT: validate on demo before trusting it with money.
    """

    def __init__(self, cfg: BotConfig, journal: Journal, demo: bool, key: str = None, secret: str = None):
        import ccxt
        self.cfg, self.j, self.name = cfg, journal, "demo" if demo else "live"
        self._warned = {}  # trade id -> last time an unproven "closed" was logged
        key, secret = key or os.getenv("BOT_BINANCE_KEY"), secret or os.getenv("BOT_BINANCE_SECRET")
        if not key or not secret:
            raise RuntimeError("No Binance keys: pass them, or set BOT_BINANCE_KEY and BOT_BINANCE_SECRET")
        if not demo and os.getenv("BOT_ALLOW_LIVE") != "1":
            raise RuntimeError("Live trading is locked. Set BOT_ALLOW_LIVE=1 once demo results are validated")
        self.ex = ccxt.binance({"apiKey": key, "secret": secret, "enableRateLimit": True,
                                "options": {"defaultType": "future", "adjustForTimeDifference": True}})
        if demo:
            self.ex.enable_demo_trading(True)
        self.ex.load_markets()
        if str(self.ex.fapiPrivateGetPositionSideDual().get("dualSidePosition")).lower() == "true":
            raise RuntimeError("Account is in hedge mode; switch to one-way mode to use the bot")

    @staticmethod
    def _m(symbol: str) -> str:
        return f"{symbol[:-4]}/USDT:USDT"

    def account(self) -> Dict[str, float]:
        info = self.ex.fetch_balance()["info"]
        equity, balance = float(info["totalMarginBalance"]), float(info["totalWalletBalance"])
        return {"equity": equity, "balance": balance, "open_pnl": equity - balance}

    def _conditional(self, m: str, kind: str, side: int, price: float) -> str:
        order = self.ex.create_order(m, kind, "sell" if side > 0 else "buy", None, None, {
            "stopPrice": float(self.ex.price_to_precision(m, price)), "closePosition": True,
            "workingType": "MARK_PRICE"})
        return str(order["id"])

    def _cancel(self, m: str, order_id: Optional[str]):
        if order_id:
            try:
                self.ex.cancel_order(order_id, m, {"trigger": True})
            except Exception as e:  # already triggered/cancelled
                self.j.event("warn", "cancel_failed", f"{m} {order_id}: {e}")

    def open(self, symbol: str, side: int, qty: float, sl: float, tp: Optional[float]) -> Dict[str, Any]:
        m = self._m(symbol)
        self.ex.set_leverage(max(1, math.ceil(self.cfg.risk.max_position_leverage)), m)
        qty = float(self.ex.amount_to_precision(m, qty))
        try:
            order = self.ex.create_order(m, "market", "buy" if side > 0 else "sell", qty)
            if not order.get("average"):
                order = self.ex.fetch_order(order["id"], m)
            entry, filled = float(order["average"]), float(order["filled"])
        except Exception:
            # The answer was lost, not necessarily the order: a position nobody recorded would have no stop.
            left = self._position_qty(symbol)
            if left:
                self.ex.create_order(m, "market", "sell" if side > 0 else "buy", left, None, {"reduceOnly": True})
                self.j.event("error", "entry_unwound", f"{symbol}: the entry answered with an error but had filled "
                                                       f"{left:g}; closed it at once")
            raise
        try:
            orders = {"sl": self._conditional(m, "STOP_MARKET", side, sl)}
        except Exception:
            # never hold a position without a stop on the exchange
            self.ex.create_order(m, "market", "sell" if side > 0 else "buy", filled, None, {"reduceOnly": True})
            raise
        if tp is not None and tp == tp:
            try:
                orders["tp"] = self._conditional(m, "TAKE_PROFIT_MARKET", side, tp)
            except Exception as e:
                self.j.event("error", "tp_failed", f"{symbol}: target not placed ({e}); stop is active")
        return {"entry": entry, "qty": filled, "fee": filled * entry * self.cfg.costs.taker_fee, "orders": orders}

    def _replace(self, trade: dict, which: str, kind: str, price: float, old_price: Optional[float]) -> dict:
        """Binance keeps a single close-position order of each kind per side and refuses a second one (-4130),
        so the old order has to go before the new one is placed. If the new one is refused, the old level is put
        back and the journal told its id, so the position is never left without that order."""
        m = self._m(trade["symbol"])
        orders = dict(trade.get("orders") or {})
        self._cancel(m, orders.pop(which, None))
        try:
            try:
                orders[which] = self._conditional(m, kind, trade["side"], price)
            except Exception as e:
                if "-4130" not in repr(e):
                    raise
                # An order of this kind is still on the exchange (a cancel that never arrived, or one the journal
                # lost track of): find it there, remove it, and place the new one.
                self._clear(m, kind)
                orders[which] = self._conditional(m, kind, trade["side"], price)
        except Exception:
            if old_price:
                try:
                    orders[which] = self._conditional(m, kind, trade["side"], old_price)
                except Exception as e:
                    self.j.event("error", "order_lost", f"{trade['symbol']}: no {which} order on the exchange: {e!r}"[:300])
            self.j.update_trade(trade["id"], orders=orders)
            raise
        return orders

    def _clear(self, m: str, kind: str):
        """Cancel every open conditional order of this kind on the symbol, whatever the journal remembers."""
        for o in self.ex.fetch_open_orders(m, params={"trigger": True}):
            if str(o.get("type") or "").replace("_", "").lower() == kind.replace("_", "").lower():
                self.ex.cancel_order(o["id"], m, {"trigger": True})

    def ensure_stop(self, trade: dict) -> Optional[dict]:
        """A trade whose stop order was lost gets it back at the level the journal holds. None = nothing to do."""
        orders = dict(trade.get("orders") or {})
        if orders.get("sl"):
            return None
        m = self._m(trade["symbol"])
        try:
            orders["sl"] = self._conditional(m, "STOP_MARKET", trade["side"], trade["sl"])
        except Exception as e:
            if "-4130" not in repr(e):
                raise
            self._clear(m, "STOP_MARKET")
            orders["sl"] = self._conditional(m, "STOP_MARKET", trade["side"], trade["sl"])
        return orders

    def move_stop(self, trade: dict, new_sl: float) -> dict:
        return self._replace(trade, "sl", "STOP_MARKET", new_sl, trade.get("sl"))

    def set_target(self, trade: dict, tp: float) -> dict:
        """Add (or replace) the take-profit order of a position that is already open."""
        return self._replace(trade, "tp", "TAKE_PROFIT_MARKET", tp, trade.get("tp"))

    def _position_qty(self, symbol: str) -> float:
        for p in self.ex.fetch_positions([self._m(symbol)]):
            return abs(float(p.get("contracts") or 0))
        return 0.0

    def _closing_fills(self, trade: dict) -> list:
        """The fills that reduced this trade's position. Binance answers at most 7 days per request and, given
        only a start, returns the 7 days after it: a trade older than a week has to be read window by window."""
        m = self._m(trade["symbol"])
        closing = "sell" if trade["side"] > 0 else "buy"
        week, now, start, fills = 7 * 86_400_000 - 1, int(time.time() * 1000), int(trade["entry_ts"] * 1000), []
        while start <= now:
            fills += [f for f in self.ex.fetch_my_trades(m, since=start, limit=1000,
                                                         params={"until": min(start + week, now)})
                      if f["side"] == closing]
            start += week + 1
        return fills

    def _last_exit(self, trade: dict) -> Dict[str, float]:
        fills = self._closing_fills(trade)
        qty = sum(float(f["amount"]) for f in fills)
        if not qty:
            price = data.last_price(trade["symbol"])
            return {"exit": price, "fee": trade["qty"] * price * self.cfg.costs.taker_fee}
        price = sum(float(f["amount"]) * float(f["price"]) for f in fills) / qty
        fee = sum(float((f.get("fee") or {}).get("cost") or 0) for f in fills)
        return {"exit": price, "fee": fee}

    def close(self, trade: dict) -> Dict[str, float]:
        m = self._m(trade["symbol"])
        qty = self._position_qty(trade["symbol"])
        if qty:
            self.ex.create_order(m, "market", "sell" if trade["side"] > 0 else "buy", qty, None, {"reduceOnly": True})
        elif self._closed_qty(trade) < 0.5 * trade["qty"]:
            # same doubt as in sync(): no position and no closing fills is an answer not to act on
            raise RuntimeError(f"{trade['symbol']}: the exchange shows no position and no closing fills; not closing")
        for oid in (trade.get("orders") or {}).values():
            self._cancel(m, oid)
        return self._last_exit(trade)

    def _closed_qty(self, trade: dict) -> float:
        return sum(float(f["amount"]) for f in self._closing_fills(trade))

    def sync(self, trade: dict) -> Optional[Dict[str, Any]]:
        if self._position_qty(trade["symbol"]) > 0:
            return None
        # "No position" alone is not proof: an empty answer from the exchange would look the same, and
        # believing it would cancel the stop of a position that is still open. Require the closing fills.
        if self._closed_qty(trade) < 0.5 * trade["qty"]:
            if time.time() - self._warned.get(trade["id"], 0) > 600:
                self._warned[trade["id"]] = time.time()
                self.j.event("warn", "sync", f"{trade['symbol']}: the exchange shows no position but no closing "
                                             f"fills either; leaving the trade and its orders as they are")
            return None
        m = self._m(trade["symbol"])
        for oid in (trade.get("orders") or {}).values():
            self._cancel(m, oid)
        out = self._last_exit(trade)
        favourable = trade["side"] * (out["exit"] - trade["entry"]) > 0
        at_target = trade["tp"] is not None and favourable and abs(out["exit"] - trade["tp"]) < abs(out["exit"] - trade["sl"])
        return {**out, "reason": "target" if at_target else "stop"}

    def funding(self, trade: dict) -> float:
        m = self._m(trade["symbol"])
        last = int(trade["last_funding_ms"])
        total = 0.0
        for f in self.ex.fetch_funding_history(m, since=last + 1):
            total += float(f["amount"])
            last = max(last, int(f["timestamp"]))
        if last != int(trade["last_funding_ms"]):
            self.j.update_trade(trade["id"], last_funding_ms=last)
        return total


def make_broker(cfg: BotConfig, journal: Journal):
    if cfg.broker == "paper":
        return PaperBroker(cfg, journal)
    if cfg.broker in ("demo", "live"):
        return BinanceBroker(cfg, journal, demo=cfg.broker == "demo")
    raise ValueError(f"Unknown broker '{cfg.broker}'")

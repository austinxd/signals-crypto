"""SQLite journal: everything the bot sees, decides and does. This is the single source of truth
that the report (and whoever analyses the bot) reads.

Tables
    state        key/value: mode, paused, balances, peak equity, heartbeat...
    evaluations  one row per symbol per closed bar: the features the strategy saw and its signal
    decisions    every signal and what happened to it (ENTER / PROPOSE / REJECT / SKIP / EXIT / MOVE_SL)
    proposals    trades awaiting user approval (manual mode)
    trades       open and closed positions with full economics
    equity       equity snapshots
    events       errors, pauses, kill switch, restarts
    commands     requests from the CLI / API that the running engine must execute
    ai_briefings what the AI desk was shown each time it was woken, and why
    ai_calls     one row per model per wake-up: its answer, whether it was applied, cost, errors
"""
import json
import sqlite3
import time
from typing import Any, Dict, List, Optional

from .config import DATA_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT, updated_at REAL);
CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY, ts REAL, symbol TEXT, bar_time TEXT, sig INTEGER, features TEXT,
    UNIQUE(symbol, bar_time));
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY, ts REAL, symbol TEXT, bar_time TEXT, action TEXT, side INTEGER,
    reason TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY, ts REAL, symbol TEXT, side INTEGER, ref_price REAL, sl REAL, tp REAL,
    expires_at REAL, status TEXT, bar_time TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY, symbol TEXT, side INTEGER, qty REAL, strategy TEXT, broker TEXT,
    entry_ts REAL, entry REAL, sl0 REAL, sl REAL, tp REAL, high_water REAL, low_water REAL, bars INTEGER,
    exit_ts REAL, exit REAL, exit_reason TEXT, pnl REAL, fees REAL, funding REAL, r REAL,
    status TEXT, last_check_ms INTEGER, last_funding_ms INTEGER, orders TEXT);
CREATE TABLE IF NOT EXISTS equity (ts REAL, equity REAL, balance REAL, open_pnl REAL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts REAL, level TEXT, kind TEXT, message TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY, ts REAL, cmd TEXT, args TEXT, status TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS ai_briefings (
    id INTEGER PRIMARY KEY, ts REAL, kind TEXT, trigger TEXT, symbol TEXT, bar_time TEXT, side INTEGER,
    text TEXT, trade_id INTEGER);
CREATE TABLE IF NOT EXISTS ai_calls (
    id INTEGER PRIMARY KEY, ts REAL, briefing_id INTEGER, kind TEXT, model TEXT, role TEXT, verdict TEXT,
    mult REAL, applied INTEGER, answer TEXT, cost REAL, seconds REAL, error TEXT);
CREATE INDEX IF NOT EXISTS idx_ai_calls_ts ON ai_calls(ts);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts);
"""


class Journal:
    def __init__(self, path=None):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.path = str(path or DATA_DIR / "bot.db")
        self.db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)

    # -- helpers ------------------------------------------------------------------------------
    def rows(self, sql: str, args=()) -> List[Dict[str, Any]]:
        out = []
        for r in self.db.execute(sql, args).fetchall():
            d = dict(r)
            for k in ("features", "data", "args", "orders", "answer"):
                if d.get(k):
                    d[k] = json.loads(d[k])
            out.append(d)
        return out

    def _insert(self, table: str, **cols) -> int:
        keys = ", ".join(cols)
        marks = ", ".join("?" for _ in cols)
        cur = self.db.execute(f"INSERT INTO {table} ({keys}) VALUES ({marks})", list(cols.values()))
        return cur.lastrowid

    # -- state --------------------------------------------------------------------------------
    def get_state(self, key: str, default=None):
        row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_state(self, key: str, value):
        self.db.execute(
            "INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, json.dumps(value), time.time()))

    def all_state(self) -> Dict[str, Any]:
        return {r["key"]: json.loads(r["value"]) for r in self.db.execute("SELECT key, value FROM state")}

    def set_paused(self, paused: bool, reason: str):
        self.set_state("paused", paused)
        self.set_state("pause_reason", reason)
        self.event("warn" if paused else "info", "pause" if paused else "resume", reason or "resumed")

    # -- writes -------------------------------------------------------------------------------
    def evaluation(self, symbol: str, bar_time: str, sig: int, features: dict):
        self.db.execute(
            "INSERT OR IGNORE INTO evaluations (ts, symbol, bar_time, sig, features) VALUES (?,?,?,?,?)",
            (time.time(), symbol, bar_time, sig, json.dumps(features)))

    def decision(self, symbol: str, bar_time: str, action: str, side: int, reason: str, data: Optional[dict] = None) -> int:
        return self._insert("decisions", ts=time.time(), symbol=symbol, bar_time=bar_time, action=action,
                            side=side, reason=reason, data=json.dumps(data or {}))

    def event(self, level: str, kind: str, message: str, data: Optional[dict] = None):
        self._insert("events", ts=time.time(), level=level, kind=kind, message=message, data=json.dumps(data or {}))

    def equity_point(self, equity: float, balance: float, open_pnl: float):
        self._insert("equity", ts=time.time(), equity=equity, balance=balance, open_pnl=open_pnl)

    def add_proposal(self, symbol, side, ref_price, sl, tp, expires_at, bar_time) -> int:
        return self._insert("proposals", ts=time.time(), symbol=symbol, side=side, ref_price=ref_price, sl=sl,
                            tp=tp, expires_at=expires_at, status="pending", bar_time=bar_time, note="")

    def set_proposal(self, pid: int, status: str, note: str = ""):
        self.db.execute("UPDATE proposals SET status=?, note=? WHERE id=?", (status, note, pid))

    def open_trade(self, **cols) -> int:
        cols.setdefault("status", "open")
        cols.setdefault("bars", 0)
        cols.setdefault("fees", 0.0)
        cols.setdefault("funding", 0.0)
        if "orders" in cols:
            cols["orders"] = json.dumps(cols["orders"])
        return self._insert("trades", **cols)

    def update_trade(self, trade_id: int, **cols):
        if "orders" in cols:
            cols["orders"] = json.dumps(cols["orders"])
        sets = ", ".join(f"{k}=?" for k in cols)
        self.db.execute(f"UPDATE trades SET {sets} WHERE id=?", [*cols.values(), trade_id])

    def ai_briefing(self, kind: str, trigger: str, text: str, symbol: str = "", bar_time: str = "", side: int = 0) -> int:
        return self._insert("ai_briefings", ts=time.time(), kind=kind, trigger=trigger, symbol=symbol,
                            bar_time=bar_time, side=side, text=text)

    def ai_call(self, briefing_id: int, kind: str, model: str, role: str, verdict: str = "", mult: Optional[float] = None,
                applied: bool = False, answer: Optional[dict] = None, cost: float = 0.0, seconds: float = 0.0,
                error: str = "") -> int:
        return self._insert("ai_calls", ts=time.time(), briefing_id=briefing_id, kind=kind, model=model, role=role,
                            verdict=verdict, mult=mult, applied=int(applied), answer=json.dumps(answer or {}),
                            cost=cost, seconds=seconds, error=error)

    def add_command(self, cmd: str, args: dict) -> int:
        return self._insert("commands", ts=time.time(), cmd=cmd, args=json.dumps(args), status="pending", result="")

    def finish_command(self, cid: int, status: str, result: str):
        self.db.execute("UPDATE commands SET status=?, result=? WHERE id=?", (status, result, cid))

    # -- reads --------------------------------------------------------------------------------
    def open_trades(self) -> List[Dict[str, Any]]:
        return self.rows("SELECT * FROM trades WHERE status='open' ORDER BY id")

    def pending_commands(self) -> List[Dict[str, Any]]:
        return self.rows("SELECT * FROM commands WHERE status='pending' ORDER BY id")

    def pending_proposals(self) -> List[Dict[str, Any]]:
        return self.rows("SELECT * FROM proposals WHERE status='pending' ORDER BY id")

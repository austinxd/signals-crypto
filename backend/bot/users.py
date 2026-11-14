"""Real bots: one per app account, on that account's own Binance futures, with the keys it saved in the app.

    python -m bot run-users     one process that runs every account that turned its bot on

Each account gets its own journal under REAL_DATA_DIR/users/<id>/ and the same strategy and risk rules as the
simulated bot. A new real bot starts in manual mode (it proposes, the owner approves) with the AI desk off.
Nothing here sends an order unless the process was started with BOT_ALLOW_LIVE=1.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

from . import config
from .journal import Journal

RETRY_SECONDS = 300      # after a bot failed to start (bad keys, hedge mode...)
RUNNER_STALE = 180       # the app treats the runner as stopped after this long without a heartbeat


def _root() -> Path:
    return config.REAL_DATA_DIR / "users"


def _dir(user_id: int) -> Path:
    return _root() / str(int(user_id))


def journal(user_id: int) -> Optional[Journal]:
    """The account's journal, or None if its bot never started."""
    path = _dir(user_id) / "bot.db"
    return Journal(path) if path.exists() else None


def _read(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _write(path: Path, value: Dict[str, Any]):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value))
    tmp.replace(path)


def status(user_id: int) -> Dict[str, Any]:
    """What the app needs to explain why a real bot is or is not running."""
    from database import SessionLocal, UserAccount
    db = SessionLocal()
    try:
        acc = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        enabled, has_keys = bool(acc and acc.bot_real_enabled), bool(acc and acc.has_binance_keys())
    finally:
        db.close()
    runner = _read(_root() / "runner.json")
    mine = _read(_dir(user_id) / "status.json")
    return {
        "enabled": enabled,
        "has_keys": has_keys,
        "runner_alive": bool(runner.get("ts") and time.time() - runner["ts"] < RUNNER_STALE),
        "live_allowed": bool(runner.get("live_allowed")),
        "start_error": mine.get("error") if enabled else None,
    }


def set_enabled(user_id: int, enabled: bool) -> Dict[str, Any]:
    from database import SessionLocal, UserAccount
    db = SessionLocal()
    try:
        acc = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if acc is None:
            raise ValueError("account not found")
        if enabled and not acc.has_binance_keys():
            raise ValueError("connect your Binance keys first")
        acc.bot_real_enabled = enabled
        db.commit()
    finally:
        db.close()
    _write(_dir(user_id) / "status.json", {})  # forget an old start error: the runner tries again now
    return {"enabled": enabled}


def _plain_error(e: Exception) -> str:
    """Why a bot could not start, as a short code the app turns into a sentence."""
    text = repr(e).lower()
    if "hedge mode" in text:
        return "hedge_mode"
    if "-2015" in text or "invalid api-key" in text or "permission" in text or "authentication" in text:
        return "keys_rejected"
    if "decrypt" in text or "invalidtoken" in text:
        return "keys_unreadable"
    return "other: " + repr(e)[:160]


def _start(user_id: int, key: str, secret: str):
    from . import notify
    from .broker import BinanceBroker
    from .engine import Engine
    d = _dir(user_id)
    d.mkdir(parents=True, exist_ok=True)
    cfg = config.load_config()  # same strategy and risk rules as the simulated bot
    cfg.broker = "live"
    j = Journal(d / "bot.db")
    broker = BinanceBroker(cfg, j, demo=False, key=key, secret=secret)
    eng = Engine(cfg, j, broker, notifier=lambda *a, **k: notify.send(*a, user_ids=[user_id], **k))
    j.event("info", "start", f"real bot started for account {user_id} mode={j.get_state('mode')}")
    return eng


def run(once: bool = False):
    """Runs every enabled account, one after another, forever."""
    from database import SessionLocal, UserAccount
    live_allowed = os.getenv("BOT_ALLOW_LIVE") == "1"
    engines: Dict[int, Any] = {}     # user id -> (engine, key fingerprint)
    failed: Dict[int, tuple] = {}    # user id -> (when, key fingerprint)
    tick_seconds = config.load_config().tick_seconds
    print(f"[bot.users] runner started; live orders {'ALLOWED' if live_allowed else 'LOCKED (set BOT_ALLOW_LIVE=1)'}")
    while True:
        _write(_root() / "runner.json", {"ts": time.time(), "live_allowed": live_allowed})
        wanted: Dict[int, tuple] = {}
        try:
            db = SessionLocal()
            try:
                for acc in db.query(UserAccount).filter(UserAccount.bot_real_enabled == True).all():  # noqa: E712
                    if acc.has_binance_keys():
                        wanted[acc.id] = (acc.binance_api_key, acc.binance_api_secret, acc)
                keys = {}
                for uid, (ek, es, acc) in wanted.items():
                    if uid not in engines or engines[uid][1] != ek:
                        try:
                            keys[uid] = acc.get_binance_keys()
                        except Exception as e:
                            _write(_dir(uid) / "status.json", {"error": _plain_error(e), "ts": time.time()})
            finally:
                db.close()
        except Exception as e:  # database down: keep managing the bots already running
            print(f"[bot.users] could not read accounts: {e!r}")
            wanted, keys = {uid: (fp, None, None) for uid, (_, fp) in engines.items()}, {}

        for uid in [u for u in engines if u not in wanted or engines[u][1] != wanted[u][0]]:
            engines[uid][0].j.event("info", "stop", "real bot turned off (or keys changed); positions keep their stops on Binance")
            del engines[uid]
        if live_allowed:
            for uid, (key, secret) in keys.items():
                fp = wanted[uid][0]
                if uid in failed and failed[uid][1] == fp and time.time() - failed[uid][0] < RETRY_SECONDS:
                    continue
                try:
                    engines[uid] = (_start(uid, key, secret), fp)
                    failed.pop(uid, None)
                    _write(_dir(uid) / "status.json", {})
                except Exception as e:
                    failed[uid] = (time.time(), fp)
                    _write(_dir(uid) / "status.json", {"error": _plain_error(e), "ts": time.time()})
                    print(f"[bot.users] account {uid} did not start: {e!r}"[:300])
        for uid, (eng, _) in list(engines.items()):
            try:
                eng.tick()
            except Exception as e:  # one account's problem never stops the others; stops on Binance protect it
                eng.j.event("error", "tick", repr(e))
        if once:
            return
        time.sleep(tick_seconds)

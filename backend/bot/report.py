"""Read-only view of the journal: what the bot is doing, why, and how it is performing.

    python -m bot report            human-readable
    python -m bot report --json     everything, machine-readable
"""
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from . import data
from .journal import Journal


def _iso(ts) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M") if ts else "-"


def _stats(trades: List[dict]) -> Dict[str, Any]:
    if not trades:
        return {"trades": 0}
    pnl = [t["pnl"] for t in trades]
    wins = sum(p for p in pnl if p > 0)
    losses = -sum(p for p in pnl if p <= 0)
    return {
        "trades": len(trades),
        "pnl": sum(pnl),
        "win_rate_pct": 100 * sum(1 for p in pnl if p > 0) / len(pnl),
        "profit_factor": wins / losses if losses > 0 else None,
        "avg_r": sum(t["r"] for t in trades) / len(trades),
        "fees": sum(t["fees"] or 0 for t in trades),
        "funding": sum(t["funding"] or 0 for t in trades),
    }


def build(trades: int = 15, decisions: int = 20, journal: Journal = None, live_prices: bool = True) -> Dict[str, Any]:
    j = journal or Journal()
    now = time.time()
    state = j.all_state()
    cfg = state.get("config") or {}
    heartbeat = state.get("heartbeat")

    open_trades = j.open_trades()
    for t in open_trades:
        try:
            price = data.last_price(t["symbol"]) if live_prices else t["entry"]
        except Exception:
            price = t["entry"]
        t["price"] = price
        t["open_pnl"] = t["side"] * t["qty"] * (price - t["entry"])
        t["open_r"] = t["open_pnl"] / (t["qty"] * abs(t["entry"] - t["sl0"]))

    closed = j.rows("SELECT * FROM trades WHERE status='closed' ORDER BY exit_ts")
    last_eq = j.rows("SELECT * FROM equity ORDER BY ts DESC LIMIT 1")
    equity = last_eq[0]["equity"] if last_eq else state.get("paper_balance")
    peak = state.get("peak_equity")
    day_start = state.get("day_start_equity")
    counts = j.rows("SELECT action, reason, COUNT(*) AS n FROM decisions WHERE ts > ? "
                    "GROUP BY action, reason ORDER BY n DESC", (now - 30 * 86400,))
    by_symbol = {}
    for t in closed:
        by_symbol.setdefault(t["symbol"], []).append(t)

    return {
        "generated_at": _iso(now),
        "status": {
            "running": bool(heartbeat and now - heartbeat < 3 * (cfg.get("tick_seconds") or 20) + 60),
            "heartbeat_age_s": round(now - heartbeat) if heartbeat else None,
            "mode": state.get("mode"),
            "paused": state.get("paused"),
            "pause_reason": state.get("pause_reason"),
            "broker": state.get("broker"),
            "strategy": cfg.get("strategy"),
            "params": cfg.get("params"),
            "symbols": cfg.get("symbols"),
            "risk": cfg.get("risk"),
        },
        "account": {
            "equity": equity,
            "peak_equity": peak,
            "drawdown_pct": 100 * (1 - equity / peak) if equity and peak else None,
            "day_pnl_pct": 100 * (equity / day_start - 1) if equity and day_start else None,
        },
        "open_trades": open_trades,
        "pending_proposals": j.pending_proposals(),
        "performance": {
            "all": _stats(closed),
            "last_7d": _stats([t for t in closed if t["exit_ts"] > now - 7 * 86400]),
            "last_30d": _stats([t for t in closed if t["exit_ts"] > now - 30 * 86400]),
            "by_symbol": {s: _stats(ts) for s, ts in by_symbol.items()},
        },
        "recent_trades": closed[-trades:][::-1],
        "decision_counts_30d": counts,
        "recent_decisions": j.rows("SELECT * FROM decisions ORDER BY id DESC LIMIT ?", (decisions,)),
        "latest_evaluations": j.rows(
            "SELECT e.* FROM evaluations e JOIN (SELECT symbol, MAX(id) AS id FROM evaluations GROUP BY symbol) m "
            "ON e.id = m.id ORDER BY e.symbol"),
        "recent_events": j.rows("SELECT * FROM events ORDER BY id DESC LIMIT 15"),
        "recent_commands": j.rows("SELECT * FROM commands ORDER BY id DESC LIMIT 5"),
        "ai": {
            "mode": state.get("ai", "off"),
            "stance": state.get("ai_stance"),
            "config": cfg.get("ai"),
            "cost_usd_30d": j.rows("SELECT COALESCE(SUM(cost), 0) AS c FROM ai_calls WHERE ts > ?", (now - 30 * 86400,))[0]["c"],
            "recent_calls": j.rows(
                "SELECT c.id, c.ts, c.kind, c.model, c.role, c.verdict, c.mult, c.applied, c.cost, c.seconds, c.error, "
                "c.answer, b.trigger, b.symbol, b.bar_time, b.trade_id FROM ai_calls c JOIN ai_briefings b "
                "ON b.id = c.briefing_id ORDER BY c.id DESC LIMIT ?", (decisions,)),
        },
    }


def _side(s) -> str:
    return "LONG" if s and s > 0 else "SHORT"


def _f(x, spec=".2f") -> str:
    return "-" if x is None else format(x, spec)


def render(r: Dict[str, Any]) -> str:
    s, a = r["status"], r["account"]
    out = [f"BOT REPORT  {r['generated_at']} UTC", ""]
    run = "RUNNING" if s["running"] else "NOT RUNNING"
    paused = f"PAUSED ({s['pause_reason']})" if s["paused"] else "active"
    out.append(f"engine: {run} (heartbeat {_f(s['heartbeat_age_s'], 'd')}s ago) | {paused} | mode={s['mode']} "
               f"| broker={s['broker']}")
    out.append(f"strategy: {s['strategy']} {s['params'] or ''} on {s['symbols']}")
    out.append(f"equity: {_f(a['equity'])}  peak: {_f(a['peak_equity'])}  drawdown: {_f(a['drawdown_pct'])}%  "
               f"today: {_f(a['day_pnl_pct'], '+.2f')}%")

    out += ["", f"OPEN TRADES ({len(r['open_trades'])})"]
    for t in r["open_trades"]:
        out.append(f"  #{t['id']} {t['symbol']} {_side(t['side'])} qty={t['qty']:.4g} entry={t['entry']:.6g} "
                   f"now={t['price']:.6g} sl={t['sl']:.6g} tp={_f(t['tp'], '.6g')} "
                   f"pnl={t['open_pnl']:+.2f} ({t['open_r']:+.2f}R) since {_iso(t['entry_ts'])}")

    if r["pending_proposals"]:
        out += ["", "PENDING PROPOSALS (approve with: python -m bot approve <id>)"]
        for p in r["pending_proposals"]:
            out.append(f"  #{p['id']} {p['symbol']} {_side(p['side'])} ref={p['ref_price']:.6g} sl={p['sl']:.6g} "
                       f"tp={_f(p['tp'], '.6g')} expires {_iso(p['expires_at'])}")

    out += ["", "PERFORMANCE (closed trades, net of fees and funding)"]
    for label, st in (("all", r["performance"]["all"]), ("30d", r["performance"]["last_30d"]),
                      ("7d", r["performance"]["last_7d"])):
        if st["trades"]:
            out.append(f"  {label:>4}: trades={st['trades']} pnl={st['pnl']:+.2f} win={st['win_rate_pct']:.0f}% "
                       f"PF={_f(st['profit_factor'])} avgR={st['avg_r']:+.2f} fees={st['fees']:.2f} "
                       f"funding={st['funding']:+.2f}")
        else:
            out.append(f"  {label:>4}: no closed trades")
    for sym, st in r["performance"]["by_symbol"].items():
        out.append(f"  {sym}: trades={st['trades']} pnl={st['pnl']:+.2f} avgR={st['avg_r']:+.2f}")

    out += ["", "RECENT TRADES"]
    for t in r["recent_trades"]:
        out.append(f"  #{t['id']} {t['symbol']} {_side(t['side'])} {_iso(t['entry_ts'])} -> {_iso(t['exit_ts'])} "
                   f"entry={t['entry']:.6g} exit={t['exit']:.6g} {t['exit_reason']} pnl={t['pnl']:+.2f} ({t['r']:+.2f}R)")

    out += ["", "DECISIONS, LAST 30 DAYS (action / reason / count)"]
    for c in r["decision_counts_30d"]:
        out.append(f"  {c['action']:<8} {c['reason']:<45} {c['n']}")

    out += ["", "RECENT DECISIONS"]
    for d in r["recent_decisions"]:
        out.append(f"  {_iso(d['ts'])} {d['symbol']:<9} {d['action']:<8} {_side(d['side']):<5} {d['reason']}")

    out += ["", "LATEST STRATEGY READING PER SYMBOL"]
    for e in r["latest_evaluations"]:
        feats = " ".join(f"{k}={_f(v, '.6g')}" for k, v in (e["features"] or {}).items())
        out.append(f"  {e['symbol']} bar={e['bar_time']} sig={e['sig']:+d} | {feats}")

    ai = r.get("ai") or {}
    st = ai.get("stance") or {}
    out += ["", f"AI DESK: {ai.get('mode', 'off')} | stance: {st.get('stance', 'normal (default)')} "
                f"| model cost last 30d: {ai.get('cost_usd_30d') or 0:.2f} USD"]
    if st:
        out.append(f"  stance set {_iso(st['ts'])} by {st.get('model')} ({st.get('trigger')}): {st.get('reason')}")
    for c in ai.get("recent_calls", []):
        what = c["error"] or (c["answer"] or {}).get("reason", "")
        out.append(f"  {_iso(c['ts'])} {c['kind']:<6} {c['symbol'] or '':<9} {c['model']:<18} {c['role']:<7} "
                   f"{c['verdict'] or 'ERROR':<8} {'applied' if c['applied'] else '-':<7} {what[:140]}")

    out += ["", "RECENT EVENTS"]
    for e in r["recent_events"]:
        out.append(f"  {_iso(e['ts'])} [{e['level']}] {e['kind']}: {e['message']}")
    return "\n".join(out)

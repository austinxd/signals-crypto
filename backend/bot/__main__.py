"""Command line for the bot. Run from backend/:  python -m bot <command>"""
import argparse
import json
import sys


def _parse_params(items):
    out = {}
    for item in items or []:
        k, _, v = item.partition("=")
        try:
            out[k] = json.loads(v)
        except json.JSONDecodeError:
            out[k] = v
    return out


def _fmt_metrics(m):
    if not m.get("trades"):
        return f"trades=0  return={m.get('return_pct', 0):+.1f}%"
    return (f"return={m['return_pct']:+7.1f}%  cagr={m['cagr_pct']:+6.1f}%  maxDD={m['max_dd_pct']:5.1f}%  "
            f"sharpe={m['sharpe']:5.2f}  trades={m['trades']:4d}  win={m['win_rate_pct']:4.1f}%  "
            f"PF={m['profit_factor']:4.2f}  avgR={m['avg_r']:+.2f}  fees={m['fees']:.0f}  funding={m['funding']:+.0f}")


def cmd_backtest(args):
    from . import backtest as bt
    from .config import load_config
    from .strategies import make_strategy
    cfg = load_config()
    symbols = args.symbols or cfg.symbols
    st = make_strategy(args.strategy, **_parse_params(args.param))
    klines, funding = bt.load_market(symbols, st.timeframe, args.start, args.end, refresh=not args.offline)
    prepared = {s: st.prepare(df) for s, df in klines.items()}
    print(f"strategy={st.name} tf={st.timeframe} params={st.p}")
    print(f"symbols={symbols}  risk/trade={cfg.risk.risk_per_trade:.2%}  fee={cfg.costs.taker_fee:.2%} "
          f"slippage={cfg.costs.slippage:.2%}")
    periods = [("full", args.start, args.end)]
    if args.split:
        periods += [("in-sample", args.start, args.split), ("out-of-sample", args.split, args.end)]
    for label, s, e in periods:
        res = bt.backtest_strategy(st, klines, funding, cfg.risk, cfg.costs, start=s, end=e, prepared=prepared)
        bh = bt.buy_and_hold(klines, s, e)
        print(f"\n[{label}] {s} -> {e or 'now'}")
        print("  " + _fmt_metrics(res.metrics()))
        if bh:
            print(f"  buy&hold (equal weight, 1x): return={bh['return_pct']:+.1f}%  maxDD={bh['max_dd_pct']:.1f}%")
        if res.rejected:
            print(f"  rejected by risk engine: {res.rejected}")
        if label == "full" and len(res.trades):
            t = res.trades
            by_sym = t.groupby("symbol")["pnl"].agg(["count", "sum"]).round(0)
            by_year = t.groupby(t["exit_time"].dt.year)["pnl"].agg(["count", "sum"]).round(0)
            by_side = t.groupby("side")["pnl"].agg(["count", "sum"]).round(0)
            print("  pnl by symbol:", {k: (int(v["count"]), float(v["sum"])) for k, v in by_sym.iterrows()})
            print("  pnl by year:  ", {int(k): (int(v["count"]), float(v["sum"])) for k, v in by_year.iterrows()})
            print("  pnl by side:  ", {("long" if k > 0 else "short"): (int(v["count"]), float(v["sum"]))
                                       for k, v in by_side.iterrows()})
            if args.csv:
                t.to_csv(args.csv, index=False)
                print(f"  trades written to {args.csv}")


def cmd_walkforward(args):
    from . import backtest as bt
    from .config import load_config
    from .strategies import STRATEGIES
    cfg = load_config()
    symbols = args.symbols or cfg.symbols
    tf = STRATEGIES[args.strategy].timeframe
    klines, funding = bt.load_market(symbols, tf, args.start, args.end, refresh=not args.offline)
    import pandas as pd
    end = args.end or str(pd.Timestamp.now("UTC").date())
    out = bt.walk_forward(args.strategy, klines, funding, cfg.risk, cfg.costs, args.start, end,
                          args.train_months, args.test_months, base_params=_parse_params(args.param))
    print(f"walk-forward {args.strategy} tf={tf} symbols={symbols} train={args.train_months}m test={args.test_months}m")
    for w in out["windows"]:
        print(f"  {w['test_start']} -> {w['test_end']}  oos={w['oos_return_pct']:+6.1f}%  "
              f"trades={w['oos_trades']:3d}  params={w['params']}")
    wins = sum(1 for w in out["windows"] if w["oos_return_pct"] > 0)
    print(f"\nprofitable windows: {wins}/{len(out['windows'])}")
    print("stitched out-of-sample: " + _fmt_metrics(out["metrics"]))


def cmd_ai_models(args):
    from . import ai
    for provider, has_key in ai.available_providers().items():
        if not has_key:
            print(f"{provider}: no API key configured")
            continue
        try:
            print(f"{provider}: " + ", ".join(ai.list_models(provider)))
        except Exception as e:
            print(f"{provider}: key present but listing failed: {e!r}"[:300])


def cmd_ai_eval(args):
    from . import ai_eval
    out = ai_eval.run(args.models, args.n, args.repeat)
    print(f"{'model':<24} {'n':>4} {'full/half/skip':>15} {'gated R':>8} {'random R':>9} {'p(random>=)':>11} "
          f"{'repeat':>7} {'$/dec':>8} {'sec':>5}")
    for model, s in out.items():
        if not s["n"]:
            print(f"{model:<24} no answers: {s['first_error']}"[:200])
            continue
        mix = "/".join(str(s["mix"][k]) for k in ("full", "half", "skip"))
        print(f"{model:<24} {s['n']:>4} {mix:>15} {s['gated_sum_r']:>8.1f} {s['random_gate_sum_r']:>9.1f} "
              f"{s['p_better_than_random']:>11.3f} {s.get('agreement_on_repeat', float('nan')):>7.2f} "
              f"{s['cost_per_decision']:>8.4f} {s['median_seconds']:>5.1f}"
              + (f"   ({s['errors']} errors: {s['first_error']})"[:160] if s["errors"] else ""))


def cmd_ai(args):
    from . import desk as desk_mod, feeds
    from .config import load_config
    from .journal import Journal
    cfg, j = load_config(), Journal()
    d = desk_mod.Desk(cfg, j)
    if args.action in desk_mod.MODES:
        j.set_state("ai", args.action)
        j.event("info", "ai", f"ai set to {args.action}")
        print({"off": "AI desk off: no model calls.",
               "shadow": "AI desk in shadow: it is asked and journaled, but nothing it says touches a trade.",
               "reduce": "AI desk can now shrink or skip entries the rules propose (never open or enlarge)."}[args.action])
    elif args.action == "brief":
        snap = feeds.snapshot(cfg.symbols)
        markets, _ = d._context_markets()
        print("[technical, closed 4h candles]\n" + markets + "\n\n" + feeds.briefing(snap))
        print("\nfeed health:", feeds.health(snap))
    elif args.action == "review":
        if d.mode == "off":
            print("AI desk is off. Turn it on first: python -m bot ai shadow")
            return
        a = d.review("event", "manual review requested by the operator")
        print(json.dumps(a, indent=2, ensure_ascii=False, default=str) if a else "no answer from the primary model; see `ai status`")
    elif args.action == "score":
        print(json.dumps(desk_mod.score(j), indent=2, default=str))
    else:  # status
        st = d.stance()
        print(f"ai: {d.mode} | primary: {cfg.ai.model} | shadows: {cfg.ai.shadow_models} | usable now: {d._models()}")
        print(f"stance: {st['stance']}" + (f" (set {_ago(st['ts'])} by {st['model']}, trigger: {st.get('trigger', '')})\n  {st['reason']}"
                                           if st["ts"] else " (default)"))
        print(f"spent today: {d.spent_today():.4f} USD of {cfg.ai.daily_budget_usd}")
        for r in j.rows("SELECT c.ts, c.kind, c.model, c.role, c.verdict, c.applied, c.cost, c.error, c.answer, b.trigger, b.symbol "
                        "FROM ai_calls c JOIN ai_briefings b ON b.id = c.briefing_id ORDER BY c.id DESC LIMIT ?", (args.n,)):
            what = r["error"] or (r["answer"] or {}).get("reason", "")
            print(f"  {_ago(r['ts']):>8} {r['kind']:<6} {r['symbol'] or '':<8} {r['model']:<18} {r['role']:<7} "
                  f"{r['verdict'] or 'ERROR':<8} {'applied' if r['applied'] else '       '} {what[:110]}")


def _ago(ts):
    import time
    s = time.time() - ts
    return f"{s / 60:.0f}m ago" if s < 5400 else f"{s / 3600:.0f}h ago" if s < 172800 else f"{s / 86400:.0f}d ago"


def cmd_run(args):
    from .engine import Engine
    from . import notify
    Engine(notifier=notify.send).run(once=args.once)


REAL_UNIT = """[Unit]
Description=Signals bot on a Binance account ({broker})
After=network-online.target

[Service]
User={user}
WorkingDirectory={backend}
Environment=BOT_DATA_DIR={data}
EnvironmentFile={data}/bot.env
ExecStart={python} -m bot run
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
"""


def cmd_real_setup(args):
    """Prepares the second bot, the one that trades a Binance account. It starts nothing and sends no order."""
    import getpass
    from dataclasses import asdict
    from pathlib import Path
    from .config import REAL_DATA_DIR, load_config
    broker = "demo" if args.demo else "live"
    REAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    cfg = load_config()  # same strategy and risk rules as the simulated bot
    cfg.broker = broker
    (REAL_DATA_DIR / "config.json").write_text(json.dumps(asdict(cfg), indent=2))
    env = REAL_DATA_DIR / "bot.env"
    if not env.exists():
        env.write_text("BOT_BINANCE_KEY=\nBOT_BINANCE_SECRET=\n" + ("" if args.demo else "BOT_ALLOW_LIVE=0\n"))
        env.chmod(0o600)
    unit = REAL_DATA_DIR / "signals-bot-real.service"
    backend = Path(__file__).resolve().parent.parent
    unit.write_text(REAL_UNIT.format(broker=broker, user=getpass.getuser(), backend=backend,
                                     data=REAL_DATA_DIR, python=sys.executable))
    what = "la cuenta DEMO de Binance (dinero de prueba)" if args.demo else "tu cuenta REAL de Binance"
    print(f"Preparado el segundo bot para {what}. Todavía no hay nada en marcha.\n")
    print(f"1. Escribe las claves de Binance del bot en {env}")
    print("   (clave con permiso de Futuros y SIN permiso de retiro; la cuenta en modo de posición 'one-way').")
    if not args.demo:
        print("   Cambia BOT_ALLOW_LIVE=0 por BOT_ALLOW_LIVE=1: es el seguro que permite órdenes con dinero real.")
    print(f"2. sudo cp {unit} /etc/systemd/system/ && sudo systemctl daemon-reload")
    print("3. sudo systemctl enable --now signals-bot-real")
    print("\nArranca en modo manual: propone cada operación y espera a que la apruebes en la app.")
    print(f"Riesgo por operación: {cfg.risk.risk_per_trade:.2%} del saldo; se pausa solo si cae "
          f"{cfg.risk.max_drawdown_halt:.0%} desde su máximo. Se cambia en {REAL_DATA_DIR / 'config.json'}.")


def cmd_report(args):
    from . import report
    rep = report.build(trades=args.trades, decisions=args.decisions)
    print(json.dumps(rep, indent=2, default=str) if args.json else report.render(rep))


def cmd_control(args):
    from .journal import Journal
    j = Journal()
    if args.command == "pause":
        j.set_paused(True, " ".join(args.reason) or "manual")
        print("bot paused: no new entries. Open positions keep their stops and are still managed.")
    elif args.command == "resume":
        j.set_paused(False, "")
        print("bot resumed")
    elif args.command == "mode":
        j.set_state("mode", args.mode)
        j.event("info", "mode", f"mode set to {args.mode}")
        print(f"mode = {args.mode}")
    elif args.command in ("approve", "reject"):
        cid = j.add_command(args.command, {"proposal_id": args.id})
        print(f"command #{cid} queued; the running engine executes it on its next tick")
    elif args.command == "open":
        cid = j.add_command("open", {"symbol": args.symbol.upper(), "side": 1 if args.side == "long" else -1})
        print(f"command #{cid} queued; the engine sizes it with the risk rules and may refuse it (see `report`)")
    elif args.command == "close":
        cid = j.add_command("close", {"symbol": args.symbol})
        print(f"command #{cid} queued; the running engine executes it on its next tick")


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m bot", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp):
        sp.add_argument("--strategy", required=True)
        sp.add_argument("--symbols", nargs="+")
        sp.add_argument("--start", default="2021-01-01")
        sp.add_argument("--end")
        sp.add_argument("--param", action="append", help="strategy param, e.g. --param n=20")
        sp.add_argument("--offline", action="store_true", help="use cached data only")

    sp = sub.add_parser("backtest", help="backtest a strategy with costs")
    common(sp)
    sp.add_argument("--split", help="date separating in-sample / out-of-sample")
    sp.add_argument("--csv", help="write trades to this file")
    sp.set_defaults(func=cmd_backtest)

    sp = sub.add_parser("walkforward", help="rolling optimise-then-test validation")
    common(sp)
    sp.add_argument("--train-months", type=int, default=12)
    sp.add_argument("--test-months", type=int, default=3)
    sp.set_defaults(func=cmd_walkforward)

    sub.add_parser("ai-models", help="list the models each configured AI key can use").set_defaults(func=cmd_ai_models)
    sp = sub.add_parser("ai-eval", help="compare AI models as portfolio manager on historical signals")
    sp.add_argument("--models", nargs="+", required=True)
    sp.add_argument("--n", type=int, default=200)
    sp.add_argument("--repeat", type=int, default=50)
    sp.set_defaults(func=cmd_ai_eval)

    sp = sub.add_parser("ai", help="AI desk: off|shadow|reduce set its authority; status, brief (what it would "
                                   "be shown now, no model call), review (ask for a stance now), score")
    sp.add_argument("action", choices=["status", "off", "shadow", "reduce", "brief", "review", "score"])
    sp.add_argument("-n", type=int, default=12, help="calls to list in status")
    sp.set_defaults(func=cmd_ai)

    sp = sub.add_parser("run", help="run the trading engine")
    sp.add_argument("--once", action="store_true", help="run a single tick and exit")
    sp.set_defaults(func=cmd_run)

    sp = sub.add_parser("real-setup", help="prepare a second bot that trades a Binance account (starts nothing)")
    sp.add_argument("--demo", action="store_true", help="Binance demo trading instead of real money")
    sp.set_defaults(func=cmd_real_setup)

    sp = sub.add_parser("report", help="what the bot is doing and how it is performing")
    sp.add_argument("--json", action="store_true")
    sp.add_argument("--trades", type=int, default=15)
    sp.add_argument("--decisions", type=int, default=20)
    sp.set_defaults(func=cmd_report)

    sp = sub.add_parser("pause", help="stop opening new positions")
    sp.add_argument("reason", nargs="*")
    sp.set_defaults(func=cmd_control)
    sub.add_parser("resume", help="allow new positions again").set_defaults(func=cmd_control)
    sp = sub.add_parser("mode", help="auto = bot executes; manual = bot proposes, you approve")
    sp.add_argument("mode", choices=["auto", "manual"])
    sp.set_defaults(func=cmd_control)
    for name in ("approve", "reject"):
        sp = sub.add_parser(name, help=f"{name} a pending proposal (manual mode)")
        sp.add_argument("id", type=int)
        sp.set_defaults(func=cmd_control)
    sp = sub.add_parser("open", help="open a trade by hand: sized and checked by the risk engine")
    sp.add_argument("symbol")
    sp.add_argument("side", choices=["long", "short"])
    sp.set_defaults(func=cmd_control)
    sp = sub.add_parser("close", help="close a position at market (symbol or 'all')")
    sp.add_argument("symbol")
    sp.set_defaults(func=cmd_control)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())

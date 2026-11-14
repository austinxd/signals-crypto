"""Tests for the bot core. Run from backend/:  ./venv/bin/python -m pytest tests -q"""
import numpy as np
import pandas as pd
import pytest

from bot import risk
from bot.backtest import run_backtest
from bot.config import BotConfig, CostConfig, RiskConfig
from bot.strategies import DonchianTrend, TrendPullback

NO_COST = CostConfig(taker_fee=0.0, slippage=0.0)


def bars(rows, sig=None, sl=None, tp=None, freq="4h"):
    """rows: list of (open, high, low, close)."""
    idx = pd.date_range("2024-01-01", periods=len(rows), freq=freq)
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)
    df["volume"] = 1.0
    df["atr"] = 1.0
    df["sig"] = sig or [0] * len(rows)
    df["sl"] = sl or [np.nan] * len(rows)
    df["tp"] = tp or [np.nan] * len(rows)
    return df


def random_walk(n=1500, seed=1, freq="1h"):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.004, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.004, n))
    idx = pd.date_range("2023-01-01", periods=n, freq=freq)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                         "volume": rng.uniform(1, 2, n)}, index=idx)


# -- risk engine ------------------------------------------------------------------------------

def test_size_risks_fixed_fraction_of_equity():
    v = risk.evaluate(RiskConfig(), 1, 100.0, 98.0, 10_000, 0, 0.0, 10_000)
    assert v.ok
    assert v.qty * (100.0 - 98.0) == pytest.approx(50.0)  # 0.5% of 10k


def test_leverage_cap_reduces_size():
    v = risk.evaluate(RiskConfig(risk_per_trade=0.02), 1, 100.0, 99.6, 10_000, 0, 0.0, 10_000)  # 5x uncapped
    assert v.ok and v.note == "capped_by_position_leverage"
    assert v.qty * 100.0 == pytest.approx(30_000)


@pytest.mark.parametrize("kwargs,reason", [
    (dict(side=1, entry=100, sl=101), "stop_on_wrong_side"),
    (dict(side=-1, entry=100, sl=99), "stop_on_wrong_side"),
    (dict(side=1, entry=100, sl=99.9), "stop_too_tight"),
    (dict(side=1, entry=100, sl=80), "stop_too_wide"),
    (dict(side=1, entry=100, sl=98, open_positions=3), "max_open_positions"),
    (dict(side=1, entry=100, sl=98, equity=9_700), "daily_loss_limit"),
    (dict(side=1, entry=100, sl=98, open_positions=2, same_side_positions=3), "max_same_direction"),
])
def test_rejections(kwargs, reason):
    args = dict(equity=10_000, open_positions=0, open_notional=0.0, day_start_equity=10_000)
    args.update(kwargs)
    v = risk.evaluate(RiskConfig(), **args)
    assert not v.ok and v.reason.startswith(reason)


def test_stop_only_moves_in_favour():
    # long from 100 with stop 95; price ran to 120, ATR 2, trail 3 ATR -> 114
    assert risk.managed_stop(1, 100, 95, 95, 120, 99, 2.0, 3.0, 0.0) == 114
    # a wider ATR must not loosen it again
    assert risk.managed_stop(1, 100, 95, 114, 120, 99, 5.0, 3.0, 0.0) == 114
    assert risk.managed_stop(-1, 100, 105, 105, 101, 80, 2.0, 3.0, 0.0) == 86
    # breakeven after +1R
    assert risk.managed_stop(1, 100, 95, 95, 105, 99, 2.0, 0.0, 1.0) == 100


def test_exit_fill_is_conservative():
    assert risk.exit_fill(1, 95, 110, 100, 111, 94) == (95, "stop")     # both touched -> stop
    assert risk.exit_fill(1, 95, 110, 90, 92, 89) == (90, "stop")       # gap through stop -> open
    assert risk.exit_fill(1, 95, 110, 100, 111, 96) == (110, "target")
    assert risk.exit_fill(-1, 105, 90, 100, 104, 89) == (90, "target")
    assert risk.exit_fill(1, 95, float("nan"), 100, 200, 96) is None


# -- backtester -------------------------------------------------------------------------------

def test_entry_fills_at_next_open_and_target_pays_planned_r():
    df = bars([(100, 101, 99, 100), (100, 101, 99.5, 100.5), (100.5, 105, 100, 104), (104, 104, 104, 104)],
              sig=[1, 0, 0, 0], sl=[98, np.nan, np.nan, np.nan], tp=[104, np.nan, np.nan, np.nan])
    res = run_backtest({"X": df}, "4h", {}, RiskConfig(), NO_COST)
    t = res.trades.iloc[0]
    assert t["entry"] == 100 and t["entry_time"] == df.index[1]
    assert t["exit"] == 104 and t["reason"] == "target"
    assert t["r"] == pytest.approx(2.0)
    assert res.equity.iloc[-1] == pytest.approx(10_000 + 2 * 50)


def test_stop_loses_one_r_plus_costs():
    df = bars([(100, 101, 99, 100), (100, 100.5, 97, 97.5), (97.5, 98, 97, 97.5)],
              sig=[1, 0, 0], sl=[98, np.nan, np.nan])
    res = run_backtest({"X": df}, "4h", {}, RiskConfig(), NO_COST)
    assert res.trades.iloc[0]["r"] == pytest.approx(-1.0)
    costly = run_backtest({"X": df}, "4h", {}, RiskConfig(), CostConfig())
    assert costly.trades.iloc[0]["r"] < -1.0
    assert costly.trades.iloc[0]["fees"] > 0


def test_short_and_funding():
    df = bars([(100, 101, 99, 100), (100, 100.5, 99.5, 100), (100, 100, 96, 96.5), (96.5, 97, 96, 96.5)],
              sig=[-1, 0, 0, 0], sl=[102, np.nan, np.nan, np.nan], tp=[96, np.nan, np.nan, np.nan])
    # funding at the close of bar 1 (= open of bar 2); positive rate -> shorts receive
    funding = {"X": pd.Series([0.001], index=[df.index[2]])}
    res = run_backtest({"X": df}, "4h", {}, RiskConfig(), NO_COST, funding)
    t = res.trades.iloc[0]
    assert t["reason"] == "target" and t["funding"] == pytest.approx(t["qty"] * 100 * 0.001)
    assert t["pnl"] == pytest.approx(t["qty"] * 4 + t["funding"])


def test_max_open_positions_is_enforced():
    rows = [(100, 101, 99, 100)] * 4
    one = lambda: bars(rows, sig=[1, 0, 0, 0], sl=[98, np.nan, np.nan, np.nan])
    res = run_backtest({"A": one(), "B": one(), "C": one()}, "4h", {}, RiskConfig(max_open_positions=2), NO_COST)
    assert len(res.trades) == 2 and res.rejected == {"max_open_positions": 1}


@pytest.mark.parametrize("strategy", [DonchianTrend(), TrendPullback()])
def test_strategies_do_not_look_ahead(strategy):
    """Signals on a truncated history must equal the signals on the full history."""
    df = random_walk(1600, freq="1h" if strategy.timeframe == "1h" else "4h")
    full = strategy.prepare(df)
    assert (full["sig"] != 0).any()
    for cut in (1200, 1399, 1550):
        part = strategy.prepare(df.iloc[:cut])
        pd.testing.assert_series_equal(part["sig"], full["sig"].iloc[:cut])
        both = part["sig"] != 0
        np.testing.assert_allclose(part.loc[both, "sl"], full["sl"].iloc[:cut][both])


# -- live engine (paper) ----------------------------------------------------------------------

class FakeBroker:
    name = "paper"

    def __init__(self):
        self.price, self.opened, self.closed = 100.0, [], []

    def account(self):
        return {"equity": 10_000.0, "balance": 10_000.0, "open_pnl": 0.0}

    def open(self, symbol, side, qty, sl, tp):
        self.opened.append((symbol, side, qty, sl, tp))
        return {"entry": self.price, "qty": qty, "fee": 0.0, "orders": {}}

    def close(self, trade):
        self.closed.append(trade["symbol"])
        return {"exit": self.price, "fee": 0.0}

    def sync(self, trade):
        return None

    def funding(self, trade):
        return 0.0

    def move_stop(self, trade, new_sl):
        return {}


@pytest.fixture
def engine(tmp_path, monkeypatch):
    from bot import data, engine as engine_mod
    from bot.journal import Journal
    broker = FakeBroker()
    monkeypatch.setattr(data, "last_price", lambda s: broker.price)
    eng = engine_mod.Engine(BotConfig(symbols=["X"]), Journal(tmp_path / "bot.db"), broker)
    return eng, broker


def test_auto_mode_enters_and_journals(engine):
    eng, broker = engine
    eng._signal("X", "bar", 1, 98.0, None)
    assert len(broker.opened) == 1
    assert broker.opened[0][2] * 2.0 == pytest.approx(50.0)
    assert [d["action"] for d in eng.j.rows("SELECT * FROM decisions")] == ["ENTER"]
    assert len(eng.j.open_trades()) == 1


def test_pause_blocks_entries(engine):
    eng, broker = engine
    eng.j.set_paused(True, "test")
    eng._signal("X", "bar", 1, 98.0, None)
    assert broker.opened == []
    d = eng.j.rows("SELECT * FROM decisions")[0]
    assert d["action"] == "SKIP" and d["reason"].startswith("paused")


def test_manual_mode_proposes_then_executes_on_approval(engine):
    eng, broker = engine
    eng.j.set_state("mode", "manual")
    eng._signal("X", "bar", -1, 102.0, 96.0)
    assert broker.opened == []
    pid = eng.j.pending_proposals()[0]["id"]
    eng.j.add_command("approve", {"proposal_id": pid})
    eng._commands()
    assert len(broker.opened) == 1 and broker.opened[0][1] == -1
    assert eng.j.pending_proposals() == []
    assert eng.j.rows("SELECT status, result FROM commands")[0] == {"status": "done", "result": "executed"}


def test_approval_cannot_bypass_risk_engine(engine):
    eng, broker = engine
    eng.j.set_state("mode", "manual")
    eng._signal("X", "bar", 1, 98.0, None)
    broker.price = 97.0  # price fell through the stop before the user approved
    eng.j.add_command("approve", {"proposal_id": eng.j.pending_proposals()[0]["id"]})
    eng._commands()
    assert broker.opened == []
    assert "stop_on_wrong_side" in eng.j.rows("SELECT result FROM commands")[0]["result"]


def test_close_command_and_trade_economics(engine):
    eng, broker = engine
    eng._signal("X", "bar", 1, 98.0, None)
    broker.price = 104.0
    eng.j.add_command("close", {"symbol": "all"})
    eng._commands()
    t = eng.j.rows("SELECT * FROM trades")[0]
    assert t["status"] == "closed" and t["exit_reason"] == "manual"
    assert t["r"] == pytest.approx(2.0) and t["pnl"] == pytest.approx(100.0)


def test_report_does_not_mix_results_from_another_kind_of_money(engine):
    from bot import report
    eng, broker = engine
    for name, pnl in (("paper", 100.0), ("paper", -40.0), ("live", 7.0)):
        tid = eng.j.open_trade(symbol="X", side=1, qty=1.0, strategy="t", broker=name, entry_ts=1.0, entry=100.0,
                               sl0=98.0, sl=98.0, tp=None, high_water=100.0, low_water=100.0, fees=0.0,
                               last_check_ms=0, last_funding_ms=0, orders={})
        eng.j.update_trade(tid, status="closed", exit_ts=2.0, exit=101.0, exit_reason="stop", fees=0.0, pnl=pnl, r=1.0)
    rep = report.build(journal=eng.j, live_prices=False)  # the engine runs on the paper broker
    assert rep["performance"]["all"]["trades"] == 2 and rep["performance"]["all"]["pnl"] == pytest.approx(60.0)
    assert {t["broker"] for t in rep["recent_trades"]} == {"paper"} and rep["other_broker_trades"] == 1
    eng.j.set_state("broker", "live")
    rep = report.build(journal=eng.j, live_prices=False)
    assert rep["performance"]["all"]["pnl"] == pytest.approx(7.0) and rep["other_broker_trades"] == 2


def test_manual_open_goes_through_the_risk_engine_and_notifies(engine, monkeypatch):
    import pandas as pd
    from bot import data
    eng, broker = engine
    told = []
    eng._notifier = lambda title, body, kind, symbol, data=None: told.append((title, kind, symbol))
    monkeypatch.setattr(data, "recent_klines", lambda s, tf: None)
    monkeypatch.setattr(eng.strategy, "prepare", lambda df: pd.DataFrame({"atr": [0.8]}))  # stop = 2.5 ATR = 2.0

    def ask(symbol, side):
        eng.j.add_command("open", {"symbol": symbol, "side": side})
        eng._commands()
        return eng.j.rows("SELECT result FROM commands ORDER BY id DESC LIMIT 1")[0]["result"]

    assert "not one of the bot's symbols" in ask("DOGEUSDT", 1)
    eng.j.set_paused(True, "test")
    assert "paused" in ask("X", 1)
    eng.j.set_paused(False, "")
    assert broker.opened == []
    assert ask("X", -1) == "executed"
    symbol, side, qty, sl, tp = broker.opened[0]
    assert (side, sl, tp) == (-1, pytest.approx(102.0), None) and qty * 2.0 == pytest.approx(50.0)  # 0.5% of 10k
    # refusals are told too, in words; then the trade itself, saying it is simulated and what it wins on
    assert [t[0] for t in told[:2]] == ["Bot (simulado): no abrió tu long de DOGE",
                                        "Bot (simulado): no abrió tu long de X"]
    assert told[2] == ("Bot (simulado): abrió short de X, gana si baja", "bot_trade", "X")
    assert "already open" in ask("X", 1)
    eng.j.add_command("close", {"symbol": "X"})
    eng._commands()
    assert told[-1][0].startswith("Bot (simulado): cerró X y ")


def test_trailing_stop_moves_and_closes_if_price_is_through_it(engine):
    eng, broker = engine
    eng.strategy.p["trail_atr"] = 2.0
    eng._signal("X", "bar", 1, 98.0, None)
    broker.price = 111.0
    eng._manage(eng.j.open_trades()[0], {"high": 112.0, "low": 100.0, "atr": 1.0}, "bar2")
    trade = eng.j.open_trades()[0]
    assert trade["sl"] == pytest.approx(110.0) and trade["bars"] == 1
    broker.price = 109.0  # new stop would be 112, already above the market -> close now
    eng._manage(trade, {"high": 114.0, "low": 108.0, "atr": 1.0}, "bar3")
    assert eng.j.open_trades() == [] and broker.closed == ["X"]
    assert eng.j.rows("SELECT exit_reason FROM trades")[0]["exit_reason"] == "stop"


def test_paused_bot_refuses_approval(engine):
    eng, broker = engine
    eng.j.set_state("mode", "manual")
    eng._signal("X", "bar", 1, 98.0, None)
    eng.j.set_paused(True, "test")
    eng.j.add_command("approve", {"proposal_id": eng.j.pending_proposals()[0]["id"]})
    eng._commands()
    assert broker.opened == [] and len(eng.j.pending_proposals()) == 1


def test_api_requires_token_and_controls_the_bot(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from bot import api, config, journal
    monkeypatch.setattr(journal, "DATA_DIR", tmp_path)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)
    monkeypatch.delenv("BOT_API_TOKEN", raising=False)
    assert client.get("/api/bot/report").status_code == 503
    monkeypatch.setenv("BOT_API_TOKEN", "s3cret")
    assert client.get("/api/bot/report").status_code == 401
    h = {"X-Bot-Token": "s3cret"}
    assert client.post("/api/bot/pause", json={"reason": "from app"}, headers=h).json() == {"paused": True}
    rep = client.get("/api/bot/report", headers=h).json()
    assert rep["status"]["paused"] is True and rep["status"]["pause_reason"] == "from app"
    assert client.post("/api/bot/mode", json={"mode": "turbo"}, headers=h).status_code == 422
    assert client.post("/api/bot/proposals/7/approve", headers=h).json() == {"command_id": 1}
    assert client.post("/api/bot/ai", json={"mode": "shadow"}, headers=h).json() == {"ai": "shadow"}
    assert client.get("/api/bot/report", headers=h).json()["ai"]["mode"] == "shadow"


def test_api_accepts_admin_login_and_refuses_other_accounts(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    import sys
    from bot import api, journal
    monkeypatch.setattr(journal, "DATA_DIR", tmp_path)
    monkeypatch.delenv("BOT_API_TOKEN", raising=False)

    def fake_user(credentials):
        if credentials.credentials == "bad":
            raise HTTPException(401, "Invalid or expired token")
        return SimpleNamespace(is_admin=credentials.credentials == "admin")
    monkeypatch.setitem(sys.modules, "auth", SimpleNamespace(get_current_user=fake_user))  # stands in for backend/auth.py
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)
    assert client.get("/api/bot/report", headers={"Authorization": "Bearer admin"}).status_code == 200
    assert client.get("/api/bot/report", headers={"Authorization": "Bearer admin"}).json()["can_control"] is True
    seen = client.get("/api/bot/report", headers={"Authorization": "Bearer user"})  # any account may look
    assert seen.status_code == 200 and seen.json()["can_control"] is False
    for path in ("/api/bot/pause", "/api/bot/resume", "/api/bot/close/BTCUSDT", "/api/bot/proposals/1/approve"):
        assert client.post(path, json={}, headers={"Authorization": "Bearer user"}).status_code == 403
    for path, body in (("/api/bot/mode", {"mode": "manual"}), ("/api/bot/ai", {"mode": "reduce"}),
                       ("/api/bot/open", {"symbol": "btcusdt", "side": "long"})):
        assert client.post(path, json=body, headers={"Authorization": "Bearer user"}).status_code == 403
    assert client.get("/api/bot/report", headers={"Authorization": "Bearer bad"}).status_code == 401
    r = client.post("/api/bot/open", json={"symbol": "btcusdt", "side": "short"}, headers={"Authorization": "Bearer admin"})
    assert r.status_code == 200
    from bot.journal import Journal
    assert Journal().pending_commands()[-1]["args"] == {"symbol": "BTCUSDT", "side": -1}


def test_openai_compatible_decision_is_parsed(monkeypatch):
    import requests
    from bot import ai

    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return {"choices": [{"finish_reason": "stop", "message": {
                "content": '{"action": "skip", "reason": "r", "main_risk": "m"}'}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 50}}

    sent = {}
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setattr(requests, "post", lambda url, **kw: sent.update(url=url, **kw) or Resp())
    d = ai.decide("ctx", "deepseek-some-model")
    assert sent["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert sent["headers"] == {"Authorization": "Bearer k"}
    assert (d.action, d.size, d.input_tokens) == ("skip", 0.0, 900)
    assert d.cost_usd != d.cost_usd  # price unknown -> NaN, never a made-up number
    assert ai.provider_of("gpt-anything") == "openai" and ai.provider_of("claude-opus-5-5") == "anthropic"


# -- AI desk ----------------------------------------------------------------------------------
@pytest.fixture
def desk_engine(engine, monkeypatch):
    from bot import ai, data, desk as desk_mod, feeds
    eng, broker = engine
    monkeypatch.setattr(desk_mod.Desk, "_models", lambda self: [self.c.model, *self.c.shadow_models])
    monkeypatch.setattr(feeds, "snapshot", lambda symbols: {})
    monkeypatch.setattr(data, "recent_klines", lambda s, tf, limit=1500: random_walk(700, freq="4h"))
    answers = {}

    def fake_ask(system, schema, shape, context, model, effort="medium", timeout=300, retries=3):
        a = answers.get(model, answers.get("*"))
        if isinstance(a, Exception):
            raise a
        return {**a, "in_tokens": 10, "out_tokens": 5, "seconds": 0.1, "cost_usd": 0.001}
    monkeypatch.setattr(ai, "ask", fake_ask)
    return eng, broker, answers


def _signal(eng, side=1):
    df = random_walk(700, freq="4h")
    eng._signal("X", "bar", side, 95.0, None, df)


def test_ai_off_makes_no_calls(desk_engine):
    eng, broker, answers = desk_engine
    answers["*"] = RuntimeError("must not be called")
    _signal(eng)
    assert len(eng.j.open_trades()) == 1
    assert eng.j.rows("SELECT * FROM ai_calls") == []


def test_ai_shadow_records_but_never_changes_the_trade(desk_engine):
    eng, broker, answers = desk_engine
    eng.j.set_state("ai", "shadow")
    answers["*"] = {"action": "skip", "reason": "r", "main_risk": "m"}
    _signal(eng)
    t = eng.j.open_trades()
    assert len(t) == 1 and t[0]["qty"] == pytest.approx(10.0)   # 0.5% of 10k over a 5-point stop
    calls = eng.j.rows("SELECT * FROM ai_calls")
    assert len(calls) == 3 and all(c["verdict"] == "skip" and not c["applied"] for c in calls)
    assert eng.j.rows("SELECT trade_id FROM ai_briefings")[0]["trade_id"] == t[0]["id"]


def test_ai_reduce_halves_and_vetoes_only_through_the_primary_model(desk_engine):
    eng, broker, answers = desk_engine
    eng.j.set_state("ai", "reduce")
    answers["*"] = {"action": "skip", "reason": "r", "main_risk": "m"}          # shadows say skip
    answers[eng.cfg.ai.model] = {"action": "half", "reason": "r", "main_risk": "m"}
    _signal(eng)
    assert eng.j.open_trades()[0]["qty"] == pytest.approx(5.0)
    trade = eng.j.open_trades()[0]
    eng._record_close(trade, broker.close(trade), "manual")
    answers[eng.cfg.ai.model] = {"action": "skip", "reason": "r", "main_risk": "m"}
    _signal(eng)
    assert eng.j.open_trades() == []
    assert eng.j.rows("SELECT reason FROM decisions ORDER BY id DESC LIMIT 1")[0]["reason"].startswith("ai_veto")


def test_ai_failure_takes_the_rules_signal_at_full_size(desk_engine):
    eng, broker, answers = desk_engine
    eng.j.set_state("ai", "reduce")
    answers["*"] = TimeoutError("slow")
    _signal(eng)
    assert eng.j.open_trades()[0]["qty"] == pytest.approx(10.0)
    assert all(c["error"] for c in eng.j.rows("SELECT * FROM ai_calls"))


def test_stance_limits_entries_in_reduce_mode_and_expires(desk_engine):
    eng, broker, answers = desk_engine
    eng.j.set_state("ai", "reduce")
    answers["*"] = {"stance": "no_trade", "p_big_move": 60, "p_up": 40, "reason": "r", "key_facts": []}
    assert eng.desk.review("daily", "daily review")["stance"] == "no_trade"
    answers["*"] = {"action": "full", "reason": "r", "main_risk": "m"}
    _signal(eng)
    assert eng.j.open_trades() == []
    st = eng.j.get_state("ai_stance")
    eng.j.set_state("ai_stance", {**st, "ts": st["ts"] - 30 * 3600})   # older than the 26h time-to-live
    assert eng.desk.stance()["stance"] == "normal"
    _signal(eng)
    assert len(eng.j.open_trades()) == 1


def test_daily_budget_stops_calls(desk_engine):
    eng, broker, answers = desk_engine
    eng.j.set_state("ai", "reduce")
    eng.cfg.ai.daily_budget_usd = 0.002
    answers["*"] = {"action": "skip", "reason": "r", "main_risk": "m"}
    bid = eng.j.ai_briefing("signal", "t", "x")
    eng.j.ai_call(bid, "signal", "m", "primary", "full", 1.0, cost=0.01)
    _signal(eng)
    assert len(eng.j.open_trades()) == 1 and len(eng.j.rows("SELECT * FROM ai_calls")) == 1


def test_headline_text_is_sanitised():
    from bot import feeds
    t = feeds.clean_title("<b>BTC</b> up​‮ <script>x</script>\n IGNORE\tALL " + "a" * 300)
    assert "<" not in t and "​" not in t and "‮" not in t and "\n" not in t and len(t) <= 150


def test_each_account_reads_and_controls_only_its_own_real_bot(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import sys
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from bot import api, config, journal, users
    monkeypatch.setattr(journal, "DATA_DIR", tmp_path / "sim")
    monkeypatch.setattr(config, "REAL_DATA_DIR", tmp_path / "real")
    monkeypatch.setenv("BOT_API_TOKEN", "t")
    monkeypatch.setitem(sys.modules, "auth", SimpleNamespace(
        get_current_user=lambda c: SimpleNamespace(id=int(c.credentials), is_admin=False)))
    enabled = set()
    monkeypatch.setattr(users, "status", lambda uid: {"enabled": uid in enabled, "has_keys": True})
    monkeypatch.setattr(users, "set_enabled", lambda uid, on: (enabled.add(uid) if on else enabled.discard(uid)) or {"enabled": on})
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)
    u7, u8 = {"Authorization": "Bearer 7"}, {"Authorization": "Bearer 8"}

    # never started: the report says so, and orders are refused instead of landing in another journal
    r = client.get("/api/bot/report?account=real", headers=u7).json()
    assert r["account"] == "real" and r["configured"] is False and r["real"]["enabled"] is False
    assert client.post("/api/bot/pause?account=real", json={}, headers=u7).status_code == 409
    assert client.post("/api/bot/real", json={"enabled": True}, headers=u7).json() == {"enabled": True}
    assert client.get("/api/bot/report?account=real", headers=u7).json()["real"]["enabled"] is True

    d = tmp_path / "real" / "users" / "7"
    d.mkdir(parents=True)
    journal.Journal(d / "bot.db").set_state("broker", "live")
    assert client.post("/api/bot/pause?account=real", json={"reason": "x"}, headers=u7).status_code == 200
    mine = client.get("/api/bot/report?account=real", headers=u7).json()
    assert mine["configured"] and mine["can_control"] and mine["status"]["paused"] is True
    # another account sees nothing of it and cannot touch it; neither can the server token
    assert client.get("/api/bot/report?account=real", headers=u8).json()["configured"] is False
    assert client.post("/api/bot/resume?account=real", headers=u8).status_code == 409
    assert client.post("/api/bot/resume?account=real", headers={"X-Bot-Token": "t"}).status_code == 403
    assert client.get("/api/bot/report?account=real&user_id=7", headers={"X-Bot-Token": "t"}).json()["status"]["paused"] is True
    # and none of this moved the simulated bot, which a plain account still cannot control
    sim = client.get("/api/bot/report", headers=u7).json()
    assert sim["account"] == "sim" and not sim["status"]["paused"] and sim["can_control"] is False
    assert client.post("/api/bot/pause", json={}, headers=u7).status_code == 403


def test_runner_starts_only_enabled_accounts_and_only_with_the_live_lock_off(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import sys
    from bot import broker as broker_mod, config, engine as engine_mod, journal, users
    monkeypatch.setattr(journal, "DATA_DIR", tmp_path / "sim")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "sim")
    monkeypatch.setattr(config, "REAL_DATA_DIR", tmp_path / "real")

    class Acc(SimpleNamespace):
        def has_binance_keys(self):
            return bool(self.binance_api_key)

        def get_binance_keys(self):
            return "k" + str(self.id), "s" + str(self.id)

    accounts = [Acc(id=7, bot_real_enabled=True, binance_api_key="enc7", binance_api_secret="x"),
                Acc(id=9, bot_real_enabled=True, binance_api_key="enc9", binance_api_secret="x")]

    class Query:
        def filter(self, *a):
            return self

        def all(self):
            return [a for a in accounts if a.bot_real_enabled]

        def first(self):
            return accounts[0]

    class Column:
        def __eq__(self, other):
            return True
    db = SimpleNamespace(query=lambda model: Query(), close=lambda: None, commit=lambda: None)
    monkeypatch.setitem(sys.modules, "database", SimpleNamespace(
        SessionLocal=lambda: db, UserAccount=SimpleNamespace(bot_real_enabled=Column(), id=Column())))

    made, ticks = [], []

    class FakeBroker:
        name = "live"

        def __init__(self, cfg, j, demo, key=None, secret=None):
            if key == "k9":
                raise RuntimeError("Account is in hedge mode; switch to one-way mode to use the bot")
            made.append((key, secret, demo))
    monkeypatch.setattr(broker_mod, "BinanceBroker", FakeBroker)
    monkeypatch.setattr(engine_mod.Engine, "tick", lambda self: ticks.append(self.broker))

    monkeypatch.delenv("BOT_ALLOW_LIVE", raising=False)
    users.run(once=True)
    assert made == [] and ticks == []                      # locked: nobody's keys are even used
    assert users.status(7)["runner_alive"] and not users.status(7)["live_allowed"]

    monkeypatch.setenv("BOT_ALLOW_LIVE", "1")
    users.run(once=True)
    assert made == [("k7", "s7", False)] and len(ticks) == 1
    j = users.journal(7)
    assert j.get_state("mode") == "manual" and j.get_state("ai") == "off" and j.get_state("broker") == "live"
    assert users.journal(9) is not None and users.status(9)["start_error"] == "hedge_mode"

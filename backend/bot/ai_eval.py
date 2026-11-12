"""Offline comparison of models as the AI portfolio manager.

Each case is a real historical signal of the strategy with its realised outcome in R (after costs).
The asset name and the dates are hidden and prices rescaled, so a model cannot recognise the episode
from its training data. For every model we measure whether the trades it sized up did better than the
ones it cut, against a random gate with the same size mix.

Answers are cached in <data dir>/ai_eval/answers.jsonl, so re-running never pays twice for a case.
"""
import json
import random
import statistics
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List

import numpy as np

from . import ai, backtest as bt
from .config import CostConfig, DATA_DIR, RiskConfig
from .strategies import make_strategy

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT",
           "LINKUSDT", "LTCUSDT", "DOTUSDT", "ATOMUSDT"]


def build_cases(start: str, n: int, seed: int = 7) -> List[dict]:
    st = make_strategy("donchian")
    klines, funding = bt.load_market(SYMBOLS, st.timeframe, start)
    prepared = {s: st.prepare(df) for s, df in klines.items()}
    # every signal traded on its own (no portfolio caps), so each case has an outcome
    free = RiskConfig(max_open_positions=999, max_total_leverage=999)
    res = bt.run_backtest(prepared, st.timeframe, st.p, free, CostConfig(), funding, start=start)
    trades = res.trades[res.trades["reason"] != "end"]
    cases = []
    for _, tr in trades.iterrows():
        df = prepared[tr["symbol"]]
        i = df.index.get_loc(tr["entry_time"]) - 1  # the signal bar
        cases.append({
            "id": f"{tr['symbol']}|{df.index[i]}",
            "r": float(tr["r"]),
            "side": int(tr["side"]),
            "context": ai.build_context(df, i, int(tr["side"]), float(df["sl"].iloc[i]),
                                        leader=None if tr["symbol"] == "BTCUSDT" else prepared["BTCUSDT"],
                                        funding=funding.get(tr["symbol"])),
        })
    random.Random(seed).shuffle(cases)
    return cases[:n]


def _cache_path():
    d = DATA_DIR / "ai_eval"
    d.mkdir(parents=True, exist_ok=True)
    return d / "answers.jsonl"


def _load_cache() -> Dict[str, dict]:
    p = _cache_path()
    if not p.exists():
        return {}
    return {(r := json.loads(line))["key"]: r for line in p.read_text().splitlines() if line.strip()}


def ask(cases: List[dict], model: str, effort: str, rep: int = 0, workers: int = 6) -> List[dict]:
    cache = _load_cache()
    out, todo = {}, []
    for c in cases:
        key = f"{model}|{effort}|{rep}|{c['id']}"
        if key in cache:
            out[c["id"]] = cache[key]
        else:
            todo.append((key, c))

    def one(item):
        key, c = item
        try:
            d = ai.decide(c["context"], model, effort)
            return {"key": key, "id": c["id"], "action": d.action, "reason": d.reason, "main_risk": d.main_risk,
                    "cost": d.cost_usd, "seconds": d.seconds, "in_tokens": d.input_tokens,
                    "out_tokens": d.output_tokens}
        except Exception as e:
            return {"key": key, "id": c["id"], "error": repr(e)}

    if todo:
        with ThreadPoolExecutor(workers) as pool, open(_cache_path(), "a") as f:
            for rec in pool.map(one, todo):
                if "error" not in rec:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    f.flush()
                out[rec["id"]] = rec
    return [out[c["id"]] for c in cases]


def _cost(a: dict) -> float:
    """Cost of one answer; recomputed from tokens when it was stored before the price was known."""
    c = a.get("cost")
    if c is not None and c == c:
        return c
    model = a["key"].split("|")[0].split(":")[-1]
    pin, pout = ai.PRICES.get(model, (float("nan"), float("nan")))
    return (a.get("in_tokens", 0) * pin + a.get("out_tokens", 0) * pout) / 1e6


def score(cases: List[dict], answers: List[dict], shuffles: int = 20000, seed: int = 1) -> dict:
    ok = [(c, a) for c, a in zip(cases, answers) if "error" not in a]
    r = np.array([c["r"] for c, _ in ok])
    size = np.array([ai.SIZE[a["action"]] for _, a in ok])
    gated = float((r * size).sum())
    rng = np.random.default_rng(seed)
    null = np.array([(r * rng.permutation(size)).sum() for _ in range(shuffles)])
    by = {k: [c["r"] for c, a in ok if a["action"] == k] for k in ai.SIZE}
    return {
        "n": len(ok), "errors": len(answers) - len(ok),
        "baseline_sum_r": float(r.sum()), "gated_sum_r": gated,
        # R kept per unit of risk deployed: the efficiency of the capital the gate lets through
        "baseline_avg_r": float(r.mean()), "gated_avg_r": gated / max(float(size.sum()), 1e-9),
        "random_gate_sum_r": float(null.mean()),
        "p_better_than_random": float((null >= gated).mean()),
        "mix": {k: len(v) for k, v in by.items()},
        "avg_r_by_action": {k: (statistics.mean(v) if v else None) for k, v in by.items()},
        "cost_per_decision": statistics.mean(_cost(a) for _, a in ok) if ok else None,
        "total_cost": sum(_cost(a) for _, a in ok),
        "median_seconds": statistics.median(a["seconds"] for _, a in ok) if ok else None,
    }


def agreement(a: List[dict], b: List[dict]) -> float:
    pairs = [(x["action"], y["action"]) for x, y in zip(a, b) if "error" not in x and "error" not in y]
    return sum(x == y for x, y in pairs) / len(pairs) if pairs else float("nan")


def run(models: List[str], n: int = 200, repeat: int = 50, start: str = "2025-01-01", effort: str = "medium") -> dict:
    """Evaluate each model on the same n cases (plus a repeat on the first `repeat` for consistency)."""
    cases = build_cases(start, n)
    summary = {}
    for model in models:
        first = ask(cases, model, effort)
        s = score(cases, first)
        if repeat and s["n"]:
            s["agreement_on_repeat"] = agreement(first[:repeat], ask(cases[:repeat], model, effort, rep=1))
        s["first_error"] = next((a["error"] for a in first if "error" in a), None)
        summary[model] = s
    (_cache_path().parent / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    return summary


# ---------------------------------------------------------------------------------------------
# Other roles: fine-grained scoring, own directional view, exit management
# ---------------------------------------------------------------------------------------------

def _market(start: str):
    st = make_strategy("donchian")
    klines, funding = bt.load_market(SYMBOLS, st.timeframe, start, refresh=False)
    prepared = {s: st.prepare(df) for s, df in klines.items()}
    free = RiskConfig(max_open_positions=999, max_total_leverage=999)
    trades = bt.run_backtest(prepared, st.timeframe, st.p, free, CostConfig(), funding, start=start).trades
    return prepared, funding, trades[trades["reason"] != "end"]


def _leader(prepared, symbol):
    return None if symbol == "BTCUSDT" else prepared["BTCUSDT"]


def build_task_cases(task: str, start: str, n: int, seed: int = 7) -> List[dict]:
    import pandas as pd
    prepared, funding, trades = _market(start)
    rng = random.Random(seed)
    cases = []
    if task == "score":  # the same signals as the gate evaluation
        for _, tr in trades.iterrows():
            df = prepared[tr["symbol"]]
            i = df.index.get_loc(tr["entry_time"]) - 1
            cases.append({"id": f"{tr['symbol']}|{df.index[i]}", "y": float(tr["r"]),
                          "context": ai.build_context(df, i, int(tr["side"]), float(df["sl"].iloc[i]),
                                                      _leader(prepared, tr["symbol"]), funding.get(tr["symbol"]))})
    elif task == "direction":  # arbitrary moments, judged on the next 7 days (42 bars)
        while len(cases) < n * 3:
            sym = rng.choice(SYMBOLS)
            df = prepared[sym]
            lo = df.index.searchsorted(pd.Timestamp(start))
            i = rng.randrange(max(lo, 900), len(df) - 43)
            c0, c1 = float(df["close"].iloc[i]), float(df["close"].iloc[i + 42])
            cases.append({"id": f"{sym}|{df.index[i]}", "y": (c1 / c0 - 1) * 100,
                          "trend": 1 if c0 > float(df["ema"].iloc[i]) else -1,
                          "context": ai.build_context(df, i, 0, 0.0, _leader(prepared, sym), funding.get(sym))})
    elif task == "exit":  # a random bar inside a real trade; outcome = R still to come if held
        for _, tr in trades.iterrows():
            if tr["bars"] < 8:
                continue
            df = prepared[tr["symbol"]]
            i0 = df.index.get_loc(tr["entry_time"])
            j = i0 + rng.randrange(3, int(tr["bars"]) - 2)
            side, risk = int(tr["side"]), abs(tr["entry"] - tr["sl0"])
            px = float(df["close"].iloc[j])
            r_now = side * (px - tr["entry"]) / risk
            w = df.iloc[i0: j + 1]
            best = float(w["high"].max() if side > 0 else w["low"].min())
            trail = best - side * 4.0 * float(df["atr"].iloc[j])
            k = 100.0 / px
            pos = (f"OPEN POSITION: {'LONG' if side > 0 else 'SHORT'} entered {j - i0 + 1} bars ago at "
                   f"{tr['entry'] * k:.2f}; unrealised result {r_now:+.2f}R (1R = initial risk = "
                   f"{risk / tr['entry'] * 100:.2f}% of entry); trailing stop now near {trail * k:.2f}")
            cases.append({"id": f"{tr['symbol']}|{df.index[j]}", "y": float(tr["r"]) - r_now,
                          "context": pos + "\n" + ai.build_context(df, j, 0, 0.0, _leader(prepared, tr["symbol"]),
                                                                   funding.get(tr["symbol"]))})
    rng.shuffle(cases)
    return cases[:n]


def ask_cases(task: str, cases: List[dict], model: str, effort: str = "medium", workers: int = 6) -> List[dict]:
    cache = _load_cache()
    out, todo = {}, []
    for c in cases:
        key = f"{task}:{model}|{effort}|0|{c['id']}"
        if key in cache:
            out[c["id"]] = cache[key]
        else:
            todo.append((key, c))

    def one(item):
        key, c = item
        try:
            return {"key": key, "id": c["id"], **ai.ask_task(task, c["context"], model, effort)}
        except Exception as e:
            return {"key": key, "id": c["id"], "error": repr(e)}

    if todo:
        with ThreadPoolExecutor(workers) as pool, open(_cache_path(), "a") as f:
            for rec in pool.map(one, todo):
                if "error" not in rec:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    f.flush()
                out[rec["id"]] = rec
    return [out[c["id"]] for c in cases]


def _perm_p(stat, x: np.ndarray, y: np.ndarray, shuffles: int = 20000) -> float:
    """Share of random reassignments of the model's answers that score at least as well."""
    rng = np.random.default_rng(1)
    real = stat(x, y)
    return float(np.mean([stat(rng.permutation(x), y) >= real for _ in range(shuffles)]))


def _rank(v: np.ndarray) -> np.ndarray:
    import pandas as pd
    return pd.Series(v).rank().to_numpy()


def _corr(x, y) -> float:
    return float(np.corrcoef(x, y)[0, 1]) if np.std(x) > 0 and np.std(y) > 0 else 0.0


def score_task(task: str, cases: List[dict], answers: List[dict]) -> dict:
    ok = [(c, a) for c, a in zip(cases, answers) if "error" not in a]
    out = {"n": len(ok), "errors": len(answers) - len(ok),
           "first_error": next((a["error"] for a in answers if "error" in a), None)}
    if not ok:
        return out
    y = np.array([c["y"] for c, _ in ok])
    out["cost_per_decision"] = statistics.mean(_cost(a) for _, a in ok)
    out["total_cost"] = sum(_cost(a) for _, a in ok)
    out["median_seconds"] = statistics.median(a["seconds"] for _, a in ok)
    if task == "score":
        q = np.array([float(a["quality"]) for _, a in ok])
        ry = _rank(y)
        out["spearman"] = _corr(_rank(q), ry)
        out["p"] = _perm_p(lambda a, b: _corr(_rank(a), b), q, ry, 5000)
        top = q >= np.median(q)
        out["avg_r_top_half"], out["avg_r_bottom_half"] = float(y[top].mean()), float(y[~top].mean())
        out["distinct_scores"] = int(len(set(q)))
    elif task == "direction":
        v = np.array([{"long": 1.0, "short": -1.0, "flat": 0.0}[a["view"]] for _, a in ok])
        pnl = lambda a, b: float((a * b).sum())
        out["mix"] = {k: sum(a["view"] == k for _, a in ok) for k in ("long", "short", "flat")}
        out["avg_pct_per_call"] = float((v * y).sum() / max((v != 0).sum(), 1))
        out["sum_pct"] = pnl(v, y)
        out["p"] = _perm_p(pnl, v, y)
        out["hit_rate"] = float(((v * y) > 0).sum() / max((v != 0).sum(), 1))
        pu = np.array([float(a["p_up"]) for _, a in ok])
        out["spearman_p_up"] = _corr(_rank(pu), _rank(y))
        trend = np.array([c["trend"] for c, _ in ok], dtype=float)
        out["ref_always_long_sum_pct"] = float(y.sum())
        out["ref_follow_ema200_sum_pct"] = pnl(trend, y)
    elif task == "exit":
        hold = np.array([1.0 if a["action"] == "hold" else 0.0 for _, a in ok])
        kept = lambda a, b: float((a * b).sum())  # R still earned on the positions it kept
        out["mix"] = {"hold": int(hold.sum()), "close": int(len(hold) - hold.sum())}
        out["r_kept"], out["ref_always_hold_r"] = kept(hold, y), float(y.sum())
        out["avg_remaining_r_if_hold"] = float(y[hold == 1].mean()) if hold.sum() else None
        out["avg_remaining_r_if_close"] = float(y[hold == 0].mean()) if (hold == 0).sum() else None
        out["p"] = _perm_p(kept, hold, y)
    return out


def run_tasks(tasks: List[str], models: List[str], n: int = 150, start: str = "2025-01-01") -> dict:
    summary = {}
    for task in tasks:
        cases = build_task_cases(task, start, n)
        summary[task] = {}
        for model in models:
            summary[task][model] = score_task(task, cases, ask_cases(task, cases, model))
            (_cache_path().parent / "summary_tasks.json").write_text(json.dumps(summary, indent=2, default=str))
            print(task, model, json.dumps({k: (round(v, 3) if isinstance(v, float) else v)
                                           for k, v in summary[task][model].items()}, default=str), flush=True)
    return summary

"""AI portfolio manager: reviews each strategy signal and decides full / half / skip.

The risk engine still runs after it, so the AI can only keep or reduce a trade the rules proposed.
`build_context()` is causal (uses rows <= i only) and is shared by the live engine and the
offline model evaluation, so what gets evaluated is what runs.
"""
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd
import ta

# USD per million tokens (input, output). Source: Anthropic price list cached 2026-11-03.
PRICES = {
    "claude-fable-5-2": (8.0, 40.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
    # Non-Anthropic prices come from third-party listings (Nov 2026), not the providers' own pages.
    "gpt-6.1-sol": (2.0, 10.0),
    "gpt-6.1-terra": (1.0, 5.0),
    "deepseek-v4-pro": (1.32, 3.96),   # peak rate; off-peak is half
    "deepseek-flash": (0.30, 1.20),    # assumed 2x the listed off-peak rate, as for v4-pro
}
SIZE = {"full": 1.0, "half": 0.5, "skip": 0.0}

SYSTEM = """You are the portfolio manager of a systematic crypto futures desk. A rule-based trend-following \
strategy (break of the 20-bar high/low on 4h candles, in the direction of the 200-bar EMA, exit by a 4-ATR \
trailing stop) has just produced a signal, and you decide how much of it to take.

What you need to know about the strategy: it wins roughly 36% of the time and averages about +0.2R per trade \
after costs. Almost all of its profit comes from a small number of large trend runs worth several R; most \
trades are small losses or scratches. So your job is not to find reasons to doubt each breakout, because \
every breakout looks extended. Your job is to tell apart the signals that are unusually likely to fail \
(for example late entries into an exhausted move, breakouts on no participation, crowded positioning shown \
by extreme funding, a market backdrop moving against the trade) from the ordinary ones. Skipping a trade \
that turns into a large winner costs far more than taking one that stops out, so reserve "skip" for cases \
where you see a concrete, specific reason, and use "half" when you see real but not decisive weakness.

Prices in the data are rescaled so the signal bar closes at 100. The stop and the position size are handled \
by a separate risk engine; you only choose the size bucket.

Answer with:
- action: "full", "half" or "skip"
- reason: one or two sentences in Spanish naming the specific evidence behind the choice
- main_risk: one short sentence in Spanish with what would most likely make this trade fail"""

SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["full", "half", "skip"]},
        "reason": {"type": "string"},
        "main_risk": {"type": "string"},
    },
    "required": ["action", "reason", "main_risk"],
    "additionalProperties": False,
}


@dataclass
class Decision:
    action: str
    reason: str
    main_risk: str
    model: str
    cost_usd: float
    seconds: float
    input_tokens: int
    output_tokens: int

    @property
    def size(self) -> float:
        return SIZE[self.action]


def _pct(a: float, b: float) -> float:
    return (a / b - 1) * 100 if b else float("nan")


def build_context(df: pd.DataFrame, i: int, side: int, sl: float, leader: Optional[pd.DataFrame] = None,
                  funding: Optional[pd.Series] = None, label: str = "ASSET", extra: str = "") -> str:
    """Text briefing for the signal on row i of a prepared 4h frame. Only rows <= i are read."""
    w = df.iloc[: i + 1]
    close = float(w["close"].iloc[-1])
    k = 100.0 / close
    atr = float(w["atr"].iloc[-1])
    t = w.index[-1]
    rsi = float(ta.momentum.rsi(w["close"].tail(200), window=14).iloc[-1])
    vol_ratio = float(w["volume"].iloc[-1] / w["volume"].iloc[-21:-1].mean())
    rets = w["close"].pct_change()
    vol30 = float(rets.tail(180).std())
    vol_hist = rets.rolling(180).std().tail(2190).dropna()
    vol_rank = float((vol_hist < vol30).mean() * 100) if len(vol_hist) else float("nan")

    def ret(bars: int) -> float:
        return _pct(close, float(w["close"].iloc[-1 - bars])) if len(w) > bars else float("nan")

    hi, lo = float(w["high"].tail(540).max()), float(w["low"].tail(540).min())
    if side:
        chan = float(w["chan_high"].iloc[-1] if side > 0 else w["chan_low"].iloc[-1])
        prev = w["sig"].iloc[:-1]
        same = np.flatnonzero((prev == side).to_numpy())
        bars_since = int(len(prev) - 1 - same[-1]) if len(same) else None
        lines = [
            f"SIGNAL: {'LONG' if side > 0 else 'SHORT'} {label} (4h bar just closed)",
            f"stop distance: {abs(close - sl) / close * 100:.2f}% | ATR(14): {atr / close * 100:.2f}% of price",
            f"close beyond the 20-bar channel by {abs(close - chan) / atr:.2f} ATR | breakout bar volume = "
            f"{vol_ratio:.2f}x its 20-bar average",
            f"bars since the previous signal in this direction: {bars_since if bars_since is not None else 'none in history'}",
        ]
    else:
        lines = [
            f"MARKET SNAPSHOT: {label} (4h bar just closed)",
            f"ATR(14): {atr / close * 100:.2f}% of price | last bar volume = {vol_ratio:.2f}x its 20-bar average",
        ]
    lines += [
        f"distance from 200-bar EMA: {_pct(close, float(w['ema'].iloc[-1])):+.1f}% | RSI(14): {rsi:.0f}",
        f"returns: 1d {ret(6):+.1f}% | 7d {ret(42):+.1f}% | 30d {ret(180):+.1f}% | 90d {ret(540):+.1f}%",
        f"position in 90-day range: {(close - lo) / (hi - lo) * 100 if hi > lo else 50:.0f}% (0 = low, 100 = high)",
        f"30-day realised volatility percentile vs the last year: {vol_rank:.0f}",
    ]
    if funding is not None and len(funding):
        f = funding[funding.index <= t + pd.Timedelta(hours=4)]
        if len(f):
            lines.append(f"funding rate: last {f.iloc[-1] * 100:+.4f}% per 8h | 7-day mean {f.tail(21).mean() * 100:+.4f}% "
                         f"(positive = longs pay shorts)")
    if leader is not None:
        b = leader[leader.index <= t]
        if len(b) > 180:
            bc = float(b["close"].iloc[-1])
            trend = "above" if bc > float(b["ema"].iloc[-1]) else "below"
            lines.append(f"market leader (BTC): 1d {_pct(bc, float(b['close'].iloc[-7])):+.1f}% | 7d "
                         f"{_pct(bc, float(b['close'].iloc[-43])):+.1f}% | 30d {_pct(bc, float(b['close'].iloc[-181])):+.1f}% "
                         f"| {trend} its 200-bar EMA")
    if extra:
        lines.append(extra)

    daily = w["close"].resample("1D").last().dropna().tail(30) * k
    lines.append("\nlast 30 daily closes (oldest first): " + " ".join(f"{v:.1f}" for v in daily))
    lines.append("\nlast 24 bars of 4h candles (oldest first) open high low close volume_vs_avg:")
    vavg = w["volume"].rolling(20).mean()
    for ts, r in w.tail(24).iterrows():
        lines.append(f"{r['open'] * k:.2f} {r['high'] * k:.2f} {r['low'] * k:.2f} {r['close'] * k:.2f} "
                     f"{r['volume'] / vavg.loc[ts]:.2f}")
    return "\n".join(lines)


# OpenAI-compatible providers: name -> (base URL, env var with the key)
COMPATIBLE = {
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY"),
    "deepseek": ("https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"),
}
JSON_HINT = ('\n\nReply with a single JSON object and nothing else: '
             '{"action": "full" | "half" | "skip", "reason": "...", "main_risk": "..."}')

_client = None


def _env():
    from dotenv import load_dotenv
    load_dotenv()


def provider_of(model: str) -> str:
    if model.startswith("claude-"):
        return "anthropic"
    return "deepseek" if model.startswith("deepseek") else "openai"


def available_providers() -> Dict[str, bool]:
    _env()
    return {"anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
            **{name: bool(os.getenv(var)) for name, (_, var) in COMPATIBLE.items()}}


def list_models(provider: str) -> list:
    """Model ids the configured key can use, straight from the provider."""
    _env()
    if provider == "anthropic":
        return sorted(m.id for m in _get_client().models.list())
    import requests
    base, var = COMPATIBLE[provider]
    r = requests.get(f"{base}/models", headers={"Authorization": f"Bearer {os.environ[var]}"}, timeout=30)
    r.raise_for_status()
    return sorted(m["id"] for m in r.json()["data"])


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _env()
        _client = anthropic.Anthropic(max_retries=4)
    return _client


def _decision(data: dict, model: str, t0: float, tokens_in: int, tokens_out: int) -> Decision:
    if data.get("action") not in SIZE:
        raise RuntimeError(f"{model}: invalid action {data.get('action')!r}")
    pin, pout = PRICES.get(model, (float("nan"), float("nan")))  # unknown price -> cost is NaN, not zero
    return Decision(data["action"], str(data.get("reason", "")), str(data.get("main_risk", "")), model,
                    (tokens_in * pin + tokens_out * pout) / 1e6, time.time() - t0, tokens_in, tokens_out)


def _decide_anthropic(context: str, model: str, effort: str) -> Decision:
    t0 = time.time()
    resp = _get_client().messages.create(
        model=model,
        max_tokens=8000,
        system=SYSTEM,
        messages=[{"role": "user", "content": context}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    if resp.stop_reason != "end_turn":
        raise RuntimeError(f"{model}: stop_reason={resp.stop_reason}")
    data = json.loads(next(b.text for b in resp.content if b.type == "text"))
    return _decision(data, model, t0, resp.usage.input_tokens, resp.usage.output_tokens)


def _decide_compatible(context: str, model: str, provider: str) -> Decision:
    """Chat Completions call for OpenAI-compatible providers, at the model's default reasoning setting."""
    import requests
    _env()
    base, var = COMPATIBLE[provider]
    key = os.getenv(var)
    if not key:
        raise RuntimeError(f"{var} is not set")
    t0 = time.time()
    body = {"model": model, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": SYSTEM + JSON_HINT},
                         {"role": "user", "content": context}]}
    for attempt in range(4):
        r = requests.post(f"{base}/chat/completions", json=body, timeout=300,
                          headers={"Authorization": f"Bearer {key}"})
        if r.status_code in (429, 500, 502, 503, 529) and attempt < 3:
            time.sleep(2 ** attempt * 2)
            continue
        break
    if r.status_code != 200:
        raise RuntimeError(f"{model}: HTTP {r.status_code} {r.text[:300]}")
    out = r.json()
    choice = out["choices"][0]
    if choice.get("finish_reason") != "stop":
        raise RuntimeError(f"{model}: finish_reason={choice.get('finish_reason')}")
    usage = out.get("usage") or {}
    return _decision(json.loads(choice["message"]["content"]), model, t0,
                     int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0)))


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


_DESK = ("You work on a systematic crypto futures desk. Prices in the data are rescaled so the latest 4h bar "
         "closes at 100; the asset name and the dates are withheld on purpose. Write `reason` in Spanish, one or "
         "two sentences naming the specific evidence.")

# Extra roles evaluated offline (see ai_eval). Each: system prompt, JSON schema, plain-text shape for providers
# without schema enforcement.
TASKS = {
    "score": {
        "system": SYSTEM.split("Answer with:")[0] + "Instead of a size bucket, rate this signal.\n\nAnswer with:\n"
                  "- quality: integer 0-100, your estimate of how this signal ranks among all signals of this "
                  "strategy (50 = typical, higher = more likely to end as a winner)\n- reason: one or two sentences "
                  "in Spanish naming the specific evidence",
        "schema": _obj({"quality": {"type": "integer"}, "reason": {"type": "string"}}),
        "shape": '{"quality": <integer 0-100>, "reason": "..."}',
    },
    "direction": {
        "system": _DESK + " There is no strategy signal this time: you are given a market snapshot at an arbitrary "
                  "moment and you decide the desk's positioning for the next 7 days. The result is judged on the "
                  "asset's price change over those 7 days: long gains what the price gains, short gains what it "
                  "loses, flat is zero. Most moments have no edge, so choose flat unless the evidence leans one way."
                  "\n\nAnswer with:\n- view: \"long\", \"short\" or \"flat\"\n- p_up: integer 0-100, your "
                  "probability that the price is higher 7 days from now\n- reason",
        "schema": _obj({"view": {"type": "string", "enum": ["long", "short", "flat"]},
                        "p_up": {"type": "integer"}, "reason": {"type": "string"}}),
        "shape": '{"view": "long" | "short" | "flat", "p_up": <integer 0-100>, "reason": "..."}',
    },
    "exit": {
        "system": _DESK + " The desk holds an open position from a trend-following breakout strategy that exits by "
                  "a 4-ATR trailing stop. That strategy earns its money from a few long trend runs, so closing early "
                  "is costly when the trend continues, and holding is costly when the move is over. Decide whether "
                  "to keep following the trailing stop or close the position now at the current price."
                  "\n\nAnswer with:\n- action: \"hold\" or \"close\"\n- reason",
        "schema": _obj({"action": {"type": "string", "enum": ["hold", "close"]}, "reason": {"type": "string"}}),
        "shape": '{"action": "hold" | "close", "reason": "..."}',
    },
}


def ask(system: str, schema: dict, shape: str, context: str, model: str, effort: str = "medium",
        timeout: float = 300, retries: int = 3) -> dict:
    """One structured answer from any provider. Returns the parsed JSON plus in_tokens / out_tokens /
    seconds / cost_usd. Raises on API errors, timeouts, refusals or a missing field; the caller picks the fallback."""
    provider = provider_of(model)
    t0 = time.time()
    if provider == "anthropic":
        resp = _get_client().with_options(timeout=timeout, max_retries=retries).messages.create(
            model=model, max_tokens=8000, system=system,
            messages=[{"role": "user", "content": context}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        )
        if resp.stop_reason != "end_turn":
            raise RuntimeError(f"{model}: stop_reason={resp.stop_reason}")
        data = json.loads(next(b.text for b in resp.content if b.type == "text"))
        tin, tout = resp.usage.input_tokens, resp.usage.output_tokens
    else:
        import requests
        _env()
        base, var = COMPATIBLE[provider]
        key = os.getenv(var)
        if not key:
            raise RuntimeError(f"{var} is not set")
        body = {"model": model, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system +
                              "\n\nReply with a single JSON object and nothing else: " + shape},
                             {"role": "user", "content": context}]}
        tin = tout = 0
        for attempt in range(retries + 1):
            r = requests.post(f"{base}/chat/completions", json=body, timeout=timeout,
                              headers={"Authorization": f"Bearer {key}"})
            if r.status_code in (429, 500, 502, 503, 529) and attempt < retries:
                time.sleep(2 ** attempt * 2)
                continue
            if r.status_code != 200:
                raise RuntimeError(f"{model}: HTTP {r.status_code} {r.text[:300]}")
            out = r.json()
            usage = out.get("usage") or {}
            tin, tout = tin + int(usage.get("prompt_tokens", 0)), tout + int(usage.get("completion_tokens", 0))
            if out["choices"][0].get("finish_reason") != "stop":
                raise RuntimeError(f"{model}: finish_reason={out['choices'][0].get('finish_reason')}")
            try:
                data = json.loads(out["choices"][0]["message"]["content"])
                break
            except json.JSONDecodeError:  # JSON mode without a schema can still emit broken JSON; ask again
                if attempt >= retries:
                    raise
    if not isinstance(data, dict):
        raise RuntimeError(f"{model}: answer is not a JSON object")
    missing = [k for k in schema["required"] if k not in data]
    if missing:
        raise RuntimeError(f"{model}: answer is missing {missing}")
    for k, spec in schema["properties"].items():  # providers without schema enforcement can return anything
        if "enum" in spec and data[k] not in spec["enum"]:
            raise RuntimeError(f"{model}: invalid {k}={data[k]!r}")
    pin, pout = PRICES.get(model, (float("nan"), float("nan")))
    return {**data, "in_tokens": tin, "out_tokens": tout, "seconds": time.time() - t0,
            "cost_usd": (tin * pin + tout * pout) / 1e6}


def ask_task(task: str, context: str, model: str, effort: str = "medium") -> dict:
    """Run one of TASKS (offline evaluation roles)."""
    spec = TASKS[task]
    return ask(spec["system"], spec["schema"], spec["shape"], context, model, effort)


def decide(context: str, model: str = "claude-opus-5-5", effort: str = "medium") -> Decision:
    """Ask the model for a decision. Raises on API errors or a refusal; the caller decides the fallback.

    `effort` applies to Claude models; other providers run at their model's default.
    """
    provider = provider_of(model)
    if provider == "anthropic":
        return _decide_anthropic(context, model, effort)
    return _decide_compatible(context, model, provider)

"""Bot configuration. Defaults can be overridden by <data dir>/config.json."""
import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List

DATA_DIR = Path(os.getenv("BOT_DATA_DIR", Path(__file__).resolve().parent.parent / "bot_data"))

TF_SECONDS = {
    "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600,
    "2h": 7200, "4h": 14400, "6h": 21600, "12h": 43200, "1d": 86400,
}


@dataclass
class RiskConfig:
    risk_per_trade: float = 0.005        # fraction of equity lost if the stop is hit
    max_position_leverage: float = 3.0   # notional / equity, per position
    max_total_leverage: float = 5.0      # sum of notionals / equity
    max_open_positions: int = 3
    daily_loss_limit: float = 0.02       # no new entries after losing this in a UTC day
    max_drawdown_halt: float = 0.15      # live only: pause the bot at this drawdown from peak
    min_stop_pct: float = 0.003          # reject stops closer than this (noise / fee dominated)
    max_stop_pct: float = 0.10           # reject stops further than this
    min_notional: float = 20.0


@dataclass
class CostConfig:
    taker_fee: float = 0.0005            # Binance USDT-M base tier
    slippage: float = 0.0002             # applied against us on every market / stop fill


@dataclass
class AIConfig:
    """AI desk (bot/desk.py). Whether it runs at all is the journal state `ai`: off | shadow | reduce."""
    model: str = "gpt-6.1-terra"         # the model whose answer counts when authority is `reduce`
    shadow_models: List[str] = field(default_factory=lambda: ["claude-haiku-5-5", "deepseek-flash"])
    effort: str = "medium"               # Claude models only
    timeout: float = 45.0                # seconds per call; on timeout the rules signal is taken as is
    daily_budget_usd: float = 1.0        # all models together; once spent, no more calls that UTC day
    max_wakeups_per_day: int = 12        # event / anomaly reviews (the daily review and signals are not capped)
    wakeup_cooldown_min: int = 60        # per trigger
    review_hour_utc: int = 0             # daily review runs at the first tick after this hour
    stance_ttl_hours: float = 26.0       # a stance older than this counts as `normal`
    max_veto_share: float = 0.30         # reduce mode falls back to shadow if the AI skips more than this in 30 days


@dataclass
class BotConfig:
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
    strategy: str = "donchian"
    params: Dict[str, Any] = field(default_factory=dict)
    broker: str = "paper"                # paper | demo | live
    paper_balance: float = 10_000.0
    tick_seconds: int = 20
    risk: RiskConfig = field(default_factory=RiskConfig)
    costs: CostConfig = field(default_factory=CostConfig)
    ai: AIConfig = field(default_factory=AIConfig)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def load_config() -> BotConfig:
    cfg = BotConfig()
    path = DATA_DIR / "config.json"
    if path.exists():
        raw = json.loads(path.read_text())
        for key, value in raw.items():
            if key == "risk":
                cfg.risk = RiskConfig(**{**asdict(cfg.risk), **value})
            elif key == "costs":
                cfg.costs = CostConfig(**{**asdict(cfg.costs), **value})
            elif key == "ai":
                cfg.ai = AIConfig(**{**asdict(cfg.ai), **value})
            elif hasattr(cfg, key):
                setattr(cfg, key, value)
            else:
                raise ValueError(f"Unknown key in {path}: {key}")
    return cfg


def save_config(cfg: BotConfig) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "config.json"
    path.write_text(json.dumps(cfg.to_dict(), indent=2))
    return path

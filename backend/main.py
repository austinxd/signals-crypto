"""
Main entry point for the Crypto Signals System.
Provides both REST API and background signal monitoring.
"""
import time
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set
from contextlib import asynccontextmanager

logger = logging.getLogger("uvicorn.error")

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import (
    DEFAULT_PAIRS,
    AVAILABLE_PAIRS,
    AVAILABLE_TIMEFRAMES,
    DEFAULT_TIMEFRAME,
    POLL_INTERVAL,
    POSITION_POLL_INTERVAL,
)
from binance_client import get_binance_client, create_user_client
from indicators import add_all_indicators, get_latest_indicators
from signals import detect_signal, SignalHistory, evaluate_exit_signals
from notifications import NotificationManager, send_test_notification, send_exit_notification
from database import (
    init_db, get_db, DBHelper, TradingMode, Subscription,
    UserAccount, OperationMode, ExitAlertType, RecommendedAction,
    ActivePosition, ExitAlert,
)
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, get_optional_user,
)


# Available trading modes
TRADING_MODES = ["conservative", "balanced", "aggressive"]


# Global state
signal_history = SignalHistory(use_db=True)
notification_manager = NotificationManager()
market_data: Dict[str, Dict[str, Dict[str, Any]]] = {}
monitoring_active = False
active_pairs: Set[str] = set(DEFAULT_PAIRS)
active_timeframes: Set[str] = {DEFAULT_TIMEFRAME}


# Pydantic models for API
class TokenRegistration(BaseModel):
    token: str
    pairs: Optional[List[str]] = None
    timeframe: Optional[str] = None
    trading_mode: Optional[str] = "balanced"

class PreferencesUpdate(BaseModel):
    token: str
    pairs: Optional[List[str]] = None
    timeframe: Optional[str] = None
    trading_mode: Optional[str] = None

class TestNotification(BaseModel):
    token: str

class UserSettings(BaseModel):
    token: str

class SubscriptionAdd(BaseModel):
    token: str
    pair: str
    timeframe: str
    trading_mode: Optional[str] = "balanced"

class SubscriptionRemove(BaseModel):
    token: str
    subscription_id: int

class SubscriptionList(BaseModel):
    token: str

class NotificationHistoryReq(BaseModel):
    token: str
    limit: Optional[int] = 50

class ClearRequest(BaseModel):
    token: str

# Auth models
class AuthRegister(BaseModel):
    email: str
    password: str

class AuthLogin(BaseModel):
    email: str
    password: str

class AuthRefresh(BaseModel):
    refresh_token: str

class BinanceKeysUpdate(BaseModel):
    api_key: str
    api_secret: str

class AccountSettingsUpdate(BaseModel):
    mode: Optional[str] = None
    risk_percent: Optional[float] = None
    risk_fixed_usdt: Optional[float] = None
    max_leverage: Optional[int] = None
    push_token: Optional[str] = None

class PushTokenUpdate(BaseModel):
    push_token: str


def get_all_monitored_pairs() -> Set[str]:
    pairs = set(DEFAULT_PAIRS)
    if notification_manager.use_db:
        try:
            db = get_db()
            subs = db.query(Subscription).filter(Subscription.enabled == True).all()
            for sub in subs:
                pairs.add(sub.pair)
            users = DBHelper.get_all_users(db)
            for user in users:
                if user.pairs:
                    pairs.update(user.pairs)
            db.close()
        except Exception as e:
            print(f"Error getting monitored pairs from DB: {e}")
    else:
        for settings in notification_manager.tokens.values():
            pairs.update(settings.get("pairs", []))
    return pairs


def get_all_monitored_timeframes() -> Set[str]:
    default_monitored = {"15m", "30m", "1h", "4h", "1d"}
    timeframes = set(default_monitored)
    if notification_manager.use_db:
        try:
            db = get_db()
            subs = db.query(Subscription).filter(Subscription.enabled == True).all()
            for sub in subs:
                if sub.timeframe in AVAILABLE_TIMEFRAMES:
                    timeframes.add(sub.timeframe)
            users = DBHelper.get_all_users(db)
            for user in users:
                if user.timeframe and user.timeframe in AVAILABLE_TIMEFRAMES:
                    timeframes.add(user.timeframe)
            db.close()
        except Exception as e:
            print(f"Error getting monitored timeframes from DB: {e}")
    else:
        for settings in notification_manager.tokens.values():
            tf = settings.get("timeframe")
            if tf and tf in AVAILABLE_TIMEFRAMES:
                timeframes.add(tf)
    return timeframes


# Background monitoring task
def monitor_markets():
    global market_data, monitoring_active, active_pairs, active_timeframes

    client = get_binance_client()
    monitoring_active = True

    while monitoring_active:
        active_pairs = get_all_monitored_pairs()
        active_timeframes = get_all_monitored_timeframes()

        for timeframe in active_timeframes:
            if timeframe not in market_data:
                market_data[timeframe] = {}

            for pair in active_pairs:
                try:
                    df = client.fetch_ohlcv(pair, timeframe)
                    if df is None or len(df) < 200:
                        continue

                    df = add_all_indicators(df)
                    indicators = get_latest_indicators(df)
                    if indicators is None:
                        continue

                    funding_data = None
                    if timeframe == list(active_timeframes)[0]:
                        funding_data = client.get_funding_rate(pair)

                    market_data[timeframe][pair] = {
                        "pair": pair,
                        "timeframe": timeframe,
                        "price": indicators["price"],
                        "indicators": indicators,
                        "funding": funding_data,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }

                    signal = detect_signal(pair, indicators, funding_data)
                    if signal:
                        signal.timeframe = timeframe
                        result = notification_manager.send_signal_to_subscribers(signal, pair, timeframe)
                        if result.get("status") not in ["skipped", "no_subscribers"]:
                            print(f"Signal: {signal.signal_type.value} {pair} ({timeframe}) - {signal.quality.value}")
                    else:
                        result = notification_manager.notify_signal_disappeared(pair, timeframe)
                        if result.get("status") == "notified":
                            print(f"Signal disappeared: {pair} ({timeframe})")

                except Exception as e:
                    print(f"Error monitoring {pair} ({timeframe}): {e}")

        for _ in range(POLL_INTERVAL):
            if not monitoring_active:
                break
            time.sleep(1)


# Position monitoring thread
def monitor_positions():
    global monitoring_active

    while monitoring_active:
        try:
            db = get_db()
            accounts = DBHelper.get_accounts_with_binance_keys(db)
            # Eagerly load all attributes and extract keys before closing session
            account_data = []
            for acc in accounts:
                try:
                    api_key, api_secret = acc.get_binance_keys()
                    account_data.append({
                        "id": acc.id,
                        "mode": acc.mode,
                        "api_key": api_key,
                        "api_secret": api_secret,
                        "push_token": acc.push_token,
                        "push_enabled": acc.push_enabled,
                    })
                except Exception as e:
                    logger.error(f"[POSITIONS] Error loading keys for account {acc.id}: {e}")
            db.close()

            logger.info(f"[POSITIONS] Monitoring {len(account_data)} accounts with Binance keys")

            for account in account_data:
                try:
                    api_key = account["api_key"]
                    api_secret = account["api_secret"]
                    if not api_key or not api_secret:
                        continue

                    user_client = create_user_client(api_key, api_secret)
                    binance_positions = user_client.fetch_futures_positions()

                    account_id = account["id"]

                    db = get_db()
                    db_positions = DBHelper.get_open_positions(db, account_id)
                    db_symbols = {(p.symbol, p.side) for p in db_positions}
                    binance_symbols = {(p["symbol"], p["side"]) for p in binance_positions}

                    logger.info(f"[POSITIONS] Account {account_id}: {len(binance_positions)} Binance positions, {len(db_positions)} DB positions")

                    # Close positions no longer on Binance
                    for pos in db_positions:
                        if (pos.symbol, pos.side) not in binance_symbols:
                            DBHelper.close_position(db, pos.id)

                    # Upsert positions from Binance
                    for bp in binance_positions:
                        pos = DBHelper.upsert_position(
                            db, account_id, bp["symbol"], bp["side"],
                            bp["entry_price"], bp["amount"], bp["leverage"],
                            bp["unrealized_pnl"], bp["current_price"],
                            bp.get("liquidation_price"),
                        )

                        # Calculate indicators for this symbol (15m)
                        global_client = get_binance_client()
                        pair = bp["symbol"]
                        try:
                            df = global_client.fetch_ohlcv(pair, "15m")
                            if df is not None and len(df) >= 200:
                                df = add_all_indicators(df)
                                indicators = get_latest_indicators(df)

                                if indicators:
                                    atr = indicators.get("atr", 0)
                                    divergence = indicators.get("divergence")

                                    # Set entry ATR if not set
                                    if pos.entry_atr is None and atr:
                                        pos.entry_atr = atr
                                        db.commit()

                                    exit_signals = evaluate_exit_signals(pos, indicators, atr, divergence)

                                    for es in exit_signals:
                                        # Map string to enum
                                        alert_type_map = {
                                            "TRAILING_BREAKEVEN": ExitAlertType.TRAILING_BREAKEVEN,
                                            "TRAILING_UPDATE": ExitAlertType.TRAILING_UPDATE,
                                            "MACD_REVERSAL": ExitAlertType.MACD_REVERSAL,
                                            "RSI_EXTREME": ExitAlertType.RSI_EXTREME,
                                            "RSI_DIVERGENCE": ExitAlertType.RSI_DIVERGENCE,
                                        }
                                        action_map = {
                                            "MOVE_SL": RecommendedAction.MOVE_SL,
                                            "CLOSE_50%": RecommendedAction.CLOSE_50,
                                            "CLOSE_ALL": RecommendedAction.CLOSE_ALL,
                                        }

                                        was_executed = False

                                        # Bot mode: execute MOVE_SL
                                        if (account["mode"] == OperationMode.BOT
                                                and es.recommended_action == "MOVE_SL"
                                                and es.new_sl_price):
                                            result = user_client.modify_stop_loss(
                                                pair, pos.side, es.new_sl_price, pos.amount
                                            )
                                            if result:
                                                was_executed = True
                                                DBHelper.update_position_sl(db, pos.id, es.new_sl_price)
                                                # Mark breakeven reached
                                                if es.alert_type == "TRAILING_BREAKEVEN":
                                                    pos.breakeven_reached = True
                                                    db.commit()

                                        alert = DBHelper.create_exit_alert(
                                            db, pos.id, account_id, pair,
                                            alert_type_map.get(es.alert_type, ExitAlertType.TRAILING_UPDATE),
                                            es.message,
                                            action_map.get(es.recommended_action),
                                            es.new_sl_price,
                                            was_executed,
                                        )

                                        if alert:
                                            send_exit_notification(
                                                account, pair, es.alert_type,
                                                es.message, was_executed,
                                            )

                        except Exception as e:
                            logger.error(f"Error calculating indicators for position {pair}: {e}")

                    db.close()

                except Exception as e:
                    logger.error(f"Error monitoring positions for account {account['id']}: {e}")

        except Exception as e:
            logger.error(f"Error in position monitor loop: {e}", exc_info=True)

        for _ in range(POSITION_POLL_INTERVAL):
            if not monitoring_active:
                break
            time.sleep(1)


# Lifespan management
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        logger.info("Database initialized")
    except Exception as e:
        print(f"Database initialization failed (using JSON fallback): {e}")

    # Start background monitoring
    monitor_thread = threading.Thread(target=monitor_markets, daemon=True)
    monitor_thread.start()
    logger.info("Signal monitoring started")

    # Start position monitoring
    position_thread = threading.Thread(target=monitor_positions, daemon=True)
    position_thread.start()
    logger.info("Position monitoring started")

    yield
    global monitoring_active
    monitoring_active = False
    print("Monitoring stopped")


# FastAPI app
app = FastAPI(
    title="Crypto Signals API",
    description="API for crypto trading signals with push notifications",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Auth Endpoints
# ============================================================

@app.post("/api/auth/register")
async def auth_register(data: AuthRegister):
    if not data.email or not data.password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    db = get_db()
    try:
        existing = DBHelper.get_account_by_email(db, data.email.lower())
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        pw_hash = hash_password(data.password)
        account = DBHelper.create_account(db, data.email.lower(), pw_hash)

        access_token = create_access_token(account.id, account.email)
        refresh_token = create_refresh_token(account.id)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": account.id,
                "email": account.email,
                "mode": account.mode.value,
            },
        }
    finally:
        db.close()


@app.post("/api/auth/login")
async def auth_login(data: AuthLogin):
    db = get_db()
    try:
        account = DBHelper.get_account_by_email(db, data.email.lower())
        if not account:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        if not verify_password(data.password, account.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        access_token = create_access_token(account.id, account.email)
        refresh_token = create_refresh_token(account.id)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": account.id,
                "email": account.email,
                "mode": account.mode.value,
                "has_binance_keys": account.has_binance_keys(),
            },
        }
    finally:
        db.close()


@app.post("/api/auth/refresh")
async def auth_refresh(data: AuthRefresh):
    payload = decode_token(data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = int(payload["sub"])
    db = get_db()
    try:
        account = DBHelper.get_account_by_id(db, user_id)
        if not account:
            raise HTTPException(status_code=401, detail="User not found")

        access_token = create_access_token(account.id, account.email)
        return {"access_token": access_token}
    finally:
        db.close()


# ============================================================
# Account Endpoints (JWT protected)
# ============================================================

@app.get("/api/account/profile")
async def get_profile(user: UserAccount = Depends(get_current_user)):
    # Show masked API key hint (last 4 chars)
    api_key_hint = ""
    if user.has_binance_keys():
        try:
            key, _ = user.get_binance_keys()
            if key:
                api_key_hint = f"...{key[-4:]}"
        except Exception:
            api_key_hint = "...????"

    return {
        "id": user.id,
        "email": user.email,
        "mode": user.mode.value,
        "has_binance_keys": user.has_binance_keys(),
        "api_key_hint": api_key_hint,
        "risk_percent": user.risk_percent,
        "risk_fixed_usdt": user.risk_fixed_usdt,
        "max_leverage": user.max_leverage,
        "push_token": user.push_token,
        "push_enabled": user.push_enabled,
        "trading_mode": user.trading_mode.value if user.trading_mode else "balanced",
    }


@app.post("/api/account/verify-binance")
async def verify_binance(user: UserAccount = Depends(get_current_user)):
    """Test Binance API connection."""
    if not user.has_binance_keys():
        raise HTTPException(status_code=400, detail="No API keys configured")
    try:
        key, secret = user.get_binance_keys()
        client = create_user_client(key, secret)
        balance = client.exchange.fetch_balance()
        usdt = balance.get("USDT", {})
        total = usdt.get("total", 0)
        return {"status": "ok", "message": f"Connected. Balance: {total:.2f} USDT"}
    except Exception as e:
        return {"status": "error", "message": f"Connection failed: {str(e)[:100]}"}


@app.delete("/api/account/binance-keys")
async def delete_binance_keys(user: UserAccount = Depends(get_current_user)):
    """Remove Binance API keys."""
    db = get_db()
    try:
        account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
        account.binance_api_key = None
        account.binance_api_secret = None
        db.commit()
        return {"status": "ok", "message": "API keys removed"}
    finally:
        db.close()


@app.put("/api/account/binance-keys")
async def update_binance_keys(data: BinanceKeysUpdate, user: UserAccount = Depends(get_current_user)):
    db = get_db()
    try:
        account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
        if account is None:
            raise HTTPException(status_code=404, detail="Account not found")

        print(f"[BINANCE-KEYS] Saving keys for user {user.id}, key_len={len(data.api_key)}, secret_len={len(data.api_secret)}")
        account.set_binance_keys(data.api_key, data.api_secret)
        db.commit()
        print(f"[BINANCE-KEYS] Committed. has_keys={account.has_binance_keys()}, encrypted_key_len={len(account.binance_api_key or '')}")

        # Verify keys work
        try:
            client = create_user_client(data.api_key, data.api_secret)
            client.exchange.fetch_balance()
            return {"status": "ok", "message": "Keys verified and saved"}
        except Exception as e:
            print(f"[BINANCE-KEYS] Verify failed: {e}")
            return {"status": "saved", "message": f"Keys saved. Verification failed: {str(e)[:100]}"}
    finally:
        db.close()


@app.put("/api/account/settings")
async def update_account_settings(data: AccountSettingsUpdate, user: UserAccount = Depends(get_current_user)):
    db = get_db()
    try:
        account = db.query(UserAccount).filter(UserAccount.id == user.id).first()

        if data.mode is not None:
            account.mode = OperationMode(data.mode)
        if data.risk_percent is not None:
            account.risk_percent = max(0.5, min(10.0, data.risk_percent))
        if data.risk_fixed_usdt is not None:
            account.risk_fixed_usdt = data.risk_fixed_usdt
        if data.max_leverage is not None:
            account.max_leverage = max(1, min(50, data.max_leverage))
        if data.push_token is not None:
            account.push_token = data.push_token
            account.push_enabled = True

        db.commit()
        return {"status": "updated"}
    finally:
        db.close()


# ============================================================
# Position Endpoints (JWT protected)
# ============================================================

def _normalize_symbol(symbol: str) -> str:
    """Normalize CCXT symbol like ETH/USDT:USDT to ETH/USDT."""
    if ":" in symbol:
        symbol = symbol.split(":")[0]
    return symbol


POSITION_TIMEFRAMES = ["15m", "1h", "4h"]


def _fetch_tf_indicators(client, pair: str, timeframe: str):
    """Fetch indicators for a single timeframe. Returns dict or None."""
    try:
        df = client.fetch_ohlcv(pair, timeframe)
        if df is None or len(df) < 200:
            return None
        df = add_all_indicators(df)
        ind = get_latest_indicators(df)
        if not ind:
            return None

        rsi = ind.get("rsi")
        macd_hist = ind.get("macd_histogram")
        macd_trend = "bullish" if (macd_hist and macd_hist > 0) else "bearish"
        price_above_ema = ind.get("price_above_ema")
        vol_above = ind.get("volume_above_average", False)

        # Sentiment for this timeframe
        bullish_count = sum([
            (rsi is not None and rsi > 50),
            macd_trend == "bullish",
            price_above_ema is True,
        ])
        sentiment = "bullish" if bullish_count >= 2 else ("bearish" if bullish_count == 0 else "neutral")

        div = ind.get("divergence")
        divergence_type = None
        if div:
            if div.get("bearish_divergence"):
                divergence_type = "bearish"
            elif div.get("bullish_divergence"):
                divergence_type = "bullish"

        fib = ind.get("fibonacci")
        fib_data = None
        if fib:
            fib_data = {
                "swing_high": fib["swing_high"],
                "swing_low": fib["swing_low"],
                "is_uptrend": fib["is_uptrend"],
                "levels": fib["levels"],
                "closest_level_name": fib.get("closest_level_name"),
                "closest_level": fib.get("closest_level"),
                "distance_percent": fib.get("distance_percent"),
                "at_key_level": fib.get("at_key_level"),
                "near_key_level": fib.get("near_key_level"),
                "key_level_name": fib.get("key_level_name"),
                "entry_quality": fib.get("entry_quality"),
            }

        return {
            "rsi": round(rsi, 1) if rsi is not None else None,
            "macd_histogram": round(macd_hist, 6) if macd_hist is not None else None,
            "macd_trend": macd_trend,
            "macd_crossover_bullish": ind.get("macd_crossover_bullish", False),
            "macd_crossover_bearish": ind.get("macd_crossover_bearish", False),
            "price_above_ema": price_above_ema,
            "volume_above_average": vol_above,
            "atr": round(ind.get("atr", 0), 2) if ind.get("atr") else None,
            "divergence": divergence_type,
            "fibonacci": fib_data,
            "sentiment": sentiment,
        }
    except Exception as e:
        logger.error(f"Error fetching {timeframe} indicators for {pair}: {e}")
        return None


def _format_price(p):
    if p is None:
        return "-"
    if p < 0.01:
        return f"${p:.6f}"
    if p < 1:
        return f"${p:.4f}"
    if p < 10:
        return f"${p:.3f}"
    if p < 1000:
        return f"${p:.2f}"
    return f"${p:,.0f}"


def _compute_market_analysis(pair: str, indicators: dict, funding: dict = None) -> dict:
    """
    Compute 3-layer market analysis for the Mercado tab.
    This is PRE-ENTRY analysis - classifies terrain, not generates orders.

    Layer 1: HTF Context (4H) - bias, structure, volatility
    Layer 2: Current Price State - interpreted indicators
    Layer 3: Scenario Classification - favorable/operable/alto_riesgo/espera
    """
    analysis = {
        # Layer 1: HTF Context
        "htf_bias": "neutral",  # alcista / bajista / mixto / neutral
        "htf_structure": "sin_datos",  # tendencia / retroceso / consolidacion / sin_datos
        "volatility_state": "normal",  # alta / normal / baja

        # Layer 2: Price State
        "price_state": {
            "ema_position": None,  # "sobre" / "bajo"
            "rsi_zone": None,  # "sobrecompra" / "sobrevendido" / "alcista" / "bajista" / "neutral"
            "macd_momentum": None,  # "alcista" / "bajista" / "cruce_alcista" / "cruce_bajista"
            "volume_state": None,  # "alto" / "normal" / "bajo"
            "fibo_context": None,  # descripcion del nivel fibonacci
        },
        "price_interpretation": "",  # Single sentence interpreting current state

        # Layer 3: Scenario Classification
        "scenario": "espera",  # favorable / operable / alto_riesgo / espera
        "direction_preference": None,  # "long" / "short" / None (only if HTF allows)
        "scenario_reason": "",  # Why this classification

        # Key levels for reference
        "key_levels": [],

        # Summary observations (factual)
        "observations": [],
    }

    if not indicators:
        analysis["scenario_reason"] = "Sin datos de indicadores disponibles"
        return analysis

    price = indicators.get("price")
    rsi = indicators.get("rsi")
    macd_hist = indicators.get("macd_histogram")
    macd_bullish = indicators.get("macd_crossover_bullish")
    macd_bearish = indicators.get("macd_crossover_bearish")
    price_above_ema = indicators.get("price_above_ema")
    volume_above = indicators.get("volume_above_average")
    volume_ratio = indicators.get("volume_ratio", 1)
    atr = indicators.get("atr")
    fib = indicators.get("fibonacci")
    divergence = indicators.get("divergence")

    # ========== LAYER 1: HTF CONTEXT ==========
    # Determine structure bias from EMA200
    ema_bias = None
    if price_above_ema is True:
        ema_bias = "alcista"
        analysis["price_state"]["ema_position"] = "sobre"
    elif price_above_ema is False:
        ema_bias = "bajista"
        analysis["price_state"]["ema_position"] = "bajo"

    # Determine momentum from MACD
    macd_bias = None
    if macd_hist is not None:
        if macd_hist > 0:
            macd_bias = "alcista"
            analysis["price_state"]["macd_momentum"] = "alcista"
        else:
            macd_bias = "bajista"
            analysis["price_state"]["macd_momentum"] = "bajista"

    if macd_bullish:
        analysis["price_state"]["macd_momentum"] = "cruce_alcista"
    elif macd_bearish:
        analysis["price_state"]["macd_momentum"] = "cruce_bajista"

    # Combine for HTF bias - requires agreement for clear direction
    if ema_bias and macd_bias:
        if ema_bias == macd_bias:
            analysis["htf_bias"] = ema_bias
        else:
            analysis["htf_bias"] = "mixto"
    elif ema_bias:
        analysis["htf_bias"] = ema_bias
    elif macd_bias:
        analysis["htf_bias"] = macd_bias

    # Structure from Fibonacci
    if fib:
        is_uptrend = fib.get("is_uptrend", False)
        dist = fib.get("distance_percent", 0)
        at_level = fib.get("at_key_level", False)
        near_level = fib.get("near_key_level", False)
        level_name = fib.get("key_level_name", "")

        if at_level or near_level:
            analysis["htf_structure"] = "en nivel clave"
            proximity = "en" if at_level else "cerca de"
            analysis["price_state"]["fibo_context"] = f"Precio {proximity} Fibo {level_name}"
        elif abs(dist) < 3:
            analysis["htf_structure"] = "consolidacion"
            analysis["price_state"]["fibo_context"] = "Precio en zona de consolidacion"
        elif (is_uptrend and dist > 0) or (not is_uptrend and dist < 0):
            analysis["htf_structure"] = "extension"
            analysis["price_state"]["fibo_context"] = f"Extension {'alcista' if is_uptrend else 'bajista'}"
        else:
            analysis["htf_structure"] = "retroceso"
            trend = "alcista" if is_uptrend else "bajista"
            analysis["price_state"]["fibo_context"] = f"Retroceso en tendencia {trend}"

    # Volatility from ATR and volume
    if atr and price:
        atr_pct = (atr / price) * 100
        if atr_pct > 3:
            analysis["volatility_state"] = "alta"
        elif atr_pct < 1:
            analysis["volatility_state"] = "baja"
        else:
            analysis["volatility_state"] = "normal"

    # ========== LAYER 2: PRICE STATE ==========
    # RSI interpretation
    if rsi is not None:
        if rsi > 70:
            analysis["price_state"]["rsi_zone"] = "sobrecompra"
        elif rsi < 30:
            analysis["price_state"]["rsi_zone"] = "sobrevendido"
        elif rsi > 55:
            analysis["price_state"]["rsi_zone"] = "alcista"
        elif rsi < 45:
            analysis["price_state"]["rsi_zone"] = "bajista"
        else:
            analysis["price_state"]["rsi_zone"] = "neutral"

    # Volume state
    if volume_ratio is not None:
        if volume_ratio > 1.5:
            analysis["price_state"]["volume_state"] = "alto"
        elif volume_ratio < 0.7:
            analysis["price_state"]["volume_state"] = "bajo"
        else:
            analysis["price_state"]["volume_state"] = "normal"

    # Build price interpretation
    parts = []
    if analysis["price_state"]["ema_position"]:
        parts.append(f"precio {analysis['price_state']['ema_position']} EMA200")
    if analysis["price_state"]["rsi_zone"]:
        zone = analysis["price_state"]["rsi_zone"]
        if zone == "sobrecompra":
            parts.append("RSI en sobrecompra")
        elif zone == "sobrevendido":
            parts.append("RSI en sobreventa")
        elif zone in ["alcista", "bajista"]:
            parts.append(f"momentum {zone}")
    if analysis["price_state"]["macd_momentum"]:
        mom = analysis["price_state"]["macd_momentum"]
        if "cruce" in mom:
            parts.append(f"MACD con {mom.replace('_', ' ')}")
        else:
            parts.append(f"MACD {mom}")

    if parts:
        analysis["price_interpretation"] = ", ".join(parts).capitalize()

    # ========== LAYER 3: SCENARIO CLASSIFICATION ==========
    htf_bias = analysis["htf_bias"]
    rsi_zone = analysis["price_state"]["rsi_zone"]
    structure = analysis["htf_structure"]
    vol_state = analysis["volatility_state"]
    macd_state = analysis["price_state"]["macd_momentum"]

    # Classification logic:
    # FAVORABLE: Clear HTF bias + supportive indicators + good entry zone
    # OPERABLE: HTF bias present but entry zone not ideal
    # ALTO_RIESGO: Conflicting signals, extreme RSI, or divergence
    # ESPERA: No clear bias, waiting for confirmation

    risk_factors = 0
    favorable_factors = 0

    # Check risk factors
    if htf_bias == "mixto":
        risk_factors += 2
    if rsi_zone in ["sobrecompra", "sobrevendido"]:
        risk_factors += 1
    if divergence:
        risk_factors += 2
    if vol_state == "alta":
        risk_factors += 1

    # Check favorable factors
    if htf_bias in ["alcista", "bajista"]:
        favorable_factors += 2
    if structure in ["retroceso", "en nivel clave"]:
        favorable_factors += 1
    if macd_state and "cruce" in macd_state:
        favorable_factors += 1
    if vol_state == "normal":
        favorable_factors += 1

    # Funding rate consideration
    if funding:
        sentiment = funding.get("sentiment", "")
        if htf_bias == "alcista" and sentiment == "too_many_shorts":
            favorable_factors += 1
        elif htf_bias == "bajista" and sentiment == "too_many_longs":
            favorable_factors += 1
        elif sentiment in ["too_many_longs", "too_many_shorts"]:
            risk_factors += 1

    # Determine scenario
    if risk_factors >= 3:
        analysis["scenario"] = "alto_riesgo"
        analysis["scenario_reason"] = "Multiples senales conflictivas o extremas"
    elif htf_bias == "neutral" or htf_bias == "mixto":
        analysis["scenario"] = "espera"
        analysis["scenario_reason"] = "Sin sesgo direccional claro en HTF"
    elif favorable_factors >= 3 and risk_factors <= 1:
        analysis["scenario"] = "favorable"
        analysis["scenario_reason"] = f"Contexto {htf_bias} con estructura {structure}"
    elif favorable_factors >= 2:
        analysis["scenario"] = "operable"
        analysis["scenario_reason"] = f"Contexto {htf_bias} pero entrada no ideal"
    else:
        analysis["scenario"] = "espera"
        analysis["scenario_reason"] = "Esperando confirmacion adicional"

    # Direction preference (only if HTF allows)
    if analysis["scenario"] in ["favorable", "operable"]:
        if htf_bias == "alcista":
            # Check if RSI allows long
            if rsi_zone not in ["sobrecompra"]:
                analysis["direction_preference"] = "long"
        elif htf_bias == "bajista":
            # Check if RSI allows short
            if rsi_zone not in ["sobrevendido"]:
                analysis["direction_preference"] = "short"

    # ========== KEY LEVELS ==========
    if fib and fib.get("levels"):
        levels = fib["levels"]
        for name in ["38.2", "50.0", "61.8"]:
            if name in levels:
                analysis["key_levels"].append({
                    "name": f"Fibo {name}%",
                    "price": levels[name]
                })

    # ========== OBSERVATIONS (factual only) ==========
    obs = []

    if htf_bias == "mixto":
        obs.append("Estructura y momentum en conflicto")

    if price_above_ema is not None:
        zone = "sobre" if price_above_ema else "bajo"
        bias = "alcista" if price_above_ema else "bajista"
        obs.append(f"Precio {zone} EMA200 (estructura {bias})")

    if macd_state:
        if "cruce" in macd_state:
            direction = "alcista" if "alcista" in macd_state else "bajista"
            obs.append(f"MACD acaba de cruzar {direction}")
        else:
            obs.append(f"Momentum MACD {macd_state}")

    if rsi is not None:
        if rsi_zone in ["sobrecompra", "sobrevendido"]:
            obs.append(f"RSI en {rsi:.0f} - zona de {rsi_zone}")
        else:
            obs.append(f"RSI en {rsi:.0f}")

    if divergence:
        obs.append(f"Divergencia {divergence} detectada")

    if vol_state == "alto":
        obs.append(f"Volumen elevado ({volume_ratio:.1f}x promedio)")
    elif vol_state == "bajo":
        obs.append(f"Volumen bajo ({volume_ratio:.1f}x promedio)")

    if funding:
        rate = funding.get("funding_rate_percent", 0)
        sentiment = funding.get("sentiment", "balanced")
        if sentiment == "too_many_longs":
            obs.append(f"Funding {rate:.4f}% (exceso de longs)")
        elif sentiment == "too_many_shorts":
            obs.append(f"Funding {rate:.4f}% (exceso de shorts)")

    analysis["observations"] = obs

    return analysis


def _compute_position_analysis(symbol: str, side: str, entry_price: float, current_price: float):
    """
    Analyze position according to spec:
    - HTF context (4H) determines bias
    - Explicit coherence: trade vs context
    - Management scenarios (favorable + invalidation)
    - Neutral suggestions (conditions, not actions)
    """
    empty_tf = {
        "rsi": None, "macd_histogram": None, "macd_trend": None,
        "price_above_ema": None, "volume_above_average": None,
        "atr": None, "divergence": None, "fibonacci": None, "sentiment": "neutral",
    }
    timeframes_data = {tf: dict(empty_tf) for tf in POSITION_TIMEFRAMES}

    analysis = {
        "htf_bias": "neutral",  # alcista / bajista / mixto / neutral
        "htf_structure": "indecision",  # tendencia / retroceso / extension / indecision
        "ltf_momentum": "neutral",  # alcista / bajista / neutral
        "coherence": "neutral",  # a_favor / contra / neutral
        "coherence_text": "",
        "favorable_scenario": "",
        "invalidation_scenario": "",
        "invalidation_level": None,
        "invalidation_breached": False,
        "key_levels": [],
        "observations": [],  # Factual observations without recommendations
    }

    try:
        client = get_binance_client()
        pair = _normalize_symbol(symbol)

        for tf in POSITION_TIMEFRAMES:
            result = _fetch_tf_indicators(client, pair, tf)
            if result:
                timeframes_data[tf] = result

        is_long = side.upper() == "LONG"
        side_label = "LONG" if is_long else "SHORT"

        # ========== 1. HTF CONTEXT (4H manda) ==========
        htf = timeframes_data.get("4h", {})
        htf_rsi = htf.get("rsi")
        htf_macd = htf.get("macd_trend")
        htf_ema = htf.get("price_above_ema")
        htf_fib = htf.get("fibonacci")
        htf_atr = htf.get("atr")

        # Determine HTF bias
        # EMA200 = estructura principal, MACD = momentum
        # Solo hay sesgo claro si ambos coinciden
        ema_bias = None
        if htf_ema is True:
            ema_bias = "alcista"
        elif htf_ema is False:
            ema_bias = "bajista"

        macd_bias = None
        if htf_macd == "bullish":
            macd_bias = "alcista"
        elif htf_macd == "bearish":
            macd_bias = "bajista"

        # Sesgo HTF: EMA y MACD deben coincidir para sesgo claro
        if ema_bias and macd_bias and ema_bias == macd_bias:
            analysis["htf_bias"] = ema_bias
        elif ema_bias and macd_bias and ema_bias != macd_bias:
            # Conflicto: EMA dice una cosa, MACD otra = rango/mixto
            analysis["htf_bias"] = "mixto"
        elif ema_bias:
            analysis["htf_bias"] = ema_bias
        elif macd_bias:
            analysis["htf_bias"] = macd_bias
        else:
            analysis["htf_bias"] = "neutral"

        # Store individual components for observations
        analysis["_ema_bias"] = ema_bias
        analysis["_macd_bias"] = macd_bias

        # Determine structure
        if htf_fib:
            is_uptrend = htf_fib.get("is_uptrend", False)
            dist = htf_fib.get("distance_percent", 0)
            if analysis["htf_bias"] != "rango":
                if abs(dist) < 2:
                    analysis["htf_structure"] = "en nivel clave"
                elif (is_uptrend and dist > 0) or (not is_uptrend and dist < 0):
                    analysis["htf_structure"] = "extension"
                else:
                    analysis["htf_structure"] = "retroceso"
            else:
                analysis["htf_structure"] = "rango lateral"
        else:
            analysis["htf_structure"] = "sin estructura clara"

        # ========== 2. LTF MOMENTUM (15m/1h) ==========
        ltf = timeframes_data.get("1h", {}) or timeframes_data.get("15m", {})
        ltf_rsi = ltf.get("rsi")
        ltf_macd = ltf.get("macd_trend")

        if ltf_macd == "bullish" and ltf_rsi and ltf_rsi > 50:
            analysis["ltf_momentum"] = "alcista"
        elif ltf_macd == "bearish" and ltf_rsi and ltf_rsi < 50:
            analysis["ltf_momentum"] = "bajista"
        else:
            analysis["ltf_momentum"] = "neutral"

        # ========== 3. COHERENCE: TRADE vs CONTEXT ==========
        htf_bias = analysis["htf_bias"]
        ema_bias = analysis.get("_ema_bias")
        macd_bias = analysis.get("_macd_bias")

        if htf_bias == "alcista":
            if is_long:
                analysis["coherence"] = "a_favor"
                analysis["coherence_text"] = f"Posicion {side_label} en contexto HTF alcista (precio sobre EMA200, MACD alcista) - trade a favor del contexto"
            else:
                analysis["coherence"] = "contra"
                analysis["coherence_text"] = f"Posicion {side_label} en contexto HTF alcista (precio sobre EMA200, MACD alcista) - trade CONTRA contexto"
        elif htf_bias == "bajista":
            if not is_long:
                analysis["coherence"] = "a_favor"
                analysis["coherence_text"] = f"Posicion {side_label} en contexto HTF bajista (precio bajo EMA200, MACD bajista) - trade a favor del contexto"
            else:
                analysis["coherence"] = "contra"
                analysis["coherence_text"] = f"Posicion {side_label} en contexto HTF bajista (precio bajo EMA200, MACD bajista) - trade CONTRA contexto"
        elif htf_bias == "mixto":
            # Conflicto entre EMA y MACD
            ema_txt = f"precio {'sobre' if ema_bias == 'alcista' else 'bajo'} EMA200" if ema_bias else ""
            macd_txt = f"MACD {macd_bias}" if macd_bias else ""
            conflict_txt = f"{ema_txt}, {macd_txt}".strip(", ")
            analysis["coherence"] = "neutral"
            analysis["coherence_text"] = f"Posicion {side_label} en contexto HTF mixto ({conflict_txt}) - estructura y momentum en conflicto"
        else:
            analysis["coherence"] = "neutral"
            analysis["coherence_text"] = f"Posicion {side_label} en contexto HTF neutral - sin sesgo claro"

        # ========== 4. KEY LEVELS ==========
        key_levels = []
        ltf_fib = ltf.get("fibonacci") or htf_fib
        if ltf_fib and ltf_fib.get("levels"):
            levels = ltf_fib["levels"]
            for name in ["38.2", "50.0", "61.8"]:
                if name in levels:
                    key_levels.append({"name": f"Fib {name}%", "price": levels[name]})

        # EMA200 as key level (approximate from current price and trend)
        if htf_ema is not None and current_price:
            # EMA200 is roughly where price crosses
            ema_approx = current_price * (0.98 if htf_ema else 1.02)
            key_levels.append({"name": "EMA200 (aprox)", "price": round(ema_approx, 2)})

        analysis["key_levels"] = key_levels

        # ========== 5. MANAGEMENT SCENARIOS ==========
        # Get swing levels from Fibonacci for proper invalidation
        swing_high = htf_fib.get("swing_high") if htf_fib else None
        swing_low = htf_fib.get("swing_low") if htf_fib else None

        if is_long:
            # LONG invalidation = price breaks BELOW support (must be below current price)
            # Find the nearest support level below current price
            support_level = None
            if htf_fib and htf_fib.get("levels") and current_price:
                fib_levels = htf_fib["levels"]
                candidates = []
                for name in ["38.2", "50.0", "61.8"]:
                    if name in fib_levels and fib_levels[name] < current_price:
                        candidates.append(fib_levels[name])
                if candidates:
                    support_level = max(candidates)  # Closest support below
            if support_level is None and swing_low:
                support_level = swing_low
            if support_level is None and entry_price:
                support_level = entry_price * 0.97

            invalidation_level = support_level
            analysis["invalidation_level"] = invalidation_level

            # Check if already breached
            already_breached = current_price and invalidation_level and current_price < invalidation_level

            if already_breached:
                analysis["invalidation_breached"] = True
                analysis["thesis_status"] = (
                    f"TESIS INVALIDADA. El precio ({_format_price(current_price)}) "
                    f"ha roto el soporte estructural de {_format_price(invalidation_level)}. "
                    f"Segun las reglas definidas, la idea LONG ya no es defendible."
                )
                analysis["recovery_condition"] = (
                    f"Condicion de recuperacion: cierre en 4H por encima de {_format_price(invalidation_level)}. "
                    f"Hasta que eso ocurra, la tesis permanece invalidada."
                )
            else:
                analysis["invalidation_breached"] = False
                # Describe conditions that sustain/invalidate the thesis
                rsi_state = f"RSI en {htf_rsi:.0f}" if htf_rsi else "RSI"
                macd_state = "alcista" if htf_macd == "bullish" else ("bajista" if htf_macd == "bearish" else "neutral")
                analysis["thesis_status"] = (
                    f"La tesis LONG sigue siendo defendible mientras el precio permanezca sobre "
                    f"{_format_price(support_level)}. "
                    f"Condiciones actuales: {rsi_state}, MACD {macd_state}."
                )
                analysis["invalidation_condition"] = (
                    f"La tesis pierde validez si el precio cierra en 4H por debajo de {_format_price(invalidation_level)}. "
                    f"Ese nivel representa el soporte estructural clave."
                )
        else:
            # SHORT invalidation = price breaks ABOVE resistance (must be above current price)
            # Find the nearest resistance level above current price
            resistance_level = None
            if htf_fib and htf_fib.get("levels") and current_price:
                fib_levels = htf_fib["levels"]
                candidates = []
                for name in ["38.2", "50.0", "61.8"]:
                    if name in fib_levels and fib_levels[name] > current_price:
                        candidates.append(fib_levels[name])
                if candidates:
                    resistance_level = min(candidates)  # Closest resistance above
            if resistance_level is None and swing_high:
                resistance_level = swing_high
            if resistance_level is None and entry_price:
                resistance_level = entry_price * 1.03

            invalidation_level = resistance_level
            analysis["invalidation_level"] = invalidation_level

            # Check if already breached
            already_breached = current_price and invalidation_level and current_price > invalidation_level

            if already_breached:
                analysis["invalidation_breached"] = True
                analysis["thesis_status"] = (
                    f"TESIS INVALIDADA. El precio ({_format_price(current_price)}) "
                    f"ha roto la resistencia estructural de {_format_price(invalidation_level)}. "
                    f"Segun las reglas definidas, la idea SHORT ya no es defendible."
                )
                analysis["recovery_condition"] = (
                    f"Condicion de recuperacion: cierre en 4H por debajo de {_format_price(invalidation_level)}. "
                    f"Hasta que eso ocurra, la tesis permanece invalidada."
                )
            else:
                analysis["invalidation_breached"] = False
                # Describe conditions that sustain/invalidate the thesis
                rsi_state = f"RSI en {htf_rsi:.0f}" if htf_rsi else "RSI"
                macd_state = "alcista" if htf_macd == "bullish" else ("bajista" if htf_macd == "bearish" else "neutral")
                analysis["thesis_status"] = (
                    f"La tesis SHORT sigue siendo defendible mientras el precio permanezca bajo "
                    f"{_format_price(resistance_level)}. "
                    f"Condiciones actuales: {rsi_state}, MACD {macd_state}."
                )
                analysis["invalidation_condition"] = (
                    f"La tesis pierde validez si el precio cierra en 4H por encima de {_format_price(invalidation_level)}. "
                    f"Ese nivel representa la resistencia estructural clave."
                )

        # ========== 6. FACTUAL OBSERVATIONS (no recommendations) ==========
        obs = []
        ema_bias = analysis.get("_ema_bias")
        macd_bias = analysis.get("_macd_bias")

        # Note conflict first if exists
        if ema_bias and macd_bias and ema_bias != macd_bias:
            obs.append(f"CONFLICTO: Estructura ({ema_bias}) vs Momentum ({macd_bias}) en 4H")

        # Price zone relative to EMA
        if htf_ema is not None:
            zone = "sobre" if htf_ema else "bajo"
            structural = "estructura alcista" if htf_ema else "estructura bajista"
            obs.append(f"Precio {zone} EMA200 en 4H ({structural})")

        # MACD state
        if htf_macd:
            macd_es = "alcista" if htf_macd == "bullish" else "bajista"
            obs.append(f"MACD 4H {macd_es} (momentum {macd_es})")

        # RSI state
        if htf_rsi is not None:
            if htf_rsi > 70:
                obs.append(f"RSI 4H en {htf_rsi:.0f} (zona de sobrecompra)")
            elif htf_rsi < 30:
                obs.append(f"RSI 4H en {htf_rsi:.0f} (zona de sobreventa)")
            elif htf_rsi > 55:
                obs.append(f"RSI 4H en {htf_rsi:.0f} (momentum alcista)")
            elif htf_rsi < 45:
                obs.append(f"RSI 4H en {htf_rsi:.0f} (momentum bajista)")
            else:
                obs.append(f"RSI 4H en {htf_rsi:.0f} (zona neutral)")

        # Divergence
        if htf.get("divergence"):
            div = htf["divergence"]
            obs.append(f"Divergencia {div} detectada en 4H")

        # Volume
        if htf.get("volume_above_average"):
            obs.append("Volumen sobre el promedio en 4H")

        # Fibonacci position
        if htf_fib and htf_fib.get("closest_level_name"):
            closest = htf_fib["closest_level_name"]
            dist = htf_fib.get("distance_percent", 0)
            if abs(dist) < 1:
                obs.append(f"Precio en nivel Fibonacci {closest}%")
            else:
                direction = "sobre" if dist > 0 else "bajo"
                obs.append(f"Precio {abs(dist):.1f}% {direction} Fib {closest}%")

        # ATR for volatility context
        if htf_atr and current_price:
            atr_pct = (htf_atr / current_price) * 100
            if atr_pct > 3:
                obs.append(f"Alta volatilidad (ATR {atr_pct:.1f}% del precio)")
            elif atr_pct < 1:
                obs.append(f"Baja volatilidad (ATR {atr_pct:.1f}% del precio)")

        analysis["observations"] = obs

    except Exception as e:
        logger.error(f"Error computing position analysis for {symbol}: {e}")
        analysis["observations"] = ["Error al calcular analisis"]

    return timeframes_data, analysis


@app.get("/api/positions")
async def get_positions(user: UserAccount = Depends(get_current_user)):
    db = get_db()
    try:
        positions = DBHelper.get_open_positions(db, user.id)
        result = []
        for p in positions:
            try:
                timeframes_data, analysis = _compute_position_analysis(
                    p.symbol, p.side, p.entry_price, p.current_price
                )
            except Exception as e:
                logger.error(f"Error computing analysis for {p.symbol}: {e}")
                timeframes_data = {}
                analysis = {
                    "htf_bias": "neutral",
                    "htf_structure": "error",
                    "ltf_momentum": "neutral",
                    "coherence": "neutral",
                    "coherence_text": "Error al calcular analisis",
                    "favorable_scenario": "",
                    "invalidation_scenario": "",
                    "invalidation_level": None,
                    "key_levels": [],
                    "observations": ["Error al calcular analisis"],
                }
            try:
                liq_price = p.liquidation_price
            except Exception:
                liq_price = None
            notional = round((p.amount or 0) * (p.entry_price or 0), 2)
            margin = round(notional / p.leverage, 2) if p.leverage and p.leverage > 0 else notional
            result.append({
                "id": p.id,
                "symbol": p.symbol,
                "side": p.side,
                "entry_price": p.entry_price,
                "amount": p.amount,
                "leverage": p.leverage,
                "notional": notional,
                "initial_margin": margin,
                "unrealized_pnl": p.unrealized_pnl,
                "current_price": p.current_price,
                "initial_stop_loss": p.initial_stop_loss,
                "current_stop_loss": p.current_stop_loss,
                "initial_take_profit": p.initial_take_profit,
                "current_take_profit": p.current_take_profit,
                "highest_price": p.highest_price,
                "lowest_price": p.lowest_price,
                "breakeven_reached": p.breakeven_reached,
                "entry_atr": p.entry_atr,
                "liquidation_price": liq_price,
                "opened_at": p.opened_at.isoformat() if p.opened_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                "timeframes": timeframes_data,
                "analysis": analysis,
            })
        return {
            "positions": result,
            "total": len(result),
            "mode": user.mode.value,
            "has_binance_keys": user.has_binance_keys(),
        }
    finally:
        db.close()


@app.get("/api/positions/{symbol}/alerts")
async def get_position_alerts(symbol: str, user: UserAccount = Depends(get_current_user)):
    db = get_db()
    try:
        # Find position for this symbol
        pos = db.query(ActivePosition).filter(
            ActivePosition.user_id == user.id,
            ActivePosition.symbol == symbol,
            ActivePosition.is_open == True
        ).first()
        if not pos:
            return {"alerts": [], "total": 0}

        alerts = DBHelper.get_position_alerts(db, pos.id)
        return {
            "alerts": [
                {
                    "id": a.id,
                    "alert_type": a.alert_type.value if a.alert_type else None,
                    "message": a.message,
                    "recommended_action": a.recommended_action.value if a.recommended_action else None,
                    "new_sl_price": a.new_sl_price,
                    "was_executed": a.was_executed,
                    "is_read": a.is_read,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in alerts
            ],
            "total": len(alerts),
        }
    finally:
        db.close()


@app.get("/api/exit-alerts")
async def get_exit_alerts(limit: int = 50, user: UserAccount = Depends(get_current_user)):
    db = get_db()
    try:
        alerts = DBHelper.get_recent_exit_alerts(db, user.id, limit)
        return {
            "alerts": [
                {
                    "id": a.id,
                    "symbol": a.symbol,
                    "alert_type": a.alert_type.value if a.alert_type else None,
                    "message": a.message,
                    "recommended_action": a.recommended_action.value if a.recommended_action else None,
                    "new_sl_price": a.new_sl_price,
                    "was_executed": a.was_executed,
                    "is_read": a.is_read,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in alerts
            ],
            "total": len(alerts),
        }
    finally:
        db.close()


# ============================================================
# Existing Endpoints (unchanged, kept for backward compatibility)
# ============================================================

@app.get("/")
async def root():
    return {
        "status": "ok",
        "monitoring": monitoring_active,
        "database": notification_manager.use_db,
        "active_pairs": list(active_pairs),
        "active_timeframes": list(active_timeframes),
    }


@app.get("/api/config")
async def get_config():
    return {
        "available_pairs": AVAILABLE_PAIRS,
        "available_timeframes": list(AVAILABLE_TIMEFRAMES.keys()),
        "available_trading_modes": TRADING_MODES,
        "default_pairs": DEFAULT_PAIRS,
        "default_timeframe": DEFAULT_TIMEFRAME,
        "default_trading_mode": "balanced",
    }


@app.get("/api/market")
async def get_market_data(timeframe: str = DEFAULT_TIMEFRAME, refresh: bool = False):
    global active_pairs
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    if refresh:
        active_pairs = get_all_monitored_pairs()
        client = get_binance_client()
        if timeframe not in market_data:
            market_data[timeframe] = {}
        for pair in active_pairs:
            try:
                df = client.fetch_ohlcv(pair, timeframe)
                if df is None or len(df) < 200:
                    continue
                df = add_all_indicators(df)
                indicators = get_latest_indicators(df)
                funding_data = client.get_funding_rate(pair)
                if indicators:
                    # Compute 3-layer market analysis
                    analysis = _compute_market_analysis(pair, indicators, funding_data)
                    market_data[timeframe][pair] = {
                        "pair": pair, "timeframe": timeframe,
                        "price": indicators["price"], "indicators": indicators,
                        "funding": funding_data,
                        "analysis": analysis,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
            except Exception as e:
                print(f"Error refreshing {pair}: {e}")

    data = market_data.get(timeframe, {})
    return {
        "timeframe": timeframe, "pairs": data,
        "active_pairs": list(active_pairs),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/market/{pair}")
async def get_pair_data(pair: str, timeframe: str = DEFAULT_TIMEFRAME):
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")
    pair_formatted = pair.replace("-", "/").upper()
    if timeframe in market_data and pair_formatted in market_data[timeframe]:
        return market_data[timeframe][pair_formatted]
    client = get_binance_client()
    df = client.fetch_ohlcv(pair_formatted, timeframe)
    if df is None:
        raise HTTPException(status_code=404, detail=f"Pair {pair_formatted} not found")
    df = add_all_indicators(df)
    indicators = get_latest_indicators(df)
    return {
        "pair": pair_formatted, "timeframe": timeframe,
        "price": indicators["price"] if indicators else None,
        "indicators": indicators,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/signals")
async def get_signals(
    limit: int = 20, timeframe: Optional[str] = None,
    pair: Optional[str] = None, min_score: Optional[float] = None,
    token: Optional[str] = None,
):
    signals = signal_history.get_recent_signals(limit * 5)
    user_pairs = set()
    user_timeframes = set()
    signals_cleared_at = None
    if token and notification_manager.use_db:
        try:
            db = get_db()
            user = DBHelper.get_user_by_token(db, token)
            if user:
                signals_cleared_at = user.signals_cleared_at
                subs = db.query(Subscription).filter(
                    Subscription.user_id == user.id, Subscription.enabled == True
                ).all()
                for sub in subs:
                    user_pairs.add(sub.pair)
                    user_timeframes.add(sub.timeframe)
            db.close()
        except Exception as e:
            print(f"Error getting user subscriptions for signals: {e}")

    if user_pairs:
        signals = [s for s in signals if s.get("pair") in user_pairs]
    if user_timeframes:
        signals = [s for s in signals if s.get("timeframe") in user_timeframes]
    if timeframe:
        signals = [s for s in signals if s.get("timeframe") == timeframe]
    if pair:
        signals = [s for s in signals if s.get("pair") == pair]
    if min_score is not None:
        signals = [s for s in signals if s.get("score", 0) >= min_score]
    if signals_cleared_at:
        from dateutil.parser import parse as parse_date
        signals = [s for s in signals if parse_date(s.get("timestamp", "1970-01-01")) > signals_cleared_at]

    signals = signals[:limit]
    return {
        "signals": signals, "total": len(signals),
        "filters": {"timeframe": timeframe, "pair": pair, "min_score": min_score, "user_filtered": bool(user_pairs)},
    }


@app.post("/api/register")
async def register_token(data: TokenRegistration):
    pairs = data.pairs or DEFAULT_PAIRS
    timeframe = data.timeframe or DEFAULT_TIMEFRAME
    trading_mode = data.trading_mode or "balanced"
    invalid_pairs = [p for p in pairs if p not in AVAILABLE_PAIRS]
    if invalid_pairs:
        raise HTTPException(status_code=400, detail=f"Invalid pairs: {invalid_pairs}")
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")
    if trading_mode not in TRADING_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid trading mode: {trading_mode}")
    success = notification_manager.register_token(data.token, pairs, timeframe, trading_mode)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid push token")
    return {"status": "registered", "pairs": pairs, "timeframe": timeframe, "trading_mode": trading_mode}


@app.post("/api/unregister")
async def unregister_token(data: TokenRegistration):
    success = notification_manager.unregister_token(data.token)
    return {"status": "unregistered" if success else "not_found"}


@app.post("/api/preferences")
async def update_preferences(data: PreferencesUpdate):
    if data.pairs:
        invalid_pairs = [p for p in data.pairs if p not in AVAILABLE_PAIRS]
        if invalid_pairs:
            raise HTTPException(status_code=400, detail=f"Invalid pairs: {invalid_pairs}")
    if data.timeframe and data.timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {data.timeframe}")
    if data.trading_mode and data.trading_mode not in TRADING_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid trading mode: {data.trading_mode}")
    success = notification_manager.update_preferences(data.token, data.pairs, data.timeframe, data.trading_mode)
    if not success:
        raise HTTPException(status_code=404, detail="Token not found. Register first.")
    settings = notification_manager.get_user_settings(data.token)
    return {
        "status": "updated",
        "pairs": settings.get("pairs") if settings else None,
        "timeframe": settings.get("timeframe") if settings else None,
        "trading_mode": settings.get("trading_mode") if settings else None,
    }


@app.post("/api/settings")
async def get_user_settings(data: UserSettings):
    settings = notification_manager.get_user_settings(data.token)
    if not settings:
        raise HTTPException(status_code=404, detail="Token not found")
    return {
        "pairs": settings.get("pairs", DEFAULT_PAIRS),
        "timeframe": settings.get("timeframe", DEFAULT_TIMEFRAME),
        "trading_mode": settings.get("trading_mode", "balanced"),
        "enabled": settings.get("enabled", True),
    }


@app.post("/api/test-notification")
async def test_notification(data: TestNotification):
    result = send_test_notification(data.token)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.get("/api/available-pairs")
async def get_available_pairs():
    return {"pairs": AVAILABLE_PAIRS, "configurable": True}


@app.get("/api/available-timeframes")
async def get_available_timeframes():
    return {"timeframes": list(AVAILABLE_TIMEFRAMES.keys()), "default": DEFAULT_TIMEFRAME}


@app.get("/api/trading-modes")
async def get_trading_modes():
    return {
        "modes": [
            {"id": "conservative", "name": "Conservador", "description": "Solo senales optimas (score >= 2.5)", "min_score": 2.5},
            {"id": "balanced", "name": "Balanceado", "description": "Senales buenas y optimas (score >= 1.5)", "min_score": 1.5},
            {"id": "aggressive", "name": "Agresivo", "description": "Todas las senales (incluyendo tempranas)", "min_score": 0},
        ],
        "default": "balanced",
    }


@app.get("/api/subscribers")
async def get_subscribers():
    subscribers = notification_manager.get_all_subscribers()
    return {"total": len(subscribers), "subscribers": subscribers}


@app.post("/api/subscriptions/add")
async def add_subscription(data: SubscriptionAdd):
    if data.pair not in AVAILABLE_PAIRS:
        raise HTTPException(status_code=400, detail=f"Invalid pair: {data.pair}")
    if data.timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {data.timeframe}")
    if data.trading_mode not in TRADING_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid trading mode: {data.trading_mode}")
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found. Register first.")
        mode = TradingMode(data.trading_mode)
        sub = DBHelper.add_subscription(db, user.id, data.pair, data.timeframe, mode)
        db.close()
        return {
            "status": "added",
            "subscription": {"id": sub.id, "pair": sub.pair, "timeframe": sub.timeframe, "trading_mode": sub.trading_mode.value},
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subscriptions/remove")
async def remove_subscription(data: SubscriptionRemove):
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found")
        success = DBHelper.remove_subscription(db, data.subscription_id, user.id)
        db.close()
        if not success:
            raise HTTPException(status_code=404, detail="Subscription not found")
        return {"status": "removed", "subscription_id": data.subscription_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subscriptions/list")
async def list_subscriptions(data: SubscriptionList):
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found. Register first.")
        subs = DBHelper.get_user_subscriptions(db, user.id)
        db.close()
        return {
            "subscriptions": [
                {"id": sub.id, "pair": sub.pair, "timeframe": sub.timeframe, "trading_mode": sub.trading_mode.value}
                for sub in subs
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notifications/history")
async def get_notification_history(data: NotificationHistoryReq):
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found")
        subs = DBHelper.get_user_subscriptions(db, user.id)
        if not subs:
            db.close()
            return {"notifications": [], "total": 0}
        from sqlalchemy import or_, and_
        from database import Signal as SignalDB
        conditions = []
        for sub in subs:
            conditions.append(and_(SignalDB.pair == sub.pair, SignalDB.timeframe == sub.timeframe))
        query = db.query(SignalDB).filter(or_(*conditions))
        if user.notifications_cleared_at:
            query = query.filter(SignalDB.created_at > user.notifications_cleared_at)
        signals = query.order_by(SignalDB.created_at.desc()).limit(data.limit).all()
        db.close()

        notifications = []
        for sig in signals:
            quality_emoji = "OK" if sig.quality.value == "OPTIMA" else "" if sig.quality.value == "BUENA" else ""
            pair_short = sig.pair.replace("/USDT", "")
            title = f"{quality_emoji} {pair_short} {sig.side} ({sig.timeframe})"
            tp_percent = abs((sig.take_profit - sig.entry_price) / sig.entry_price * 100)
            sl_percent = abs((sig.stop_loss - sig.entry_price) / sig.entry_price * 100)
            body = f"Entrada: ${sig.entry_price:,.2f}\nTP: +{tp_percent:.1f}% | SL: -{sl_percent:.1f}%"
            notifications.append({
                "id": sig.id, "title": title, "body": body,
                "pair": sig.pair, "timeframe": sig.timeframe, "side": sig.side,
                "quality": sig.quality.value, "score": sig.score,
                "entry_price": sig.entry_price, "take_profit": sig.take_profit,
                "stop_loss": sig.stop_loss, "receivedAt": sig.created_at.isoformat(),
            })
        return {"notifications": notifications, "total": len(notifications)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting notification history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/signals/clear")
async def clear_signals(data: ClearRequest):
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found")
        user.signals_cleared_at = datetime.now(timezone.utc)
        db.commit()
        db.close()
        return {"status": "cleared", "cleared_at": user.signals_cleared_at.isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notifications/clear")
async def clear_notifications(data: ClearRequest):
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found")
        user.notifications_cleared_at = datetime.now(timezone.utc)
        db.commit()
        db.close()
        return {"status": "cleared", "cleared_at": user.notifications_cleared_at.isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

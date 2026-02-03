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

from fastapi import FastAPI, HTTPException, Depends, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os

from config import (
    DEFAULT_PAIRS,
    AVAILABLE_PAIRS,
    AVAILABLE_TIMEFRAMES,
    DEFAULT_TIMEFRAME,
    POLL_INTERVAL,
    POSITION_POLL_INTERVAL,
    REVENUECAT_WEBHOOK_SECRET,
)
from binance_client import get_binance_client, create_user_client
from indicators import add_all_indicators, get_latest_indicators
from signals import detect_signal, SignalHistory, evaluate_exit_signals
from notifications import NotificationManager, send_test_notification, send_exit_notification
from database import (
    init_db, get_db, DBHelper, TradingMode, Subscription,
    UserAccount, OperationMode, ExitAlertType, RecommendedAction,
    ActivePosition, ExitAlert, NotificationType, UserNotification,
)
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, get_optional_user,
)
from alerts import (
    check_market_context_changes,
    check_unified_pair_changes,
    check_position_state_changes,
    check_meta_alerts,
    clear_position_state,
    send_signal_notification,
)
from ai_explainer import get_ai_explanation, should_call_ai, check_state_changed, get_cache_stats, get_position_ai_analysis
from email_service import generate_verification_code, send_verification_email
import requests as http_requests  # For IP geolocation


def get_country_from_ip(ip: str) -> Optional[str]:
    """Get country code from IP address using ip-api.com (free, no key needed)."""
    if not ip or ip in ("127.0.0.1", "localhost", "::1"):
        return None
    try:
        response = http_requests.get(f"http://ip-api.com/json/{ip}?fields=countryCode", timeout=2)
        if response.status_code == 200:
            data = response.json()
            return data.get("countryCode")
    except Exception as e:
        logger.warning(f"Could not get country from IP {ip}: {e}")
    return None


def get_client_ip(request: Request) -> str:
    """Get client IP from request, handling proxies."""
    # Check X-Forwarded-For header (common for proxies/load balancers)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Take the first IP in the chain (original client)
        return forwarded.split(",")[0].strip()
    # Check X-Real-IP header (nginx)
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    # Fall back to direct client IP
    return request.client.host if request.client else None


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
    pair: str
    # timeframe and trading_mode kept for compatibility but not used
    timeframe: Optional[str] = "4h"
    trading_mode: Optional[str] = "balanced"

class SubscriptionRemove(BaseModel):
    subscription_id: int

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
    # Only monitor 4h (context) and 15m (timing) for unified analysis
    default_monitored = {"15m", "4h"}
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

                    analysis = _compute_market_analysis(pair, indicators, funding_data)

                    market_data[timeframe][pair] = {
                        "pair": pair,
                        "timeframe": timeframe,
                        "price": indicators["price"],
                        "indicators": indicators,
                        "funding": funding_data,
                        "analysis": analysis,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }

                except Exception as e:
                    print(f"Error monitoring {pair} ({timeframe}): {e}")

        # After processing all timeframes, check unified pair alerts (4H context + 15m timing)
        for pair in active_pairs:
            try:
                htf_data = market_data.get("4h", {}).get(pair, {})
                ltf_data = market_data.get("15m", {}).get(pair, {})

                htf_indicators = htf_data.get("indicators")
                ltf_indicators = ltf_data.get("indicators")
                funding_data = htf_data.get("funding") or ltf_data.get("funding")

                if htf_indicators or ltf_indicators:
                    unified_analysis = _compute_unified_pair_analysis(
                        pair, htf_indicators, ltf_indicators, funding_data
                    )

                    # Check for unified pair alerts
                    alert_db, subscribed_tokens = _get_subscribed_tokens_with_db(pair, "4h")
                    if subscribed_tokens:
                        alerts = check_unified_pair_changes(
                            pair, unified_analysis, subscribed_tokens, db=alert_db
                        )
                        if alerts:
                            logger.info(f"[ALERTS] Unified alerts for {pair}: {len(alerts)}")
                    if alert_db:
                        alert_db.close()
            except Exception as e:
                logger.error(f"[ALERTS] Error checking unified alerts for {pair}: {e}")

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

                        # Check for position state changes (passive alerts)
                        if account.get("push_token") and account.get("push_enabled", True):
                            try:
                                normalized_pair = _normalize_symbol(bp["symbol"])
                                _, position_analysis = _compute_position_analysis(
                                    normalized_pair, bp["side"],
                                    bp["entry_price"], bp["current_price"]
                                )
                                if position_analysis:
                                    position_alerts = check_position_state_changes(
                                        account_id, normalized_pair, bp["side"],
                                        position_analysis, account["push_token"],
                                        db=db
                                    )
                                    if position_alerts:
                                        logger.info(f"[ALERTS] Position alerts for {account_id}/{normalized_pair}: {len(position_alerts)}")
                            except Exception as e:
                                logger.error(f"[ALERTS] Error checking position alerts: {e}")

                        # Track positions for meta alerts
                        if "positions_for_meta" not in account:
                            account["positions_for_meta"] = []
                        try:
                            normalized_pair = _normalize_symbol(bp["symbol"])
                            _, pos_analysis = _compute_position_analysis(
                                normalized_pair, bp["side"],
                                bp["entry_price"], bp["current_price"]
                            )
                            account["positions_for_meta"].append({
                                "symbol": normalized_pair,
                                "side": bp["side"],
                                "analysis": pos_analysis
                            })
                        except:
                            pass

                    # Check meta alerts after processing all positions for this account
                    if (account.get("push_token") and account.get("push_enabled", True)
                            and account.get("positions_for_meta")):
                        try:
                            meta_alerts = check_meta_alerts(
                                account_id,
                                account["positions_for_meta"],
                                account["push_token"],
                                db=db
                            )
                            if meta_alerts:
                                logger.info(f"[ALERTS] Meta alerts for account {account_id}: {len(meta_alerts)}")
                        except Exception as e:
                            logger.error(f"[ALERTS] Error checking meta alerts: {e}")

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

    # Enable monitoring flag before starting threads to avoid race condition
    global monitoring_active
    monitoring_active = True

    # Start background monitoring
    monitor_thread = threading.Thread(target=monitor_markets, daemon=True)
    monitor_thread.start()
    logger.info("Signal monitoring started")

    # Start position monitoring
    position_thread = threading.Thread(target=monitor_positions, daemon=True)
    position_thread.start()
    logger.info("Position monitoring started")

    yield
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
async def auth_register(data: AuthRegister, request: Request):
    if not data.email or not data.password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Detect country from IP
    client_ip = get_client_ip(request)
    country = get_country_from_ip(client_ip) if client_ip else None

    # Generate 6-digit verification code
    verification_code = generate_verification_code()

    db = get_db()
    try:
        existing = DBHelper.get_account_by_email(db, data.email.lower())
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        pw_hash = hash_password(data.password)
        account = DBHelper.create_account(
            db, data.email.lower(), pw_hash,
            country=country,
            verification_token=verification_code  # Now stores 6-digit code
        )

        # Send verification email with code
        send_verification_email(account.email, verification_code)

        access_token = create_access_token(account.id, account.email)
        refresh_token = create_refresh_token(account.id)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": account.id,
                "email": account.email,
                "mode": account.mode.value,
                "email_verified": account.email_verified,
            },
            "message": "Verification email sent. Please check your inbox.",
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
                "email_verified": account.email_verified or False,
            },
        }
    finally:
        db.close()


class VerifyEmailRequest(BaseModel):
    code: str


@app.post("/api/auth/verify-email")
async def verify_email(data: VerifyEmailRequest, user: UserAccount = Depends(get_current_user)):
    """Verify user's email address using the 6-digit code."""
    if not data.code or len(data.code) != 6:
        raise HTTPException(status_code=400, detail="Invalid code format")

    if user.email_verified:
        return {"status": "ok", "message": "Email already verified"}

    db = get_db()
    try:
        account = db.query(UserAccount).filter(UserAccount.id == user.id).first()

        if not account.verification_token or account.verification_token != data.code:
            raise HTTPException(status_code=400, detail="Invalid verification code")

        # Mark as verified
        account.email_verified = True
        account.verification_token = None  # Clear code after use
        db.commit()

        return {"status": "ok", "message": "Email verified successfully!"}
    finally:
        db.close()


@app.post("/api/auth/resend-verification")
async def resend_verification(user: UserAccount = Depends(get_current_user)):
    """Resend verification email to the current user."""
    if user.email_verified:
        return {"status": "ok", "message": "Email already verified"}

    # Generate new 6-digit code
    new_code = generate_verification_code()

    db = get_db()
    try:
        account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
        account.verification_token = new_code
        db.commit()

        # Send email with code
        sent = send_verification_email(account.email, new_code)
        if sent:
            return {"status": "ok", "message": "Verification email sent"}
        else:
            raise HTTPException(status_code=500, detail="Failed to send email")
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
        # Subscription fields
        "subscription_status": user.subscription_status or "free",
        "is_premium": user.is_premium(),
    }


@app.get("/api/account/subscription")
async def get_subscription(user: UserAccount = Depends(get_current_user)):
    """Get user's subscription status and limits."""
    # Ensure AI usage is reset if needed
    user._reset_ai_usage_if_needed()

    return {
        "status": user.subscription_status or "free",  # free | active | expired
        "is_premium": user.is_premium(),
        "expires_at": user.subscription_expires_at.isoformat() if user.subscription_expires_at else None,
        "ai_usage": user.ai_usage_count or 0,
        "ai_limit": user.get_ai_limit(),
        "ai_remaining": max(0, user.get_ai_limit() - (user.ai_usage_count or 0)),
    }


class SyncSubscriptionRequest(BaseModel):
    is_premium: bool
    expires_at: Optional[str] = None
    store: Optional[str] = None  # ios | android


@app.post("/api/account/sync-subscription")
async def sync_subscription(data: SyncSubscriptionRequest, user: UserAccount = Depends(get_current_user)):
    """Sync subscription status from app store purchase."""
    db = get_db()
    try:
        account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")

        if data.is_premium:
            account.subscription_status = "active"
            if data.expires_at:
                try:
                    account.subscription_expires_at = datetime.fromisoformat(data.expires_at.replace("Z", "+00:00"))
                except ValueError:
                    pass
        else:
            account.subscription_status = "free"
            account.subscription_expires_at = None

        db.commit()
        logger.info(f"[SUBSCRIPTION] Synced user {user.id}: is_premium={data.is_premium}, store={data.store}")

        return {
            "status": "ok",
            "subscription_status": account.subscription_status,
            "is_premium": account.is_premium(),
        }
    finally:
        db.close()


@app.post("/api/webhooks/revenuecat")
async def revenuecat_webhook(request: Request, authorization: str = Header(None)):
    """
    Webhook endpoint for RevenueCat subscription events.
    Configure this URL in RevenueCat dashboard: https://app.revenuecat.com/
    Set the Authorization header to match REVENUECAT_WEBHOOK_SECRET
    """
    # Verify authorization
    if REVENUECAT_WEBHOOK_SECRET:
        expected = f"Bearer {REVENUECAT_WEBHOOK_SECRET}"
        if authorization != expected:
            logger.warning("[REVENUECAT] Invalid webhook authorization")
            raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = payload.get("event", {}).get("type")
    app_user_id = payload.get("event", {}).get("app_user_id")

    if not app_user_id:
        logger.warning("[REVENUECAT] Webhook missing app_user_id")
        return {"status": "ok"}

    logger.info(f"[REVENUECAT] Webhook received: type={event_type}, user={app_user_id}")

    db = get_db()
    try:
        # app_user_id is the user ID we passed to RevenueCat (user.id as string)
        try:
            user_id = int(app_user_id)
        except ValueError:
            logger.warning(f"[REVENUECAT] Invalid app_user_id: {app_user_id}")
            return {"status": "ok"}

        account = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not account:
            logger.warning(f"[REVENUECAT] User not found: {user_id}")
            return {"status": "ok"}

        # Events that grant premium access
        premium_events = [
            "INITIAL_PURCHASE",
            "RENEWAL",
            "PRODUCT_CHANGE",
            "UNCANCELLATION",
        ]

        # Events that revoke premium access
        revoke_events = [
            "EXPIRATION",
            "BILLING_ISSUE",
            "SUBSCRIPTION_PAUSED",
        ]

        # Cancellation is just intent - user keeps access until expiration
        # So we don't revoke immediately on CANCELLATION

        if event_type in premium_events:
            account.subscription_status = "active"
            # Get expiration from the event
            expiration = payload.get("event", {}).get("expiration_at_ms")
            if expiration:
                account.subscription_expires_at = datetime.fromtimestamp(
                    expiration / 1000, tz=timezone.utc
                )
            logger.info(f"[REVENUECAT] User {user_id} subscription activated")

        elif event_type in revoke_events:
            account.subscription_status = "expired"
            logger.info(f"[REVENUECAT] User {user_id} subscription expired/revoked")

        elif event_type == "CANCELLATION":
            # Keep status as active but log the cancellation
            logger.info(f"[REVENUECAT] User {user_id} cancelled (still active until expiry)")

        db.commit()
        return {"status": "ok"}

    except Exception as e:
        logger.error(f"[REVENUECAT] Webhook error: {e}")
        return {"status": "error"}
    finally:
        db.close()


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
# Alert Helpers
# ============================================================

def _get_subscribed_tokens_with_db(pair: str, timeframe: str = None):
    """Get push tokens and account IDs for all users subscribed to a pair.

    Returns: (db_session, list of (push_token, account_id) tuples)

    Note: timeframe is kept for compatibility but not used (unified 4H+15m system).
    """
    if not notification_manager.use_db:
        return None, []
    try:
        db = get_db()
        from database import UserAccount
        # Get subscriptions by pair (timeframe no longer used)
        subs = db.query(Subscription).filter(
            Subscription.pair == pair,
            Subscription.enabled == True
        ).all()
        # Deduplicate by account_id to avoid sending multiple notifications
        seen_accounts = set()
        tokens = []
        for sub in subs:
            if sub.account_id in seen_accounts:
                continue
            seen_accounts.add(sub.account_id)
            # Get push_token directly from UserAccount
            account = db.query(UserAccount).filter(
                UserAccount.id == sub.account_id,
                UserAccount.enabled == True
            ).first()
            if account and account.push_token and account.push_token.startswith("ExponentPushToken"):
                tokens.append((account.push_token, account.id))
        return db, tokens
    except Exception as e:
        logger.error(f"[ALERTS] Error getting subscribed tokens: {e}")
        return None, []


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


def _compute_unified_pair_analysis(pair: str, htf_indicators: dict, ltf_indicators: dict, funding: dict = None) -> dict:
    """
    Compute unified pair analysis combining 4H (context) and 15m (timing).

    4H = CONTEXTO: Define si hay que mirar el par (sesgo, estructura, volatilidad)
    15m = TIMING: Define cuándo hay confirmación (momentum, crossovers)

    Returns unified analysis with:
    - context: 4H analysis (htf_bias, structure, volatility)
    - timing: 15m analysis (momentum state, confirmation signals)
    - unified_reading: Combined interpretation
    - direction_preference: Only if 4H allows and 15m confirms
    """
    analysis = {
        # Context Layer (4H)
        "context": {
            "htf_bias": "neutral",  # alcista / bajista / mixto / neutral
            "htf_structure": "sin_datos",  # tendencia / retroceso / consolidacion / extension
            "volatility_state": "normal",  # alta / normal / baja
            "ema_position": None,  # sobre / bajo
            "macd_momentum": None,  # alcista / bajista
        },

        # Timing Layer (15m)
        "timing": {
            "ltf_momentum": "neutral",  # alcista / bajista / neutral
            "rsi_zone": None,  # sobrecompra / sobrevendido / alcista / bajista / neutral
            "macd_state": None,  # alcista / bajista / cruce_alcista / cruce_bajista
            "volume_state": None,  # alto / normal / bajo
            "has_confirmation": False,  # True if LTF confirms HTF direction
        },

        # Unified Reading
        "scenario": "espera",  # favorable / operable / alto_riesgo / espera
        "scenario_reason": "",
        "unified_reading": "",  # Main interpretation combining both TFs
        "direction_preference": None,  # long / short / None

        # Supporting data
        "observations": [],
        "key_levels": [],
        "funding": None,
    }

    if not htf_indicators and not ltf_indicators:
        analysis["scenario_reason"] = "Sin datos disponibles"
        analysis["unified_reading"] = "Esperando datos de mercado..."
        return analysis

    # ========== CONTEXT LAYER (4H) ==========
    if htf_indicators:
        htf_price = htf_indicators.get("price")
        htf_rsi = htf_indicators.get("rsi")
        htf_macd_hist = htf_indicators.get("macd_histogram")
        htf_macd_bullish = htf_indicators.get("macd_crossover_bullish")
        htf_macd_bearish = htf_indicators.get("macd_crossover_bearish")
        htf_price_above_ema = htf_indicators.get("price_above_ema")
        htf_atr = htf_indicators.get("atr")
        htf_fib = htf_indicators.get("fibonacci")
        htf_divergence = htf_indicators.get("divergence")

        # EMA200 position (structure)
        ema_bias = None
        if htf_price_above_ema is True:
            ema_bias = "alcista"
            analysis["context"]["ema_position"] = "sobre"
        elif htf_price_above_ema is False:
            ema_bias = "bajista"
            analysis["context"]["ema_position"] = "bajo"

        # MACD momentum
        macd_bias = None
        if htf_macd_hist is not None:
            if htf_macd_hist > 0:
                macd_bias = "alcista"
                analysis["context"]["macd_momentum"] = "alcista"
            else:
                macd_bias = "bajista"
                analysis["context"]["macd_momentum"] = "bajista"

        # HTF bias requires EMA + MACD agreement
        if ema_bias and macd_bias:
            if ema_bias == macd_bias:
                analysis["context"]["htf_bias"] = ema_bias
            else:
                analysis["context"]["htf_bias"] = "mixto"
        elif ema_bias:
            analysis["context"]["htf_bias"] = ema_bias
        elif macd_bias:
            analysis["context"]["htf_bias"] = macd_bias

        # Structure from Fibonacci
        if htf_fib:
            is_uptrend = htf_fib.get("is_uptrend", False)
            dist = htf_fib.get("distance_percent", 0)
            at_level = htf_fib.get("at_key_level", False)
            near_level = htf_fib.get("near_key_level", False)

            if at_level or near_level:
                analysis["context"]["htf_structure"] = "en nivel clave"
            elif abs(dist) < 3:
                analysis["context"]["htf_structure"] = "consolidacion"
            elif (is_uptrend and dist > 0) or (not is_uptrend and dist < 0):
                analysis["context"]["htf_structure"] = "extension"
            else:
                analysis["context"]["htf_structure"] = "retroceso"

            # Key levels
            if htf_fib.get("levels"):
                levels = htf_fib["levels"]
                for name in ["38.2", "50.0", "61.8"]:
                    if name in levels:
                        analysis["key_levels"].append({
                            "name": f"Fibo {name}%",
                            "price": levels[name]
                        })

        # Volatility
        if htf_atr and htf_price:
            atr_pct = (htf_atr / htf_price) * 100
            if atr_pct > 3:
                analysis["context"]["volatility_state"] = "alta"
            elif atr_pct < 1:
                analysis["context"]["volatility_state"] = "baja"

    # ========== TIMING LAYER (15m) ==========
    if ltf_indicators:
        ltf_rsi = ltf_indicators.get("rsi")
        ltf_macd_hist = ltf_indicators.get("macd_histogram")
        ltf_macd_bullish = ltf_indicators.get("macd_crossover_bullish")
        ltf_macd_bearish = ltf_indicators.get("macd_crossover_bearish")
        ltf_volume_above = ltf_indicators.get("volume_above_average")
        ltf_volume_ratio = ltf_indicators.get("volume_ratio", 1)

        # RSI zone
        if ltf_rsi is not None:
            if ltf_rsi > 70:
                analysis["timing"]["rsi_zone"] = "sobrecompra"
            elif ltf_rsi < 30:
                analysis["timing"]["rsi_zone"] = "sobrevendido"
            elif ltf_rsi > 55:
                analysis["timing"]["rsi_zone"] = "alcista"
            elif ltf_rsi < 45:
                analysis["timing"]["rsi_zone"] = "bajista"
            else:
                analysis["timing"]["rsi_zone"] = "neutral"

        # MACD state
        if ltf_macd_bullish:
            analysis["timing"]["macd_state"] = "cruce_alcista"
        elif ltf_macd_bearish:
            analysis["timing"]["macd_state"] = "cruce_bajista"
        elif ltf_macd_hist is not None:
            analysis["timing"]["macd_state"] = "alcista" if ltf_macd_hist > 0 else "bajista"

        # LTF momentum (combined RSI + MACD)
        ltf_bullish_count = sum([
            ltf_rsi is not None and ltf_rsi > 50,
            ltf_macd_hist is not None and ltf_macd_hist > 0,
        ])
        if ltf_bullish_count == 2:
            analysis["timing"]["ltf_momentum"] = "alcista"
        elif ltf_bullish_count == 0:
            analysis["timing"]["ltf_momentum"] = "bajista"
        else:
            analysis["timing"]["ltf_momentum"] = "neutral"

        # Volume state
        if ltf_volume_ratio is not None:
            if ltf_volume_ratio > 1.5:
                analysis["timing"]["volume_state"] = "alto"
            elif ltf_volume_ratio < 0.7:
                analysis["timing"]["volume_state"] = "bajo"
            else:
                analysis["timing"]["volume_state"] = "normal"

        # Check if LTF confirms HTF direction
        htf_bias = analysis["context"]["htf_bias"]
        ltf_mom = analysis["timing"]["ltf_momentum"]
        macd_state = analysis["timing"]["macd_state"]

        if htf_bias == "alcista" and (ltf_mom == "alcista" or macd_state == "cruce_alcista"):
            analysis["timing"]["has_confirmation"] = True
        elif htf_bias == "bajista" and (ltf_mom == "bajista" or macd_state == "cruce_bajista"):
            analysis["timing"]["has_confirmation"] = True

    # ========== SCENARIO CLASSIFICATION ==========
    htf_bias = analysis["context"]["htf_bias"]
    htf_structure = analysis["context"]["htf_structure"]
    volatility = analysis["context"]["volatility_state"]
    ltf_momentum = analysis["timing"]["ltf_momentum"]
    has_confirmation = analysis["timing"]["has_confirmation"]
    rsi_zone = analysis["timing"]["rsi_zone"]
    macd_state = analysis["timing"]["macd_state"]

    risk_factors = 0
    favorable_factors = 0

    # Risk factors
    if htf_bias == "mixto":
        risk_factors += 2
    if rsi_zone in ["sobrecompra", "sobrevendido"]:
        risk_factors += 1
    if htf_indicators and htf_indicators.get("divergence"):
        risk_factors += 2
    if volatility == "alta":
        risk_factors += 1

    # Favorable factors
    if htf_bias in ["alcista", "bajista"]:
        favorable_factors += 2
    if htf_structure in ["retroceso", "en nivel clave"]:
        favorable_factors += 1
    if has_confirmation:
        favorable_factors += 2
    if macd_state and "cruce" in macd_state:
        favorable_factors += 1

    # Funding consideration
    if funding:
        analysis["funding"] = {
            "rate_percent": funding.get("funding_rate_percent"),
            "sentiment": funding.get("sentiment"),
        }
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
    elif htf_bias in ["neutral", "mixto"]:
        analysis["scenario"] = "espera"
        analysis["scenario_reason"] = "El contexto 4H no ofrece sesgo direccional claro. Sin autorizacion estructural."
    elif favorable_factors >= 4 and risk_factors <= 1:
        analysis["scenario"] = "favorable"
        analysis["scenario_reason"] = f"Contexto 4H {htf_bias} con confirmacion 15m"
    elif favorable_factors >= 2:
        analysis["scenario"] = "operable"
        if has_confirmation:
            analysis["scenario_reason"] = f"Contexto 4H {htf_bias}, timing 15m confirmando"
        else:
            analysis["scenario_reason"] = f"Contexto 4H {htf_bias}, confirmacion 15m pendiente"
    else:
        analysis["scenario"] = "espera"
        analysis["scenario_reason"] = "Contexto y timing no alineados. Sin autorizacion para operar."

    # Direction preference (only if 4H allows)
    if analysis["scenario"] in ["favorable", "operable"]:
        if htf_bias == "alcista" and rsi_zone not in ["sobrecompra"]:
            analysis["direction_preference"] = "long"
        elif htf_bias == "bajista" and rsi_zone not in ["sobrevendido"]:
            analysis["direction_preference"] = "short"

    # ========== UNIFIED READING ==========
    reading_parts = []

    # Context summary
    if htf_bias == "alcista":
        reading_parts.append("4H alcista (precio sobre EMA200, MACD positivo)")
    elif htf_bias == "bajista":
        reading_parts.append("4H bajista (precio bajo EMA200, MACD negativo)")
    elif htf_bias == "mixto":
        reading_parts.append("4H mixto (estructura y momentum en conflicto)")
    else:
        reading_parts.append("4H sin sesgo claro")

    # Timing summary
    if has_confirmation:
        reading_parts.append(f"15m confirma direccion con momentum {ltf_momentum}")
    elif ltf_momentum != "neutral":
        if htf_bias in ["alcista", "bajista"] and ltf_momentum != htf_bias:
            reading_parts.append(f"15m en contra ({ltf_momentum}), sin confirmacion")
        else:
            reading_parts.append(f"15m muestra momentum {ltf_momentum}, confirmacion MACD pendiente")
    else:
        reading_parts.append("15m neutral, sin confirmacion de timing")

    analysis["unified_reading"] = ". ".join(reading_parts)

    # ========== OBSERVATIONS ==========
    obs = []

    # HTF observations
    if analysis["context"]["ema_position"]:
        zone = analysis["context"]["ema_position"]
        obs.append(f"Precio {zone} EMA200 en 4H")

    if analysis["context"]["macd_momentum"]:
        obs.append(f"MACD 4H {analysis['context']['macd_momentum']}")

    if htf_structure != "sin_datos":
        obs.append(f"Estructura 4H: {htf_structure}")

    if volatility != "normal":
        obs.append(f"Volatilidad {volatility}")

    # LTF observations
    if ltf_indicators:
        ltf_rsi = ltf_indicators.get("rsi")
        if ltf_rsi is not None:
            if rsi_zone in ["sobrecompra", "sobrevendido"]:
                obs.append(f"RSI 15m en {ltf_rsi:.0f} ({rsi_zone})")
            else:
                obs.append(f"RSI 15m en {ltf_rsi:.0f}")

        if macd_state and "cruce" in macd_state:
            direction = "alcista" if "alcista" in macd_state else "bajista"
            obs.append(f"MACD 15m cruzando {direction}")

        if analysis["timing"]["volume_state"] == "alto":
            obs.append("Volumen elevado en 15m")

    # Divergence
    if htf_indicators and htf_indicators.get("divergence"):
        obs.append(f"Divergencia detectada en 4H")

    # Funding
    if funding:
        rate = funding.get("funding_rate_percent", 0)
        sentiment = funding.get("sentiment", "balanced")
        if sentiment == "too_many_longs":
            obs.append(f"Funding {rate:.4f}% (exceso longs)")
        elif sentiment == "too_many_shorts":
            obs.append(f"Funding {rate:.4f}% (exceso shorts)")

    analysis["observations"] = obs

    # ========== STRUCTURAL ZONES (HTF - 4H) ==========
    structural_zones = []
    htf_price = htf_indicators.get("price") if htf_indicators else None
    htf_ema200 = htf_indicators.get("ema_200") if htf_indicators else None
    htf_fib = htf_indicators.get("fibonacci") if htf_indicators else None

    if htf_fib and htf_price:
        swing_high = htf_fib.get("swing_high")
        swing_low = htf_fib.get("swing_low")
        fib_levels = htf_fib.get("levels", {})

        # Check for confluences and add zones
        for level_name, level_price in fib_levels.items():
            if level_price is None:
                continue

            confluence = []
            confluence.append(f"Fibo {level_name}%")

            # Check EMA200 confluence (within 0.5%)
            if htf_ema200 and abs(level_price - htf_ema200) / htf_ema200 < 0.005:
                confluence.append("EMA200")

            # Check swing confluence
            if swing_high and abs(level_price - swing_high) / swing_high < 0.003:
                confluence.append("swing high")
            if swing_low and abs(level_price - swing_low) / swing_low < 0.003:
                confluence.append("swing low")

            # Determine zone type
            if htf_price:
                distance_pct = ((level_price - htf_price) / htf_price) * 100
                if distance_pct > 0.5:
                    zone_type = "oferta"  # Above price = supply/resistance
                elif distance_pct < -0.5:
                    zone_type = "demanda"  # Below price = demand/support
                else:
                    zone_type = "actual"  # At current price

                structural_zones.append({
                    "price": round(level_price, 6),
                    "type": zone_type,
                    "confluence": confluence,
                    "distance_percent": round(distance_pct, 2),
                    "description": f"Zona de {zone_type} en ${level_price:,.2f} ({' + '.join(confluence)})"
                })

        # Add swing high/low if not already covered by Fibo
        if swing_high and not any(abs(z["price"] - swing_high) / swing_high < 0.003 for z in structural_zones):
            distance_pct = ((swing_high - htf_price) / htf_price) * 100 if htf_price else 0
            structural_zones.append({
                "price": round(swing_high, 6),
                "type": "oferta",
                "confluence": ["swing high 4H"],
                "distance_percent": round(distance_pct, 2),
                "description": f"Swing high previo en ${swing_high:,.2f}"
            })

        if swing_low and not any(abs(z["price"] - swing_low) / swing_low < 0.003 for z in structural_zones):
            distance_pct = ((swing_low - htf_price) / htf_price) * 100 if htf_price else 0
            structural_zones.append({
                "price": round(swing_low, 6),
                "type": "demanda",
                "confluence": ["swing low 4H"],
                "distance_percent": round(distance_pct, 2),
                "description": f"Swing low previo en ${swing_low:,.2f}"
            })

    # Sort by distance and limit
    structural_zones.sort(key=lambda x: abs(x["distance_percent"]))
    analysis["structural_zones"] = structural_zones[:6]

    # Nearest zone info
    if structural_zones:
        nearest = structural_zones[0]
        dist = abs(nearest["distance_percent"])
        if dist < 1:
            analysis["distance_to_zone"] = {
                "description": f"El precio se encuentra dentro de una zona de friccion estructural",
                "zone": nearest,
                "state": "en_zona"
            }
        elif dist < 3:
            direction = "sobre" if nearest["distance_percent"] < 0 else "bajo"
            analysis["distance_to_zone"] = {
                "description": f"El precio esta a {dist:.1f}% de una zona de {nearest['type']} relevante",
                "zone": nearest,
                "state": "cercano"
            }
        else:
            analysis["distance_to_zone"] = {
                "description": f"El precio esta a {dist:.1f}% de la zona estructural mas cercana",
                "zone": nearest,
                "state": "extendido"
            }
    else:
        analysis["distance_to_zone"] = None

    # ========== RSI HTF STATE (Movement Reading) ==========
    htf_rsi = htf_indicators.get("rsi") if htf_indicators else None
    rsi_state = {
        "value": htf_rsi,
        "label": "normal",
        "icon": "🟢",
        "description": "Momentum dentro de rango normal"
    }

    if htf_rsi is not None:
        if htf_rsi >= 75:
            rsi_state = {
                "value": htf_rsi,
                "label": "agotamiento_potencial",
                "icon": "🔴",
                "description": f"RSI 4H en {htf_rsi:.0f} - Zona de agotamiento potencial alcista"
            }
        elif htf_rsi <= 25:
            rsi_state = {
                "value": htf_rsi,
                "label": "agotamiento_potencial",
                "icon": "🔴",
                "description": f"RSI 4H en {htf_rsi:.0f} - Zona de agotamiento potencial bajista"
            }
        elif htf_rsi >= 65:
            rsi_state = {
                "value": htf_rsi,
                "label": "momentum_extendido",
                "icon": "🟡",
                "description": f"RSI 4H en {htf_rsi:.0f} - Momentum alcista extendido"
            }
        elif htf_rsi <= 35:
            rsi_state = {
                "value": htf_rsi,
                "label": "momentum_extendido",
                "icon": "🟡",
                "description": f"RSI 4H en {htf_rsi:.0f} - Momentum bajista extendido"
            }
        else:
            rsi_state = {
                "value": htf_rsi,
                "label": "normal",
                "icon": "🟢",
                "description": f"RSI 4H en {htf_rsi:.0f} - Momentum dentro de rango normal"
            }

    analysis["rsi_htf_state"] = rsi_state

    # ========== CONTEXT CHECKLIST ==========
    checklist = {
        "context_4h": {
            "tendencia": {
                "checked": htf_bias in ["alcista", "bajista"],
                "label": "Tendencia definida",
                "detail": f"Sesgo {htf_bias}" if htf_bias else "Sin sesgo"
            },
            "momentum": {
                "checked": analysis["context"]["macd_momentum"] is not None,
                "label": "Momentum HTF",
                "detail": f"MACD {analysis['context']['macd_momentum']}" if analysis["context"]["macd_momentum"] else "Sin datos"
            },
            "movimiento_extendido": {
                "checked": rsi_state["label"] != "normal",
                "warning": rsi_state["label"] in ["momentum_extendido", "agotamiento_potencial"],
                "label": "Movimiento extendido",
                "detail": rsi_state["description"]
            }
        },
        "timing_15m": {
            "confirmacion": {
                "checked": has_confirmation,
                "label": "Confirmacion LTF",
                "detail": "Momentum alineado" if has_confirmation else "Sin confirmacion"
            },
            "volumen": {
                "checked": analysis["timing"]["volume_state"] == "alto",
                "label": "Volumen",
                "detail": f"Volumen {analysis['timing']['volume_state']}" if analysis["timing"]["volume_state"] else "Sin datos"
            },
            "macd_15m": {
                "checked": macd_state and "cruce" in macd_state,
                "label": "Cruce MACD",
                "detail": f"MACD {macd_state}" if macd_state else "Sin cruce"
            }
        }
    }

    # Generate checklist summary text
    ctx_ok = sum(1 for k, v in checklist["context_4h"].items() if v.get("checked") and not v.get("warning"))
    ctx_warn = sum(1 for k, v in checklist["context_4h"].items() if v.get("warning"))
    tim_ok = sum(1 for k, v in checklist["timing_15m"].items() if v.get("checked"))

    if ctx_ok >= 2 and tim_ok >= 2 and ctx_warn == 0:
        checklist["summary"] = "Contexto y timing alineados. Escenario completo."
    elif ctx_ok >= 2 and tim_ok < 2:
        checklist["summary"] = "El contexto favorece la direccion, pero el timing aun no acompana. Escenario incompleto."
    elif ctx_ok < 2:
        checklist["summary"] = "El contexto no ofrece claridad direccional. Esperar definicion."
    elif ctx_warn > 0:
        checklist["summary"] = "Contexto presente pero con senales de extension. Precaucion."
    else:
        checklist["summary"] = "Evaluando condiciones..."

    analysis["checklist"] = checklist

    return analysis


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
        analysis["scenario_reason"] = "El contexto HTF no ofrece sesgo claro. Sin autorizacion estructural."
    elif favorable_factors >= 3 and risk_factors <= 1:
        analysis["scenario"] = "favorable"
        analysis["scenario_reason"] = f"Contexto {htf_bias} con estructura {structure}"
    elif favorable_factors >= 2:
        analysis["scenario"] = "operable"
        analysis["scenario_reason"] = f"Contexto {htf_bias} pero entrada no ideal"
    else:
        analysis["scenario"] = "espera"
        analysis["scenario_reason"] = "Sin confirmacion suficiente. Condiciones no alineadas."

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
                analysis["volatility_state"] = "alta"
            elif atr_pct < 1:
                obs.append(f"Baja volatilidad (ATR {atr_pct:.1f}% del precio)")
                analysis["volatility_state"] = "baja"
            else:
                analysis["volatility_state"] = "normal"
        else:
            analysis["volatility_state"] = "normal"

        # Store RSI value for AI analysis
        analysis["rsi"] = htf_rsi

        # Determine scenario based on coherence and structure
        coherence = analysis["coherence"]
        htf_bias = analysis["htf_bias"]
        ltf_mom = analysis["ltf_momentum"]

        # Scenario logic for position management
        if analysis.get("invalidation_breached"):
            analysis["scenario"] = "alto_riesgo"
        elif coherence == "a_favor" and htf_bias != "neutral":
            # Position aligned with HTF context
            if (is_long and ltf_mom == "alcista") or (not is_long and ltf_mom == "bajista"):
                analysis["scenario"] = "favorable"
            else:
                analysis["scenario"] = "operable"
        elif coherence == "contra":
            # Position against HTF context
            analysis["scenario"] = "alto_riesgo"
        elif htf_bias == "mixto":
            analysis["scenario"] = "espera"
        else:
            analysis["scenario"] = "operable"

        analysis["observations"] = obs

        # ========== 7. SUGGESTION + RISK ASSESSMENT ==========
        # Generate contextual suggestion based on indicators and position
        ltf_15m = timeframes_data.get("15m", {})
        ltf_rsi = ltf_15m.get("rsi") or ltf.get("rsi")
        ltf_macd = ltf_15m.get("macd_trend") or ltf.get("macd_trend")
        ltf_div = ltf_15m.get("divergence") or ltf.get("divergence")
        ltf_vol = ltf_15m.get("volume_above_average") or ltf.get("volume_above_average")

        suggestion = None
        risk_level = "low"

        # Priority 1: RSI extremes
        if ltf_rsi is not None:
            if is_long and ltf_rsi > 75:
                suggestion = f"RSI en {ltf_rsi:.0f} (sobrecompra) - considerar tomar ganancias parciales"
                risk_level = "high"
            elif not is_long and ltf_rsi < 25:
                suggestion = f"RSI en {ltf_rsi:.0f} (sobreventa) - considerar tomar ganancias parciales"
                risk_level = "high"
            elif is_long and ltf_rsi > 70:
                suggestion = f"RSI en {ltf_rsi:.0f} - aproximandose a sobrecompra"
                risk_level = "medium"
            elif not is_long and ltf_rsi < 30:
                suggestion = f"RSI en {ltf_rsi:.0f} - aproximandose a sobreventa"
                risk_level = "medium"

        # Priority 2: MACD against position
        if suggestion is None and ltf_macd:
            if is_long and ltf_macd == "bearish":
                suggestion = "MACD bajista - momentum contra posicion LONG"
                risk_level = "high"
            elif not is_long and ltf_macd == "bullish":
                suggestion = "MACD alcista - momentum contra posicion SHORT"
                risk_level = "high"

        # Priority 3: Divergence against position
        if suggestion is None and ltf_div:
            if is_long and ltf_div == "bearish":
                suggestion = "Divergencia bajista detectada - posible reversion"
                risk_level = "high"
            elif not is_long and ltf_div == "bullish":
                suggestion = "Divergencia alcista detectada - posible reversion"
                risk_level = "high"

        # Priority 4: Price vs EMA200 conflict
        if suggestion is None and htf_ema is not None:
            if is_long and not htf_ema:
                suggestion = "Precio bajo EMA200 - estructura contra posicion LONG"
                risk_level = "medium"
            elif not is_long and htf_ema:
                suggestion = "Precio sobre EMA200 - estructura contra posicion SHORT"
                risk_level = "medium"

        # Priority 5: Strong trend in favor
        if suggestion is None:
            if ltf_vol and ltf_macd:
                if is_long and ltf_macd == "bullish":
                    suggestion = "Volumen alto + momentum alcista - tendencia fuerte a favor"
                    risk_level = "low"
                elif not is_long and ltf_macd == "bearish":
                    suggestion = "Volumen alto + momentum bajista - tendencia fuerte a favor"
                    risk_level = "low"

        # Default: no alerts
        if suggestion is None:
            if analysis["coherence"] == "a_favor":
                suggestion = "Sin senales de alerta - posicion alineada con contexto"
                risk_level = "low"
            elif analysis["coherence"] == "contra":
                suggestion = "Posicion contra contexto HTF - vigilar niveles de invalidacion"
                risk_level = "medium"
            else:
                suggestion = "Sin senales de alerta - mantener posicion"
                risk_level = "low"

        # Market sentiment from 15m/1h
        if ltf_macd == "bullish" and ltf_rsi and ltf_rsi > 50:
            market_sentiment = "bullish"
        elif ltf_macd == "bearish" and ltf_rsi and ltf_rsi < 50:
            market_sentiment = "bearish"
        else:
            market_sentiment = "neutral"

        analysis["suggestion"] = suggestion
        analysis["risk_level"] = risk_level
        analysis["market_sentiment"] = market_sentiment

    except Exception as e:
        logger.error(f"Error computing position analysis for {symbol}: {e}")
        analysis["observations"] = ["Error al calcular analisis"]
        analysis["suggestion"] = "Error al calcular sugerencia"
        analysis["risk_level"] = "medium"
        analysis["market_sentiment"] = "neutral"

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
                "opened_at": p.opened_at.isoformat() + "Z" if p.opened_at else None,
                "updated_at": p.updated_at.isoformat() + "Z" if p.updated_at else None,
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
                    "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
                }
                for a in alerts
            ],
            "total": len(alerts),
        }
    finally:
        db.close()


@app.get("/api/positions/{symbol}/ai-analysis")
async def get_position_ai(symbol: str, user: UserAccount = Depends(get_current_user)):
    """
    Get AI-generated analysis for a specific position.
    Returns: lectura, fragilidad, si_favorece, si_contra.
    """
    # Check AI usage limit
    if not user.can_use_ai():
        raise HTTPException(status_code=429, detail="AI limit reached")

    db = get_db()
    try:
        # Find position
        pos = db.query(ActivePosition).filter(
            ActivePosition.user_id == user.id,
            ActivePosition.symbol.ilike(f"%{symbol.replace('-', '%').replace('/', '%')}%"),
            ActivePosition.is_open == True
        ).first()

        if not pos:
            raise HTTPException(status_code=404, detail="Position not found")

        # Calculate PnL percent
        pnl_pct = 0
        if pos.entry_price and pos.current_price:
            is_long = pos.side.upper() == "LONG"
            pnl_pct = ((pos.current_price - pos.entry_price) / pos.entry_price * 100)
            if not is_long:
                pnl_pct = -pnl_pct

        # PnL state bucket
        if pnl_pct <= -10:
            pnl_state = "deep_loss"
        elif pnl_pct <= -3:
            pnl_state = "loss"
        elif pnl_pct < 0:
            pnl_state = "small_loss"
        elif pnl_pct < 3:
            pnl_state = "breakeven"
        elif pnl_pct < 10:
            pnl_state = "profit"
        else:
            pnl_state = "strong_profit"

        # Liquidation distance
        liq_distance = None
        if pos.liquidation_price and pos.current_price and pos.liquidation_price > 0:
            liq_distance = abs(pos.current_price - pos.liquidation_price) / pos.current_price * 100

        # Invalidation distance
        inv_distance = None
        # Get market analysis for this symbol
        try:
            _, analysis = _compute_position_analysis(
                pos.symbol, pos.side, pos.entry_price, pos.current_price
            )
            inv_level = analysis.get("invalidation_level")
            if inv_level and pos.current_price:
                inv_distance = abs(pos.current_price - inv_level) / pos.current_price * 100
        except Exception as e:
            logger.error(f"Error computing position analysis: {e}")
            analysis = {}

        # Build position dict with PnL context
        position_data = {
            "symbol": pos.symbol,
            "side": pos.side,
            "pnl_state": pnl_state,
            "pnl_pct": pnl_pct,
            "leverage": pos.leverage or 1,
            "liq_distance_pct": liq_distance,
            "inv_distance_pct": inv_distance,
        }

        # Build market state for AI (discrete states)
        market_state = {
            "htf_bias": analysis.get("htf_bias", "neutral"),
            "htf_structure": analysis.get("htf_structure", "unknown"),
            "ltf_momentum": analysis.get("ltf_momentum", "neutral"),
            "coherence": analysis.get("coherence", "neutral"),
            "coherence_text": analysis.get("coherence_text", ""),
            "volatility": analysis.get("volatility_state", "normal"),
            "rsi": analysis.get("rsi"),
            "scenario": analysis.get("scenario", "espera"),
        }

        # Log the data being sent to AI for debugging
        logger.info(f"[AI-POS] Position data: {position_data}")
        logger.info(f"[AI-POS] Market state: htf_bias={market_state['htf_bias']}, coherence={market_state['coherence']}, volatility={market_state['volatility']}, scenario={market_state['scenario']}, rsi={market_state['rsi']}")

        # Get AI analysis
        result = get_position_ai_analysis(user.id, position_data, market_state)

        # Increment AI usage only if not cached
        if not result.get("cached"):
            account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
            if account:
                account.increment_ai_usage()
                db.commit()

        return {
            "symbol": pos.symbol,
            "lectura": result["lectura"],
            "fragilidad": result["fragilidad"],
            "si_favorece": result["si_favorece"],
            "si_contra": result["si_contra"],
            "cached": result["cached"],
            "generated_at": result["generated_at"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting position AI analysis: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
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
                    "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
                }
                for a in alerts
            ],
            "total": len(alerts),
        }
    finally:
        db.close()


# ============================================================
# Notifications Endpoints (Bell icon)
# ============================================================

@app.get("/api/notifications")
async def get_notifications(
    limit: int = 50,
    unread_only: bool = False,
    user: UserAccount = Depends(get_current_user)
):
    """Get all notifications for the authenticated user."""
    db = get_db()
    try:
        notifications = DBHelper.get_user_notifications(db, user.id, limit, unread_only)
        unread_count = DBHelper.get_unread_count(db, user.id)
        return {
            "notifications": [
                {
                    "id": n.id,
                    "type": n.notification_type if n.notification_type else None,
                    "title": n.title,
                    "message": n.message,
                    "symbol": n.symbol,
                    "data": n.data,
                    "is_read": n.is_read,
                    "created_at": n.created_at.isoformat() + "Z" if n.created_at else None,
                }
                for n in notifications
            ],
            "total": len(notifications),
            "unread_count": unread_count,
        }
    finally:
        db.close()


@app.get("/api/notifications/unread-count")
async def get_unread_count(user: UserAccount = Depends(get_current_user)):
    """Get count of unread notifications."""
    db = get_db()
    try:
        count = DBHelper.get_unread_count(db, user.id)
        return {"unread_count": count}
    finally:
        db.close()


@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    user: UserAccount = Depends(get_current_user)
):
    """Mark a specific notification as read."""
    db = get_db()
    try:
        success = DBHelper.mark_notification_read(db, notification_id, user.id)
        if not success:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"success": True}
    finally:
        db.close()


@app.post("/api/notifications/read-all")
async def mark_all_read(user: UserAccount = Depends(get_current_user)):
    """Mark all notifications as read."""
    db = get_db()
    try:
        count = DBHelper.mark_all_notifications_read(db, user.id)
        return {"success": True, "marked_count": count}
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


@app.get("/api/market-unified")
async def get_unified_market_data(pairs: Optional[str] = None, refresh: bool = False):
    """
    Get unified market analysis per pair (4H context + 15m timing).

    Each pair returns:
    - context: 4H analysis (htf_bias, structure, volatility)
    - timing: 15m analysis (momentum, confirmation)
    - unified_reading: Combined interpretation
    - scenario: favorable/operable/alto_riesgo/espera
    - direction_preference: long/short/null

    Query params:
    - pairs: comma-separated list of pairs (e.g., "BTC/USDT,ETH/USDT")
    - refresh: force refresh from exchange
    """
    global active_pairs

    # Determine which pairs to fetch
    if pairs:
        requested_pairs = [p.strip().upper() for p in pairs.split(",")]
    else:
        requested_pairs = list(get_all_monitored_pairs())

    client = get_binance_client()
    result = {}

    for pair in requested_pairs:
        try:
            # Fetch 4H data (context)
            htf_indicators = None
            if refresh or "4h" not in market_data or pair not in market_data.get("4h", {}):
                df_4h = client.fetch_ohlcv(pair, "4h")
                if df_4h is not None and len(df_4h) >= 200:
                    df_4h = add_all_indicators(df_4h)
                    htf_indicators = get_latest_indicators(df_4h)
            else:
                cached = market_data.get("4h", {}).get(pair, {})
                htf_indicators = cached.get("indicators")

            # Fetch 15m data (timing)
            ltf_indicators = None
            if refresh or "15m" not in market_data or pair not in market_data.get("15m", {}):
                df_15m = client.fetch_ohlcv(pair, "15m")
                if df_15m is not None and len(df_15m) >= 200:
                    df_15m = add_all_indicators(df_15m)
                    ltf_indicators = get_latest_indicators(df_15m)
            else:
                cached = market_data.get("15m", {}).get(pair, {})
                ltf_indicators = cached.get("indicators")

            # Fetch funding rate
            funding_data = client.get_funding_rate(pair)

            # Get current price (prefer 15m for most recent)
            current_price = None
            if ltf_indicators:
                current_price = ltf_indicators.get("price")
            elif htf_indicators:
                current_price = htf_indicators.get("price")

            # Compute unified analysis
            analysis = _compute_unified_pair_analysis(pair, htf_indicators, ltf_indicators, funding_data)

            result[pair] = {
                "pair": pair,
                "price": current_price,
                "analysis": analysis,
                "htf_indicators": {
                    "price": htf_indicators.get("price") if htf_indicators else None,
                    "rsi": htf_indicators.get("rsi") if htf_indicators else None,
                    "rsi_rising": htf_indicators.get("rsi_rising") if htf_indicators else None,
                    "rsi_falling": htf_indicators.get("rsi_falling") if htf_indicators else None,
                    "macd_histogram": htf_indicators.get("macd_histogram") if htf_indicators else None,
                    "macd_crossover_bullish": htf_indicators.get("macd_crossover_bullish") if htf_indicators else None,
                    "macd_crossover_bearish": htf_indicators.get("macd_crossover_bearish") if htf_indicators else None,
                    "price_above_ema": htf_indicators.get("price_above_ema") if htf_indicators else None,
                    "ema_200": htf_indicators.get("ema_200") if htf_indicators else None,
                    "atr": htf_indicators.get("atr") if htf_indicators else None,
                    "volume_above_average": htf_indicators.get("volume_above_average") if htf_indicators else None,
                    "volume_ratio": htf_indicators.get("volume_ratio") if htf_indicators else None,
                } if htf_indicators else None,
                "ltf_indicators": {
                    "price": ltf_indicators.get("price") if ltf_indicators else None,
                    "rsi": ltf_indicators.get("rsi") if ltf_indicators else None,
                    "rsi_rising": ltf_indicators.get("rsi_rising") if ltf_indicators else None,
                    "rsi_falling": ltf_indicators.get("rsi_falling") if ltf_indicators else None,
                    "macd_histogram": ltf_indicators.get("macd_histogram") if ltf_indicators else None,
                    "macd_crossover_bullish": ltf_indicators.get("macd_crossover_bullish") if ltf_indicators else None,
                    "macd_crossover_bearish": ltf_indicators.get("macd_crossover_bearish") if ltf_indicators else None,
                    "price_above_ema": ltf_indicators.get("price_above_ema") if ltf_indicators else None,
                    "ema_200": ltf_indicators.get("ema_200") if ltf_indicators else None,
                    "volume_above_average": ltf_indicators.get("volume_above_average") if ltf_indicators else None,
                    "volume_ratio": ltf_indicators.get("volume_ratio") if ltf_indicators else None,
                    "fibonacci": ltf_indicators.get("fibonacci") if ltf_indicators else None,
                } if ltf_indicators else None,
                # Legacy: include full indicators for PairDetailModal compatibility
                "indicators": ltf_indicators,
                "funding": funding_data,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.error(f"Error fetching unified data for {pair}: {e}")
            result[pair] = {
                "pair": pair,
                "price": None,
                "analysis": {
                    "scenario": "espera",
                    "scenario_reason": f"Error: {str(e)[:50]}",
                    "unified_reading": "Error al obtener datos",
                    "context": {},
                    "timing": {},
                    "observations": [],
                    "key_levels": [],
                },
                "error": str(e),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

    return {
        "pairs": result,
        "total": len(result),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/ai-explanation/{pair}")
async def get_ai_market_explanation(pair: str, user: UserAccount = Depends(get_optional_user)):
    """
    Get AI-generated explanation of current market context.

    The AI explains what IS happening based on technical data.
    It does NOT generate signals, predictions, or trading instructions.

    Responses are cached based on market state (HTF bias, scenario, structure, volatility).
    Cache TTL: 2 hours. New explanations only generated when state changes.
    """
    # Check AI usage limit if user is authenticated
    if user and not user.can_use_ai():
        raise HTTPException(status_code=429, detail="AI limit reached")

    pair_formatted = pair.replace("-", "/").upper()
    if not pair_formatted.endswith("/USDT"):
        pair_formatted = f"{pair_formatted}/USDT"

    # First, get the current market analysis
    client = get_binance_client()

    try:
        # Fetch indicators
        df_4h = client.fetch_ohlcv(pair_formatted, "4h")
        htf_indicators = None
        if df_4h is not None and len(df_4h) >= 200:
            df_4h = add_all_indicators(df_4h)
            htf_indicators = get_latest_indicators(df_4h)

        df_15m = client.fetch_ohlcv(pair_formatted, "15m")
        ltf_indicators = None
        if df_15m is not None and len(df_15m) >= 200:
            df_15m = add_all_indicators(df_15m)
            ltf_indicators = get_latest_indicators(df_15m)

        # Get unified analysis
        analysis = _compute_unified_pair_analysis(pair_formatted, htf_indicators, ltf_indicators)

        # Build state object for AI
        htf_fib = htf_indicators.get("fibonacci", {}) if htf_indicators else {}
        support_levels = []
        resistance_levels = []

        if htf_fib and htf_fib.get("levels"):
            current_price = htf_indicators.get("price", 0) if htf_indicators else 0
            for name, price in htf_fib["levels"].items():
                if price and current_price:
                    if price < current_price:
                        support_levels.append(round(price, 2))
                    else:
                        resistance_levels.append(round(price, 2))

        # Determine volume dominance from LTF indicators
        volume_dominance = "balanced"
        if ltf_indicators:
            vol_ratio = ltf_indicators.get("volume_ratio", 1.0)
            macd_hist = ltf_indicators.get("macd_histogram", 0)
            if vol_ratio > 1.5 and macd_hist > 0:
                volume_dominance = "buying"
            elif vol_ratio > 1.5 and macd_hist < 0:
                volume_dominance = "selling"

        # Determine momentum state (strong/weakening/neutral)
        momentum_state = "neutral"
        if htf_indicators:
            macd_hist = htf_indicators.get("macd_histogram", 0)
            macd_prev = htf_indicators.get("macd_histogram_prev", macd_hist)
            if abs(macd_hist) > abs(macd_prev) * 1.1:
                momentum_state = "strong"
            elif abs(macd_hist) < abs(macd_prev) * 0.9:
                momentum_state = "weakening"

        # Determine RSI state (descriptive, no numbers)
        rsi_state = "neutral"
        if htf_indicators:
            rsi = htf_indicators.get("rsi", 50)
            if rsi >= 80:
                rsi_state = "extreme_overbought"
            elif rsi >= 70:
                rsi_state = "overbought"
            elif rsi <= 20:
                rsi_state = "extreme_oversold"
            elif rsi <= 30:
                rsi_state = "oversold"

        # Build AI state with STATES ONLY, no numeric values
        ai_state = {
            "pair": pair_formatted,
            "htf_timeframe": "4H",
            "htf_bias": analysis.get("context", {}).get("htf_bias", "neutral"),
            "structure": analysis.get("context", {}).get("htf_structure", "unknown"),
            "scenario": analysis.get("scenario", "espera"),
            "volatility": analysis.get("context", {}).get("volatility_state", "normal"),
            "volume_dominance": volume_dominance,
            "momentum_state": momentum_state,
            "rsi_state": rsi_state,
        }

        # Check if there's a relevant tension that warrants AI explanation
        reason = should_call_ai(ai_state)

        if not reason:
            # No tension detected - silence is criteria
            logger.info(f"[AI] No tension for {pair_formatted} - skipping AI")
            return {
                "pair": pair_formatted,
                "explanation": None,
                "reason": None,
                "cached": False,
                "cache_key": None,
                "generated_at": None,
                "current_state": {
                    "htf_bias": ai_state["htf_bias"],
                    "scenario": ai_state["scenario"],
                    "structure": ai_state["structure"],
                    "volatility": ai_state["volatility"],
                    "volume_dominance": ai_state["volume_dominance"],
                    "momentum_state": ai_state["momentum_state"],
                    "rsi_state": ai_state["rsi_state"],
                }
            }

        # Get AI explanation focused on the specific reason
        result = get_ai_explanation(ai_state, reason)

        # Increment AI usage only if not cached and user is authenticated
        if user and not result.get("cached"):
            db = get_db()
            try:
                account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
                if account:
                    account.increment_ai_usage()
                    db.commit()
            finally:
                db.close()

        return {
            "pair": pair_formatted,
            "explanation": result["text"],
            "reason": result["reason"],
            "cached": result["cached"],
            "cache_key": result["cache_key"],
            "generated_at": result["generated_at"],
            "current_state": {
                "htf_bias": ai_state["htf_bias"],
                "scenario": ai_state["scenario"],
                "structure": ai_state["structure"],
                "volatility": ai_state["volatility"],
                "volume_dominance": ai_state["volume_dominance"],
                "momentum_state": ai_state["momentum_state"],
                "rsi_state": ai_state["rsi_state"],
            }
        }

    except Exception as e:
        logger.error(f"Error generating AI explanation for {pair}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ai-cache-stats")
async def get_ai_cache_statistics():
    """Get statistics about the AI explanation cache."""
    return get_cache_stats()


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


@app.get("/api/volume-profile/{pair}")
async def get_volume_profile(pair: str, timeframe: str = "15m"):
    """
    Get executed volume profile and CVD for a pair.
    Returns volume by price level and cumulative volume delta.
    Used for context/structure analysis only - no signals.
    """
    if timeframe not in ["15m", "4h"]:
        raise HTTPException(status_code=400, detail="Timeframe must be 15m or 4h")

    pair_formatted = pair.replace("-", "/").upper()
    if not pair_formatted.endswith("/USDT"):
        pair_formatted = f"{pair_formatted}/USDT"

    client = get_binance_client()

    # Calculate time range based on timeframe
    import time as time_module
    now_ms = int(time_module.time() * 1000)
    if timeframe == "15m":
        # Last 4 hours of trades for 15m view
        start_time = now_ms - (4 * 60 * 60 * 1000)
        num_bins = 20
    else:  # 4h
        # Last 24 hours of trades for 4h view
        start_time = now_ms - (24 * 60 * 60 * 1000)
        num_bins = 15

    # Fetch recent trades
    trades = client.fetch_recent_trades(pair_formatted, limit=1000)
    if not trades:
        raise HTTPException(status_code=404, detail=f"No trades found for {pair_formatted}")

    # Filter trades by time range
    trades = [t for t in trades if t["timestamp"] >= start_time]
    if not trades:
        return {
            "pair": pair_formatted,
            "timeframe": timeframe,
            "volume_profile": [],
            "cvd": [],
            "summary": {
                "total_buy_volume": 0,
                "total_sell_volume": 0,
                "net_delta": 0,
                "dominant_side": "neutral",
            }
        }

    # Calculate price range and bin size
    prices = [t["price"] for t in trades]
    min_price = min(prices)
    max_price = max(prices)
    price_range = max_price - min_price

    if price_range == 0:
        price_range = min_price * 0.01  # 1% range if all same price

    bin_size = price_range / num_bins

    # Initialize volume profile bins
    volume_profile = {}
    for i in range(num_bins):
        bin_price = min_price + (i + 0.5) * bin_size
        volume_profile[i] = {
            "price_level": round(bin_price, 6),
            "buy_volume": 0.0,
            "sell_volume": 0.0,
            "total_volume": 0.0,
        }

    # Calculate CVD over time
    cvd_data = []
    cumulative_delta = 0.0
    total_buy = 0.0
    total_sell = 0.0

    # Sort trades by timestamp
    trades_sorted = sorted(trades, key=lambda x: x["timestamp"])

    for trade in trades_sorted:
        price = trade["price"]
        amount = trade["amount"]
        side = trade["side"]

        # Assign to volume profile bin
        bin_idx = min(int((price - min_price) / bin_size), num_bins - 1)
        if bin_idx < 0:
            bin_idx = 0

        notional = price * amount

        if side == "buy":
            volume_profile[bin_idx]["buy_volume"] += notional
            total_buy += notional
            cumulative_delta += notional
        else:
            volume_profile[bin_idx]["sell_volume"] += notional
            total_sell += notional
            cumulative_delta -= notional

        volume_profile[bin_idx]["total_volume"] += notional

    # Convert volume profile to list, sorted by price
    profile_list = []
    for bin_data in volume_profile.values():
        if bin_data["total_volume"] > 0:
            profile_list.append({
                "price": bin_data["price_level"],
                "buy": round(bin_data["buy_volume"], 2),
                "sell": round(bin_data["sell_volume"], 2),
                "total": round(bin_data["total_volume"], 2),
            })

    profile_list.sort(key=lambda x: x["price"])

    # Calculate max volume for normalization
    max_vol = max((p["total"] for p in profile_list), default=1)

    # Add percentage for visualization
    for p in profile_list:
        p["percent"] = round((p["total"] / max_vol) * 100, 1)

    # Simplified CVD - just start and end for the period
    net_delta = total_buy - total_sell

    # Determine dominant side - only if delta is significant (>15% of total)
    total_volume = total_buy + total_sell
    delta_ratio = abs(net_delta) / total_volume if total_volume > 0 else 0

    if delta_ratio < 0.15:
        dominant = "equilibrada"
        description = "Volumen equilibrado en el periodo"
    elif net_delta > 0:
        dominant = "compradora"
        description = "Mayor agresion compradora en el periodo"
    else:
        dominant = "vendedora"
        description = "Mayor agresion vendedora en el periodo"

    return {
        "pair": pair_formatted,
        "timeframe": timeframe,
        "volume_profile": profile_list,
        "summary": {
            "total_buy_volume": round(total_buy, 2),
            "total_sell_volume": round(total_sell, 2),
            "net_delta": round(net_delta, 2),
            "dominant_side": dominant,
            "delta_ratio": round(delta_ratio * 100, 1),
            "description": description
        }
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
            # Legacy: try to find user by token, then get their linked account subscriptions
            user = DBHelper.get_user_by_token(db, token)
            if user:
                signals_cleared_at = user.signals_cleared_at
                # If user has linked account, get subscriptions from there
                if user.account_id:
                    subs = db.query(Subscription).filter(
                        Subscription.account_id == user.account_id, Subscription.enabled == True
                    ).all()
                    for sub in subs:
                        user_pairs.add(sub.pair)
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
async def register_token(data: TokenRegistration, user: UserAccount = Depends(get_optional_user)):
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

    # Also save push_token to user account for passive alerts
    if user and data.token and data.token.startswith("ExponentPushToken"):
        db = get_db()
        try:
            account = db.query(UserAccount).filter(UserAccount.id == user.id).first()
            if account:
                account.push_token = data.token
                db.commit()
                logger.info(f"[PUSH] Saved push token for user {user.id}")
        except Exception as e:
            logger.error(f"[PUSH] Error saving push token: {e}")
        finally:
            db.close()

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


@app.get("/api/alert-states")
async def get_alert_states():
    """Get current alert state caches (for debugging)."""
    from alerts import get_current_states
    return get_current_states()


@app.post("/api/subscriptions/add")
async def add_subscription(
    data: SubscriptionAdd,
    user: UserAccount = Depends(get_current_user)
):
    """Add a subscription for the authenticated user."""
    if data.pair not in AVAILABLE_PAIRS:
        raise HTTPException(status_code=400, detail=f"Invalid pair: {data.pair}")
    try:
        db = get_db()
        sub = DBHelper.add_subscription(db, user.id, data.pair)
        db.close()
        return {
            "status": "added",
            "subscription": {"id": sub.id, "pair": sub.pair},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subscriptions/remove")
async def remove_subscription(
    data: SubscriptionRemove,
    user: UserAccount = Depends(get_current_user)
):
    """Remove a subscription for the authenticated user."""
    try:
        db = get_db()
        success = DBHelper.remove_subscription(db, data.subscription_id, user.id)
        db.close()
        if not success:
            raise HTTPException(status_code=404, detail="Subscription not found")
        return {"status": "removed", "subscription_id": data.subscription_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/subscriptions")
async def list_subscriptions(user: UserAccount = Depends(get_current_user)):
    """Get all subscriptions for the authenticated user."""
    try:
        db = get_db()
        subs = DBHelper.get_user_subscriptions(db, user.id)
        db.close()
        return {
            "subscriptions": [
                {"id": sub.id, "pair": sub.pair}
                for sub in subs
            ]
        }
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
                "stop_loss": sig.stop_loss, "receivedAt": sig.created_at.isoformat() + "Z",
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


# ============================================================
# Admin Panel Endpoints
# ============================================================

def get_admin_user(user: UserAccount = Depends(get_current_user)) -> UserAccount:
    """Dependency that requires admin privileges."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@app.get("/api/admin/stats")
async def admin_stats(admin: UserAccount = Depends(get_admin_user)):
    """Get admin dashboard statistics."""
    db = get_db()
    try:
        total_users = db.query(UserAccount).count()
        premium_users = db.query(UserAccount).filter(UserAccount.subscription_status == "active").count()
        free_users = total_users - premium_users
        users_with_binance = db.query(UserAccount).filter(
            UserAccount.binance_api_key.isnot(None),
            UserAccount.binance_api_key != ""
        ).count()
        total_positions = db.query(ActivePosition).filter(ActivePosition.is_open == True).count()
        total_subscriptions = db.query(Subscription).filter(Subscription.enabled == True).count()

        return {
            "users": {
                "total": total_users,
                "premium": premium_users,
                "free": free_users,
                "with_binance": users_with_binance,
            },
            "positions": {
                "total_open": total_positions,
            },
            "subscriptions": {
                "total": total_subscriptions,
            },
        }
    finally:
        db.close()


@app.get("/api/admin/users")
async def admin_list_users(
    admin: UserAccount = Depends(get_admin_user),
    limit: int = 50,
    offset: int = 0,
    search: str = None
):
    """List all users with pagination and search."""
    db = get_db()
    try:
        query = db.query(UserAccount)
        if search:
            query = query.filter(UserAccount.email.ilike(f"%{search}%"))
        total = query.count()
        users = query.order_by(UserAccount.created_at.desc()).offset(offset).limit(limit).all()

        return {
            "users": [{
                "id": u.id,
                "email": u.email,
                "email_verified": u.email_verified or False,
                "country": u.country,
                "subscription_status": u.subscription_status or "free",
                "subscription_expires_at": u.subscription_expires_at.isoformat() if u.subscription_expires_at else None,
                "is_premium": u.is_premium(),
                "has_binance_keys": u.has_binance_keys(),
                "ai_usage_count": u.ai_usage_count or 0,
                "ai_limit": u.get_ai_limit(),
                "is_admin": u.is_admin or False,
                "enabled": u.enabled,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            } for u in users],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()


@app.get("/api/admin/users/{user_id}")
async def admin_get_user(user_id: int, admin: UserAccount = Depends(get_admin_user)):
    """Get detailed user information."""
    db = get_db()
    try:
        user = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Get user's subscriptions
        subs = db.query(Subscription).filter(
            Subscription.account_id == user_id,
            Subscription.enabled == True
        ).all()

        # Get user's positions
        positions = db.query(ActivePosition).filter(
            ActivePosition.user_id == user_id,
            ActivePosition.is_open == True
        ).all()

        return {
            "id": user.id,
            "email": user.email,
            "country": user.country,
            "subscription_status": user.subscription_status or "free",
            "subscription_expires_at": user.subscription_expires_at.isoformat() if user.subscription_expires_at else None,
            "is_premium": user.is_premium(),
            "has_binance_keys": user.has_binance_keys(),
            "ai_usage_count": user.ai_usage_count or 0,
            "ai_limit": user.get_ai_limit(),
            "is_admin": user.is_admin or False,
            "enabled": user.enabled,
            "push_enabled": user.push_enabled,
            "risk_percent": user.risk_percent,
            "max_leverage": user.max_leverage,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "updated_at": user.updated_at.isoformat() if user.updated_at else None,
            "subscriptions": [{
                "id": s.id,
                "pair": s.pair,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            } for s in subs],
            "positions": [{
                "id": p.id,
                "symbol": p.symbol,
                "side": p.side,
                "entry_price": p.entry_price,
                "current_price": p.current_price,
                "amount": p.amount,
                "leverage": p.leverage,
                "unrealized_pnl": p.unrealized_pnl,
                "liquidation_price": p.liquidation_price,
                "opened_at": p.opened_at.isoformat() if p.opened_at else None,
            } for p in positions],
        }
    finally:
        db.close()


class AdminUserUpdate(BaseModel):
    subscription_status: Optional[str] = None
    subscription_expires_at: Optional[str] = None
    is_admin: Optional[bool] = None
    enabled: Optional[bool] = None
    ai_usage_count: Optional[int] = None


@app.put("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, data: AdminUserUpdate, admin: UserAccount = Depends(get_admin_user)):
    """Update user settings (subscription, admin status, etc)."""
    db = get_db()
    try:
        user = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if data.subscription_status is not None:
            user.subscription_status = data.subscription_status
        if data.subscription_expires_at is not None:
            if data.subscription_expires_at == "" or data.subscription_expires_at == "null":
                user.subscription_expires_at = None
            else:
                user.subscription_expires_at = datetime.fromisoformat(data.subscription_expires_at.replace("Z", "+00:00"))
        if data.is_admin is not None:
            user.is_admin = data.is_admin
        if data.enabled is not None:
            user.enabled = data.enabled
        if data.ai_usage_count is not None:
            user.ai_usage_count = data.ai_usage_count

        db.commit()
        return {"status": "ok", "message": "User updated"}
    finally:
        db.close()


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: int, admin: UserAccount = Depends(get_admin_user)):
    """Delete a user and all their associated data."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    db = get_db()
    try:
        user = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Delete user's subscriptions
        db.query(Subscription).filter(Subscription.account_id == user_id).delete()

        # Delete user's positions
        db.query(ActivePosition).filter(ActivePosition.user_id == user_id).delete()

        # Delete user's notifications
        db.query(UserNotification).filter(UserNotification.user_id == user_id).delete()

        # Delete the user
        db.delete(user)
        db.commit()

        logger.info(f"Admin {admin.email} deleted user {user.email} (ID: {user_id})")
        return {"status": "ok", "message": f"User {user.email} deleted"}
    finally:
        db.close()


@app.post("/api/admin/users/{user_id}/resend-verification")
async def admin_resend_verification(user_id: int, admin: UserAccount = Depends(get_admin_user)):
    """Resend verification email to a user."""
    db = get_db()
    try:
        user = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if user.email_verified:
            raise HTTPException(status_code=400, detail="User is already verified")

        # Generate new code and send email
        code = generate_verification_code()
        user.verification_token = code
        db.commit()

        sent = send_verification_email(user.email, code, "es")
        if not sent:
            raise HTTPException(status_code=500, detail="Failed to send email")

        logger.info(f"Admin {admin.email} resent verification to {user.email}")
        return {"status": "ok", "message": f"Verification email sent to {user.email}", "code": code}
    finally:
        db.close()


@app.post("/api/admin/users/{user_id}/verify")
async def admin_verify_user(user_id: int, admin: UserAccount = Depends(get_admin_user)):
    """Manually verify a user's email."""
    db = get_db()
    try:
        user = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if user.email_verified:
            raise HTTPException(status_code=400, detail="User is already verified")

        user.email_verified = True
        user.verification_token = None
        db.commit()

        logger.info(f"Admin {admin.email} manually verified {user.email}")
        return {"status": "ok", "message": f"User {user.email} verified"}
    finally:
        db.close()


@app.get("/api/admin/positions")
async def admin_list_positions(
    admin: UserAccount = Depends(get_admin_user),
    limit: int = 50,
    offset: int = 0,
    user_id: int = None
):
    """List all open positions."""
    db = get_db()
    try:
        query = db.query(ActivePosition).filter(ActivePosition.is_open == True)
        if user_id:
            query = query.filter(ActivePosition.user_id == user_id)

        total = query.count()
        positions = query.order_by(ActivePosition.opened_at.desc()).offset(offset).limit(limit).all()

        # Get user emails for display
        user_ids = list(set(p.user_id for p in positions))
        users = {u.id: u.email for u in db.query(UserAccount).filter(UserAccount.id.in_(user_ids)).all()}

        return {
            "positions": [{
                "id": p.id,
                "user_id": p.user_id,
                "user_email": users.get(p.user_id, "Unknown"),
                "symbol": p.symbol,
                "side": p.side,
                "entry_price": p.entry_price,
                "current_price": p.current_price,
                "amount": p.amount,
                "leverage": p.leverage,
                "unrealized_pnl": p.unrealized_pnl,
                "liquidation_price": p.liquidation_price,
                "opened_at": p.opened_at.isoformat() if p.opened_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            } for p in positions],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()


@app.get("/api/admin/subscriptions")
async def admin_list_subscriptions(
    admin: UserAccount = Depends(get_admin_user),
    limit: int = 100,
    offset: int = 0
):
    """List all market subscriptions (pairs)."""
    db = get_db()
    try:
        # Get subscription counts by pair
        from sqlalchemy import func
        pair_counts = db.query(
            Subscription.pair,
            func.count(Subscription.id).label('count')
        ).filter(Subscription.enabled == True).group_by(Subscription.pair).all()

        # Get all subscriptions with user info
        query = db.query(Subscription).filter(Subscription.enabled == True)
        total = query.count()
        subs = query.order_by(Subscription.created_at.desc()).offset(offset).limit(limit).all()

        # Get user emails
        user_ids = list(set(s.account_id for s in subs))
        users = {u.id: u.email for u in db.query(UserAccount).filter(UserAccount.id.in_(user_ids)).all()}

        return {
            "pair_summary": [{
                "pair": pc.pair,
                "subscriber_count": pc.count,
            } for pc in sorted(pair_counts, key=lambda x: -x.count)],
            "subscriptions": [{
                "id": s.id,
                "user_id": s.account_id,
                "user_email": users.get(s.account_id, "Unknown"),
                "pair": s.pair,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            } for s in subs],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()


# Static directories
ADMIN_DIR = os.path.join(os.path.dirname(__file__), "admin")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


@app.get("/admin")
async def admin_panel():
    """Serve admin panel HTML."""
    index_path = os.path.join(ADMIN_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="Admin panel not found")


# Mount static files for admin assets (CSS, JS)
if os.path.exists(ADMIN_DIR):
    app.mount("/admin/static", StaticFiles(directory=ADMIN_DIR), name="admin_static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

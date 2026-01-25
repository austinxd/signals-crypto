"""
Main entry point for the Crypto Signals System.
Provides both REST API and background signal monitoring.
"""
import time
import threading
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import (
    DEFAULT_PAIRS,
    AVAILABLE_PAIRS,
    AVAILABLE_TIMEFRAMES,
    DEFAULT_TIMEFRAME,
    POLL_INTERVAL,
)
from binance_client import get_binance_client
from indicators import add_all_indicators, get_latest_indicators
from signals import detect_signal, SignalHistory
from notifications import NotificationManager, send_test_notification
from database import init_db, get_db, DBHelper, TradingMode, Subscription


# Available trading modes
TRADING_MODES = ["conservative", "balanced", "aggressive"]


# Global state
signal_history = SignalHistory(use_db=True)  # Uses database for persistence
notification_manager = NotificationManager()
market_data: Dict[str, Dict[str, Dict[str, Any]]] = {}  # {timeframe: {pair: data}}
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


class NotificationHistory(BaseModel):
    token: str
    limit: Optional[int] = 50


def get_all_monitored_pairs() -> Set[str]:
    """Get all pairs that any user is monitoring (via subscriptions or legacy)."""
    pairs = set(DEFAULT_PAIRS)

    if notification_manager.use_db:
        try:
            db = get_db()
            # Get pairs from subscriptions
            subs = db.query(Subscription).filter(Subscription.enabled == True).all()
            for sub in subs:
                pairs.add(sub.pair)

            # Also check legacy user pairs
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
    """Get all timeframes that any user is monitoring (via subscriptions or legacy)."""
    # Monitor common timeframes by default (including short-term)
    default_monitored = {"15m", "30m", "1h", "4h", "1d"}
    timeframes = set(default_monitored)

    if notification_manager.use_db:
        try:
            db = get_db()
            # Get timeframes from subscriptions
            subs = db.query(Subscription).filter(Subscription.enabled == True).all()
            for sub in subs:
                if sub.timeframe in AVAILABLE_TIMEFRAMES:
                    timeframes.add(sub.timeframe)

            # Also check legacy user timeframes
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
    """Background task to monitor markets and detect signals."""
    global market_data, monitoring_active, active_pairs, active_timeframes

    client = get_binance_client()
    monitoring_active = True

    while monitoring_active:
        # Update active pairs and timeframes from registered users
        active_pairs = get_all_monitored_pairs()
        active_timeframes = get_all_monitored_timeframes()

        for timeframe in active_timeframes:
            if timeframe not in market_data:
                market_data[timeframe] = {}

            for pair in active_pairs:
                try:
                    # Fetch OHLCV data
                    df = client.fetch_ohlcv(pair, timeframe)
                    if df is None or len(df) < 200:
                        continue

                    # Calculate indicators
                    df = add_all_indicators(df)
                    indicators = get_latest_indicators(df)

                    if indicators is None:
                        continue

                    # Fetch funding rate (only once per pair, not per timeframe)
                    funding_data = None
                    if timeframe == list(active_timeframes)[0]:  # Only fetch once
                        funding_data = client.get_funding_rate(pair)

                    # Store market data for API
                    market_data[timeframe][pair] = {
                        "pair": pair,
                        "timeframe": timeframe,
                        "price": indicators["price"],
                        "indicators": indicators,
                        "funding": funding_data,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }

                    # Check for signals (always detect, let notification logic decide)
                    signal = detect_signal(pair, indicators, funding_data)
                    if signal:
                        signal.timeframe = timeframe
                        # Send to users monitoring this pair and timeframe
                        result = notification_manager.send_signal_to_subscribers(
                            signal, pair, timeframe
                        )
                        if result.get("status") not in ["skipped", "no_subscribers"]:
                            print(f"Signal: {signal.signal_type.value} {pair} ({timeframe}) - {signal.quality.value}")
                            print(f"Notification result: {result}")
                    else:
                        # No signal detected - check if we need to notify signal disappeared
                        result = notification_manager.notify_signal_disappeared(pair, timeframe)
                        if result.get("status") == "notified":
                            print(f"Signal disappeared: {pair} ({timeframe})")

                except Exception as e:
                    print(f"Error monitoring {pair} ({timeframe}): {e}")

        # Wait before next check
        for _ in range(POLL_INTERVAL):
            if not monitoring_active:
                break
            time.sleep(1)


# Lifespan management
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database
    try:
        init_db()
        print("Database initialized")
    except Exception as e:
        print(f"Database initialization failed (using JSON fallback): {e}")

    # Start background monitoring
    monitor_thread = threading.Thread(target=monitor_markets, daemon=True)
    monitor_thread.start()
    print("Signal monitoring started")
    yield
    # Cleanup
    global monitoring_active
    monitoring_active = False
    print("Signal monitoring stopped")


# FastAPI app
app = FastAPI(
    title="Crypto Signals API",
    description="API for crypto trading signals with push notifications",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# API Endpoints
@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "monitoring": monitoring_active,
        "database": notification_manager.use_db,
        "active_pairs": list(active_pairs),
        "active_timeframes": list(active_timeframes),
    }


@app.get("/api/config")
async def get_config():
    """Get available configuration options."""
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
    """Get current market data for all pairs in a timeframe."""
    global active_pairs

    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    # If refresh requested, fetch fresh data for all monitored pairs
    if refresh:
        # Update active_pairs immediately from database
        active_pairs = get_all_monitored_pairs()

        client = get_binance_client()
        if timeframe not in market_data:
            market_data[timeframe] = {}

        for pair in active_pairs:
            try:
                df = client.fetch_ohlcv(pair, timeframe)
                if df is None or len(df) < 200:
                    print(f"Skipping {pair}: insufficient data")
                    continue
                df = add_all_indicators(df)
                indicators = get_latest_indicators(df)
                funding_data = client.get_funding_rate(pair)
                if indicators:
                    market_data[timeframe][pair] = {
                        "pair": pair,
                        "timeframe": timeframe,
                        "price": indicators["price"],
                        "indicators": indicators,
                        "funding": funding_data,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    print(f"Refreshed {pair} ({timeframe})")
            except Exception as e:
                print(f"Error refreshing {pair}: {e}")

    data = market_data.get(timeframe, {})
    return {
        "timeframe": timeframe,
        "pairs": data,
        "active_pairs": list(active_pairs),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/market/{pair}")
async def get_pair_data(pair: str, timeframe: str = DEFAULT_TIMEFRAME):
    """Get market data for a specific pair."""
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    # Convert URL format to trading pair format
    pair_formatted = pair.replace("-", "/").upper()

    # Check cache first
    if timeframe in market_data and pair_formatted in market_data[timeframe]:
        return market_data[timeframe][pair_formatted]

    # Fetch fresh data
    client = get_binance_client()
    df = client.fetch_ohlcv(pair_formatted, timeframe)
    if df is None:
        raise HTTPException(status_code=404, detail=f"Pair {pair_formatted} not found")

    df = add_all_indicators(df)
    indicators = get_latest_indicators(df)

    return {
        "pair": pair_formatted,
        "timeframe": timeframe,
        "price": indicators["price"] if indicators else None,
        "indicators": indicators,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/signals")
async def get_signals(
    limit: int = 20,
    timeframe: Optional[str] = None,
    pair: Optional[str] = None,
    min_score: Optional[float] = None,
    token: Optional[str] = None,
):
    """Get recent signals with optional filters. If token provided, filter by user subscriptions."""
    signals = signal_history.get_recent_signals(limit * 5)  # Get more to filter

    # If token provided, filter by user's subscriptions and cleared_at
    user_pairs = set()
    user_timeframes = set()
    signals_cleared_at = None
    if token and notification_manager.use_db:
        try:
            db = get_db()
            user = DBHelper.get_user_by_token(db, token)
            if user:
                signals_cleared_at = user.signals_cleared_at
                # Get subscriptions for this user
                subs = db.query(Subscription).filter(
                    Subscription.user_id == user.id,
                    Subscription.enabled == True
                ).all()
                for sub in subs:
                    user_pairs.add(sub.pair)
                    user_timeframes.add(sub.timeframe)
            db.close()
        except Exception as e:
            print(f"Error getting user subscriptions for signals: {e}")

    # Apply filters
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

    # Filter by signals_cleared_at
    if signals_cleared_at:
        from dateutil.parser import parse as parse_date
        signals = [s for s in signals if parse_date(s.get("timestamp", "1970-01-01")) > signals_cleared_at]

    # Limit results
    signals = signals[:limit]

    return {
        "signals": signals,
        "total": len(signals),
        "filters": {
            "timeframe": timeframe,
            "pair": pair,
            "min_score": min_score,
            "user_filtered": bool(user_pairs),
        }
    }


@app.post("/api/register")
async def register_token(data: TokenRegistration):
    """Register a push token for notifications."""
    pairs = data.pairs or DEFAULT_PAIRS
    timeframe = data.timeframe or DEFAULT_TIMEFRAME
    trading_mode = data.trading_mode or "balanced"

    # Validate pairs
    invalid_pairs = [p for p in pairs if p not in AVAILABLE_PAIRS]
    if invalid_pairs:
        raise HTTPException(status_code=400, detail=f"Invalid pairs: {invalid_pairs}")

    # Validate timeframe
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    # Validate trading mode
    if trading_mode not in TRADING_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid trading mode: {trading_mode}")

    success = notification_manager.register_token(data.token, pairs, timeframe, trading_mode)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid push token")

    return {
        "status": "registered",
        "pairs": pairs,
        "timeframe": timeframe,
        "trading_mode": trading_mode,
    }


@app.post("/api/unregister")
async def unregister_token(data: TokenRegistration):
    """Unregister a push token."""
    success = notification_manager.unregister_token(data.token)
    return {"status": "unregistered" if success else "not_found"}


@app.post("/api/preferences")
async def update_preferences(data: PreferencesUpdate):
    """Update notification preferences (pairs, timeframe, and/or trading mode)."""
    # Validate pairs if provided
    if data.pairs:
        invalid_pairs = [p for p in data.pairs if p not in AVAILABLE_PAIRS]
        if invalid_pairs:
            raise HTTPException(status_code=400, detail=f"Invalid pairs: {invalid_pairs}")

    # Validate timeframe if provided
    if data.timeframe and data.timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {data.timeframe}")

    # Validate trading mode if provided
    if data.trading_mode and data.trading_mode not in TRADING_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid trading mode: {data.trading_mode}")

    success = notification_manager.update_preferences(
        data.token, data.pairs, data.timeframe, data.trading_mode
    )
    if not success:
        raise HTTPException(status_code=404, detail="Token not found. Register first.")

    # Get updated settings
    settings = notification_manager.get_user_settings(data.token)
    return {
        "status": "updated",
        "pairs": settings.get("pairs") if settings else None,
        "timeframe": settings.get("timeframe") if settings else None,
        "trading_mode": settings.get("trading_mode") if settings else None,
    }


@app.post("/api/settings")
async def get_user_settings(data: UserSettings):
    """Get current settings for a registered token."""
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
    """Send a test notification."""
    result = send_test_notification(data.token)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.get("/api/available-pairs")
async def get_available_pairs():
    """Get list of available trading pairs."""
    return {
        "pairs": AVAILABLE_PAIRS,
        "configurable": True,
    }


@app.get("/api/available-timeframes")
async def get_available_timeframes():
    """Get list of available timeframes."""
    return {
        "timeframes": list(AVAILABLE_TIMEFRAMES.keys()),
        "default": DEFAULT_TIMEFRAME,
    }


@app.get("/api/trading-modes")
async def get_trading_modes():
    """Get list of available trading modes with descriptions."""
    return {
        "modes": [
            {
                "id": "conservative",
                "name": "Conservador",
                "description": "Solo señales óptimas (score >= 2.5)",
                "min_score": 2.5,
            },
            {
                "id": "balanced",
                "name": "Balanceado",
                "description": "Señales buenas y óptimas (score >= 1.5)",
                "min_score": 1.5,
            },
            {
                "id": "aggressive",
                "name": "Agresivo",
                "description": "Todas las señales (incluyendo tempranas)",
                "min_score": 0,
            },
        ],
        "default": "balanced",
    }


@app.get("/api/subscribers")
async def get_subscribers():
    """Get list of registered subscribers (tokens masked for security)."""
    subscribers = notification_manager.get_all_subscribers()
    return {
        "total": len(subscribers),
        "subscribers": subscribers,
    }


# Subscription endpoints
@app.post("/api/subscriptions/add")
async def add_subscription(data: SubscriptionAdd):
    """Add a new subscription for a user."""
    # Validate pair
    if data.pair not in AVAILABLE_PAIRS:
        raise HTTPException(status_code=400, detail=f"Invalid pair: {data.pair}")

    # Validate timeframe
    if data.timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {data.timeframe}")

    # Validate trading mode
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
            "subscription": {
                "id": sub.id,
                "pair": sub.pair,
                "timeframe": sub.timeframe,
                "trading_mode": sub.trading_mode.value,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subscriptions/remove")
async def remove_subscription(data: SubscriptionRemove):
    """Remove a subscription."""
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
    """Get all subscriptions for a user."""
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
                {
                    "id": sub.id,
                    "pair": sub.pair,
                    "timeframe": sub.timeframe,
                    "trading_mode": sub.trading_mode.value,
                }
                for sub in subs
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notifications/history")
async def get_notification_history(data: NotificationHistory):
    """Get notification/signal history for a user based on their subscriptions."""
    try:
        db = get_db()
        user = DBHelper.get_user_by_token(db, data.token)
        if not user:
            db.close()
            raise HTTPException(status_code=404, detail="User not found")

        # Get user's subscriptions
        subs = DBHelper.get_user_subscriptions(db, user.id)
        if not subs:
            db.close()
            return {"notifications": [], "total": 0}

        # Build filter for signals matching user's subscriptions
        from sqlalchemy import or_, and_
        from database import Signal as SignalDB

        # Create conditions for each subscription
        conditions = []
        for sub in subs:
            conditions.append(
                and_(
                    SignalDB.pair == sub.pair,
                    SignalDB.timeframe == sub.timeframe
                )
            )

        # Build base query
        query = db.query(SignalDB).filter(or_(*conditions))

        # Filter by notifications_cleared_at if set
        if user.notifications_cleared_at:
            query = query.filter(SignalDB.created_at > user.notifications_cleared_at)

        # Query signals matching any subscription
        signals = query.order_by(SignalDB.created_at.desc()).limit(data.limit).all()

        db.close()

        # Format response
        notifications = []
        for sig in signals:
            # Determine quality emoji
            quality_emoji = "🔥" if sig.quality.value == "OPTIMA" else "🟠" if sig.quality.value == "BUENA" else "🔴"
            direction_emoji = "🟢" if sig.side == "LONG" else "🔴"

            pair_short = sig.pair.replace("/USDT", "")
            title = f"{quality_emoji} {pair_short} {sig.side} ({sig.timeframe})"

            tp_percent = abs((sig.take_profit - sig.entry_price) / sig.entry_price * 100)
            sl_percent = abs((sig.stop_loss - sig.entry_price) / sig.entry_price * 100)

            body = f"Entrada: ${sig.entry_price:,.2f}\nTP: +{tp_percent:.1f}% | SL: -{sl_percent:.1f}%"

            notifications.append({
                "id": sig.id,
                "title": title,
                "body": body,
                "pair": sig.pair,
                "timeframe": sig.timeframe,
                "side": sig.side,
                "quality": sig.quality.value,
                "score": sig.score,
                "entry_price": sig.entry_price,
                "take_profit": sig.take_profit,
                "stop_loss": sig.stop_loss,
                "receivedAt": sig.created_at.isoformat(),
            })

        return {
            "notifications": notifications,
            "total": len(notifications),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting notification history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ClearRequest(BaseModel):
    token: str


@app.post("/api/signals/clear")
async def clear_signals(data: ClearRequest):
    """Clear signal history for a user (hides signals before current time)."""
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
        print(f"Error clearing signals: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notifications/clear")
async def clear_notifications(data: ClearRequest):
    """Clear notification history for a user (hides notifications before current time)."""
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
        print(f"Error clearing notifications: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# For running directly
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

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
    SIGNAL_COOLDOWN,
)
from binance_client import get_binance_client
from indicators import add_all_indicators, get_latest_indicators
from signals import detect_signal, SignalHistory
from notifications import NotificationManager, send_test_notification


# Global state
signal_history = SignalHistory(cooldown_seconds=SIGNAL_COOLDOWN)
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


class PreferencesUpdate(BaseModel):
    token: str
    pairs: Optional[List[str]] = None
    timeframe: Optional[str] = None


class TestNotification(BaseModel):
    token: str


class UserSettings(BaseModel):
    token: str


def get_all_monitored_pairs() -> Set[str]:
    """Get all pairs that any user is monitoring."""
    pairs = set(DEFAULT_PAIRS)
    for settings in notification_manager.tokens.values():
        pairs.update(settings.get("pairs", []))
    return pairs


def get_all_monitored_timeframes() -> Set[str]:
    """Get all timeframes that any user is monitoring."""
    # Monitor common timeframes by default (including short-term)
    default_monitored = {"15m", "30m", "1h", "4h", "1d"}
    timeframes = set(default_monitored)
    # Also add any timeframes registered by users
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

                    # Store market data for API
                    market_data[timeframe][pair] = {
                        "pair": pair,
                        "timeframe": timeframe,
                        "price": indicators["price"],
                        "indicators": indicators,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }

                    # Check for signals
                    signal_key = f"{pair}_{timeframe}"
                    if signal_history.can_send_signal(signal_key):
                        signal = detect_signal(pair, indicators)
                        if signal:
                            signal.timeframe = timeframe
                            signal_history.add_signal(signal)
                            # Send to users monitoring this pair and timeframe
                            result = notification_manager.send_signal_to_subscribers(
                                signal, pair, timeframe
                            )
                            print(f"Signal: {signal.signal_type.value} {pair} ({timeframe})")
                            print(f"Notification result: {result}")

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
    version="1.0.0",
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
        "active_pairs": list(active_pairs),
        "active_timeframes": list(active_timeframes),
    }


@app.get("/api/config")
async def get_config():
    """Get available configuration options."""
    return {
        "available_pairs": AVAILABLE_PAIRS,
        "available_timeframes": list(AVAILABLE_TIMEFRAMES.keys()),
        "default_pairs": DEFAULT_PAIRS,
        "default_timeframe": DEFAULT_TIMEFRAME,
    }


@app.get("/api/market")
async def get_market_data(timeframe: str = DEFAULT_TIMEFRAME, refresh: bool = False):
    """Get current market data for all pairs in a timeframe."""
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    # If refresh requested, fetch fresh data for all active pairs
    if refresh:
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
                if indicators:
                    market_data[timeframe][pair] = {
                        "pair": pair,
                        "timeframe": timeframe,
                        "price": indicators["price"],
                        "indicators": indicators,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
            except Exception as e:
                print(f"Error refreshing {pair}: {e}")

    data = market_data.get(timeframe, {})
    return {
        "timeframe": timeframe,
        "pairs": data,
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
async def get_signals(limit: int = 20):
    """Get recent signals."""
    return {
        "signals": signal_history.get_recent_signals(limit),
        "total": len(signal_history.signals),
    }


@app.post("/api/register")
async def register_token(data: TokenRegistration):
    """Register a push token for notifications."""
    pairs = data.pairs or DEFAULT_PAIRS
    timeframe = data.timeframe or DEFAULT_TIMEFRAME

    # Validate pairs
    invalid_pairs = [p for p in pairs if p not in AVAILABLE_PAIRS]
    if invalid_pairs:
        raise HTTPException(status_code=400, detail=f"Invalid pairs: {invalid_pairs}")

    # Validate timeframe
    if timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    success = notification_manager.register_token(data.token, pairs, timeframe)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid push token")

    return {
        "status": "registered",
        "pairs": pairs,
        "timeframe": timeframe,
    }


@app.post("/api/unregister")
async def unregister_token(data: TokenRegistration):
    """Unregister a push token."""
    success = notification_manager.unregister_token(data.token)
    return {"status": "unregistered" if success else "not_found"}


@app.post("/api/preferences")
async def update_preferences(data: PreferencesUpdate):
    """Update notification preferences (pairs and/or timeframe)."""
    # Validate pairs if provided
    if data.pairs:
        invalid_pairs = [p for p in data.pairs if p not in AVAILABLE_PAIRS]
        if invalid_pairs:
            raise HTTPException(status_code=400, detail=f"Invalid pairs: {invalid_pairs}")

    # Validate timeframe if provided
    if data.timeframe and data.timeframe not in AVAILABLE_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {data.timeframe}")

    success = notification_manager.update_preferences(
        data.token, data.pairs, data.timeframe
    )
    if not success:
        raise HTTPException(status_code=404, detail="Token not found. Register first.")

    settings = notification_manager.tokens.get(data.token, {})
    return {
        "status": "updated",
        "pairs": settings.get("pairs"),
        "timeframe": settings.get("timeframe"),
    }


@app.post("/api/settings")
async def get_user_settings(data: UserSettings):
    """Get current settings for a registered token."""
    if data.token not in notification_manager.tokens:
        raise HTTPException(status_code=404, detail="Token not found")

    settings = notification_manager.tokens[data.token]
    return {
        "pairs": settings.get("pairs", DEFAULT_PAIRS),
        "timeframe": settings.get("timeframe", DEFAULT_TIMEFRAME),
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


# For running directly
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

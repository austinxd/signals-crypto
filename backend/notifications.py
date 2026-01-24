"""
Expo Push Notifications service with database integration.
"""
import requests
from typing import List, Dict, Any, Optional
import json

from config import EXPO_PUSH_URL
from signals import Signal, SignalType, SignalQuality
from database import (
    get_db, DBHelper, User, TradingMode,
    SignalQualityDB, migrate_tokens_from_json
)


# Quality-based emojis and labels
QUALITY_CONFIG = {
    SignalQuality.OPTIMA: {
        "emoji": "🔥",
        "label": "ÓPTIMO",
        "subtitle": "Alta confluencia técnica",
    },
    SignalQuality.BUENA: {
        "emoji": "🟡",
        "label": "",
        "subtitle": "Momentum detectado",
    },
    SignalQuality.TEMPRANA: {
        "emoji": "⚡",
        "label": "TEMPRANO",
        "subtitle": "Momentum iniciando",
    },
}


def signal_quality_to_db(quality: SignalQuality) -> SignalQualityDB:
    """Convert SignalQuality enum to database enum."""
    return SignalQualityDB[quality.name]


def format_notification(signal: Signal, reason: str = None) -> Dict[str, Any]:
    """
    Format a signal into a push notification payload.
    New format with quality labels.

    Args:
        signal: Signal object
        reason: Why notification is being sent (state change reason)

    Returns:
        Dict with notification data
    """
    # Get quality config
    quality_info = QUALITY_CONFIG.get(signal.quality, QUALITY_CONFIG[SignalQuality.TEMPRANA])

    # Direction emoji
    direction_emoji = "🟢" if signal.signal_type == SignalType.LONG else "🔴"

    # Build title based on quality
    pair_short = signal.pair.replace("/USDT", "")

    if signal.quality == SignalQuality.OPTIMA:
        title = f"{quality_info['emoji']} {pair_short} {signal.signal_type.value} {quality_info['label']} ({signal.timeframe})"
    else:
        title = f"{quality_info['emoji']} {pair_short} {signal.signal_type.value} ({signal.timeframe})"

    # Calculate percentages
    tp_percent = abs((signal.take_profit - signal.entry_price) / signal.entry_price * 100)
    sl_percent = abs((signal.stop_loss - signal.entry_price) / signal.entry_price * 100)

    # Build body
    lines = [
        quality_info['subtitle'],
        f"Calidad: {signal.quality.value} ({signal.score:.1f} pts)",
        f"Entrada: ${signal.entry_price:,.2f}",
        f"TP: ${signal.take_profit:,.2f} (+{tp_percent:.1f}%)",
        f"SL: ${signal.stop_loss:,.2f} (-{sl_percent:.1f}%)",
    ]

    # Add reason for notification if quality improved
    if reason == "quality_improved":
        lines.insert(0, "⬆️ Calidad mejorada")
    elif reason == "side_changed":
        lines.insert(0, "🔄 Cambio de dirección")

    # Add warnings if any
    if signal.warnings:
        lines.append(signal.warnings[0])

    body = "\n".join(lines)

    return {
        "title": title,
        "body": body,
        "data": signal.to_dict(),
    }


def send_push_notification(
    push_tokens: List[str],
    signal: Signal,
    reason: str = None,
) -> Dict[str, Any]:
    """
    Send push notification to multiple Expo push tokens.

    Args:
        push_tokens: List of Expo push tokens
        signal: Signal to send
        reason: Reason for notification

    Returns:
        Response data from Expo
    """
    if not push_tokens:
        return {"status": "error", "message": "No push tokens provided"}

    notification = format_notification(signal, reason)

    messages = []
    for token in push_tokens:
        if not token.startswith("ExponentPushToken"):
            continue
        messages.append({
            "to": token,
            "sound": "default",
            "title": notification["title"],
            "body": notification["body"],
            "data": notification["data"],
            "priority": "high",
            "channelId": "signals",
        })

    if not messages:
        return {"status": "error", "message": "No valid push tokens"}

    try:
        response = requests.post(
            EXPO_PUSH_URL,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=messages,
            timeout=10,
        )
        response.raise_for_status()
        return {"status": "success", "data": response.json()}
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": str(e)}


def send_test_notification(push_token: str) -> Dict[str, Any]:
    """
    Send a test notification to verify the setup.

    Args:
        push_token: Expo push token

    Returns:
        Response data
    """
    if not push_token or not push_token.startswith("ExponentPushToken"):
        return {"status": "error", "message": "Invalid push token"}

    try:
        response = requests.post(
            EXPO_PUSH_URL,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=[{
                "to": push_token,
                "sound": "default",
                "title": "✅ Notificaciones Activas",
                "body": "Las señales de trading llegarán aquí",
                "data": {"test": True},
                "priority": "high",
                "channelId": "signals",
            }],
            timeout=10,
        )
        response.raise_for_status()
        return {"status": "success", "data": response.json()}
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": str(e)}


class NotificationManager:
    """
    Manages push notifications with database integration.
    Implements state-based alerts to avoid duplicates.
    """

    def __init__(self, use_db: bool = True):
        """
        Initialize notification manager.

        Args:
            use_db: Whether to use database (set False for fallback to JSON)
        """
        self.use_db = use_db
        self.tokens: Dict[str, Dict[str, Any]] = {}  # Fallback cache

        if use_db:
            try:
                # Test database connection
                db = get_db()
                db.close()
                print("NotificationManager: Using MySQL database")

                # Migrate existing tokens if any
                db = get_db()
                migrate_tokens_from_json(db)
                db.close()
            except Exception as e:
                print(f"Database connection failed, falling back to JSON: {e}")
                self.use_db = False
                self._load_tokens_json()
        else:
            self._load_tokens_json()

    def _load_tokens_json(self):
        """Load tokens from JSON file (fallback)."""
        try:
            with open("tokens.json", "r") as f:
                self.tokens = json.load(f)
                print(f"Loaded {len(self.tokens)} tokens from tokens.json")
        except FileNotFoundError:
            self.tokens = {}
        except json.JSONDecodeError:
            self.tokens = {}

    def _save_tokens_json(self):
        """Save tokens to JSON file (fallback)."""
        try:
            with open("tokens.json", "w") as f:
                json.dump(self.tokens, f, indent=2)
        except Exception as e:
            print(f"Error saving tokens: {e}")

    def register_token(
        self,
        token: str,
        pairs: Optional[List[str]] = None,
        timeframe: Optional[str] = None,
        trading_mode: str = "balanced",
    ) -> bool:
        """Register a push token with preferences."""
        if not token or not token.startswith("ExponentPushToken"):
            return False

        if self.use_db:
            try:
                db = get_db()
                mode = TradingMode(trading_mode) if trading_mode else TradingMode.BALANCED
                DBHelper.create_or_update_user(db, token, pairs, timeframe, mode)
                db.close()
                return True
            except Exception as e:
                print(f"DB error registering token: {e}")
                return False
        else:
            self.tokens[token] = {
                "pairs": pairs or ["BTC/USDT", "ETH/USDT"],
                "timeframe": timeframe or "4h",
                "trading_mode": trading_mode or "balanced",
                "enabled": True,
            }
            self._save_tokens_json()
            return True

    def unregister_token(self, token: str) -> bool:
        """Remove a push token."""
        if self.use_db:
            try:
                db = get_db()
                result = DBHelper.delete_user(db, token)
                db.close()
                return result
            except Exception as e:
                print(f"DB error unregistering token: {e}")
                return False
        else:
            if token in self.tokens:
                del self.tokens[token]
                self._save_tokens_json()
                return True
            return False

    def update_preferences(
        self,
        token: str,
        pairs: Optional[List[str]] = None,
        timeframe: Optional[str] = None,
        trading_mode: Optional[str] = None,
    ) -> bool:
        """Update preferences for a token."""
        if self.use_db:
            try:
                db = get_db()
                user = DBHelper.get_user_by_token(db, token)
                if not user:
                    db.close()
                    return False
                mode = TradingMode(trading_mode) if trading_mode else None
                DBHelper.create_or_update_user(db, token, pairs, timeframe, mode)
                db.close()
                return True
            except Exception as e:
                print(f"DB error updating preferences: {e}")
                return False
        else:
            if token not in self.tokens:
                return False
            if pairs is not None:
                self.tokens[token]["pairs"] = pairs
            if timeframe is not None:
                self.tokens[token]["timeframe"] = timeframe
            if trading_mode is not None:
                self.tokens[token]["trading_mode"] = trading_mode
            self._save_tokens_json()
            return True

    def get_user_settings(self, token: str) -> Optional[Dict[str, Any]]:
        """Get settings for a user."""
        if self.use_db:
            try:
                db = get_db()
                user = DBHelper.get_user_by_token(db, token)
                db.close()
                if user:
                    return {
                        "pairs": user.pairs,
                        "timeframe": user.timeframe,
                        "trading_mode": user.trading_mode.value,
                        "enabled": user.enabled,
                    }
                return None
            except Exception as e:
                print(f"DB error getting settings: {e}")
                return None
        else:
            return self.tokens.get(token)

    def send_signal_to_subscribers(
        self,
        signal: Signal,
        pair: str,
        timeframe: str,
    ) -> Dict[str, Any]:
        """
        Send signal to subscribers with state-based duplicate prevention.
        Only notifies on state CHANGE (new signal, quality improved, side changed).
        """
        quality_db = signal_quality_to_db(signal.quality)

        if self.use_db:
            try:
                db = get_db()

                # Check if we should notify (state change detection)
                should_notify, reason = DBHelper.should_notify(
                    db, pair, timeframe,
                    signal.signal_type.value,
                    quality_db,
                    signal.score
                )

                if not should_notify:
                    db.close()
                    return {
                        "status": "skipped",
                        "reason": reason,
                        "pair": pair,
                        "timeframe": timeframe,
                    }

                # Get users who should receive this signal
                users = DBHelper.get_users_for_signal(
                    db, pair, timeframe, quality_db, signal.score
                )

                if not users:
                    db.close()
                    return {
                        "status": "no_subscribers",
                        "pair": pair,
                        "timeframe": timeframe,
                    }

                # Save signal to database
                signal_data = {
                    "pair": pair,
                    "timeframe": timeframe,
                    "side": signal.signal_type.value,
                    "quality": quality_db,
                    "score": signal.score,
                    "score_details": signal.score_details,
                    "warnings": signal.warnings,
                    "entry_price": signal.entry_price,
                    "take_profit": signal.take_profit,
                    "stop_loss": signal.stop_loss,
                    "indicators": signal.to_dict().get("indicators"),
                    "funding_info": signal.to_dict().get("funding"),
                    "fibonacci_info": signal.to_dict().get("fibonacci"),
                }
                saved_signal = DBHelper.save_signal(db, signal_data)

                # Update alert state
                DBHelper.update_alert_state(
                    db, pair, timeframe,
                    signal.signal_type.value,
                    quality_db,
                    signal.score,
                    saved_signal.id
                )

                db.close()

                # Send notifications
                tokens = [u.push_token for u in users]
                return send_push_notification(tokens, signal, reason)

            except Exception as e:
                print(f"DB error sending signal: {e}")
                # Fallback to simple send
                return self._send_signal_simple(signal, pair, timeframe)
        else:
            return self._send_signal_simple(signal, pair, timeframe)

    def _send_signal_simple(
        self,
        signal: Signal,
        pair: str,
        timeframe: str,
    ) -> Dict[str, Any]:
        """Simple signal send without state tracking (fallback)."""
        tokens = [
            token for token, settings in self.tokens.items()
            if (
                settings.get("enabled", True)
                and pair in settings.get("pairs", [])
                and settings.get("timeframe") == timeframe
            )
        ]

        if not tokens:
            return {
                "status": "no_subscribers",
                "pair": pair,
                "timeframe": timeframe,
            }

        return send_push_notification(tokens, signal)

    def get_all_subscribers(self) -> List[Dict[str, Any]]:
        """Get all subscribers (for admin endpoint)."""
        if self.use_db:
            try:
                db = get_db()
                users = DBHelper.get_all_users(db)
                db.close()
                return [
                    {
                        "token_masked": u.push_token[:20] + "..." + u.push_token[-5:],
                        "pairs": u.pairs,
                        "timeframe": u.timeframe,
                        "trading_mode": u.trading_mode.value,
                        "enabled": u.enabled,
                    }
                    for u in users
                ]
            except Exception as e:
                print(f"DB error getting subscribers: {e}")
                return []
        else:
            return [
                {
                    "token_masked": token[:20] + "..." + token[-5:],
                    "pairs": settings.get("pairs", []),
                    "timeframe": settings.get("timeframe", "4h"),
                    "trading_mode": settings.get("trading_mode", "balanced"),
                    "enabled": settings.get("enabled", True),
                }
                for token, settings in self.tokens.items()
            ]

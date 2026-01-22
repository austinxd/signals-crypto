"""
Expo Push Notifications service.
"""
import requests
from typing import List, Dict, Any, Optional
import json

from config import EXPO_PUSH_URL
from signals import Signal, SignalType


def format_notification(signal: Signal) -> Dict[str, Any]:
    """
    Format a signal into a push notification payload.

    Args:
        signal: Signal object

    Returns:
        Dict with notification data
    """
    emoji = "🟢" if signal.signal_type == SignalType.LONG else "🔴"
    title = f"{emoji} {signal.signal_type.value} {signal.pair}"
    body = f"Entrada: ${signal.entry_price:,.2f} | TP: ${signal.take_profit:,.2f} | SL: ${signal.stop_loss:,.2f}"

    return {
        "title": title,
        "body": body,
        "data": signal.to_dict(),
    }


def send_push_notification(
    push_tokens: List[str],
    signal: Signal,
) -> Dict[str, Any]:
    """
    Send push notification to multiple Expo push tokens.

    Args:
        push_tokens: List of Expo push tokens
        signal: Signal to send

    Returns:
        Response data from Expo
    """
    if not push_tokens:
        return {"status": "error", "message": "No push tokens provided"}

    notification = format_notification(signal)

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
    """Manages push tokens and sending notifications with file persistence."""

    TOKENS_FILE = "tokens.json"

    def __init__(self):
        self.tokens: Dict[str, Dict[str, Any]] = {}  # token -> user settings
        self._load_tokens()

    def _load_tokens(self):
        """Load tokens from file on startup."""
        try:
            with open(self.TOKENS_FILE, "r") as f:
                self.tokens = json.load(f)
                print(f"Loaded {len(self.tokens)} tokens from {self.TOKENS_FILE}")
        except FileNotFoundError:
            self.tokens = {}
            print("No tokens file found, starting fresh")
        except json.JSONDecodeError:
            self.tokens = {}
            print("Invalid tokens file, starting fresh")

    def _save_tokens(self):
        """Save tokens to file."""
        try:
            with open(self.TOKENS_FILE, "w") as f:
                json.dump(self.tokens, f, indent=2)
        except Exception as e:
            print(f"Error saving tokens: {e}")

    def register_token(
        self,
        token: str,
        pairs: Optional[List[str]] = None,
        timeframe: Optional[str] = None,
    ) -> bool:
        """Register a push token with pair and timeframe preferences."""
        if not token or not token.startswith("ExponentPushToken"):
            return False

        self.tokens[token] = {
            "pairs": pairs or ["BTC/USDT", "ETH/USDT"],
            "timeframe": timeframe or "4h",
            "enabled": True,
        }
        self._save_tokens()
        return True

    def unregister_token(self, token: str) -> bool:
        """Remove a push token."""
        if token in self.tokens:
            del self.tokens[token]
            self._save_tokens()
            return True
        return False

    def update_preferences(
        self,
        token: str,
        pairs: Optional[List[str]] = None,
        timeframe: Optional[str] = None,
    ) -> bool:
        """Update preferences (pairs and/or timeframe) for a token."""
        if token not in self.tokens:
            return False

        if pairs is not None:
            self.tokens[token]["pairs"] = pairs
        if timeframe is not None:
            self.tokens[token]["timeframe"] = timeframe
        self._save_tokens()
        return True

    def get_tokens_for_pair(self, pair: str) -> List[str]:
        """Get all tokens that want notifications for a specific pair."""
        return [
            token for token, settings in self.tokens.items()
            if settings.get("enabled") and pair in settings.get("pairs", [])
        ]

    def get_tokens_for_pair_and_timeframe(self, pair: str, timeframe: str) -> List[str]:
        """Get tokens subscribed to a specific pair AND timeframe."""
        return [
            token for token, settings in self.tokens.items()
            if (
                settings.get("enabled")
                and pair in settings.get("pairs", [])
                and settings.get("timeframe") == timeframe
            )
        ]

    def send_signal(self, signal: Signal) -> Dict[str, Any]:
        """Send signal to all subscribed tokens (legacy, uses pair only)."""
        tokens = self.get_tokens_for_pair(signal.pair)
        if not tokens:
            return {"status": "no_subscribers", "pair": signal.pair}
        return send_push_notification(tokens, signal)

    def send_signal_to_subscribers(
        self, signal: Signal, pair: str, timeframe: str
    ) -> Dict[str, Any]:
        """Send signal to tokens subscribed to this pair and timeframe."""
        tokens = self.get_tokens_for_pair_and_timeframe(pair, timeframe)
        if not tokens:
            return {
                "status": "no_subscribers",
                "pair": pair,
                "timeframe": timeframe,
            }
        return send_push_notification(tokens, signal)

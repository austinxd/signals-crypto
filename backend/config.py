"""
Configuration for the Crypto Signals System.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Default trading pairs to monitor
DEFAULT_PAIRS = ["BTC/USDT", "ETH/USDT"]

# All available pairs users can choose from
AVAILABLE_PAIRS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT",
    "XRP/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT",
    "DOT/USDT", "MATIC/USDT", "LINK/USDT", "UNI/USDT",
    "ATOM/USDT", "LTC/USDT", "ETC/USDT", "FIL/USDT",
]

# Available timeframes
AVAILABLE_TIMEFRAMES = {
    "15m": 15 * 60,
    "30m": 30 * 60,
    "1h": 60 * 60,
    "2h": 2 * 60 * 60,
    "4h": 4 * 60 * 60,
    "6h": 6 * 60 * 60,
    "12h": 12 * 60 * 60,
    "1d": 24 * 60 * 60,
}

# Default timeframe for analysis
DEFAULT_TIMEFRAME = "4h"

# Number of candles to fetch for indicator calculation
CANDLES_LIMIT = 250  # Enough for EMA 200

# Technical indicator parameters
EMA_PERIOD = 200
RSI_PERIOD = 14
RSI_OVERSOLD = 40  # For LONG signals
RSI_OVERBOUGHT = 60  # For SHORT signals
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9
VOLUME_MA_PERIOD = 20

# Risk management
STOP_LOSS_PERCENT = 1.5  # 1.5% stop loss
TAKE_PROFIT_PERCENT = 3.0  # 3% take profit (1:2 risk/reward ratio)

# Expo Push Notification
EXPO_PUSH_TOKEN = os.getenv("EXPO_PUSH_TOKEN", "")
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Binance API (optional - for faster data)
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "")

# Polling interval (seconds) - check every 5 minutes
POLL_INTERVAL = 300

# Cooldown between signals for the same pair (seconds) - 4 hours
SIGNAL_COOLDOWN = 4 * 60 * 60

# Position monitoring interval (seconds)
POSITION_POLL_INTERVAL = 15

# Trailing stop ATR multiplier
TRAILING_STOP_ATR_MULTIPLIER = 1.0

# Encryption key for Fernet (Binance API keys)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")

# JWT Secret
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-super-secret-key")

# RevenueCat Webhook Authorization
# Set this to match the Authorization header configured in RevenueCat dashboard
REVENUECAT_WEBHOOK_SECRET = os.getenv("REVENUECAT_WEBHOOK_SECRET", "")

"""
Binance Futures API client using CCXT library.
"""
import ccxt
import pandas as pd
from datetime import datetime
from typing import Optional

from config import (
    BINANCE_API_KEY,
    BINANCE_API_SECRET,
    DEFAULT_TIMEFRAME,
    CANDLES_LIMIT,
)


class BinanceClient:
    """Client for fetching data from Binance Futures."""

    def __init__(self):
        """Initialize the Binance Futures client."""
        config = {
            "enableRateLimit": True,
            "options": {
                "defaultType": "future",  # USDT-margined futures
                "adjustForTimeDifference": True,
            },
        }

        if BINANCE_API_KEY and BINANCE_API_SECRET:
            config["apiKey"] = BINANCE_API_KEY
            config["secret"] = BINANCE_API_SECRET

        self.exchange = ccxt.binance(config)

    def fetch_ohlcv(
        self, symbol: str, timeframe: str = DEFAULT_TIMEFRAME, limit: int = CANDLES_LIMIT
    ) -> Optional[pd.DataFrame]:
        """
        Fetch OHLCV (candlestick) data for a symbol.

        Args:
            symbol: Trading pair (e.g., 'BTC/USDT')
            timeframe: Candle timeframe (e.g., '4h')
            limit: Number of candles to fetch

        Returns:
            DataFrame with columns: timestamp, open, high, low, close, volume
        """
        try:
            ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)

            df = pd.DataFrame(
                ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"]
            )

            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
            df.set_index("timestamp", inplace=True)

            return df

        except ccxt.NetworkError as e:
            print(f"Network error fetching {symbol}: {e}")
            return None
        except ccxt.ExchangeError as e:
            print(f"Exchange error fetching {symbol}: {e}")
            return None
        except Exception as e:
            print(f"Unexpected error fetching {symbol}: {e}")
            return None

    def get_current_price(self, symbol: str) -> Optional[float]:
        """
        Get the current price for a symbol.

        Args:
            symbol: Trading pair (e.g., 'BTC/USDT')

        Returns:
            Current price as float
        """
        try:
            ticker = self.exchange.fetch_ticker(symbol)
            return ticker["last"]
        except Exception as e:
            print(f"Error fetching price for {symbol}: {e}")
            return None


# Singleton instance
_client: Optional[BinanceClient] = None


def get_binance_client() -> BinanceClient:
    """Get or create the Binance client singleton."""
    global _client
    if _client is None:
        _client = BinanceClient()
    return _client

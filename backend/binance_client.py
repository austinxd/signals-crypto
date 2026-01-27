"""
Binance Futures API client using CCXT library.
Supports both global client (for market data) and per-user clients (for position management).
"""
import ccxt
import pandas as pd
from datetime import datetime
from typing import Optional, List, Dict, Any

from config import (
    BINANCE_API_KEY,
    BINANCE_API_SECRET,
    DEFAULT_TIMEFRAME,
    CANDLES_LIMIT,
)


class BinanceClient:
    """Client for fetching data from Binance Futures."""

    def __init__(self, api_key: str = None, api_secret: str = None):
        """Initialize the Binance Futures client."""
        config = {
            "enableRateLimit": True,
            "options": {
                "defaultType": "future",
                "adjustForTimeDifference": True,
            },
        }

        key = api_key or BINANCE_API_KEY
        secret = api_secret or BINANCE_API_SECRET
        if key and secret:
            config["apiKey"] = key
            config["secret"] = secret

        self.exchange = ccxt.binance(config)

    def fetch_ohlcv(
        self, symbol: str, timeframe: str = DEFAULT_TIMEFRAME, limit: int = CANDLES_LIMIT
    ) -> Optional[pd.DataFrame]:
        """Fetch OHLCV (candlestick) data for a symbol."""
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
        """Get the current price for a symbol."""
        try:
            ticker = self.exchange.fetch_ticker(symbol)
            return ticker["last"]
        except Exception as e:
            print(f"Error fetching price for {symbol}: {e}")
            return None

    def get_funding_rate(self, symbol: str) -> Optional[dict]:
        """Get the current funding rate for a futures symbol."""
        try:
            funding = self.exchange.fetch_funding_rate(symbol)
            rate = funding.get("fundingRate", 0)

            if rate > 0.0005:
                sentiment = "too_many_longs"
                recommendation = "SHORT favorable"
            elif rate < -0.0005:
                sentiment = "too_many_shorts"
                recommendation = "LONG favorable"
            elif rate > 0.0001:
                sentiment = "slightly_long"
                recommendation = "Neutral - leve sesgo alcista"
            elif rate < -0.0001:
                sentiment = "slightly_short"
                recommendation = "Neutral - leve sesgo bajista"
            else:
                sentiment = "balanced"
                recommendation = "Mercado equilibrado"

            return {
                "funding_rate": rate,
                "funding_rate_percent": rate * 100,
                "sentiment": sentiment,
                "recommendation": recommendation,
                "next_funding_time": funding.get("fundingTimestamp"),
            }
        except Exception as e:
            print(f"Error fetching funding rate for {symbol}: {e}")
            return None

    def fetch_futures_positions(self) -> List[Dict[str, Any]]:
        """Fetch open futures positions (requires authenticated client)."""
        import logging
        logger = logging.getLogger("uvicorn.error")
        try:
            positions = self.exchange.fetch_positions()
            logger.info(f"[POSITIONS] Raw positions count: {len(positions)}")

            open_positions = []
            for pos in positions:
                # Log first few for debugging
                if len(open_positions) == 0 and positions.index(pos) < 3:
                    logger.info(f"[POSITIONS] Sample position: contracts={pos.get('contracts')}, side={pos.get('side')}, symbol={pos.get('symbol')}, entryPrice={pos.get('entryPrice')}, info_keys={list(pos.get('info', {}).keys())[:10]}")

                contracts = float(pos.get("contracts") or 0)
                if contracts == 0:
                    # Also check positionAmt from info
                    info = pos.get("info", {})
                    position_amt = float(info.get("positionAmt", 0))
                    if position_amt == 0:
                        continue
                    contracts = abs(position_amt)

                side = (pos.get("side") or "").upper()
                if side not in ("LONG", "SHORT"):
                    notional = float(pos.get("notional") or 0)
                    info = pos.get("info", {})
                    position_amt = float(info.get("positionAmt", 0))
                    side = "LONG" if (notional > 0 or position_amt > 0) else "SHORT"

                entry_price = float(pos.get("entryPrice") or pos.get("info", {}).get("entryPrice", 0))
                mark_price = float(pos.get("markPrice") or pos.get("info", {}).get("markPrice", 0))
                unrealized_pnl = float(pos.get("unrealizedPnl") or pos.get("info", {}).get("unRealizedProfit", 0))
                info = pos.get("info", {})
                leverage_raw = pos.get("leverage") or info.get("leverage", 1)
                leverage = int(float(leverage_raw))
                logger.info(f"[POSITIONS] {pos.get('symbol')} leverage: ccxt={pos.get('leverage')}, info={info.get('leverage')}, resolved={leverage}")

                logger.info(f"[POSITIONS] Open: {pos.get('symbol')} {side} contracts={contracts} entry={entry_price}")

                open_positions.append({
                    "symbol": pos.get("symbol"),
                    "side": side,
                    "entry_price": entry_price,
                    "amount": abs(contracts),
                    "leverage": leverage,
                    "unrealized_pnl": unrealized_pnl,
                    "current_price": mark_price,
                    "liquidation_price": float(pos.get("liquidationPrice") or 0),
                })

            logger.info(f"[POSITIONS] Found {len(open_positions)} open positions")
            return open_positions
        except Exception as e:
            logger.error(f"[POSITIONS] Error fetching futures positions: {e}", exc_info=True)
            return []

    def modify_stop_loss(
        self, symbol: str, side: str, new_sl_price: float, amount: float
    ) -> Optional[Dict[str, Any]]:
        """
        Modify stop loss for a position by placing a stop market order.
        Cancels existing SL orders and places a new one.
        """
        try:
            # Cancel existing stop orders for this symbol
            open_orders = self.exchange.fetch_open_orders(symbol)
            for order in open_orders:
                if order.get("type") in ("stop", "stop_market", "STOP_MARKET"):
                    try:
                        self.exchange.cancel_order(order["id"], symbol)
                    except Exception:
                        pass

            # Place new stop market order
            sl_side = "sell" if side == "LONG" else "buy"
            order = self.exchange.create_order(
                symbol=symbol,
                type="STOP_MARKET",
                side=sl_side,
                amount=amount,
                params={
                    "stopPrice": new_sl_price,
                    "closePosition": True,
                    "reduceOnly": True,
                },
            )
            return order
        except Exception as e:
            print(f"Error modifying stop loss for {symbol}: {e}")
            return None


def create_user_client(api_key: str, api_secret: str) -> BinanceClient:
    """Create a CCXT instance with user-specific API keys."""
    return BinanceClient(api_key=api_key, api_secret=api_secret)


# Singleton instance for global market data
_client: Optional[BinanceClient] = None


def get_binance_client() -> BinanceClient:
    """Get or create the Binance client singleton."""
    global _client
    if _client is None:
        _client = BinanceClient()
    return _client

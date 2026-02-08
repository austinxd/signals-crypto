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
            # First, get the configured leverage for each symbol
            leverage_config = {}
            try:
                leverages = self.exchange.fetch_leverages()
                for symbol, lev_data in leverages.items():
                    if lev_data and isinstance(lev_data, dict):
                        # Store the full leverage data (longLeverage, shortLeverage)
                        leverage_config[symbol] = {
                            "longLeverage": lev_data.get("longLeverage"),
                            "shortLeverage": lev_data.get("shortLeverage"),
                        }
                logger.info(f"[POSITIONS] Fetched leverage config for {len(leverage_config)} symbols")
            except Exception as e:
                logger.warning(f"[POSITIONS] Could not fetch leverages: {e}")

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

                # Get leverage from configured leverage first, then fallback to position data
                symbol = pos.get("symbol")
                leverage_data = leverage_config.get(symbol, {})
                # Use longLeverage or shortLeverage based on position side
                if isinstance(leverage_data, dict):
                    if side == "LONG":
                        leverage_from_config = leverage_data.get("longLeverage")
                    else:
                        leverage_from_config = leverage_data.get("shortLeverage") or leverage_data.get("longLeverage")
                else:
                    leverage_from_config = leverage_data if leverage_data else None

                leverage_from_pos = pos.get("leverage") or info.get("leverage")

                if leverage_from_config:
                    leverage = int(float(leverage_from_config))
                elif leverage_from_pos:
                    leverage = int(float(leverage_from_pos))
                else:
                    leverage = 1

                logger.info(f"[POSITIONS] {symbol} leverage: config={leverage_from_config}, pos={leverage_from_pos}, info={info.get('leverage')}, resolved={leverage}")

                logger.info(f"[POSITIONS] Open: {pos.get('symbol')} {side} contracts={contracts} entry={entry_price}")

                notional = abs(float(pos.get("notional") or info.get("notional", 0)))
                initial_margin = float(pos.get("initialMargin") or info.get("initialMargin") or info.get("isolatedMargin", 0))
                if initial_margin == 0 and notional > 0 and leverage > 0:
                    initial_margin = notional / leverage

                open_positions.append({
                    "symbol": pos.get("symbol"),
                    "side": side,
                    "entry_price": entry_price,
                    "amount": abs(contracts),
                    "leverage": leverage,
                    "notional": notional,
                    "initial_margin": initial_margin,
                    "unrealized_pnl": unrealized_pnl,
                    "current_price": mark_price,
                    "liquidation_price": float(pos.get("liquidationPrice") or 0),
                })

            logger.info(f"[POSITIONS] Found {len(open_positions)} open positions")
            return open_positions
        except Exception as e:
            logger.error(f"[POSITIONS] Error fetching futures positions: {e}", exc_info=True)
            return []

    def fetch_recent_trades(
        self, symbol: str, limit: int = 1000
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch recent executed trades for volume analysis.
        Returns list of trades with price, amount, side, timestamp.
        """
        try:
            trades = self.exchange.fetch_trades(symbol, limit=limit)
            return [
                {
                    "price": float(t["price"]),
                    "amount": float(t["amount"]),
                    "side": t["side"],  # 'buy' or 'sell'
                    "timestamp": t["timestamp"],
                }
                for t in trades
            ]
        except Exception as e:
            print(f"Error fetching trades for {symbol}: {e}")
            return None

    def fetch_aggregated_trades(
        self, symbol: str, start_time: int = None, limit: int = 1000
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch aggregated trades from Binance.
        Aggregated trades combine trades at the same price within a time window.
        """
        try:
            params = {}
            if start_time:
                params["startTime"] = start_time

            # Use ccxt's fetch_trades which returns aggregated trades on Binance futures
            trades = self.exchange.fetch_trades(symbol, limit=limit, params=params)
            return [
                {
                    "price": float(t["price"]),
                    "amount": float(t["amount"]),
                    "side": t["side"],
                    "timestamp": t["timestamp"],
                }
                for t in trades
            ]
        except Exception as e:
            print(f"Error fetching aggregated trades for {symbol}: {e}")
            return None

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

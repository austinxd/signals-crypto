"""
Database configuration and models using SQLAlchemy.
"""
import os
from datetime import datetime, timedelta
from typing import Optional
from enum import Enum as PyEnum

from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, JSON, Enum, Text, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from dotenv import load_dotenv
from cryptography.fernet import Fernet

load_dotenv()

# Database configuration from environment
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "backend_crypto")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Encryption key for Binance API keys
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
_fernet = None


def get_fernet():
    """Get Fernet cipher for encrypting/decrypting API keys."""
    global _fernet
    if _fernet is None:
        if ENCRYPTION_KEY:
            _fernet = Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)
        else:
            # Generate a key if not set (not recommended for production)
            key = Fernet.generate_key()
            _fernet = Fernet(key)
            print("WARNING: No ENCRYPTION_KEY set. Generated temporary key. API keys will not persist across restarts.")
    return _fernet


def encrypt_value(value: str) -> str:
    """Encrypt a string value."""
    if not value:
        return ""
    return get_fernet().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    """Decrypt an encrypted string value."""
    if not value:
        return ""
    try:
        return get_fernet().decrypt(value.encode()).decode()
    except Exception:
        return ""


# Create engine
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


class TradingMode(PyEnum):
    """User trading mode preferences."""
    CONSERVATIVE = "conservative"  # score >= 2.5
    BALANCED = "balanced"          # score >= 1.5
    AGGRESSIVE = "aggressive"      # any base signal


class OperationMode(PyEnum):
    """User operation mode: bot vs recommendations."""
    RECOMMENDATIONS = "recommendations"
    BOT = "bot"


class SignalQualityDB(PyEnum):
    """Signal quality levels."""
    TEMPRANA = "TEMPRANA"
    BUENA = "BUENA"
    OPTIMA = "OPTIMA"


class ExitAlertType(PyEnum):
    """Exit alert types."""
    TRAILING_BREAKEVEN = "TRAILING_BREAKEVEN"
    TRAILING_UPDATE = "TRAILING_UPDATE"
    MACD_REVERSAL = "MACD_REVERSAL"
    RSI_EXTREME = "RSI_EXTREME"
    RSI_DIVERGENCE = "RSI_DIVERGENCE"


class RecommendedAction(PyEnum):
    """Recommended action for exit alerts."""
    MOVE_SL = "MOVE_SL"
    CLOSE_50 = "CLOSE_50%"
    CLOSE_ALL = "CLOSE_ALL"


class NotificationType(PyEnum):
    """Types of notifications."""
    # Context alerts (market)
    HTF_BIAS_CHANGED = "htf_bias_changed"
    SCENARIO_CHANGED = "scenario_changed"
    VOLATILITY_CHANGED = "volatility_changed"
    PRICE_AT_KEY_ZONE = "price_at_key_zone"
    # Position alerts
    COHERENCE_CHANGED = "coherence_changed"
    THESIS_INVALIDATED = "thesis_invalidated"
    HTF_MOMENTUM_CHANGED = "htf_momentum_changed"
    # Meta alerts
    MULTIPLE_AGAINST_CONTEXT = "multiple_against_context"
    HIGH_RISK_EXPOSURE = "high_risk_exposure"
    # Exit alerts
    TRAILING_BREAKEVEN = "trailing_breakeven"
    TRAILING_UPDATE = "trailing_update"
    MACD_REVERSAL = "macd_reversal"
    RSI_EXTREME = "rsi_extreme"
    # Signal alerts
    NEW_SIGNAL = "new_signal"
    SIGNAL_IMPROVED = "signal_improved"
    SIGNAL_LONG = "signal_long"
    SIGNAL_SHORT = "signal_short"
    FAVORABLE_CONDITIONS = "favorable_conditions"
    # Unified pair alerts (timing confirmation)
    CONFIRMATION_GAINED = "confirmation_gained"
    CONFIRMATION_LOST = "confirmation_lost"


# ============================================================
# Legacy User model (kept for backward compatibility with push tokens)
# ============================================================
class User(Base):
    """User/token model for push notification subscribers (legacy)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    push_token = Column(String(255), unique=True, nullable=False, index=True)
    pairs = Column(JSON, default=["BTC/USDT", "ETH/USDT"])
    timeframe = Column(String(10), default="4h")
    trading_mode = Column(Enum(TradingMode), default=TradingMode.BALANCED)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    signals_cleared_at = Column(DateTime, nullable=True)
    notifications_cleared_at = Column(DateTime, nullable=True)
    # Link to UserAccount (nullable for legacy users without account)
    account_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)


# ============================================================
# New UserAccount model
# ============================================================
class UserAccount(Base):
    """Full user account with auth, Binance keys, and settings."""
    __tablename__ = "user_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)

    # Binance API keys (encrypted)
    binance_api_key = Column(Text, nullable=True)
    binance_api_secret = Column(Text, nullable=True)

    # Operation mode
    mode = Column(Enum(OperationMode), default=OperationMode.RECOMMENDATIONS)

    # Risk limits
    risk_percent = Column(Float, default=2.0)  # % of balance per trade
    risk_fixed_usdt = Column(Float, nullable=True)  # Fixed USDT amount (alternative)
    max_leverage = Column(Integer, default=10)

    # Push notification
    push_token = Column(String(255), nullable=True)
    push_enabled = Column(Boolean, default=True)

    # Legacy config
    trading_mode = Column(Enum(TradingMode), default=TradingMode.BALANCED)

    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def set_binance_keys(self, api_key: str, api_secret: str):
        """Encrypt and store Binance API keys."""
        self.binance_api_key = encrypt_value(api_key)
        self.binance_api_secret = encrypt_value(api_secret)

    def get_binance_keys(self) -> tuple:
        """Decrypt and return Binance API keys."""
        return decrypt_value(self.binance_api_key), decrypt_value(self.binance_api_secret)

    def has_binance_keys(self) -> bool:
        """Check if user has Binance API keys configured."""
        return bool(self.binance_api_key and self.binance_api_secret)


# ============================================================
# ActivePosition model
# ============================================================
class ActivePosition(Base):
    """Tracks an open position from Binance Futures."""
    __tablename__ = "active_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False, index=True)
    symbol = Column(String(20), nullable=False)
    side = Column(String(10), nullable=False)  # LONG or SHORT
    entry_price = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)
    leverage = Column(Integer, default=1)

    unrealized_pnl = Column(Float, default=0.0)
    current_price = Column(Float, nullable=True)

    initial_stop_loss = Column(Float, nullable=True)
    current_stop_loss = Column(Float, nullable=True)
    initial_take_profit = Column(Float, nullable=True)
    current_take_profit = Column(Float, nullable=True)

    highest_price = Column(Float, nullable=True)
    lowest_price = Column(Float, nullable=True)
    breakeven_reached = Column(Boolean, default=False)

    entry_atr = Column(Float, nullable=True)
    liquidation_price = Column(Float, nullable=True)
    is_open = Column(Boolean, default=True)
    opened_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============================================================
# ExitAlert model
# ============================================================
class ExitAlert(Base):
    """Exit alert generated by the position monitor."""
    __tablename__ = "exit_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    position_id = Column(Integer, ForeignKey("active_positions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False, index=True)
    symbol = Column(String(20), nullable=False)

    alert_type = Column(Enum(ExitAlertType), nullable=False)
    message = Column(Text, nullable=True)
    recommended_action = Column(Enum(RecommendedAction), nullable=True)

    new_sl_price = Column(Float, nullable=True)
    was_executed = Column(Boolean, default=False)  # True if bot mode executed the action
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ============================================================
# UserNotification model (all types of notifications)
# ============================================================
class UserNotification(Base):
    """Stores all notifications sent to users."""
    __tablename__ = "user_notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False, index=True)
    # Use values_callable to store enum values (lowercase) instead of names (UPPERCASE)
    notification_type = Column(
        Enum(NotificationType, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    symbol = Column(String(20), nullable=True)  # Optional: related symbol
    data = Column(JSON, nullable=True)  # Additional context data
    is_read = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ============================================================
# Existing models (unchanged)
# ============================================================
class Subscription(Base):
    """Individual subscription for a pair - linked to UserAccount (email)."""
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False, index=True)
    pair = Column(String(20), nullable=False)
    # timeframe kept for compatibility but not used (unified 4H+15m)
    timeframe = Column(String(10), default="4h")
    # trading_mode kept for compatibility but not used
    trading_mode = Column(Enum(TradingMode), default=TradingMode.BALANCED)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        {'mysql_charset': 'utf8mb4'},
    )


class AlertCooldown(Base):
    """Distributed cooldown tracking for alerts (multi-worker safe)."""
    __tablename__ = "alert_cooldowns"

    alert_key = Column(String(100), primary_key=True)
    last_triggered = Column(DateTime, nullable=False)

    __table_args__ = (
        {'mysql_charset': 'utf8mb4'},
    )


class Signal(Base):
    """Signal history model."""
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pair = Column(String(20), nullable=False, index=True)
    timeframe = Column(String(10), nullable=False)
    side = Column(String(10), nullable=False)
    quality = Column(Enum(SignalQualityDB), nullable=False)
    score = Column(Float, nullable=False)
    score_details = Column(JSON)
    warnings = Column(JSON)
    entry_price = Column(Float, nullable=False)
    take_profit = Column(Float, nullable=False)
    stop_loss = Column(Float, nullable=False)
    indicators = Column(JSON)
    funding_info = Column(JSON)
    fibonacci_info = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class AlertState(Base):
    """Tracks the current alert state per pair/timeframe."""
    __tablename__ = "alert_states"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pair = Column(String(20), nullable=False)
    timeframe = Column(String(10), nullable=False)
    current_side = Column(String(10))
    current_quality = Column(Enum(SignalQualityDB))
    current_score = Column(Float)
    last_notified_at = Column(DateTime)
    last_signal_id = Column(Integer)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        {'mysql_charset': 'utf8mb4'},
    )


class CooldownTracker(Base):
    """Tracks cooldown per pair/timeframe based on last signal quality."""
    __tablename__ = "cooldowns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pair = Column(String(20), nullable=False)
    timeframe = Column(String(10), nullable=False)
    last_quality = Column(Enum(SignalQualityDB))
    last_signal_at = Column(DateTime)

    __table_args__ = (
        {'mysql_charset': 'utf8mb4'},
    )


def _run_migrations():
    """Run manual ALTER TABLE migrations for columns added after initial create."""
    from sqlalchemy import text
    migrations = [
        ("active_positions", "liquidation_price", "ALTER TABLE active_positions ADD COLUMN liquidation_price FLOAT NULL"),
    ]
    with engine.connect() as conn:
        for table, column, sql in migrations:
            try:
                conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
            except Exception:
                try:
                    conn.execute(text(sql))
                    conn.commit()
                    print(f"Migration: added {table}.{column}")
                except Exception as e:
                    print(f"Migration warning ({table}.{column}): {e}")

        # Migration: sync NotificationType enum with database
        try:
            # Get all enum values from Python NotificationType
            enum_values = [e.value for e in NotificationType]
            enum_str = ",".join([f"'{v}'" for v in enum_values])
            alter_sql = f"ALTER TABLE user_notifications MODIFY COLUMN notification_type ENUM({enum_str}) NOT NULL"
            conn.execute(text(alter_sql))
            conn.commit()
            print(f"Migration: synced notification_type enum ({len(enum_values)} values)")
        except Exception as e:
            # Table might not exist yet or other issue
            if "doesn't exist" not in str(e).lower():
                print(f"Migration warning (notification_type enum): {e}")

        # Migration: rename subscriptions.user_id to account_id
        try:
            # Check if old column exists
            conn.execute(text("SELECT user_id FROM subscriptions LIMIT 1"))
            # Old column exists, rename it
            try:
                conn.execute(text("ALTER TABLE subscriptions CHANGE COLUMN user_id account_id INT NOT NULL"))
                conn.commit()
                print("Migration: renamed subscriptions.user_id to account_id")
            except Exception as e:
                print(f"Migration warning (subscriptions.user_id->account_id): {e}")
        except Exception:
            # user_id doesn't exist, check if account_id already exists
            try:
                conn.execute(text("SELECT account_id FROM subscriptions LIMIT 1"))
                # account_id exists, migration already done
            except Exception:
                # Neither exists, table might be new - will be created with correct schema
                pass


def init_db():
    """Initialize database tables."""
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    print("Database tables created successfully")


def get_db() -> Session:
    """Get database session."""
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise


# ============================================================
# Helper functions for database operations
# ============================================================
class DBHelper:
    """Database helper class for common operations."""

    # ---- Legacy User operations ----
    @staticmethod
    def get_user_by_token(db: Session, token: str) -> Optional[User]:
        """Get user by push token."""
        return db.query(User).filter(User.push_token == token).first()

    @staticmethod
    def create_or_update_user(
        db: Session,
        token: str,
        pairs: list = None,
        timeframe: str = None,
        trading_mode: TradingMode = None
    ) -> User:
        """Create or update user."""
        user = DBHelper.get_user_by_token(db, token)
        if user:
            if pairs is not None:
                user.pairs = pairs
            if timeframe is not None:
                user.timeframe = timeframe
            if trading_mode is not None:
                user.trading_mode = trading_mode
            user.updated_at = datetime.utcnow()
        else:
            user = User(
                push_token=token,
                pairs=pairs or ["BTC/USDT", "ETH/USDT"],
                timeframe=timeframe or "4h",
                trading_mode=trading_mode or TradingMode.BALANCED,
            )
            db.add(user)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def delete_user(db: Session, token: str) -> bool:
        """Delete user by token."""
        user = DBHelper.get_user_by_token(db, token)
        if user:
            db.delete(user)
            db.commit()
            return True
        return False

    @staticmethod
    def get_users_for_signal(
        db: Session,
        pair: str,
        timeframe: str,
        quality: SignalQualityDB,
        score: float
    ) -> list:
        """Get users who should receive this signal."""
        users = db.query(User).filter(
            User.enabled == True,
            User.timeframe == timeframe,
        ).all()

        result = []
        for user in users:
            if pair not in user.pairs:
                continue
            if user.trading_mode == TradingMode.CONSERVATIVE and score < 2.5:
                continue
            elif user.trading_mode == TradingMode.BALANCED and score < 1.5:
                continue
            result.append(user)
        return result

    @staticmethod
    def save_signal(db: Session, signal_data: dict) -> Signal:
        """Save a signal to database."""
        signal = Signal(**signal_data)
        db.add(signal)
        db.commit()
        db.refresh(signal)
        return signal

    @staticmethod
    def get_alert_state(db: Session, pair: str, timeframe: str) -> Optional[AlertState]:
        """Get current alert state for pair/timeframe."""
        return db.query(AlertState).filter(
            AlertState.pair == pair,
            AlertState.timeframe == timeframe
        ).first()

    @staticmethod
    def update_alert_state(
        db: Session,
        pair: str,
        timeframe: str,
        side: str,
        quality: SignalQualityDB,
        score: float,
        signal_id: int = None
    ) -> AlertState:
        """Update or create alert state."""
        state = DBHelper.get_alert_state(db, pair, timeframe)
        now = datetime.utcnow()

        if state:
            state.current_side = side
            state.current_quality = quality
            state.current_score = score
            state.last_notified_at = now
            state.last_signal_id = signal_id
            state.updated_at = now
        else:
            state = AlertState(
                pair=pair,
                timeframe=timeframe,
                current_side=side,
                current_quality=quality,
                current_score=score,
                last_notified_at=now,
                last_signal_id=signal_id
            )
            db.add(state)

        db.commit()
        db.refresh(state)
        return state

    @staticmethod
    def should_notify(
        db: Session,
        pair: str,
        timeframe: str,
        new_side: str,
        new_quality: SignalQualityDB,
        new_score: float
    ) -> tuple:
        """Determine if we should send notification based on state change."""
        state = DBHelper.get_alert_state(db, pair, timeframe)

        if not state or state.current_side is None:
            return True, "new_signal"

        if state.current_side != new_side:
            return True, "side_changed"

        quality_order = {
            SignalQualityDB.TEMPRANA: 0,
            SignalQualityDB.BUENA: 1,
            SignalQualityDB.OPTIMA: 2
        }
        old_quality_val = quality_order.get(state.current_quality, -1)
        new_quality_val = quality_order.get(new_quality, -1)

        if new_quality_val > old_quality_val:
            if state.last_notified_at:
                elapsed = (datetime.utcnow() - state.last_notified_at).total_seconds()
                if elapsed < 3600:
                    return False, "quality_cooldown"
            return True, "quality_improved"

        return False, "no_change"

    @staticmethod
    def should_notify_disappeared(
        db: Session,
        pair: str,
        timeframe: str
    ) -> tuple:
        """Check if we should notify that a signal disappeared."""
        state = DBHelper.get_alert_state(db, pair, timeframe)
        if state and state.current_side is not None:
            return True, "signal_disappeared"
        return False, "no_previous_signal"

    @staticmethod
    def clear_alert_state(db: Session, pair: str, timeframe: str):
        """Clear alert state."""
        state = DBHelper.get_alert_state(db, pair, timeframe)
        if state:
            state.current_side = None
            state.current_quality = None
            state.current_score = None
            db.commit()

    @staticmethod
    def get_recent_signals(db: Session, limit: int = 20) -> list:
        """Get recent signals."""
        return db.query(Signal).order_by(Signal.created_at.desc()).limit(limit).all()

    @staticmethod
    def get_all_users(db: Session) -> list:
        """Get all users."""
        return db.query(User).all()

    # ---- Subscription methods (by account_id) ----
    @staticmethod
    def add_subscription(
        db: Session,
        account_id: int,
        pair: str,
        timeframe: str = "4h",
        trading_mode: TradingMode = TradingMode.BALANCED
    ) -> Subscription:
        """Add a new subscription for a user account."""
        existing = db.query(Subscription).filter(
            Subscription.account_id == account_id,
            Subscription.pair == pair
        ).first()

        if existing:
            existing.enabled = True
            db.commit()
            db.refresh(existing)
            return existing

        sub = Subscription(
            account_id=account_id,
            pair=pair,
            timeframe=timeframe,
            trading_mode=trading_mode
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        return sub

    @staticmethod
    def remove_subscription(db: Session, subscription_id: int, account_id: int) -> bool:
        """Remove a subscription by account."""
        sub = db.query(Subscription).filter(
            Subscription.id == subscription_id,
            Subscription.account_id == account_id
        ).first()
        if sub:
            db.delete(sub)
            db.commit()
            return True
        return False

    @staticmethod
    def get_user_subscriptions(db: Session, account_id: int) -> list:
        """Get all subscriptions for a user account."""
        return db.query(Subscription).filter(
            Subscription.account_id == account_id,
            Subscription.enabled == True
        ).all()

    @staticmethod
    def get_subscriptions_for_pair(db: Session, pair: str) -> list:
        """Get all accounts subscribed to a pair with their push tokens.

        Returns list of dicts: {account_id, push_token, account}
        """
        subs = db.query(Subscription).filter(
            Subscription.pair == pair,
            Subscription.enabled == True
        ).all()

        result = []
        for sub in subs:
            account = db.query(UserAccount).filter(
                UserAccount.id == sub.account_id
            ).first()
            if account and account.enabled and account.push_token:
                result.append({
                    "account_id": account.id,
                    "push_token": account.push_token,
                    "account": account
                })

        return result

    # ---- UserAccount methods ----
    @staticmethod
    def get_account_by_email(db: Session, email: str) -> Optional[UserAccount]:
        """Get user account by email."""
        return db.query(UserAccount).filter(UserAccount.email == email).first()

    @staticmethod
    def get_account_by_id(db: Session, account_id: int) -> Optional[UserAccount]:
        """Get user account by ID."""
        return db.query(UserAccount).filter(UserAccount.id == account_id).first()

    @staticmethod
    def create_account(db: Session, email: str, password_hash: str) -> UserAccount:
        """Create a new user account."""
        account = UserAccount(
            email=email,
            password_hash=password_hash,
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        return account

    @staticmethod
    def get_accounts_with_binance_keys(db: Session) -> list:
        """Get all accounts that have Binance API keys configured."""
        return db.query(UserAccount).filter(
            UserAccount.binance_api_key.isnot(None),
            UserAccount.binance_api_key != "",
            UserAccount.binance_api_secret.isnot(None),
            UserAccount.binance_api_secret != "",
            UserAccount.enabled == True,
        ).all()

    # ---- Position methods ----
    @staticmethod
    def get_open_positions(db: Session, user_id: int) -> list:
        """Get all open positions for a user."""
        return db.query(ActivePosition).filter(
            ActivePosition.user_id == user_id,
            ActivePosition.is_open == True
        ).all()

    @staticmethod
    def upsert_position(
        db: Session,
        user_id: int,
        symbol: str,
        side: str,
        entry_price: float,
        amount: float,
        leverage: int = 1,
        unrealized_pnl: float = 0.0,
        current_price: float = None,
        liquidation_price: float = None,
    ) -> ActivePosition:
        """Create or update a position."""
        pos = db.query(ActivePosition).filter(
            ActivePosition.user_id == user_id,
            ActivePosition.symbol == symbol,
            ActivePosition.side == side,
            ActivePosition.is_open == True
        ).first()

        if pos:
            pos.amount = amount
            pos.leverage = leverage
            pos.unrealized_pnl = unrealized_pnl
            pos.current_price = current_price
            pos.liquidation_price = liquidation_price
            if current_price:
                if pos.highest_price is None or current_price > pos.highest_price:
                    pos.highest_price = current_price
                if pos.lowest_price is None or current_price < pos.lowest_price:
                    pos.lowest_price = current_price
            pos.updated_at = datetime.utcnow()
        else:
            pos = ActivePosition(
                user_id=user_id,
                symbol=symbol,
                side=side,
                entry_price=entry_price,
                amount=amount,
                leverage=leverage,
                unrealized_pnl=unrealized_pnl,
                current_price=current_price,
                highest_price=current_price,
                lowest_price=current_price,
                liquidation_price=liquidation_price,
            )
            db.add(pos)

        db.commit()
        db.refresh(pos)
        return pos

    @staticmethod
    def close_position(db: Session, position_id: int):
        """Mark a position as closed."""
        pos = db.query(ActivePosition).filter(ActivePosition.id == position_id).first()
        if pos:
            pos.is_open = False
            pos.closed_at = datetime.utcnow()
            db.commit()

    @staticmethod
    def update_position_prices(
        db: Session,
        position_id: int,
        current_price: float = None,
        unrealized_pnl: float = None,
        highest_price: float = None,
        lowest_price: float = None,
    ):
        """Update position price tracking."""
        pos = db.query(ActivePosition).filter(ActivePosition.id == position_id).first()
        if pos:
            if current_price is not None:
                pos.current_price = current_price
            if unrealized_pnl is not None:
                pos.unrealized_pnl = unrealized_pnl
            if highest_price is not None:
                pos.highest_price = highest_price
            if lowest_price is not None:
                pos.lowest_price = lowest_price
            pos.updated_at = datetime.utcnow()
            db.commit()

    @staticmethod
    def update_position_sl(db: Session, position_id: int, new_sl: float):
        """Update the stop loss for a position."""
        pos = db.query(ActivePosition).filter(ActivePosition.id == position_id).first()
        if pos:
            pos.current_stop_loss = new_sl
            pos.updated_at = datetime.utcnow()
            db.commit()

    @staticmethod
    def create_exit_alert(
        db: Session,
        position_id: int,
        user_id: int,
        symbol: str,
        alert_type: ExitAlertType,
        message: str,
        recommended_action: RecommendedAction = None,
        new_sl_price: float = None,
        was_executed: bool = False,
    ) -> Optional[ExitAlert]:
        """Create an exit alert with dedup (30 min per type+position)."""
        # Dedup: check if same alert type for same position in last 30 min
        cutoff = datetime.utcnow() - timedelta(minutes=30)
        existing = db.query(ExitAlert).filter(
            ExitAlert.position_id == position_id,
            ExitAlert.alert_type == alert_type,
            ExitAlert.created_at > cutoff,
        ).first()

        if existing:
            return None  # Deduplicated

        alert = ExitAlert(
            position_id=position_id,
            user_id=user_id,
            symbol=symbol,
            alert_type=alert_type,
            message=message,
            recommended_action=recommended_action,
            new_sl_price=new_sl_price,
            was_executed=was_executed,
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert

    @staticmethod
    def get_recent_exit_alerts(db: Session, user_id: int, limit: int = 50) -> list:
        """Get recent exit alerts for a user."""
        return db.query(ExitAlert).filter(
            ExitAlert.user_id == user_id
        ).order_by(ExitAlert.created_at.desc()).limit(limit).all()

    @staticmethod
    def get_position_alerts(db: Session, position_id: int, limit: int = 20) -> list:
        """Get alerts for a specific position."""
        return db.query(ExitAlert).filter(
            ExitAlert.position_id == position_id
        ).order_by(ExitAlert.created_at.desc()).limit(limit).all()

    # ---- UserNotification methods ----
    @staticmethod
    def create_notification(
        db: Session,
        user_id: int,
        notification_type: NotificationType,
        title: str,
        message: str,
        symbol: str = None,
        data: dict = None,
    ) -> UserNotification:
        """Create a new notification for a user."""
        notification = UserNotification(
            user_id=user_id,
            notification_type=notification_type,
            title=title,
            message=message,
            symbol=symbol,
            data=data,
        )
        db.add(notification)
        db.commit()
        db.refresh(notification)
        return notification

    @staticmethod
    def get_user_notifications(
        db: Session,
        user_id: int,
        limit: int = 50,
        unread_only: bool = False,
    ) -> list:
        """Get notifications for a user."""
        query = db.query(UserNotification).filter(
            UserNotification.user_id == user_id
        )
        if unread_only:
            query = query.filter(UserNotification.is_read == False)
        return query.order_by(UserNotification.created_at.desc()).limit(limit).all()

    @staticmethod
    def get_unread_count(db: Session, user_id: int) -> int:
        """Get count of unread notifications for a user."""
        return db.query(UserNotification).filter(
            UserNotification.user_id == user_id,
            UserNotification.is_read == False
        ).count()

    @staticmethod
    def mark_notification_read(db: Session, notification_id: int, user_id: int) -> bool:
        """Mark a notification as read."""
        notification = db.query(UserNotification).filter(
            UserNotification.id == notification_id,
            UserNotification.user_id == user_id
        ).first()
        if notification:
            notification.is_read = True
            db.commit()
            return True
        return False

    @staticmethod
    def mark_all_notifications_read(db: Session, user_id: int) -> int:
        """Mark all notifications as read for a user. Returns count updated."""
        count = db.query(UserNotification).filter(
            UserNotification.user_id == user_id,
            UserNotification.is_read == False
        ).update({"is_read": True})
        db.commit()
        return count


# Migration helper to import existing tokens.json
def migrate_tokens_from_json(db: Session, tokens_file: str = "tokens.json"):
    """Migrate existing tokens from JSON file to database."""
    import json
    try:
        with open(tokens_file, "r") as f:
            tokens = json.load(f)

        for token, settings in tokens.items():
            DBHelper.create_or_update_user(
                db,
                token=token,
                pairs=settings.get("pairs"),
                timeframe=settings.get("timeframe"),
                trading_mode=TradingMode.BALANCED
            )
        print(f"Migrated {len(tokens)} tokens from {tokens_file}")
    except FileNotFoundError:
        print(f"No {tokens_file} found, skipping migration")
    except Exception as e:
        print(f"Error migrating tokens: {e}")

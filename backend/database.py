"""
Database configuration and models using SQLAlchemy.
"""
import os
from datetime import datetime
from typing import Optional
from enum import Enum as PyEnum

from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, JSON, Enum, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv

load_dotenv()

# Database configuration from environment
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "backend_crypto")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

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


class SignalQualityDB(PyEnum):
    """Signal quality levels."""
    TEMPRANA = "TEMPRANA"
    BUENA = "BUENA"
    OPTIMA = "OPTIMA"


class User(Base):
    """User/token model for push notification subscribers."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    push_token = Column(String(255), unique=True, nullable=False, index=True)
    pairs = Column(JSON, default=["BTC/USDT", "ETH/USDT"])  # Legacy - kept for compatibility
    timeframe = Column(String(10), default="4h")  # Legacy - kept for compatibility
    trading_mode = Column(Enum(TradingMode), default=TradingMode.BALANCED)  # Legacy
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    signals_cleared_at = Column(DateTime, nullable=True)  # Hide signals before this time
    notifications_cleared_at = Column(DateTime, nullable=True)  # Hide notifications before this time


class Subscription(Base):
    """Individual subscription for a pair/timeframe/trading_mode combination."""
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    pair = Column(String(20), nullable=False)
    timeframe = Column(String(10), nullable=False)
    trading_mode = Column(Enum(TradingMode), default=TradingMode.BALANCED)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        {'mysql_charset': 'utf8mb4'},
    )


class Signal(Base):
    """Signal history model."""
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pair = Column(String(20), nullable=False, index=True)
    timeframe = Column(String(10), nullable=False)
    side = Column(String(10), nullable=False)  # LONG or SHORT
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
    """
    Tracks the current alert state per pair/timeframe to avoid duplicate notifications.
    Only notifies on state CHANGE (e.g., None -> TEMPRANA, TEMPRANA -> BUENA, etc.)
    """
    __tablename__ = "alert_states"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pair = Column(String(20), nullable=False)
    timeframe = Column(String(10), nullable=False)
    current_side = Column(String(10))  # LONG, SHORT, or None
    current_quality = Column(Enum(SignalQualityDB))
    current_score = Column(Float)
    last_notified_at = Column(DateTime)
    last_signal_id = Column(Integer)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Composite unique constraint
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


def init_db():
    """Initialize database tables."""
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully")


def get_db() -> Session:
    """Get database session."""
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise


# Helper functions for database operations
class DBHelper:
    """Database helper class for common operations."""

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
    ) -> list[User]:
        """
        Get users who should receive this signal based on their preferences.
        Filters by pair, timeframe, and trading mode.
        """
        users = db.query(User).filter(
            User.enabled == True,
            User.timeframe == timeframe,
        ).all()

        # Filter by pair and trading mode
        result = []
        for user in users:
            # Check if user monitors this pair
            if pair not in user.pairs:
                continue

            # Check trading mode threshold
            if user.trading_mode == TradingMode.CONSERVATIVE and score < 2.5:
                continue
            elif user.trading_mode == TradingMode.BALANCED and score < 1.5:
                continue
            # AGGRESSIVE gets all signals

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
    ) -> tuple[bool, str]:
        """
        Determine if we should send notification based on state change.

        ALWAYS notify (no cooldown):
        - New signal appears (was None)
        - Direction changes (LONG <-> SHORT)

        WITH 1 hour cooldown:
        - Quality improves (same direction)

        Returns (should_notify, reason)
        """
        state = DBHelper.get_alert_state(db, pair, timeframe)

        # New signal - always notify
        if not state or state.current_side is None:
            return True, "new_signal"

        # Side changed (LONG -> SHORT or vice versa) - ALWAYS notify immediately
        if state.current_side != new_side:
            return True, "side_changed"

        # Same direction - check for quality improvement with cooldown
        quality_order = {
            SignalQualityDB.TEMPRANA: 0,
            SignalQualityDB.BUENA: 1,
            SignalQualityDB.OPTIMA: 2
        }
        old_quality_val = quality_order.get(state.current_quality, -1)
        new_quality_val = quality_order.get(new_quality, -1)

        if new_quality_val > old_quality_val:
            # Quality improved - apply 1 hour cooldown
            if state.last_notified_at:
                elapsed = (datetime.utcnow() - state.last_notified_at).total_seconds()
                if elapsed < 3600:  # 1 hour cooldown for quality improvements
                    return False, "quality_cooldown"
            return True, "quality_improved"

        return False, "no_change"

    @staticmethod
    def should_notify_disappeared(
        db: Session,
        pair: str,
        timeframe: str
    ) -> tuple[bool, str]:
        """
        Check if we should notify that a signal disappeared.
        Only notify if there was an active signal before.
        """
        state = DBHelper.get_alert_state(db, pair, timeframe)

        if state and state.current_side is not None:
            return True, "signal_disappeared"

        return False, "no_previous_signal"

    @staticmethod
    def clear_alert_state(db: Session, pair: str, timeframe: str):
        """Clear alert state (e.g., when price exits Fibo range)."""
        state = DBHelper.get_alert_state(db, pair, timeframe)
        if state:
            state.current_side = None
            state.current_quality = None
            state.current_score = None
            db.commit()

    @staticmethod
    def get_recent_signals(db: Session, limit: int = 20) -> list[Signal]:
        """Get recent signals."""
        return db.query(Signal).order_by(Signal.created_at.desc()).limit(limit).all()

    @staticmethod
    def get_all_users(db: Session) -> list[User]:
        """Get all users."""
        return db.query(User).all()

    # Subscription methods
    @staticmethod
    def add_subscription(
        db: Session,
        user_id: int,
        pair: str,
        timeframe: str,
        trading_mode: TradingMode = TradingMode.BALANCED
    ) -> Subscription:
        """Add a new subscription for a user."""
        # Check if already exists
        existing = db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.pair == pair,
            Subscription.timeframe == timeframe
        ).first()

        if existing:
            existing.trading_mode = trading_mode
            existing.enabled = True
            db.commit()
            db.refresh(existing)
            return existing

        sub = Subscription(
            user_id=user_id,
            pair=pair,
            timeframe=timeframe,
            trading_mode=trading_mode
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        return sub

    @staticmethod
    def remove_subscription(db: Session, subscription_id: int, user_id: int) -> bool:
        """Remove a subscription."""
        sub = db.query(Subscription).filter(
            Subscription.id == subscription_id,
            Subscription.user_id == user_id
        ).first()
        if sub:
            db.delete(sub)
            db.commit()
            return True
        return False

    @staticmethod
    def get_user_subscriptions(db: Session, user_id: int) -> list[Subscription]:
        """Get all subscriptions for a user."""
        return db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.enabled == True
        ).all()

    @staticmethod
    def get_subscriptions_for_signal(
        db: Session,
        pair: str,
        timeframe: str,
        score: float
    ) -> list[dict]:
        """Get users who should receive this signal based on their subscriptions."""
        subs = db.query(Subscription).filter(
            Subscription.pair == pair,
            Subscription.timeframe == timeframe,
            Subscription.enabled == True
        ).all()

        result = []
        for sub in subs:
            # Check trading mode threshold
            if sub.trading_mode == TradingMode.CONSERVATIVE and score < 2.5:
                continue
            elif sub.trading_mode == TradingMode.BALANCED and score < 1.5:
                continue
            # AGGRESSIVE gets all signals

            # Get user token
            user = db.query(User).filter(User.id == sub.user_id).first()
            if user and user.enabled:
                result.append({
                    "user_id": user.id,
                    "push_token": user.push_token,
                    "subscription": sub
                })

        return result


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

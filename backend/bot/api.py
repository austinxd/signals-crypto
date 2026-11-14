"""HTTP access to the bot journals and controls, for the app and for remote analysis.

Mounted by main.py under /api/bot. Two kinds of bot, chosen with ?account=
    sim   one shared bot on simulated money. Any login (or X-Bot-Token: $BOT_API_TOKEN) may read it;
          only the token or an account with is_admin may control it.
    real  one bot per app account, trading that account's own Binance futures with the keys saved in the app
          (see users.py). Only its owner reads and controls it; the token may read one with &user_id=.
"""
import hmac
import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from . import report, users
from .journal import Journal

Account = Literal["sim", "real"]


class Caller:
    def __init__(self, token: bool, user=None):
        self.token, self.user = token, user
        self.admin = token or bool(getattr(user, "is_admin", False))


def _caller(x_bot_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)) -> Caller:
    """Lets in the server-side bot token or any app login."""
    expected = os.getenv("BOT_API_TOKEN")
    if expected and x_bot_token and hmac.compare_digest(x_bot_token, expected):
        return Caller(True)
    if authorization and authorization.lower().startswith("bearer "):
        from fastapi.security import HTTPAuthorizationCredentials
        from auth import get_current_user  # backend/auth.py; raises 401 on a bad or expired login
        return Caller(False, get_current_user(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=authorization[7:].strip())))
    if not expected:
        raise HTTPException(503, "BOT_API_TOKEN is not configured")
    raise HTTPException(401, "invalid bot token")


def _owner_id(who: Caller, user_id: Optional[int] = None) -> int:
    if who.user is not None:
        return int(who.user.id)
    if user_id is None:
        raise HTTPException(400, "the real bot belongs to an account: log in, or pass user_id with the token")
    return user_id


def _j(account: Account = "sim", who: Caller = Depends(_caller)) -> Journal:
    """The journal a control acts on, after checking the caller may control that bot."""
    if account == "sim":
        if not who.admin:
            raise HTTPException(403, "admin account required")
        return Journal()
    if who.user is None:
        raise HTTPException(403, "only the account that owns a real bot may control it")
    j = users.journal(int(who.user.id))
    if j is None:
        raise HTTPException(409, "your bot is not running on Binance yet")
    return j


router = APIRouter(prefix="/api/bot")


class PauseBody(BaseModel):
    reason: str = "manual"


class ModeBody(BaseModel):
    mode: Literal["auto", "manual"]


class OpenBody(BaseModel):
    symbol: str
    side: Literal["long", "short"]


class AiBody(BaseModel):
    mode: Literal["off", "shadow", "reduce"]


class EnableBody(BaseModel):
    enabled: bool


@router.get("/report")
def get_report(trades: int = 15, decisions: int = 20, account: Account = "sim", user_id: Optional[int] = None,
               who: Caller = Depends(_caller)):
    if account == "sim":
        return {**report.build(trades=trades, decisions=decisions), "account": "sim", "configured": True,
                "can_control": who.admin}
    uid = _owner_id(who, user_id)
    real, j = users.status(uid), users.journal(uid)
    out = {"account": "real", "configured": j is not None, "can_control": who.user is not None, "real": real}
    return {**report.build(trades=trades, decisions=decisions, journal=j), **out} if j else out


@router.post("/real")
def enable_real(body: EnableBody, who: Caller = Depends(_caller)):
    """The logged-in account turns its own real bot on or off. Off stops new trades and management by the bot;
    it does not close anything on Binance (open positions keep their stop orders there)."""
    if who.user is None:
        raise HTTPException(403, "log in with the account that owns the bot")
    try:
        return users.set_enabled(int(who.user.id), body.enabled)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/ai")
def set_ai(body: AiBody, account: Account = "sim", j: Journal = Depends(_j)):
    if account == "real":
        raise HTTPException(409, "the AI desk only runs on the simulated bot")
    j.set_state("ai", body.mode)
    j.event("info", "ai", f"ai set to {body.mode}")
    return {"ai": body.mode}


@router.post("/pause")
def pause(body: PauseBody, j: Journal = Depends(_j)):
    j.set_paused(True, body.reason)
    return {"paused": True}


@router.post("/resume")
def resume(j: Journal = Depends(_j)):
    j.set_paused(False, "")
    return {"paused": False}


@router.post("/mode")
def set_mode(body: ModeBody, j: Journal = Depends(_j)):
    j.set_state("mode", body.mode)
    j.event("info", "mode", f"mode set to {body.mode}")
    return {"mode": body.mode}


@router.post("/proposals/{proposal_id}/{action}")
def proposal(proposal_id: int, action: Literal["approve", "reject"], j: Journal = Depends(_j)):
    return {"command_id": j.add_command(action, {"proposal_id": proposal_id})}


@router.post("/close/{symbol}")
def close(symbol: str, j: Journal = Depends(_j)):
    return {"command_id": j.add_command("close", {"symbol": symbol})}


@router.post("/open")
def open_trade(body: OpenBody, j: Journal = Depends(_j)):
    """Queues a trade asked for by hand. The engine sizes it and may refuse it: see the next report's decisions."""
    return {"command_id": j.add_command(
        "open", {"symbol": body.symbol.upper(), "side": 1 if body.side == "long" else -1})}

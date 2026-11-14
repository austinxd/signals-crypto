"""HTTP access to the bot journal and controls, for the app and for remote analysis.

Mounted by main.py under /api/bot. Reading the report needs the header  X-Bot-Token: $BOT_API_TOKEN
or any app login (Authorization: Bearer ...). Every control needs the token or an account with is_admin.
"""
import hmac
import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from . import report
from . import config
from .journal import Journal


def _viewer(x_bot_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)) -> bool:
    """Lets in the server-side bot token or any app login. Returns whether the caller may control the bot."""
    expected = os.getenv("BOT_API_TOKEN")
    if expected and x_bot_token and hmac.compare_digest(x_bot_token, expected):
        return True
    if authorization and authorization.lower().startswith("bearer "):
        from fastapi.security import HTTPAuthorizationCredentials
        from auth import get_current_user  # backend/auth.py; raises 401 on a bad or expired login
        user = get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=authorization[7:].strip()))
        return bool(user.is_admin)
    if not expected:
        raise HTTPException(503, "BOT_API_TOKEN is not configured")
    raise HTTPException(401, "invalid bot token")


def _admin(can_control: bool = Depends(_viewer)):
    if not can_control:
        raise HTTPException(403, "admin account required")


router = APIRouter(prefix="/api/bot")
ADMIN = [Depends(_admin)]

Account = Literal["sim", "real"]


def _journal(account: Account) -> Optional[Journal]:
    """Journal of the simulated bot or of the one on a Binance account. None if that one was never started."""
    if account == "sim":
        return Journal()
    path = config.REAL_DATA_DIR / "bot.db"
    return Journal(path) if path.exists() else None


def _j(account: Account = "sim") -> Journal:
    j = _journal(account)
    if j is None:
        raise HTTPException(409, "the bot is not set up on a Binance account")
    return j


class PauseBody(BaseModel):
    reason: str = "manual"


class ModeBody(BaseModel):
    mode: Literal["auto", "manual"]


class OpenBody(BaseModel):
    symbol: str
    side: Literal["long", "short"]


class AiBody(BaseModel):
    mode: Literal["off", "shadow", "reduce"]


@router.post("/ai", dependencies=ADMIN)
def set_ai(body: AiBody, j: Journal = Depends(_j)):
    j.set_state("ai", body.mode)
    j.event("info", "ai", f"ai set to {body.mode}")
    return {"ai": body.mode}


@router.get("/report")
def get_report(trades: int = 15, decisions: int = 20, account: Account = "sim",
               can_control: bool = Depends(_viewer)):
    j = _journal(account)
    if j is None:  # the app shows how to turn it on instead of an error
        return {"account": account, "configured": False, "can_control": can_control}
    return {**report.build(trades=trades, decisions=decisions, journal=j),
            "account": account, "configured": True, "can_control": can_control}


@router.post("/pause", dependencies=ADMIN)
def pause(body: PauseBody, j: Journal = Depends(_j)):
    j.set_paused(True, body.reason)
    return {"paused": True}


@router.post("/resume", dependencies=ADMIN)
def resume(j: Journal = Depends(_j)):
    j.set_paused(False, "")
    return {"paused": False}


@router.post("/mode", dependencies=ADMIN)
def set_mode(body: ModeBody, j: Journal = Depends(_j)):
    j.set_state("mode", body.mode)
    j.event("info", "mode", f"mode set to {body.mode}")
    return {"mode": body.mode}


@router.post("/proposals/{proposal_id}/{action}", dependencies=ADMIN)
def proposal(proposal_id: int, action: Literal["approve", "reject"], j: Journal = Depends(_j)):
    return {"command_id": j.add_command(action, {"proposal_id": proposal_id})}


@router.post("/close/{symbol}", dependencies=ADMIN)
def close(symbol: str, j: Journal = Depends(_j)):
    return {"command_id": j.add_command("close", {"symbol": symbol})}


@router.post("/open", dependencies=ADMIN)
def open_trade(body: OpenBody, j: Journal = Depends(_j)):
    """Queues a trade asked for by hand. The engine sizes it and may refuse it: see the next report's decisions."""
    return {"command_id": j.add_command(
        "open", {"symbol": body.symbol.upper(), "side": 1 if body.side == "long" else -1})}

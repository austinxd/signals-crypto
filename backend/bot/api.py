"""HTTP access to the bot journal and controls, for the app and for remote analysis.

Mounted by main.py under /api/bot. Every call needs either the header  X-Bot-Token: $BOT_API_TOKEN
or the app login (Authorization: Bearer ...) of an account with is_admin.
"""
import hmac
import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from . import report
from .journal import Journal


def _auth(x_bot_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """Two ways in: the server-side bot token, or the app login of an admin account."""
    expected = os.getenv("BOT_API_TOKEN")
    if expected and x_bot_token and hmac.compare_digest(x_bot_token, expected):
        return
    if authorization and authorization.lower().startswith("bearer "):
        from fastapi.security import HTTPAuthorizationCredentials
        from auth import get_current_user  # backend/auth.py; raises 401 on a bad or expired login
        user = get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=authorization[7:].strip()))
        if not user.is_admin:
            raise HTTPException(403, "admin account required")
        return
    if not expected:
        raise HTTPException(503, "BOT_API_TOKEN is not configured")
    raise HTTPException(401, "invalid bot token")


router = APIRouter(prefix="/api/bot", dependencies=[Depends(_auth)])


class PauseBody(BaseModel):
    reason: str = "manual"


class ModeBody(BaseModel):
    mode: Literal["auto", "manual"]


class AiBody(BaseModel):
    mode: Literal["off", "shadow", "reduce"]


@router.post("/ai")
def set_ai(body: AiBody):
    j = Journal()
    j.set_state("ai", body.mode)
    j.event("info", "ai", f"ai set to {body.mode}")
    return {"ai": body.mode}


@router.get("/report")
def get_report(trades: int = 15, decisions: int = 20):
    return report.build(trades=trades, decisions=decisions)


@router.post("/pause")
def pause(body: PauseBody):
    Journal().set_paused(True, body.reason)
    return {"paused": True}


@router.post("/resume")
def resume():
    Journal().set_paused(False, "")
    return {"paused": False}


@router.post("/mode")
def set_mode(body: ModeBody):
    j = Journal()
    j.set_state("mode", body.mode)
    j.event("info", "mode", f"mode set to {body.mode}")
    return {"mode": body.mode}


@router.post("/proposals/{proposal_id}/{action}")
def proposal(proposal_id: int, action: Literal["approve", "reject"]):
    return {"command_id": Journal().add_command(action, {"proposal_id": proposal_id})}


@router.post("/close/{symbol}")
def close(symbol: str):
    return {"command_id": Journal().add_command("close", {"symbol": symbol})}

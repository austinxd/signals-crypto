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


class PauseBody(BaseModel):
    reason: str = "manual"


class ModeBody(BaseModel):
    mode: Literal["auto", "manual"]


class AiBody(BaseModel):
    mode: Literal["off", "shadow", "reduce"]


@router.post("/ai", dependencies=ADMIN)
def set_ai(body: AiBody):
    j = Journal()
    j.set_state("ai", body.mode)
    j.event("info", "ai", f"ai set to {body.mode}")
    return {"ai": body.mode}


@router.get("/report")
def get_report(trades: int = 15, decisions: int = 20, can_control: bool = Depends(_viewer)):
    return {**report.build(trades=trades, decisions=decisions), "can_control": can_control}


@router.post("/pause", dependencies=ADMIN)
def pause(body: PauseBody):
    Journal().set_paused(True, body.reason)
    return {"paused": True}


@router.post("/resume", dependencies=ADMIN)
def resume():
    Journal().set_paused(False, "")
    return {"paused": False}


@router.post("/mode", dependencies=ADMIN)
def set_mode(body: ModeBody):
    j = Journal()
    j.set_state("mode", body.mode)
    j.event("info", "mode", f"mode set to {body.mode}")
    return {"mode": body.mode}


@router.post("/proposals/{proposal_id}/{action}", dependencies=ADMIN)
def proposal(proposal_id: int, action: Literal["approve", "reject"]):
    return {"command_id": Journal().add_command(action, {"proposal_id": proposal_id})}


@router.post("/close/{symbol}", dependencies=ADMIN)
def close(symbol: str):
    return {"command_id": Journal().add_command("close", {"symbol": symbol})}

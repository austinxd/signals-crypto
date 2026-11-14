"""Tells the admin accounts what the bot just did: a push notification plus a row in the app's "Avisos" list.

Best effort by design: the bot must keep trading if the database or the push service is down, so nothing
here ever raises. Only the running engine uses it (see __main__.cmd_run); tests and backtests do not.
"""
import requests


def send(title: str, body: str, kind: str = "bot_trade", symbol: str = None, data: dict = None,
         user_ids: list = None) -> int:
    """Tells the admins (the simulated bot) or exactly `user_ids` (a real bot tells its owner). Returns how many."""
    told = 0
    try:
        from config import EXPO_PUSH_URL  # backend/config.py
        from database import DBHelper, SessionLocal, UserAccount
        db = SessionLocal()
        try:
            q = db.query(UserAccount)
            admins = (q.filter(UserAccount.id.in_(user_ids)) if user_ids is not None
                      else q.filter(UserAccount.is_admin == True)).all()  # noqa: E712
            messages = []
            for acc in admins:
                try:
                    DBHelper.create_notification(db, acc.id, kind, title, body, symbol=symbol, data=data)
                    told += 1
                except Exception:
                    db.rollback()
                token = acc.push_token or ""
                if acc.push_enabled is not False and token.startswith("ExponentPushToken"):
                    messages.append({"to": token, "sound": "default", "title": title, "body": body,
                                     "data": {"type": kind, **(data or {})}, "priority": "high",
                                     "channelId": "alerts"})
            if messages:
                requests.post(EXPO_PUSH_URL, json=messages, timeout=10,
                              headers={"Accept": "application/json", "Content-Type": "application/json"})
        finally:
            db.close()
    except Exception as e:
        print(f"[bot.notify] could not notify: {e!r}")
    return told

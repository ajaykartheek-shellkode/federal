"""Staff sign-in.

  POST /api/auth/login    -> {user}, sets the session cookie
  POST /api/auth/logout   -> clears it
  GET  /api/auth/me       -> the signed-in user (401 when the cookie is missing or stale)

The session lives in an HttpOnly cookie rather than a header, so the browser also attaches it to
the collateral photos and the report PDF, which are plain GETs the page cannot add headers to.
``require_user`` is the dependency every protected router hangs off.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import auth
from app.config import AUTH_TTL_S
from app.db import models as M
from app.db.base import session_scope

logger = logging.getLogger("glportal.api.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

SIGN_IN_FAILED = "That email and password don't match an active account."


class Credentials(BaseModel):
    email: str = Field(default="", max_length=160)
    password: str = Field(default="", max_length=auth.MAX_PASSWORD)


def _public(user: M.User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "branch": user.branch,
        "initials": "".join(part[0] for part in (user.name or "?").split()[:2]).upper(),
    }


def _authenticate(email: str, password: str) -> dict | None:
    """The user row for these credentials, or None. Always runs one hash, known email or not."""
    with session_scope() as db:
        user = db.scalar(select(M.User).where(func.lower(M.User.email) == email.strip().lower()))
        stored = user.password_hash if user else ""
        ok = auth.verify_password(password, stored)
        if not (ok and user and user.active):
            return None
        user.last_login_at = datetime.now(timezone.utc)
        return _public(user)


def current_user(request: Request) -> dict | None:
    """The signed-in user, or None. Never raises — use ``require_user`` to enforce."""
    user_id = auth.read_token(request.cookies.get(auth.COOKIE_NAME, ""))
    if user_id is None:
        return None
    with session_scope() as db:
        user = db.get(M.User, user_id)
        return _public(user) if user and user.active else None


class NotSignedIn(Exception):
    """Raised by ``require_user`` and rendered as a 401 by the app's exception handler."""


def require_user(request: Request) -> dict:
    """Router dependency: the signed-in user, or a 401 that the frontend redirects on."""
    user = current_user(request)
    if user is None:
        raise NotSignedIn()
    return user


def is_https(request: Request) -> bool:
    """True when the browser reached us over HTTPS, including through a proxy or tunnel.

    Behind nginx or a Cloudflare tunnel the request arrives at uvicorn over plain HTTP, so the
    scheme alone would mark a perfectly secure session as insecure and drop the ``Secure`` flag.
    """
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return (forwarded or request.url.scheme) == "https"


def set_cookie(response: Response, user_id: int, secure: bool) -> None:
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.make_token(user_id),
        max_age=AUTH_TTL_S,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


@router.post("/login")
async def login(body: Credentials, request: Request):
    user = await asyncio.to_thread(_authenticate, body.email, body.password)
    if user is None:
        logger.info("Failed sign-in for %r", body.email[:80])
        return JSONResponse(status_code=401, content={"error": SIGN_IN_FAILED})
    response = JSONResponse(content={"user": user})
    set_cookie(response, user["id"], secure=is_https(request))
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return response


@router.get("/me")
async def me(request: Request):
    user = await asyncio.to_thread(current_user, request)
    if user is None:
        return JSONResponse(status_code=401, content={"error": "Not signed in."})
    return {"user": user}

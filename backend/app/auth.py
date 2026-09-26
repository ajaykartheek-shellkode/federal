"""Staff authentication: password hashing and signed session tokens.

Branch staff sign in with an email and password. Passwords are stored as PBKDF2-SHA256 digests
(stdlib only — no extra dependency), and the session itself is a signed token carried in an
HttpOnly cookie, so the browser attaches it to image and PDF requests as well as the JSON API.

The token is stateless: it carries the user id and an expiry, signed with ``AUTH_SECRET``. Nothing
is stored server-side, so signing out is simply dropping the cookie.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

from app.config import AUTH_SECRET, AUTH_TTL_S

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 240_000
COOKIE_NAME = "gl_session"

MIN_PASSWORD = 8
MAX_PASSWORD = 128


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# --------------------------------------------------------------------------- passwords
def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """``pbkdf2_sha256$<iterations>$<salt>$<digest>`` — self-describing, so the cost can change."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"{ALGORITHM}${ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check. A malformed or empty hash never verifies."""
    try:
        algorithm, iterations, salt, digest = (stored or "").split("$")
        if algorithm != ALGORITHM:
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), _unb64(salt), int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(expected, _unb64(digest))


# --------------------------------------------------------------------------- session tokens
def _sign(payload: str) -> str:
    return _b64(hmac.new(AUTH_SECRET.encode(), payload.encode(), hashlib.sha256).digest())


def make_token(user_id: int, ttl_s: int = AUTH_TTL_S) -> str:
    """A token for this user, valid for ``ttl_s`` seconds."""
    payload = f"{int(user_id)}.{int(time.time()) + int(ttl_s)}"
    return f"{payload}.{_sign(payload)}"


def read_token(token: str) -> int | None:
    """The user id carried by a valid, unexpired token — otherwise None."""
    try:
        user_id, expires_at, signature = (token or "").split(".")
    except ValueError:
        return None
    payload = f"{user_id}.{expires_at}"
    if not hmac.compare_digest(_sign(payload), signature):
        return None
    try:
        if int(expires_at) <= time.time():
            return None
        return int(user_id)
    except ValueError:
        return None

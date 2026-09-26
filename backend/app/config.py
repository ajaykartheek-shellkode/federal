"""Environment configuration for the GL Portal backend.

All tunables live here so they can be changed without touching agent or route code.
Values come from the process environment; ``backend/.env`` is loaded if present
(a tiny hand-rolled loader keeps us free of extra dependencies). Real environment
variables always win over the file.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Populate os.environ from backend/.env for keys that are not already set."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv()

# --------------------------------------------------------------------------- Bedrock
# Sonnet 4.6 cross-region inference profile (the "us." prefix is required for Sonnet 4.x).
BEDROCK_MODEL_ID: str = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")

# --------------------------------------------------------------------------- HTTP
# Comma-separated list of origins allowed to call the API directly (the Next.js apps
# normally proxy /api/* same-origin, so this only matters for direct calls).
FRONTEND_ORIGINS: list[str] = [
    o.strip()
    for o in os.environ.get(
        "FRONTEND_ORIGINS",
        os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000,http://localhost:3001"),
    ).split(",")
    if o.strip()
]
# Kept for backwards compatibility with older imports.
FRONTEND_ORIGIN: str = FRONTEND_ORIGINS[0] if FRONTEND_ORIGINS else "http://localhost:3000"

# --------------------------------------------------------------------------- Auth
# Secret used to sign staff session cookies. Set a long random value in every deployment —
# changing it signs everyone out, which is also the fastest way to revoke every session.
AUTH_SECRET: str = os.environ.get("AUTH_SECRET", "gl-portal-dev-secret-change-me")

# How long a sign-in lasts before the assessor has to enter their password again (seconds).
AUTH_TTL_S: int = int(os.environ.get("AUTH_TTL_S", str(12 * 60 * 60)))

# --------------------------------------------------------------------------- Database
# Local PostgreSQL (Homebrew, trust auth). Override for other environments.
DATABASE_URL: str = os.environ.get("DATABASE_URL", "postgresql+psycopg://ajay@localhost:5432/gl_portal")

# --------------------------------------------------------------------------- Validation
# Collateral agent hint: suggest splitting into multiple photos above this count.
MAX_ORNAMENTS_PER_IMAGE: int = int(os.environ.get("MAX_ORNAMENTS_PER_IMAGE", "12"))

# Converse document-block guardrail (Bedrock limit); larger PDFs are rasterized per page.
MAX_DOC_BYTES: int = 4_500_000

# Upload guardrails enforced by the chat API before any work starts.
MAX_UPLOAD_BYTES: int = int(os.environ.get("MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MAX_COLLATERAL_PHOTOS_PER_UPLOAD: int = 3
MAX_DAMAGE_ITEMS_PER_UPLOAD: int = 10
MAX_DOCUMENTS_PER_UPLOAD: int = 3

# Upper bound for the short conversational messages so a slow model never stalls a step.
GUIDANCE_TIMEOUT_S: float = float(os.environ.get("GUIDANCE_TIMEOUT_S", "8"))

# --------------------------------------------------------------------------- CaratMeter
# "mock" simulates the branch XRF karat analyser in-process (same JSON contract as the device
# gateway). "http" calls a real gateway at CARATMETER_BASE_URL.
CARATMETER_MODE: str = os.environ.get("CARATMETER_MODE", "mock").lower()
CARATMETER_BASE_URL: str = os.environ.get("CARATMETER_BASE_URL", "http://localhost:9100")
CARATMETER_API_KEY: str = os.environ.get("CARATMETER_API_KEY", "")
CARATMETER_TIMEOUT_S: float = float(os.environ.get("CARATMETER_TIMEOUT_S", "30"))

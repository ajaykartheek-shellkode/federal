"""GL Portal API — FastAPI application entry point.

Routers:
  app.api.auth     /api/auth/*       staff sign-in (session cookie)
  app.api.chat     /api/chat/*       conversational verification workflow (frontend-v2)
  app.api.reports  /api/reports/*    pass / alert / fail reporting
  app.api.system   /api/health, /api/settings, /api/assets/{id}
  app.api.integrations /api/integrations/caratmeter/v1/*   mock CaratMeter device gateway
  app.api.legacy   /api/context, /api/validate   (original v1 screen)

Run:  ./.venv/bin/uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import auth, chat, integrations, legacy, reports, system
from app.api.auth import NotSignedIn, require_user
from app.config import FRONTEND_ORIGINS
from app.db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("glportal")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        init_db.ensure()
    except Exception:  # noqa: BLE001 — surface loudly but let the API boot (health shows the problem)
        logger.exception("Database initialisation failed")
    yield


app = FastAPI(title="GL Portal API", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

@app.exception_handler(NotSignedIn)
async def _not_signed_in(_request: Request, _exc: NotSignedIn) -> JSONResponse:
    """Every protected route answers the same way; the frontend sends the user to /login."""
    return JSONResponse(status_code=401, content={"error": "Your session has ended. Sign in again."})


protected = [Depends(require_user)]

app.include_router(auth.router)
app.include_router(chat.router, dependencies=protected)
app.include_router(reports.router, dependencies=protected)
app.include_router(system.router)  # /api/health stays open; its other routes guard themselves
app.include_router(integrations.router)  # the CaratMeter gateway authenticates with its own key
app.include_router(legacy.router, dependencies=protected)

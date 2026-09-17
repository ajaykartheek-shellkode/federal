"""GL Portal API — FastAPI application entry point.

Routers:
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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, integrations, legacy, reports, system
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
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(reports.router)
app.include_router(system.router)
app.include_router(integrations.router)
app.include_router(legacy.router)

"""Health, settings and asset routes.

  GET /api/health            -> Bedrock reachability (cached briefly to avoid a model call per page load)
  GET /api/settings          -> validation settings + scenario list
  PUT /api/settings          -> partial update (validated and clamped server-side)
  GET /api/assets/{asset_id} -> stored photo / crop / document bytes
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response

from app import store
from app.bedrock.client import get_client
from app.config import AWS_REGION, BEDROCK_MODEL_ID
from app.settings import SCENARIOS, SettingsPatch, get_settings, update_settings

logger = logging.getLogger("glportal.api.system")
router = APIRouter(prefix="/api", tags=["system"])

_INLINE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}
_health_cache: dict = {"at": 0.0, "body": None, "status": 200}
_HEALTH_TTL_OK_S = 60.0
_HEALTH_TTL_FAIL_S = 10.0


def _probe() -> dict:
    started = time.time()
    get_client().converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": "Reply with the single word OK"}]}],
        inferenceConfig={"maxTokens": 5, "temperature": 0},
    )
    return {"ok": True, "modelId": BEDROCK_MODEL_ID, "region": AWS_REGION, "latencyMs": round((time.time() - started) * 1000)}


@router.get("/health")
async def health():
    age = time.time() - _health_cache["at"]
    ttl = _HEALTH_TTL_OK_S if _health_cache["status"] == 200 else _HEALTH_TTL_FAIL_S
    if _health_cache["body"] is not None and age < ttl:
        return JSONResponse(status_code=_health_cache["status"], content={**_health_cache["body"], "cached": True})
    try:
        body, status = await asyncio.to_thread(_probe), 200
    except Exception as exc:  # noqa: BLE001
        logger.warning("Health check failed: %s", exc)
        body, status = {"ok": False, "modelId": BEDROCK_MODEL_ID, "region": AWS_REGION, "error": str(exc)[:300]}, 503
    _health_cache.update(at=time.time(), body=body, status=status)
    return JSONResponse(status_code=status, content=body)


@router.get("/settings")
async def read_settings():
    settings = await asyncio.to_thread(get_settings)
    return {"scenarios": SCENARIOS, **settings.model_dump()}


@router.put("/settings")
async def write_settings(patch: SettingsPatch):
    updated = await asyncio.to_thread(update_settings, patch)
    return {"scenarios": SCENARIOS, **updated.model_dump()}


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: str):
    found = await asyncio.to_thread(store.load_asset, asset_id)
    if not found:
        return JSONResponse(status_code=404, content={"error": "not found"})
    data, content_type = found
    # Only render known-safe media inline; anything else (e.g. a legacy upload stored with a
    # client-supplied type) is forced to download so it can never execute on this origin.
    safe = content_type in _INLINE_TYPES
    return Response(
        content=data,
        media_type=content_type if safe else "application/octet-stream",
        headers={
            "Cache-Control": "private, max-age=86400, immutable",  # assets are immutable once written
            "Content-Disposition": "inline" if safe else f'attachment; filename="{asset_id}"',
            "X-Content-Type-Options": "nosniff",
        },
    )

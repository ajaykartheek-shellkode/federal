"""Routes used only by the original v1 screen (``frontend/``). Kept for compatibility.

  GET  /api/context?account=...  -> CBS loan context (falls back to the first customer)
  POST /api/validate             -> one-shot orchestrator over all uploads, streamed as SSE
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from app import cbs
from app.agents import orchestrator
from app.agents.assets import Asset
from app.config import MAX_UPLOAD_BYTES
from app.schemas import ValidatePayload
from app.settings import get_settings

logger = logging.getLogger("glportal.api.legacy")
router = APIRouter(prefix="/api", tags=["legacy-v1"])


@router.get("/context")
async def context(account: Optional[str] = None):
    found = await asyncio.to_thread(cbs.fetch_customer, account)
    return found or {"loan_context": {}, "rate_table": {}, "ornaments": []}


async def _read_all(files: List[UploadFile]) -> List[Asset]:
    out: List[Asset] = []
    for f in files:
        data = await f.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise ValueError(f"'{f.filename}' is too large")
        out.append(Asset(data=data, filename=f.filename or "file", content_type=f.content_type or ""))
    return out


@router.post("/validate")
async def validate(
    payload: str = Form(...),
    collateral_images: List[UploadFile] = File(default_factory=list),
    damage_images: List[UploadFile] = File(default_factory=list),
    documents: List[UploadFile] = File(default_factory=list),
):
    try:
        parsed = ValidatePayload.model_validate_json(payload)
        collateral_assets = await _read_all(collateral_images)
        damage_map: Dict[int, Asset] = dict(enumerate(await _read_all(damage_images)))
        document_map: Dict[int, Asset] = dict(enumerate(await _read_all(documents)))
    except (ValidationError, ValueError) as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)[:300]})

    settings = await asyncio.to_thread(get_settings)
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()

    async def event_stream():
        try:
            async for frame in orchestrator.run(parsed, collateral_assets, damage_map, document_map, settings, now_iso):
                yield frame
        except Exception as exc:  # noqa: BLE001
            logger.exception("Orchestrator stream failed")
            yield f"event: error\ndata: {json.dumps({'error': str(exc)[:300]})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )

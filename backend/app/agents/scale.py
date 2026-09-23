"""Weighing-machine agent — reads the total weight off the display in the scale photo.

One short multimodal call per photo; a result is always returned, so an unreadable display or a
model failure never blocks the workflow (the assessor can type the total instead).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.agents.assets import Asset
from app.agents.prompts import SCALE_PROMPT
from app.agents.trim import short_list
from app.bedrock import blocks as B
from app.bedrock.converse import run_converse
from app.schemas import ScaleResult

logger = logging.getLogger("glportal.agents.scale")

MAX_SCALE_G = 50_000


def _unreadable(reason: str, status: str = "fail") -> ScaleResult:
    return ScaleResult(status=status, reading_visible=False, weight_g=None, reading_text="", issues=[reason])


async def read_scale(image: Asset) -> ScaleResult:
    """Read the weighing machine's display. Never raises."""
    fmt = await asyncio.to_thread(B.image_format, image.content_type, image.filename)
    if not fmt:
        return _unreadable("Unsupported image format")
    block = await asyncio.to_thread(B.image_block, image.data, fmt)
    try:
        result = await run_converse(
            SCALE_PROMPT, "Read the total weight shown on the weighing machine.", [block], ScaleResult, max_tokens=600
        )
    except Exception as exc:  # noqa: BLE001 — never block the workflow on a validator error
        logger.exception("Scale agent failed")
        return _unreadable(f"Could not read the display: {str(exc)[:120]}")
    return _normalize(result)


def _normalize(result: ScaleResult) -> ScaleResult:
    """A reading counts only when it is visible, numeric and plausible."""
    weight: Optional[float] = result.weight_g
    ok = result.reading_visible and weight is not None and 0 < weight <= MAX_SCALE_G
    if not ok:
        result.reading_visible, result.weight_g, result.reading_text = False, None, ""
    else:
        result.weight_g = round(float(weight), 3)
        result.reading_text = " ".join(result.reading_text.split())[:40]
    result.issues = short_list(result.issues)
    return result

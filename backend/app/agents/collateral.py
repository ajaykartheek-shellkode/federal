"""Collateral Image Validation agent — it also *creates* the inventory.

Two phases so the chat timeline can show each one as it really happens:
  1. ``analyze_collateral`` — one multimodal call over all photos in the upload: quality checks
     plus one detection per ornament, each labelled the way a pledge list would name it
  2. ``crop_detections``    — crop a thumbnail for every detection and store it
The workflow then turns those detections into inventory rows (app.workflow.state.record_collateral).
``validate_collateral`` chains both for the legacy v1 orchestrator.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Tuple

from app import store
from app.agents.assets import Asset
from app.agents.prompts import COLLATERAL_PROMPT
from app.agents.trim import short_list
from app.bedrock import blocks as B
from app.bedrock.converse import run_converse
from app.bedrock.crop import crop_normalized
from app.schemas import CollateralImageResult, CollateralResult

logger = logging.getLogger("glportal.agents.collateral")

def _field(o, key: str, default=""):
    return o.get(key, default) if isinstance(o, dict) else getattr(o, key, default)


def _failed_image(index: int, reason: str) -> CollateralImageResult:
    return CollateralImageResult(
        index=index, status="fail", clarity_ok=False, all_visible=False, not_cropped=False,
        no_obstruction=False, no_foreign_objects=False, clean_background=False,
        ornament_count_estimate=0, issues=[reason],
    )


def _fallback(count: int, reason: str) -> CollateralResult:
    return CollateralResult(
        overall_status="fail",
        images=[_failed_image(i, f"Validator could not complete: {reason}") for i in range(count)],
        issues=[f"Collateral validation could not complete: {reason}"],
        corrective_actions=["Retry, or re-capture the collateral photo."],
    )


async def analyze_collateral(
    images: List[Asset],
    max_ornaments: int,
    foreign_pct: int,
) -> CollateralResult:
    """Validate the photos of one upload. Always returns exactly one image result per photo."""
    if not images:
        return CollateralResult(
            overall_status="alert", images=[],
            issues=["No collateral image was uploaded."],
            corrective_actions=["Capture at least one photo of the full ornament set."],
        )

    # Image decoding/re-encoding is CPU work — keep it off the event loop.
    blocks, unsupported = await asyncio.to_thread(_image_blocks, images)
    if not blocks:
        return _fallback(len(images), "unsupported image format")

    system = COLLATERAL_PROMPT.format(max_ornaments=max_ornaments, foreign_pct=foreign_pct)
    task = f"There are {len(images)} collateral image(s), indexed from 0. Validate each image."
    try:
        result = await run_converse(system, task, blocks, CollateralResult, max_tokens=3000)
    except Exception as exc:  # noqa: BLE001 — never block the workflow on a validator error
        logger.exception("Collateral agent failed")
        return _fallback(len(images), str(exc)[:160])

    return _normalize(result, len(images), unsupported, foreign_pct)


def _image_blocks(images: List[Asset]) -> Tuple[List[dict], Dict[int, str]]:
    blocks: List[dict] = []
    unsupported: Dict[int, str] = {}
    for idx, asset in enumerate(images):
        fmt = B.image_format(asset.content_type, asset.filename)
        if not fmt:
            unsupported[idx] = "Unsupported image format"
            continue
        blocks.append({"text": f"Collateral image index {idx}:"})
        blocks.append(B.image_block(asset.data, fmt))
    return blocks, unsupported


def _normalize(result: CollateralResult, count: int, unsupported: Dict[int, str], foreign_pct: int) -> CollateralResult:
    by_index: Dict[int, CollateralImageResult] = {}
    for img in result.images:
        if 0 <= img.index < count and img.index not in by_index and img.index not in unsupported:
            by_index[img.index] = img

    images: List[CollateralImageResult] = []
    for i in range(count):
        img = by_index.get(i) or _failed_image(i, unsupported.get(i, "No result returned for this photo"))
        # Enforce the numeric foreign-object threshold deterministically as a backstop.
        if img.foreign_object_percent > foreign_pct and img.status == "pass":
            img.status = "alert"
            img.no_foreign_objects = False
            img.issues = [f"Foreign objects ~{img.foreign_object_percent}% (limit {foreign_pct}%)", *img.issues]
        img.issues = short_list(img.issues)
        images.append(img)

    result.images = images
    statuses = [i.status for i in images]
    result.overall_status = "fail" if "fail" in statuses else "alert" if "alert" in statuses else "pass"
    result.issues = short_list(result.issues)
    result.corrective_actions = short_list(result.corrective_actions)
    return result


def crop_detections(result: CollateralResult, images: List[Asset]) -> int:
    """Crop and store a thumbnail for every detected ornament. Returns thumbnails created."""
    created = 0
    for img in result.images:
        asset = images[img.index] if 0 <= img.index < len(images) else None
        if asset is None or img.status == "fail":
            continue
        for item in img.items:
            png = crop_normalized(asset.data, item.box.model_dump())
            if png:
                item.thumb_asset_id = store.save_asset(png, "image/png")
                created += 1
    return created


async def validate_collateral(
    images: List[Asset],
    max_ornaments: int,
    foreign_pct: int,
    ornaments: Optional[list] = None,  # noqa: ARG001 — legacy v1 signature
) -> CollateralResult:
    """Legacy one-shot entry point (v1 orchestrator): analyze → crop."""
    result = await analyze_collateral(images, max_ornaments, foreign_pct)
    try:
        await asyncio.to_thread(crop_detections, result, images)
    except Exception:  # noqa: BLE001 — thumbnails are cosmetic; keep the validation result
        logger.exception("Collateral thumbnail cropping failed")
    return result

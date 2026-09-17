"""Collateral Image Validation agent.

Three phases so the chat timeline can show each one as it really happens:
  1. ``analyze_collateral`` — one multimodal call over all photos in the upload
  2. ``match_items``        — map detections to CBS inventory rows (conservative, kind-checked)
  3. ``crop_matched``       — crop a thumbnail for every newly verified item and store it
``validate_collateral`` chains all three for the legacy v1 orchestrator.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, Iterable, List, Optional, Tuple

from app import store
from app.agents.assets import Asset
from app.agents.prompts import COLLATERAL_PROMPT
from app.agents.trim import short_list
from app.bedrock import blocks as B
from app.bedrock.converse import run_converse
from app.bedrock.crop import crop_normalized
from app.schemas import CollateralImageResult, CollateralResult

logger = logging.getLogger("glportal.agents.collateral")

# Most specific first: "earring" contains "ring", "necklace" is not a "chain".
_KINDS = ("earring", "anklet", "bracelet", "bangle", "necklace", "pendant", "chain", "ring", "coin")


def ornament_kind(text: str) -> str:
    """Coarse physical kind from a label or declared name ('' when unknown)."""
    t = (text or "").lower()
    return next((k for k in _KINDS if k in t), "")


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
    inventory: Optional[list] = None,
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

    inv_hint = ", ".join(f"{_field(o, 'id')}={_field(o, 'name')}" for o in (inventory or [])) or "(none)"
    system = COLLATERAL_PROMPT.format(max_ornaments=max_ornaments, foreign_pct=foreign_pct, inventory=inv_hint)
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
        _sanitize_scale(img)
        images.append(img)

    result.images = images
    statuses = [i.status for i in images]
    result.overall_status = "fail" if "fail" in statuses else "alert" if "alert" in statuses else "pass"
    result.issues = short_list(result.issues)
    result.corrective_actions = short_list(result.corrective_actions)
    return result


def _sanitize_scale(img: CollateralImageResult) -> None:
    """A scale reading counts only when it is visible, numeric and plausible."""
    weight = img.scale_weight_g
    ok = img.status != "fail" and img.scale_reading_visible and weight is not None and 0 < weight <= 50_000
    if not ok:
        img.scale_reading_visible, img.scale_weight_g, img.scale_reading_text = False, None, ""
    else:
        img.scale_weight_g = round(weight, 3)
        img.scale_reading_text = " ".join(img.scale_reading_text.split())[:40]


def match_items(result: CollateralResult, inventory: list, already_sighted: Iterable[str] = ()) -> int:
    """Assign each detection in this upload to at most one CBS row. Returns matches to still-pending rows.

    Identical ornaments (two plain rings) can't be told apart in a photo, so matching is
    conservative: a detection of a kind first "uses up" rows of that kind that were ALREADY
    sighted in earlier uploads, and only then verifies a pending row. Photographing the same
    ring twice therefore never verifies a second ring. An explicit "no match" from the model
    (empty string) is respected, and detections in unusable ('fail') photos never match.
    """
    sighted = set(already_sighted)
    ids = [_field(o, "id") for o in inventory if _field(o, "id")]
    order = [i for i in ids if i in sighted] + [i for i in ids if i not in sighted]
    kind_of = {_field(o, "id"): ornament_kind(_field(o, "name")) for o in inventory}
    used: set = set()
    new_matches = 0

    for img in result.images:
        for item in img.items:
            candidate = item.matched_ornament_id
            item.matched_ornament_id = None
            if img.status == "fail" or candidate == "":
                continue
            valid_candidate = candidate if candidate in kind_of and candidate not in used else None
            kind = ornament_kind(item.label) or (kind_of[candidate] if candidate in kind_of else "")
            chosen = None
            if kind:
                chosen = next((oid for oid in order if oid not in used and kind_of[oid] == kind), None)
            if chosen is None and valid_candidate:
                # No row of the detected kind is left: trust the model only if the kinds don't
                # conflict, or the inventory has no rows of the detected kind at all
                # (e.g. a necklace the model described as a "chain").
                candidate_kind = kind_of[valid_candidate]
                kind_in_inventory = kind in kind_of.values()
                if not kind or not candidate_kind or candidate_kind == kind or not kind_in_inventory:
                    chosen = valid_candidate
            if chosen:
                item.matched_ornament_id = chosen
                used.add(chosen)
                if chosen not in sighted:
                    new_matches += 1
    return new_matches


def crop_matched(result: CollateralResult, images: List[Asset], skip_ids: Iterable[str] = ()) -> int:
    """Crop and store a thumbnail for every matched detection (except rows in ``skip_ids``,
    which already have one). Returns thumbnails created."""
    skip = set(skip_ids)
    created = 0
    for img in result.images:
        asset = images[img.index] if 0 <= img.index < len(images) else None
        if asset is None:
            continue
        for item in img.items:
            if not item.matched_ornament_id or item.matched_ornament_id in skip:
                continue
            png = crop_normalized(asset.data, item.box.model_dump())
            if png:
                item.thumb_asset_id = store.save_asset(png, "image/png")
                created += 1
    return created


async def validate_collateral(
    images: List[Asset],
    max_ornaments: int,
    foreign_pct: int,
    ornaments: Optional[list] = None,
) -> CollateralResult:
    """Legacy one-shot entry point (v1 orchestrator): analyze → match → crop."""
    result = await analyze_collateral(images, max_ornaments, foreign_pct, ornaments)
    try:
        match_items(result, ornaments or [])
        await asyncio.to_thread(crop_matched, result, images)
    except Exception:  # noqa: BLE001 — thumbnails are cosmetic; keep the validation result
        logger.exception("Collateral thumbnail mapping failed")
    return result

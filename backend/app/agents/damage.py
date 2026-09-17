"""Damage Assessment agent — one call per damaged ornament (fanned out in parallel by callers)."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.agents.assets import Asset
from app.agents.prompts import DAMAGE_PROMPT
from app.agents.trim import short, short_list
from app.bedrock import blocks as B
from app.bedrock.converse import run_converse
from app.schemas import DamageCapture, DamageReasoning, DamageResult

logger = logging.getLogger("glportal.agents.damage")


def describe_damage(damage_type: str, details: str) -> str:
    """The assessor's description as sent to the model, e.g. 'Dent — dent on inner rim'."""
    damage_type, details = (damage_type or "").strip(), (details or "").strip()
    if damage_type and details:
        return f"{damage_type} — {details}"
    return damage_type or details


def _fallback(ornament_id: str, described: str, reason: str) -> DamageResult:
    return DamageResult(
        ornament_id=ornament_id,
        status="fail",
        capture=DamageCapture(
            visible=False, inspectable=False, clear=False, no_obstruction=False, no_foreign_objects=False,
            issues=[f"Validator could not complete: {reason}"],
        ),
        reasoning=DamageReasoning(
            consistent_with_description=False,
            described_damage=described,
            notes=f"Assessment could not complete: {reason}",
        ),
        corrective_actions=["Retry, or re-capture the damage photo."],
    )


async def validate_damage(
    ornament_id: str,
    ornament_name: str,
    carat: str,
    described_damage: str,
    image: Optional[Asset],
) -> DamageResult:
    described = described_damage or "(no specific description recorded)"
    if image is None:
        return _fallback(ornament_id, described, "no damage image uploaded")

    fmt = B.image_format(image.content_type, image.filename)
    if not fmt:
        return _fallback(ornament_id, described, "unsupported image format")

    system = DAMAGE_PROMPT.format(cbs_damage=described.replace("{", "(").replace("}", ")"))
    task = (
        f"Damaged ornament id '{ornament_id}' (declared {carat}K {ornament_name}). "
        f"Assessor's recorded damage description: '{described}'. "
        "Set ornament_id in your response to exactly this id."
    )
    try:
        block = await asyncio.to_thread(B.image_block, image.data, fmt)
        result = await run_converse(system, task, [block], DamageResult)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Damage agent failed for %s", ornament_id)
        return _fallback(ornament_id, described, str(exc)[:160])

    result.ornament_id = ornament_id  # guard against the model altering the id
    result.capture.issues = short_list(result.capture.issues)
    result.reasoning.described_damage = described
    result.reasoning.observed_damage = short_list(result.reasoning.observed_damage, max_items=3)
    result.reasoning.additional_observations = short_list(result.reasoning.additional_observations)
    result.reasoning.notes = short(result.reasoning.notes, 18)
    result.corrective_actions = short_list(result.corrective_actions)
    return result

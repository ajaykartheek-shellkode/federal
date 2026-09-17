"""Validation Summary agent — consolidates specialist results (text-only call)."""

from __future__ import annotations

import json
import logging
from typing import Optional

from app.agents.prompts import SUMMARY_PROMPT
from app.agents.trim import short, short_list
from app.bedrock.converse import run_converse
from app.schemas import (
    CollateralResult,
    DocumentResult,
    SummaryResult,
)

logger = logging.getLogger("glbridge.agents.summary")


def _worst(*statuses: str) -> str:
    # fail (red) beats alert (yellow) beats pass (green)
    if any(s == "fail" for s in statuses):
        return "fail"
    if any(s == "alert" for s in statuses):
        return "alert"
    return "pass"


def _deterministic_summary(
    collateral: Optional[CollateralResult],
    damage_results: list,
    documents: Optional[DocumentResult],
) -> SummaryResult:
    """Fallback consolidation computed locally if the summary model call fails."""
    collateral_status = collateral.overall_status if collateral else "pass"
    damage_status = _worst(*[d.status for d in damage_results]) if damage_results else "pass"
    document_status = documents.overall_status if documents else "pass"

    issues: list[str] = []
    if collateral:
        issues += collateral.issues
    for d in damage_results:
        issues += d.capture.issues
        if not d.reasoning.consistent_with_description:
            issues.append(
                f"Damage evidence for {d.ornament_id} may not match the recorded description."
            )
    if documents:
        issues += documents.issues

    overall = _worst(collateral_status, damage_status, document_status)
    return SummaryResult(
        overall_status=overall,
        collateral_status=collateral_status,
        damage_status=damage_status,
        document_status=document_status,
        issues=short_list(issues, max_items=3, max_words=14),
        recommendations=(
            ["Review the flagged items; validation is advisory and does not block submission."]
            if overall == "alert"
            else ["All checks passed. You may proceed to generate the document."]
        ),
        narrative=(
            "Automated validation completed. "
            + ("Some items raised alerts — see details above." if overall == "alert"
               else "No issues were detected across collateral, damage, and documents.")
        ),
    )


async def summarize(
    collateral: Optional[CollateralResult],
    damage_results: list,
    documents: Optional[DocumentResult],
) -> SummaryResult:
    payload = {
        "collateral": collateral.model_dump() if collateral else None,
        "damage": [d.model_dump() for d in damage_results],
        "documents": documents.model_dump() if documents else None,
    }
    task = "Specialist results to consolidate:\n" + json.dumps(payload, separators=(",", ":"))
    try:
        result = await run_converse(SUMMARY_PROMPT, task, [], SummaryResult, max_tokens=1500)
        result.issues = short_list(result.issues, max_items=3, max_words=14)
        result.recommendations = short_list(result.recommendations, max_items=3, max_words=14)
        result.narrative = short(result.narrative, 40)
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("Summary agent failed, using deterministic consolidation: %s", exc)
        return _deterministic_summary(collateral, damage_results, documents)

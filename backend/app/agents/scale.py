"""Weighing-machine agent — reads the total off the display and splits it across the ornaments.

One short multimodal call per photo. The agent sees the machine photo and the pledge list built
from the collateral photo, reads the total, and apportions it over the listed ornament ids so the
assessor starts from a weight per piece instead of a blank column. A result is always returned, so
an unreadable display or a model failure never blocks the workflow (the assessor can type the
total, and every per-item weight stays editable).
"""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from app.agents.assets import Asset
from app.agents.prompts import SCALE_PROMPT
from app.agents.trim import short_list
from app.bedrock import blocks as B
from app.bedrock.converse import run_converse
from app.schemas import ItemWeight, ScaleResult

logger = logging.getLogger("glportal.agents.scale")

MAX_SCALE_G = 50_000
# The split is rebalanced onto the total, but a wildly different sum means the agent misread the
# list rather than the display, so the allocation is dropped instead of stretched to fit.
MAX_SPLIT_DRIFT = 0.6


def _unreadable(reason: str, status: str = "fail") -> ScaleResult:
    return ScaleResult(status=status, reading_visible=False, weight_g=None, reading_text="", issues=[reason])


def _pledge_list(inventory: List[dict]) -> str:
    lines = []
    for row in inventory:
        qty = int(row.get("quantity") or 1)
        lines.append(
            f"- id={row.get('id')} | {row.get('name', 'Ornament')}"
            f" | {row.get('material', 'gold')}" + (f" | quantity {qty}" if qty > 1 else "")
        )
    return "\n".join(lines)


async def read_scale(image: Asset, inventory: Optional[List[dict]] = None) -> ScaleResult:
    """Read the machine total and apportion it across the pledge list. Never raises."""
    inventory = list(inventory or [])
    fmt = await asyncio.to_thread(B.image_format, image.content_type, image.filename)
    if not fmt:
        return _unreadable("Unsupported image format")
    block = await asyncio.to_thread(B.image_block, image.data, fmt)
    prompt = "Read the total weight shown on the weighing machine."
    if inventory:
        prompt += (
            f"\n\nThese {len(inventory)} ornaments are on the pan — split the total across them:\n"
            + _pledge_list(inventory)
        )
    try:
        result = await run_converse(SCALE_PROMPT, prompt, [block], ScaleResult, max_tokens=1200)
    except Exception as exc:  # noqa: BLE001 — never block the workflow on a validator error
        logger.exception("Scale agent failed")
        return _unreadable(f"Could not read the display: {str(exc)[:120]}")
    return _normalize(result, inventory)


def _normalize(result: ScaleResult, inventory: List[dict]) -> ScaleResult:
    """A reading counts only when it is visible, numeric and plausible."""
    weight: Optional[float] = result.weight_g
    ok = result.reading_visible and weight is not None and 0 < weight <= MAX_SCALE_G
    if not ok:
        result.reading_visible, result.weight_g, result.reading_text = False, None, ""
        result.items = []
    else:
        result.weight_g = round(float(weight), 3)
        result.reading_text = " ".join(result.reading_text.split())[:40]
        result.items = _balance(result.items, result.weight_g, inventory)
    result.issues = short_list(result.issues)
    return result


def _balance(items: List[ItemWeight], total_g: float, inventory: List[dict]) -> List[ItemWeight]:
    """Keep one positive share per pledged ornament, scaled so the shares add up to the total.

    The agent judges the proportions; the arithmetic is ours. Anything it invented is dropped,
    anything it skipped is filled in with an even share, and the rounding remainder goes on the
    heaviest piece so the column always sums to what the display says.
    """
    if not inventory or total_g <= 0:
        return []
    shares: dict = {}
    for item in items:
        row_id = str(item.id or "").strip()
        try:
            grams = float(item.weight_g)
        except (TypeError, ValueError):
            continue
        if row_id and grams > 0:
            shares[row_id] = (grams, " ".join((item.basis or "").split())[:60])

    known = [str(r.get("id")) for r in inventory]
    allocated = {k: v for k, v in shares.items() if k in known}
    missing = [k for k in known if k not in allocated]
    if missing:
        # An even share of whatever the agent did not account for (at least a token gram each).
        spare = max(total_g - sum(g for g, _ in allocated.values()), 0.0)
        even = max(spare / len(missing), 0.001)
        for key in missing:
            allocated[key] = (even, "")

    raw_total = sum(g for g, _ in allocated.values())
    if raw_total <= 0:
        return []
    if abs(raw_total - total_g) / total_g > MAX_SPLIT_DRIFT:
        logger.warning("Scale split of %.2f g is far from the %.2f g total — dropping it", raw_total, total_g)
        return []

    factor = total_g / raw_total
    out = [
        ItemWeight(id=key, weight_g=round(allocated[key][0] * factor, 2), basis=allocated[key][1])
        for key in known
    ]
    drift = round(total_g - sum(i.weight_g for i in out), 2)
    if drift and out:
        heaviest = max(out, key=lambda i: i.weight_g)
        heaviest.weight_g = round(max(heaviest.weight_g + drift, 0.01), 2)
    return out

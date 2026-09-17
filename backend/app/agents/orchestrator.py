"""Orchestrator — central coordinator.

Receives the loan context + uploaded assets, routes them to the specialist agents,
runs them concurrently, streams progress as Server-Sent Events, then persists the run
(with saved image copies + pass/fail counts) for the date-basis and per-account reports:

    event: run-start      {agents:[...]}          # planned agent list up-front
    event: agent-start    {agent, ornamentId?, label}
    event: agent-result   {agent, ornamentId?, result}
    event: summary        {...SummaryResult}
    event: run-saved      {runId}                 # persisted for reporting
    event: done           {overallStatus}
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Dict, List, Optional, Tuple

from app.agents import collateral as collateral_agent
from app.agents import document as document_agent
from app.agents import damage as damage_agent
from app.agents import summary as summary_agent
from app.agents.assets import Asset
from app.schemas import ValidatePayload
from app.settings import Settings
from app import store


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class _Plan:
    """Describes one damage sub-agent invocation."""

    def __init__(self, ornament_id: str, name: str, carat: str, cbs: str, image: Optional[Asset]):
        self.ornament_id = ornament_id
        self.name = name
        self.carat = carat
        self.cbs = cbs
        self.image = image


def _count_statuses(statuses: List[str]) -> Dict[str, int]:
    out = {"pass": 0, "alert": 0, "fail": 0}
    for s in statuses:
        if s in out:
            out[s] += 1
    return out


async def run(
    payload: ValidatePayload,
    collateral_images: List[Asset],
    damage_images: Dict[int, Asset],
    document_assets: Dict[int, Asset],
    settings: Settings,
    now_iso: str,
) -> AsyncGenerator[str, None]:
    # ------------------------------------------------------------------ plan
    damage_plans: List[_Plan] = [
        _Plan(
            o.id,
            o.name,
            o.carat,
            o.damage_details,
            damage_images.get(o.damage_image_index) if o.damage_image_index is not None else None,
        )
        for o in payload.ornaments
        if o.damage_visible
    ]
    docs: List[Tuple[int, str, Asset]] = [
        (d.doc_no, d.doc_type, document_assets[d.file_index])
        for d in payload.documents
        if d.file_index in document_assets
    ]

    planned = [{"agent": "collateral", "label": "Collateral Image Validation"}]
    for p in damage_plans:
        planned.append(
            {"agent": "damage", "ornamentId": p.ornament_id, "label": f"Damage Assessment · {p.name}"}
        )
    if docs:
        planned.append({"agent": "document", "label": "Document Validation"})
    planned.append({"agent": "summary", "label": "Validation Summary"})

    yield _sse("run-start", {"agents": planned})

    # ------------------------------------------------- launch specialists together
    queue: asyncio.Queue = asyncio.Queue()

    async def wrap_collateral():
        await queue.put(_sse("agent-start", {"agent": "collateral", "label": "Collateral Image Validation"}))
        res = await collateral_agent.validate_collateral(
            collateral_images,
            settings.max_ornaments_per_image,
            settings.foreign_object_threshold_pct,
            [o.model_dump() for o in payload.ornaments],
        )
        await queue.put(_sse("agent-result", {"agent": "collateral", "result": res.model_dump()}))
        return ("collateral", res)

    async def wrap_damage(p: _Plan):
        await queue.put(
            _sse("agent-start", {"agent": "damage", "ornamentId": p.ornament_id, "label": f"Damage Assessment · {p.name}"})
        )
        res = await damage_agent.validate_damage(p.ornament_id, p.name, p.carat, p.cbs, p.image)
        await queue.put(
            _sse("agent-result", {"agent": "damage", "ornamentId": p.ornament_id, "result": res.model_dump()})
        )
        return ("damage", res)

    async def wrap_document():
        await queue.put(_sse("agent-start", {"agent": "document", "label": "Document Validation"}))
        res = await document_agent.validate_documents(
            docs,
            {
                "customer_name": payload.loan_context.customer_name,
                "customer_id": payload.loan_context.customer_id,
            },
        )
        await queue.put(_sse("agent-result", {"agent": "document", "result": res.model_dump()}))
        return ("document", res)

    tasks: List[asyncio.Task] = [asyncio.create_task(wrap_collateral())]
    for p in damage_plans:
        tasks.append(asyncio.create_task(wrap_damage(p)))
    if docs:
        tasks.append(asyncio.create_task(wrap_document()))

    gather_task = asyncio.gather(*tasks)

    while not gather_task.done() or not queue.empty():
        try:
            frame = await asyncio.wait_for(queue.get(), timeout=0.2)
            yield frame
        except asyncio.TimeoutError:
            continue

    results = await gather_task

    collateral_result = next((r for (kind, r) in results if kind == "collateral"), None)
    damage_results = [r for (kind, r) in results if kind == "damage"]
    document_result = next((r for (kind, r) in results if kind == "document"), None)

    # ------------------------------------------------------------- summary agent
    yield _sse("agent-start", {"agent": "summary", "label": "Validation Summary"})
    summary = await summary_agent.summarize(collateral_result, damage_results, document_result)
    yield _sse("summary", summary.model_dump())

    # ------------------------------------------------- persist the run + assets
    try:
        run_id = await asyncio.to_thread(
            _persist_run,
            payload,
            collateral_images,
            damage_plans,
            docs,
            collateral_result,
            damage_results,
            document_result,
            summary,
            now_iso,
        )
        yield _sse("run-saved", {"runId": run_id})
    except Exception:  # noqa: BLE001 — reporting persistence must never break the response
        pass

    yield _sse("done", {"overallStatus": summary.overall_status})


def _persist_run(
    payload: ValidatePayload,
    collateral_images: List[Asset],
    damage_plans: List[_Plan],
    docs: List[Tuple[int, str, Asset]],
    collateral_result,
    damage_results: list,
    document_result,
    summary,
    now_iso: str,
) -> str:
    """Save images as assets and write the run record with pass/fail counts."""
    run_id = uuid.uuid4().hex
    date = now_iso[:10]  # YYYY-MM-DD

    # ---- collateral images + per-image statuses
    collateral_entries = []
    img_status_by_index = {i.index: i.status for i in (collateral_result.images if collateral_result else [])}
    for idx, asset in enumerate(collateral_images):
        collateral_entries.append(
            {
                "index": idx,
                "asset_id": store.save_asset(asset.data, asset.content_type),
                "filename": asset.filename,
                "status": img_status_by_index.get(idx, "fail"),
            }
        )

    # ---- damage images + statuses (keyed by ornament)
    damage_status = {d.ornament_id: d.status for d in damage_results}
    damage_entries = []
    for p in damage_plans:
        damage_entries.append(
            {
                "ornament_id": p.ornament_id,
                "ornament_name": p.name,
                "asset_id": store.save_asset(p.image.data, p.image.content_type) if p.image else None,
                "status": damage_status.get(p.ornament_id, "fail"),
                "described_damage": p.cbs,
            }
        )

    # ---- documents + statuses
    doc_status = {d.doc_no: d.status for d in (document_result.documents if document_result else [])}
    document_entries = []
    for (doc_no, doc_type, asset) in docs:
        document_entries.append(
            {
                "doc_no": doc_no,
                "doc_type": doc_type,
                "asset_id": store.save_asset(asset.data, asset.content_type),
                "filename": asset.filename,
                "status": doc_status.get(doc_no, "fail"),
            }
        )

    counts = {
        "collateral": _count_statuses([e["status"] for e in collateral_entries]),
        "damage": _count_statuses([e["status"] for e in damage_entries]),
        "document": _count_statuses([e["status"] for e in document_entries]),
    }

    record = {
        "id": run_id,
        "created_at": now_iso,
        "date": date,
        "loan": payload.loan_context.model_dump(),
        "overall_status": summary.overall_status,
        "summary": summary.model_dump(),
        "collateral_images": collateral_entries,
        "damage_images": damage_entries,
        "documents": document_entries,
        "counts": counts,
    }
    store.save_run(record)
    return run_id

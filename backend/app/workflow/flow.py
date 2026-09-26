"""Workflow step handlers — run one action on a session and stream progress events.

Events (Server-Sent Events, emitted through ``emit(event, data)``):
  exec-step   {run_id, agent, index, total, key, label, status: active|done|error, elapsed_ms?}
  exec-done   {run_id, agent, status: pass|alert|fail|not_checked|info|error, summary, total_ms}
  state       {session}                      # full client view after the step
  agent-msg   {text}                         # the Verification Agent's message
  notice      {level: info|warn|error, text}
  error       {error}
  done        {}

Each exec step is bound to real work: storage, the model call, matching, cropping,
persistence. Checks that are facets of a single model response tick through with short
pacing so the assessor can follow along (TDD NFR "steps visible").
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable, List, Optional

from app import session as session_store
from app import steps as STEPS
from app import store
from app.agents import collateral as collateral_agent
from app.agents import conversation
from app.agents import damage as damage_agent
from app.agents import document as document_agent
from app.agents import scale as scale_agent
from app.agents.assets import Asset
from app.bedrock.imageprep import thumbnail
from app.integrations import caratmeter
from app.settings import Settings
from app.workflow import state as S

logger = logging.getLogger("glportal.flow")

Emit = Callable[[str, dict], Awaitable[None]]


@dataclass
class DamageUpload:
    ornament_id: str
    type: str
    severity: str
    damage_percent: float
    details: str
    image: Asset


@dataclass
class DocumentUpload:
    declared_type: str
    file: Asset


@dataclass
class StepInput:
    collateral: List[Asset] = field(default_factory=list)
    scale: Optional[Asset] = None
    damage: List[DamageUpload] = field(default_factory=list)
    documents: List[DocumentUpload] = field(default_factory=list)


@dataclass
class StepContext:
    state: dict
    settings: Settings
    emit: Emit
    inputs: StepInput

    @property
    def ai(self) -> bool:
        return bool(self.state.get("ai_enabled", True))

    async def push_state(self) -> None:
        await self.emit("state", {"session": S.view(self.state, self.settings)})

    async def say(self, step: str, facts: dict) -> None:
        text = await conversation.guidance(step, facts, self.ai)
        await self.emit("agent-msg", {"text": text})

    async def save(self) -> None:
        await asyncio.to_thread(session_store.save, self.state)


class ExecRun:
    """One "Agent Executing" card: labelled steps with real timings."""

    def __init__(self, ctx: StepContext, agent: str, defs: List[dict]):
        self.ctx = ctx
        self.agent = agent
        self.id = uuid.uuid4().hex[:10]
        self.defs = {d["key"]: (i, d["label"]) for i, d in enumerate(defs)}
        self.total = len(defs)
        self.log: List[dict] = []
        self.started = time.monotonic()

    async def step(self, key: str, work: Optional[Awaitable] = None, pace_ms: int = 140):
        index, label = self.defs[key]
        base = {"run_id": self.id, "agent": self.agent, "index": index, "total": self.total, "key": key, "label": label}
        await self.ctx.emit("exec-step", {**base, "status": "active"})
        t0 = time.monotonic()
        try:
            if work is None:
                result = await asyncio.sleep(pace_ms / 1000)
            else:
                result = await work
        except Exception:
            await self.ctx.emit("exec-step", {**base, "status": "error", "elapsed_ms": _ms(t0)})
            await self.ctx.emit("exec-done", {
                "run_id": self.id, "agent": self.agent, "status": "error",
                "summary": f"Stopped at: {label}", "total_ms": _ms(self.started),
            })
            raise
        elapsed = _ms(t0)
        self.log.append({"key": key, "label": label, "elapsed_ms": elapsed})
        await self.ctx.emit("exec-step", {**base, "status": "done", "elapsed_ms": elapsed})
        return result

    async def finish(self, status: str, summary: str) -> None:
        await self.ctx.emit("exec-done", {
            "run_id": self.id, "agent": self.agent, "status": status, "summary": summary, "total_ms": _ms(self.started),
        })
        try:
            await asyncio.to_thread(store.save_agent_log, self.ctx.state["session_id"], self.agent, self.log)
        except Exception:  # noqa: BLE001 — the execution log is diagnostic only
            logger.warning("Could not persist agent log for %s", self.agent)


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


def _store_uploads(files: List[Asset]) -> List[dict]:
    return [
        {"asset_id": store.save_asset(f.data, f.content_type), "filename": f.filename, "content_type": f.content_type}
        for f in files
    ]


def _store_thumbnails(files: List[Asset]) -> List[Optional[str]]:
    out: List[Optional[str]] = []
    for f in files:
        thumb = thumbnail(f.data)
        out.append(store.save_asset(thumb, "image/jpeg") if thumb else None)
    return out


async def _value(fn: Callable, *args):
    """Run a quick synchronous function as an awaitable step."""
    return fn(*args)


# --------------------------------------------------------------------------- collateral
async def _collateral(ctx: StepContext) -> None:
    """The collateral photo is the source of the inventory: every ornament detected becomes a row."""
    state, settings, photos = ctx.state, ctx.settings, ctx.inputs.collateral
    ex = ExecRun(ctx, "collateral", STEPS.COLLATERAL_STEPS if ctx.ai else STEPS.COLLATERAL_MANUAL_STEPS)
    stored = await ex.step("receive", asyncio.to_thread(_store_uploads, photos))

    added = 0
    if ctx.ai:
        result = await ex.step("vision", collateral_agent.analyze_collateral(
            photos, settings.max_ornaments_per_image, settings.foreign_object_threshold_pct,
        ))
        await ex.step("detect")
        await ex.step("count")
        await ex.step("visibility")
        await ex.step("foreign")
        await ex.step("background")
        await ex.step("crop", asyncio.to_thread(collateral_agent.crop_detections, result, photos))
        added = await ex.step("inventory", _value(S.record_collateral, state, stored, result.model_dump()))
    else:
        await ex.step("record")
        S.record_collateral(state, stored, None)

    advanced = S.collateral_complete(state) and not S.stage_blockers(state, "collateral", S.blocker_of(state, settings))
    if advanced:
        state["workflow_state"] = S.next_state(state, "collateral")
    await ex.step("result", ctx.save())

    latest = state["collateral"]["images"][-len(photos):]
    status = S.worst(im["status"] for im in latest) or "not_checked"
    items = state["inventory"]
    photo_count = f"{len(photos)} photo{'s' if len(photos) != 1 else ''}"
    await ex.finish(status, f"{len(items)} ornament{'s' if len(items) != 1 else ''} listed · {photo_count}")
    await ctx.push_state()

    flagged = next((im for im in latest if im["status"] in ("alert", "fail") and im["issues"]), None)
    await ctx.say("collateral", {
        "ai_enabled": ctx.ai,
        "advanced": advanced,
        "added": added,
        "total": len(items),
        "names": [r["name"] for r in items],
        "flagged_photo": (flagged["index"] + 1) if flagged else None,
        "first_issue": flagged["issues"][0] if flagged else "",
        "blocker": S.blocker_of(state, settings),
    })


# --------------------------------------------------------------------------- weighing machine
async def _scale_photo(ctx: StepContext) -> None:
    """The weighing-machine photo: the total on the display, apportioned across the ornaments."""
    state, photo = ctx.state, ctx.inputs.scale
    if not state["inventory"]:
        raise S.WorkflowError("Upload the collateral photo first — there is nothing on the pledge list to weigh.")
    ex = ExecRun(ctx, "scale", STEPS.SCALE_STEPS if ctx.ai else STEPS.SCALE_MANUAL_STEPS)
    stored = await ex.step("receive", asyncio.to_thread(_store_uploads, [photo]))

    result, filled = None, 0
    if ctx.ai:
        reading = await ex.step("read", scale_agent.read_scale(photo, state["inventory"]))
        result = reading.model_dump()
        S.record_scale_photo(state, stored[0], result)
        filled = await ex.step("allocate", _value(S.apply_weight_split, state, result.get("items") or []))
    else:
        S.record_scale_photo(state, stored[0], None)
    await ex.step("result", ctx.save())

    weight = S.weight_summary(state)
    read_ok = weight["scale_g"] is not None
    status = "pass" if read_ok and weight["scale_status"] != "mismatch" else "alert" if read_ok else "fail"
    summary = (
        f"{weight['scale_g']:.2f} g on the machine, split across {filled} ornament(s)" if read_ok and filled
        else f"{weight['scale_g']:.2f} g on the machine" if read_ok
        else "Display not readable"
    )
    await ex.finish(status if ctx.ai else "not_checked", summary)
    await ctx.push_state()
    await ctx.say("scale", {
        "ai_enabled": ctx.ai,
        "scale_g": weight["scale_g"],
        "entered_g": weight["entered_g"],
        "unweighed": weight["unweighed"],
        "apportioned": filled,
        "items": len(state["inventory"]),
        "differs": weight["scale_status"] == "mismatch",
        "diff_g": weight["scale_diff_g"],
        "first_issue": (result or {}).get("issues", [""])[0] if (result or {}).get("issues") else "",
        "measured": bool(state.get("measurements")),
    })


# --------------------------------------------------------------------------- weight & purity
async def _measure(ctx: StepContext) -> None:
    """One CaratMeter request for this loan application, covering every ornament id."""
    state, settings = ctx.state, ctx.settings
    loan = state["loan"]
    branch, reference = loan.get("branch", ""), S.application_ref(state)
    if not state["inventory"]:
        raise S.WorkflowError("There are no ornaments to measure yet.")
    missing = S.unweighed_items(state)
    if missing:
        names = ", ".join(r["name"] for r in missing[:3]) + ("…" if len(missing) > 3 else "")
        raise S.WorkflowError(
            f"{len(missing)} ornament(s) have no weight yet ({names}). Upload the weighing-machine "
            "photo, or type the weights on the pledge list, before requesting the readings."
        )

    ex = ExecRun(ctx, "weight", STEPS.WEIGHT_STEPS)
    try:
        await ex.step("connect", caratmeter.status(branch))
        payload = await ex.step(
            "request", caratmeter.measure(branch, reference, state["inventory"], loan.get("customer_id", "")),
        )
    except caratmeter.CaratMeterError as exc:
        await ctx.push_state()
        await ctx.emit("notice", {"level": "error", "text": str(exc)})
        await ctx.emit("agent-msg", {"text": conversation.draft("weight_error", {"error": str(exc)})})
        return
    await ex.step("grade", _value(S.record_measurements, state, payload))
    weight = await ex.step("crosscheck", _value(S.weight_summary, state))
    valuation = await ex.step("valuation", _value(S.valuation_view, state))

    blocker = S.blocker_of(state, settings)
    advanced = S.weight_complete(state) and not S.stage_blockers(state, "weight", blocker)
    if advanced:
        state["workflow_state"] = S.next_state(state, "weight")
    await ex.step("result", ctx.save())

    flagged = S.unresolved_measurements(state)
    totals = valuation["totals"]
    status = "alert" if flagged else "pass"
    measured = state["measurements"]["count"]
    summary = f"{measured}/{len(state['inventory'])} ornaments assayed"
    await ex.finish(status, summary + (f" · {len(flagged)} to review" if flagged else ""))
    await ctx.push_state()
    grades = [r["measurement"]["grade"] for r in state["inventory"] if (r.get("measurement") or {}).get("grade")]
    await ctx.say("weight", {
        "advanced": advanced,
        "total": len(state["inventory"]),
        "measured": measured,
        "grades": sorted(set(grades)),
        "flagged": [r["name"] for r in flagged],
        "scale_g": weight["scale_g"],
        "entered_g": weight["entered_g"],
        "scale_differs": weight["scale_status"] == "mismatch" and not weight["scale_overridden"],
        "scale_missing": weight["scale_status"] in ("pending", "missing") and not weight["scale_overridden"],
        "pledge_amount": totals["pledge_amount"],
        "blocker": blocker,
    })


# --------------------------------------------------------------------------- damage
async def _damage(ctx: StepContext) -> None:
    state, uploads = ctx.state, ctx.inputs.damage
    ex = ExecRun(ctx, "damage", STEPS.DAMAGE_STEPS if ctx.ai else STEPS.DAMAGE_MANUAL_STEPS)
    images = [u.image for u in uploads]
    stored = await ex.step("receive", asyncio.to_thread(_store_uploads, images))

    results: List[Optional[object]] = [None] * len(uploads)
    if ctx.ai:
        calls = []
        for u in uploads:
            row = S.find_item(state, u.ornament_id)
            calls.append(damage_agent.validate_damage(
                u.ornament_id, row["name"], row.get("carat") or "", damage_agent.describe_damage(u.type, u.details), u.image,
            ))
        results = await ex.step("detect", asyncio.gather(*calls))
        await ex.step("type")
        await ex.step("severity")
        await ex.step("match")
    thumbs = await ex.step("thumb", asyncio.to_thread(_store_thumbnails, images))

    for u, meta, thumb, res in zip(uploads, stored, thumbs, results):
        row = S.find_item(state, u.ornament_id)
        S.record_damage(state, {
            "ornament_id": u.ornament_id,
            "item": row["name"],
            "type": u.type,
            "severity": u.severity,
            "damage_percent": u.damage_percent,
            "assessor_details": u.details,
            "asset_id": meta["asset_id"],
            "thumb_asset_id": thumb or meta["asset_id"],
            "filename": meta["filename"],
            "status": res.status if res else "not_checked",
            "consistent": res.reasoning.consistent_with_description if res else None,
            "observed": res.reasoning.observed_damage if res else [],
            "additional": res.reasoning.additional_observations if res else [],
            "assessed_severity": res.reasoning.assessed_severity if res else None,
            "notes": res.reasoning.notes if res else "",
            "capture_issues": res.capture.issues if res else [],
            "corrective_actions": res.corrective_actions if res else [],
        })
    await ex.step("update", ctx.save())

    statuses = [r.status for r in results if r]
    review = sum(1 for s in statuses if s != "pass")
    summary = f"{len(uploads)} item{'s' if len(uploads) != 1 else ''} analysed" + (f" · {review} to review" if review else "")
    await ex.finish(S.worst(statuses) or "not_checked", summary if ctx.ai else f"{len(uploads)} recorded")
    await ctx.push_state()
    following = S.next_state(state, "damage")
    await ctx.say("damage", {
        "ai_enabled": ctx.ai,
        "recorded": [S.find_item(state, u.ornament_id)["name"] for u in uploads],
        "needs_review": review,
        "deduction": round(sum(u.damage_percent for u in uploads), 2),
        "next_label": "pledge valuation" if following == "valuation" else "documents",
    })


# --------------------------------------------------------------------------- documents
async def _document(ctx: StepContext) -> None:
    state, settings, uploads = ctx.state, ctx.settings, ctx.inputs.documents
    ex = ExecRun(ctx, "document", STEPS.DOCUMENT_STEPS if ctx.ai else STEPS.DOCUMENT_MANUAL_STEPS)
    stored = await ex.step("receive", asyncio.to_thread(_store_uploads, [u.file for u in uploads]))
    meta = [
        {"doc_no": i + 1, "declared_type": u.declared_type, **stored[i]}
        for i, u in enumerate(uploads)
    ]

    if ctx.ai:
        loan = state["loan"]
        cbs = {"customer_name": loan.get("customer_name", ""), "id_number": loan.get("id_number", ""), "address": loan.get("address", "")}
        result = await ex.step("verify", document_agent.validate_documents(
            [(m["doc_no"], m["declared_type"], u.file) for m, u in zip(meta, uploads)], cbs,
        ))
        for key in ("complete", "legible", "ocr", "name", "id"):
            await ex.step(key)
        await ex.step("address", _value(document_agent.apply_cbs_checks, result, cbs, settings.doc_match_threshold_pct))
        S.record_documents(state, meta, result.model_dump())
    else:
        S.record_documents(state, meta, None)

    blocked = S.stage_blockers(state, "document", S.blocker_of(state, settings))
    state["workflow_state"] = "document" if blocked else "report"
    await ex.step("result", ctx.save())

    docs = S.document_items(state)
    status = S.worst(d["status"] for d in docs) or "not_checked"
    first = docs[0] if docs else {}
    await ex.finish(status, f"{len(docs)} document{'s' if len(docs) != 1 else ''} · {first.get('doc_type_detected') or first.get('declared_type', '')}")
    await ctx.push_state()
    first_issue = next((i for d in docs for i in d["issues"]), "")
    await ctx.say("document", {
        "ai_enabled": ctx.ai,
        "count": len(docs),
        "status": status,
        "detected": first.get("doc_type_detected") or first.get("declared_type"),
        "first_issue": first_issue,
    })


# --------------------------------------------------------------------------- continue / report
async def _continue(ctx: StepContext) -> None:
    try:
        to = S.advance(ctx.state, S.blocker_of(ctx.state, ctx.settings))
    except S.WorkflowError as exc:
        await ctx.push_state()
        await ctx.emit("notice", {"level": "warn", "text": str(exc)})
        await ctx.emit("agent-msg", {"text": conversation.draft("blocked", {"reasons": [str(exc)]})})
        return
    await ctx.save()
    await ctx.push_state()
    await ctx.say("continue", {"to": to})


async def _report(ctx: StepContext) -> None:
    state = ctx.state
    g = S.gate(state, S.blocker_of(state, ctx.settings))
    if not g["allowed"]:
        await ctx.push_state()
        await ctx.emit("notice", {"level": "warn", "text": " ".join(g["reasons"])})
        await ctx.emit("agent-msg", {"text": conversation.draft("blocked", {"reasons": g["reasons"]})})
        return

    defs = STEPS.REPORT_STEPS if S.uses_weight(state) else [d for d in STEPS.REPORT_STEPS if d["key"] != "weight"]
    ex = ExecRun(ctx, "report", defs)
    for d in defs[:-2]:
        await ex.step(d["key"], pace_ms=180)
    report = await ex.step("recommend", _value(S.build_report, state))
    state["report"] = report
    state["workflow_state"] = "done"
    # A sanctioned application becomes a gold loan: the account number is issued here.
    issued = None
    if report["recommendation"] == "PROCEED" and S.is_fresh_application(state):
        issued = await asyncio.to_thread(_issue_loan_account, state)
    await ex.step("render", asyncio.to_thread(_persist_report, state))

    warnings = sum(1 for r in report["reasons"] if r["level"] == "warn")
    await ex.finish(
        "pass" if report["recommendation"] == "PROCEED" else "alert",
        f"{report['recommendation']} · {warnings} point{'s' if warnings != 1 else ''} to review",
    )
    await ctx.push_state()
    await ctx.say("report", {
        "report_id": report["report_id"], "recommendation": report["recommendation"], "warnings": warnings,
        "pledge_amount": report["stats"]["pledge_amount"],
        "account_number": issued,
        "application_no": state["loan"].get("application_no", ""),
        "fresh": S.is_fresh_application(state),
    })


def _issue_loan_account(state: dict) -> Optional[str]:
    """Open the gold loan account for a sanctioned application (portal-issued running number)."""
    return S.record_loan_account(state, store.next_account_number(state["loan"].get("branch", "")))


def _persist_report(state: dict) -> None:
    store.save_run(S.run_record(state))
    session_store.save(state)


HANDLERS = {
    "collateral": _collateral,
    "scale_photo": _scale_photo,
    "measure": _measure,
    "damage": _damage,
    "document": _document,
    "continue": _continue,
    "report": _report,
}


async def run_action(state: dict, action: str, inputs: StepInput, settings: Settings, emit: Emit) -> None:
    """Execute one action end-to-end. Never raises: failures become error/notice events."""
    ctx = StepContext(state=state, settings=settings, emit=emit, inputs=inputs)
    try:
        S.require_action(state, action)
        await HANDLERS[action](ctx)
    except S.WorkflowError as exc:
        await emit("notice", {"level": "warn", "text": str(exc)})
    except session_store.ConflictError as exc:
        await emit("error", {"error": str(exc)})
    except Exception:  # noqa: BLE001
        logger.exception("Workflow action '%s' failed for session %s", action, state.get("session_id"))
        await emit("error", {"error": "Something went wrong while processing this step, so it was not completed. Please retry."})
    finally:
        await emit("done", {})

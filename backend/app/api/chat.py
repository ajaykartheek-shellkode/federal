"""Conversational verification API (frontend-v2).

  POST /api/chat/start                {account}   account no., CIF, mobile or ID proof
                                                                 -> {session, message}
  POST /api/chat/application          {name, mobile, id_number, address, branch}  new customer
                                                                 -> {session, message}
  GET  /api/chat/session/{id}                                    -> {session}
  GET  /api/chat/sessions?open_only=true&limit=20                -> {sessions}
  POST /api/chat/step                 multipart (see below)      -> text/event-stream
  POST /api/chat/answer               {session_id, question}     -> {text}
  POST /api/chat/override             {session_id, target, ref, justification} -> {session, entry}
  POST /api/chat/edit                 {session_id, ref, changes, justification} -> {session, entry}
  POST /api/chat/scale                {session_id, weight_g, justification}     -> {session, entry}
  POST /api/chat/item                 {session_id, name, material, quantity, weight_gm} -> {session, item}
  POST /api/chat/item/remove          {session_id, ref, justification}          -> {session, entry}
  POST /api/chat/weight               {session_id, ref, weight_gm, justification} -> {session, entry}

/step form fields: session_id, action (collateral|scale_photo|measure|damage|document|continue|report),
damage_hints (JSON [{ornament_id, type, severity, damage_percent, details}] aligned with damage_images),
document_types (JSON [type] aligned with documents), collateral_images[], scale_image[],
damage_images[], documents[].
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import cbs
from app import session as session_store
from app import store
from app.agents import conversation
from app.agents.assets import Asset
from app.bedrock import blocks as B
from app.config import (
    MAX_COLLATERAL_PHOTOS_PER_UPLOAD,
    MAX_DAMAGE_ITEMS_PER_UPLOAD,
    MAX_DOCUMENTS_PER_UPLOAD,
    MAX_UPLOAD_BYTES,
)
from app.settings import get_settings
from app.workflow import flow
from app.workflow import state as S

logger = logging.getLogger("glportal.api.chat")
router = APIRouter(prefix="/api/chat", tags=["chat"])

_background: Set[asyncio.Task] = set()
_KEEPALIVE_S = 15.0


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra: Any):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra

    def response(self) -> JSONResponse:
        return JSONResponse(status_code=self.status, content={"error": self.message, **self.extra})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


async def _load(session_id: Optional[str]) -> dict:
    state = await asyncio.to_thread(session_store.load, session_id)
    if state is None:
        raise ApiError(404, "This verification session was not found. Start a new verification.")
    return state


# --------------------------------------------------------------------------- start / restore
class StartBody(BaseModel):
    account: str = Field(default="", max_length=64)


@router.post("/start")
async def start(body: StartBody):
    """Open a verification: a new application for a fresh loan, or an existing loan account."""
    query = (body.account or "").strip()
    if not query:
        return ApiError(400, "Enter the customer's CIF, mobile or ID number — or an existing loan account.").response()

    customer = await asyncio.to_thread(cbs.find_customer, query)
    if customer is None:
        samples = await asyncio.to_thread(cbs.sample_accounts)
        return ApiError(404, f"No customer matching '{query}' was found in CBS.", samples=samples).response()

    settings = await asyncio.to_thread(get_settings)
    loan = customer["loan_context"]
    ai_enabled = settings.is_enabled_for(loan.get("scenario", ""))
    # A fresh loan has no account yet, so the portal opens an application for it.
    fresh = loan.get("scenario", "") == "Fresh Loan"
    application_no = await asyncio.to_thread(store.next_application_no, loan.get("branch", "")) if fresh else ""
    state = S.new_state(customer, ai_enabled, settings.blocker_mode, settings.valuation_snapshot(), application_no)
    await asyncio.to_thread(session_store.create, state)

    message = await conversation.guidance("welcome", {
        "customer": loan.get("customer_name", ""),
        "scenario": loan.get("scenario", ""),
        "branch": loan.get("branch", ""),
        "application_no": application_no,
        "account_number": "" if fresh else loan.get("account_number", ""),
        "ai_enabled": ai_enabled,
    }, ai_enabled)
    return {"session": S.view(state, settings), "message": message}


class NewCustomerBody(BaseModel):
    name: str = Field(default="", max_length=120)
    mobile: str = Field(default="", max_length=24)
    id_number: str = Field(default="", max_length=64)
    address: str = Field(default="", max_length=300)
    branch: str = Field(default="", max_length=32)


@router.post("/application")
async def open_application(body: NewCustomerBody):
    """Open a gold loan application for a customer the branch is onboarding at the counter."""
    name = " ".join(body.name.split())
    mobile_digits = cbs.digits_of(body.mobile)
    id_number = " ".join(body.id_number.split())
    branch = " ".join(body.branch.split()).upper()
    if not 2 <= len(name) <= 120:
        return ApiError(400, "Enter the customer's name.").response()
    if not 10 <= len(mobile_digits) <= 15:
        return ApiError(400, "Enter a valid mobile number.").response()
    if not 6 <= len(id_number) <= 40:
        return ApiError(400, "Enter the customer's ID number (Aadhaar, PAN, passport…).").response()
    if not 3 <= len(branch) <= 32:
        return ApiError(400, "Enter the branch code, e.g. FED-MUM-001.").response()

    existing = await asyncio.to_thread(cbs.find_customer, mobile_digits)
    if existing is not None:
        return ApiError(
            409,
            f"{existing['loan_context']['customer_name']} already exists in CBS on that mobile number. "
            "Search for them instead.",
        ).response()

    settings = await asyncio.to_thread(get_settings)
    application_no = await asyncio.to_thread(store.next_application_no, branch)
    customer = await asyncio.to_thread(
        cbs.create_customer,
        name=name, mobile=body.mobile, id_number=id_number, address=body.address, branch=branch,
        application_no=application_no,
    )
    loan = customer["loan_context"]
    ai_enabled = settings.is_enabled_for(loan.get("scenario", ""))
    state = S.new_state(customer, ai_enabled, settings.blocker_mode, settings.valuation_snapshot(), application_no)
    await asyncio.to_thread(session_store.create, state)

    message = await conversation.guidance("welcome", {
        "customer": name,
        "scenario": loan.get("scenario", ""),
        "branch": branch,
        "application_no": application_no,
        "new_customer": True,
        "ai_enabled": ai_enabled,
    }, ai_enabled)
    return {"session": S.view(state, settings), "message": message}


@router.get("/sessions")
async def list_sessions(open_only: bool = True, limit: int = Query(20, ge=1, le=100)):
    return {"sessions": await asyncio.to_thread(session_store.list_recent, limit, open_only)}


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    try:
        state = await _load(session_id)
    except ApiError as exc:
        return exc.response()
    settings = await asyncio.to_thread(get_settings)
    return {"session": S.view(state, settings)}


# --------------------------------------------------------------------------- step (SSE)
async def _read(files: List[UploadFile]) -> List[Asset]:
    out: List[Asset] = []
    for f in files:
        data = await f.read(MAX_UPLOAD_BYTES + 1)
        name = f.filename or "upload"
        if not data:
            raise ApiError(400, f"'{name}' is empty.")
        if len(data) > MAX_UPLOAD_BYTES:
            raise ApiError(413, f"'{name}' is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
        out.append(Asset(data=data, filename=name, content_type=(f.content_type or "").lower()))
    return out


_PIL_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _check_image(asset: Asset) -> None:
    """Accept only real JPEG/PNG/WebP bytes and pin the stored content type to the decoded format
    (never the client's claim), so an upload can't be served back as HTML."""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(asset.data)) as img:
            fmt = img.format
            img.verify()
    except Exception:  # noqa: BLE001
        raise ApiError(400, f"'{asset.filename}' could not be read as an image.") from None
    if fmt not in _PIL_TYPES:
        raise ApiError(400, f"'{asset.filename}' is not a supported image (JPEG, PNG or WebP).")
    asset.content_type = _PIL_TYPES[fmt]


def _check_document(asset: Asset) -> None:
    if asset.data.startswith(b"%PDF"):
        asset.content_type = "application/pdf"
        return
    if B.doc_format(asset.content_type, asset.filename) == "pdf":
        raise ApiError(400, f"'{asset.filename}' is not a valid PDF.")
    _check_image(asset)


def _parse_json_list(raw: str, field: str) -> list:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        raise ApiError(400, f"Invalid {field}.") from None
    if not isinstance(value, list):
        raise ApiError(400, f"Invalid {field}.")
    return value


def _build_inputs(state: dict, action: str, collateral: List[Asset], scale: List[Asset], damage: List[Asset],
                  documents: List[Asset], damage_hints: str, document_types: str) -> flow.StepInput:
    inputs = flow.StepInput()
    if action == "scale_photo":
        if len(scale) != 1:
            raise ApiError(400, "Attach one photo of the weighing machine.")
        _check_image(scale[0])
        inputs.scale = scale[0]

    elif action == "collateral":
        if not collateral:
            raise ApiError(400, "Attach at least one collateral photo.")
        if len(collateral) > MAX_COLLATERAL_PHOTOS_PER_UPLOAD:
            raise ApiError(400, f"Upload at most {MAX_COLLATERAL_PHOTOS_PER_UPLOAD} collateral photos at a time.")
        for a in collateral:
            _check_image(a)
        inputs.collateral = collateral

    elif action == "damage":
        hints = _parse_json_list(damage_hints, "damage details")
        if not damage or len(hints) != len(damage):
            raise ApiError(400, "Each damaged item needs its details and one photo.")
        if len(damage) > MAX_DAMAGE_ITEMS_PER_UPLOAD:
            raise ApiError(400, f"Record at most {MAX_DAMAGE_ITEMS_PER_UPLOAD} damaged items at a time.")
        seen: Set[str] = set()
        for hint, image in zip(hints, damage):
            if not isinstance(hint, dict):
                raise ApiError(400, "Invalid damage details.")
            oid = str(hint.get("ornament_id", ""))
            if S.find_item(state, oid) is None:
                raise ApiError(400, "A damaged item does not belong to this loan's inventory.")
            if oid in seen:
                raise ApiError(400, "Each ornament can only be recorded once per submission.")
            seen.add(oid)
            dtype, severity = str(hint.get("type", "")), str(hint.get("severity", ""))
            if dtype not in S.DAMAGE_TYPES:
                raise ApiError(400, f"Unknown damage type '{dtype}'.")
            if severity not in S.SEVERITIES:
                raise ApiError(400, f"Unknown severity '{severity}'.")
            try:
                damage_pct = round(float(hint.get("damage_percent") or 0), 2)
            except (TypeError, ValueError):
                raise ApiError(400, "The damage percentage must be a number.") from None
            if not 0 <= damage_pct <= 100:
                raise ApiError(400, "The damage percentage must be between 0 and 100.")
            details = " ".join(str(hint.get("details") or "").split())[:300]
            if dtype == "Other" and not details:
                raise ApiError(400, "Describe the damage when the type is 'Other'.")
            _check_image(image)
            inputs.damage.append(flow.DamageUpload(oid, dtype, severity, damage_pct, details, image))

    elif action == "document":
        types = _parse_json_list(document_types, "document types")
        if not documents or len(types) != len(documents):
            raise ApiError(400, "Each document needs a document type.")
        if len(documents) > MAX_DOCUMENTS_PER_UPLOAD:
            raise ApiError(400, f"Upload at most {MAX_DOCUMENTS_PER_UPLOAD} documents at a time.")
        for dtype, asset in zip(types, documents):
            if dtype not in S.DOCUMENT_TYPES:
                raise ApiError(400, f"Unknown document type '{dtype}'.")
            _check_document(asset)
            inputs.documents.append(flow.DocumentUpload(dtype, asset))

    elif collateral or scale or damage or documents:
        raise ApiError(400, f"'{action}' does not accept file uploads.")
    return inputs


@router.post("/step")
async def step(
    session_id: str = Form(...),
    action: str = Form(...),
    damage_hints: str = Form("[]"),
    document_types: str = Form("[]"),
    collateral_images: List[UploadFile] = File(default_factory=list),
    scale_image: List[UploadFile] = File(default_factory=list),
    damage_images: List[UploadFile] = File(default_factory=list),
    documents: List[UploadFile] = File(default_factory=list),
):
    if action not in flow.HANDLERS:
        return ApiError(400, f"Unknown action '{action}'.").response()
    if not session_store.valid_id(session_id):
        return ApiError(404, "This verification session was not found. Start a new verification.").response()

    lock = session_store.lock_for(session_id)
    if lock.locked():
        return ApiError(409, "A step is already running for this session. Please wait for it to finish.").response()
    await lock.acquire()
    handed_off = False
    try:
        state = await _load(session_id)
        try:
            S.require_action(state, action)
        except S.WorkflowError as exc:
            raise ApiError(409, str(exc), session=S.view(state, await asyncio.to_thread(get_settings))) from None
        coll, scale, dmg, docs = (
            await _read(collateral_images), await _read(scale_image), await _read(damage_images), await _read(documents),
        )
        inputs = await asyncio.to_thread(
            _build_inputs, state, action, coll, scale, dmg, docs, damage_hints, document_types,
        )
        settings = await asyncio.to_thread(get_settings)

        queue: asyncio.Queue = asyncio.Queue()

        async def emit(event: str, data: dict) -> None:
            await queue.put(_sse(event, data))

        async def runner() -> None:
            try:
                await flow.run_action(state, action, inputs, settings, emit)
            finally:
                lock.release()
                await queue.put(None)

        # The task keeps running even if the client disconnects, so a step is never half-applied.
        task = asyncio.create_task(runner())
        _background.add(task)
        task.add_done_callback(_background.discard)
        handed_off = True
    except ApiError as exc:
        return exc.response()
    finally:
        if not handed_off:
            lock.release()

    async def stream():
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_S)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if frame is None:
                break
            yield frame

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# --------------------------------------------------------------------------- Q&A
class AnswerBody(BaseModel):
    session_id: str
    question: str = Field(default="", max_length=1000)


def _qa_context(v: dict) -> dict:
    """The facts the agent may answer from — compact, so nothing important is cut off."""
    weight = v.get("weight") or {}
    valuation = v.get("valuation") or {}
    report = v.get("report") or {}
    return {
        "loan": v["loan"],
        "application": v.get("application"),
        "step": v["workflow_state"],
        "ai_enabled": v["ai_enabled"],
        "stats": v["stats"],
        "blocked_by": v["gate"]["reasons"],
        "inventory": [
            {
                "item": r["name"], "material": r.get("material", "gold"), "purity": S.purity_label(r),
                "entered_weight_g": r["weight_gm"], "quantity": r["quantity"],
                "listed_from": "collateral photo" if r.get("origin", "detected") == "detected" else "added by assessor",
                "damage_percent": r.get("damage_percent") or 0,
                "caratmeter": (
                    {k: r["measurement"][k] for k in ("weight_g", "fineness_pct", "grade")} if r.get("measurement") else None
                ),
                "reading": r.get("measurement_status"), "reading_accepted": r.get("measurement_overridden", False),
            }
            for r in v["inventory"]
        ],
        "collateral_photos": [
            {"photo": im["index"] + 1, "status": im["status"], "issues": im["issues"]}
            for im in v["collateral"]["images"]
        ],
        "weight": {k: weight.get(k) for k in ("entered_g", "measured_g", "scale_g", "scale_source", "scale_status", "scale_diff_g", "tolerance_g", "unweighed")},
        "pledge": {
            "totals": valuation.get("totals"),
            "damage_rule": valuation.get("damage_deduction_mode"),
            "items": [
                {k: i[k] for k in ("name", "grade", "weight_g", "weight_basis", "rate_per_gram", "ltv_pct", "pledge_amount")}
                for i in valuation.get("items", [])
            ],
        },
        "damages": [
            {k: d.get(k) for k in ("item", "type", "severity", "damage_percent", "status", "notes", "overridden")}
            for d in v["damages"]
        ],
        "documents": [
            {k: d.get(k) for k in ("declared_type", "doc_type_detected", "status", "issues", "matches", "overridden")}
            for d in (v.get("documents") or {}).get("items", [])
        ],
        "audit": [{k: a[k] for k in ("target", "item", "original", "new_value", "justification")} for a in v["audit"]],
        "report": {k: report.get(k) for k in ("report_id", "recommendation", "reasons")} if report else None,
    }


@router.post("/answer")
async def answer(body: AnswerBody):
    try:
        state = await _load(body.session_id)
    except ApiError as exc:
        return exc.response()
    settings = await asyncio.to_thread(get_settings)
    context = _qa_context(S.view(state, settings))
    text = await conversation.answer(body.question, context, state.get("ai_enabled", True))
    return {"text": text}


# --------------------------------------------------------------------------- overrides / edits
class OverrideBody(BaseModel):
    session_id: str
    target: str
    ref: str
    justification: str = Field(default="", max_length=500)


class EditBody(BaseModel):
    session_id: str
    ref: str
    changes: Dict[str, Any] = Field(default_factory=dict)
    justification: str = Field(default="", max_length=500)


class ScaleBody(BaseModel):
    session_id: str
    weight_g: float
    justification: str = Field(default="", max_length=500)


async def _mutate(session_id: str, apply) -> JSONResponse | dict:
    if not session_store.valid_id(session_id):
        return ApiError(404, "This verification session was not found.").response()
    lock = session_store.lock_for(session_id)
    if lock.locked():
        return ApiError(409, "A step is running for this session. Try again when it finishes.").response()
    async with lock:
        try:
            state = await _load(session_id)
            entry = apply(state)
        except ApiError as exc:
            return exc.response()
        except S.WorkflowError as exc:
            return ApiError(409, str(exc)).response()
        try:
            await asyncio.to_thread(session_store.save, state, entry)  # session + audit row, one transaction
        except session_store.ConflictError as exc:
            return ApiError(409, str(exc)).response()
        settings = await asyncio.to_thread(get_settings)
        return {"session": S.view(state, settings), "entry": entry}


@router.post("/override")
async def override(body: OverrideBody):
    return await _mutate(body.session_id, lambda st: S.apply_override(st, body.target, body.ref, body.justification))


@router.post("/edit")
async def edit(body: EditBody):
    return await _mutate(body.session_id, lambda st: S.apply_edit(st, body.ref, body.changes, body.justification))


@router.post("/scale")
async def scale(body: ScaleBody):
    return await _mutate(body.session_id, lambda st: S.apply_scale_reading(st, body.weight_g, body.justification))


# --------------------------------------------------------------------------- inventory
class AddItemBody(BaseModel):
    session_id: str
    name: str = Field(default="", max_length=120)
    material: str = Field(default="gold", max_length=24)
    quantity: int = 1
    weight_gm: float = 0


class ItemRefBody(BaseModel):
    session_id: str
    ref: str
    justification: str = Field(default="", max_length=500)


class WeightBody(BaseModel):
    session_id: str
    ref: str
    weight_gm: float
    justification: str = Field(default="", max_length=500)


@router.post("/item")
async def add_item(body: AddItemBody):
    """Add an ornament the collateral photo did not show (or the agent missed)."""
    added: Dict[str, Any] = {}

    def apply(st: dict):
        added.update(S.add_item(st, body.name, material=body.material, quantity=body.quantity, weight_gm=body.weight_gm))
        return None  # adding a row is data entry, not an override: nothing for the audit trail

    result = await _mutate(body.session_id, apply)
    if isinstance(result, dict):
        result["item"] = added
    return result


@router.post("/item/remove")
async def remove_item(body: ItemRefBody):
    return await _mutate(body.session_id, lambda st: S.remove_item(st, body.ref, body.justification))


@router.post("/weight")
async def set_weight(body: WeightBody):
    """The weight the assessor read off the machine for one ornament."""
    return await _mutate(body.session_id, lambda st: S.set_item_weight(st, body.ref, body.weight_gm, body.justification))

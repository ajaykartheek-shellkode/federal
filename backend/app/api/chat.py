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
damage_hints (JSON [{ornament_id, type, severity, details, photo}]; damage_images carries a
  close-up for each hint whose "photo" is true — a photo is optional),
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
    mobile: str = Field(default="", max_length=32)


@router.post("/start")
async def start(body: StartBody):
    """Open a verification for the customer on this mobile number."""
    typed = " ".join((body.mobile or "").split())
    digits = cbs.digits_of(typed)
    if not digits:
        return ApiError(400, "Enter the customer's mobile number to start.").response()
    if not 10 <= len(digits) <= 15:
        return ApiError(400, "A mobile number is 10 digits — check the number and try again.").response()

    customer = await asyncio.to_thread(cbs.find_customer_by_mobile, digits)
    if customer is None:
        samples = await asyncio.to_thread(cbs.sample_accounts)
        return ApiError(404, f"No customer in CBS has the mobile number {typed}.", samples=samples).response()

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


@router.get("/customers")
async def demo_customers():
    """The CBS customers a branch can start a journey for (the demo set)."""
    return {"customers": await asyncio.to_thread(cbs.sample_accounts, 5)}


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
        if not hints:
            raise ApiError(400, "Record at least one damaged ornament.")
        if len(hints) > MAX_DAMAGE_ITEMS_PER_UPLOAD:
            raise ApiError(400, f"Record at most {MAX_DAMAGE_ITEMS_PER_UPLOAD} damaged items at a time.")
        # A close-up is optional, so the images line up with the hints that said they carry one.
        wants_photo = [bool(h.get("photo")) if isinstance(h, dict) else False for h in hints]
        if len(damage) != sum(wants_photo):
            raise ApiError(400, "The damage photos do not match the items they were recorded for.")
        photos = list(damage)
        seen: Set[str] = set()
        for hint, has_photo in zip(hints, wants_photo):
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
            details = " ".join(str(hint.get("details") or "").split())[:300]
            if dtype == "Other" and not details:
                raise ApiError(400, "Describe the damage when the type is 'Other'.")
            image = photos.pop(0) if has_photo else None
            if image is not None:
                _check_image(image)
            inputs.damage.append(flow.DamageUpload(oid, dtype, severity, details, image))

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
        "weight": {k: weight.get(k) for k in (
            "gross_g", "wastage_pct", "wastage_g", "net_g", "entered_g", "measured_g", "scale_g",
            "scale_source", "scale_status", "scale_diff_g", "tolerance_g", "unweighed",
        )},
        "loan": {
            "totals": valuation.get("totals"),
            "items": [
                {k: i[k] for k in ("name", "grade", "gross_weight_g", "net_weight_g", "rate_per_gram")}
                for i in valuation.get("items", [])
            ],
        },
        "damages": [
            {k: d.get(k) for k in ("item", "type", "severity", "status", "notes", "overridden")}
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


# What each step is called, and what the assessor does next after going back to it.
STEP_LABELS = [
    {"key": "collateral", "label": "Collateral photos"},
    {"key": "weight", "label": "Weight & purity"},
    {"key": "damage", "label": "Damage assessment"},
    {"key": "valuation", "label": "Loan valuation"},
    {"key": "document", "label": "Document verification"},
    {"key": "report", "label": "Report"},
]

REDO_PROMPT = {
    "collateral": "Upload the collateral photos again to rebuild the pledge list.",
    "weight": "Upload the weighing-machine photo again, then fetch the purity.",
    "damage": "Record the damaged ornaments again, or continue without any.",
    "valuation": "Review the maximum loan amount, then continue.",
    "document": "Upload the customer's documentary proof again.",
    "report": "Generate the report when you are ready.",
}


class PhotoRefBody(BaseModel):
    session_id: str
    index: int = Field(ge=0, le=99)


@router.post("/collateral/remove")
async def remove_collateral_photo(body: PhotoRefBody):
    """Drop a collateral photo the assessor is re-taking, with the ornaments it listed."""
    result: Dict[str, Any] = {}

    def apply(st: dict):
        had_weights = bool(st.get("measurements")) or any(float(r.get("weight_gm") or 0) > 0 for r in st["inventory"])
        out = S.remove_collateral_image(st, body.index)
        result.update(out, had_weights=had_weights, photo=f"Photo {body.index + 1}")
        return out["entry"]

    res = await _mutate(body.session_id, apply)
    if isinstance(res, dict):
        res["removed_ornaments"] = result.get("removed_ornaments", [])
        res["rewound"] = result.get("rewound", False)
        res["message"] = conversation.draft("photo_removed", {
            "photo": result.get("photo"),
            "removed": result.get("removed_ornaments", []),
            "photos_left": result.get("photos_left", 0),
            "rewound": result.get("rewound", False),
            "had_weights": result.get("had_weights", False),
            "report_discarded": result.get("report_discarded", False),
        })
    return res


class RewindBody(BaseModel):
    session_id: str
    target: str = Field(max_length=24)


@router.get("/rewind/{session_id}/{target}")
async def rewind_preview(session_id: str, target: str):
    """What going back to ``target`` would discard — shown before the assessor confirms."""
    try:
        state = await _load(session_id)
    except ApiError as exc:
        return exc.response()
    if target not in S.steps_of(state):
        return ApiError(400, "That step is not part of this verification.").response()
    return S.rewind_effects(state, target)


@router.post("/rewind")
async def rewind(body: RewindBody):
    """Go back to a step already passed, discarding what that step produced so it can be redone."""
    result: Dict[str, Any] = {}

    def apply(st: dict):
        out = S.rewind(st, body.target)
        result.update(out)
        return out["entry"]

    res = await _mutate(body.session_id, apply)
    if isinstance(res, dict):
        label = next((s["label"] for s in STEP_LABELS if s["key"] == body.target), body.target)
        res["message"] = conversation.draft("rewound", {
            "target": body.target,
            "label": label,
            "labels": result.get("labels", []),
            "next_action": REDO_PROMPT.get(body.target, "Redo this step when you are ready."),
        })
    return res


class SignatureBody(BaseModel):
    role: str = Field(max_length=24)
    name: str = Field(default="", max_length=120)
    kind: str = Field(default="typed", max_length=12)


class SubmitBody(BaseModel):
    session_id: str
    signatures: List[SignatureBody] = Field(default_factory=list, max_length=5)


@router.post("/submit")
async def submit(body: SubmitBody):
    """Submit the signed verification: the customer's signature, and the branch's alongside it."""
    payload = [s.model_dump() for s in body.signatures]
    return await _mutate(body.session_id, lambda st: S.record_signatures(st, payload))


@router.post("/weight")
async def set_weight(body: WeightBody):
    """The weight the assessor read off the machine for one ornament."""
    return await _mutate(body.session_id, lambda st: S.set_item_weight(st, body.ref, body.weight_gm, body.justification))

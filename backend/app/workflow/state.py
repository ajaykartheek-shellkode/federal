"""The verification session document and every rule that governs it.

Pure functions only (no I/O, no model calls) so the whole workflow is unit-testable:
state creation, allowed actions, blocker gates, overrides/edits, the final
recommendation, the reporting run record and the client-facing view.

The journey (v5). CBS supplies the customer and KYC only — never an inventory:
    1. collateral  the assessor photographs the ornaments; the agent detects and crops each one
                   and THAT becomes the inventory (editable: rename, weigh, add, remove)
    2. weight      a weight is entered per item, the weighing-machine photo gives the total, and
                   one CaratMeter request per loan application returns the purity of every item
    3. damage      a photo, severity and damage % per damaged ornament
    4. valuation   pledge amount = entered weight × rate for the assessed purity × LTV − damage
    5. document    identity proof, cross-verified against the CBS customer record
    6. report      PROCEED / REVIEW with reasons, audit trail and signatures

Session document (JSON):
    session_id, version, rev, created_at, workflow_state, ai_enabled, blocker_mode, next_ref
    loan         {account_number, customer_id, customer_name, scenario, branch, id_number, address}
    valuation    {materials, weight_tolerance_g, purity_tolerance_pct, damage_deduction}  # captured at start
    inventory    [{id, name, material, carat, weight_gm, quantity, damage_percent, origin, status,
                   thumb_asset_id, source_image, measurement, measurement_status, measurement_overridden}]
    collateral   {images: [...], overall_status, issues, corrective_actions, detections}
    scale        None | {weight_g, text, source: photo|assessor, asset_id, filename, status, issues, recorded_at}
    scale_overridden  bool
    measurements None | {device, measured_at, count}          # one CaratMeter run per application
    damages      [{ornament_id, item, type, severity, damage_percent, assessor_details, asset_id,
                   thumb_asset_id, filename, status, consistent, observed, additional, assessed_severity,
                   notes, capture_issues, corrective_actions, overridden, recorded_at}]
    documents    None | {items: [...], overall_status, issues, corrective_actions}
    audit        [{id, target, ref, item, original, new_value, justification, ts}]
    report       None | {report_id, generated_at, recommendation, reasons, stats, overall_status}
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

from app.valuation import grade_by_name, grade_for_fineness, material_config, norm_grade, value_inventory

# v3 added the CaratMeter step, v4 the pledge valuation review, v5 the photo-built inventory with
# assessor-entered weights. Older sessions keep the steps and rules they started with.
VERSION = 5

WORKFLOW = ("collateral", "weight", "damage", "valuation", "document", "report", "done")
ACTIONS: Dict[str, tuple] = {
    "collateral": ("collateral", "continue"),
    "weight": ("scale_photo", "measure", "continue"),
    "damage": ("damage", "continue"),
    "valuation": ("damage", "continue"),
    "document": ("document", "continue"),
    "report": ("document", "report"),
    "done": (),
}

CARATS = ("24", "22", "18", "14")
MATERIALS = ("gold", "silver")
DAMAGE_TYPES = ("Dent", "Crack", "Scratch", "Bent", "Missing stone", "Broken clasp", "Other")
SEVERITIES = ("minor", "moderate", "severe")
DOCUMENT_TYPES = (
    "Aadhaar Card", "PAN Card", "Voter ID", "Passport", "Driving Licence", "Gold Purchase Bill", "Other",
)

# How an inventory row came to exist.
ITEM_ORIGINS = ("detected", "manual")
CHECKED = ("pass", "alert", "fail")
_RANK = {"pass": 0, "alert": 1, "fail": 2}

# CaratMeter reading status per item. Everything except "match" (and "pending") needs review.
MEASURE_FLAGS = ("weight_mismatch", "ungraded", "mismatch", "missing")
MAX_SCALE_G = 50_000
MAX_ITEM_G = 5_000
MAX_ITEMS = 60


class WorkflowError(ValueError):
    """A request that is not valid for the session's current state (maps to HTTP 409/400)."""


# --------------------------------------------------------------------------- helpers
def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def worst(statuses: Iterable[Optional[str]]) -> Optional[str]:
    """Worst of pass/alert/fail; None when nothing was checked (e.g. AI off)."""
    ranked = [s for s in statuses if s in _RANK]
    if not ranked:
        return None
    return max(ranked, key=lambda s: _RANK[s])


def mask_id(value: str) -> str:
    digits = "".join(ch for ch in (value or "") if ch.isalnum())
    if len(digits) <= 4:
        return digits
    return "•" * (len(digits) - 4) + digits[-4:]


def find_item(state: dict, ornament_id: str) -> Optional[dict]:
    return next((r for r in state["inventory"] if r["id"] == ornament_id), None)


def purity_label(row: dict) -> str:
    """Purity as people read it: gold "22" → "22K", silver "925" → "925", unknown → "—"."""
    carat = str(row.get("carat") or "")
    if not carat:
        return "—"
    if row.get("material", "gold") == "gold" and carat.replace(".", "", 1).isdigit():
        return f"{carat}K"
    return carat


def describe_item(row: dict) -> str:
    qty = f" ×{row['quantity']}" if int(row.get("quantity", 1) or 1) > 1 else ""
    weight = f"{_fmt_weight(row['weight_gm'])}g" if float(row.get("weight_gm") or 0) > 0 else "no weight"
    return f"{row['name']}{qty} · {purity_label(row)} · {weight}"


def _fmt_weight(w) -> str:
    value = float(w or 0)
    return str(int(value)) if value.is_integer() else f"{value:.3f}".rstrip("0").rstrip(".")


def _grams(w) -> str:
    """Instrument readings for people: at most two decimals (67.371 → 67.37)."""
    return f"{float(w or 0):.2f}".rstrip("0").rstrip(".")


def default_valuation() -> dict:
    from app.settings import Settings  # local import: settings is a pure pydantic module

    return Settings().valuation_snapshot()


def valuation_of(state: dict) -> dict:
    return state.get("valuation") or default_valuation()


def version_of(state: dict) -> int:
    return int(state.get("version", 2))


def uses_weight(state: dict) -> bool:
    """Sessions created before the Weight & purity step (v2) skip it."""
    return version_of(state) >= 3


def uses_valuation(state: dict) -> bool:
    """Sessions created before the Pledge valuation step (v3 and older) skip it."""
    return version_of(state) >= 4


def builds_inventory(state: dict) -> bool:
    """v5 builds the inventory from the collateral photo instead of loading it from CBS."""
    return version_of(state) >= 5


def steps_of(state: dict) -> List[str]:
    skip = set()
    if not uses_weight(state):
        skip.add("weight")
    if not uses_valuation(state):
        skip.add("valuation")
    return [s for s in ("collateral", "weight", "damage", "valuation", "document", "report") if s not in skip]


def next_state(state: dict, current: str) -> Optional[str]:
    """The next step this session runs, skipping steps it was not created with."""
    steps = steps_of(state)
    try:
        return steps[steps.index(current) + 1]
    except (ValueError, IndexError):
        return None


# --------------------------------------------------------------------------- creation
def new_state(customer: dict, ai_enabled: bool, blocker_mode: bool = False, valuation: Optional[dict] = None) -> dict:
    """Build a fresh session from a CBS customer record (``cbs.fetch_customer`` shape).

    Only the customer and KYC details are taken: the pledged inventory is built later from the
    collateral photo. AI validation, the enforcement mode and the valuation table are captured
    here so a settings change never alters a verification already in progress.
    """
    return {
        "session_id": None,
        "version": VERSION,
        "rev": 0,
        "created_at": now_iso(),
        "workflow_state": "collateral",
        "ai_enabled": bool(ai_enabled),
        "blocker_mode": bool(blocker_mode),
        "loan": dict(customer["loan_context"]),
        "valuation": valuation or default_valuation(),
        "next_ref": 1,
        "inventory": [],
        "collateral": {
            "images": [],
            "overall_status": None,
            "issues": [],
            "corrective_actions": [],
            "detections": 0,
        },
        "scale": None,
        "scale_overridden": False,
        "measurements": None,
        "damages": [],
        "documents": None,
        "audit": [],
        "report": None,
    }


def _new_ref(state: dict) -> str:
    """The next ornament id. These ids are what the CaratMeter request is keyed on."""
    ref = int(state.get("next_ref") or (len(state["inventory"]) + 1))
    state["next_ref"] = ref + 1
    return f"item-{ref}"


def _clean_name(text: str, fallback: str = "Ornament") -> str:
    name = " ".join(str(text or "").split())[:120]
    if not name:
        return fallback
    return name if any(c.isupper() for c in name) else name.title()


def _material_of(label: str, valuation: dict) -> str:
    """Pick the material whose name appears in the detected label (gold unless told otherwise)."""
    text = str(label or "").lower()
    for material in valuation.get("materials", []):
        if material["key"] != "gold" and (material["key"] in text or material["name"].lower() in text):
            return material["key"]
    return "gold"


def new_item(
    ref: str,
    name: str,
    *,
    material: str = "gold",
    quantity: int = 1,
    weight_gm: float = 0.0,
    origin: str = "detected",
    thumb_asset_id: Optional[str] = None,
    source_image: Optional[int] = None,
) -> dict:
    return {
        "id": ref,
        "name": name,
        "material": material,
        "carat": "",  # unknown until the CaratMeter reads it
        "weight_gm": float(weight_gm or 0),
        "quantity": int(quantity or 1),
        "damage_percent": 0.0,
        "origin": origin,
        "status": origin,
        "thumb_asset_id": thumb_asset_id,
        "source_image": source_image,
        "measurement": None,
        "measurement_status": "pending",
        "measurement_overridden": False,
    }


# --------------------------------------------------------------------------- queries
def unweighed_items(state: dict) -> List[dict]:
    return [r for r in state["inventory"] if not float(r.get("weight_gm") or 0) > 0]


def blocker_of(state: dict, settings) -> bool:
    """The session's enforcement mode (captured at start; sessions from before that fall back to settings)."""
    return bool(state["blocker_mode"]) if "blocker_mode" in state else bool(settings.blocker_mode)


def unresolved(entries: Iterable[dict], statuses: tuple) -> List[dict]:
    return [e for e in entries if e.get("status") in statuses and not e.get("overridden")]


def unresolved_measurements(state: dict) -> List[dict]:
    """Items whose CaratMeter reading disagrees with the entered weight (or is missing/ungraded)."""
    if not state.get("measurements"):
        return []
    return [
        r for r in state["inventory"]
        if r.get("measurement_status") in MEASURE_FLAGS and not r.get("measurement_overridden")
    ]


def document_items(state: dict) -> List[dict]:
    return (state.get("documents") or {}).get("items", [])


def allowed_actions(state: dict) -> tuple:
    return ACTIONS.get(state["workflow_state"], ())


def require_action(state: dict, action: str) -> None:
    if action not in allowed_actions(state):
        label = state["workflow_state"]
        raise WorkflowError(f"'{action}' is not available while the session is at the '{label}' step.")


def require_open(state: dict) -> None:
    if state["workflow_state"] == "done":
        raise WorkflowError("The report has been generated; this verification is locked.")


# --------------------------------------------------------------------------- gates
def stage_blockers(state: dict, stage: str, blocker_mode: bool) -> List[str]:
    """Reasons the session cannot move past ``stage``. Requirements apply in every mode;
    quality findings only block in blocker mode."""
    reasons: List[str] = []
    if stage == "collateral":
        if not state["collateral"]["images"]:
            reasons.append("Upload at least one collateral photo first.")
        elif not state["inventory"]:
            reasons.append("No ornaments are listed yet. Re-capture the photo, or add the items by hand.")
    elif stage == "weight":
        missing = unweighed_items(state)
        if missing:
            names = ", ".join(r["name"] for r in missing[:3]) + ("…" if len(missing) > 3 else "")
            reasons.append(f"Enter the weight of {len(missing)} item(s) ({names}).")
        if not state.get("measurements"):
            reasons.append("Fetch the purity readings from the CaratMeter first.")
        elif blocker_mode:
            flagged = unresolved_measurements(state)
            if flagged:
                names = ", ".join(r["name"] for r in flagged[:3]) + ("…" if len(flagged) > 3 else "")
                reasons.append(f"{len(flagged)} CaratMeter reading(s) need review ({names}). Re-measure or accept each.")
        if blocker_mode and not state.get("scale_overridden") and weight_summary(state)["scale_status"] in ("pending", "missing"):
            reasons.append("Capture the weighing-machine photo (or enter the total) before continuing.")
    elif stage == "valuation":
        if blocker_mode:
            unpriced = value_inventory(state["inventory"], valuation_of(state))["totals"]["unpriced"]
            if unpriced:
                reasons.append(
                    "No rate is configured for the purity of " + ", ".join(unpriced) +
                    ". Add the grade in Settings, or correct the item."
                )
    elif stage == "damage" and blocker_mode:
        failed = unresolved(state["damages"], ("fail",))
        if failed:
            reasons.append(f"{len(failed)} damage photo(s) could not be inspected. Re-capture or override.")
    elif stage == "document":
        if not document_items(state):
            reasons.append("Upload the customer's documentary proof first.")
        elif blocker_mode:
            failed = unresolved(document_items(state), ("fail",))
            if failed:
                reasons.append(f"{len(failed)} document(s) could not be read. Re-upload or override.")
    return reasons


def gate(state: dict, blocker_mode: bool) -> dict:
    """Can the current step be completed? ``{allowed, reasons}`` for continue/report."""
    ws = state["workflow_state"]
    if ws == "done":
        return {"allowed": False, "reasons": ["This verification is complete."]}
    if ws == "report":
        stages = tuple(s for s in steps_of(state) if s != "report")
    else:
        stages = (ws,)
    reasons = [r for s in stages for r in stage_blockers(state, s, blocker_mode)]
    return {"allowed": not reasons, "reasons": reasons}


def advance(state: dict, blocker_mode: bool) -> str:
    """Move to the next step if the gate allows it; raises WorkflowError otherwise."""
    ws = state["workflow_state"]
    target = next_state(state, ws)
    if target is None:
        raise WorkflowError("There is no next step to continue to.")
    g = gate(state, blocker_mode)
    if not g["allowed"]:
        raise WorkflowError(" ".join(g["reasons"]))
    state["workflow_state"] = target
    return target


# --------------------------------------------------------------------------- collateral
def record_collateral(state: dict, images: List[dict], result: Optional[dict]) -> int:
    """Merge one upload into the session and build inventory rows from what was detected.

    ``images``: [{asset_id, filename}] in upload order.
    ``result``: CollateralResult.model_dump() for this upload (indexes 0..n-1, items carrying
    label + thumb_asset_id), or None when AI validation is off.

    Returns the number of ornaments added. A re-capture taken before any weighing replaces the
    rows of the earlier upload; once weights or readings exist, new detections are appended.
    """
    coll = state["collateral"]
    offset = len(coll["images"])
    upload_no = 1 + max((im.get("upload_no", 0) for im in coll["images"]), default=0)
    by_index = {r["index"]: r for r in (result or {}).get("images", [])}

    for i, meta in enumerate(images):
        r = by_index.get(i)
        entry = {
            "index": offset + i,
            "upload_no": upload_no,
            "asset_id": meta.get("asset_id"),
            "filename": meta.get("filename", ""),
            "uploaded_at": now_iso(),
            "status": "not_checked",
            "checks": {},
            "ornament_count_estimate": 0,
            "foreign_object_percent": 0,
            "issues": [],
            "matched": [],
        }
        if result is not None:
            if r is None:
                entry.update(status="fail", issues=["No validation result returned for this photo"])
            else:
                entry.update(
                    status=r["status"],
                    checks={k: bool(r.get(k)) for k in (
                        "clarity_ok", "all_visible", "not_cropped", "no_obstruction",
                        "no_foreign_objects", "clean_background")},
                    ornament_count_estimate=int(r.get("ornament_count_estimate") or 0),
                    foreign_object_percent=int(r.get("foreign_object_percent") or 0),
                    issues=list(r.get("issues") or []),
                )
        coll["images"].append(entry)

    if result is None:
        coll["overall_status"] = None
        return 0

    # A re-capture before any weighing supersedes the previous auto-detected list.
    untouched = all(
        r["origin"] == "detected" and not float(r.get("weight_gm") or 0) > 0 and not r.get("measurement")
        for r in state["inventory"]
    )
    if state["inventory"] and untouched and not state.get("measurements"):
        state["inventory"] = []

    added = 0
    valuation = valuation_of(state)
    for r in result.get("images", []):
        local_index = int(r["index"])
        if not 0 <= local_index < len(images):
            continue
        entry = coll["images"][offset + local_index]
        if r["status"] == "fail":
            continue  # nothing in an unusable photo can be inventoried
        for item in r.get("items", []):
            if len(state["inventory"]) >= MAX_ITEMS:
                break
            label = item.get("label") or "Ornament"
            row = new_item(
                _new_ref(state),
                _clean_name(label),
                material=_material_of(label, valuation),
                thumb_asset_id=item.get("thumb_asset_id"),
                source_image=entry["index"],
            )
            state["inventory"].append(row)
            entry["matched"].append(row["id"])
            added += 1

    coll["detections"] = sum(len(im["matched"]) for im in coll["images"])
    coll["overall_status"] = worst(im["status"] for im in coll["images"])
    coll["issues"] = list(result.get("issues") or [])
    coll["corrective_actions"] = list(result.get("corrective_actions") or [])
    return added


def collateral_complete(state: dict) -> bool:
    """True when the photos produced an inventory and the latest capture is usable."""
    if not state["collateral"]["images"] or not state["inventory"]:
        return False
    latest = max(im["upload_no"] for im in state["collateral"]["images"])
    return all(im["status"] != "fail" for im in state["collateral"]["images"] if im["upload_no"] == latest)


# --------------------------------------------------------------------------- inventory edits
def add_item(state: dict, name: str, *, material: str = "gold", quantity: int = 1, weight_gm: float = 0) -> dict:
    """Add an ornament the agent did not detect. Returns the new row."""
    require_open(state)
    if len(state["inventory"]) >= MAX_ITEMS:
        raise WorkflowError(f"A verification can hold at most {MAX_ITEMS} ornaments.")
    clean = " ".join(str(name or "").split())
    if not 2 <= len(clean) <= 120:
        raise WorkflowError("Item name must be 2–120 characters.")
    if material not in [m["key"] for m in valuation_of(state).get("materials", [])]:
        raise WorkflowError("Unknown material.")
    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        raise WorkflowError("Quantity must be a whole number.") from None
    if not 1 <= qty <= 999:
        raise WorkflowError("Quantity must be between 1 and 999.")
    weight = _parse_weight(weight_gm, allow_zero=True)

    row = new_item(_new_ref(state), clean, material=material, quantity=qty, weight_gm=weight, origin="manual")
    state["inventory"].append(row)  # the row's "manual" origin is the record; the report notes it
    return row


def remove_item(state: dict, ref: str, justification: str = "") -> dict:
    """Drop a row the agent detected in error (or an item not being pledged)."""
    require_open(state)
    row = find_item(state, ref)
    if row is None:
        raise WorkflowError("Unknown inventory item.")
    if any(d["ornament_id"] == ref for d in state["damages"]):
        raise WorkflowError(f"Remove the damage record for {row['name']} first.")
    state["inventory"] = [r for r in state["inventory"] if r["id"] != ref]
    entry = _audit_entry(
        "item", ref, row["name"], describe_item(row), "removed by assessor",
        (justification or "").strip() or "Not part of the pledged collateral",
    )
    state["audit"].append(entry)
    return entry


def _parse_weight(value, allow_zero: bool = False) -> float:
    try:
        weight = round(float(value), 3)
    except (TypeError, ValueError):
        raise WorkflowError("Weight must be a number of grams.") from None
    if allow_zero and weight == 0:
        return 0.0
    if not 0 < weight <= MAX_ITEM_G:
        raise WorkflowError(f"Weight must be between 0 and {MAX_ITEM_G:,} g.")
    return weight


def set_item_weight(state: dict, ref: str, weight_gm, justification: str = "") -> Optional[dict]:
    """Record the weight the assessor read off the machine for one ornament.

    Weighing an ornament for the first time is data entry, not a correction, so it leaves no audit
    entry — the weight itself is on the pledge list and in the report. Changing a weight already
    recorded does need a justification, and is audited.
    """
    require_open(state)
    row = find_item(state, ref)
    if row is None:
        raise WorkflowError("Unknown inventory item.")
    weight = _parse_weight(weight_gm)
    prior = float(row.get("weight_gm") or 0)
    if abs(prior - weight) < 0.0005:
        raise WorkflowError("The weight is unchanged.")
    justification = (justification or "").strip()
    if prior > 0 and len(justification) < 5:
        raise WorkflowError("A justification of at least 5 characters is required to change a recorded weight.")

    row["weight_gm"] = weight
    if row.get("measurement"):
        # The comparison changed, so an earlier acceptance no longer describes this finding.
        row["measurement_status"] = measurement_status(row, valuation_of(state))
        row["measurement_overridden"] = False
    if prior <= 0:
        return None
    entry = _audit_entry("weight", ref, row["name"], f"{_grams(prior)} g", f"{_grams(weight)} g", justification)
    state["audit"].append(entry)
    return entry


# --------------------------------------------------------------------------- weight & purity
def _reading(m) -> Optional[tuple]:
    """(weight_g, fineness_pct) from one CaratMeter measurement, or None if it is unusable."""
    if not isinstance(m, dict):
        return None
    try:
        weight, fineness = float(m.get("net_weight_g")), float(m.get("fineness_pct"))
    except (TypeError, ValueError):
        return None
    if not (0 < weight <= MAX_SCALE_G and 0 <= fineness <= 100):  # also rejects NaN
        return None
    return round(weight, 3), round(fineness, 2)


def measurement_status(row: dict, valuation: dict) -> str:
    """How a CaratMeter reading compares with the weight the assessor entered."""
    m = row.get("measurement")
    if not m:
        return "missing"
    entered = float(row.get("weight_gm") or 0)
    tolerance = float(valuation.get("weight_tolerance_g", 0.1))
    weight_ok = entered <= 0 or abs(float(m["weight_g"]) - entered) <= tolerance + 1e-9
    graded = bool(m.get("grade"))
    if weight_ok and graded:
        return "match"
    if not weight_ok and not graded:
        return "mismatch"
    return "weight_mismatch" if not weight_ok else "ungraded"


def measurement_issue(row: dict) -> str:
    """One-line description of an item's CaratMeter finding for reports and audit."""
    m = row.get("measurement")
    status = row.get("measurement_status")
    if not m or status == "missing":
        return "no CaratMeter reading"
    parts = []
    if status in ("weight_mismatch", "mismatch"):
        parts.append(f"CaratMeter weighed {_grams(m['weight_g'])} g against {_grams(row['weight_gm'])} g entered")
    if status in ("ungraded", "mismatch"):
        parts.append(f"purity {m['fineness_pct']:g}% is below every configured {row.get('material', 'gold')} grade")
    return "; ".join(parts) or "reading accepted"


def record_measurements(state: dict, payload: dict) -> None:
    """Store one CaratMeter run for this loan application: grade every reading against the
    session's valuation table and compare its weight with the one entered by the assessor.
    A fresh run replaces earlier readings and any acceptances."""
    valuation = valuation_of(state)
    tolerance = float(valuation.get("purity_tolerance_pct", 0.5))
    readings = {
        str(m.get("tag")): m for m in (payload.get("measurements") or []) if isinstance(m, dict)
    }
    for row in state["inventory"]:
        raw = readings.get(row["id"])
        parsed = _reading(raw)
        row["measurement_overridden"] = False
        if parsed is None:
            row["measurement"] = None
            row["measurement_status"] = "missing"
            continue
        weight, fineness = parsed
        material = material_config(valuation, row.get("material", "gold"))
        grade = grade_for_fineness(material, fineness, tolerance)
        try:
            confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0)))
        except (TypeError, ValueError):
            confidence = 0.0
        row["measurement"] = {
            "weight_g": weight,
            "fineness_pct": fineness,
            "karat": round(fineness / 100 * 24, 2) if row.get("material", "gold") == "gold" else None,
            "grade": grade["grade"] if grade else None,
            "sample_id": str(raw.get("sample_id") or "")[:40],
            "measured_at": str(raw.get("measured_at") or now_iso())[:40],
            "confidence": confidence,
        }
        # The assessed grade becomes the item's purity — there is no CBS declaration to keep.
        if grade:
            row["carat"] = norm_grade(grade["grade"])
        row["measurement_status"] = measurement_status(row, valuation)

    device = payload.get("device") if isinstance(payload.get("device"), dict) else {}
    state["measurements"] = {
        "device": {k: device.get(k) for k in ("device_id", "model", "branch", "firmware", "calibrated_at", "mode")},
        "measured_at": now_iso(),
        "count": sum(1 for r in state["inventory"] if r.get("measurement")),
    }


def weight_complete(state: dict) -> bool:
    """True when every item has a reading that agrees with the entered weight (or was accepted)."""
    return bool(state.get("measurements")) and not unresolved_measurements(state) and not unweighed_items(state)


def record_scale_photo(state: dict, meta: dict, result: Optional[dict]) -> None:
    """Store the weighing-machine photo and the total it shows (None when AI is off)."""
    reading = _scale_of(result or {})
    state["scale"] = {
        "weight_g": reading["weight_g"],
        "text": reading["text"],
        "source": "photo" if reading["weight_g"] is not None else None,
        "asset_id": meta.get("asset_id"),
        "filename": meta.get("filename", ""),
        "status": (result or {}).get("status", "not_checked"),
        "issues": list((result or {}).get("issues") or []),
        "recorded_at": now_iso(),
    }
    state["scale_overridden"] = False


def _scale_of(r: dict) -> dict:
    try:
        weight = float(r.get("weight_g")) if r.get("weight_g") is not None else None
    except (TypeError, ValueError):
        weight = None
    if weight is not None and not 0 < weight <= MAX_SCALE_G:
        weight = None
    visible = bool(r.get("reading_visible")) and weight is not None
    return {
        "visible": visible,
        "weight_g": round(weight, 3) if visible else None,
        "text": str(r.get("reading_text") or "")[:40] if visible else "",
    }


def weight_summary(state: dict) -> dict:
    """The three weights that must agree: entered per item, the weighing machine, the CaratMeter."""
    inv = state["inventory"]
    valuation = valuation_of(state)
    item_tolerance = float(valuation.get("weight_tolerance_g", 0.1))
    entered = round(sum(float(r.get("weight_gm") or 0) for r in inv), 3)
    measured_rows = [r for r in inv if r.get("measurement")]
    measured = round(sum(float(r["measurement"]["weight_g"]) for r in measured_rows), 3) if measured_rows else None
    complete = bool(inv) and len(measured_rows) == len(inv)
    tolerance = round(item_tolerance * max(1, len(inv)), 3)

    scale = state.get("scale") or {}
    scale_g = scale.get("weight_g")
    diff = None
    if scale_g is None:
        scale_status = "missing" if scale else "pending"
    elif entered <= 0:
        scale_status = "pending"
    else:
        diff = round(float(scale_g) - entered, 3)
        scale_status = "match" if abs(diff) <= tolerance + 1e-9 else "mismatch"

    runs = state.get("measurements") or {}
    counts = {s: 0 for s in ("match", "pending", *MEASURE_FLAGS)}
    for r in inv:
        status = r.get("measurement_status") or "pending"
        counts[status] = counts.get(status, 0) + 1
    return {
        "entered_g": entered,
        "measured_g": measured,
        "measured_complete": complete,
        "weighed": len(inv) - len(unweighed_items(state)),
        "unweighed": [r["name"] for r in unweighed_items(state)],
        "scale_g": float(scale_g) if scale_g is not None else None,
        "scale_text": scale.get("text", ""),
        "scale_source": scale.get("source"),
        "scale_asset_id": scale.get("asset_id"),
        "scale_photo_status": scale.get("status"),
        "scale_issues": list(scale.get("issues") or []),
        "scale_diff_g": diff,
        "scale_status": scale_status,
        "scale_overridden": bool(state.get("scale_overridden")),
        "tolerance_g": tolerance,
        "item_tolerance_g": item_tolerance,
        "purity_tolerance_pct": float(valuation.get("purity_tolerance_pct", 0.5)),
        "device": runs.get("device"),
        "measured_at": runs.get("measured_at"),
        "counts": counts,
        "flagged": len(unresolved_measurements(state)),
    }


def apply_scale_reading(state: dict, weight_g, justification: str) -> dict:
    """Enter or correct the weighing-machine total (AI off, or the display could not be read)."""
    require_open(state)
    try:
        weight = round(float(weight_g), 3)
    except (TypeError, ValueError):
        raise WorkflowError("The scale reading must be a number of grams.") from None
    if not 0 < weight <= MAX_SCALE_G:
        raise WorkflowError(f"The scale reading must be between 0 and {MAX_SCALE_G:,} g.")
    prior = state.get("scale") or {}
    prior_weight = prior.get("weight_g")
    justification = (justification or "").strip()
    if prior_weight is not None:
        if abs(float(prior_weight) - weight) < 0.0005:
            raise WorkflowError("The scale reading is unchanged.")
        if len(justification) < 5:
            raise WorkflowError("A justification of at least 5 characters is required to correct the reading.")
        source = "read from the photo" if prior.get("source") == "photo" else "entered"
        original = f"{_grams(prior_weight)} g ({source})"
    else:
        justification = justification or "Entered from the weighing-machine display"
        original = "not captured"
    state["scale"] = {
        **prior,
        "weight_g": weight,
        "text": "",
        "source": "assessor",
        "recorded_at": now_iso(),
    }
    state["scale_overridden"] = False
    entry = _audit_entry("scale", "scale", "Weighing-machine total", original, f"{_grams(weight)} g", justification)
    state["audit"].append(entry)
    return entry


# --------------------------------------------------------------------------- damage
def record_damage(state: dict, entry: dict) -> None:
    """Insert or replace (by ornament) a damage record. New evidence clears a prior override."""
    entry = {**entry, "overridden": False, "recorded_at": now_iso()}
    row = find_item(state, entry["ornament_id"])
    if row is not None:
        row["damage_percent"] = float(entry.get("damage_percent") or 0)
    for i, existing in enumerate(state["damages"]):
        if existing["ornament_id"] == entry["ornament_id"]:
            state["damages"][i] = entry
            return
    state["damages"].append(entry)


# --------------------------------------------------------------------------- documents
def record_documents(state: dict, items: List[dict], result: Optional[dict]) -> None:
    """Replace the session's documents with a new upload.

    ``items``: [{doc_no, declared_type, asset_id, filename, content_type}].
    ``result``: DocumentResult.model_dump() or None when AI is off.
    """
    by_no = {d["doc_no"]: d for d in (result or {}).get("documents", [])}
    out = []
    for meta in items:
        r = by_no.get(meta["doc_no"]) if result is not None else None
        doc = {
            **meta,
            "status": "not_checked",
            "legible": None,
            "complete": None,
            "type_matches_declared": None,
            "doc_type_detected": "",
            "extracted": {"name": "", "id_number": "", "address": ""},
            "matches": {"name": False, "id": False, "address_pct": 0},
            "issues": [],
            "overridden": False,
        }
        if result is not None:
            if r is None:
                doc.update(status="fail", issues=["No validation result returned for this document"])
            else:
                doc.update(
                    status=r["status"],
                    legible=r.get("legible"),
                    complete=r.get("complete"),
                    type_matches_declared=r.get("type_matches_declared"),
                    doc_type_detected=r.get("doc_type_detected", ""),
                    extracted=r.get("extracted") or doc["extracted"],
                    matches=r.get("matches") or doc["matches"],
                    issues=list(r.get("issues") or []),
                )
        out.append(doc)
    state["documents"] = {
        "items": out,
        "overall_status": worst(d["status"] for d in out),
        "issues": list((result or {}).get("issues") or []),
        "corrective_actions": list((result or {}).get("corrective_actions") or []),
    }


# --------------------------------------------------------------------------- audit
CORRECTION_TARGETS = ("edit", "weight")


def is_correction(entry: dict) -> bool:
    """Inventory edits, weights and entered scale totals are corrections; the rest are overrides."""
    if entry["target"] in CORRECTION_TARGETS:
        return True
    if entry["target"] in ("scale", "item"):
        return entry["new_value"] != "accepted by assessor"
    return False


def _audit_entry(target: str, ref: str, item: str, original: str, new_value: str, justification: str) -> dict:
    return {
        "id": uuid.uuid4().hex[:12],
        "target": target,
        "ref": ref,
        "item": item,
        "original": original,
        "new_value": new_value,
        "justification": justification,
        "ts": now_iso(),
    }


def apply_override(state: dict, target: str, ref: str, justification: str) -> dict:
    """Accept a flagged finding with a mandatory justification. Returns the audit entry."""
    justification = (justification or "").strip()
    require_open(state)
    if len(justification) < 5:
        raise WorkflowError("A justification of at least 5 characters is required.")

    if target == "damage":
        dmg = next((d for d in state["damages"] if d["ornament_id"] == ref), None)
        if dmg is None:
            raise WorkflowError("No damage record for that item.")
        if dmg.get("overridden") or dmg["status"] not in ("alert", "fail"):
            raise WorkflowError(f"The damage finding for {dmg['item']} does not need an override.")
        dmg["overridden"] = True
        entry = _audit_entry("damage", ref, dmg["item"], f"damage {dmg['status']}", "accepted by assessor", justification)
    elif target == "measurement":
        row = find_item(state, ref)
        if row is None:
            raise WorkflowError("Unknown inventory item.")
        if not state.get("measurements") or row.get("measurement_overridden") or row.get("measurement_status") not in MEASURE_FLAGS:
            raise WorkflowError(f"The CaratMeter reading for {row['name']} does not need an override.")
        row["measurement_overridden"] = True
        entry = _audit_entry("measurement", ref, row["name"], measurement_issue(row), "accepted by assessor", justification)
    elif target == "scale":
        summary = weight_summary(state)
        if summary["scale_overridden"] or summary["scale_status"] not in ("pending", "missing", "mismatch"):
            raise WorkflowError("The weighing-machine total does not need an override.")
        state["scale_overridden"] = True
        original = (
            f"machine {_grams(summary['scale_g'])} g vs {_grams(summary['entered_g'])} g entered"
            if summary["scale_status"] == "mismatch" else "no weighing-machine total"
        )
        entry = _audit_entry("scale", "scale", "Weighing-machine total", original, "accepted by assessor", justification)
    elif target == "document":
        doc = next((d for d in document_items(state) if str(d["doc_no"]) == str(ref)), None)
        if doc is None:
            raise WorkflowError("Unknown document.")
        if doc.get("overridden") or doc["status"] not in ("alert", "fail"):
            raise WorkflowError(f"{doc['declared_type']} does not need an override.")
        doc["overridden"] = True
        entry = _audit_entry("document", str(ref), doc["declared_type"], f"document {doc['status']}", "accepted by assessor", justification)
    else:
        raise WorkflowError("Unknown override target.")

    state["audit"].append(entry)
    return entry


def apply_edit(state: dict, ref: str, changes: dict, justification: str) -> dict:
    """Correct an inventory row (name / purity / weight / quantity / material) with audit."""
    justification = (justification or "").strip()
    require_open(state)
    if len(justification) < 5:
        raise WorkflowError("A justification of at least 5 characters is required.")
    row = find_item(state, ref)
    if row is None:
        raise WorkflowError("Unknown inventory item.")

    updated = dict(row)
    if changes.get("name") is not None:
        name = " ".join(str(changes["name"]).split())
        if not 2 <= len(name) <= 120:
            raise WorkflowError("Item name must be 2–120 characters.")
        updated["name"] = name
    if changes.get("material") is not None:
        material = str(changes["material"])
        if material not in [m["key"] for m in valuation_of(state).get("materials", [])]:
            raise WorkflowError("Unknown material.")
        updated["material"] = material
    if changes.get("carat") is not None:
        carat = norm_grade(changes["carat"])
        material = material_config(valuation_of(state), updated.get("material", "gold"))
        grades = [g["grade"] for g in material["grades"]] if material else [c + "K" for c in CARATS]
        if carat and carat not in [norm_grade(g) for g in grades]:
            raise WorkflowError(f"Purity must be one of {', '.join(grades)}.")
        updated["carat"] = carat
    if changes.get("weight_gm") is not None:
        updated["weight_gm"] = _parse_weight(changes["weight_gm"])
    if changes.get("quantity") is not None:
        try:
            qty = int(changes["quantity"])
        except (TypeError, ValueError):
            raise WorkflowError("Quantity must be a whole number.") from None
        if not 1 <= qty <= 999:
            raise WorkflowError("Quantity must be between 1 and 999.")
        updated["quantity"] = qty

    tracked = ("name", "material", "carat", "weight_gm", "quantity")
    if all(updated[k] == row[k] for k in tracked):
        raise WorkflowError("No changes to save.")
    before, after = describe_item(row), describe_item(updated)
    remeasure = any(updated[k] != row[k] for k in ("carat", "weight_gm", "material"))
    row.update(updated)
    if remeasure and row.get("measurement"):
        row["measurement_status"] = measurement_status(row, valuation_of(state))
        row["measurement_overridden"] = False
    for dmg in state["damages"]:
        if dmg["ornament_id"] == ref:
            dmg["item"] = row["name"]
    entry = _audit_entry("edit", ref, row["name"], before, after, justification)
    state["audit"].append(entry)
    return entry


# --------------------------------------------------------------------------- report
def valuation_view(state: dict) -> dict:
    """Pledge amount per item and in total, from the session's valuation table."""
    valuation = valuation_of(state)
    out = value_inventory(state["inventory"], valuation)
    out["materials"] = [
        {"key": m["key"], "name": m["name"], "ltv_pct": m["ltv_pct"]} for m in valuation.get("materials", [])
    ]
    return out


def inventory_stats(state: dict) -> dict:
    inv = state["inventory"]
    totals = value_inventory(inv, valuation_of(state))["totals"]
    weights = weight_summary(state)
    return {
        "items": len(inv),
        "pieces": sum(int(r.get("quantity") or 1) for r in inv),
        "detected": sum(1 for r in inv if r.get("origin", "detected") == "detected"),
        "manual": sum(1 for r in inv if r.get("origin") == "manual"),
        "weighed": weights["weighed"],
        "damaged": len(state["damages"]),
        "total_weight": weights["entered_g"],
        "measured_weight": weights["measured_g"],
        "measured": sum(1 for r in inv if r.get("measurement")),
        "measurement_flags": weights["flagged"],
        "pledge_amount": totals["pledge_amount"],
        "pledge_is_estimate": totals["is_estimate"],
    }


def review_reasons(state: dict) -> List[dict]:
    """Everything the approving officer should look at, most important first."""
    warn: List[dict] = []
    info: List[dict] = []

    if not state["inventory"]:
        warn.append({"level": "warn", "text": "No ornaments were listed for this verification"})
    unweighed = unweighed_items(state)
    if unweighed:
        warn.append({"level": "warn", "text": f"{len(unweighed)} item(s) have no weight: " + ", ".join(r["name"] for r in unweighed)})
    images = state["collateral"]["images"]
    latest_upload = max((im["upload_no"] for im in images), default=0)
    # Earlier captures superseded by a re-capture don't count against the verification.
    flagged = [im for im in images if im["upload_no"] == latest_upload and im["status"] in ("alert", "fail")]
    if flagged:
        first = next((i for im in flagged for i in im["issues"]), "quality issue")
        warn.append({"level": "warn", "text": f"{len(flagged)} collateral photo(s) flagged — {first}"})
    if uses_weight(state):
        if not state.get("measurements"):
            warn.append({"level": "warn", "text": "Purity was not measured on the CaratMeter — no pledge amount can be computed"})
        for r in unresolved_measurements(state):
            warn.append({"level": "warn", "text": f"{r['name']}: {measurement_issue(r)}"})
        scale = weight_summary(state)
        if not scale["scale_overridden"]:
            if scale["scale_status"] in ("pending", "missing"):
                warn.append({"level": "warn", "text": "No weighing-machine total captured for this collateral"})
            elif scale["scale_status"] == "mismatch":
                warn.append({"level": "warn", "text": (
                    f"Weighing machine reads {_grams(scale['scale_g'])} g against {_grams(scale['entered_g'])} g "
                    f"entered across the items — a difference of {_grams(abs(scale['scale_diff_g']))} g"
                )})
        unpriced = value_inventory(state["inventory"], valuation_of(state))["totals"]["unpriced"]
        if unpriced:
            warn.append({"level": "warn", "text": "No rate configured for the purity of: " + ", ".join(unpriced)})
    for d in unresolved(state["damages"], ("alert", "fail")):
        detail = d.get("notes") or ("damage photo unusable" if d["status"] == "fail" else "described damage not confirmed")
        warn.append({"level": "warn", "text": f"{d['item']}: {detail}"})
    docs = document_items(state)
    if not docs:
        warn.append({"level": "warn", "text": "No documentary proof uploaded"})
    for d in unresolved(docs, ("alert", "fail")):
        detail = d["issues"][0] if d["issues"] else d["status"]
        warn.append({"level": "warn", "text": f"{d['declared_type']}: {detail}"})

    manual = [r for r in state["inventory"] if r.get("origin") == "manual"]
    if manual:
        info.append({"level": "info", "text": f"{len(manual)} item(s) added by the assessor: " + ", ".join(r["name"] for r in manual)})
    edits = [a for a in state["audit"] if is_correction(a)]
    overrides = [a for a in state["audit"] if not is_correction(a)]
    if overrides:
        info.append({"level": "info", "text": f"{len(overrides)} override(s) recorded with justification"})
    if edits:
        info.append({"level": "info", "text": f"{len(edits)} correction(s) recorded"})
    if not state.get("ai_enabled", True):
        info.append({"level": "info", "text": f"AI validation is disabled for {state['loan'].get('scenario', 'this scenario')} — manual verification"})
    return warn + info


def build_report(state: dict, report_id: Optional[str] = None, generated_at: Optional[str] = None) -> dict:
    reasons = review_reasons(state)
    review = any(r["level"] == "warn" for r in reasons)
    ts = generated_at or now_iso()
    rid = report_id or f"GLV-{ts[:10].replace('-', '')}-{uuid.uuid4().hex[:6].upper()}"
    return {
        "report_id": rid,
        "run_id": uuid.uuid4().hex,
        "generated_at": ts,
        "recommendation": "REVIEW" if review else "PROCEED",
        "overall_status": run_overall_status(state),
        "reasons": reasons,
        "stats": inventory_stats(state),
        "valuation": valuation_view(state),
        "weight": weight_summary(state) if uses_weight(state) else None,
    }


def run_overall_status(state: dict) -> str:
    """fail if anything unusable is unresolved; alert if anything needs review; else pass."""
    unusable_capture = any(im["status"] == "fail" for im in state["collateral"]["images"]) and not state["inventory"]
    if unresolved(state["damages"], ("fail",)) or unresolved(document_items(state), ("fail",)) or unusable_capture:
        return "fail"
    if any(r["level"] == "warn" for r in review_reasons(state)):
        return "alert"
    return "pass"


def _counts(statuses: Iterable[str]) -> Dict[str, int]:
    out = {s: 0 for s in CHECKED}
    for s in statuses:
        if s in out:
            out[s] += 1
    return out


def run_record(state: dict) -> dict:
    """The reporting record persisted when the report is generated."""
    report = state["report"]
    coll = state["collateral"]["images"]
    docs = document_items(state)
    return {
        "id": report["run_id"],
        "session_id": state["session_id"],
        "created_at": report["generated_at"],
        "date": report["generated_at"][:10],
        "loan": state["loan"],
        "overall_status": report["overall_status"],
        "summary": {
            "report_id": report["report_id"],
            "recommendation": report["recommendation"],
            "overall_status": report["overall_status"],
            "reasons": report["reasons"],
            "stats": report["stats"],
            "ai_enabled": state.get("ai_enabled", True),
            "pledge_amount": report["stats"].get("pledge_amount"),
            "narrative": f"{report['stats']['items']} items · {report['stats']['damaged']} damaged · "
                         f"{len(docs)} document(s) · {report['recommendation']}",
        },
        "collateral_images": [
            {"index": im["index"], "asset_id": im["asset_id"], "filename": im["filename"],
             "status": im["status"], "issues": im["issues"]}
            for im in coll
        ],
        "damage_images": [
            {"ornament_id": d["ornament_id"], "ornament_name": d["item"], "asset_id": d.get("thumb_asset_id") or d.get("asset_id"),
             "filename": d.get("filename", ""), "status": d["status"],
             "described_damage": d.get("assessor_details") or d.get("type", ""),
             "issues": [d["notes"]] if d.get("notes") else [], "overridden": d.get("overridden", False)}
            for d in state["damages"]
        ],
        "documents": [
            {"doc_no": d["doc_no"], "doc_type": d["declared_type"], "asset_id": d.get("asset_id"),
             "filename": d.get("filename", ""), "content_type": d.get("content_type", ""),
             "status": d["status"], "issues": d["issues"], "overridden": d.get("overridden", False)}
            for d in docs
        ],
        "counts": {
            "collateral": _counts(im["status"] for im in coll),
            "damage": _counts(d["status"] for d in state["damages"]),
            "document": _counts(d["status"] for d in docs),
        },
    }


# --------------------------------------------------------------------------- client view
def view(state: dict, settings) -> dict:
    """The JSON the frontend renders. Sensitive CBS KYC values are masked."""
    loan = dict(state["loan"])
    loan["id_number_masked"] = mask_id(loan.pop("id_number", "") or "")
    loan["has_address"] = bool(loan.pop("address", ""))
    blocker = blocker_of(state, settings)
    documents = None
    if state["documents"] is not None:
        documents = {
            **state["documents"],
            "items": [
                {**d, "extracted": {**d["extracted"], "id_number": mask_id(d["extracted"].get("id_number", ""))}}
                for d in state["documents"]["items"]
            ],
        }
    from app.integrations import caratmeter  # local import keeps this module free of I/O deps at load

    valuation = valuation_of(state)
    return {
        "session_id": state["session_id"],
        "workflow_state": state["workflow_state"],
        "steps": steps_of(state),
        "ai_enabled": state.get("ai_enabled", True),
        "loan": loan,
        "inventory": state["inventory"],
        "collateral": state["collateral"],
        "scale": state.get("scale"),
        "measurements": state.get("measurements"),
        "weight": weight_summary(state),
        "valuation": valuation_view(state),
        "caratmeter": {
            "device_id": caratmeter.device_id_for(state["loan"].get("branch", "")),
            "model": caratmeter.MODEL,
            "mode": caratmeter.gateway_mode(),
        },
        "damages": state["damages"],
        "documents": documents,
        "audit": state["audit"],
        "report": state["report"],
        "stats": inventory_stats(state),
        "allowed_actions": list(allowed_actions(state)),
        "gate": gate(state, blocker),
        "settings": {
            "blocker_mode": blocker,
            "max_ornaments_per_image": settings.max_ornaments_per_image,
            "foreign_object_threshold_pct": settings.foreign_object_threshold_pct,
            "doc_match_threshold_pct": settings.doc_match_threshold_pct,
        },
        "options": {
            "damage_types": list(DAMAGE_TYPES),
            "severities": list(SEVERITIES),
            "document_types": list(DOCUMENT_TYPES),
            "carats": list(CARATS),
            "materials": [{"key": m["key"], "name": m["name"]} for m in valuation.get("materials", [])],
            "grades": {m["key"]: [g["grade"] for g in m["grades"]] for m in valuation.get("materials", [])},
            "damage_deduction": valuation.get("damage_deduction", "tenths"),
        },
    }

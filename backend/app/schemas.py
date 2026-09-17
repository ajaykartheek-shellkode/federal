"""Pydantic models: the legacy v1 request payload and each agent's output.

The agent-output models double as the JSON contract we force the model to return
(``model_json_schema()`` is embedded into the prompts) and as the validation layer
that guarantees the frontend always receives well-formed results.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# Three-tier validation status:
#   pass  (green)  — usable AND declared details match the evidence
#   alert (yellow) — usable/clear, BUT the recorded details don't match what's visible/readable
#   fail  (red)    — the image/document is not usable at all (unclear, unrelated, not inspectable)
Status = Literal["pass", "alert", "fail"]


# --------------------------------------------------------------------------- #
# Request payload (JSON string sent in the multipart "payload" field)
# --------------------------------------------------------------------------- #
class OrnamentIn(BaseModel):
    id: str
    name: str
    carat: str
    weight_gm: float
    quantity: int = 1
    damage_visible: bool = False
    damage_count: int = 0
    damage_details: str = ""  # CBS description, passed verbatim to the damage agent
    # Index into the uploaded damage files list, if a damage image was attached.
    damage_image_index: Optional[int] = None


class DocumentIn(BaseModel):
    doc_no: int
    doc_type: str
    # Index into the uploaded document files list.
    file_index: int


class LoanContext(BaseModel):
    account_number: str
    customer_id: str
    customer_name: str
    scenario: str = "Fresh Loan"


class ValidatePayload(BaseModel):
    loan_context: LoanContext
    ornaments: List[OrnamentIn] = Field(default_factory=list)
    documents: List[DocumentIn] = Field(default_factory=list)
    collateral_image_count: int = 0


# --------------------------------------------------------------------------- #
# Agent output: Collateral Image Validation
# --------------------------------------------------------------------------- #
class BoundingBox(BaseModel):
    # Normalized 0-1 coordinates relative to the image.
    x: float = 0.0
    y: float = 0.0
    w: float = 0.0
    h: float = 0.0


class DetectedItem(BaseModel):
    """One ornament the Vision model located in a collateral image."""

    label: str = ""  # short descriptor, e.g. "gold chain" (NOT an identity claim)
    box: BoundingBox = Field(default_factory=BoundingBox)
    # Filled server-side after cropping / mapping (not asked of the model):
    thumb_asset_id: Optional[str] = None
    matched_ornament_id: Optional[str] = None


class CollateralImageResult(BaseModel):
    index: int
    status: Status
    clarity_ok: bool
    all_visible: bool
    not_cropped: bool
    no_obstruction: bool
    no_foreign_objects: bool
    clean_background: bool
    ornament_count_estimate: int
    # Estimated share of the image occupied by foreign/unrelated objects (0-100).
    foreign_object_percent: int = 0
    # Per-item detections with bounding boxes (used for cropped thumbnails).
    items: List[DetectedItem] = Field(default_factory=list)
    # Weighing-scale display captured with the ornaments (total weight of everything on the pan).
    scale_reading_visible: bool = False
    scale_weight_g: Optional[float] = None
    scale_reading_text: str = ""
    issues: List[str] = Field(default_factory=list)


class CollateralResult(BaseModel):
    overall_status: Status
    images: List[CollateralImageResult] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    corrective_actions: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Agent output: Damage Assessment (one per damaged ornament)
# --------------------------------------------------------------------------- #
class DamageCapture(BaseModel):
    visible: bool
    inspectable: bool
    clear: bool
    no_obstruction: bool
    no_foreign_objects: bool
    issues: List[str] = Field(default_factory=list)


class DamageReasoning(BaseModel):
    consistent_with_description: bool
    described_damage: str
    observed_damage: List[str] = Field(default_factory=list)
    additional_observations: List[str] = Field(default_factory=list)
    # Severity of the damage visible in the photo (independent of the assessor's rating).
    assessed_severity: Literal["none", "minor", "moderate", "severe"] = "none"
    notes: str = ""


class DamageResult(BaseModel):
    ornament_id: str
    status: Status
    capture: DamageCapture
    reasoning: DamageReasoning
    corrective_actions: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Agent output: Document Validation
# --------------------------------------------------------------------------- #
class DocumentPageResult(BaseModel):
    page: int
    status: Status
    issues: List[str] = Field(default_factory=list)


class DocumentExtracted(BaseModel):
    name: str = ""
    id_number: str = ""
    address: str = ""


class DocumentMatches(BaseModel):
    name: bool = False
    id: bool = False
    address_pct: int = 0  # 0-100 fuzzy match against CBS address


class DocumentItemResult(BaseModel):
    doc_no: int
    declared_type: str
    status: Status
    legible: bool
    complete: bool
    type_matches_declared: bool
    doc_type_detected: str = ""
    # OCR + cross-verification against the CBS customer record.
    extracted: DocumentExtracted = Field(default_factory=DocumentExtracted)
    matches: DocumentMatches = Field(default_factory=DocumentMatches)
    pages: List[DocumentPageResult] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)


class DocumentResult(BaseModel):
    overall_status: Status
    documents: List[DocumentItemResult] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    corrective_actions: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Agent output: Validation Summary
# --------------------------------------------------------------------------- #
class SummaryResult(BaseModel):
    overall_status: Status
    collateral_status: Status
    damage_status: Status
    document_status: Status
    issues: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    narrative: str = ""

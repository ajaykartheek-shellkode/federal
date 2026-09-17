"""Agent-execution step definitions shown in the chat panel (TDD v3.0 §3.1).

Every step is bound to real work in ``app.workflow.flow``: steps that do I/O or call the
model are shown "active" for exactly as long as that work runs; the remaining checks are
facets of the same model response and tick through with a short, legible pacing.
"""

from __future__ import annotations

COLLATERAL_STEPS = [
    {"key": "receive", "label": "Receiving & securing photos"},
    {"key": "vision", "label": "Invoking Claude Vision (multimodal)"},
    {"key": "detect", "label": "Detecting individual items"},
    {"key": "count", "label": "Counting collateral items"},
    {"key": "crossverify", "label": "Cross-verifying against CBS inventory"},
    {"key": "visibility", "label": "Checking visibility & overlap"},
    {"key": "foreign", "label": "Detecting foreign objects"},
    {"key": "background", "label": "Validating background clarity"},
    {"key": "scale", "label": "Reading weighing-scale display"},
    {"key": "crop", "label": "Cropping item thumbnails"},
    {"key": "result", "label": "Recording verification result"},
]

COLLATERAL_MANUAL_STEPS = [
    {"key": "receive", "label": "Receiving & securing photos"},
    {"key": "record", "label": "Recording assessor confirmation (AI off)"},
    {"key": "result", "label": "Updating inventory"},
]

WEIGHT_STEPS = [
    {"key": "connect", "label": "Connecting to CaratMeter"},
    {"key": "measure", "label": "Measuring weight & purity (XRF)"},
    {"key": "grade", "label": "Grading purity against valuation table"},
    {"key": "crosscheck", "label": "Cross-verifying with CBS declaration"},
    {"key": "scale", "label": "Reconciling weighing-scale reading"},
    {"key": "valuation", "label": "Computing pledge amount"},
    {"key": "result", "label": "Recording measurements"},
]

DAMAGE_STEPS = [
    {"key": "receive", "label": "Receiving damage photos"},
    {"key": "detect", "label": "Invoking Damage Detector Agent"},
    {"key": "type", "label": "Identifying damage type & location"},
    {"key": "severity", "label": "Assessing damage severity"},
    {"key": "match", "label": "Matching to inventory items"},
    {"key": "thumb", "label": "Generating damage thumbnails"},
    {"key": "update", "label": "Updating inventory records"},
]

DAMAGE_MANUAL_STEPS = [
    {"key": "receive", "label": "Receiving damage photos"},
    {"key": "thumb", "label": "Generating damage thumbnails"},
    {"key": "update", "label": "Recording damage (AI off)"},
]

DOCUMENT_STEPS = [
    {"key": "receive", "label": "Receiving documents"},
    {"key": "verify", "label": "Invoking Document Verifier Agent"},
    {"key": "complete", "label": "Checking document completeness"},
    {"key": "legible", "label": "Assessing text legibility"},
    {"key": "ocr", "label": "Extracting applicant details (OCR)"},
    {"key": "name", "label": "Cross-verifying name against CBS"},
    {"key": "id", "label": "Cross-verifying ID number against CBS"},
    {"key": "address", "label": "Cross-verifying address & thresholds"},
    {"key": "result", "label": "Recording verification result"},
]

DOCUMENT_MANUAL_STEPS = [
    {"key": "receive", "label": "Receiving documents"},
    {"key": "result", "label": "Recording documents (AI off)"},
]

REPORT_STEPS = [
    {"key": "generator", "label": "Invoking Report Generator"},
    {"key": "collateral", "label": "Compiling collateral verification"},
    {"key": "weight", "label": "Compiling weight, purity & pledge valuation"},
    {"key": "damage", "label": "Compiling damage assessment"},
    {"key": "docs", "label": "Compiling document verification"},
    {"key": "overrides", "label": "Checking override audit trail"},
    {"key": "recommend", "label": "Generating final recommendation"},
    {"key": "render", "label": "Publishing report"},
]

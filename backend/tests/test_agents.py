"""Unit tests for agent post-processing and Bedrock helpers (no network)."""

from __future__ import annotations

import io

import pytest

from app.agents import collateral as C
from app.agents import conversation
from app.agents import document as D
from app.agents.assets import Asset
from app.bedrock import imageprep
from app.bedrock.converse import extract_json
from app.schemas import (
    BoundingBox,
    CollateralImageResult,
    CollateralResult,
    DetectedItem,
    DocumentItemResult,
    DocumentMatches,
    DocumentResult,
)


def img_result(index, status, items):
    return CollateralImageResult(
        index=index, status=status, clarity_ok=True, all_visible=True, not_cropped=True, no_obstruction=True,
        no_foreign_objects=True, clean_background=True, ornament_count_estimate=len(items), items=items,
    )


def test_normalize_fills_missing_images_and_applies_threshold():
    result = CollateralResult(overall_status="pass", images=[
        img_result(0, "pass", []).model_copy(update={"foreign_object_percent": 30}),
        img_result(7, "pass", []),  # out of range → ignored
    ])
    out = C._normalize(result, 2, {}, foreign_pct=10)
    assert [i.index for i in out.images] == [0, 1]
    assert out.images[0].status == "alert" and "Foreign objects ~30%" in out.images[0].issues[0]
    assert out.images[1].status == "fail"
    assert out.overall_status == "fail"


def test_crop_detections_thumbnails_every_ornament(monkeypatch):
    from tests.conftest import png_bytes

    saved = []
    monkeypatch.setattr(C.store, "save_asset", lambda data, ct: saved.append((len(data), ct)) or f"thumb{len(saved)}")
    box = BoundingBox(x=0.1, y=0.1, w=0.5, h=0.5)
    result = CollateralResult(overall_status="pass", images=[
        img_result(0, "pass", [DetectedItem(label="Gold Ring", box=box), DetectedItem(label="Gold Chain", box=box)]),
        img_result(1, "fail", [DetectedItem(label="Gold Bangle", box=box)]),  # unusable photo: nothing to inventory
    ])
    images = [Asset(png_bytes((200, 200)), "p.png", "image/png"), Asset(png_bytes((200, 200)), "q.png", "image/png")]
    assert C.crop_detections(result, images) == 2
    assert [i.thumb_asset_id for i in result.images[0].items] == ["thumb1", "thumb2"]
    assert result.images[1].items[0].thumb_asset_id is None
    assert saved and saved[0][1] == "image/png"


def test_scale_agent_keeps_only_plausible_readings():
    from app.agents import scale as SC
    from app.schemas import ScaleResult

    good = SC._normalize(ScaleResult(status="pass", reading_visible=True, weight_g=90.0249, reading_text="  90.02   g "))
    assert (good.weight_g, good.reading_text) == (90.025, "90.02 g")
    for bad in (
        ScaleResult(status="pass", reading_visible=True, weight_g=float("nan")),
        ScaleResult(status="pass", reading_visible=True, weight_g=-4, reading_text="-4 g"),
        ScaleResult(status="pass", reading_visible=False, weight_g=12.0, reading_text="12 g"),
    ):
        out = SC._normalize(bad)
        assert (out.reading_visible, out.weight_g, out.reading_text) == (False, None, "")


def _doc(no, status="pass", **kw):
    return DocumentItemResult(doc_no=no, declared_type="", status=status, legible=True, complete=True, type_matches_declared=True, **kw)


def test_realign_zero_indexed_numbers_fall_back_to_position():
    docs = [(1, "Aadhaar Card", None), (2, "PAN Card", None)]
    result = DocumentResult(overall_status="alert", documents=[_doc(0), _doc(1, status="alert")])
    out = D._realign(result, docs)
    assert [(d.doc_no, d.status) for d in out.documents] == [(1, "pass"), (2, "alert")]


def test_realign_by_number_then_position_then_failure():
    docs = [(1, "Aadhaar Card", None), (2, "PAN Card", None), (3, "Passport", None)]
    result = DocumentResult(overall_status="pass", documents=[_doc(2), _doc(1)])  # exact numbers, reordered, one missing
    out = D._realign(result, docs)
    assert [(d.doc_no, d.declared_type) for d in out.documents] == [(1, "Aadhaar Card"), (2, "PAN Card"), (3, "Passport")]
    assert out.documents[2].status == "fail"
    assert out.overall_status == "fail"


def test_apply_cbs_checks_scopes_fields_by_type():
    cbs = {"customer_name": "Rajesh Kumar", "id_number": "2337", "address": "12 MG Road"}
    aadhaar = _doc(1, matches=DocumentMatches(name=True, id=True, address_pct=60))
    aadhaar.declared_type = "Aadhaar Card"
    pan = _doc(2, matches=DocumentMatches(name=True, id=True, address_pct=0))
    pan.declared_type = "PAN Card"
    unreadable = _doc(3, status="fail", matches=DocumentMatches())
    unreadable.declared_type = "Aadhaar Card"
    out = D.apply_cbs_checks(DocumentResult(overall_status="pass", documents=[aadhaar, pan, unreadable]), cbs, 80)
    assert out.documents[0].status == "alert" and "Address match 60% (min 80%)" in out.documents[0].issues
    assert out.documents[1].status == "pass"  # PAN cards carry no address
    assert out.documents[2].issues == []  # unreadable docs are not second-guessed
    assert out.overall_status == "fail"


def test_extract_json_tolerates_fences_braces_and_prose():
    raw = '```json\n{"text": "use {curly} braces", "n": 1}\n```\nThanks!'
    assert extract_json(raw) == {"text": "use {curly} braces", "n": 1}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_imageprep_applies_exif_orientation():
    from PIL import Image

    img = Image.new("RGB", (400, 100), (255, 0, 0))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    data, fmt = imageprep.prepare(buf.getvalue(), "jpeg")
    assert fmt == "jpeg"
    assert Image.open(io.BytesIO(data)).size == (100, 400)


def test_imageprep_keeps_original_format_on_decode_failure():
    data, fmt = imageprep.prepare(b"not an image", "png")
    assert (data, fmt) == (b"not an image", "png")


def test_journey_drafts_are_fact_exact():
    listed = conversation.draft("collateral", {"ai_enabled": True, "total": 3, "names": ["Gold Chain", "Gold Bangle", "Silver Anklet"]})
    assert "3 ornaments" in listed and "Gold Chain, Gold Bangle, Silver Anklet" in listed
    assert "enter each item's weight" in listed

    empty = conversation.draft("collateral", {"ai_enabled": True, "total": 0, "names": []})
    assert "couldn't make out any ornaments" in empty
    assert "to the list yourself" in conversation.draft("collateral", {"ai_enabled": False})

    machine = conversation.draft("scale", {"ai_enabled": True, "scale_g": 33.05, "entered_g": 31.5, "differs": True, "diff_g": 1.55})
    assert "33.05 g" in machine and "31.50 g" in machine and "1.55 g" in machine

    unread = conversation.draft("scale", {"ai_enabled": True, "scale_g": None, "first_issue": "Display not readable"})
    assert "Enter the total" in unread and "Display not readable" in unread

    flagged = conversation.draft("weight", {"total": 6, "measured": 6, "flagged": ["Gold Pendant"], "grades": ["22K"],
                                            "pledge_amount": 410303, "blocker": True, "scale_missing": True})
    assert "Gold Pendant" in flagged and "₹4,10,303" in flagged and "justification" in flagged
    assert "No weighing-machine total" in flagged

    clean = conversation.draft("weight", {"total": 8, "measured": 8, "flagged": [], "grades": ["22K", "18K"], "pledge_amount": 554539})
    assert "22K, 18K" in clean and "₹5,54,539" in clean

    damage = conversation.draft("damage", {"ai_enabled": True, "recorded": ["Gold Bangle"], "needs_review": 0,
                                           "deduction": 8, "next_label": "pledge valuation"})
    assert "<strong>8%</strong> damage deduction" in damage and "pledge valuation" in damage
    assert conversation._inr(1234567) == "₹12,34,567" and conversation._inr(999) == "₹999"


def test_guidance_drafts_carry_the_next_action():
    welcome = conversation.draft("welcome", {"customer": "Rajesh Kumar", "scenario": "Fresh Loan", "branch": "FED-MUM-001",
                                             "application_no": "APP-2026-00042", "ai_enabled": True})
    assert "APP-2026-00042" in welcome and "Rajesh Kumar" in welcome and "up to 3 photos" in welcome
    assert "recommended to proceed" in welcome  # the account comes later
    renewal = conversation.draft("welcome", {"customer": "Priya Sharma", "scenario": "Renewal", "branch": "FED-DEL-007",
                                             "account_number": "GL2024001189", "ai_enabled": True})
    assert "GL2024001189" in renewal and "application" not in renewal.lower()

    sanctioned = conversation.draft("report", {"report_id": "GLV-1", "recommendation": "PROCEED", "pledge_amount": 548730,
                                               "account_number": "GLMUM000012", "application_no": "APP-2026-00042", "fresh": True})
    assert "GLMUM000012" in sanctioned and "APP-2026-00042" in sanctioned
    review = conversation.draft("report", {"report_id": "GLV-1", "recommendation": "REVIEW", "warnings": 2, "fresh": True})
    assert "REVIEW" in review and "No gold loan account is opened yet" in review
    assert "weighing-machine photo" in conversation.draft("continue", {"to": "weight"})
    assert "pledge valuation" in conversation.draft("continue", {"to": "valuation"})


def test_guidance_skips_model_when_ai_off(fake_bedrock):
    import asyncio

    text = asyncio.run(conversation.guidance("document_prompt", {}, ai_enabled=False))
    assert "documentary proof" in text and fake_bedrock.calls == []
    polished = asyncio.run(conversation.guidance("document_prompt", {}, ai_enabled=True))
    assert polished == "Polished message." and fake_bedrock.calls

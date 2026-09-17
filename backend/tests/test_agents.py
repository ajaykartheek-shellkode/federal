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


def test_ornament_kind_prefers_specific_names():
    assert C.ornament_kind("Gold Earrings") == "earring"
    assert C.ornament_kind("gold ring") == "ring"
    assert C.ornament_kind("Gold Necklace") == "necklace"
    assert C.ornament_kind("mangalsutra") == ""


def test_match_items_rejects_wrong_kind_and_falls_back():
    inventory = [{"id": "ring-1", "name": "Gold Ring"}, {"id": "earring-1", "name": "Gold Earrings"}]
    result = CollateralResult(overall_status="pass", images=[img_result(0, "pass", [
        DetectedItem(label="earring", matched_ornament_id="ring-1"),  # model mismatched the kind
        DetectedItem(label="ring"),  # model gave no id
        DetectedItem(label="ring", matched_ornament_id=""),  # model explicitly found no row
    ])])
    assert C.match_items(result, inventory) == 2
    items = result.images[0].items
    assert items[0].matched_ornament_id == "earring-1"
    assert items[1].matched_ornament_id == "ring-1"
    assert items[2].matched_ornament_id is None


def test_match_items_uses_up_already_sighted_rows_first():
    inventory = [{"id": "ring-1", "name": "Gold Ring"}, {"id": "ring-2", "name": "Gold Ring"}]
    result = CollateralResult(overall_status="pass", images=[img_result(0, "pass", [
        DetectedItem(label="ring", matched_ornament_id="ring-2"),
        DetectedItem(label="ring", matched_ornament_id="ring-1"),
    ])])
    assert C.match_items(result, inventory, already_sighted=["ring-2"]) == 1
    assert [i.matched_ornament_id for i in result.images[0].items] == ["ring-2", "ring-1"]


def test_match_items_trusts_model_when_kind_absent_from_inventory():
    inventory = [{"id": "necklace-1", "name": "Gold Necklace"}]
    result = CollateralResult(overall_status="pass", images=[img_result(0, "pass", [
        DetectedItem(label="gold chain", matched_ornament_id="necklace-1"),
    ])])
    assert C.match_items(result, inventory) == 1


def test_match_items_skips_failed_images_and_unknown_ids():
    inventory = [{"id": "chain-1", "name": "Gold Chain"}]
    result = CollateralResult(overall_status="fail", images=[
        img_result(0, "fail", [DetectedItem(label="chain", matched_ornament_id="chain-1")]),
        img_result(1, "pass", [DetectedItem(label="bangle", matched_ornament_id="bangle-9")]),
    ])
    assert C.match_items(result, inventory) == 0
    assert all(i.matched_ornament_id is None for im in result.images for i in im.items)


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


def test_crop_matched_creates_thumbnails(monkeypatch):
    from tests.conftest import png_bytes

    saved = []
    monkeypatch.setattr(C.store, "save_asset", lambda data, ct: saved.append((len(data), ct)) or "thumb1")
    result = CollateralResult(overall_status="pass", images=[img_result(0, "pass", [
        DetectedItem(label="ring", box=BoundingBox(x=0.1, y=0.1, w=0.5, h=0.5), matched_ornament_id="ring-1"),
        DetectedItem(label="chain", box=BoundingBox(x=0.1, y=0.1, w=0.5, h=0.5), matched_ornament_id=None),
    ])])
    assert C.crop_matched(result, [Asset(png_bytes((200, 200)), "p.png", "image/png")]) == 1
    assert result.images[0].items[0].thumb_asset_id == "thumb1"
    assert saved and saved[0][1] == "image/png"


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


def test_normalize_keeps_only_plausible_scale_readings():
    good = img_result(0, "pass", []).model_copy(update={"scale_reading_visible": True, "scale_weight_g": 90.0249, "scale_reading_text": "  90.02   g "})
    nan = img_result(1, "pass", []).model_copy(update={"scale_reading_visible": True, "scale_weight_g": float("nan"), "scale_reading_text": "--"})
    hidden = img_result(2, "pass", []).model_copy(update={"scale_reading_visible": False, "scale_weight_g": 12.0})
    failed = img_result(3, "fail", []).model_copy(update={"scale_reading_visible": True, "scale_weight_g": 50.0})
    out = C._normalize(CollateralResult(overall_status="pass", images=[good, nan, hidden, failed]), 4, {}, foreign_pct=10)
    assert (out.images[0].scale_weight_g, out.images[0].scale_reading_text) == (90.025, "90.02 g")
    for img in out.images[1:]:
        assert (img.scale_reading_visible, img.scale_weight_g, img.scale_reading_text) == (False, None, "")


def test_weight_drafts_name_the_findings_and_pledge():
    flagged = conversation.draft("weight", {"total": 6, "measured_g": 67.37, "flagged": ["Gold Pendant"], "scale_g": 68.1,
                                            "scale_differs": True, "scale_diff_g": 0.73, "scale_basis": "CaratMeter",
                                            "pledge_amount": 410303, "blocker": True})
    assert "Gold Pendant" in flagged and "0.73 g" in flagged and "₹4,10,303" in flagged and "justification" in flagged
    clean = conversation.draft("weight", {"total": 8, "measured_g": 89.98, "flagged": [], "pledge_amount": 554539,
                                          "cbs_damaged": ["Gold Bangle", "Gold Ring"]})
    assert "89.98 g" in clean and "₹5,54,539" in clean and "photograph them" in clean
    assert conversation._inr(1234567) == "₹12,34,567" and conversation._inr(999) == "₹999"


def test_guidance_drafts_are_fact_exact():
    msg = conversation.draft("collateral", {"ai_enabled": True, "advanced": False, "verified": 6, "total": 8,
                                            "pending": ["Gold Ring", "Gold Chain"], "blocker": True})
    assert "6/8" in msg and "Gold Ring, Gold Chain" in msg and "blocker mode" in msg
    assert "REVIEW" in conversation.draft("report", {"report_id": "GLV-1", "recommendation": "REVIEW", "warnings": 2})


def test_guidance_skips_model_when_ai_off(fake_bedrock):
    import asyncio

    text = asyncio.run(conversation.guidance("document_prompt", {}, ai_enabled=False))
    assert "documentary proof" in text and fake_bedrock.calls == []
    polished = asyncio.run(conversation.guidance("document_prompt", {}, ai_enabled=True))
    assert polished == "Polished message." and fake_bedrock.calls

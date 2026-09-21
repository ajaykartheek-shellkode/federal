"""Unit tests for the pure workflow rules in app.workflow.state."""

from __future__ import annotations

import pytest

from app.settings import Settings
from app.workflow import state as S


def customer(**overrides):
    base = {
        "loan_context": {
            "account_number": "GL1", "customer_id": "C1", "customer_name": "Rajesh Kumar",
            "scenario": "Fresh Loan", "branch": "FED-MUM-001", "id_number": "2337 4600 1234", "address": "12 MG Road",
        },
        "rate_table": {"22": 8500, "18": 6900},
        "ornaments": [
            {"id": "chain-1", "name": "Gold Chain", "carat": "22", "weight_gm": 18, "quantity": 1},
            {"id": "ring-1", "name": "Gold Ring", "carat": "18", "weight_gm": 5, "quantity": 1,
             "damage_visible": True, "damage_details": "Scratch on band", "damage_percent": 4},
        ],
    }
    base.update(overrides)
    return base


def collateral_result(matches, status="pass", count=1, scale=None):
    return {
        "overall_status": status,
        "images": [
            {"index": i, "status": status, "clarity_ok": True, "all_visible": True, "not_cropped": True,
             "no_obstruction": True, "no_foreign_objects": True, "clean_background": True,
             "ornament_count_estimate": len(matches), "foreign_object_percent": 0,
             "scale_reading_visible": i == 0 and scale is not None,
             "scale_weight_g": scale if i == 0 else None,
             "scale_reading_text": f"{scale} g" if i == 0 and scale is not None else "",
             "issues": [] if status == "pass" else ["Blurry"],
             "items": [{"label": m, "matched_ornament_id": m, "thumb_asset_id": f"t-{m}"} for m in matches] if i == 0 else []}
            for i in range(count)
        ],
        "issues": [], "corrective_actions": [],
    }


def photo(n=1):
    return [{"asset_id": f"a{i}", "filename": f"p{i}.jpg"} for i in range(n)]


def readings(st, overrides=None):
    """A CaratMeter payload that reads every item exactly as declared, except ``overrides``."""
    from app.valuation import fineness_for_declared

    measurements = []
    for r in st["inventory"]:
        m = {"tag": r["id"], "net_weight_g": r["weight_gm"], "fineness_pct": fineness_for_declared(r["material"], r["carat"]),
             "sample_id": f"S-{r['id']}", "measured_at": "2026-09-17T10:00:00+05:30", "confidence": 0.99}
        m.update((overrides or {}).get(r["id"], {}))
        measurements.append(m)
    return {"device": {"device_id": "CM-FED-MUM-001", "model": "CaratMeter XRF-900", "mode": "mock"}, "measurements": measurements}


@pytest.fixture
def st():
    return S.new_state(customer(), ai_enabled=True)


def test_new_state_shape(st):
    assert st["workflow_state"] == "collateral"
    assert [r["status"] for r in st["inventory"]] == ["pending", "pending"]
    assert st["inventory"][1]["cbs_damage"] is True
    assert S.allowed_actions(st) == ("collateral", "continue")


def test_collateral_requires_a_photo_even_in_alert_mode(st):
    g = S.gate(st, blocker_mode=False)
    assert not g["allowed"] and "collateral photo" in g["reasons"][0]
    with pytest.raises(S.WorkflowError):
        S.advance(st, blocker_mode=False)


def test_record_collateral_matches_and_completes(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    assert [r["status"] for r in st["inventory"]] == ["verified", "verified"]
    assert st["inventory"][0]["thumb_asset_id"] == "t-chain-1"
    assert st["collateral"]["images"][0]["matched"] == ["chain-1", "ring-1"]
    assert S.collateral_complete(st)


def test_failed_photo_never_verifies_items(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1"], status="fail"))
    assert st["inventory"][0]["status"] == "pending"
    assert st["collateral"]["unmatched_detections"] == 1
    assert not S.collateral_complete(st)


def test_second_upload_offsets_indexes_and_keeps_verified(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1"]))
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    assert [im["index"] for im in st["collateral"]["images"]] == [0, 1]
    assert [im["upload_no"] for im in st["collateral"]["images"]] == [1, 2]
    assert st["inventory"][0]["source_image"] == 0  # already verified in photo 1
    assert st["inventory"][1]["source_image"] == 1


def test_blocker_mode_requires_all_items_sighted(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1"]))
    assert S.gate(st, blocker_mode=False)["allowed"]
    g = S.gate(st, blocker_mode=True)
    assert not g["allowed"] and "not sighted" in g["reasons"][0]
    S.apply_override(st, "item", "ring-1", "Seen in person by assessor")
    assert S.gate(st, blocker_mode=True)["allowed"]


def test_ai_off_marks_items_manual_and_completes():
    st = S.new_state(customer(), ai_enabled=False)
    S.record_collateral(st, photo(2), None)
    assert {r["status"] for r in st["inventory"]} == {"manual"}
    assert [im["status"] for im in st["collateral"]["images"]] == ["not_checked", "not_checked"]
    assert S.collateral_complete(st)


def test_damage_gate_in_blocker_mode(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    S.advance(st, blocker_mode=False)
    assert st["workflow_state"] == "weight"
    S.record_measurements(st, readings(st))
    S.advance(st, blocker_mode=False)
    assert st["workflow_state"] == "damage"
    g = S.gate(st, blocker_mode=True)
    assert not g["allowed"] and "CBS declares damage on Gold Ring" in g["reasons"][0]
    S.record_damage(st, {"ornament_id": "ring-1", "item": "Gold Ring", "status": "fail"})
    g = S.gate(st, blocker_mode=True)
    assert not g["allowed"] and "could not be inspected" in g["reasons"][0]
    S.apply_override(st, "damage", "ring-1", "Visually confirmed at counter")
    assert S.gate(st, blocker_mode=True)["allowed"]


def test_record_damage_replaces_and_clears_override(st):
    S.record_damage(st, {"ornament_id": "ring-1", "item": "Gold Ring", "status": "alert"})
    S.apply_override(st, "damage", "ring-1", "Accepted by branch manager")
    S.record_damage(st, {"ornament_id": "ring-1", "item": "Gold Ring", "status": "pass"})
    assert len(st["damages"]) == 1
    assert st["damages"][0]["status"] == "pass" and st["damages"][0]["overridden"] is False


def test_override_validation(st):
    with pytest.raises(S.WorkflowError, match="justification"):
        S.apply_override(st, "item", "ring-1", "no")
    with pytest.raises(S.WorkflowError, match="Unknown inventory item"):
        S.apply_override(st, "item", "nope", "valid reason")
    with pytest.raises(S.WorkflowError, match="No damage record"):
        S.apply_override(st, "damage", "chain-1", "valid reason")
    with pytest.raises(S.WorkflowError, match="Unknown override target"):
        S.apply_override(st, "weird", "ring-1", "valid reason")
    with pytest.raises(S.WorkflowError, match="before confirming"):
        S.apply_override(st, "item", "ring-1", "valid reason")
    S.record_collateral(st, photo(), collateral_result([]))
    S.apply_override(st, "item", "ring-1", "valid reason")
    with pytest.raises(S.WorkflowError, match="does not need an override"):
        S.apply_override(st, "item", "ring-1", "valid reason")


def test_edit_validation_and_audit(st):
    S.record_damage(st, {"ornament_id": "ring-1", "item": "Gold Ring", "status": "pass"})
    entry = S.apply_edit(st, "ring-1", {"name": "Gold Band", "weight_gm": "5.5", "carat": "22K"}, "Re-weighed at counter")
    row = S.find_item(st, "ring-1")
    assert (row["name"], row["weight_gm"], row["carat"]) == ("Gold Band", 5.5, "22")
    assert st["damages"][0]["item"] == "Gold Band"
    assert entry["original"] == "Gold Ring · 18K · 5g" and entry["new_value"] == "Gold Band · 22K · 5.5g"
    with pytest.raises(S.WorkflowError, match="Purity"):
        S.apply_edit(st, "ring-1", {"carat": "9"}, "valid reason")
    with pytest.raises(S.WorkflowError, match="Weight"):
        S.apply_edit(st, "ring-1", {"weight_gm": -1}, "valid reason")
    with pytest.raises(S.WorkflowError, match="No changes"):
        S.apply_edit(st, "ring-1", {"name": "Gold Band"}, "valid reason")


def test_documents_gate_and_report(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"], scale=23.02))
    S.advance(st, False)
    assert not S.gate(st, False)["allowed"]  # CaratMeter readings are always required
    S.record_measurements(st, readings(st))
    S.advance(st, False)
    S.record_damage(st, {"ornament_id": "ring-1", "item": "Gold Ring", "status": "pass", "notes": ""})
    S.advance(st, False)
    assert st["workflow_state"] == "valuation"  # pledge valuation is reviewed before documents
    S.advance(st, False)
    assert not S.gate(st, False)["allowed"]  # documents are always required
    S.record_documents(st, [{"doc_no": 1, "declared_type": "Aadhaar Card", "asset_id": "d1", "filename": "a.jpg", "content_type": "image/jpeg"}],
                       {"overall_status": "pass", "documents": [{"doc_no": 1, "status": "pass", "legible": True, "complete": True,
                        "type_matches_declared": True, "doc_type_detected": "Aadhaar Card", "extracted": {"name": "R", "id_number": "1", "address": "x"},
                        "matches": {"name": True, "id": True, "address_pct": 90}, "issues": []}], "issues": [], "corrective_actions": []})
    S.advance(st, False)
    assert st["workflow_state"] == "report"
    report = S.build_report(st)
    assert report["recommendation"] == "PROCEED"
    assert report["overall_status"] == "pass"
    assert report["stats"]["pledge_amount"] > 0 and report["stats"]["pledge_is_estimate"] is False
    assert report["weight"]["scale_status"] == "match" and report["valuation"]["totals"]["pledge_amount"] == report["stats"]["pledge_amount"]
    st["report"] = report
    record = S.run_record(st)
    assert record["counts"]["collateral"] == {"pass": 1, "alert": 0, "fail": 0}
    assert record["counts"]["damage"]["pass"] == 1 and record["counts"]["document"]["pass"] == 1
    assert record["summary"]["recommendation"] == "PROCEED"
    assert record["summary"]["pledge_amount"] == report["stats"]["pledge_amount"]


def test_report_review_reasons(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1"]))
    S.record_documents(st, [{"doc_no": 1, "declared_type": "PAN Card", "asset_id": "d1", "filename": "p.pdf", "content_type": "application/pdf"}],
                       {"overall_status": "alert", "documents": [{"doc_no": 1, "status": "alert", "issues": ["Name does not match CBS record"]}],
                        "issues": [], "corrective_actions": []})
    report = S.build_report(st)
    texts = " | ".join(r["text"] for r in report["reasons"])
    assert report["recommendation"] == "REVIEW"
    assert "not sighted" in texts and "CBS-declared damage" in texts and "Name does not match" in texts
    assert "not measured on the CaratMeter" in texts and "No weighing-scale reading" in texts
    assert report["overall_status"] == "alert"


def test_missing_document_result_is_a_failure(st):
    S.record_documents(st, [{"doc_no": 1, "declared_type": "Aadhaar Card", "asset_id": "d", "filename": "", "content_type": ""}],
                       {"overall_status": "pass", "documents": [], "issues": [], "corrective_actions": []})
    assert S.document_items(st)[0]["status"] == "fail"


def test_locked_after_done(st):
    S.record_collateral(st, photo(), collateral_result([]))
    st["workflow_state"] = "done"
    assert S.allowed_actions(st) == ()
    with pytest.raises(S.WorkflowError, match="locked"):
        S.apply_override(st, "item", "ring-1", "valid reason")
    with pytest.raises(S.WorkflowError, match="locked"):
        S.apply_edit(st, "ring-1", {"name": "X Ring"}, "valid reason")


def test_view_masks_kyc(st):
    st["session_id"] = "0" * 32
    v = S.view(st, Settings())
    assert "id_number" not in v["loan"] and "address" not in v["loan"]
    assert v["loan"]["id_number_masked"].endswith("1234") and v["loan"]["id_number_masked"].startswith("•")
    assert v["gate"]["allowed"] is False
    assert v["cbs_damage_pending"] == ["ring-1"]


def test_worst():
    assert S.worst([]) is None
    assert S.worst(["not_checked"]) is None
    assert S.worst(["pass", "alert"]) == "alert"
    assert S.worst(["alert", "fail", "pass"]) == "fail"


# --------------------------------------------------------------------------- review regressions
def test_same_ornament_photographed_twice_does_not_verify_its_twin():
    from app.agents.collateral import match_items
    from app.schemas import CollateralImageResult, CollateralResult, DetectedItem

    st = S.new_state(customer(ornaments=[
        {"id": "ring-1", "name": "Gold Ring", "carat": "22", "weight_gm": 4},
        {"id": "ring-2", "name": "Gold Ring", "carat": "22", "weight_gm": 4},
    ]), ai_enabled=True, blocker_mode=True)

    def upload():
        res = CollateralResult(overall_status="pass", images=[CollateralImageResult(
            index=0, status="pass", clarity_ok=True, all_visible=True, not_cropped=True, no_obstruction=True,
            no_foreign_objects=True, clean_background=True, ornament_count_estimate=1,
            items=[DetectedItem(label="ring", matched_ornament_id="ring-2")],
        )])
        sighted = [r["id"] for r in st["inventory"] if r["status"] in S.ITEM_OK]
        match_items(res, st["inventory"], sighted)
        S.record_collateral(st, photo(), res.model_dump())

    upload()
    upload()  # the very same single-ring photo again
    assert [r["status"] for r in st["inventory"]].count("verified") == 1
    assert not S.gate(st, S.blocker_of(st, None))["allowed"]


def test_superseded_flagged_photo_does_not_force_review(st):
    S.record_collateral(st, photo(), collateral_result([], status="fail"))
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"], scale=23))
    S.record_measurements(st, readings(st))
    S.record_damage(st, {"ornament_id": "ring-1", "item": "Gold Ring", "status": "pass"})
    S.record_documents(st, [{"doc_no": 1, "declared_type": "Aadhaar Card", "asset_id": "d", "filename": "", "content_type": ""}],
                       {"overall_status": "pass", "documents": [{"doc_no": 1, "status": "pass"}], "issues": [], "corrective_actions": []})
    report = S.build_report(st)
    assert report["recommendation"] == "PROCEED", report["reasons"]
    assert report["overall_status"] == "pass"


def test_enforcement_mode_is_captured_per_session():
    class Live:
        blocker_mode = False
        max_ornaments_per_image = 12
        foreign_object_threshold_pct = 10
        doc_match_threshold_pct = 80

    st = S.new_state(customer(), ai_enabled=True, blocker_mode=True)
    st["session_id"] = "0" * 32
    assert S.blocker_of(st, Live) is True
    assert S.view(st, Live)["settings"]["blocker_mode"] is True
    legacy = {k: v for k, v in st.items() if k != "blocker_mode"}
    assert S.blocker_of(legacy, Live) is False


def test_cbs_damage_can_be_waived_to_clear_blocker(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    S.advance(st, blocker_mode=True)
    S.record_measurements(st, readings(st))
    S.advance(st, blocker_mode=True)
    assert not S.gate(st, blocker_mode=True)["allowed"]
    entry = S.apply_override(st, "damage", "ring-1", "No damage found on inspection")
    assert entry["original"] == "CBS damage not photographed"
    assert S.gate(st, blocker_mode=True)["allowed"]
    with pytest.raises(S.WorkflowError, match="No damage record"):
        S.apply_override(st, "damage", "ring-1", "twice")


def test_tiny_weight_correction_is_saved(st):
    entry = S.apply_edit(st, "chain-1", {"weight_gm": 18.004}, "Calibrated scale")
    assert S.find_item(st, "chain-1")["weight_gm"] == 18.004
    assert entry["new_value"].endswith("18.004g")


def test_view_masks_ocr_id_number(st):
    st["session_id"] = "0" * 32
    S.record_documents(st, [{"doc_no": 1, "declared_type": "Aadhaar Card", "asset_id": "d", "filename": "", "content_type": ""}],
                       {"overall_status": "pass", "documents": [{"doc_no": 1, "status": "pass",
                        "extracted": {"name": "R", "id_number": "2337 4600 1234", "address": "x"}}], "issues": [], "corrective_actions": []})
    shown = S.view(st, Settings())["documents"]["items"][0]["extracted"]["id_number"]
    assert shown.endswith("1234") and "2337" not in shown
    assert st["documents"]["items"][0]["extracted"]["id_number"] == "2337 4600 1234"  # stored value untouched


# --------------------------------------------------------------------------- weight, purity & valuation
def test_measurements_flag_weight_and_purity_differences(st):
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    assert S.advance(st, False) == "weight"
    assert S.allowed_actions(st) == ("measure", "continue")
    assert "CaratMeter" in S.gate(st, False)["reasons"][0]

    S.record_measurements(st, readings(st, {"chain-1": {"net_weight_g": 17.4}, "ring-1": {"fineness_pct": 70.1}}))
    chain, ring = st["inventory"]
    assert chain["measurement_status"] == "weight_mismatch" and chain["measurement"]["grade"] == "22K"
    assert ring["measurement_status"] == "purity_low" and ring["measurement"]["grade"] == "14K"
    assert st["measurements"]["device"]["device_id"] == "CM-FED-MUM-001" and st["measurements"]["count"] == 2

    assert S.gate(st, False)["allowed"]  # alert mode: advisory
    g = S.gate(st, True)
    assert not g["allowed"] and "differ from the declared weight or purity" in g["reasons"][0]
    texts = " | ".join(r["text"] for r in S.review_reasons(st))
    assert "Gold Chain: measured 17.4 g vs 18 g declared" in texts
    assert "Gold Ring: purity 70.1% (14K) vs 18K declared" in texts

    entry = S.apply_override(st, "measurement", "chain-1", "Clasp replaced, re-weighed at counter")
    assert entry["original"] == "measured 17.4 g vs 18 g declared"
    S.apply_override(st, "measurement", "ring-1", "Hallmark checked by appraiser")
    assert S.gate(st, True)["allowed"]
    with pytest.raises(S.WorkflowError, match="does not need an override"):
        S.apply_override(st, "measurement", "ring-1", "accept it again")

    # The pledge is valued on what was measured, not on the CBS declaration.
    items = {i["ornament_id"]: i for i in S.valuation_view(st)["items"]}
    assert items["chain-1"]["weight_g"] == 17.4 and items["chain-1"]["weight_basis"] == "measured"
    assert items["ring-1"]["grade"] == "14K" and items["ring-1"]["rate_per_gram"] == 5400
    assert S.inventory_stats(st)["pledge_is_estimate"] is False


def test_new_reading_replaces_overrides_and_edit_rechecks(st):
    S.record_measurements(st, readings(st, {"chain-1": {"net_weight_g": 17.4}}))
    S.apply_override(st, "measurement", "chain-1", "Accepted for now")
    S.apply_edit(st, "chain-1", {"weight_gm": 17.4}, "CBS weight corrected")
    row = S.find_item(st, "chain-1")
    assert row["measurement_status"] == "match" and row["measurement_overridden"] is False

    S.record_measurements(st, readings(st, {"ring-1": {"net_weight_g": 4.5}}))
    S.apply_override(st, "measurement", "ring-1", "Stone missing, accepted")
    S.record_measurements(st, readings(st, {"ring-1": {"net_weight_g": 4.5}}))
    assert S.find_item(st, "ring-1")["measurement_overridden"] is False  # a re-measure needs a fresh decision


def test_missing_or_garbage_reading_is_flagged(st):
    payload = readings(st)
    payload["measurements"] = [payload["measurements"][0], {"tag": "ring-1", "net_weight_g": "NaN", "fineness_pct": 75}]
    S.record_measurements(st, payload)
    ring = S.find_item(st, "ring-1")
    assert ring["measurement"] is None and ring["measurement_status"] == "missing"
    assert S.inventory_stats(st)["pledge_is_estimate"] is True
    assert any("Gold Ring: no CaratMeter reading" == r["text"] for r in S.review_reasons(st))


def test_scale_reading_is_read_from_the_photo_and_reconciled(st):
    S.record_collateral(st, photo(), collateral_result([], status="fail", scale=99))
    assert st["scale"] is None and S.weight_summary(st)["scale_status"] == "missing"

    S.record_collateral(st, photo(2), collateral_result(["chain-1", "ring-1"], count=2, scale=23.04))
    assert st["scale"]["weight_g"] == 23.04 and st["scale"]["photo_index"] == 1 and st["scale"]["source"] == "photo"
    assert st["collateral"]["images"][1]["scale"] == {"visible": True, "weight_g": 23.04, "text": "23.04 g"}
    ws = S.weight_summary(st)
    assert ws["reference"] == "declared" and ws["scale_status"] == "match" and ws["tolerance_g"] == 0.2

    S.record_measurements(st, readings(st, {"chain-1": {"net_weight_g": 17.0}}))
    ws = S.weight_summary(st)
    assert ws["reference"] == "measured" and ws["measured_g"] == 22.0
    assert ws["scale_status"] == "mismatch" and ws["scale_diff_g"] == 1.04
    assert any("Scale reading 23.04 g differs from the CaratMeter total 22 g by 1.04 g" == r["text"] for r in S.review_reasons(st))


def test_implausible_scale_values_are_ignored(st):
    result = collateral_result(["chain-1"], scale=None)
    result["images"][0].update(scale_reading_visible=True, scale_weight_g=-4, scale_reading_text="-4 g")
    S.record_collateral(st, photo(), result)
    assert st["scale"] is None and st["collateral"]["images"][0]["scale"]["visible"] is False


def test_scale_reading_entry_and_correction_are_audited(st):
    with pytest.raises(S.WorkflowError, match="collateral photo"):
        S.apply_scale_reading(st, 23, "")
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    entry = S.apply_scale_reading(st, "23.01", "")
    assert entry["original"] == "not captured" and entry["justification"].startswith("Entered")
    assert S.is_correction(entry) and st["scale"]["source"] == "assessor"
    with pytest.raises(S.WorkflowError, match="unchanged"):
        S.apply_scale_reading(st, 23.01, "same again")
    with pytest.raises(S.WorkflowError, match="justification"):
        S.apply_scale_reading(st, 23.5, "")
    with pytest.raises(S.WorkflowError, match="between"):
        S.apply_scale_reading(st, -2, "negative reading")
    with pytest.raises(S.WorkflowError, match="number"):
        S.apply_scale_reading(st, "abc", "not a number")

    S.apply_scale_reading(st, 25, "Display re-read")
    assert S.weight_summary(st)["scale_status"] == "mismatch"
    accepted = S.apply_override(st, "scale", "scale", "Scale pan had a cloth on it")
    assert not S.is_correction(accepted)
    assert not any("Scale reading" in r["text"] for r in S.review_reasons(st))
    with pytest.raises(S.WorkflowError, match="does not need an override"):
        S.apply_override(st, "scale", "scale", "Scale pan had a cloth on it")


def test_v2_sessions_skip_the_weight_step(st):
    st["version"] = 2
    S.record_collateral(st, photo(), collateral_result(["chain-1", "ring-1"]))
    assert S.advance(st, False) == "damage"
    assert S.steps_of(st) == ["collateral", "damage", "document", "report"]
    assert S.next_state(st, "damage") == "document"
    texts = " | ".join(r["text"] for r in S.review_reasons(st))
    assert "CaratMeter" not in texts and "scale" not in texts.lower()


def test_edit_purity_is_validated_against_the_items_material():
    st = S.new_state(customer(ornaments=[
        {"id": "anklet-1", "name": "Silver Anklet", "carat": "925", "weight_gm": 64, "quantity": 2, "material": "silver"},
    ]), ai_enabled=True)
    assert S.describe_item(st["inventory"][0]) == "Silver Anklet ×2 · 925 · 64g"
    with pytest.raises(S.WorkflowError, match="999, 925"):
        S.apply_edit(st, "anklet-1", {"carat": "22K"}, "wrong purity")
    S.apply_edit(st, "anklet-1", {"carat": "999"}, "Hallmark says 999")
    assert st["inventory"][0]["carat"] == "999"


def test_valuation_is_captured_when_the_session_starts():
    custom = Settings().valuation_snapshot()
    custom["materials"][0]["ltv_pct"] = 50
    st = S.new_state(customer(), ai_enabled=True, valuation=custom)
    st["session_id"] = "0" * 32
    v = S.view(st, Settings())  # live settings (LTV 75) must not change this session's valuation
    assert {m["key"]: m["ltv_pct"] for m in v["valuation"]["materials"]}["gold"] == 50
    assert v["valuation"]["items"][0]["ltv_pct"] == 50
    assert v["steps"] == ["collateral", "weight", "damage", "valuation", "document", "report"]
    assert v["options"]["grades"]["silver"] == ["999", "925"]
    assert v["caratmeter"]["device_id"] == "CM-FED-MUM-001"


def test_value_item_math_and_damage_modes():
    from app.valuation import grade_for_fineness, material_config, value_inventory, value_item

    val = Settings().valuation_snapshot()
    ring = {"id": "r", "name": "Ring", "material": "gold", "carat": "22", "weight_gm": 5, "damage_percent": 10}
    declared = value_item(ring, val)
    assert (declared["weight_basis"], declared["grade"], declared["gross_value"]) == ("declared", "22K", 42500)
    assert declared["pledge_amount"] == 31556 and declared["damage_deduction"] == 319  # 42500 × 75% × (1 − 1%)

    measured = value_item({**ring, "measurement": {"weight_g": 4.0, "grade": "18K"}}, val)
    assert (measured["weight_basis"], measured["rate_per_gram"], measured["pledge_amount"]) == ("measured", 6900, 20493)

    assert value_item({**ring, "damage_percent": 20}, {**val, "damage_deduction": "percent"})["pledge_amount"] == 25500
    assert value_item(ring, {**val, "damage_deduction": "none"})["pledge_amount"] == 31875

    silver = {"id": "a", "name": "Anklet", "material": "silver", "carat": "925", "weight_gm": 64}
    assert value_item(silver, val)["pledge_amount"] == 4570  # 64 g × ₹102 × 70%

    unknown = value_item({**ring, "carat": "9"}, val)
    assert unknown["unpriced"] and unknown["pledge_amount"] == 0
    assert value_inventory([ring, {**ring, "id": "x", "carat": "9", "name": "Odd"}], val)["totals"]["unpriced"] == ["Odd"]

    gold = material_config(val, "gold")
    assert grade_for_fineness(gold, 91.2, 0.5)["grade"] == "22K"
    assert grade_for_fineness(gold, 91.0, 0.5)["grade"] == "20K"
    assert grade_for_fineness(gold, 50.0, 0.5) is None

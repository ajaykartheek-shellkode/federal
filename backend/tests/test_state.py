"""Unit tests for the pure workflow rules in app.workflow.state.

The journey under test: the collateral photo builds the inventory, the assessor weighs each
ornament and photographs the weighing machine, one CaratMeter request returns every purity,
damage carries a percentage, and the pledge amount follows from all of it.
"""

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
        # CBS ornaments are deliberately ignored: the photo is the only source of inventory.
        "ornaments": [{"id": "cbs-1", "name": "Gold Chain", "carat": "22", "weight_gm": 18}],
    }
    base.update(overrides)
    return base


def collateral_result(labels, status="pass", count=1):
    return {
        "overall_status": status,
        "images": [
            {"index": i, "status": status, "clarity_ok": True, "all_visible": True, "not_cropped": True,
             "no_obstruction": True, "no_foreign_objects": True, "clean_background": True,
             "ornament_count_estimate": len(labels), "foreign_object_percent": 0,
             "issues": [] if status == "pass" else ["Blurry"],
             "items": [{"label": label, "thumb_asset_id": f"t-{n}"} for n, label in enumerate(labels)] if i == 0 else []}
            for i in range(count)
        ],
        "issues": [], "corrective_actions": [],
    }


def photo(n=1):
    return [{"asset_id": f"a{i}", "filename": f"p{i}.jpg"} for i in range(n)]


def scale_result(weight_g=None, status="pass"):
    visible = weight_g is not None
    return {
        "status": status if visible else "fail",
        "reading_visible": visible,
        "weight_g": weight_g,
        "reading_text": f"{weight_g} g" if visible else "",
        "ornaments_on_pan": True,
        "issues": [] if visible else ["Display not readable"],
    }


def readings(st, overrides=None):
    """A CaratMeter payload: gold assays at 22K, silver at 999, each weighing what was entered."""
    measurements = []
    for r in st["inventory"]:
        fineness = 91.7 if r.get("material", "gold") == "gold" else 99.9
        m = {"tag": r["id"], "net_weight_g": r["weight_gm"], "fineness_pct": fineness,
             "sample_id": f"S-{r['id']}", "measured_at": "2026-09-22T10:00:00+05:30", "confidence": 0.99}
        m.update((overrides or {}).get(r["id"], {}))
        measurements.append(m)
    return {"device": {"device_id": "CM-FED-MUM-001", "model": "CaratMeter XRF-900", "mode": "mock"},
            "measurements": measurements}


def weigh_all(st, weights=None):
    for i, row in enumerate(st["inventory"]):
        S.set_item_weight(st, row["id"], (weights or {}).get(row["id"], 10 + i))


@pytest.fixture
def st():
    return S.new_state(customer(), ai_enabled=True)


@pytest.fixture
def listed(st):
    """A session whose collateral photo produced three ornaments."""
    S.record_collateral(st, photo(), collateral_result(["Gold Chain", "Gold Bangle", "Silver Anklet"]))
    return st


# --------------------------------------------------------------------------- creation & collateral
def test_new_state_holds_no_cbs_inventory(st):
    assert st["workflow_state"] == "collateral"
    assert st["inventory"] == [] and st["next_ref"] == 1
    assert st["loan"]["customer_name"] == "Rajesh Kumar"  # customer & KYC still come from CBS
    assert S.allowed_actions(st) == ("collateral", "continue")
    assert S.steps_of(st) == ["collateral", "weight", "damage", "valuation", "document", "report"]


def test_collateral_photo_builds_the_inventory(st):
    added = S.record_collateral(st, photo(), collateral_result(["Gold Chain", "gold bangle", "Silver Anklet"]))
    assert added == 3
    ids = [r["id"] for r in st["inventory"]]
    assert ids == ["item-1", "item-2", "item-3"]
    assert [r["name"] for r in st["inventory"]] == ["Gold Chain", "Gold Bangle", "Silver Anklet"]
    assert [r["material"] for r in st["inventory"]] == ["gold", "gold", "silver"]
    assert [r["carat"] for r in st["inventory"]] == ["", "", ""]  # purity is unknown until the CaratMeter
    assert [r["weight_gm"] for r in st["inventory"]] == [0, 0, 0]
    assert st["inventory"][0]["thumb_asset_id"] == "t-0" and st["inventory"][0]["origin"] == "detected"
    assert st["collateral"]["images"][0]["matched"] == ids
    assert S.collateral_complete(st)


def test_collateral_gate_needs_a_photo_then_items(st):
    g = S.gate(st, blocker_mode=False)
    assert not g["allowed"] and "collateral photo" in g["reasons"][0]
    S.record_collateral(st, photo(), collateral_result([]))
    g = S.gate(st, blocker_mode=False)
    assert not g["allowed"] and "No ornaments are listed" in g["reasons"][0]
    S.add_item(st, "Gold Ring")
    assert S.gate(st, blocker_mode=False)["allowed"]


def test_unusable_photo_lists_nothing(st):
    S.record_collateral(st, photo(), collateral_result(["Gold Chain"], status="fail"))
    assert st["inventory"] == [] and not S.collateral_complete(st)


def test_recapture_replaces_until_weighing_starts(listed):
    S.record_collateral(listed, photo(), collateral_result(["Gold Chain", "Gold Ring"]))
    assert [r["name"] for r in listed["inventory"]] == ["Gold Chain", "Gold Ring"]
    assert [r["id"] for r in listed["inventory"]] == ["item-4", "item-5"]  # ids are never reused

    S.set_item_weight(listed, "item-4", 12)
    S.record_collateral(listed, photo(), collateral_result(["Gold Coin"]))
    assert [r["name"] for r in listed["inventory"]] == ["Gold Chain", "Gold Ring", "Gold Coin"]


def test_ai_off_records_the_photo_without_listing_items(st):
    off = S.new_state(customer(), ai_enabled=False)
    S.record_collateral(off, photo(2), None)
    assert off["inventory"] == []
    assert [im["status"] for im in off["collateral"]["images"]] == ["not_checked", "not_checked"]
    row = S.add_item(off, "Gold Anklet", quantity=2, weight_gm=28)
    assert (row["origin"], row["quantity"], row["weight_gm"]) == ("manual", 2, 28.0)
    assert S.collateral_complete(off)


# --------------------------------------------------------------------------- inventory edits
def test_add_remove_and_weigh_items(listed):
    row = S.add_item(listed, "Gold Coin", material="gold", quantity=4, weight_gm=8)
    assert row["id"] == "item-4" and row["status"] == "manual"
    assert listed["audit"] == []  # adding a row and weighing it are data entry, not corrections

    assert S.set_item_weight(listed, "item-1", "18.25") is None
    assert S.find_item(listed, "item-1")["weight_gm"] == 18.25
    assert listed["audit"] == []

    with pytest.raises(S.WorkflowError, match="unchanged"):
        S.set_item_weight(listed, "item-1", 18.25)
    with pytest.raises(S.WorkflowError, match="justification"):
        S.set_item_weight(listed, "item-1", 19)
    entry = S.set_item_weight(listed, "item-1", 19, "Re-weighed on the calibrated machine")
    assert S.find_item(listed, "item-1")["weight_gm"] == 19
    assert (entry["original"], entry["new_value"]) == ("18.25 g", "19 g") and S.is_correction(entry)

    with pytest.raises(S.WorkflowError, match="number"):
        S.set_item_weight(listed, "item-2", "heavy")
    with pytest.raises(S.WorkflowError, match="between"):
        S.set_item_weight(listed, "item-2", 9000)

    removed = S.remove_item(listed, "item-4", "Not being pledged")
    assert [r["id"] for r in listed["inventory"]] == ["item-1", "item-2", "item-3"]
    assert removed["new_value"] == "removed by assessor"


def test_item_added_by_hand_is_validated(listed):
    with pytest.raises(S.WorkflowError, match="2–120"):
        S.add_item(listed, "x")
    with pytest.raises(S.WorkflowError, match="material"):
        S.add_item(listed, "Platinum Ring", material="platinum")
    with pytest.raises(S.WorkflowError, match="Quantity"):
        S.add_item(listed, "Gold Ring", quantity=0)


def test_damage_record_must_be_cleared_before_removing_an_item(listed):
    S.record_damage(listed, {"ornament_id": "item-2", "item": "Gold Bangle", "status": "pass", "damage_percent": 8})
    with pytest.raises(S.WorkflowError, match="damage record"):
        S.remove_item(listed, "item-2")
    assert S.find_item(listed, "item-2")["damage_percent"] == 8


# --------------------------------------------------------------------------- weight & purity
def test_weight_gate_wants_every_weight_then_the_readings(listed):
    S.advance(listed, False)
    assert listed["workflow_state"] == "weight"
    assert S.allowed_actions(listed) == ("scale_photo", "measure", "continue")
    g = S.gate(listed, False)
    assert not g["allowed"] and "Enter the weight of 3 item(s)" in g["reasons"][0]

    weigh_all(listed)
    g = S.gate(listed, False)
    assert not g["allowed"] and "CaratMeter" in g["reasons"][0]
    S.record_measurements(listed, readings(listed))
    assert S.gate(listed, False)["allowed"]  # alert mode: the machine photo is advisory
    g = S.gate(listed, True)
    assert not g["allowed"] and "weighing-machine photo" in g["reasons"][0]


def test_readings_set_the_purity_and_flag_disagreements(listed):
    S.advance(listed, False)  # the gates below are the weight step's
    weigh_all(listed)  # 10, 11, 12 g
    S.record_measurements(listed, readings(listed, {
        "item-2": {"net_weight_g": 10.2},   # 0.8 g lighter than entered
        "item-3": {"fineness_pct": 41.8},   # below every configured silver grade
    }))
    chain, bangle, anklet = listed["inventory"]
    assert chain["measurement_status"] == "match" and chain["measurement"]["grade"] == "22K"
    assert chain["carat"] == "22"  # the assessed grade becomes the item's purity
    assert bangle["measurement_status"] == "weight_mismatch"
    assert anklet["measurement_status"] == "ungraded" and anklet["measurement"]["grade"] is None
    assert listed["measurements"]["count"] == 3

    texts = " | ".join(r["text"] for r in S.review_reasons(listed))
    assert "CaratMeter weighed 10.2 g against 11 g entered" in texts
    assert "below every configured silver grade" in texts

    assert S.gate(listed, False)["allowed"] is True
    g = S.gate(listed, True)
    assert not g["allowed"] and "2 CaratMeter reading(s) need review" in g["reasons"][0]
    S.apply_override(listed, "measurement", "item-2", "Re-weighed, clasp was removed")
    S.apply_override(listed, "measurement", "item-3", "Assayed again by the appraiser")
    assert S.weight_complete(listed)
    with pytest.raises(S.WorkflowError, match="does not need an override"):
        S.apply_override(listed, "measurement", "item-3", "accept it twice")


def test_missing_reading_and_reweighing_clear_acceptances(listed):
    weigh_all(listed)
    payload = readings(listed)
    payload["measurements"] = [m for m in payload["measurements"] if m["tag"] != "item-3"]
    S.record_measurements(listed, payload)
    assert S.find_item(listed, "item-3")["measurement_status"] == "missing"
    assert S.inventory_stats(listed)["pledge_is_estimate"] is True

    S.apply_override(listed, "measurement", "item-3", "Assayed separately at the counter")
    S.record_measurements(listed, readings(listed))  # a fresh run needs fresh decisions
    assert S.find_item(listed, "item-3")["measurement_overridden"] is False
    assert S.find_item(listed, "item-3")["measurement_status"] == "match"

    S.set_item_weight(listed, "item-1", 15, "Corrected after re-weighing")
    assert S.find_item(listed, "item-1")["measurement_status"] == "weight_mismatch"


# --------------------------------------------------------------------------- weighing machine
def test_machine_photo_reconciles_with_the_entered_weights(listed):
    weigh_all(listed)  # 10 + 11 + 12 = 33 g
    assert S.weight_summary(listed)["scale_status"] == "pending"

    S.record_scale_photo(listed, {"asset_id": "s1", "filename": "scale.jpg"}, scale_result(33.05))
    w = S.weight_summary(listed)
    assert (w["scale_g"], w["entered_g"], w["scale_source"]) == (33.05, 33.0, "photo")
    assert w["scale_status"] == "match" and w["tolerance_g"] == 0.3

    S.record_scale_photo(listed, {"asset_id": "s2", "filename": "scale2.jpg"}, scale_result(35.0))
    w = S.weight_summary(listed)
    assert w["scale_status"] == "mismatch" and w["scale_diff_g"] == 2.0
    assert any("Weighing machine reads 35 g against 33 g entered" in r["text"] for r in S.review_reasons(listed))

    entry = S.apply_override(listed, "scale", "scale", "Tray left on the pan, re-checked by hand")
    assert not S.is_correction(entry)
    assert not any("Weighing machine" in r["text"] for r in S.review_reasons(listed))


def test_unreadable_machine_photo_can_be_typed_in(listed):
    weigh_all(listed)
    S.record_scale_photo(listed, {"asset_id": "s1", "filename": "scale.jpg"}, scale_result(None))
    w = S.weight_summary(listed)
    assert w["scale_g"] is None and w["scale_status"] == "missing" and w["scale_photo_status"] == "fail"

    entry = S.apply_scale_reading(listed, "33.02", "")
    assert entry["original"] == "not captured" and S.is_correction(entry)
    assert S.weight_summary(listed)["scale_status"] == "match"
    assert S.find_item(listed, "item-1") is not None  # weights untouched

    with pytest.raises(S.WorkflowError, match="unchanged"):
        S.apply_scale_reading(listed, 33.02, "same again")
    with pytest.raises(S.WorkflowError, match="justification"):
        S.apply_scale_reading(listed, 40, "")
    with pytest.raises(S.WorkflowError, match="between"):
        S.apply_scale_reading(listed, -2, "negative")


# --------------------------------------------------------------------------- valuation & report
def ready(st, scale_g=33.05):
    """Photo → weights → machine photo → readings, i.e. everything before damage."""
    weigh_all(st)
    S.record_scale_photo(st, {"asset_id": "s1", "filename": "scale.jpg"}, scale_result(scale_g))
    S.record_measurements(st, readings(st))
    return st


def test_pledge_uses_the_entered_weight_and_assessed_purity(listed):
    ready(listed)
    items = {i["ornament_id"]: i for i in S.valuation_view(listed)["items"]}
    chain = items["item-1"]
    assert (chain["weight_g"], chain["weight_basis"], chain["grade"]) == (10.0, "entered", "22K")
    assert chain["rate_per_gram"] == 8500 and chain["pledge_amount"] == round(10 * 8500 * 0.75)
    assert items["item-3"]["material"] == "Silver" and items["item-3"]["grade"] == "999"
    stats = S.inventory_stats(listed)
    assert stats["pledge_is_estimate"] is False and stats["weighed"] == 3
    assert stats["total_weight"] == 33.0 and stats["measured_weight"] == 33.0


def test_damage_percent_reduces_the_pledge(listed):
    ready(listed)
    before = S.inventory_stats(listed)["pledge_amount"]
    S.record_damage(listed, {"ornament_id": "item-1", "item": "Gold Chain", "status": "pass", "damage_percent": 10})
    after = S.valuation_view(listed)
    chain = next(i for i in after["items"] if i["ornament_id"] == "item-1")
    # Default rule: the damage value is tenths of a percent, so 10 → 1 % off this item.
    assert chain["damage_percent"] == 10 and chain["damage_deduction"] == round(10 * 8500 * 0.75 * 0.01)
    assert after["totals"]["pledge_amount"] < before


def test_weight_corrections_are_the_only_weight_entries_in_the_audit(listed):
    weigh_all(listed)
    assert listed["audit"] == []
    S.set_item_weight(listed, "item-2", 12, "Re-weighed after the clasp was removed")
    targets = [a["target"] for a in listed["audit"]]
    assert targets == ["weight"]


def test_full_journey_report(listed):
    assert S.advance(listed, False) == "weight"
    ready(listed)
    assert S.advance(listed, False) == "damage"
    S.record_damage(listed, {"ornament_id": "item-2", "item": "Gold Bangle", "status": "pass", "damage_percent": 4})
    assert S.advance(listed, False) == "valuation"
    assert S.advance(listed, False) == "document"
    assert not S.gate(listed, False)["allowed"]  # documents are always required
    S.record_documents(listed, [{"doc_no": 1, "declared_type": "Aadhaar Card", "asset_id": "d1", "filename": "a.jpg", "content_type": "image/jpeg"}],
                       {"overall_status": "pass", "documents": [{"doc_no": 1, "status": "pass", "legible": True, "complete": True,
                        "type_matches_declared": True, "doc_type_detected": "Aadhaar Card", "extracted": {"name": "R", "id_number": "1", "address": "x"},
                        "matches": {"name": True, "id": True, "address_pct": 90}, "issues": []}], "issues": [], "corrective_actions": []})
    assert S.advance(listed, False) == "report"

    report = S.build_report(listed)
    assert report["recommendation"] == "PROCEED", report["reasons"]
    assert report["overall_status"] == "pass"
    assert report["stats"]["pledge_amount"] > 0 and report["stats"]["pledge_is_estimate"] is False
    assert report["weight"]["scale_status"] == "match"
    listed["report"] = report
    record = S.run_record(listed)
    assert record["counts"]["collateral"] == {"pass": 1, "alert": 0, "fail": 0}
    assert record["summary"]["pledge_amount"] == report["stats"]["pledge_amount"]


def test_report_review_reasons(listed):
    S.set_item_weight(listed, "item-1", 12)
    report = S.build_report(listed)
    texts = " | ".join(r["text"] for r in report["reasons"])
    assert report["recommendation"] == "REVIEW"
    assert "2 item(s) have no weight" in texts
    assert "Purity was not measured on the CaratMeter" in texts
    assert "No weighing-machine total captured" in texts
    assert "No documentary proof uploaded" in texts


def test_manual_items_are_reported_as_a_note(listed):
    ready(listed)
    S.add_item(listed, "Gold Coin", weight_gm=5)
    notes = [r["text"] for r in S.review_reasons(listed) if r["level"] == "info"]
    assert any("1 item(s) added by the assessor: Gold Coin" in n for n in notes)
    assert listed["audit"] == []  # nothing here needed a justification


def test_locked_after_done(listed):
    listed["workflow_state"] = "done"
    assert S.allowed_actions(listed) == ()
    for call in (
        lambda: S.apply_override(listed, "measurement", "item-1", "valid reason"),
        lambda: S.apply_edit(listed, "item-1", {"name": "X Ring"}, "valid reason"),
        lambda: S.set_item_weight(listed, "item-1", 5),
        lambda: S.add_item(listed, "Gold Ring"),
        lambda: S.remove_item(listed, "item-1"),
        lambda: S.apply_scale_reading(listed, 10, "valid reason"),
    ):
        with pytest.raises(S.WorkflowError, match="locked"):
            call()


# --------------------------------------------------------------------------- edits, view, misc
def test_edit_validates_purity_against_the_material(listed):
    assert S.describe_item(listed["inventory"][2]) == "Silver Anklet · — · no weight"
    with pytest.raises(S.WorkflowError, match="999, 925"):
        S.apply_edit(listed, "item-3", {"carat": "22K"}, "wrong purity")
    S.apply_edit(listed, "item-3", {"carat": "925", "weight_gm": 64, "quantity": 2}, "Hallmark reads 925")
    row = S.find_item(listed, "item-3")
    assert (row["carat"], row["weight_gm"], row["quantity"]) == ("925", 64.0, 2)
    assert S.describe_item(row) == "Silver Anklet ×2 · 925 · 64g"
    S.apply_edit(listed, "item-1", {"material": "silver"}, "It is a silver chain")
    assert S.find_item(listed, "item-1")["material"] == "silver"


def test_view_masks_kyc_and_carries_the_journey(listed):
    listed["session_id"] = "0" * 32
    v = S.view(listed, Settings())
    assert "id_number" not in v["loan"] and "address" not in v["loan"]
    assert v["loan"]["id_number_masked"].endswith("1234") and v["loan"]["id_number_masked"].startswith("•")
    assert v["steps"] == ["collateral", "weight", "damage", "valuation", "document", "report"]
    assert v["gate"]["allowed"] is True  # three ornaments are listed
    assert [i["key"] for i in v["options"]["materials"]] == ["gold", "silver"]
    assert v["options"]["grades"]["gold"][0] == "24K"
    assert v["caratmeter"]["device_id"] == "CM-FED-MUM-001"
    assert v["weight"]["entered_g"] == 0 and v["weight"]["unweighed"] == ["Gold Chain", "Gold Bangle", "Silver Anklet"]


def test_valuation_is_captured_when_the_session_starts():
    custom = Settings().valuation_snapshot()
    custom["materials"][0]["ltv_pct"] = 50
    st = S.new_state(customer(), ai_enabled=True, valuation=custom)
    st["session_id"] = "0" * 32
    S.record_collateral(st, photo(), collateral_result(["Gold Chain"]))
    S.set_item_weight(st, "item-1", 10)
    S.record_measurements(st, readings(st))
    v = S.view(st, Settings())  # live settings (LTV 75) must not change this session
    assert v["valuation"]["items"][0]["ltv_pct"] == 50
    assert v["valuation"]["totals"]["pledge_amount"] == round(10 * 8500 * 0.5)


def test_value_item_math_and_damage_modes():
    from app.valuation import grade_for_fineness, material_config, value_inventory, value_item

    val = Settings().valuation_snapshot()
    ring = {"id": "item-1", "name": "Ring", "material": "gold", "carat": "", "weight_gm": 5, "damage_percent": 10,
            "measurement": {"weight_g": 5.0, "grade": "22K", "fineness_pct": 91.7}}
    valued = value_item(ring, val)
    assert (valued["weight_basis"], valued["grade"], valued["gross_value"]) == ("entered", "22K", 42500)
    assert valued["pledge_amount"] == 31556 and valued["damage_deduction"] == 319  # 42500 × 75% × (1 − 1%)

    assert value_item({**ring, "damage_percent": 20}, {**val, "damage_deduction": "percent"})["pledge_amount"] == 25500
    assert value_item(ring, {**val, "damage_deduction": "none"})["pledge_amount"] == 31875

    unmeasured = value_item({**ring, "measurement": None}, val)
    assert unmeasured["unpriced"] and unmeasured["pledge_amount"] == 0
    assert value_inventory([ring, {**ring, "id": "item-2", "measurement": None, "name": "Odd"}], val)["totals"]["unpriced"] == ["Odd"]

    gold = material_config(val, "gold")
    assert grade_for_fineness(gold, 91.2, 0.5)["grade"] == "22K"
    assert grade_for_fineness(gold, 91.0, 0.5)["grade"] == "20K"
    assert grade_for_fineness(gold, 50.0, 0.5) is None


def test_worst():
    assert S.worst([]) is None
    assert S.worst(["not_checked"]) is None
    assert S.worst(["pass", "alert"]) == "alert"
    assert S.worst(["alert", "fail", "pass"]) == "fail"


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


def test_older_sessions_keep_the_steps_they_started_with(listed):
    listed["version"] = 4
    assert S.steps_of(listed) == ["collateral", "weight", "damage", "valuation", "document", "report"]
    listed["version"] = 3
    assert S.steps_of(listed) == ["collateral", "weight", "damage", "document", "report"]
    assert S.next_state(listed, "damage") == "document"
    listed["version"] = 2
    assert S.steps_of(listed) == ["collateral", "damage", "document", "report"]
    assert S.next_state(listed, "collateral") == "damage"

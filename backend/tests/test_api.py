"""End-to-end API tests against the test database with Bedrock faked.

The journey: collateral photo → inventory, weights typed per item, weighing-machine photo,
one CaratMeter request per application, damage with a percentage, pledge valuation, documents,
report.
"""

from __future__ import annotations

import json

from tests.conftest import png_bytes

RAJESH = "GL2024001234"  # Fresh Loan (AI on)
PRIYA = "GL2024001189"   # Renewal (AI off by default)
SURESH = "GL2024001098"  # Fresh Loan; the mock CaratMeter reads item-2 lighter than entered


def parse_sse(text: str):
    events = []
    for frame in text.split("\n\n"):
        name, data = None, []
        for line in frame.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if name:
            events.append((name, json.loads("\n".join(data)) if data else {}))
    return events


def start(client, account=RAJESH):
    res = client.post("/api/chat/start", json={"account": account})
    assert res.status_code == 200, res.text
    return res.json()["session"]


def step(client, sid, action, files=None, **form):
    data = {"session_id": sid, "action": action, **form}
    res = client.post("/api/chat/step", data=data, files=files or [])
    if res.headers.get("content-type", "").startswith("text/event-stream"):
        events = parse_sse(res.text)
        session = next((d["session"] for e, d in reversed(events) if e == "state"), None)
        return res, events, session
    return res, [], None


def photo(name="set.png", size=(320, 240)):
    return (name, png_bytes(size), "image/png")


def weigh(client, sid, weights):
    """Enter the weight of each ornament, as the assessor does at the counter."""
    session = None
    for ref, grams in weights.items():
        res = client.post("/api/chat/weight", json={"session_id": sid, "ref": ref, "weight_gm": grams})
        assert res.status_code == 200, res.text
        session = res.json()["session"]
    return session


def test_start_opens_an_application_for_a_fresh_loan(client):
    assert client.post("/api/chat/start", json={"account": "  "}).status_code == 400
    res = client.post("/api/chat/start", json={"account": "NOPE123"})
    assert res.status_code == 404 and res.json()["samples"][0]["customer_id"]

    session = start(client, " gl2024001234 ")
    assert session["ai_enabled"] is True
    assert session["inventory"] == []  # CBS supplies the customer, never the ornaments
    assert session["steps"] == ["collateral", "weight", "damage", "valuation", "document", "report"]
    assert "id_number" not in session["loan"]
    # A fresh loan has no account yet: it runs under an application reference.
    assert session["application"]["kind"] == "fresh"
    assert session["application"]["reference"].startswith("APP-") and session["loan"]["account_number"] == ""
    assert session["loan"]["application_no"] == session["application"]["reference"]

    # The same customer can be found by CIF, mobile or ID proof — no loan account needed.
    for query in ("CBS100234", "98200 41234", "2337 4600 1234"):
        found = start(client, query)
        assert found["loan"]["customer_name"] == "Rajesh Kumar"
        assert found["application"]["reference"] != session["application"]["reference"]  # a new application each time


def test_application_can_be_opened_for_a_new_customer(client, fake_bedrock):
    """A walk-in who is not in CBS yet: the branch onboards them and the application opens."""
    new_customer = {"name": "Anita Menon", "mobile": "90000 12345", "id_number": "4411 9087 2213",
                    "address": "9 Residency Road, Bengaluru", "branch": "FED-BLR-011"}
    res = client.post("/api/chat/application", json=new_customer)
    assert res.status_code == 200, res.text
    s = res.json()["session"]
    assert s["loan"]["customer_name"] == "Anita Menon" and s["loan"]["customer_id"].startswith("CBS")
    assert s["application"]["kind"] == "fresh" and s["loan"]["account_number"] == ""
    assert s["loan"]["id_number_masked"].endswith("2213")

    # They are now findable like any other customer, and cannot be onboarded twice.
    found = start(client, "90000 12345")
    assert found["loan"]["customer_name"] == "Anita Menon"
    assert client.post("/api/chat/application", json=new_customer).status_code == 409

    for bad in ({**new_customer, "name": "A"}, {**new_customer, "mobile": "123"},
                {**new_customer, "id_number": "x"}, {**new_customer, "branch": ""}):
        assert client.post("/api/chat/application", json=bad).status_code == 400


def test_new_customer_gets_the_account_they_are_sanctioned(client, fake_bedrock):
    fake_bedrock.scale_weight_g = 33.0
    res = client.post("/api/chat/application", json={
        "name": "Ravi Menon", "mobile": "90000 54321", "id_number": "5511 2233 4455",
        "address": "4 MG Road, Bengaluru", "branch": "FED-BLR-011",
    })
    sid = res.json()["session"]["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    step(client, sid, "scale_photo", files=[("scale_image", photo("scale.png"))])
    step(client, sid, "measure")
    step(client, sid, "continue")  # damage -> valuation
    step(client, sid, "continue")  # valuation -> document
    step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Aadhaar Card"]))
    _, _, s = step(client, sid, "report")

    account = s["loan"]["account_number"]
    assert s["report"]["recommendation"] == "PROCEED" and account.startswith("GLBLR")
    # CBS now holds the loan account against that customer, so a renewal finds them by it.
    assert start(client, account)["loan"]["customer_name"] == "Ravi Menon"


def test_existing_loan_keeps_its_account(client):
    session = start(client, PRIYA)  # Renewal
    assert session["application"]["kind"] == "existing"
    assert session["loan"]["account_number"] == PRIYA and session["loan"]["application_no"] == ""


def test_full_happy_path_with_reports(client, fake_bedrock):
    fake_bedrock.scale_weight_g = 33.02
    s = start(client)
    sid = s["session_id"]

    # Actions out of order are refused with the current view.
    res, _, _ = step(client, sid, "report")
    assert res.status_code == 409 and res.json()["session"]["workflow_state"] == "collateral"

    res, events, s = step(client, sid, "collateral", files=[("collateral_images", photo())])
    names = [e for e, _ in events]
    assert names[0] == "exec-step" and "exec-done" in names and names[-1] == "done"
    steps_done = [d for e, d in events if e == "exec-step" and d["status"] == "done"]
    assert len(steps_done) == 10 and all("elapsed_ms" in d for d in steps_done)
    assert [r["id"] for r in s["inventory"]] == ["item-1", "item-2", "item-3"]
    assert [r["name"] for r in s["inventory"]] == ["Gold Chain", "Gold Bangle", "Gold Ring"]
    assert all(r["thumb_asset_id"] and r["weight_gm"] == 0 and r["carat"] == "" for r in s["inventory"])
    assert s["workflow_state"] == "weight"

    thumb = s["inventory"][0]["thumb_asset_id"]
    asset = client.get(f"/api/assets/{thumb}")
    assert asset.status_code == 200 and asset.headers["content-type"] == "image/png"

    # The CaratMeter is only asked once every ornament has a weight.
    res, _, _ = step(client, sid, "measure")
    assert res.status_code == 200
    _, events, s = step(client, sid, "measure")
    assert any(e == "notice" and "Enter the weight" in d["text"] for e, d in events)

    s = weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    assert s["weight"]["entered_g"] == 33 and s["weight"]["unweighed"] == []
    assert s["stats"]["weighed"] == 3

    _, events, s = step(client, sid, "scale_photo", files=[("scale_image", photo("scale.png"))])
    assert [d["key"] for e, d in events if e == "exec-step" and d["status"] == "done"] == [
        "receive", "read", "reconcile", "result",
    ]
    assert s["scale"]["weight_g"] == 33.02 and s["weight"]["scale_status"] == "match"

    _, events, s = step(client, sid, "measure")
    run = [d["key"] for e, d in events if e == "exec-step" and d["status"] == "done"]
    assert run == ["connect", "request", "grade", "crosscheck", "valuation", "result"]
    assert all(r["measurement"] and r["carat"] for r in s["inventory"])
    assert s["measurements"]["device"]["device_id"] == "CM-FED-MUM-001"
    assert s["workflow_state"] == "damage"
    assert s["stats"]["pledge_is_estimate"] is False and s["stats"]["pledge_amount"] > 0

    hints = [{"ornament_id": "item-2", "type": "Dent", "severity": "moderate", "damage_percent": 8, "details": "Dent on rim"}]
    _, _, s = step(client, sid, "damage", files=[("damage_images", photo("d1.png"))], damage_hints=json.dumps(hints))
    assert len(s["damages"]) == 1 and s["damages"][0]["damage_percent"] == 8
    assert next(r for r in s["inventory"] if r["id"] == "item-2")["damage_percent"] == 8

    _, events, s = step(client, sid, "continue")
    assert s["workflow_state"] == "valuation" and s["valuation"]["totals"]["pledge_amount"] > 0
    assert any(e == "agent-msg" for e, _ in events)

    _, _, s = step(client, sid, "continue")
    assert s["workflow_state"] == "document"

    _, _, s = step(client, sid, "document", files=[("documents", photo("aadhaar.png"))],
                   document_types=json.dumps(["Aadhaar Card"]))
    assert s["workflow_state"] == "report"
    assert s["documents"]["items"][0]["status"] == "pass"

    _, events, s = step(client, sid, "report")
    assert s["workflow_state"] == "done"
    assert s["report"]["recommendation"] == "PROCEED", s["report"]["reasons"]
    assert s["report"]["report_id"].startswith("GLV-")
    # Sanctioned: the gold loan account is opened for this application.
    account = s["loan"]["account_number"]
    assert account.startswith("GLMUM") and len(account) == 11 and s["loan"]["account_issued_at"]
    assert s["loan"]["application_no"].startswith("APP-")  # the application it was opened under

    restored = client.get(f"/api/chat/session/{sid}").json()["session"]
    assert restored["report"]["report_id"] == s["report"]["report_id"]

    report = client.get("/api/reports/account", params={"account": account}).json()
    runs = [r for r in report["runs"] if r["session_id"] == sid]
    assert len(runs) == 1 and runs[0]["summary"]["recommendation"] == "PROCEED"
    assert runs[0]["summary"]["pledge_amount"] == s["stats"]["pledge_amount"]

    res = client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 11})
    assert res.status_code == 409 and "locked" in res.json()["error"]


def test_inventory_can_be_curated(client, fake_bedrock):
    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])

    res = client.post("/api/chat/item", json={"session_id": sid, "name": "Gold Coin", "quantity": 4, "weight_gm": 8})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["item"]["id"] == "item-4" and body["item"]["origin"] == "manual"
    assert body["session"]["audit"] == []
    assert [r["id"] for r in body["session"]["inventory"]] == ["item-1", "item-2", "item-3", "item-4"]

    res = client.post("/api/chat/item/remove", json={"session_id": sid, "ref": "item-3", "justification": "Customer kept it"})
    assert res.status_code == 200
    assert [r["id"] for r in res.json()["session"]["inventory"]] == ["item-1", "item-2", "item-4"]

    assert client.post("/api/chat/item", json={"session_id": sid, "name": "x"}).status_code == 409
    assert client.post("/api/chat/item/remove", json={"session_id": sid, "ref": "nope"}).status_code == 409
    res = client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 0})
    assert res.status_code == 409 and "between" in res.json()["error"]

    # A correction to a recorded weight needs a justification; the first entry does not, and only
    # the correction reaches the audit trail.
    res = client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 18})
    assert res.status_code == 200
    assert [a["target"] for a in res.json()["session"]["audit"]] == ["item"]  # only the removal so far
    res = client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 19})
    assert res.status_code == 409 and "justification" in res.json()["error"]
    res = client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 19, "justification": "Re-weighed at the counter"})
    assert res.status_code == 200
    audit = res.json()["session"]["audit"]
    assert [a["target"] for a in audit] == ["item", "weight"] and audit[-1]["new_value"] == "19 g"


def test_caratmeter_findings_hold_the_weight_step(client, fake_bedrock):
    client.put("/api/settings", json={"blocker_mode": True})
    fake_bedrock.scale_weight_g = 33.0
    sid = start(client, SURESH)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    step(client, sid, "scale_photo", files=[("scale_image", photo("scale.png"))])

    _, events, s = step(client, sid, "measure")
    flagged = [r for r in s["inventory"] if r["measurement_status"] != "match"]
    assert [r["id"] for r in flagged] == ["item-2"]  # scripted: the device weighs it 0.62 g lighter
    assert s["workflow_state"] == "weight" and s["weight"]["flagged"] == 1
    assert next(d for e, d in events if e == "exec-done")["status"] == "alert"

    _, events, s = step(client, sid, "continue")
    assert any(e == "notice" and "need review" in d["text"] for e, d in events)
    res = client.post("/api/chat/override", json={"session_id": sid, "target": "measurement", "ref": "item-2",
                                                  "justification": "Re-assayed by the branch appraiser"})
    assert res.status_code == 200, res.text
    _, _, s = step(client, sid, "continue")
    assert s["workflow_state"] == "damage"


def test_caratmeter_failure_is_reported_and_retryable(client, fake_bedrock, monkeypatch):
    from app.integrations import caratmeter

    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})

    async def offline(*_args, **_kwargs):
        raise caratmeter.CaratMeterError("The CaratMeter didn't respond. Check the device connection and try again.")

    monkeypatch.setattr(caratmeter, "measure", offline)
    _, events, s = step(client, sid, "measure")
    assert any(e == "notice" and d["level"] == "error" and "didn't respond" in d["text"] for e, d in events)
    assert s["workflow_state"] == "weight" and s["measurements"] is None
    monkeypatch.undo()
    _, _, s = step(client, sid, "measure")
    assert s["workflow_state"] == "damage"


def test_unreadable_machine_photo_falls_back_to_typing(client, fake_bedrock):
    fake_bedrock.scale_weight_g = None  # display not legible
    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})

    _, events, s = step(client, sid, "scale_photo", files=[("scale_image", photo("scale.png"))])
    assert s["scale"]["weight_g"] is None and s["weight"]["scale_status"] == "missing"
    assert next(d for e, d in events if e == "exec-done")["status"] == "fail"

    res = client.post("/api/chat/scale", json={"session_id": sid, "weight_g": 33.04})
    assert res.status_code == 200, res.text
    s = res.json()["session"]
    assert s["weight"]["scale_status"] == "match" and s["scale"]["source"] == "assessor"
    assert s["audit"][-1]["target"] == "scale"


def test_upload_validation(client, fake_bedrock):
    sid = start(client)["session_id"]
    res, _, _ = step(client, sid, "collateral")
    assert res.status_code == 400
    res, _, _ = step(client, sid, "collateral", files=[("collateral_images", ("x.png", b"not an image", "image/png"))])
    assert res.status_code == 400 and "could not be read" in res.json()["error"]
    res, _, _ = step(client, sid, "collateral", files=[("collateral_images", photo(f"{i}.png")) for i in range(4)])
    assert res.status_code == 400
    res, _, _ = step(client, "f" * 32, "collateral", files=[("collateral_images", photo())])
    assert res.status_code == 404
    res, _, _ = step(client, sid, "teleport")
    assert res.status_code == 400

    step(client, sid, "collateral", files=[("collateral_images", photo())])
    res, _, _ = step(client, sid, "scale_photo")
    assert res.status_code == 400 and "weighing machine" in res.json()["error"]
    res, _, _ = step(client, sid, "scale_photo", files=[("scale_image", photo()), ("scale_image", photo("b.png"))])
    assert res.status_code == 400
    res, _, _ = step(client, sid, "measure", files=[("collateral_images", photo())])
    assert res.status_code == 400 and "does not accept file uploads" in res.json()["error"]


def test_damage_and_document_validation(client, fake_bedrock):
    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints="[]")
    assert res.status_code == 409  # weights and purity come first

    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    step(client, sid, "measure")
    bad = [{"ornament_id": "not-mine", "type": "Dent", "severity": "minor", "details": ""}]
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints=json.dumps(bad))
    assert res.status_code == 400
    over = [{"ornament_id": "item-1", "type": "Dent", "severity": "minor", "damage_percent": 140, "details": ""}]
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints=json.dumps(over))
    assert res.status_code == 400 and "between 0 and 100" in res.json()["error"]
    other = [{"ornament_id": "item-1", "type": "Other", "severity": "minor", "details": ""}]
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints=json.dumps(other))
    assert res.status_code == 400 and "Describe" in res.json()["error"]

    step(client, sid, "continue")  # damage -> valuation
    step(client, sid, "continue")  # valuation -> document
    res, _, _ = step(client, sid, "document", files=[("documents", ("a.pdf", b"hello", "application/pdf"))],
                     document_types=json.dumps(["Aadhaar Card"]))
    assert res.status_code == 400 and "not a valid PDF" in res.json()["error"]
    res, _, _ = step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Library card"]))
    assert res.status_code == 400


def test_document_mismatch_becomes_alert_and_can_be_overridden(client, fake_bedrock):
    from app.schemas import DocumentMatches

    fake_bedrock.document_matches = DocumentMatches(name=True, id=False, address_pct=40)
    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    step(client, sid, "measure")
    step(client, sid, "continue")  # damage -> valuation
    step(client, sid, "continue")  # valuation -> document
    _, _, s = step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Aadhaar Card"]))
    doc = s["documents"]["items"][0]
    assert doc["status"] == "alert"
    assert "ID number does not match CBS record" in doc["issues"]
    assert any("Address match 40%" in i for i in doc["issues"])
    res = client.post("/api/chat/override", json={"session_id": sid, "target": "document", "ref": "1", "justification": "Old address on file"})
    assert res.status_code == 200 and res.json()["session"]["documents"]["items"][0]["overridden"] is True


def test_ai_off_scenario_never_calls_bedrock(client, fake_bedrock):
    s = start(client, PRIYA)
    assert s["ai_enabled"] is False
    sid = s["session_id"]
    _, _, s = step(client, sid, "collateral", files=[("collateral_images", photo())])
    assert s["inventory"] == [] and s["workflow_state"] == "collateral"
    assert "add the items by hand" in s["gate"]["reasons"][0]

    for name, grams in (("Gold Necklace", 32), ("Gold Bangle", 18)):
        res = client.post("/api/chat/item", json={"session_id": sid, "name": name, "weight_gm": grams})
        assert res.status_code == 200, res.text
    _, _, s = step(client, sid, "continue")
    assert s["workflow_state"] == "weight" and s["weight"]["entered_g"] == 50

    _, _, s = step(client, sid, "scale_photo", files=[("scale_image", photo("scale.png"))])
    assert s["scale"]["asset_id"] and s["scale"]["weight_g"] is None
    client.post("/api/chat/scale", json={"session_id": sid, "weight_g": 50.02})

    _, _, s = step(client, sid, "measure")  # the CaratMeter is a device, not AI: it runs with AI off
    assert s["workflow_state"] == "damage" and s["measurements"]["count"] == 2
    step(client, sid, "continue")
    step(client, sid, "continue")
    _, _, s = step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Aadhaar Card"]))
    assert s["documents"]["items"][0]["status"] == "not_checked"
    _, _, s = step(client, sid, "report")
    assert s["report"]["recommendation"] == "PROCEED", s["report"]["reasons"]
    assert fake_bedrock.calls == []
    answer = client.post("/api/chat/answer", json={"session_id": sid, "question": "How many items?"}).json()
    assert "turned off" in answer["text"]


def test_edit_endpoint(client, fake_bedrock):
    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    res = client.post("/api/chat/edit", json={"session_id": sid, "ref": "item-1", "changes": {"name": "Gold Necklace"}, "justification": "It is a necklace"})
    assert res.status_code == 200
    row = next(r for r in res.json()["session"]["inventory"] if r["id"] == "item-1")
    assert row["name"] == "Gold Necklace"
    res = client.post("/api/chat/edit", json={"session_id": sid, "ref": "item-1", "changes": {"carat": "99"}, "justification": "Wrong purity"})
    assert res.status_code == 409


def test_settings_are_validated_and_clamped(client):
    res = client.put("/api/settings", json={"foreign_object_threshold_pct": 250, "doc_match_threshold_pct": 10,
                                            "aws_enabled": {"Renewal": True, "Unknown": True}})
    body = res.json()
    assert body["foreign_object_threshold_pct"] == 100 and body["doc_match_threshold_pct"] == 50
    assert body["aws_enabled"]["Renewal"] is True and "Unknown" not in body["aws_enabled"]
    assert client.put("/api/settings", json={"blocker_mode": "maybe"}).status_code == 422


def test_valuation_settings_are_validated_and_captured_per_session(client, fake_bedrock):
    body = client.get("/api/settings").json()
    assert [m["key"] for m in body["valuation"]["materials"]] == ["gold", "silver"]
    assert body["damage_deduction"] == "tenths"

    def pledge_for(session_id):
        weigh(client, session_id, {"item-1": 10, "item-2": 11, "item-3": 12})
        step(client, session_id, "measure")
        return client.get(f"/api/chat/session/{session_id}").json()["session"]["stats"]["pledge_amount"]

    before_id = start(client)["session_id"]
    step(client, before_id, "collateral", files=[("collateral_images", photo())])
    before = pledge_for(before_id)

    valuation = body["valuation"]
    valuation["materials"][0]["ltv_pct"] = 60
    valuation["materials"].append({"key": "Platinum 950", "name": "Platinum", "ltv_pct": 65,
                                   "grades": [{"grade": "pt950", "fineness_pct": 95, "rate_per_gram": 3100}]})
    res = client.put("/api/settings", json={"valuation": valuation, "weight_tolerance_g": 9, "damage_deduction": "percent"})
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["valuation"]["materials"][2]["key"] == "platinum-950" and saved["valuation"]["materials"][2]["grades"][0]["grade"] == "PT950"
    assert saved["weight_tolerance_g"] == 5.0 and saved["damage_deduction"] == "percent"

    after_id = start(client)["session_id"]
    step(client, after_id, "collateral", files=[("collateral_images", photo())])
    assert pledge_for(after_id) < before  # LTV 60 % applies to new sessions only
    assert client.get(f"/api/chat/session/{before_id}").json()["session"]["stats"]["pledge_amount"] == before

    dup = {"materials": [{"key": "gold", "name": "Gold", "ltv_pct": 75, "grades": [
        {"grade": "22K", "fineness_pct": 91.6, "rate_per_gram": 1}, {"grade": "22k", "fineness_pct": 91.6, "rate_per_gram": 1}]}]}
    assert client.put("/api/settings", json={"valuation": dup}).status_code == 422
    assert client.put("/api/settings", json={"valuation": {"materials": []}}).status_code == 422
    assert client.put("/api/settings", json={"damage_deduction": "half"}).status_code == 422


def test_mock_caratmeter_gateway(client):
    status = client.get("/api/integrations/caratmeter/v1/status", params={"branch": "FED-COK-006"}).json()
    assert status["device_id"] == "CM-FED-COK-006" and status["connected"] is True
    body = {"branch": "FED-COK-006", "application": "APP-2026-00007", "customer_id": "CBS100098", "samples": [
        {"tag": "item-1", "material": "gold", "entered_weight_g": 18},
        {"tag": "item-2", "material": "gold", "entered_weight_g": 8},
    ]}
    first = client.post("/api/integrations/caratmeter/v1/measurements", json=body).json()
    second = client.post("/api/integrations/caratmeter/v1/measurements", json=body).json()
    chain, pendant = first["measurements"]
    assert [m["net_weight_g"] for m in first["measurements"]] == [m["net_weight_g"] for m in second["measurements"]]
    assert abs(chain["net_weight_g"] - 18) <= 0.05 and 0 < chain["fineness_pct"] <= 100
    assert 7.3 < pendant["net_weight_g"] < 7.45  # scripted finding for this demo customer
    assert client.post("/api/integrations/caratmeter/v1/measurements", json={"samples": [{"tag": ""}]}).status_code == 422


def test_report_pdf_download(client, fake_bedrock):
    fake_bedrock.scale_weight_g = 33.01
    sid = start(client)["session_id"]
    assert client.get(f"/api/reports/session/{sid}/pdf").status_code == 409  # no report yet

    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    step(client, sid, "scale_photo", files=[("scale_image", photo("scale.png"))])
    step(client, sid, "measure")
    step(client, sid, "continue")  # damage -> valuation
    step(client, sid, "continue")  # valuation -> document
    step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Aadhaar Card"]))
    _, _, s = step(client, sid, "report")

    res = client.get(f"/api/reports/session/{sid}/pdf")
    assert res.status_code == 200 and res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"] == f'attachment; filename="{s["report"]["report_id"]}.pdf"'
    assert res.content.startswith(b"%PDF") and len(res.content) > 5000
    assert client.get(f"/api/reports/session/{sid}/pdf?inline=true").headers["content-disposition"].startswith("inline")
    assert client.get("/api/reports/session/nope/pdf").status_code == 404


def test_answer_uses_session_context(client, fake_bedrock):
    import json as _json

    from app import session as session_store
    from app.api.chat import _qa_context
    from app.settings import get_settings
    from app.workflow import state as S

    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    weigh(client, sid, {"item-1": 10, "item-2": 11, "item-3": 12})
    step(client, sid, "measure")
    context = _qa_context(S.view(session_store.load(sid), get_settings()))
    assert context["pledge"]["totals"]["pledge_amount"] > 0
    assert context["inventory"][0]["entered_weight_g"] == 10
    assert context["inventory"][0]["listed_from"] == "collateral photo"
    assert "id_number" not in context["loan"] and len(_json.dumps(context)) < 9000  # nothing is cut off

    assert client.post("/api/chat/answer", json={"session_id": sid, "question": "Which items are damaged?"}).json()["text"] == "Polished message."
    assert client.post("/api/chat/answer", json={"session_id": "0" * 32, "question": "hi"}).status_code == 404


def test_assets_reject_bad_ids(client):
    assert client.get("/api/assets/../../etc").status_code == 404
    assert client.get("/api/assets/" + "a" * 32).status_code == 404


def test_upload_content_type_is_pinned_and_assets_never_render_html(client, fake_bedrock):
    sid = start(client)["session_id"]
    _, _, s = step(client, sid, "collateral", files=[("collateral_images", ("x.png", png_bytes((120, 90)), "text/html"))])
    asset_id = s["collateral"]["images"][0]["asset_id"]
    res = client.get(f"/api/assets/{asset_id}")
    assert res.headers["content-type"] == "image/png"
    assert res.headers["x-content-type-options"] == "nosniff"

    from app import store
    legacy = store.save_asset(b"<script>alert(1)</script>", "text/html")
    res = client.get(f"/api/assets/{legacy}")
    assert res.headers["content-type"].startswith("application/octet-stream")
    assert res.headers["content-disposition"].startswith("attachment")


def test_stale_session_write_is_rejected(client):
    from app import session as session_store

    sid = start(client)["session_id"]
    stale = session_store.load(sid)
    fresh = session_store.load(sid)
    session_store.save(fresh)
    import pytest as _pytest

    with _pytest.raises(session_store.ConflictError):
        session_store.save(stale)


def test_audit_row_is_written_with_the_override(client, fake_bedrock):
    from sqlalchemy import func, select

    from app.db import models as M
    from app.db.base import session_scope

    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 12})
    with session_scope() as db:
        first = db.scalar(select(func.count()).select_from(M.Override).where(M.Override.session_id == sid))
    assert first == 0  # weighing an ornament is not an override

    res = client.post("/api/chat/weight", json={"session_id": sid, "ref": "item-1", "weight_gm": 13,
                                                "justification": "Re-weighed at the counter"})
    assert res.status_code == 200, res.text
    with session_scope() as db:
        count = db.scalar(select(func.count()).select_from(M.Override).where(M.Override.session_id == sid))
    assert count == 1


def test_in_progress_sessions_are_listed(client):
    sid = start(client)["session_id"]
    listed = client.get("/api/chat/sessions").json()["sessions"]
    assert any(x["session_id"] == sid and x["workflow_state"] == "collateral" for x in listed)

"""End-to-end API tests against the test database with Bedrock faked."""

from __future__ import annotations

import json

from tests.conftest import png_bytes

RAJESH = "GL2024001234"  # Fresh Loan (AI on), 8 items (90 g declared), 2 CBS-declared damages
PRIYA = "GL2024001189"   # Renewal (AI off by default)
SURESH = "GL2024001098"  # Fresh Loan; the mock CaratMeter reads a lighter pendant and a low-purity bangle
LAKSHMI = "GL2024001210" # Fresh Loan; gold + silver


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


def test_start_validates_account(client):
    assert client.post("/api/chat/start", json={"account": "  "}).status_code == 400
    res = client.post("/api/chat/start", json={"account": "NOPE123"})
    assert res.status_code == 404 and res.json()["samples"]
    session = start(client, " gl2024001234 ")
    assert session["loan"]["account_number"] == RAJESH
    assert session["ai_enabled"] is True and len(session["inventory"]) == 8
    assert "id_number" not in session["loan"]


def test_full_happy_path_with_reports(client, fake_bedrock):
    fake_bedrock.scale_weight_g = 90.02
    s = start(client)
    sid = s["session_id"]
    assert s["steps"] == ["collateral", "weight", "damage", "document", "report"]
    assert s["stats"]["pledge_is_estimate"] is True and s["stats"]["pledge_amount"] > 0

    # Actions out of order are refused with the current view.
    res, _, _ = step(client, sid, "report")
    assert res.status_code == 409 and res.json()["session"]["workflow_state"] == "collateral"

    res, events, s = step(client, sid, "collateral", files=[("collateral_images", photo())])
    names = [e for e, _ in events]
    assert names[0] == "exec-step" and "exec-done" in names and names[-1] == "done"
    steps_done = [d for e, d in events if e == "exec-step" and d["status"] == "done"]
    assert len(steps_done) == 11 and all("elapsed_ms" in d for d in steps_done)
    assert all(r["status"] == "verified" and r["thumb_asset_id"] for r in s["inventory"])
    assert s["workflow_state"] == "weight"
    assert s["scale"]["weight_g"] == 90.02 and s["weight"]["scale_status"] == "match"
    assert set(s["cbs_damage_pending"]) == {"bangle-1", "ring-3"}

    res, events, s = step(client, sid, "measure")
    run = [d for e, d in events if e == "exec-step" and d["status"] == "done"]
    assert [d["key"] for d in run] == ["connect", "measure", "grade", "crosscheck", "scale", "valuation", "result"]
    done = next(d for e, d in events if e == "exec-done")
    assert done["agent"] == "weight" and done["status"] == "pass"
    assert all(r["measurement_status"] == "match" for r in s["inventory"])
    assert s["workflow_state"] == "damage"
    assert s["stats"]["pledge_is_estimate"] is False and s["valuation"]["totals"]["pledge_amount"] == s["stats"]["pledge_amount"]
    assert s["measurements"]["device"]["device_id"] == "CM-FED-MUM-001"

    thumb = s["inventory"][0]["thumb_asset_id"]
    asset = client.get(f"/api/assets/{thumb}")
    assert asset.status_code == 200 and asset.headers["content-type"] == "image/png"

    hints = [
        {"ornament_id": "bangle-1", "type": "Dent", "severity": "moderate", "details": "Dent on inner rim"},
        {"ornament_id": "ring-3", "type": "Scratch", "severity": "minor", "details": ""},
    ]
    res, events, s = step(client, sid, "damage", files=[("damage_images", photo("d1.png")), ("damage_images", photo("d2.png"))],
                          damage_hints=json.dumps(hints))
    assert len(s["damages"]) == 2 and s["cbs_damage_pending"] == []
    assert s["damages"][0]["thumb_asset_id"] and s["damages"][0]["assessed_severity"] == "minor"
    assert s["workflow_state"] == "damage"

    res, events, s = step(client, sid, "continue")
    assert s["workflow_state"] == "document"
    assert any(e == "agent-msg" for e, _ in events)

    res, events, s = step(client, sid, "document", files=[("documents", photo("aadhaar.png"))],
                          document_types=json.dumps(["Aadhaar Card"]))
    assert s["workflow_state"] == "report"
    assert s["documents"]["items"][0]["status"] == "pass"

    res, events, s = step(client, sid, "report")
    assert s["workflow_state"] == "done"
    assert s["report"]["recommendation"] == "PROCEED", s["report"]["reasons"]
    assert s["report"]["report_id"].startswith("GLV-")
    assert s["report"]["weight"]["measured_complete"] and s["report"]["valuation"]["items"]

    # Restoring the session returns the same state.
    restored = client.get(f"/api/chat/session/{sid}").json()["session"]
    assert restored["report"]["report_id"] == s["report"]["report_id"]

    # Reporting sees exactly one run for this session.
    account = client.get("/api/reports/account", params={"account": RAJESH.lower()}).json()
    runs = [r for r in account["runs"] if r["session_id"] == sid]
    assert len(runs) == 1 and runs[0]["counts"]["damage"]["pass"] == 2
    assert runs[0]["summary"]["recommendation"] == "PROCEED"
    assert runs[0]["summary"]["pledge_amount"] == s["stats"]["pledge_amount"]
    overview = client.get("/api/reports/overview", params={"days": 7}).json()
    assert overview["totals"]["runs"] >= 1 and len(overview["days"]) == 7
    assert client.get("/api/reports/daily", params={"date": "bad"}).status_code == 400

    # Locked after completion.
    res = client.post("/api/chat/override", json={"session_id": sid, "target": "item", "ref": "ring-1", "justification": "late change"})
    assert res.status_code == 409


def test_partial_collateral_override_and_blocker_mode(client, fake_bedrock):
    client.put("/api/settings", json={"blocker_mode": True})
    fake_bedrock.collateral_labels = ["gold chain", "gold chain"]  # only two chains detected
    s = start(client)
    sid = s["session_id"]
    _, _, s = step(client, sid, "collateral", files=[("collateral_images", photo())])
    assert s["workflow_state"] == "collateral"
    assert sum(r["status"] == "verified" for r in s["inventory"]) == 2
    assert s["gate"]["allowed"] is False

    res, events, s = step(client, sid, "continue")
    assert any(e == "notice" and "not sighted" in d["text"] for e, d in events)
    assert s["workflow_state"] == "collateral"

    for row in s["inventory"]:
        if row["status"] == "pending":
            res = client.post("/api/chat/override", json={
                "session_id": sid, "target": "item", "ref": row["id"], "justification": "Verified physically at counter",
            })
            assert res.status_code == 200, res.text
    s = res.json()["session"]
    assert s["gate"]["allowed"] is True
    assert len(s["audit"]) == 6


def test_upload_validation(client):
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


def test_damage_and_document_validation(client, fake_bedrock):
    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints="[]")
    assert res.status_code == 409  # weight & purity come first
    res, _, _ = step(client, sid, "measure", files=[("collateral_images", photo())])
    assert res.status_code == 400 and "does not accept file uploads" in res.json()["error"]
    step(client, sid, "measure")
    bad = [{"ornament_id": "not-mine", "type": "Dent", "severity": "minor", "details": ""}]
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints=json.dumps(bad))
    assert res.status_code == 400
    other = [{"ornament_id": "ring-1", "type": "Other", "severity": "minor", "details": ""}]
    res, _, _ = step(client, sid, "damage", files=[("damage_images", photo())], damage_hints=json.dumps(other))
    assert res.status_code == 400 and "Describe" in res.json()["error"]

    step(client, sid, "continue")
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
    step(client, sid, "measure")
    step(client, sid, "continue")
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
    _, events, s = step(client, sid, "collateral", files=[("collateral_images", photo())])
    assert {r["status"] for r in s["inventory"]} == {"manual"}
    assert s["workflow_state"] == "weight" and s["weight"]["scale_status"] == "missing"
    _, _, s = step(client, sid, "measure")  # the CaratMeter is a device, not AI: it runs with AI off too
    assert s["workflow_state"] == "damage" and s["measurements"]["count"] == 3
    res = client.post("/api/chat/scale", json={"session_id": sid, "weight_g": 56.03})
    assert res.status_code == 200, res.text
    assert res.json()["session"]["weight"]["scale_status"] == "match" and res.json()["entry"]["target"] == "scale"
    step(client, sid, "continue")
    _, _, s = step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Aadhaar Card"]))
    assert s["documents"]["items"][0]["status"] == "not_checked"
    _, _, s = step(client, sid, "report")
    assert s["report"]["recommendation"] == "PROCEED", s["report"]["reasons"]
    assert fake_bedrock.calls == []
    answer = client.post("/api/chat/answer", json={"session_id": sid, "question": "How many items?"}).json()
    assert "turned off" in answer["text"]


def test_edit_endpoint(client):
    sid = start(client)["session_id"]
    res = client.post("/api/chat/edit", json={"session_id": sid, "ref": "ring-1", "changes": {"weight_gm": 5.4}, "justification": "Re-weighed"})
    assert res.status_code == 200
    row = next(r for r in res.json()["session"]["inventory"] if r["id"] == "ring-1")
    assert row["weight_gm"] == 5.4
    res = client.post("/api/chat/edit", json={"session_id": sid, "ref": "ring-1", "changes": {"carat": "99"}, "justification": "Re-weighed"})
    assert res.status_code == 409


def test_settings_are_validated_and_clamped(client):
    res = client.put("/api/settings", json={"foreign_object_threshold_pct": 250, "doc_match_threshold_pct": 10,
                                            "aws_enabled": {"Renewal": True, "Unknown": True}})
    body = res.json()
    assert body["foreign_object_threshold_pct"] == 100 and body["doc_match_threshold_pct"] == 50
    assert body["aws_enabled"]["Renewal"] is True and "Unknown" not in body["aws_enabled"]
    assert client.put("/api/settings", json={"blocker_mode": "maybe"}).status_code == 422


def test_answer_uses_session_context(client, fake_bedrock):
    import json as _json

    from app import session as session_store
    from app.api.chat import _qa_context
    from app.settings import get_settings
    from app.workflow import state as S

    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    step(client, sid, "measure")
    context = _qa_context(S.view(session_store.load(sid), get_settings()))
    assert context["pledge"]["totals"]["pledge_amount"] > 0 and context["inventory"][0]["caratmeter"]["grade"] == "22K"
    assert "id_number" not in context["loan"] and len(_json.dumps(context)) < 9000  # nothing is cut off
    assert client.post("/api/chat/answer", json={"session_id": sid, "question": "Which items are damaged?"}).json()["text"] == "Polished message."
    assert client.post("/api/chat/answer", json={"session_id": "0" * 32, "question": "hi"}).status_code == 404


def test_report_pdf_download(client, fake_bedrock):
    fake_bedrock.scale_weight_g = 90.02
    sid = start(client)["session_id"]
    assert client.get(f"/api/reports/session/{sid}/pdf").status_code == 409  # no report yet

    step(client, sid, "collateral", files=[("collateral_images", photo())])
    step(client, sid, "measure")
    for ref in ("bangle-1", "ring-3"):
        client.post("/api/chat/override", json={"session_id": sid, "target": "damage", "ref": ref, "justification": "No damage on inspection"})
    step(client, sid, "continue")
    step(client, sid, "document", files=[("documents", photo())], document_types=json.dumps(["Aadhaar Card"]))
    _, _, s = step(client, sid, "report")

    res = client.get(f"/api/reports/session/{sid}/pdf")
    assert res.status_code == 200 and res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"] == f'attachment; filename="{s["report"]["report_id"]}.pdf"'
    assert res.content.startswith(b"%PDF") and len(res.content) > 5000
    assert client.get(f"/api/reports/session/{sid}/pdf?inline=true").headers["content-disposition"].startswith("inline")
    assert client.get("/api/reports/session/nope/pdf").status_code == 404
    assert client.get(f"/api/reports/session/{'f' * 32}/pdf").status_code == 404


def test_assets_reject_bad_ids(client):
    assert client.get("/api/assets/../../etc").status_code == 404
    assert client.get("/api/assets/" + "a" * 32).status_code == 404


def test_upload_content_type_is_pinned_and_assets_never_render_html(client):
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


def test_audit_row_is_written_with_the_override(client):
    from sqlalchemy import func, select

    from app.db import models as M
    from app.db.base import session_scope

    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    res = client.post("/api/chat/override", json={"session_id": sid, "target": "damage", "ref": "ring-3", "justification": "No damage on inspection"})
    assert res.status_code == 200, res.text
    with session_scope() as db:
        count = db.scalar(select(func.count()).select_from(M.Override).where(M.Override.session_id == sid))
    assert count == 1


def test_in_progress_sessions_are_listed(client):
    sid = start(client)["session_id"]
    listed = client.get("/api/chat/sessions").json()["sessions"]
    assert any(x["session_id"] == sid and x["workflow_state"] == "collateral" for x in listed)


# --------------------------------------------------------------------------- weight, purity & valuation
def test_caratmeter_discrepancies_hold_the_weight_step(client, fake_bedrock):
    client.put("/api/settings", json={"blocker_mode": True})
    fake_bedrock.scale_weight_g = 68.0
    sid = start(client, SURESH)["session_id"]
    _, _, s = step(client, sid, "collateral", files=[("collateral_images", photo())])
    assert s["workflow_state"] == "weight"

    _, events, s = step(client, sid, "measure")
    rows = {r["id"]: r for r in s["inventory"]}
    assert rows["pendant-1"]["measurement_status"] == "weight_mismatch"
    assert rows["bangle-2"]["measurement_status"] == "purity_low" and rows["bangle-2"]["measurement"]["grade"] == "20K"
    assert s["workflow_state"] == "weight" and s["weight"]["flagged"] == 2
    assert next(d for e, d in events if e == "exec-done")["status"] == "alert"

    _, events, s = step(client, sid, "continue")
    assert any(e == "notice" and "differ from the declared" in d["text"] for e, d in events)
    for ref in ("pendant-1", "bangle-2"):
        res = client.post("/api/chat/override", json={"session_id": sid, "target": "measurement", "ref": ref,
                                                      "justification": "Re-tested by the branch appraiser"})
        assert res.status_code == 200, res.text
    _, _, s = step(client, sid, "continue")
    assert s["workflow_state"] == "damage"
    items = {i["ornament_id"]: i for i in s["valuation"]["items"]}
    assert items["bangle-2"]["grade"] == "20K" and items["pendant-1"]["weight_g"] < 7.5


def test_caratmeter_failure_is_reported_and_retryable(client, fake_bedrock, monkeypatch):
    from app.integrations import caratmeter

    sid = start(client)["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])

    async def offline(*_args, **_kwargs):
        raise caratmeter.CaratMeterError("The CaratMeter didn't respond. Check the device connection and try again.")

    monkeypatch.setattr(caratmeter, "measure", offline)
    _, events, s = step(client, sid, "measure")
    assert any(e == "notice" and d["level"] == "error" and "didn't respond" in d["text"] for e, d in events)
    assert next(d for e, d in events if e == "exec-done")["status"] == "error"
    assert s["workflow_state"] == "weight" and s["measurements"] is None
    monkeypatch.undo()
    _, _, s = step(client, sid, "measure")
    assert s["workflow_state"] == "damage"


def test_silver_is_valued_with_its_own_rates(client, fake_bedrock):
    s = start(client, LAKSHMI)
    anklet = next(i for i in s["valuation"]["items"] if i["ornament_id"] == "anklet-1")
    assert anklet["material"] == "Silver" and anklet["grade"] == "925" and anklet["ltv_pct"] == 70
    assert s["options"]["grades"]["silver"] == ["999", "925"]
    sid = s["session_id"]
    step(client, sid, "collateral", files=[("collateral_images", photo())])
    _, _, s = step(client, sid, "measure")
    row = next(r for r in s["inventory"] if r["id"] == "anklet-1")
    assert row["material"] == "silver" and row["measurement"]["karat"] is None and row["measurement_status"] == "match"


def test_valuation_settings_are_validated_and_captured_per_session(client):
    body = client.get("/api/settings").json()
    assert [m["key"] for m in body["valuation"]["materials"]] == ["gold", "silver"]
    assert body["damage_deduction"] == "tenths"

    before = start(client)
    valuation = body["valuation"]
    valuation["materials"][0]["ltv_pct"] = 60
    valuation["materials"].append({"key": "Platinum 950", "name": "Platinum", "ltv_pct": 65,
                                   "grades": [{"grade": "pt950", "fineness_pct": 95, "rate_per_gram": 3100}]})
    res = client.put("/api/settings", json={"valuation": valuation, "weight_tolerance_g": 9, "damage_deduction": "percent"})
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["valuation"]["materials"][2]["key"] == "platinum-950" and saved["valuation"]["materials"][2]["grades"][0]["grade"] == "PT950"
    assert saved["weight_tolerance_g"] == 5.0 and saved["damage_deduction"] == "percent"

    after = start(client)
    assert after["stats"]["pledge_amount"] < before["stats"]["pledge_amount"]  # LTV 60 % applies to new sessions only
    again = client.get(f"/api/chat/session/{before['session_id']}").json()["session"]
    assert again["stats"]["pledge_amount"] == before["stats"]["pledge_amount"]

    dup = {"materials": [{"key": "gold", "name": "Gold", "ltv_pct": 75, "grades": [
        {"grade": "22K", "fineness_pct": 91.6, "rate_per_gram": 1}, {"grade": "22k", "fineness_pct": 91.6, "rate_per_gram": 1}]}]}
    assert client.put("/api/settings", json={"valuation": dup}).status_code == 422
    assert client.put("/api/settings", json={"valuation": {"materials": []}}).status_code == 422
    assert client.put("/api/settings", json={"damage_deduction": "half"}).status_code == 422


def test_mock_caratmeter_gateway(client):
    status = client.get("/api/integrations/caratmeter/v1/status", params={"branch": "FED-COK-006"}).json()
    assert status["device_id"] == "CM-FED-COK-006" and status["connected"] is True
    body = {"branch": "FED-COK-006", "account_number": SURESH, "samples": [
        {"tag": "pendant-1", "material": "gold", "declared_purity": "22", "declared_weight_g": 8},
        {"tag": "anklet-1", "material": "silver", "declared_purity": "925", "declared_weight_g": 64},
    ]}
    first = client.post("/api/integrations/caratmeter/v1/measurements", json=body).json()
    second = client.post("/api/integrations/caratmeter/v1/measurements", json=body).json()
    pendant, anklet = first["measurements"]
    assert [m["net_weight_g"] for m in first["measurements"]] == [m["net_weight_g"] for m in second["measurements"]]
    assert 7.3 < pendant["net_weight_g"] < 7.45 and abs(pendant["karat"] - 22) < 0.1
    assert abs(anklet["fineness_pct"] - 92.5) <= 0.12 and anklet["karat"] is None
    assert client.post("/api/integrations/caratmeter/v1/measurements", json={"samples": [{"tag": ""}]}).status_code == 422

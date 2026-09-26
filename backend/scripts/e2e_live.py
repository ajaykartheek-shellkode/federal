"""Live end-to-end run against a running API with real Bedrock calls.

Signs in as the branch assessor, finds Rajesh Kumar by mobile number, and walks the journey —
collateral → weighing machine (total split across the ornaments) → CaratMeter → damage → pledge →
documents → report — using the images in ../sampleImages, printing each streamed event.

    ./.venv/bin/uvicorn main:app --port 8000          # in one terminal
    ./.venv/bin/python scripts/e2e_live.py            # in another
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

API = "http://localhost:8000"
EMAIL, PASSWORD = "assessor@federalbank.co.in", "Federal@2026"
MOBILE = "98200 41234"  # Rajesh Kumar

ROOT = Path(__file__).resolve().parents[2] / "sampleImages"
SAMPLES = next((p for p in sorted(ROOT.glob("RajeshKumar*")) if p.is_dir()), ROOT / "RajeshKumar")
COLLATERAL = SAMPLES / "ChatGPT Image Aug 26, 2026, 01_06_24 PM.png"
BANGLE_DENT = SAMPLES / "ChatGPT Image Aug 26, 2026, 01_06_28 PM.png"
RING_SCRATCH = SAMPLES / "ChatGPT Image Aug 26, 2026, 01_06_34 PM.png"
AADHAAR = SAMPLES / "Gemini_Generated_Image_73yfw673yfw673yf.png"
MACHINE = ROOT / "weighing-machine.jpg"  # the pan + display shot the agent reads and splits


def upload(path: Path) -> tuple:
    return (path.name, path.read_bytes(), "image/png" if path.suffix.lower() == ".png" else "image/jpeg")


def run_step(client: httpx.Client, sid: str, action: str, files=None, **form) -> dict:
    started = time.time()
    session = None
    with client.stream("POST", f"{API}/api/chat/step", data={"session_id": sid, "action": action, **form},
                       files=files or [], timeout=600) as res:
        res.raise_for_status()
        event = None
        for line in res.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:].strip() or "{}")
                if event == "exec-step" and data.get("status") == "done":
                    print(f"   · {data['label']} ({data.get('elapsed_ms', 0)} ms)")
                elif event in ("notice", "error"):
                    print(f"   ! {data.get('text', data)}")
                elif event == "agent-msg":
                    print(f"   agent: {data['text']}")
                elif event == "state":
                    session = data["session"]
    print(f"   ({action} took {time.time() - started:.1f}s)\n")
    return session


def main() -> int:
    with httpx.Client() as client:
        res = client.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
        res.raise_for_status()
        print(f"Signed in as {res.json()['user']['name']} ({res.json()['user']['branch']})\n")

        res = client.post(f"{API}/api/chat/start", json={"mobile": MOBILE}, timeout=60)
        res.raise_for_status()
        body = res.json()
        s, sid = body["session"], body["session"]["session_id"]
        print(f"Session {sid} · {s['loan']['customer_name']} · {s['application']['reference']}")
        print(f"  agent: {body['message']}\n")

        print("→ collateral")
        s = run_step(client, sid, "collateral", files=[("collateral_images", upload(COLLATERAL))])
        for r in s["inventory"]:
            print(f"   {r['id']:<10} {r['name']:<14} {r['status']:<9} thumb={bool(r['thumb_asset_id'])}")
        for im in s["collateral"]["images"]:
            print(f"   photo {im['index'] + 1}: {im['status']} count={im['ornament_count_estimate']} issues={im['issues']}")

        print("→ weighing machine")
        if MACHINE.exists():
            s = run_step(client, sid, "scale_photo", files=[("scale_image", upload(MACHINE))])
            print(f"   display: {s['scale']['weight_g']} g ({s['scale']['text']!r})")
            for r in s["inventory"]:
                print(f"   {r['id']:<10} {r['weight_gm']:>7.2f} g  {r['weight_source']:<9} {r.get('weight_basis', '')}")
        else:
            print(f"   (no machine photo at {MACHINE} — typing the weights instead)")
            for i, r in enumerate(s["inventory"]):
                client.post(f"{API}/api/chat/weight", json={"session_id": sid, "ref": r["id"], "weight_gm": 10 + i})
            s = client.get(f"{API}/api/chat/session/{sid}").json()["session"]
        print(f"   pledge list total: {s['weight']['entered_g']} g\n")

        print("→ CaratMeter")
        s = run_step(client, sid, "measure")
        for r in s["inventory"]:
            m = r.get("measurement") or {}
            print(f"   {r['id']:<10} {r['name']:<14} {m.get('fineness_pct', '—')}%  {r['carat'] or '—':<5} {r['measurement_status']}")

        print("→ damage")
        first_two = [r["id"] for r in s["inventory"]][:2]
        hints = [
            {"ornament_id": first_two[0], "type": "Dent", "severity": "moderate", "damage_percent": 8,
             "details": "Dent on inner rim"},
            {"ornament_id": first_two[1], "type": "Scratch", "severity": "minor", "damage_percent": 4,
             "details": "Light surface scratch on band"},
        ]
        s = run_step(client, sid, "damage", damage_hints=json.dumps(hints), files=[
            ("damage_images", upload(BANGLE_DENT)),
            ("damage_images", upload(RING_SCRATCH)),
        ])
        for d in s["damages"]:
            print(f"   {d['item']:<14} {d['status']:<6} consistent={d['consistent']} severity={d['assessed_severity']} notes={d['notes']!r}")

        print("→ continue (damage → pledge valuation)")
        s = run_step(client, sid, "continue")
        print(f"   pledge amount: {s['valuation']['totals']['pledge_amount']}\n")

        print("→ continue (pledge → documents)")
        s = run_step(client, sid, "continue")

        print("→ document")
        s = run_step(client, sid, "document", document_types=json.dumps(["Aadhaar Card"]),
                     files=[("documents", upload(AADHAAR))])
        for d in s["documents"]["items"]:
            print(f"   {d['declared_type']}: {d['status']} detected={d['doc_type_detected']} matches={d['matches']} issues={d['issues']}")

        print("→ report")
        s = run_step(client, sid, "report")
        report = s["report"]
        print(f"   {report['report_id']} {report['recommendation']} overall={report['overall_status']}")
        for r in report["reasons"]:
            print(f"   - [{r['level']}] {r['text']}")
        account = s["loan"]["account_number"]
        print(f"   gold loan account: {account or 'not opened (recommendation is not PROCEED)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

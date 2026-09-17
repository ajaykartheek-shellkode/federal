"""Live end-to-end run against a running API with real Bedrock calls.

Walks the Rajesh Kumar demo account through collateral → damage → documents → report
using the images in ../sampleImages/RajeshKumar and prints each streamed event.

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
ACCOUNT = "GL2024001234"
SAMPLES = Path(__file__).resolve().parents[2] / "sampleImages" / "RajeshKumar"
COLLATERAL = SAMPLES / "ChatGPT Image Aug 26, 2026, 01_06_24 PM.png"
BANGLE_DENT = SAMPLES / "ChatGPT Image Aug 26, 2026, 01_06_28 PM.png"
RING_SCRATCH = SAMPLES / "ChatGPT Image Aug 26, 2026, 01_06_34 PM.png"
AADHAAR = SAMPLES / "Gemini_Generated_Image_73yfw673yfw673yf.png"


def run_step(client: httpx.Client, sid: str, action: str, files=None, **form) -> dict:
    started = time.time()
    session = None
    with client.stream("POST", f"{API}/api/chat/step", data={"session_id": sid, "action": action, **form},
                       files=files or [], timeout=300) as res:
        if res.status_code != 200:
            res.read()
            raise SystemExit(f"{action}: HTTP {res.status_code} {res.text}")
        event = None
        for line in res.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:])
                if event == "exec-step" and data["status"] == "done":
                    print(f"   ✓ {data['label']:<45} {data['elapsed_ms']:>6} ms")
                elif event == "exec-done":
                    print(f"   ⇒ [{data['status']}] {data['summary']} ({data['total_ms']} ms)")
                elif event == "state":
                    session = data["session"]
                elif event in ("agent-msg", "notice", "error"):
                    print(f"   {event}: {data.get('text') or data.get('error')}")
    print(f"   ({action} took {time.time() - started:.1f}s)\n")
    return session


def main() -> int:
    with httpx.Client() as client:
        res = client.post(f"{API}/api/chat/start", json={"account": ACCOUNT}, timeout=60)
        res.raise_for_status()
        body = res.json()
        s, sid = body["session"], body["session"]["session_id"]
        print(f"Session {sid}\n  agent: {body['message']}\n")

        print("→ collateral")
        s = run_step(client, sid, "collateral", files=[("collateral_images", (COLLATERAL.name, COLLATERAL.read_bytes(), "image/png"))])
        for r in s["inventory"]:
            print(f"   {r['id']:<10} {r['name']:<12} {r['status']:<9} thumb={bool(r['thumb_asset_id'])}")
        for im in s["collateral"]["images"]:
            print(f"   photo {im['index'] + 1}: {im['status']} count={im['ornament_count_estimate']} issues={im['issues']}")
        if s["workflow_state"] == "collateral":
            print("→ continue (not all items sighted)")
            s = run_step(client, sid, "continue")

        print("→ damage")
        hints = [
            {"ornament_id": "bangle-1", "type": "Dent", "severity": "moderate", "details": "Dent on inner rim"},
            {"ornament_id": "ring-3", "type": "Scratch", "severity": "minor", "details": "Light surface scratch on band"},
        ]
        s = run_step(client, sid, "damage", damage_hints=json.dumps(hints), files=[
            ("damage_images", (BANGLE_DENT.name, BANGLE_DENT.read_bytes(), "image/png")),
            ("damage_images", (RING_SCRATCH.name, RING_SCRATCH.read_bytes(), "image/png")),
        ])
        for d in s["damages"]:
            print(f"   {d['item']:<12} {d['status']:<6} consistent={d['consistent']} severity={d['assessed_severity']} observed={d['observed']} notes={d['notes']!r}")

        print("→ continue")
        s = run_step(client, sid, "continue")

        print("→ document")
        s = run_step(client, sid, "document", document_types=json.dumps(["Aadhaar Card"]),
                     files=[("documents", (AADHAAR.name, AADHAAR.read_bytes(), "image/png"))])
        for d in s["documents"]["items"]:
            print(f"   {d['declared_type']}: {d['status']} detected={d['doc_type_detected']} matches={d['matches']} issues={d['issues']}")

        print("→ report")
        s = run_step(client, sid, "report")
        report = s["report"]
        print(f"   {report['report_id']} {report['recommendation']} overall={report['overall_status']}")
        for r in report["reasons"]:
            print(f"   - [{r['level']}] {r['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

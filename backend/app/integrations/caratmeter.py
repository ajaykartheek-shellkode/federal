"""CaratMeter integration — the branch XRF analyser, reached over HTTP.

One request per loan application, carrying the ornament ids this verification created; the
response returns a reading for every one of them:

    GET  {base}/v1/status?branch=FED-MUM-001
         -> {"device_id", "model", "branch", "connected", "firmware", "calibrated_at", "mode"}

    POST {base}/v1/measurements
         {"branch", "account_number", "samples": [{"tag", "material", "entered_weight_g"}]}
         -> {"device": {...status...},
             "measurements": [{"sample_id", "tag", "net_weight_g", "fineness_pct", "karat",
                               "material", "measured_at", "confidence"}]}

``tag`` is the ornament id (item-1, item-2 …). ``entered_weight_g`` is what the assessor weighed,
sent so the device response can be reconciled item by item; purity is never declared to the device.

CARATMETER_MODE=mock (default) answers from the in-process simulator below — deterministic
readings, with a few scripted findings on demo accounts so reviews can be shown.
CARATMETER_MODE=http calls the real gateway with the same contract. The mock endpoints in
app.api.integrations serve the simulator over HTTP for inspection.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Dict, List

from app import config

logger = logging.getLogger("glportal.caratmeter")

MODEL = "CaratMeter XRF-900"
FIRMWARE = "4.2.1"

# Simulated analyser latency (a real XRF reading takes a moment per sample). Tests set these to 0.
MOCK_CONNECT_S = 0.2
MOCK_BASE_S = 0.25
MOCK_PER_SAMPLE_S = 0.2
MOCK_MAX_S = 2.4

# Plausible assay results, most gold being 22K. Picked deterministically per ornament.
GOLD_FINENESS = ((0.58, 91.6), (0.74, 99.9), (0.88, 75.0), (1.01, 83.3))
SILVER_FINENESS = ((0.75, 92.5), (1.01, 99.9))

# Scripted findings for demo accounts (account → ornament id → overrides), so a demo can show a
# weight that disagrees with the counter, a lower assay, and metal below every configured grade.
MOCK_DISCREPANCIES: Dict[str, Dict[str, dict]] = {
    "GL2024001098": {  # Suresh Nair
        "item-2": {"weight_delta_g": -0.62},
        "item-4": {"fineness_pct": 84.1},
        "item-6": {"fineness_pct": 41.8},
    },
}


class CaratMeterError(RuntimeError):
    """The device or its gateway could not provide readings."""


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def device_id_for(branch: str) -> str:
    return f"CM-{(branch or 'BRANCH').upper()}"


def simulated_status(branch: str) -> dict:
    return {
        "device_id": device_id_for(branch),
        "model": MODEL,
        "branch": branch,
        "connected": True,
        "firmware": FIRMWARE,
        "calibrated_at": datetime.now(timezone.utc).astimezone().replace(hour=9, minute=0, second=0, microsecond=0).isoformat(timespec="seconds"),
        "mode": "mock",
    }


def _noise(seed: str, spread: float) -> float:
    """Deterministic pseudo-random value in [-spread, +spread] for a seed."""
    digest = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return (digest / 0xFFFFFFFF * 2 - 1) * spread


def _assay(seed: str, material: str) -> float:
    """A plausible fineness for this ornament, stable for the same application and id."""
    table = SILVER_FINENESS if material != "gold" else GOLD_FINENESS
    roll = int(hashlib.sha256((seed + ":a").encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return next(value for edge, value in table if roll < edge)


def simulate_measurements(branch: str, account_number: str, samples: List[dict]) -> dict:
    """Readings a calibrated analyser would return for this application's ornaments."""
    scripted = MOCK_DISCREPANCIES.get((account_number or "").upper(), {})
    measurements = []
    for i, sample in enumerate(samples):
        tag = str(sample.get("tag", f"sample-{i + 1}"))
        material = str(sample.get("material", "gold"))
        entered_weight = float(sample.get("entered_weight_g") or sample.get("declared_weight_g") or 0)
        seed = f"{account_number}:{tag}"
        weight = entered_weight + _noise(seed + ":w", 0.03)
        fineness = _assay(seed, material) + _noise(seed + ":f", 0.12)
        extra = scripted.get(tag, {})
        weight += float(extra.get("weight_delta_g", 0))
        if "fineness_pct" in extra:
            fineness = float(extra["fineness_pct"])
        fineness = max(0.0, min(99.99, fineness))
        measurements.append({
            "sample_id": f"S-{hashlib.sha1(seed.encode()).hexdigest()[:8].upper()}",
            "tag": tag,
            "material": material,
            "net_weight_g": round(max(0.0, weight), 3),
            "fineness_pct": round(fineness, 2),
            "karat": round(fineness / 100 * 24, 2) if material == "gold" else None,
            "measured_at": _now(),
            "confidence": 0.99,
        })
    return {"device": simulated_status(branch), "measurements": measurements}


def _samples(inventory: List[dict]) -> List[dict]:
    """One sample per ornament id created in this verification."""
    return [
        {
            "tag": row["id"],
            "material": row.get("material", "gold"),
            "entered_weight_g": row.get("weight_gm", 0),
        }
        for row in inventory
    ]


async def measure(branch: str, account_number: str, inventory: List[dict]) -> dict:
    """One request for this loan application; returns the gateway payload ({device, measurements})."""
    samples = _samples(inventory)
    if config.CARATMETER_MODE != "http":
        # A real analyser takes a moment per sample; keep the mock believable but quick.
        await asyncio.sleep(min(MOCK_MAX_S, MOCK_BASE_S + MOCK_PER_SAMPLE_S * len(samples)))
        return simulate_measurements(branch, account_number, samples)

    import httpx

    try:
        async with httpx.AsyncClient(base_url=config.CARATMETER_BASE_URL, timeout=config.CARATMETER_TIMEOUT_S) as client:
            res = await client.post(
                "/v1/measurements",
                json={"branch": branch, "account_number": account_number, "samples": samples},
                headers={"X-API-Key": config.CARATMETER_API_KEY} if config.CARATMETER_API_KEY else {},
            )
            res.raise_for_status()
            payload = res.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("CaratMeter gateway call failed: %s", exc)
        raise CaratMeterError("The CaratMeter didn't respond. Check the device connection and try again.") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("measurements"), list):
        raise CaratMeterError("The CaratMeter returned an unexpected response.")
    return payload


async def status(branch: str) -> dict:
    if config.CARATMETER_MODE != "http":
        await asyncio.sleep(MOCK_CONNECT_S)
        return simulated_status(branch)

    import httpx

    try:
        async with httpx.AsyncClient(base_url=config.CARATMETER_BASE_URL, timeout=10) as client:
            res = await client.get("/v1/status", params={"branch": branch})
            res.raise_for_status()
            return {**res.json(), "mode": "http"}
    except Exception as exc:  # noqa: BLE001
        raise CaratMeterError("The CaratMeter device is not reachable.") from exc


def gateway_mode() -> str:
    return "http" if config.CARATMETER_MODE == "http" else "mock"

"""Mock CaratMeter device gateway — the simulator served over HTTP.

  GET  /api/integrations/caratmeter/v1/status?branch=FED-MUM-001
  POST /api/integrations/caratmeter/v1/measurements   {branch, account_number, samples: [...]}

Same JSON contract as a real branch gateway (see app.integrations.caratmeter), so the
integration can be inspected with curl, or exercised end-to-end by pointing
CARATMETER_MODE=http / CARATMETER_BASE_URL at http://localhost:8000/api/integrations/caratmeter.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.integrations import caratmeter

router = APIRouter(prefix="/api/integrations/caratmeter/v1", tags=["integrations"])


class Sample(BaseModel):
    tag: str = Field(min_length=1, max_length=64)  # the ornament id created for this application
    material: str = Field(default="gold", max_length=24)
    entered_weight_g: float = Field(default=0, ge=0, le=50_000)


class MeasureBody(BaseModel):
    branch: str = Field(default="", max_length=32)
    account_number: str = Field(default="", max_length=64)
    samples: List[Sample] = Field(default_factory=list, max_length=100)


@router.get("/status")
async def status(branch: str = Query("", max_length=32)):
    return caratmeter.simulated_status(branch)


@router.post("/measurements")
async def measurements(body: MeasureBody):
    return caratmeter.simulate_measurements(body.branch, body.account_number, [s.model_dump() for s in body.samples])

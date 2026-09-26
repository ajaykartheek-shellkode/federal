"""Test configuration.

* Points the app at a dedicated ``gl_portal_test`` database (created with ``createdb``)
  and rebuilds its schema once per test session.
* Replaces every Bedrock call with a deterministic fake so tests are fast, free and offline.
"""

from __future__ import annotations

import io
import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://ajay@localhost:5432/gl_portal_test"
)
os.environ["GUIDANCE_TIMEOUT_S"] = "2"

import pytest  # noqa: E402

from app.schemas import (  # noqa: E402
    BoundingBox,
    CollateralImageResult,
    CollateralResult,
    DamageCapture,
    DamageReasoning,
    DamageResult,
    DetectedItem,
    DocumentExtracted,
    DocumentItemResult,
    DocumentMatches,
    DocumentResult,
    ItemWeight,
    ScaleResult,
)


def png_bytes(size=(64, 48), color=(212, 175, 55)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


class FakeBedrock:
    """Returns canned, schema-valid results. Tests tweak the attributes to steer outcomes."""

    # The collateral agent's detections become the inventory, so these labels drive most tests.
    DEFAULT_LABELS = ("Gold Chain", "Gold Bangle", "Gold Ring")

    def __init__(self):
        self.collateral_status = "pass"
        self.collateral_labels = list(self.DEFAULT_LABELS)
        self.damage_status = "pass"
        self.document_status = "pass"
        self.document_matches = DocumentMatches(name=True, id=True, address_pct=95)
        self.scale_weight_g = None  # what the weighing-machine photo shows (None = display unreadable)
        self.calls = []

    async def __call__(self, system_prompt, task_text, blocks, model, max_tokens=2000):
        self.calls.append(model.__name__)
        if model is CollateralResult:
            return self._collateral(system_prompt, blocks)
        if model is ScaleResult:
            visible = self.scale_weight_g is not None
            return ScaleResult(
                status="pass" if visible else "fail",
                reading_visible=visible,
                weight_g=self.scale_weight_g,
                reading_text=f"{self.scale_weight_g} g" if visible else "",
                items=self._split(task_text) if visible else [],
                issues=[] if visible else ["Display not readable"],
            )
        if model is DamageResult:
            return DamageResult(
                ornament_id="x", status=self.damage_status,
                capture=DamageCapture(visible=True, inspectable=True, clear=True, no_obstruction=True, no_foreign_objects=True),
                reasoning=DamageReasoning(
                    consistent_with_description=self.damage_status == "pass", described_damage="",
                    observed_damage=["dent on rim"], assessed_severity="minor",
                    notes="" if self.damage_status == "pass" else "Described damage not visible",
                ),
            )
        if model is DocumentResult:
            count = sum(1 for b in blocks if "text" in b and b["text"].startswith("Document doc_no="))
            docs = [
                DocumentItemResult(
                    doc_no=i + 1, declared_type="", status=self.document_status, legible=True, complete=True,
                    type_matches_declared=True, doc_type_detected="Aadhaar Card",
                    extracted=DocumentExtracted(name="Rajesh Kumar", id_number="2337 4600 1234", address="12 MG Road"),
                    matches=self.document_matches,
                    issues=[] if self.document_status == "pass" else ["Photo is blurred"],
                )
                for i in range(count)
            ]
            return DocumentResult(overall_status=self.document_status, documents=docs)
        # Conversation replies (guidance / answer)
        return model.model_validate({"text": "Polished message."})

    def _split(self, task_text):
        """Apportion the machine total over the ids listed in the prompt (even shares, like the model)."""
        ids = [line.split("id=", 1)[1].split(" |", 1)[0].strip()
               for line in task_text.splitlines() if "id=" in line]
        if not ids:
            return []
        share = round(float(self.scale_weight_g) / len(ids), 2)
        return [ItemWeight(id=ref, weight_g=share, basis="even share") for ref in ids]

    def _collateral(self, _system_prompt, blocks):
        """Every ornament the assessor photographed — the first image carries the detections."""
        image_count = sum(1 for b in blocks if "image" in b)
        images = []
        for idx in range(image_count):
            items = [
                DetectedItem(label=label, box=BoundingBox(x=0.05 * n, y=0.1, w=0.2, h=0.3))
                for n, label in enumerate(self.collateral_labels)
            ] if idx == 0 else []
            images.append(CollateralImageResult(
                index=idx, status=self.collateral_status, clarity_ok=True, all_visible=True, not_cropped=True,
                no_obstruction=True, no_foreign_objects=True, clean_background=True,
                ornament_count_estimate=len(items), items=items,
                issues=[] if self.collateral_status == "pass" else ["Image is blurry"],
            ))
        return CollateralResult(overall_status=self.collateral_status, images=images)


@pytest.fixture
def fake_bedrock(monkeypatch):
    fake = FakeBedrock()
    from app.agents import collateral, conversation, damage, document, scale

    for module in (collateral, conversation, damage, document, scale):
        monkeypatch.setattr(module, "run_converse", fake)
    return fake


@pytest.fixture(autouse=True)
def instant_caratmeter(monkeypatch):
    from app.integrations import caratmeter

    for name in ("MOCK_CONNECT_S", "MOCK_BASE_S", "MOCK_PER_SAMPLE_S", "MOCK_MAX_S"):
        monkeypatch.setattr(caratmeter, name, 0)
    monkeypatch.setattr(caratmeter.config, "CARATMETER_MODE", "mock")


@pytest.fixture(scope="session")
def database():
    from app.db import init_db
    from app.db.base import Base, engine

    Base.metadata.drop_all(bind=engine)
    init_db.ensure()
    return engine


# The seeded staff account every test signs in as.
STAFF_EMAIL = "assessor@federalbank.co.in"
STAFF_PASSWORD = "Federal@2026"


@pytest.fixture
def anonymous_client(database, fake_bedrock):
    """A client with no session cookie — for testing the guard itself."""
    from fastapi.testclient import TestClient

    import main

    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def client(anonymous_client):
    """Signed in as the branch assessor, like every real request."""
    res = anonymous_client.post("/api/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD})
    assert res.status_code == 200, res.text
    return anonymous_client


@pytest.fixture(autouse=True)
def _reset_settings(request):
    """Every API test starts from default settings."""
    yield
    if "client" in request.fixturenames:
        from app.settings import default_valuation, update_settings

        update_settings({
            "aws_enabled": {"Fresh Loan": True, "Renewal": False, "Security Operations": False},
            "blocker_mode": False, "max_ornaments_per_image": 12,
            "foreign_object_threshold_pct": 10, "doc_match_threshold_pct": 80,
            "valuation": default_valuation().model_dump(), "weight_tolerance_g": 0.1,
            "purity_tolerance_pct": 0.5, "damage_deduction": "tenths",
        })

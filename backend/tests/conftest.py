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
)


def png_bytes(size=(64, 48), color=(212, 175, 55)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


class FakeBedrock:
    """Returns canned, schema-valid results. Tests tweak the attributes to steer outcomes."""

    def __init__(self):
        self.collateral_status = "pass"
        self.collateral_labels = None  # list of labels; default derived from the inventory hint
        self.damage_status = "pass"
        self.document_status = "pass"
        self.document_matches = DocumentMatches(name=True, id=True, address_pct=95)
        self.scale_weight_g = None  # weighing-scale display shown in the first photo (None = not visible)
        self.calls = []

    async def __call__(self, system_prompt, task_text, blocks, model, max_tokens=2000):
        self.calls.append(model.__name__)
        if model is CollateralResult:
            return self._collateral(system_prompt, blocks)
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

    def _collateral(self, system_prompt, blocks):
        image_count = sum(1 for b in blocks if "image" in b)
        hint = system_prompt.split("CBS PLEDGED INVENTORY (id → declared item): ", 1)[1].split(". For each", 1)[0]
        pairs = [p.split("=", 1) for p in hint.split(", ") if "=" in p]
        images = []
        for idx in range(image_count):
            items = []
            if idx == 0:
                labels = self.collateral_labels if self.collateral_labels is not None else [name for _id, name in pairs]
                for n, label in enumerate(labels):
                    items.append(DetectedItem(label=label.lower(), box=BoundingBox(x=0.05 * n, y=0.1, w=0.2, h=0.3)))
            images.append(CollateralImageResult(
                index=idx, status=self.collateral_status, clarity_ok=True, all_visible=True, not_cropped=True,
                no_obstruction=True, no_foreign_objects=True, clean_background=True,
                ornament_count_estimate=len(items), items=items,
                scale_reading_visible=idx == 0 and self.scale_weight_g is not None,
                scale_weight_g=self.scale_weight_g if idx == 0 else None,
                scale_reading_text=f"{self.scale_weight_g} g" if idx == 0 and self.scale_weight_g is not None else "",
                issues=[] if self.collateral_status == "pass" else ["Image is blurry"],
            ))
        return CollateralResult(overall_status=self.collateral_status, images=images)


@pytest.fixture
def fake_bedrock(monkeypatch):
    fake = FakeBedrock()
    from app.agents import collateral, conversation, damage, document

    for module in (collateral, conversation, damage, document):
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


@pytest.fixture
def client(database, fake_bedrock):
    from fastapi.testclient import TestClient

    import main

    with TestClient(main.app) as c:
        yield c


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

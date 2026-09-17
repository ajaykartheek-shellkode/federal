"""Runtime-configurable settings, persisted in the single `settings` DB row.

Validation
* aws_enabled               — AI validation on/off per loan scenario (captured when a session starts)
* blocker_mode              — alert (advisory) vs blocker (findings must be resolved or overridden)
* max_ornaments_per_image   — above this the collateral agent suggests splitting the photo
* foreign_object_threshold_pct — foreign-object coverage above this is flagged
* doc_match_threshold_pct   — document address similarity below this is flagged

Measurement & valuation (captured when a session starts, so a verification is valued consistently)
* valuation                 — materials (gold, silver, …) each with an LTV % and purity grades
                              (fineness % and rate per gram)
* weight_tolerance_g        — measured vs declared weight difference allowed per ornament
* purity_tolerance_pct      — fineness margin (percentage points) when grading a CaratMeter reading
* damage_deduction          — how the CBS damage % reduces the pledge amount
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.config import MAX_ORNAMENTS_PER_IMAGE

# The three loan scenarios the bank toggles independently.
SCENARIOS = ["Fresh Loan", "Renewal", "Security Operations"]

# Inclusive bounds enforced on every update.
BOUNDS: Dict[str, tuple] = {
    "max_ornaments_per_image": (1, 50),
    "foreign_object_threshold_pct": (0, 100),
    "doc_match_threshold_pct": (50, 100),
    "weight_tolerance_g": (0.0, 5.0),
    "purity_tolerance_pct": (0.0, 5.0),
}

DamageDeduction = Literal["tenths", "percent", "none"]


class PurityGrade(BaseModel):
    grade: str = Field(min_length=1, max_length=12)
    fineness_pct: float = Field(gt=0, le=100)
    rate_per_gram: float = Field(ge=0, le=1_000_000)

    @field_validator("grade")
    @classmethod
    def _clean_grade(cls, v: str) -> str:
        return " ".join(v.split()).upper()


class Material(BaseModel):
    key: str = Field(min_length=1, max_length=24)
    name: str = Field(min_length=1, max_length=40)
    ltv_pct: float = Field(ge=0, le=100)
    grades: List[PurityGrade] = Field(min_length=1, max_length=20)

    @field_validator("key")
    @classmethod
    def _slug(cls, v: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", v.strip().lower()).strip("-")
        if not slug:
            raise ValueError("material key must contain letters or digits")
        return slug

    @model_validator(mode="after")
    def _unique_grades(self) -> "Material":
        names = [g.grade for g in self.grades]
        if len(names) != len(set(names)):
            raise ValueError(f"{self.name}: purity grades must be unique")
        return self


class Valuation(BaseModel):
    materials: List[Material] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _unique_materials(self) -> "Valuation":
        keys = [m.key for m in self.materials]
        if len(keys) != len(set(keys)):
            raise ValueError("material keys must be unique")
        return self


def default_valuation() -> Valuation:
    return Valuation(materials=[
        Material(key="gold", name="Gold", ltv_pct=75, grades=[
            PurityGrade(grade="24K", fineness_pct=99.9, rate_per_gram=9200),
            PurityGrade(grade="22K", fineness_pct=91.6, rate_per_gram=8500),
            PurityGrade(grade="20K", fineness_pct=83.3, rate_per_gram=7700),
            PurityGrade(grade="18K", fineness_pct=75.0, rate_per_gram=6900),
            PurityGrade(grade="14K", fineness_pct=58.5, rate_per_gram=5400),
        ]),
        Material(key="silver", name="Silver", ltv_pct=70, grades=[
            PurityGrade(grade="999", fineness_pct=99.9, rate_per_gram=110),
            PurityGrade(grade="925", fineness_pct=92.5, rate_per_gram=102),
        ]),
    ])


class Settings(BaseModel):
    aws_enabled: Dict[str, bool] = Field(
        default_factory=lambda: {"Fresh Loan": True, "Renewal": False, "Security Operations": False}
    )
    blocker_mode: bool = False
    max_ornaments_per_image: int = MAX_ORNAMENTS_PER_IMAGE
    foreign_object_threshold_pct: int = 10
    doc_match_threshold_pct: int = 80
    valuation: Valuation = Field(default_factory=default_valuation)
    weight_tolerance_g: float = 0.10
    purity_tolerance_pct: float = 0.5
    damage_deduction: DamageDeduction = "tenths"

    def is_enabled_for(self, scenario: str) -> bool:
        # Unknown scenarios default to enabled so new CBS scenario names are never silently skipped.
        return bool(self.aws_enabled.get(scenario, True))

    def valuation_snapshot(self) -> dict:
        """What a new verification session captures for valuing its collateral."""
        return {
            **self.valuation.model_dump(),
            "weight_tolerance_g": self.weight_tolerance_g,
            "purity_tolerance_pct": self.purity_tolerance_pct,
            "damage_deduction": self.damage_deduction,
        }


class SettingsPatch(BaseModel):
    aws_enabled: Optional[Dict[str, bool]] = None
    blocker_mode: Optional[bool] = None
    max_ornaments_per_image: Optional[int] = None
    foreign_object_threshold_pct: Optional[int] = None
    doc_match_threshold_pct: Optional[int] = None
    valuation: Optional[Valuation] = None
    weight_tolerance_g: Optional[float] = None
    purity_tolerance_pct: Optional[float] = None
    damage_deduction: Optional[DamageDeduction] = None


def _to_model(row) -> Settings:
    return Settings(
        aws_enabled={**Settings().aws_enabled, **(row.aws_enabled or {})},
        blocker_mode=row.blocker_mode,
        max_ornaments_per_image=row.max_ornaments_per_image,
        foreign_object_threshold_pct=row.foreign_object_threshold_pct,
        doc_match_threshold_pct=row.doc_match_threshold_pct,
        valuation=Valuation.model_validate(row.valuation) if row.valuation else default_valuation(),
        weight_tolerance_g=row.weight_tolerance_g if row.weight_tolerance_g is not None else 0.10,
        purity_tolerance_pct=row.purity_tolerance_pct if row.purity_tolerance_pct is not None else 0.5,
        damage_deduction=row.damage_deduction or "tenths",
    )


def _clamp(key: str, value):
    lo, hi = BOUNDS[key]
    cast = float if isinstance(lo, float) else int
    return max(lo, min(hi, cast(value)))


def _new_row(M):
    defaults = Settings()
    return M.Setting(id=1, **{**defaults.model_dump(exclude={"valuation"}), "valuation": defaults.valuation.model_dump()})


def get_settings() -> Settings:
    # Local import avoids a circular import at module load (init_db imports this module).
    from app.db import models as M
    from app.db.base import session_scope

    with session_scope() as db:
        row = db.get(M.Setting, 1)
        if row is None:
            row = _new_row(M)
            db.add(row)
            db.flush()
        return _to_model(row)


def update_settings(patch: Dict[str, Any] | SettingsPatch) -> Settings:
    from app.db import models as M
    from app.db.base import session_scope

    data = patch if isinstance(patch, SettingsPatch) else SettingsPatch.model_validate(patch)
    with session_scope() as db:
        row = db.get(M.Setting, 1)
        if row is None:
            row = _new_row(M)
            db.add(row)
            db.flush()
        if data.aws_enabled:
            known = {k: bool(v) for k, v in data.aws_enabled.items() if k in SCENARIOS}
            row.aws_enabled = {**(row.aws_enabled or {}), **known}
        if data.blocker_mode is not None:
            row.blocker_mode = data.blocker_mode
        for key in BOUNDS:
            value = getattr(data, key)
            if value is not None:
                setattr(row, key, _clamp(key, value))
        if data.valuation is not None:
            row.valuation = data.valuation.model_dump()
        if data.damage_deduction is not None:
            row.damage_deduction = data.damage_deduction
        db.flush()
        return _to_model(row)

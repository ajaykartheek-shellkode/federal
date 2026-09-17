"""SQLAlchemy models for GL Portal (database: gl_portal).

Groups:
  * CBS reference data (seeded): customers, ornaments, gold_rates
  * Live workflow: sessions (one JSONB state document per verification, mirroring the
    TDD data model), overrides (append-only audit), agent_logs (step timings)
  * Reporting: runs, run_images
  * Binary + config: assets, settings

JSONB holds nested AI output and the live session document; everything that reports
filter on (account, date, status) is a typed, indexed column.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _uuid() -> str:
    return uuid.uuid4().hex


# --------------------------------------------------------------------------- CBS reference
class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_id: Mapped[str] = mapped_column(String(64))
    customer_name: Mapped[str] = mapped_column(String(200))
    scenario: Mapped[str] = mapped_column(String(64), default="Fresh Loan")
    branch: Mapped[str] = mapped_column(String(120), default="")
    # KYC details for cross-verification against uploaded proofs.
    id_number: Mapped[str] = mapped_column(String(64), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ornaments: Mapped[list["Ornament"]] = relationship(
        back_populates="customer", cascade="all, delete-orphan", order_by="Ornament.seq"
    )


class Ornament(Base):
    __tablename__ = "ornaments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer, default=0)
    ref: Mapped[str] = mapped_column(String(64))  # stable id like "ring-1" used across the flow
    name: Mapped[str] = mapped_column(String(120))
    carat: Mapped[str] = mapped_column(String(8))
    weight_gm: Mapped[float] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    damage_visible: Mapped[bool] = mapped_column(Boolean, default=False)
    damage_count: Mapped[int] = mapped_column(Integer, default=0)
    damage_details: Mapped[str] = mapped_column(Text, default="")
    damage_percent: Mapped[float] = mapped_column(Float, default=0)
    material: Mapped[str] = mapped_column(String(24), default="gold")

    customer: Mapped["Customer"] = relationship(back_populates="ornaments")


class GoldRate(Base):
    __tablename__ = "gold_rates"

    carat: Mapped[str] = mapped_column(String(8), primary_key=True)
    rate_per_gram: Mapped[int] = mapped_column(Integer)


# --------------------------------------------------------------------------- live workflow
class WorkSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    account_number: Mapped[str] = mapped_column(String(64), index=True, default="")
    customer_id: Mapped[str] = mapped_column(String(64), default="")
    customer_name: Mapped[str] = mapped_column(String(200), default="")
    scenario: Mapped[str] = mapped_column(String(64), default="Fresh Loan")
    branch: Mapped[str] = mapped_column(String(120), default="")
    workflow_state: Mapped[str] = mapped_column(String(32), default="collateral")
    # The full verification document (inventory, results, damages, documents, report).
    state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Override(Base):
    """Append-only audit of assessor overrides and inventory edits (never updated or deleted)."""

    __tablename__ = "overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    target: Mapped[str] = mapped_column(String(24), default="")  # item | damage | document | edit
    ref: Mapped[str] = mapped_column(String(64), default="")  # ornament id or document number
    item: Mapped[str] = mapped_column(String(120))
    original: Mapped[str] = mapped_column(String(255), default="")
    new_value: Mapped[str] = mapped_column(Text, default="")
    justification: Mapped[str] = mapped_column(Text)
    ts: Mapped[str] = mapped_column(String(40))


class AgentLog(Base):
    __tablename__ = "agent_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(32), index=True)
    agent: Mapped[str] = mapped_column(String(48))
    steps: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------- reporting
class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    account_number: Mapped[str] = mapped_column(String(64), index=True, default="")
    customer_name: Mapped[str] = mapped_column(String(200), default="")
    scenario: Mapped[str] = mapped_column(String(64), default="")
    date: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[str] = mapped_column(String(40))  # ISO string with local offset
    overall_status: Mapped[str] = mapped_column(String(16), default="pass")
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    counts: Mapped[dict] = mapped_column(JSONB, default=dict)

    images: Mapped[list["RunImage"]] = relationship(cascade="all, delete-orphan", order_by="RunImage.id")


class RunImage(Base):
    __tablename__ = "run_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # collateral | damage | document
    asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    filename: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(16), default="pass")
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)


# --------------------------------------------------------------------------- binary + config
class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    content_type: Mapped[str] = mapped_column(String(64), default="application/octet-stream")
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    aws_enabled: Mapped[dict] = mapped_column(JSONB, default=dict)
    blocker_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    max_ornaments_per_image: Mapped[int] = mapped_column(Integer, default=12)
    foreign_object_threshold_pct: Mapped[int] = mapped_column(Integer, default=10)
    doc_match_threshold_pct: Mapped[int] = mapped_column(Integer, default=80)
    # Pledge valuation: materials → purity grades (fineness %, rate/g) and LTV %.
    valuation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    weight_tolerance_g: Mapped[float] = mapped_column(Float, default=0.10)
    purity_tolerance_pct: Mapped[float] = mapped_column(Float, default=0.5)
    damage_deduction: Mapped[str] = mapped_column(String(16), default="tenths")

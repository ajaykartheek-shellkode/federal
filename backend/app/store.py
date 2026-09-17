"""Persistence for assets, validation runs, reporting and agent logs (PostgreSQL).

Run records keep the shape the v1 screens already consume (``id, created_at, date, loan,
overall_status, summary, collateral_images, damage_images, documents, counts``); v2 adds
``issues`` on each image entry so reports can show *why* something failed.
"""

from __future__ import annotations

import re
from datetime import date as date_cls
from datetime import timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy import delete, select

from app.db import models as M
from app.db.base import session_scope

# analysis kind -> the three categories the bank wants counted
KINDS = ("collateral", "damage", "document")
STATUSES = ("pass", "alert", "fail")

_ASSET_ID = re.compile(r"^[0-9a-f]{32}$")


# --------------------------------------------------------------------------- assets
def save_asset(data: bytes, content_type: str) -> str:
    """Persist bytes in the assets table; return the asset id."""
    with session_scope() as db:
        asset = M.Asset(content_type=(content_type or "application/octet-stream")[:64], data=data)
        db.add(asset)
        db.flush()
        return asset.id


def load_asset(asset_id: str) -> Optional[Tuple[bytes, str]]:
    """Return (bytes, content_type) for an asset id, or None."""
    if not asset_id or not _ASSET_ID.match(asset_id):
        return None
    with session_scope() as db:
        asset = db.get(M.Asset, asset_id)
        if asset is None:
            return None
        return bytes(asset.data), asset.content_type


# --------------------------------------------------------------------------- runs
def save_run(record: dict) -> None:
    """Persist a run. A run with the same session_id replaces the previous one (report re-generation)."""
    loan = record.get("loan") or {}
    with session_scope() as db:
        if record.get("session_id"):
            db.execute(delete(M.Run).where(M.Run.session_id == record["session_id"]))
        run = M.Run(
            id=record["id"],
            session_id=record.get("session_id"),
            account_number=loan.get("account_number", ""),
            customer_name=loan.get("customer_name", ""),
            scenario=loan.get("scenario", ""),
            date=date_cls.fromisoformat(record["date"]),
            created_at=record["created_at"],
            overall_status=record.get("overall_status", "pass"),
            summary=record.get("summary", {}),
            counts=record.get("counts", {}),
        )
        for e in record.get("collateral_images", []):
            run.images.append(M.RunImage(
                kind="collateral", asset_id=e.get("asset_id"), filename=e.get("filename", ""),
                status=e.get("status", "pass"), meta={"index": e.get("index"), "issues": e.get("issues", [])},
            ))
        for e in record.get("damage_images", []):
            run.images.append(M.RunImage(
                kind="damage", asset_id=e.get("asset_id"), filename=e.get("filename", ""),
                status=e.get("status", "pass"),
                meta={
                    "ornament_id": e.get("ornament_id"), "ornament_name": e.get("ornament_name"),
                    "described_damage": e.get("described_damage"), "issues": e.get("issues", []),
                    "overridden": bool(e.get("overridden")),
                },
            ))
        for e in record.get("documents", []):
            run.images.append(M.RunImage(
                kind="document", asset_id=e.get("asset_id"), filename=e.get("filename", ""),
                status=e.get("status", "pass"),
                meta={
                    "doc_no": e.get("doc_no"), "doc_type": e.get("doc_type"), "issues": e.get("issues", []),
                    "content_type": e.get("content_type", ""), "overridden": bool(e.get("overridden")),
                },
            ))
        db.add(run)


def _run_to_dict(run: M.Run) -> dict:
    """Reconstruct the record shape the frontends expect."""
    collateral_images, damage_images, documents = [], [], []
    for im in run.images:
        m = im.meta or {}
        issues = m.get("issues", [])
        if im.kind == "collateral":
            collateral_images.append({
                "index": m.get("index", 0), "asset_id": im.asset_id, "filename": im.filename,
                "status": im.status, "issues": issues,
            })
        elif im.kind == "damage":
            damage_images.append({
                "ornament_id": m.get("ornament_id", ""), "ornament_name": m.get("ornament_name", ""),
                "asset_id": im.asset_id, "status": im.status, "described_damage": m.get("described_damage", ""),
                "issues": issues, "overridden": bool(m.get("overridden")),
            })
        elif im.kind == "document":
            documents.append({
                "doc_no": m.get("doc_no", 0), "doc_type": m.get("doc_type", ""), "asset_id": im.asset_id,
                "filename": im.filename, "status": im.status, "issues": issues,
                "content_type": m.get("content_type", ""), "overridden": bool(m.get("overridden")),
            })
    return {
        "id": run.id,
        "session_id": run.session_id,
        "created_at": run.created_at,
        "date": run.date.isoformat(),
        "loan": {"account_number": run.account_number, "customer_name": run.customer_name, "scenario": run.scenario},
        "overall_status": run.overall_status,
        "summary": run.summary or {},
        "collateral_images": collateral_images,
        "damage_images": damage_images,
        "documents": documents,
        "counts": _normalize_counts(run.counts or {}),
    }


def list_runs(date: Optional[str] = None, account: Optional[str] = None, since: Optional[str] = None) -> List[dict]:
    """Runs filtered by date (YYYY-MM-DD), start date and/or loan account, newest first."""
    with session_scope() as db:
        stmt = select(M.Run)
        if date:
            stmt = stmt.where(M.Run.date == date_cls.fromisoformat(date))
        if since:
            stmt = stmt.where(M.Run.date >= date_cls.fromisoformat(since))
        if account:
            stmt = stmt.where(M.Run.account_number == account)
        stmt = stmt.order_by(M.Run.created_at.desc())
        return [_run_to_dict(r) for r in db.scalars(stmt).all()]


def list_dates() -> List[str]:
    with session_scope() as db:
        rows = db.execute(select(M.Run.date).distinct().order_by(M.Run.date.desc())).all()
        return [r[0].isoformat() for r in rows]


def _empty_counts() -> Dict[str, Dict[str, int]]:
    return {k: {s: 0 for s in STATUSES} for k in KINDS}


def _normalize_counts(counts: dict) -> Dict[str, Dict[str, int]]:
    out = _empty_counts()
    for kind in KINDS:
        for status in STATUSES:
            out[kind][status] = int((counts.get(kind) or {}).get(status, 0) or 0)
    return out


def _rollup(runs: List[dict]) -> Dict[str, Dict[str, int]]:
    totals = _empty_counts()
    for r in runs:
        for kind in KINDS:
            for status in STATUSES:
                totals[kind][status] += r["counts"][kind][status]
    return totals


def account_summary(account: str) -> dict:
    runs = list_runs(account=account)
    return {"account": account, "run_count": len(runs), "counts": _rollup(runs), "runs": runs}


def daily_summary(date: str) -> dict:
    runs = list_runs(date=date)
    return {"date": date, "run_count": len(runs), "counts": _rollup(runs), "runs": runs}


def overview(days: int, today: date_cls) -> dict:
    """Per-day run outcomes for the last ``days`` days plus totals and the recent runs."""
    start = today - timedelta(days=days - 1)
    runs = list_runs(since=start.isoformat())
    per_day = {(start + timedelta(days=i)).isoformat(): {"runs": 0, "pass": 0, "alert": 0, "fail": 0} for i in range(days)}
    for r in runs:
        bucket = per_day.get(r["date"])
        if bucket is not None:
            bucket["runs"] += 1
            if r["overall_status"] in STATUSES:
                bucket[r["overall_status"]] += 1
    totals = {"runs": len(runs), **{s: sum(1 for r in runs if r["overall_status"] == s) for s in STATUSES}}
    return {
        "days": [{"date": d, **v} for d, v in per_day.items()],
        "totals": totals,
        "counts": _rollup(runs),
        "runs": runs,
    }


# --------------------------------------------------------------------------- agent logs
def save_agent_log(session_id: str, agent: str, steps: list) -> None:
    with session_scope() as db:
        db.add(M.AgentLog(session_id=session_id, agent=agent, steps=steps))

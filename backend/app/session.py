"""Live verification sessions — one JSONB document per session in PostgreSQL.

The document mirrors the TDD data model (inventory, collateral results, damages,
documents, overrides/audit, report). Callers load a dict, mutate it through
``app.workflow`` helpers and ``save`` it back. Per-session asyncio locks serialise
workflow steps so a double-click can never run two steps on the same session at once.
"""

from __future__ import annotations

import asyncio
import copy
import re
import weakref
from typing import List, Optional

from sqlalchemy import select

from app.db import models as M
from app.db.base import session_scope

_SESSION_ID = re.compile(r"^[0-9a-f]{32}$")
# Weak values: a lock lives only while a request holds it, so unknown ids can't grow this map.
_locks: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()


class ConflictError(RuntimeError):
    """The session was changed by another request since it was loaded."""


def valid_id(session_id: Optional[str]) -> bool:
    return bool(session_id) and bool(_SESSION_ID.match(session_id or ""))


def create(state: dict) -> str:
    """Insert a new session row for ``state`` (which must not yet have an id); returns the id."""
    with session_scope() as db:
        row = M.WorkSession()
        db.add(row)
        db.flush()
        state["session_id"] = row.id
        _apply(row, state)
        return row.id


def load(session_id: Optional[str]) -> Optional[dict]:
    """Return the session document, or None for unknown ids and pre-v2 sessions without state."""
    if not valid_id(session_id):
        return None
    with session_scope() as db:
        row = db.get(M.WorkSession, session_id)
        if row is None or not row.state:
            return None
        return copy.deepcopy(row.state)


def save(state: dict, audit_entry: Optional[dict] = None) -> None:
    """Persist the document (and optionally one audit row) in a single transaction.

    Optimistic concurrency: the row is locked and its ``rev`` must equal the revision this
    state was loaded with, so concurrent writers (e.g. several API workers) can't lose updates.
    """
    with session_scope() as db:
        row = db.get(M.WorkSession, state["session_id"], with_for_update=True)
        if row is None:
            row = M.WorkSession(id=state["session_id"])
            db.add(row)
        elif row.state and int(row.state.get("rev", 0)) != int(state.get("rev", 0)):
            raise ConflictError("This verification was updated elsewhere. Reload to see the latest state.")
        new_rev = int(state.get("rev", 0)) + 1
        _apply(row, {**state, "rev": new_rev})
        if audit_entry is not None:
            db.add(M.Override(
                session_id=state["session_id"],
                target=audit_entry.get("target", ""),
                ref=str(audit_entry.get("ref", ""))[:64],
                item=str(audit_entry.get("item", ""))[:120],
                original=str(audit_entry.get("original", ""))[:255],
                new_value=str(audit_entry.get("new_value", "")),
                justification=audit_entry.get("justification", ""),
                ts=audit_entry.get("ts", ""),
            ))
    state["rev"] = new_rev  # only after the transaction committed


def _apply(row: M.WorkSession, state: dict) -> None:
    loan = state.get("loan") or {}
    row.account_number = loan.get("account_number", "")
    row.customer_id = loan.get("customer_id", "")
    row.customer_name = loan.get("customer_name", "")
    row.scenario = loan.get("scenario", "")
    row.branch = loan.get("branch", "")
    row.workflow_state = state.get("workflow_state", "collateral")
    # Assign a fresh copy so SQLAlchemy always detects the JSONB change.
    row.state = copy.deepcopy(state)


def list_recent(limit: int = 20, open_only: bool = True) -> List[dict]:
    """Most recently updated verification sessions (header fields only)."""
    with session_scope() as db:
        stmt = select(M.WorkSession).where(M.WorkSession.state.is_not(None))
        if open_only:
            stmt = stmt.where(M.WorkSession.workflow_state != "done")
        rows = db.scalars(stmt.order_by(M.WorkSession.updated_at.desc()).limit(limit)).all()
        return [
            {
                "session_id": r.id,
                "account_number": r.account_number,
                "customer_name": r.customer_name,
                "scenario": r.scenario,
                "workflow_state": r.workflow_state,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]


def lock_for(session_id: str) -> asyncio.Lock:
    lock = _locks.get(session_id)
    if lock is None:
        lock = _locks[session_id] = asyncio.Lock()
    return lock

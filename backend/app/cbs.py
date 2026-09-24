"""CBS (core banking) customer source — backed by PostgreSQL seed data.

A fresh gold loan starts as an application, so there is no loan account yet: ``find_customer``
looks the customer up by CIF, mobile or ID proof (and still accepts an account number, which is
how a renewal or a release starts). It returns ``{loan_context, rate_table, ornaments}``; the
ornaments are legacy v1 data and are ignored by the conversational flow.
"""

from __future__ import annotations

from typing import List, Optional

from sqlalchemy import func, select

from app import store
from app.db import models as M
from app.db.base import session_scope

# A customer the branch onboards at the counter has no loan yet, so the application reference
# stands in for the account number until one is issued.
NEW_CUSTOMER_PREFIX = "APP-"


def normalize_account(account: Optional[str]) -> str:
    return "".join((account or "").split()).upper()


def digits_of(value: Optional[str]) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _rate_table(db) -> dict:
    return {r.carat: r.rate_per_gram for r in db.scalars(select(M.GoldRate)).all()}


def _serialize(cust: M.Customer, rate_table: dict) -> dict:
    return {
        "loan_context": {
            "account_number": cust.account_number,
            "customer_id": cust.customer_id,
            "customer_name": cust.customer_name,
            "mobile": cust.mobile or "",
            "scenario": cust.scenario,
            "branch": cust.branch,
            "id_number": cust.id_number,
            "address": cust.address,
        },
        "rate_table": rate_table,
        "ornaments": [
            {
                "id": o.ref,
                "name": o.name,
                "carat": o.carat,
                "weight_gm": o.weight_gm,
                "quantity": o.quantity,
                "damage_visible": o.damage_visible,
                "damage_count": o.damage_count,
                "damage_details": o.damage_details,
                "damage_percent": o.damage_percent,
                "material": o.material or "gold",
            }
            for o in cust.ornaments
        ],
    }


def find_customer(query: Optional[str]) -> Optional[dict]:
    """Find the customer by loan account, CIF, mobile or ID proof. None when nothing matches."""
    wanted = normalize_account(query)
    digits = digits_of(query)
    if not wanted:
        return None
    with session_scope() as db:
        cust = db.scalar(select(M.Customer).where(func.upper(M.Customer.account_number) == wanted))
        if cust is None:
            cust = db.scalar(select(M.Customer).where(func.upper(M.Customer.customer_id) == wanted))
        if cust is None and len(digits) >= 10:
            # Mobile numbers and ID proofs are stored with spaces, so compare on digits only.
            cust = next(
                (r for r in db.scalars(select(M.Customer)).all()
                 if digits_of(r.mobile) == digits or digits_of(r.id_number) == digits),
                None,
            )
        if cust is None:
            return None
        return _serialize(cust, _rate_table(db))


def fetch_customer(account_number: Optional[str] = None, strict: bool = False) -> Optional[dict]:
    """Return {loan_context, rate_table, ornaments} for an account.

    Non-strict: unknown/blank accounts fall back to the first seeded customer (legacy v1).
    Strict: None when the account does not exist.
    """
    wanted = normalize_account(account_number)
    with session_scope() as db:
        cust = None
        if wanted:
            cust = db.scalar(select(M.Customer).where(func.upper(M.Customer.account_number) == wanted))
        if cust is None and not strict:
            cust = db.scalars(select(M.Customer).order_by(M.Customer.id)).first()
        if cust is None:
            return None
        return _serialize(cust, _rate_table(db))


def create_customer(
    *,
    name: str,
    mobile: str,
    id_number: str,
    address: str,
    branch: str,
    application_no: str,
) -> dict:
    """Onboard a walk-in customer into CBS and return them in ``find_customer`` shape."""
    with session_scope() as db:
        cust = M.Customer(
            account_number=application_no,  # replaced by the loan account once it is issued
            customer_id=f"CBS{store.next_sequence('customer'):06d}",
            customer_name=" ".join((name or "").split())[:200],
            mobile=" ".join((mobile or "").split())[:24],
            scenario="Fresh Loan",
            branch=branch,
            id_number=" ".join((id_number or "").split())[:64],
            address=" ".join((address or "").split())[:500],
        )
        db.add(cust)
        db.flush()
        return _serialize(cust, _rate_table(db))


def attach_account(customer_id: str, account_number: str) -> bool:
    """Record the issued loan account against a customer onboarded at the counter."""
    with session_scope() as db:
        cust = db.scalar(select(M.Customer).where(M.Customer.customer_id == customer_id))
        if cust is None or not (cust.account_number or "").startswith(NEW_CUSTOMER_PREFIX):
            return False  # seeded customers keep the account they already have
        cust.account_number = account_number
        return True


def sample_accounts(limit: int = 4) -> List[dict]:
    """A few customers to suggest when a lookup fails (demo convenience)."""
    with session_scope() as db:
        rows = db.scalars(select(M.Customer).where(M.Customer.account_number.like("GL%")).order_by(M.Customer.id).limit(limit)).all()
        return [
            {
                "account_number": r.account_number,
                "customer_id": r.customer_id,
                "mobile": r.mobile,
                "customer_name": r.customer_name,
                "scenario": r.scenario,
            }
            for r in rows
        ]

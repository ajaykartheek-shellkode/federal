"""Create tables, apply additive migrations, and seed CBS reference data (idempotent).

Run directly:   python -m app.db.init_db
On startup:     init_db.ensure()   (called from the FastAPI lifespan)
"""

from __future__ import annotations

import logging

from sqlalchemy import select, text

from app.db import models as M
from app.db.base import Base, engine, session_scope
from app.auth import hash_password
from app.db.seed_data import CUSTOMERS, GOLD_RATES, RETIRED_ACCOUNTS, USERS
from app.settings import Settings

logger = logging.getLogger("glportal.db")

# Additive, idempotent schema changes for databases created by earlier versions.
# create_all() only creates missing tables, it never alters existing ones.
_MIGRATIONS = [
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS branch VARCHAR(120) NOT NULL DEFAULT ''",
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS state JSONB",
    "ALTER TABLE overrides ADD COLUMN IF NOT EXISTS target VARCHAR(24) NOT NULL DEFAULT ''",
    "ALTER TABLE overrides ADD COLUMN IF NOT EXISTS ref VARCHAR(64) NOT NULL DEFAULT ''",
    "ALTER TABLE overrides ADD COLUMN IF NOT EXISTS new_value TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE overrides ALTER COLUMN original TYPE VARCHAR(255)",
    "CREATE INDEX IF NOT EXISTS ix_runs_session_id ON runs (session_id)",
    "ALTER TABLE ornaments ADD COLUMN IF NOT EXISTS material VARCHAR(24) NOT NULL DEFAULT 'gold'",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS valuation JSONB",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS weight_tolerance_g DOUBLE PRECISION NOT NULL DEFAULT 0.1",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS purity_tolerance_pct DOUBLE PRECISION NOT NULL DEFAULT 0.5",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS damage_deduction VARCHAR(16) NOT NULL DEFAULT 'tenths'",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile VARCHAR(24) NOT NULL DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS ix_customers_mobile ON customers (mobile)",
    "CREATE INDEX IF NOT EXISTS ix_customers_customer_id ON customers (customer_id)",
]


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


def migrate() -> None:
    with engine.begin() as conn:
        for stmt in _MIGRATIONS:
            conn.execute(text(stmt))


def seed() -> dict:
    """Insert reference data / default settings only where missing. Returns a summary."""
    added = {"customers": 0, "kyc_backfilled": 0, "gold_rates": 0, "users": 0, "retired": 0, "settings": False}
    with session_scope() as db:
        for carat, rate in GOLD_RATES.items():
            if not db.get(M.GoldRate, carat):
                db.add(M.GoldRate(carat=carat, rate_per_gram=rate))
                added["gold_rates"] += 1

        for c in CUSTOMERS:
            existing = db.scalar(select(M.Customer).where(M.Customer.account_number == c["account_number"]))
            if existing:
                # Backfill KYC fields added after the row was first seeded.
                if not existing.id_number and c.get("id_number"):
                    existing.id_number = c["id_number"]
                    existing.address = c.get("address", existing.address)
                    added["kyc_backfilled"] += 1
                if not existing.mobile and c.get("mobile"):
                    existing.mobile = c["mobile"]
                continue
            cust = M.Customer(
                account_number=c["account_number"],
                customer_id=c["customer_id"],
                customer_name=c["customer_name"],
                mobile=c.get("mobile", ""),
                scenario=c["scenario"],
                branch=c["branch"],
                id_number=c.get("id_number", ""),
                address=c.get("address", ""),
            )
            for i, o in enumerate(c["ornaments"]):
                cust.ornaments.append(
                    M.Ornament(
                        seq=i, ref=o["ref"], name=o["name"], carat=o["carat"],
                        weight_gm=o["weight_gm"], quantity=o["quantity"],
                        damage_visible=o["damage_visible"], damage_count=o["damage_count"],
                        damage_details=o["damage_details"], damage_percent=o["damage_percent"],
                        material=o.get("material", "gold"),
                    )
                )
            db.add(cust)
            added["customers"] += 1

        for u in USERS:
            if db.scalar(select(M.User).where(M.User.email == u["email"])):
                continue
            db.add(M.User(
                email=u["email"], name=u["name"], role=u["role"], branch=u["branch"],
                password_hash=hash_password(u["password"]),
            ))
            added["users"] += 1

        # Customers seeded by an earlier version that are no longer part of the demo set.
        for account in RETIRED_ACCOUNTS:
            stale = db.scalar(select(M.Customer).where(M.Customer.account_number == account))
            if stale is not None:
                db.delete(stale)
                added["retired"] += 1

        row = db.get(M.Setting, 1)
        if row is None:
            defaults = Settings()
            db.add(M.Setting(id=1, **{**defaults.model_dump(exclude={"valuation"}), "valuation": defaults.valuation.model_dump()}))
            added["settings"] = True
        elif row.valuation is None:
            row.valuation = Settings().valuation.model_dump()  # rates added after this row was created
    return added


def ensure() -> None:
    """Idempotent startup hook: create tables, migrate, seed."""
    create_tables()
    migrate()
    summary = seed()
    logger.info("Database ready: %s", summary)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ensure()
    print("Database ready.")

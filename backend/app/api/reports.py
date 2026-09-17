"""Reporting routes (pass / alert / fail by date and by loan account).

  GET /api/reports/dates                     -> dates that have runs, newest first
  GET /api/reports/daily?date=YYYY-MM-DD     -> runs + rolled-up counts for a date
  GET /api/reports/account?account=...       -> runs + rolled-up counts for a loan account
  GET /api/reports/overview?days=7           -> per-day outcomes, totals and runs for a window
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app import cbs, store

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _parse_date(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


@router.get("/dates")
async def report_dates():
    return {"dates": await asyncio.to_thread(store.list_dates)}


@router.get("/daily")
async def report_daily(date: Optional[str] = None):
    if date:
        if _parse_date(date) is None:
            return JSONResponse(status_code=400, content={"error": "date must be YYYY-MM-DD"})
    else:
        dates = await asyncio.to_thread(store.list_dates)
        date = dates[0] if dates else datetime.now().strftime("%Y-%m-%d")
    return await asyncio.to_thread(store.daily_summary, date)


@router.get("/account")
async def report_account(account: str = Query(..., min_length=1, max_length=64)):
    return await asyncio.to_thread(store.account_summary, cbs.normalize_account(account))


@router.get("/overview")
async def report_overview(days: int = Query(7, ge=1, le=90)):
    return await asyncio.to_thread(store.overview, days, datetime.now().date())

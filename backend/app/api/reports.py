"""Reporting routes (pass / alert / fail by date and by loan account).

  GET /api/reports/dates                     -> dates that have runs, newest first
  GET /api/reports/daily?date=YYYY-MM-DD     -> runs + rolled-up counts for a date
  GET /api/reports/account?account=...       -> runs + rolled-up counts for a loan account
  GET /api/reports/overview?days=7           -> per-day outcomes, totals and runs for a window
  GET /api/reports/session/{id}/pdf          -> the verification report as a PDF file (download)
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from app import cbs
from app import session as session_store
from app import store
from app.report_pdf import build_report_pdf
from app.settings import get_settings
from app.workflow import state as S

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


@router.get("/session/{session_id}/pdf")
async def report_pdf(session_id: str, inline: bool = False):
    """The finished verification report as a PDF file (same content as the printable page)."""
    if not session_store.valid_id(session_id):
        return JSONResponse(status_code=404, content={"error": "This verification session was not found."})
    state = await asyncio.to_thread(session_store.load, session_id)
    if state is None:
        return JSONResponse(status_code=404, content={"error": "This verification session was not found."})
    if not state.get("report"):
        return JSONResponse(status_code=409, content={"error": "The report for this verification hasn't been generated yet."})

    settings = await asyncio.to_thread(get_settings)
    view = S.view(state, settings)
    pdf = await asyncio.to_thread(build_report_pdf, view)
    disposition = "inline" if inline else "attachment"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{view["report"]["report_id"]}.pdf"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/overview")
async def report_overview(days: int = Query(7, ge=1, le=90)):
    return await asyncio.to_thread(store.overview, days, datetime.now().date())

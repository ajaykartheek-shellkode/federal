"""Verification report as a real PDF file (ReportLab), mirroring the on-screen A4 report.

``build_report_pdf(view)`` takes the client view of a finished session (``workflow.state.view``,
so KYC values are already masked) and returns PDF bytes:

    letterhead · recommendation + KPIs · review points · customer & loan · collateral verification
    · weight, purity & pledge valuation · damage assessment · document verification · audit trail
    · declaration with signature blocks, and a page footer on every page.

Layout constants live at the top so the document stays consistent with the web report's
Federal Bank styling (royal blue, gold, deep ink greys).
"""

from __future__ import annotations

import io
import logging
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app import store

logger = logging.getLogger("glportal.report_pdf")

BRAND = colors.HexColor("#004E96")
NAVY = colors.HexColor("#082461")
GOLD = colors.HexColor("#FAA619")
GOLD_DEEP = colors.HexColor("#B26E00")
CREAM = colors.HexColor("#FFF6E7")
INK = colors.HexColor("#15223A")
INK_2 = colors.HexColor("#35404F")
INK_MUTED = colors.HexColor("#58647A")
LINE = colors.HexColor("#E3E8F0")
LINE_SOFT = colors.HexColor("#F0F3F8")
SUBTLE = colors.HexColor("#F7F9FC")
OK = colors.HexColor("#0E9258")
OK_SOFT = colors.HexColor("#E6F5EE")
WARN = colors.HexColor("#C26A00")
WARN_SOFT = colors.HexColor("#FFF3E0")
BAD = colors.HexColor("#D0342C")
BAD_SOFT = colors.HexColor("#FDEDEC")
BRAND_SOFT = colors.HexColor("#EEF4FB")

PAGE_W, PAGE_H = A4
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 15 * mm, 14 * mm, 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

TONE_COLORS = {
    "ok": (OK_SOFT, OK),
    "warn": (WARN_SOFT, WARN),
    "bad": (BAD_SOFT, BAD),
    "brand": (BRAND_SOFT, BRAND),
    "neutral": (SUBTLE, INK_MUTED),
    "gold": (colors.HexColor("#FFF1D6"), GOLD_DEEP),
}

RESULT_TONE = {"pass": ("Passed", "ok"), "alert": ("Review", "warn"), "fail": ("Failed", "bad"), "not_checked": ("Not checked", "neutral")}
ITEM_TONE = {
    "detected": ("From photo", "ok"),
    "manual": ("Added", "brand"),
}
MEASURE_TONE = {
    "match": ("Assayed", "ok"),
    "weight_mismatch": ("Weight differs", "warn"),
    "ungraded": ("Below grades", "warn"),
    "mismatch": ("Weight & purity", "warn"),
    "missing": ("No reading", "bad"),
    "pending": ("Not measured", "neutral"),
}
DAMAGE_RULE = {
    "tenths": "damage 10 → 1% deduction",
    "percent": "damage 10 → 10% deduction",
    "none": "no damage deduction",
}


# --------------------------------------------------------------------------- text helpers
def _style(name: str, size: float, leading: float, color=INK_2, bold: bool = False, **kw) -> ParagraphStyle:
    return ParagraphStyle(
        name, fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size, leading=leading, textColor=color, **kw
    )


S_TITLE = _style("title", 15, 18, INK, bold=True)
S_SUB = _style("sub", 8.5, 11, INK_MUTED)
S_META = _style("meta", 8.5, 12, INK_MUTED, alignment=TA_RIGHT)
S_META_STRONG = _style("metaStrong", 9.5, 12, INK, bold=True, alignment=TA_RIGHT)
S_SECTION = _style("section", 9.5, 12, BRAND, bold=True)
S_BODY = _style("body", 8.8, 12)
S_BODY_SM = _style("bodySm", 8, 10.5)
S_MUTED = _style("muted", 8, 10.5, INK_MUTED)
S_TH = _style("th", 6.8, 9, INK_MUTED, bold=True)
S_TD = _style("td", 8, 10.5, INK_2)
S_TD_STRONG = _style("tdStrong", 8, 10.5, INK, bold=True)
S_TD_RIGHT = _style("tdRight", 8, 10.5, INK_2, alignment=TA_RIGHT)
S_TD_RIGHT_STRONG = _style("tdRightStrong", 8, 10.5, INK, bold=True, alignment=TA_RIGHT)
S_KPI = _style("kpi", 12.5, 14, INK, bold=True, alignment=TA_CENTER)
S_KPI_LABEL = _style("kpiLabel", 6.5, 9, INK_MUTED, alignment=TA_CENTER)


def inr(amount) -> str:
    """Indian-grouped rupees: 512340 → Rs 5,12,340 (Helvetica has no rupee glyph)."""
    n = int(round(float(amount or 0)))
    digits = str(abs(n))
    if len(digits) > 3:
        head, groups = digits[:-3], []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join(([head] if head else []) + groups) + "," + digits[-3:]
    return ("-" if n < 0 else "") + "Rs " + digits


def grams(value) -> str:
    return f"{float(value or 0):,.2f} g"


def _delta(value: float) -> str:
    return f"{value:+.2f} g".replace("+0.00 g", "0.00 g")


def purity_label(row: dict) -> str:
    carat = str(row.get("carat") or "")
    if not carat:
        return "-"
    return f"{carat}K" if (row.get("material", "gold") == "gold" and carat.replace(".", "", 1).isdigit()) else carat


def _date(iso: str) -> str:
    from datetime import datetime

    try:
        return datetime.fromisoformat(iso).strftime("%d %b %Y, %I:%M %p")
    except (TypeError, ValueError):
        return iso or "-"


def _pill(text: str, tone: str, width: Optional[float] = None) -> Table:
    """A small status chip sized to its text (or to ``width`` when it sits in a table column)."""
    bg, fg = TONE_COLORS.get(tone, TONE_COLORS["neutral"])
    cell = Paragraph(text.upper(), _style("pill", 6.5, 8.5, fg, bold=True, alignment=TA_CENTER))
    width = width or max(16 * mm, 3.1 * mm + 1.45 * mm * len(text))
    table = Table([[cell]], colWidths=[width], rowHeights=[5.2 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def _asset_image(asset_id: Optional[str], width: float, height: float) -> Optional[Image]:
    """Load a stored asset and scale it to cover the box (JPEG/PNG/WebP via Pillow)."""
    if not asset_id:
        return None
    found = store.load_asset(asset_id)
    if not found:
        return None
    data, _content_type = found
    try:
        from PIL import Image as PILImage

        with PILImage.open(io.BytesIO(data)) as img:
            img = img.convert("RGB")
            ratio = max(width / img.width, height / img.height)
            box = (max(1, int(img.width * ratio)), max(1, int(img.height * ratio)))
            img = img.resize(box, PILImage.LANCZOS)
            left, top = (img.width - width) / 2, (img.height - height) / 2
            img = img.crop((int(left), int(top), int(left + width), int(top + height)))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=82)
    except Exception:  # noqa: BLE001 — a missing thumbnail must never break the report
        logger.warning("Could not render asset %s into the PDF", asset_id)
        return None
    return Image(io.BytesIO(buf.getvalue()), width=width, height=height)


def _table(rows: List[list], widths: List[float], extra: Optional[list] = None, header: bool = True) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6 * mm),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE_SOFT),
    ]
    if header:
        style += [("LINEBELOW", (0, 0), (-1, 0), 0.7, LINE), ("BACKGROUND", (0, 0), (-1, 0), SUBTLE)]
    if extra:
        style += extra
    table.setStyle(TableStyle(style))
    return table


def _section(number: int, title: str) -> Table:
    badge = Table([[Paragraph(str(number), _style("n", 7, 9, colors.white, bold=True, alignment=TA_CENTER))]],
                  colWidths=[5 * mm], rowHeights=[5 * mm])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRAND),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    head = Table([[badge, Paragraph(title.upper(), S_SECTION)]], colWidths=[7 * mm, CONTENT_W - 7 * mm], hAlign="LEFT")
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6 * mm),
        ("LINEBELOW", (0, 0), (-1, -1), 0.7, LINE),
    ]))
    return head


# --------------------------------------------------------------------------- blocks
def _letterhead(view: dict) -> Table:
    report, loan = view["report"], view["loan"]
    left = [
        Paragraph("Federal Bank", _style("brand", 15, 17, BRAND, bold=True)),
        Spacer(1, 1.5 * mm),
        Paragraph("Gold Loan Collateral Verification Report", S_TITLE),
        Paragraph("AI-assisted validation · GL Portal", S_SUB),
    ]
    right = [
        Paragraph(report["report_id"], S_META_STRONG),
        Paragraph(_date(report["generated_at"]), S_META),
        Paragraph(f"Branch {loan.get('branch') or '-'}", S_META),
    ]
    head = Table([[left, right]], colWidths=[CONTENT_W * 0.62, CONTENT_W * 0.38], hAlign="LEFT")
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ("LINEBELOW", (0, 0), (-1, -1), 1.6, BRAND),
    ]))
    return head


def _verdict(view: dict) -> Table:
    report, stats = view["report"], view["report"]["stats"]
    weight = report.get("weight") or view.get("weight") or {}
    valuation = report.get("valuation") or view.get("valuation") or {}
    totals = valuation.get("totals") or {}
    proceed = report["recommendation"] == "PROCEED"
    warnings = sum(1 for r in report["reasons"] if r["level"] == "warn")
    accent, background = (OK, OK_SOFT) if proceed else (GOLD, CREAM)

    kpis = [
        (str(stats["items"]), "Ornaments"),
        (grams(stats.get("total_weight")), "Weight entered"),
        (f"{stats.get('measured', 0)}/{stats['items']}", "Assayed"),
        (inr(totals.get("pledge_amount", stats.get("pledge_amount", 0))), "Pledge (provisional)" if totals.get("is_estimate") else "Pledge amount"),
    ]
    kpi_table = Table(
        [[Paragraph(v, S_KPI) for v, _ in kpis], [Paragraph(l, S_KPI_LABEL) for _, l in kpis]],
        colWidths=[CONTENT_W * 0.145] * 4,
    )
    kpi_table.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 1), ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (0, -1), 0.6 * mm),
    ]))

    left = [
        Paragraph("RECOMMENDATION", _style("rl", 6.8, 9, INK_MUTED, bold=True)),
        Paragraph(report["recommendation"], _style("rec", 20, 22, OK if proceed else GOLD_DEEP, bold=True)),
        Paragraph(
            "All checks satisfied." if proceed else f"{warnings} point(s) for the approving officer.",
            _style("recSub", 8, 11, INK_2),
        ),
    ]
    box = Table([[left, kpi_table]], colWidths=[CONTENT_W * 0.41, CONTENT_W * 0.59], hAlign="LEFT")
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("LINEBEFORE", (0, 0), (0, -1), 3.5, accent),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5 * mm),
    ]))
    return box


def _reasons(view: dict) -> List:
    reasons = view["report"]["reasons"]
    if not reasons:
        return []
    rows = [
        [Paragraph("•", _style("dot", 9, 11, WARN if r["level"] == "warn" else BRAND, bold=True)), Paragraph(r["text"], S_BODY)]
        for r in reasons
    ]
    table = Table(rows, colWidths=[4 * mm, CONTENT_W - 4 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0.8 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 0.8 * mm),
    ]))
    return [Spacer(1, 3 * mm), table]


def _customer(view: dict) -> Table:
    loan, stats = view["loan"], view["report"]["stats"]
    valuation = view["report"].get("valuation") or view.get("valuation") or {}
    totals = valuation.get("totals") or {}
    pledge = inr(totals.get("pledge_amount", stats.get("pledge_amount", 0))) + (" (estimate)" if totals.get("is_estimate") else "")
    pairs = [
        ("Customer", loan.get("customer_name", "")),
        ("Loan account", loan.get("account_number", "")),
        ("Customer ID", loan.get("customer_id", "")),
        ("Scenario", loan.get("scenario", "")),
        ("Branch", loan.get("branch", "")),
        ("ID proof", loan.get("id_number_masked", "") or "-"),
        ("Pledge amount", pledge),
        ("AI validation", "Enabled" if view.get("ai_enabled", True) else "Disabled (manual)"),
        ("Enforcement", "Blocker" if view["settings"]["blocker_mode"] else "Alert"),
        ("Generated", _date(view["report"]["generated_at"])),
    ]
    rows = []
    for i in range(0, len(pairs), 2):
        left_k, left_v = pairs[i]
        right_k, right_v = pairs[i + 1] if i + 1 < len(pairs) else ("", "")
        rows.append([
            Paragraph(left_k, S_MUTED), Paragraph(str(left_v) or "-", S_TD_STRONG),
            Paragraph(right_k, S_MUTED), Paragraph(str(right_v) or "-", S_TD_STRONG),
        ])
    table = Table(rows, colWidths=[CONTENT_W * 0.16, CONTENT_W * 0.34, CONTENT_W * 0.16, CONTENT_W * 0.34], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * mm),
    ]))
    return table


def _collateral(view: dict) -> List:
    flow: List = []
    images = view["collateral"]["images"]
    if images:
        cells, captions = [], []
        for im in images[:5]:
            picture = _asset_image(im["asset_id"], 32 * mm, 24 * mm)
            cells.append(picture or Paragraph("No image", S_MUTED))
            scale = (im.get("scale") or {}).get("weight_g")
            label = f"Photo {im['index'] + 1}"
            if scale:
                label += f" · scale {grams(scale)}"
            captions.append([Paragraph(label, S_MUTED), _pill(*RESULT_TONE.get(im["status"], RESULT_TONE["not_checked"]))])
        strip = Table([cells, [Table([c], colWidths=[18 * mm, 14 * mm], hAlign="LEFT",
                                     style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                                       ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
                               for c in captions]],
                      colWidths=[34 * mm] * len(cells), hAlign="LEFT")
        strip.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (0, 0), 1.2 * mm),
        ]))
        flow += [strip, Spacer(1, 3 * mm)]

    header = [Paragraph(h, S_TH) for h in ("", "Ornament", "Purity", "Weight entered", "Qty", "Listed", "Damage")]
    rows = [header]
    for it in view["inventory"]:
        damage = next((d for d in view["damages"] if d["ornament_id"] == it["id"]), None)
        if damage:
            label, tone = ("Overridden", "brand") if damage.get("overridden") else RESULT_TONE.get(damage["status"], RESULT_TONE["not_checked"])
            chip = _pill(label, tone, width=22 * mm)
        elif it.get("cbs_damage"):
            chip = _pill(*(("CBS waived", "neutral") if it.get("cbs_damage_waived") else ("Not recorded", "warn")), width=22 * mm)
        else:
            chip = Paragraph("-", S_TD)
        thumb = _asset_image(it.get("thumb_asset_id"), 7 * mm, 7 * mm)
        rows.append([
            thumb or Paragraph("", S_TD),
            Paragraph(it["name"], S_TD_STRONG),
            Paragraph(purity_label(it), S_TD),
            Paragraph(grams(it["weight_gm"]), S_TD),
            Paragraph(str(it["quantity"]), S_TD),
            _pill(*ITEM_TONE.get(it.get("origin", "detected"), ITEM_TONE["detected"]), width=24 * mm),
            chip,
        ])
    widths = [10 * mm, CONTENT_W - 118 * mm, 20 * mm, 22 * mm, 12 * mm, 28 * mm, 26 * mm]
    flow.append(_table(rows, widths))
    return flow


def _weight_section(view: dict) -> List:
    report = view["report"]
    weight = report.get("weight") or view.get("weight")
    valuation = report.get("valuation") or view.get("valuation")
    if not weight or not valuation:
        return []
    totals = valuation["totals"]

    def tile(label: str, value: str, caption: str) -> Table:
        inner = Table([[Paragraph(label.upper(), _style("tl", 6.5, 9, INK_MUTED, bold=True))],
                       [Paragraph(value, _style("tv", 12, 14, INK, bold=True))],
                       [Paragraph(caption, _style("tc", 7, 9.5, INK_MUTED))]], colWidths=[CONTENT_W / 3 - 3 * mm])
        inner.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("TOPPADDING", (0, 0), (0, 0), 2 * mm), ("BOTTOMPADDING", (0, -1), (-1, -1), 2 * mm),
            ("TOPPADDING", (0, 1), (-1, -1), 0.4 * mm), ("BOTTOMPADDING", (0, 0), (-1, -2), 0.4 * mm),
        ]))
        return inner

    device = weight.get("device") or {}
    source = weight.get("scale_source")
    scale_caption = (
        "Read from the machine photo" if source == "photo"
        else "Entered by the assessor" if source == "assessor" else "Not captured"
    )
    tiles = Table([[
        tile("Entered per item", grams(weight["entered_g"]), f"{report['stats']['items']} ornaments"),
        tile("Weighing machine", grams(weight["scale_g"]) if weight.get("scale_g") is not None else "-", scale_caption),
        tile("CaratMeter total", grams(weight["measured_g"]) if weight.get("measured_g") is not None else "-",
             f"{device.get('model') or 'CaratMeter'} · {device.get('device_id') or '-'}"),
    ]], colWidths=[CONTENT_W / 3] * 3, hAlign="LEFT")
    tiles.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    status = weight.get("scale_status")
    if status == "match":
        recon = f"the machine agrees with the entered weights (±{grams(weight['tolerance_g'])})"
    elif status == "mismatch":
        recon = f"the machine differs from the entered weights by {grams(abs(weight.get('scale_diff_g') or 0))} (tolerance ±{grams(weight['tolerance_g'])})"
    else:
        recon = "no weighing-machine total captured"
    if weight.get("scale_overridden"):
        recon += " — accepted by the assessor"

    header = [Paragraph(h, S_TH) for h in ("Ornament", "Weight entered", "CaratMeter assay", "Diff wt", "Reading", "Rate/g", "LTV", "Pledge")]
    rows = [header]
    for it in view["inventory"]:
        valued = next((v for v in valuation["items"] if v["ornament_id"] == it["id"]), None)
        m = it.get("measurement")
        status_key = it.get("measurement_status") or "pending"
        label, tone = ("Accepted", "brand") if it.get("measurement_overridden") else MEASURE_TONE.get(status_key, MEASURE_TONE["pending"])
        chip = _pill(label, tone, width=23 * mm)
        rows.append([
            Paragraph(it["name"], S_TD_STRONG),
            Paragraph(grams(it["weight_gm"]), S_TD),
            Paragraph(f"{m['grade'] or 'Ungraded'} ({m['fineness_pct']:.2f}%) · {grams(m['weight_g'])}" if m else "-", S_TD),
            Paragraph(_delta(m["weight_g"] - it["weight_gm"]) if m else "-", S_TD),
            chip,
            Paragraph(inr(valued["rate_per_gram"]) if valued else "-", S_TD_RIGHT),
            Paragraph(f"{valued['ltv_pct']:g}%" if valued else "-", S_TD_RIGHT),
            Paragraph(inr(valued["pledge_amount"]) if valued else "-", S_TD_RIGHT_STRONG),
        ])
    widths = [CONTENT_W - 149 * mm, 24 * mm, 38 * mm, 14 * mm, 25 * mm, 17 * mm, 10 * mm, 21 * mm]

    margin = max(0, totals["gross_value"] - totals["pledge_amount"] - totals["damage_deduction"])
    money = Table([
        [Paragraph("Gross value", S_MUTED), Paragraph(inr(totals["gross_value"]), S_TD_RIGHT)],
        [Paragraph("Less LTV margin", S_MUTED), Paragraph("-" + inr(margin), S_TD_RIGHT)],
        [Paragraph("Less damage deduction", S_MUTED), Paragraph("-" + inr(totals["damage_deduction"]), S_TD_RIGHT)],
        [Paragraph("Pledge amount", _style("pl", 9.5, 12, BRAND, bold=True)),
         Paragraph(inr(totals["pledge_amount"]), _style("pv", 9.5, 12, BRAND, bold=True, alignment=TA_RIGHT))],
    ], colWidths=[36 * mm, 28 * mm], hAlign="RIGHT")
    money.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0.8 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 0.8 * mm),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, LINE),
    ]))
    note = Paragraph(
        "Valued on the weight entered for each ornament at the rate for the purity the CaratMeter assayed × the "
        f"material LTV, less the damage deduction ({DAMAGE_RULE.get(valuation.get('damage_deduction_mode'), 'per settings')}). "
        + ("Some ornaments are not assayed yet, so the total is provisional. " if totals["is_estimate"] else "")
        + "Rates as configured when the verification started. Indicative — not a sanction.",
        _style("note", 7, 9.5, INK_MUTED),
    )
    footer = Table([[note, money]], colWidths=[CONTENT_W - 72 * mm, 72 * mm], hAlign="LEFT")
    footer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (0, 0), "BOTTOM"), ("VALIGN", (1, 0), (1, 0), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 8 * mm), ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    return [
        tiles,
        Spacer(1, 2.5 * mm),
        Paragraph(f"<b>Reconciliation:</b> {recon}", S_BODY),
        Spacer(1, 2 * mm),
        _table(rows, widths),
        footer,
    ]


def _damages(view: dict) -> List:
    flow: List = []
    for d in view["damages"]:
        thumb = _asset_image(d.get("thumb_asset_id") or d.get("asset_id"), 14 * mm, 14 * mm)
        lines = [Paragraph(
            f"{d['item']} · {d['type']} <font color='#58647A'>(assessor: {d['severity']})</font>", S_TD_STRONG)]
        if d.get("assessor_details"):
            lines.append(Paragraph(f"Recorded: {d['assessor_details']}", S_BODY_SM))
        if d.get("observed"):
            severity = f" · {d['assessed_severity']}" if d.get("assessed_severity") and d["assessed_severity"] != "none" else ""
            lines.append(Paragraph(f"AI observed: {'; '.join(d['observed'])}{severity}", S_BODY_SM))
        if d.get("notes"):
            lines.append(Paragraph(d["notes"], S_MUTED))
        chip = _pill("Overridden", "brand") if d.get("overridden") else _pill(*RESULT_TONE.get(d["status"], RESULT_TONE["not_checked"]))
        row = Table([[thumb or Paragraph("", S_TD), lines, chip]],
                    colWidths=[16 * mm, CONTENT_W - 16 * mm - 26 * mm, 26 * mm], hAlign="LEFT")
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.6, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ]))
        flow += [row, Spacer(1, 2 * mm)]
    return flow


def _documents(view: dict) -> List:
    docs = (view.get("documents") or {}).get("items", [])
    if not docs:
        return [Paragraph("No documents uploaded.", S_BODY)]
    header = [Paragraph(h, S_TH) for h in ("Document", "Detected", "Legible", "Name", "ID number", "Address", "Result")]
    rows = [header]
    for d in docs:
        checked = d["status"] != "not_checked"
        matches = d.get("matches") or {}
        rows.append([
            Paragraph(d["declared_type"], S_TD_STRONG),
            Paragraph((d.get("doc_type_detected") or "-") if checked else "-", S_TD),
            Paragraph(("Yes" if d.get("legible") else "No") if checked else "-", S_TD),
            Paragraph(("Match" if matches.get("name") else "No match") if checked else "-", S_TD),
            Paragraph(("Match" if matches.get("id") else "No match") if checked else "-", S_TD),
            Paragraph(f"{matches.get('address_pct', 0)}%" if checked else "-", S_TD),
            _pill("Overridden", "brand", width=22 * mm) if d.get("overridden")
            else _pill(*RESULT_TONE.get(d["status"], RESULT_TONE["not_checked"]), width=22 * mm),
        ])
    widths = [CONTENT_W - 30 * mm - 18 * mm - 24 * mm - 24 * mm - 20 * mm - 26 * mm, 30 * mm, 18 * mm, 24 * mm, 24 * mm, 20 * mm, 26 * mm]
    return [_table(rows, widths)]


def _audit(view: dict) -> List:
    entries = view["audit"]
    if not entries:
        return []
    header = [Paragraph(h, S_TH) for h in ("Time", "Item", "Change", "Justification")]
    rows = [header]
    for a in entries:
        rows.append([
            Paragraph(_date(a["ts"]), S_MUTED),
            Paragraph(a["item"], S_TD_STRONG),
            Paragraph(f"{a['original']} → {a['new_value']}", S_BODY_SM),
            Paragraph(a["justification"], S_TD),
        ])
    widths = [30 * mm, 32 * mm, 54 * mm, CONTENT_W - 116 * mm]
    return [_table(rows, widths)]


def _declaration(view: dict) -> List:
    loan = view["loan"]

    def pad(role: str, detail: str) -> Table:
        box = Table([[Paragraph("", S_TD)]], colWidths=[CONTENT_W / 2 - 4 * mm], rowHeights=[18 * mm])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("BACKGROUND", (0, 0), (-1, -1), SUBTLE)]))
        wrap = Table([[Paragraph(role.upper(), _style("sr", 6.8, 9, INK_MUTED, bold=True))], [box],
                      [Paragraph(detail, S_MUTED)]], colWidths=[CONTENT_W / 2 - 4 * mm])
        wrap.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 1 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return wrap

    pads = Table([[pad("Branch assessor", f"Branch {loan.get('branch') or '-'}"),
                   pad("Authorising officer", f"Account {loan.get('account_number', '')}")]],
                 colWidths=[CONTENT_W / 2, CONTENT_W / 2], hAlign="LEFT")
    pads.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 4 * mm),
        ("LEFTPADDING", (1, 0), (1, 0), 4 * mm), ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [
        Paragraph(
            "I confirm that the collateral and documents recorded above were verified in my presence. AI validation is "
            "advisory; the final assessment and this authorisation are made by the branch officials named below.",
            S_BODY,
        ),
        Spacer(1, 3 * mm),
        pads,
    ]


# --------------------------------------------------------------------------- document
def _page_furniture(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN_X, MARGIN_BOTTOM - 4 * mm, PAGE_W - MARGIN_X, MARGIN_BOTTOM - 4 * mm)
    canvas.setFont("Helvetica", 6.8)
    canvas.setFillColor(INK_MUTED)
    canvas.drawString(MARGIN_X, MARGIN_BOTTOM - 8 * mm,
                      "Federal Bank · GL Portal · AI-assisted validation on Amazon Bedrock · Advisory only")
    canvas.drawRightString(PAGE_W - MARGIN_X, MARGIN_BOTTOM - 8 * mm, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


def build_report_pdf(view: dict) -> bytes:
    """Render the finished verification (client view with a report) as PDF bytes."""
    if not view.get("report"):
        raise ValueError("This verification has no report yet.")

    buffer = io.BytesIO()
    doc = BaseDocTemplate(
        buffer, pagesize=A4, leftMargin=MARGIN_X, rightMargin=MARGIN_X, topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOTTOM,
        title=f"{view['report']['report_id']} — Gold Loan Collateral Verification Report",
        author="Federal Bank · GL Portal", subject=f"Account {view['loan'].get('account_number', '')}",
    )
    frame = Frame(MARGIN_X, MARGIN_BOTTOM, CONTENT_W, PAGE_H - MARGIN_TOP - MARGIN_BOTTOM, id="body",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=_page_furniture)])

    number = 0

    def section(title: str, blocks: List) -> List:
        """Heading + its blocks; the heading never sits alone at the foot of a page."""
        nonlocal number
        number += 1
        head = _section(number, title)
        return [KeepTogether([head, blocks[0]]), *blocks[1:]] if blocks else [head]

    flow: List = [_letterhead(view), Spacer(1, 4 * mm), _verdict(view), *_reasons(view)]
    flow += section("Customer & loan", [_customer(view)])
    flow += section("Collateral verification", _collateral(view))
    weight_flow = _weight_section(view)
    if weight_flow:
        flow += section("Weight, purity & pledge valuation", weight_flow)
    if view["damages"]:
        flow += section("Damage assessment", _damages(view))
    flow += section("Document verification", _documents(view))
    audit_flow = _audit(view)
    if audit_flow:
        flow += section("Override & correction audit trail", audit_flow)
    number += 1
    flow += [KeepTogether([Spacer(1, 5 * mm), _section(number, "Declaration & authorisation"), *_declaration(view)])]

    doc.build(flow)
    return buffer.getvalue()


__all__ = ["build_report_pdf", "PageBreak"]

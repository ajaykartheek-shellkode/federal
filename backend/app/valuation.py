"""Loan valuation — pure functions.

The loan amount follows the branch's weight chain, not a per-purity price list:

    gross weight   = what the ornaments weigh (the weighing-machine total, apportioned per piece)
    wastage        = a fixed percentage of the gross weight (solder, stones, impurities)
    net weight     = gross − wastage
    max loan       = net weight × the rate per gram

The rate and the wastage percentage come from Settings and are captured into the session when it
starts, so a later change never moves a verification already in progress. Purity still comes from
the Karatometer and is shown per ornament, but it does not price the loan.
"""

from __future__ import annotations

from typing import Dict, List, Optional


def material_config(valuation: dict, key: str) -> Optional[dict]:
    return next((m for m in valuation.get("materials", []) if m["key"] == key), None)


def norm_grade(grade: str) -> str:
    """Canonical purity token: "22k" / "22K" / " 22 " → "22"; "925" stays "925"."""
    return str(grade or "").strip().upper().rstrip("K").strip()


def grade_by_name(material: Optional[dict], name: Optional[str]) -> Optional[dict]:
    if not material or not name:
        return None
    return next((g for g in material["grades"] if g["grade"] == name), None)


def declared_grade(material: Optional[dict], carat: str) -> Optional[dict]:
    """The grade matching the CBS carat value ("22" → 22K, "925" → 925)."""
    if not material:
        return None
    want = norm_grade(carat)
    return next((g for g in material["grades"] if norm_grade(g["grade"]) == want), None)


def fineness_for_declared(material_key: str, carat: str) -> float:
    """Nominal fineness % implied by a declared purity (used by the Karatometer simulator)."""
    try:
        value = float(norm_grade(carat))
    except ValueError:
        return 0.0
    if material_key == "gold" or value <= 24:
        return round(value / 24 * 100, 2)
    return round(value / 10, 2)  # millesimal fineness, e.g. 925 → 92.5 %


def grade_for_fineness(material: Optional[dict], fineness_pct: float, tolerance_pct: float) -> Optional[dict]:
    """Highest configured grade the measured fineness satisfies (within the tolerance margin)."""
    if not material:
        return None
    for grade in sorted(material["grades"], key=lambda g: g["fineness_pct"], reverse=True):
        if fineness_pct + tolerance_pct >= grade["fineness_pct"]:
            return grade
    return None


def wastage_pct_of(valuation: dict) -> float:
    try:
        return max(0.0, min(100.0, float(valuation.get("wastage_pct", 3.0))))
    except (TypeError, ValueError):
        return 3.0


def rate_per_gram_of(valuation: dict) -> float:
    try:
        return max(0.0, float(valuation.get("rate_per_gram", 8500)))
    except (TypeError, ValueError):
        return 8500.0


def net_of(gross_g: float, wastage_pct: float) -> float:
    return round(max(0.0, float(gross_g)) * (1 - wastage_pct / 100), 3)


def value_item(item: dict, valuation: dict) -> dict:
    """One ornament's share of the chain: gross weight, its wastage, and the net weight left."""
    material = material_config(valuation, item.get("material", "gold"))
    measured = item.get("measurement")
    gross = round(float(item.get("weight_gm") or 0), 3)
    # Purity is the Karatometer's; a correction by the assessor is honoured when it is graded.
    grade = grade_by_name(material, measured.get("grade")) if measured else None
    if grade is None:
        grade = declared_grade(material, item.get("carat", ""))

    wastage_pct = wastage_pct_of(valuation)
    net = net_of(gross, wastage_pct)
    rate = rate_per_gram_of(valuation)
    return {
        "ornament_id": item["id"],
        "name": item["name"],
        "material": (material or {}).get("name", item.get("material", "")),
        "grade": grade["grade"] if grade else None,
        "gross_weight_g": gross,
        "wastage_g": round(gross - net, 3),
        "net_weight_g": net,
        "measured": bool(measured),
        "rate_per_gram": rate,
        "loan_amount": round(net * rate),
        "unpriced": grade is None,
    }


def value_inventory(inventory: List[dict], valuation: dict) -> Dict:
    items = [value_item(i, valuation) for i in inventory]
    # Without a Karatometer reading for every item the purity column is still provisional.
    measured = bool(inventory) and all(i.get("measurement") for i in inventory)
    wastage_pct = wastage_pct_of(valuation)
    rate = rate_per_gram_of(valuation)
    gross = round(sum(i["gross_weight_g"] for i in items), 3)
    net = net_of(gross, wastage_pct)
    return {
        "items": items,
        "totals": {
            "gross_weight_g": gross,
            "wastage_pct": wastage_pct,
            "wastage_g": round(gross - net, 3),
            "net_weight_g": net,
            "rate_per_gram": rate,
            "max_loan_amount": round(net * rate),
            # Kept under its original name so past runs in Reports and History still read.
            "pledge_amount": round(net * rate),
            "is_estimate": not measured,
            "unpriced": [i["name"] for i in items if i["unpriced"]],
        },
    }

"""Pledge valuation — pure functions, driven entirely by the configured valuation table.

For each ornament:
    weight basis   = measured CaratMeter weight (declared CBS weight until measured → estimate)
    purity grade   = grade assessed from the measured fineness (declared grade until measured)
    gross value    = weight × rate per gram of that material + grade
    eligible       = gross value × LTV % of the material
    damage         = eligible × CBS damage % deduction (mode: "tenths" | "percent" | "none")
    pledge amount  = eligible − damage

Nothing here is hard-coded per material: materials, grades, rates and LTV all come from
Settings (captured into the session when it starts).
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
    """Nominal fineness % implied by a declared purity (used by the CaratMeter simulator)."""
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


def damage_retained(damage_percent: float, mode: str) -> float:
    """Fraction of value retained after the CBS damage deduction."""
    pct = max(0.0, float(damage_percent or 0))
    if mode == "percent":
        return max(0.0, 1 - pct / 100)
    if mode == "tenths":
        return max(0.0, 1 - pct / 1000)  # client sketch: damage 10 → 1 % reduction
    return 1.0


def value_item(item: dict, valuation: dict) -> dict:
    material = material_config(valuation, item.get("material", "gold"))
    measured = item.get("measurement")
    if measured:
        weight = float(measured["weight_g"])
        grade = grade_by_name(material, measured.get("grade"))
    else:
        weight = float(item.get("weight_gm") or 0)
        grade = declared_grade(material, item.get("carat", ""))

    rate = float(grade["rate_per_gram"]) if grade else 0.0
    ltv = float(material["ltv_pct"]) if material else 0.0
    gross = weight * rate
    eligible_before = gross * ltv / 100
    retained = damage_retained(item.get("damage_percent", 0), valuation.get("damage_deduction", "tenths"))
    pledge = eligible_before * retained
    return {
        "ornament_id": item["id"],
        "name": item["name"],
        "material": (material or {}).get("name", item.get("material", "")),
        "grade": grade["grade"] if grade else None,
        "weight_g": round(weight, 3),
        "weight_basis": "measured" if measured else "declared",
        "rate_per_gram": rate,
        "gross_value": round(gross),
        "ltv_pct": ltv,
        "damage_percent": float(item.get("damage_percent") or 0),
        "damage_deduction": round(eligible_before - pledge),
        "pledge_amount": round(pledge),
        "unpriced": grade is None,
    }


def value_inventory(inventory: List[dict], valuation: dict) -> Dict:
    items = [value_item(i, valuation) for i in inventory]
    measured = bool(inventory) and all(i.get("measurement") for i in inventory)
    return {
        "items": items,
        "totals": {
            "weight_g": round(sum(i["weight_g"] for i in items), 3),
            "gross_value": sum(i["gross_value"] for i in items),
            "damage_deduction": sum(i["damage_deduction"] for i in items),
            "pledge_amount": sum(i["pledge_amount"] for i in items),
            "is_estimate": not measured,
            "unpriced": [i["name"] for i in items if i["unpriced"]],
        },
        "damage_deduction_mode": valuation.get("damage_deduction", "tenths"),
    }

"""Loan-eligibility computation — single source of truth (mirrored in frontend/lib/loan.ts).

Derived from the client sketch example:
    Ring, weight 4 gm, today's rate 8500/gm, damage 10%  ->  eligible 33660
    base = 4 * 8500 = 34000
    34000 -> 33660 is a 1% reduction, i.e. a damage input of 10 maps to a 1% cut.

So the sketch's "damage percent" behaves like TENTHS of a percent, not a direct
percentage (reduction = damage_percent / 10 / 100). This is almost certainly a
business rule to confirm with the bank; real gold-loan haircuts are usually a direct
percentage or an LTV cap. The interpretation is isolated in DAMAGE_DIVISOR so it can be
switched to a direct percentage (DAMAGE_DIVISOR = 1) after confirmation.
"""

from __future__ import annotations

# Set to 1 for a direct-percentage interpretation of the damage input.
DAMAGE_DIVISOR = 10


def compute_eligible_loan(weight_gm: float, rate_per_gram: float, damage_percent: float) -> int:
    base = weight_gm * rate_per_gram
    reduction_fraction = (damage_percent / DAMAGE_DIVISOR) / 100
    return round(base * (1 - reduction_fraction))

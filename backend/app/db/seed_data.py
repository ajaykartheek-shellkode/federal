"""Seed reference data: staff logins, gold rates, and the five CBS customers.

All names, mobile numbers, ID numbers and addresses are fictional demo data. A customer is
found by mobile number at the start of a journey; the ornaments held here are legacy v1 data
(the pledge list is built from the collateral photo) and are kept only for the v1 screen.
"""

from __future__ import annotations

GOLD_RATES = {"24": 9200, "22": 8500, "18": 6900, "14": 5400}


def _orn(ref, name, carat, weight, qty=1, dmg=False, dcount=0, ddetails="", dpct=0, material="gold"):
    return {
        "ref": ref, "name": name, "carat": carat, "weight_gm": weight, "quantity": qty,
        "damage_visible": dmg, "damage_count": dcount, "damage_details": ddetails, "damage_percent": dpct,
        "material": material,
    }


CUSTOMERS = [
    {
        "account_number": "GL2024001234",
        "mobile": "98200 41234",
        "customer_id": "CBS100234",
        "customer_name": "Rajesh Kumar",
        "scenario": "Fresh Loan",
        "branch": "FED-MUM-001",
        "id_number": "2337 4600 1234",
        "address": "12 MG Road, Fort, Mumbai, Maharashtra 400001",
        "ornaments": [
            _orn("chain-1", "Gold Chain", "22", 18),
            _orn("chain-2", "Gold Chain", "22", 15),
            _orn("chain-3", "Gold Chain", "22", 12),
            _orn("bangle-1", "Gold Bangle", "22", 20, dmg=True, dcount=1,
                 ddetails="Dent on inner rim", dpct=8),
            _orn("bangle-2", "Gold Bangle", "22", 10),
            _orn("ring-1", "Gold Ring", "18", 5),
            _orn("ring-2", "Gold Ring", "18", 5),
            _orn("ring-3", "Gold Ring", "18", 5, dmg=True, dcount=1,
                 ddetails="Light surface scratch on band", dpct=4),
        ],
    },
    {
        "account_number": "GL2024001189",
        "mobile": "98111 55190",
        "customer_id": "CBS100189",
        "customer_name": "Priya Sharma",
        "scenario": "Renewal",
        "branch": "FED-DEL-007",
        "id_number": "4821 7730 5519",
        "address": "44 Lajpat Nagar II, New Delhi, Delhi 110024",
        "ornaments": [
            _orn("necklace-1", "Gold Necklace", "22", 32),
            _orn("earring-1", "Gold Earrings", "22", 6, qty=2),
            _orn("bangle-1", "Gold Bangle", "22", 18),
        ],
    },
    {
        "account_number": "GL2024001156",
        "mobile": "99099 41156",
        "customer_id": "CBS100156",
        "customer_name": "Arjun Patel",
        "scenario": "Fresh Loan",
        "branch": "FED-AMD-003",
        "id_number": "6190 2248 7730",
        "address": "7 CG Road, Navrangpura, Ahmedabad, Gujarat 380009",
        "ornaments": [
            _orn("coin-1", "Gold Coin", "24", 8, qty=4),
            _orn("chain-1", "Gold Chain", "22", 22),
            _orn("bracelet-1", "Gold Bracelet", "22", 14, dmg=True, dcount=1,
                 ddetails="Clasp bent, difficult to close", dpct=6),
            _orn("ring-1", "Gold Ring", "18", 6),
        ],
    },
    {
        "account_number": "GL2024001142",
        "mobile": "90000 21142",
        "customer_id": "CBS100142",
        "customer_name": "Meena Devi",
        "scenario": "Security Operations",
        "branch": "FED-HYD-002",
        "id_number": "3075 9912 4468",
        "address": "21 Banjara Hills Road No. 3, Hyderabad, Telangana 500034",
        "ornaments": [
            _orn("anklet-1", "Gold Anklet", "22", 28, qty=2),
            _orn("ring-1", "Gold Ring", "22", 5),
        ],
    },
    {
        "account_number": "GL2024001098",
        "mobile": "94470 31098",
        "customer_id": "CBS100098",
        "customer_name": "Suresh Nair",
        "scenario": "Fresh Loan",
        "branch": "FED-COK-006",
        "id_number": "7714 3350 2296",
        "address": "5 Marine Drive, Ernakulam, Kochi, Kerala 682031",
        "ornaments": [
            _orn("chain-1", "Gold Chain", "22", 20),
            _orn("pendant-1", "Gold Pendant", "22", 8),
            _orn("bangle-1", "Gold Bangle", "22", 16),
            _orn("bangle-2", "Gold Bangle", "22", 16),
            _orn("ring-1", "Gold Ring", "18", 4),
            _orn("ring-2", "Gold Ring", "18", 4),
        ],
    },
]


# Customers seeded by earlier versions that are no longer part of the demo set. ``init_db``
# removes these rows so every environment shows the same five.
RETIRED_ACCOUNTS = ["10056100070317", "GL2024001067", "GL2024001210"]

# Branch staff who can sign in to the portal. Passwords are hashed on first seed; changing one
# here does not change an account that already exists.
USERS = [
    {
        "email": "assessor@federalbank.co.in",
        "name": "Divya Raghavan",
        "role": "Branch assessor",
        "branch": "FED-MUM-001",
        "password": "Federal@2026",
    },
    {
        "email": "officer@federalbank.co.in",
        "name": "Nikhil Menon",
        "role": "Gold loan officer",
        "branch": "FED-DEL-007",
        "password": "Federal@2026",
    },
    {
        "email": "manager@federalbank.co.in",
        "name": "Farida Sheikh",
        "role": "Branch manager",
        "branch": "FED-COK-006",
        "password": "Federal@2026",
    },
]

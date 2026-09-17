"""Seed CBS reference data: gold rates + customers with pledged-ornament inventories.

Each account number returns a distinct record. All names, ID numbers and addresses are
fictional demo data. The original demo customer (10056100070317, Ring + Chain) is kept.
Ornaments carry a material (gold by default; Lakshmi Iyer also pledges silver) whose purity
grade is the CBS "carat" value (e.g. "22" → 22K gold, "925" → sterling silver).
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
        "account_number": "10056100070317",
        "customer_id": "23374600",
        "customer_name": "CIUQXGZGZXFZ D M",
        "scenario": "Fresh Loan",
        "branch": "FED-BLR-014",
        "ornaments": [
            _orn("ring-1", "Ring", "22", 4, dmg=True, dcount=1,
                 ddetails="Crack in the head and one stone missing", dpct=10),
            _orn("chain-1", "Chain", "22", 24),
        ],
    },
    {
        "account_number": "GL2024001189",
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
    {
        "account_number": "GL2024001067",
        "customer_id": "CBS100067",
        "customer_name": "Kavitha Rao",
        "scenario": "Renewal",
        "branch": "FED-CHN-009",
        "id_number": "5582 6601 9043",
        "address": "18 Cathedral Road, Gopalapuram, Chennai, Tamil Nadu 600086",
        "ornaments": [
            _orn("necklace-1", "Gold Necklace", "22", 40),
            _orn("earring-1", "Gold Earrings", "22", 7, qty=2),
        ],
    },
    {
        "account_number": "GL2024001210",
        "customer_id": "CBS100210",
        "customer_name": "Lakshmi Iyer",
        "scenario": "Fresh Loan",
        "branch": "FED-TVM-004",
        "id_number": "8843 1127 6605",
        "address": "3 Vazhuthacaud, Thiruvananthapuram, Kerala 695014",
        "ornaments": [
            _orn("chain-1", "Gold Chain", "22", 20),
            _orn("coin-1", "Gold Coin", "24", 10),
            _orn("anklet-1", "Silver Anklet", "925", 64, qty=2, material="silver"),
        ],
    },
]

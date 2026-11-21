#!/usr/bin/env python3
"""The older PERM files' wage request: its number, the prevailing wage, its level and its dates (sweep item 1).

DOL's headers, read from the files on Nov 21 2026: FY2016 to FY2019 print PW_TRACK_NUM, PW_LEVEL_9089, PW_AMOUNT_9089
(FY2019 as "65,520.00"), PW_UNIT_OF_PAY_9089, PW_DETERM_DATE and PW_EXPIRE_DATE (FY2016 as spreadsheet day numbers,
FY2019 as "10/17/2017"); FY2020 to FY2023 print PW_TRACK_NUMBER, PW_SKILL_LEVEL, PW_WAGE, PW_UNIT_OF_PAY,
PW_DETERMINATION_DATE and PW_EXPIRATION_DATE. The numbers are DOL's pre-2020 form (P10019059473403), kept as printed.
A year with no offered-wage column still takes the prevailing wage as its wage, as it always has.

Run:  python3 scripts/test_perm_history_pw.py
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ingest_perm_disclosure as ipd  # noqa: E402
import ingest_perm_history as h  # noqa: E402
from test_perm_history import workbook  # noqa: E402

FAILS: list[str] = []


def check(label: str, ok: bool) -> None:
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        FAILS.append(label)


def main() -> int:
    fy16 = workbook([
        ["CASE_NUMBER", "DECISION_DATE", "CASE_STATUS", "EMPLOYER_NAME", "WAGE_OFFER_FROM_9089",
         "WAGE_OFFER_UNIT_OF_PAY_9089", "PW_TRACK_NUM", "PW_LEVEL_9089", "PW_AMOUNT_9089", "PW_UNIT_OF_PAY_9089",
         "PW_DETERM_DATE", "PW_EXPIRE_DATE"],
        ["A-15001-00001", 42400, "Certified", "ACME INC", 350000, "Year", "P10014343361482", "Level III",
         "65,520.00", "Year", 42033, "06/30/2015"],
        ["A-15001-00002", 42401, "Denied", "ACME INC", 90000, "Year", "", "", "", "", "", ""],
    ])
    got = {r["caseNumber"]: r for r in h.parse_workbook(fy16, set())["rows"]}
    a = got.get("A-15001-00001", {})
    check(f"FY2016's names: the number as printed (got {a.get('pwNumber')})", a.get("pwNumber") == "P10014343361482")
    check(f"the prevailing wage read past its comma, a year's worth (got {a.get('pwWage')})", a.get("pwWage") == 65520.0)
    check(f"its level (got {a.get('pwLevel')})", a.get("pwLevel") == "Level III")
    check(f"a spreadsheet day number is a date (got {a.get('pwDetermined')})", a.get("pwDetermined") == "2015-01-29")
    check(f"a written date is a date (got {a.get('pwExpires')})", a.get("pwExpires") == "2015-06-30")
    check(f"the offered wage stays the offered wage (got {a.get('wage')})", a.get("wage") == 350000.0)
    b = got.get("A-15001-00002", {})
    check("blank wage request cells are no values, never zeros or empty strings",
          all(b.get(k) is None for k in ("pwNumber", "pwWage", "pwLevel", "pwDetermined", "pwExpires")))

    fy20 = workbook([
        ["CASE_NUMBER", "CASE_STATUS", "RECEIVED_DATE", "DECISION_DATE", "EMPLOYER_NAME", "WAGE_OFFER_FROM",
         "WAGE_OFFER_UNIT_OF_PAY", "PW_TRACK_NUMBER", "PW_SKILL_LEVEL", "PW_WAGE", "PW_UNIT_OF_PAY",
         "PW_DETERMINATION_DATE", "PW_EXPIRATION_DATE"],
        ["A-19001-00001", "Certified", "2019-06-01", "2020-03-01", "ACME INC", 31000, "Year", "P10019059473403",
         "Level I", 14.49, "Hour", 43627, 43717],
    ])
    c = h.parse_workbook(fy20, set())["rows"][0]
    check(f"FY2020's names: the number (got {c.get('pwNumber')})", c.get("pwNumber") == "P10019059473403")
    want = ipd.annual_wage("14.49", "Hour")
    check(f"an hourly prevailing wage is a year's worth by the site's one rule (got {c.get('pwWage')}, want {want})",
          want is not None and c.get("pwWage") == want)
    check(f"FY2020's level and dates (got {c.get('pwLevel')}, {c.get('pwDetermined')}, {c.get('pwExpires')})",
          c.get("pwLevel") == "Level I" and c.get("pwDetermined") == "2019-06-11" and c.get("pwExpires") == "2019-09-09")

    only_pw = workbook([
        ["CASE_NUMBER", "DECISION_DATE", "CASE_STATUS", "EMPLOYER_NAME", "PW_AMOUNT_9089", "PW_UNIT_OF_PAY_9089"],
        ["A-12001-00001", 41000, "Certified", "ACME INC", 70000, "Year"],
    ])
    d = h.parse_workbook(only_pw, set())["rows"][0]
    check(f"a year with no offered-wage column still takes the prevailing wage as its wage (got {d.get('wage')})",
          d.get("wage") == 70000.0)
    check(f"and records it as the prevailing wage too (got {d.get('pwWage')})", d.get("pwWage") == 70000.0)

    pw = ["pw_number", "pw_wage", "pw_level", "pw_determined", "pw_expires"]
    check(f"the five are stored columns, filled into existing rows by the narrow update (got {h.EXTRA[-5:]})",
          h.EXTRA[-5:] == pw and h.COLUMNS[-5:] == pw)
    t = h.row_tuple({**a, "employerName": "ACME INC", "attorneyName": ""}, {}, {})
    check(f"the row's tuple carries them last, in that order (got {t[-5:]})",
          t[-5:] == ("P10014343361482", 65520.0, "Level III", "2015-01-29", "2015-06-30"))
    added: dict[str, str] = {}

    class Stub:
        pass
    orig = h.add_missing_columns
    h.add_missing_columns = lambda db, table, cols: added.update(cols) or []
    try:
        h.ensure_columns(Stub())
    finally:
        h.add_missing_columns = orig
    check(f"the prevailing wage is a number column, the rest text (got {added.get('pw_wage')}, {added.get('pw_level')})",
          added.get("pw_wage") == "REAL" and added.get("pw_level") == "TEXT")
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

"""The reported-cases builder (scripts/build_reported_cases.py): how each stored source becomes merge records.

Every row here is made up. Run: python3 scripts/test_build_reported_cases.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_reported_cases as b  # noqa: E402


def sheet_row(**f) -> dict:
    base = {"source": "sfv-filers", "row_no": 1, "office": "SFV", "category": "EB-2", "chargeability": "row",
            "country": "Nigeria", "priority_date": "2023-02-01", "receipt_date": "2026-06-12",
            "biometrics_date": "2026-07-08", "transfer_date": "2026-09-24", "rfe": None, "approval_date": None,
            "card_date": None, "valid_as_of": "2026-11-10"}
    return {**base, **f}


def visa_row(**f) -> dict:
    base = {"row_no": 1, "petition": "EB-2 NIW", "priority_date": "2025-03-14", "service_center": "TSC",
            "premium": "after filing", "rfe_status": "RFE Received", "rfe_dates": json.dumps(["2025-06-01"]),
            "rfe_responded": "2025-07-15", "decision": "Approved", "decision_date": "2025-09-02",
            "chargeability": "IN", "created": "2025-03-20", "updated": "2025-09-03"}
    return {**base, **f}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    r = b.sheet_record(sheet_row())
    check(r["source"] == "sfv-filers" and r["key"] == "1", "a sheet row keeps its sheet and row")
    check(r["i485_receipt"] == "2026-06-12" and r["transfer"] == "2026-09-24", "its receipt and transfer days")
    check(r["chargeability"] == "Nigeria", "the country it names, which is rest of world")
    check(r.get("i485_decision") is None, "no approval day: no decision")
    r = b.sheet_record(sheet_row(approval_date="2026-11-03", card_date="2026-11-12", rfe="yes 2026-10-12"))
    check(r["i485_decision"] == "approved" and r["i485_decided"] == "2026-11-03", "an approval day is an approval")
    check(r["card"] == "2026-11-12" and r["i485_rfe_issued"] == "2026-10-12", "the card and the RFE's day")
    check(b.sheet_record(sheet_row(rfe="yes")).get("i485_rfe_issued") is None, "an RFE with no day gives no day")
    w = b.sheet_record(sheet_row(visa_availability="Visa available", visa_status="H1B"))
    check(w["visa_available"] is True and w["nonimmigrant_status"] == "H1B", "a visa available, and the status held")
    check(b.sheet_record(sheet_row(visa_availability="Approved"))["visa_available"] is None,
          "\"Approved\" says nothing about the visa number")
    check(b.sheet_record(sheet_row(visa_availability="Not available"))["visa_available"] is False, "not available")
    n = b.sheet_record(sheet_row(priority_date=None, priority_note="Current"))
    check(n["priority_note"] == "Current" and n["priority_date"] is None, "a priority date in words is kept as words")
    check(b.sheet_record(sheet_row(country=None, chargeability="india"))["chargeability"] == "India",
          "a sheet line with only its chargeability")

    v = b.visastats_record(visa_row())
    check(v["category"] == "EB-2 NIW" and v["center"] == "TSC" and v["premium"] is True, "the petition, centre, premium")
    check(v["i140_receipt"] == "2025-03-14", "a self-petition's priority date is its filing day")
    check(v["i140_rfe_issued"] == "2025-06-01" and v["i140_rfe_answered"] == "2025-07-15", "the RFE and its answer")
    check(v["i140_decision"] == "approved" and v["i140_decided"] == "2025-09-02", "the decision and its day")
    check(v["chargeability"] == "India", "IN is India")
    check(b.visastats_record(visa_row(petition="EB-2")).get("i140_receipt") is None,
          "an EB-2 through PERM: its priority date is the PERM day, never the I-140's")
    check(b.visastats_record(visa_row(petition="O-1A")) is None, "an O-1 isn't a green card case")
    check(b.visastats_record(visa_row(petition="")) is None, "a row with no petition is left out")
    check(b.visastats_record(visa_row(premium="none"))["premium"] is False, "premium not pursued")
    p = b.visastats_record(visa_row(decision="Pending", decision_date=None))
    check(p["i140_decision"] == "pending" and p.get("i140_decided") is None, "a pending petition has no decision day")
    check(b.visastats_record(visa_row(rfe_responded="Yes, sent"))["i140_rfe_answered"] is None,
          "an answer in words gives no day")
    check(b.visastats_record(visa_row(chargeability="IRN"))["chargeability"] == "Iran", "IRN is Iran")
    check(b.visastats_record(visa_row(chargeability="ROW"))["chargeability"] == "ROW", "ROW stays rest of world")

    # End to end: the sheet's row and a matching post are one case; VisaStats' rows are their own.
    post = {"source": "reddit", "key": "c1", "person": "h1", "as_of": "2026-11-04", "office": "SFV",
            "i485_receipt": "2026-06-12", "biometrics": "2026-07-08", "transfer": "2026-09-24",
            "i485_decision": "approved", "i485_decided": "2026-11-03"}
    cases, counts = b.build_cases({"sheets": [sheet_row(), sheet_row(row_no=2, receipt_date="2026-05-01")],
                                   "visastats": [visa_row(), visa_row(row_no=2, petition="O-1B")],
                                   "posts": [post]})
    check(len(cases) == 3, "two sheet rows and one VisaStats case: three cases")
    merged = next(c for c in cases if len(c["sources"]) == 2)
    check(merged["i485_decided"] == "2026-11-03" and merged["category"] == "EB-2", "the post's approval joined")
    check(counts == {"records": 4, "left_out": 1, "cases": 3, "people": 3, "merged": 1, "likely": 0,
                     "possible_dupes": 0}, f"the counts say what happened: {counts}")
    check(merged["as_of"] == "2026-11-10", "the case is as of its newest source's day")
    row = b.case_row(merged, 1)
    check(json.loads(row["source_names"]) == ["reddit", "sfv-filers"] and row["shows"] == 1, "the stored row")
    check(set(b.COLUMNS) == set(row), "the stored row has every column and nothing else")

    # The same cases read back from the database (every integer a string, a new build stamp) change no office.
    stored = [{k: (str(v) if isinstance(v, int) else v) for k, v in b.case_row(c, 1).items()} for c in cases]
    rebuilt = [b.case_row(c, 2) for c in cases]
    check(b.office_digests(stored) == b.office_digests(rebuilt), "a rebuild that changed nothing refreshes nothing")
    moved = [{**rebuilt[0], "transfer": "2026-09-30"}, *rebuilt[1:]]
    check(b.office_digests(moved)["SFV"] != b.office_digests(rebuilt)["SFV"], "a changed day refreshes its office")
    tl = b.post_record({"source": "timeline", "key": "t1", "checked": "1", "shows": "0", "transfer": "2026-01-02",
                        "card": None})
    check(tl["checked"] is True and tl["shows"] is False and "card" not in tl, "a stored 0 is false, a null is gone")

    # A bad row from one source is counted and left out, never allowed to stop the build.
    cases, counts = b.build_cases({"sheets": [sheet_row(), sheet_row(row_no=3, transfer_date="9/24/2026")]})
    check(len(cases) == 1 and counts["left_out"] == 1, "a row the merge can't read is left out and counted")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

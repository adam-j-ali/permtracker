"""The community sheet loader (scripts/ingest_community_sheets.py): what it reads, what it never keeps, what it refuses.

The fixture is synthetic: the San Fernando Filers sheet's own header row (Nov 19 2026) over made-up rows, so no
real person's username, receipt or dates sit in this public repository.
Run: python3 scripts/test_ingest_community_sheets.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ingest_community_sheets as cs  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = {"key": "sfv-filers", "name": "San Fernando Filers", "office": "SFV", "min_rows": 1}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    data = open(os.path.join(HERE, "fixtures", "community", "sfv_filers_synthetic.csv"), "rb").read()
    rows, counts = cs.parse_sheet(data, SHEET, "2026-11-19")
    check(len(rows) == 3 and counts["read"] == 3, "three cases read, the blank row passed over")
    text = repr(rows)
    check(not any(x in text for x in ("user_alpha1", "user-beta2", "user_gamma3", "IOE0936")),
          "no username and no receipt prefix in what is kept")
    a, b, c = rows
    check(a["category"] == "EB-3" and a["visa_status"] == "H1B",
          "Status is the category and Current Visa Status the visa held now, never one for the other")
    check(a["receipt_date"] == "2026-04-10" and a["transfer_date"] == "2026-06-06" and a["approval_date"] == "2026-07-25",
          "dates read as the sheet writes them")
    check(c["receipt_date"] == "2026-03-03", "a two-digit year reads as 20xx")
    check(a["silent_updates"] == '["2026-06-10", "2026-06-20", "2026-07-01"]',
          "silent updates written without a year land in the year between the receipt and the row's as-of day")
    check(a["fta0"] == "yes 2026-07-15" and a["fta1"] == "no" and b["fta0"] == "yes" and c["rfe"] == "yes 2026-11-03",
          "yes-or-no columns keep the answer and its day")
    check(b["priority_date"] is None and b["priority_note"] == "Current" and counts["priority_words"] == 1,
          "a priority date written in words is kept as words and counted")
    check(b["category"] == "EB-2 NIW" and b["chargeability"] == "row" and c["chargeability"] == "india",
          "categories and chargeability read the sheet's spellings")
    check(a["dependent"] == 0 and b["dependent"] == 1, "dependent reads yes and no in any case")
    check([r["row_no"] for r in rows] == [1, 2, 3] and all(r["office"] == "SFV" for r in rows),
          "rows numbered in the sheet's order, at the sheet's office")

    try:
        cs.parse_sheet(data, {**SHEET, "min_rows": 50}, "2026-11-19")
        check(False, "a sheet under its floor is refused")
    except cs.Refused:
        check(True, "a sheet under its floor is refused")
    renamed = data.replace(b"Approval", b"Approved on", 1)
    try:
        cs.parse_sheet(renamed, SHEET, "2026-11-19")
        check(False, "a sheet whose columns changed is refused, naming the missing one")
    except cs.Refused as e:
        check("approval_date" in str(e), "a sheet whose columns changed is refused, naming the missing one")

    class FakeDb:
        def __init__(self, stored: int):
            self.stored, self.sent = stored, []

        def execute(self, sql, args=None):
            return {"rows": [[self.stored]]}

        def pipeline(self, reqs, **_):
            self.sent.extend(reqs)

    import lib_db
    real_query = lib_db.query_rows
    lib_db.query_rows = lambda db, sql, args=None: [[db.stored]]
    try:
        db = FakeDb(stored=10)
        try:
            cs.write(db, SHEET, rows)
            check(False, "a sheet that lost more than half its stored rows is refused, and nothing is sent")
        except cs.Refused:
            check(not db.sent, "a sheet that lost more than half its stored rows is refused, and nothing is sent")
        db = FakeDb(stored=4)
        cs.write(db, SHEET, rows)
        sqls = [r["stmt"]["sql"] for r in db.sent]
        check(sqls[-1].startswith("DELETE") and all(s.startswith("INSERT") for s in sqls[:-1]),
              "the new rows go in before the old ones past them come out")
    finally:
        lib_db.query_rows = real_query

    print("ALL PASS" if not failures else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

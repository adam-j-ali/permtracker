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
# The live config's own entry, so the test reads the sheet the way the import does.
SHEET = {**next(x for x in cs.load_config() if x["key"] == "sfv-filers"), "min_rows": 1}


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

    # Sheets with many tabs, an office column and their own words (Nov 19 2026). Made-up rows in the real layouts.
    def tab(*lines: str) -> bytes:
        return ("\n".join(lines) + "\n").encode()

    month_a = tab('PLEASE DO NOT FILTER,PLEASE DO NOT FILTER,,,',
                  'I-485 Received Date,Category,Field Office Name,EAD (I-765) Approval Date if applied,GC Approval Date,'
                  'I-140 Priority Date,Block #',
                  '4/2/2026,EB2-NIW,NBC --> San Jose (non-local) on 4/28,EAD & AP 6/12/2026,,2023-Mar,IOE0933',
                  ',EB3,,,,06/15/2024,',
                  '4/9/2026,EB-1A,Minneapolis-St. Paul (4/15),,9/30/2026,,')
    month_b = tab('Received Date (RD),Category,Field Office,GC Approved Date',
                  '5/1/2026,EB3,LA County,10/2/2026')
    multi = {"key": "all-offices", "name": "test", "tabs": [{"match": "^(apr|may) 26$"}], "min_rows": 1}
    rows, counts = cs.parse_tabs([("Apr 26", month_a), ("May 26", month_b)], multi, "2026-11-19")
    check([r["row_no"] for r in rows] == [1, 2, 3], "cases numbered across the tabs, in order")
    a, b, c = rows
    check(a["office"] == "SNJ" and b["office"] == "SPM" and c["office"] == "LAC",
          "the office a case ended at, however it's written")
    check(a["ead_date"] == "2026-06-12" and a["receipt_date"] == "2026-04-02" and a["category"] == "EB-2 NIW",
          "a date written inside words, and the category's own spelling")
    check(a["priority_date"] == "2023-03", "a priority date given as a month is kept as that month")
    check(counts["empty"] == 1, "a row with only a priority date isn't a case yet")
    check("IOE0933" not in repr(rows), "the receipt block never comes in")
    check(c["approval_date"] == "2026-10-02" and b["approval_date"] == "2026-09-30", "both approval spellings read")

    try:
        cs.parse_tabs([("Apr 26", tab("Name,Notes", "x,y"))], multi, "2026-11-19")
        check(False, "a tab without the receipt column is refused")
    except cs.Refused as e:
        check("no receipt_date" in str(e), f"a tab without the receipt column is refused: {e}")
    try:
        cs.chosen_tabs(multi, [("Please Read", "1"), ("Overview", "2")])
        check(False, "a tab pattern that matches nothing refuses the sheet")
    except cs.Refused:
        check(True, "a tab pattern that matches nothing refuses the sheet")
    check(cs.chosen_tabs({"tabs": [{"match": "^LA$", "office": "LOS"}, {"match": "^LA County$", "office": "LAC"}]},
                         [("LA", "0"), ("LA County", "7"), ("Notes", "9")]) == [("LA", "0", "LOS"), ("LA County", "7", "LAC")],
          "tabs chosen by name, each with its own office")

    county = tab("Lancehaha,EB1/2/3,Status,ROW/NROW,Filing Date,FO,I-485 Approval Date",
                 "someone,EB3,Approved,ROW,3/3/2026,,8/1/2026")
    r = cs.parse_tabs([("LA County", county, "LAC")], {"key": "la", "name": "la", "min_rows": 1}, "2026-11-19")[0][0]
    check(r["office"] == "LAC" and r["category"] == "EB-3" and r["chargeability"] == "row" and "someone" not in repr(r),
          "a blank office cell takes the tab's office; 'Status' there is a case status, never the category")
    discord = tab("User,Column 1,Category,RFE,Receipt / Filing Date,Field Office (Local/Non-Local),I-485 Approval Date",
                  "u1,EB1-A,ROW,PROCESSING,1/5/2026,San Bernardino (Local),")
    conf = {"key": "d", "name": "d", "min_rows": 1,
            "headers": {"category": ["column 1"], "row": ["category"], "ignore": ["rfe"]}}
    r = cs.parse_tabs([("TimeLine", discord)], conf, "2026-11-19")[0][0]
    check(r["category"] == "EB-1" and r["chargeability"] == "row" and r["office"] == "SBD" and r["rfe"] is None,
          "a sheet's own column names win: its category, its ROW column, its status column ignored")
    moved = tab("Username,Category,Receive Date,FO if moved from SAC,Case Still at Santa Ana",
                "u,EB2,2/2/2026,Cincinnati,", "v,EB2,2/3/2026,,No", "w,EB2,2/4/2026,,Yes")
    m1, m2, m3 = cs.parse_tabs([("data", moved, "SAC")], {"key": "s", "name": "s", "min_rows": 1}, "2026-11-19")[0]
    check(m1["office"] == "CIN" and m2["office"] == "" and m3["office"] == "SAC",
          "a case that moved takes the office it moved to, or none when the sheet doesn't say which")

    import build_reported_cases as brc
    rec = brc.sheet_record({"source": "all-offices", "row_no": 3, "office": "", "receipt_date": "2026-04-02",
                            "interview_date": "2026-06-01", "ead_date": "2026-05-01", "i140_receipt_date": "2025-12-01",
                            "i140_approval_date": "2026-01-15"})
    check(rec["office"] is None and rec["interview"] == "2026-06-01" and rec["ead"] == "2026-05-01"
          and rec["i140_decided"] == "2026-01-15" and rec["i140_decision"] == "approved",
          "no office stays no office in the merge, and the new steps reach it")

    # A consulate sheet: the post per row, the NVC and interview steps, family categories.
    nvc = tab("Timestamp,Visa category,U.S. Embassy or Consulate,Priority date,NVC case creation date,"
              "Documentarily Qualified (DQ) date,Interview Letter (IL) date,Interview date,Visa ready date",
              "1/1/2026,IR-1: Spouse of a U.S. Citizen,Cuidad Juarez,7/8/2024,2/8/2025,4/13/2025,5/20/2025,7/10/2025,7/24/2025",
              "1/2/2026,EB-2: Professionals,Atlantis,10/17/2025,,3/12/2026,,,")
    conf = {"key": "nvc", "name": "nvc", "min_rows": 1, "required": ["nvc_complete"],
            "headers": {"ignore": ["timestamp", "nvc case creation date"]}}
    (n1, n2), counts = cs.parse_tabs([("Form Responses 1", nvc)], conf, "2026-11-19")
    check(n1["post"] == "ciudad-juarez" and n1["category"] == "Family" and n1["nvc_complete"] == "2025-04-13"
          and n1["consular_scheduled"] == "2025-05-20" and n1["interview_date"] == "2025-07-10"
          and n1["visa_issued"] == "2025-07-24", "a consulate row: its post, its steps and a family category")
    check(n2["post"] is None and counts.get("unknown_posts") == 1 and n2["category"] == "EB-2",
          "a consulate the site doesn't list is counted and left blank, never guessed")
    rec = brc.sheet_record({"source": "nvc", "row_no": 1, "office": "", **{k: n1[k] for k in (
        "post", "category", "nvc_complete", "consular_scheduled", "interview_date", "visa_issued")}})
    check(rec["consular_interview"] == "2025-07-10" and rec["interview"] is None and rec["post"] == "ciudad-juarez"
          and rec["visa_issued"] == "2025-07-24" and rec["consular_outcome"] == "issued",
          "a consulate interview is the consular one in the merge, and a ready visa is an issued one")

    # Tab names as Google writes them on the sheet's page: JavaScript escapes, then HTML entities.
    page = ('items.push({name: "June \\x2725", pageUrl: "x", gid: "11"}); '
            'items.push({name: "R\\u0026D \\/ misc", pageUrl: "x", gid: "12"}); '
            'items.push({name: "Q\\"s &amp; A", pageUrl: "x", gid: "13"});')
    check(cs.tabs_in(page) == [("June '25", "11"), ("R&D / misc", "12"), ('Q"s & A', "13")],
          f"tab names read as written: {cs.tabs_in(page)}")
    first = next(x for x in cs.load_config() if x["key"] == "i485-status-first")
    check(cs.chosen_tabs(first, cs.tabs_in(page)) == [("June '25", "11", None)],
          "the live config's month tabs match a name Google escaped")

    print("ALL PASS" if not failures else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

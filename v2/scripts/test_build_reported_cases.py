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
    check(v["category"] == "EB-2 NIW" and v["center"] == "TSC" and v["premium"] == "after filing", "the petition, centre, premium")
    check(v["i140_receipt"] == "2025-03-14", "a self-petition's priority date is its filing day")
    check(v["i140_rfe_issued"] == "2025-06-01" and v["i140_rfe_answered"] == "2025-07-15", "the RFE and its answer")
    check(v["i140_decision"] == "approved" and v["i140_decided"] == "2025-09-02", "the decision and its day")
    check(v["chargeability"] == "India", "IN is India")
    check(b.visastats_record(visa_row(petition="EB-2")).get("i140_receipt") is None,
          "an EB-2 through PERM: its priority date is the PERM day, never the I-140's")
    check(b.visastats_record(visa_row(petition="O-1A")) is None, "an O-1 isn't a green card case")
    check(b.visastats_record(visa_row(petition="")) is None, "a row with no petition is left out")
    check(b.visastats_record(visa_row(premium="none"))["premium"] == "none", "premium not pursued")
    p = b.visastats_record(visa_row(decision="Pending", decision_date=None))
    check(p["i140_decision"] == "pending" and p.get("i140_decided") is None, "a pending petition has no decision day")
    check(b.visastats_record(visa_row(rfe_responded="Yes, sent"))["i140_rfe_answered"] is None,
          "an answer in words gives no day")
    check(b.visastats_record(visa_row(chargeability="IRN"))["chargeability"] == "Iran", "IRN is Iran")
    check(b.visastats_record(visa_row())["i140_rfe"] == "rfe"
          and b.visastats_record(visa_row(rfe_status="Never Received"))["i140_rfe"] == "none"
          and b.visastats_record(visa_row(rfe_status="NOID Received"))["i140_rfe"] == "noid"
          and b.visastats_record(visa_row(rfe_status=None))["i140_rfe"] is None, "whether an RFE or a NOID came")
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
    check(b.list_digest(stored) == b.list_digest(rebuilt), "the whole list: a rebuild that changed nothing changes nothing")
    officeless = [{**r, "office": None} for r in rebuilt]
    later = [{**officeless[0], "i140_decided": "2026-10-01"}, *officeless[1:]]
    check(b.office_digests(later) == b.office_digests(officeless) and b.list_digest(later) != b.list_digest(officeless),
          "a change to a case with no office still changes the whole list (the overview and the I-140 page read it)")
    tl = b.post_record({"source": "timeline", "key": "t1", "checked": "1", "shows": "0", "transfer": "2026-01-02",
                        "card": None})
    check(tl["checked"] is True and tl["shows"] is False and "card" not in tl, "a stored 0 is false, a null is gone")

    # Our own timelines and consulate reports, from Convex's export.
    tl = {"id": "t1", "public": True, "updatedAt": 1795118400000, "category": "eb2-niw", "country": "india",
          "route": "adjustment", "premium": True, "premiumOn": "2026-02-01", "i140Center": "texas", "fieldOffice": "SFV",
          "permFiledOn": "2025-08-01", "permCertifiedOn": "2026-05-02", "i140FiledOn": "2026-01-10",
          "i140ApprovedOn": "2026-02-20", "i485FiledOn": "2026-06-12", "biometricsOn": "2026-07-08",
          "officeMovedOn": "2026-09-24", "interviewOn": "2026-10-20", "greenCardOn": "2026-11-03",
          "cardArrivedOn": "2026-11-12", "rfeForm": "i140", "rfeIssuedOn": "2026-01-30", "rfeRespondedOn": "2026-02-10"}
    r = b.timeline_record(tl)
    check(r["source"] == "timeline" and r["checked"] is True and r["shows"] is True, "a shared timeline is checked and shows")
    check(r["category"] == "EB-2 NIW" and r["chargeability"] == "India" and r["center"] == "TSC" and r["office"] == "SFV",
          "its category, country, centre and office in the merge's words")
    check(r["premium"] == "after filing", "premium asked after filing")
    check(r["perm_decided"] == "2026-05-02" and r["perm_decision"] == "approved", "DOL's certification")
    check(r["transfer"] == "2026-09-24" and r["i485_decided"] == "2026-11-03" and r["card"] == "2026-11-12",
          "the transfer, the approval and the card")
    check(r["i140_rfe_issued"] == "2026-01-30" and r["i140_rfe_answered"] == "2026-02-10" and r.get("i485_rfe_issued") is None,
          "an I-140 RFE lands on the I-140")
    check(r["as_of"] == "2026-11-19", "as of its last change, an Eastern day")
    fam_cases, _ = b.build_cases({"timelines": [{**tl, "id": "f1", "category": "family-ir", "i130FiledOn": "2025-01-02"}]})
    emp_cases, _ = b.build_cases({"timelines": [{**tl, "id": "f1", "category": "eb2"}]})
    check(len(fam_cases) == 1 and fam_cases[0].get("category") == "Family" and len(emp_cases) == 1,
          "a family-based timeline joins the list as Family, as the readers' family cases do")
    private = b.timeline_record({**tl, "public": False})
    check(private["shows"] is False, "a private timeline doesn't show")
    consular = b.timeline_record({**tl, "route": "consular", "i485FiledOn": None, "interviewOn": "2026-08-01",
                                  "greenCardOn": "2026-08-05"})
    check(consular["consular_interview"] == "2026-08-01" and consular["visa_issued"] == "2026-08-05"
          and consular["consular_outcome"] == "issued" and consular.get("interview") is None
          and consular.get("i485_decided") is None,
          "a consular timeline's interview and visa land on the consular step")
    check(b.timeline_record({**tl, "premium": True, "premiumOn": None})["premium"] == "yes"
          and b.timeline_record({**tl, "premium": False, "premiumOn": None})["premium"] == "none", "premium kinds")
    cr = b.consular_record({"id": "c1", "updatedAt": 1795118400000, "post": "mumbai", "line": "eb3",
                            "nvcCompleteMonth": "2026-03", "scheduledOn": "2026-05-02", "interviewOn": "2026-06-10",
                            "outcome": "passport-returned", "resolvedOn": "2026-06-20"})
    check(cr["post"] == "mumbai" and cr["category"] == "EB-3" and cr["nvc_complete"] == "2026-03"
          and cr["consular_outcome"] == "issued" and cr["visa_issued"] == "2026-06-20" and cr["checked"] is False,
          "a consulate report: posted at once, so unchecked, and a returned passport is an issued visa")
    check(b.consular_record({"id": "c2", "updatedAt": 1, "post": "mumbai", "outcome": "221g"})["consular_outcome"] == "221g"
          and b.consular_record({"id": "c3", "updatedAt": 1, "post": "mumbai", "outcome": "rescheduled"})["consular_outcome"] == "pending",
          "a 221(g) stays one; a rescheduled interview is still pending")
    # The fields the one summary needs from a timeline (D7, Nov 25 2026): the day premium was asked for, a spouse's
    # H-4 papers with the route Convex resolved, and every RFE, the later one on a form being the one its decision follows.
    check(r["i140_premium_on"] == "2026-02-01" and b.timeline_record({**tl, "premiumOn": None}).get("i140_premium_on") is None,
          "the day premium was asked for, when it was")
    more = {**tl, "h4FiledOn": "2026-03-01", "h4ApprovedOn": "2026-06-01", "h4EadFiledOn": "2026-03-01",
            "h4EadApprovedOn": "2026-07-01", "h4EadRoute": "with-i539",
            "moreRfes": [{"form": "i485", "issuedOn": "2026-09-01", "respondedOn": "2026-09-20"},
                         {"form": "i140", "issuedOn": "2026-02-05", "respondedOn": "2026-02-12"}]}
    m = b.timeline_record(more)
    check(m["h4_filed"] == "2026-03-01" and m["h4_approved"] == "2026-06-01" and m["h4_ead_filed"] == "2026-03-01"
          and m["h4_ead_approved"] == "2026-07-01" and m["h4_ead_route"] == "with-i539", "a spouse's H-4 papers")
    check(m["i485_rfe_issued"] == "2026-09-01" and m["i485_rfe_answered"] == "2026-09-20", "an RFE on the I-485 from the more list")
    check(m["i140_rfe_issued"] == "2026-02-05" and m["i140_rfe_answered"] == "2026-02-12" and m["i140_rfe"] == "rfe",
          "of two I-140 RFEs, the later one, which the decision follows")
    only485 = b.timeline_record({**tl, "rfeForm": None, "rfeIssuedOn": None, "rfeRespondedOn": None,
                                 "moreRfes": [{"form": "i485", "issuedOn": "2026-09-01"}]})
    check(only485.get("i140_rfe") is None and only485["i485_rfe_issued"] == "2026-09-01"
          and only485.get("i485_rfe_answered") is None, "an RFE only on the I-485 says nothing about the I-140")
    check(b.build_cases({"timelines": [more]})[1]["left_out"] == 0, "the merge reads every new field")

    # Every consulate report, every kind of visa, as the reports' own figures read it (the merge takes only the
    # employment ones, through `consular`).
    rep = b.report_row({"post": "manila", "category": "k1", "mode": "interview", "outcome": "221g",
                        "nvcCompleteMonth": "2026-08", "scheduledOn": "2026-10-01", "interviewOn": "2026-11-03",
                        "holdReason": "public-charge", "updatedAt": 1795118400000})
    check(rep == {"post": "manila", "category": "k1", "mode": "interview", "line": None, "outcome": "221g",
                  "nvc_month": "2026-08", "scheduled": "2026-10-01", "interview": "2026-11-03", "approved": None,
                  "resolved": None, "hold_reason": "public-charge", "cancelled_by": None, "saved": "2026-11-19"},
          f"a report row keeps what its figures read, and the Eastern day it was saved: {rep}")
    lists = b.export_lists({"ok": True, "timelines": [], "consular": [], "cases": [], "reports": [{"post": "manila"}]})
    check(lists["reports"] == [{"post": "manila"}], "the export's reports list")
    old = b.export_lists({"ok": True, "timelines": [], "consular": []})
    check("reports" not in old and old["app"] == [], "a Convex deployment older than the list sends none, and none is made up")
    try:
        b.export_lists({"ok": True, "timelines": [], "consular": [], "reports": "x"})
        check(False, "refuses a reports list that isn't one")
    except RuntimeError:
        check(True, "refuses a reports list that isn't one")

    # A case saved in the app by an account that chose to count it: dates only, counted, never listed.
    app = {"id": "k1", "updatedAt": 1795118400000, "pwdFilingDate": "2025-01-10", "pwdDeterminationDate": "2025-07-01",
           "eta9089FilingDate": "2025-10-01", "eta9089AuditDate": "2026-01-20", "eta9089CertificationDate": "2026-06-15",
           "i140FilingDate": "2026-07-01",
           "i140DenialDate": "2026-09-01", "i140Category": "EB-2-NIW", "i140PremiumProcessing": False}
    ar = b.app_record(app)
    check(ar["source"] == "app" and ar["shows"] is False and ar["category"] == "EB-2 NIW" and ar["premium"] == "none",
          "an app case is counted, never shown, its category in the merge's words")
    check(ar["pwd_filed"] == "2025-01-10" and ar["pwd_issued"] == "2025-07-01" and ar["perm_decision"] == "approved"
          and ar["perm_audit"] == "2026-01-20"
          and ar["i140_decided"] == "2026-09-01" and ar["i140_decision"] == "denied", "its steps and decisions")
    check(not {"employerName", "positionTitle", "caseNumber", "notes"} & set(ar), "nothing but dates and the I-140's kind")
    app_cases, _ = b.build_cases({"app": [app]})
    check(len(app_cases) == 1 and app_cases[0]["figures"].get("pwd_issued") == "2025-07-01"
          and "app" not in b.case_row(app_cases[0], 0)["source_names"], f"it counts in the figures and is never named: {app_cases}")
    cases, counts = b.build_cases({"sheets": [sheet_row(country="India")], "timelines": [{**tl, "public": False}]})
    check(len(cases) == 1 and counts["merged"] == 1 and cases[0]["shows"] and cases[0].get("card") is None,
          "a private timeline matching the sheet's row merges, and its card day stays private")

    # A table made by an older build gains the new columns before the first write that names them (Nov 19 2026:
    # the server's first run with every step failed on "no column named h1b_filed").
    from lib_sqlite_shim import SqliteTurso
    db = SqliteTurso()
    db.execute("CREATE TABLE reported_cases (case_id TEXT PRIMARY KEY, office TEXT, transfer TEXT, built_at INTEGER)")
    b.ensure_table(db)
    from lib_db import query_rows
    cols = {r[1] for r in query_rows(db, "PRAGMA table_info(reported_cases)")}
    check(set(b.COLUMNS) <= cols, f"an old table gains every column: missing {sorted(set(b.COLUMNS) - cols)[:5]}")
    changed = b.write(db, [b.case_row(c, 5) for c in b.build_cases({"sheets": [sheet_row()]})[0]])
    check(changed.offices == {"SFV"} and changed.anything, f"and the first write to it lands: {changed}")
    again = b.write(db, [b.case_row(c, 6) for c in b.build_cases({"sheets": [sheet_row()]})[0]])
    check(not again.offices and not again.anything, f"the same list written again refreshes nothing: {again}")

    # Each hour sends only the cases that changed, plus one statement that restamps the list (Nov 20 2026: rewriting
    # all 20,000 every hour took the build to its 5-minute limit). A case gone from the build is deleted by its id.
    sent = []
    real = db.pipeline
    db.pipeline = lambda reqs: (sent.extend(reqs), real(reqs))[1]
    two = b.build_cases({"sheets": [sheet_row(), sheet_row(row_no=4, transfer_date="2026-10-01", i485_receipt="2025-12-01")]})[0]
    b.write(db, [b.case_row(c, 7) for c in two])
    inserts = [r for r in sent if "INSERT" in str(r)]
    check(len(inserts) == 1, f"only the new case is written: {len(inserts)} inserts")
    sent.clear()
    b.write(db, [b.case_row(c, 8) for c in two])
    check(not [r for r in sent if "INSERT" in str(r)], f"an unchanged list writes no case: {sent}")
    check(int(query_rows(db, "SELECT min(built_at) FROM reported_cases")[0][0]) == 8, "and every case carries this build's stamp")
    sent.clear()
    b.write(db, [b.case_row(c, 9) for c in two[:1]], force=True)
    check(int(query_rows(db, "SELECT count(*) FROM reported_cases")[0][0]) == 1, "a case gone from the build is deleted")
    db.pipeline = real

    # The consulate reports' figures are summaries like the rest (D7): one for every consulate, one per consulate with a
    # report, one for a consulate with none. A Convex deployment that sent no reports list leaves the stored ones alone.
    import datetime as dt
    today = dt.date(2026, 11, 19)
    reps = [b.report_row({"post": "manila", "category": "h1b", "outcome": "issued", "interviewOn": "2026-11-03",
                          "updatedAt": 1795118400000})]
    bodies = b.summary_rows(b.build_cases({"sheets": [sheet_row()]})[0], today, reps)
    check({"reports:all", "reports:manila", "reports:_none"} <= set(bodies), f"the reports' summaries: {sorted(bodies)}")
    check(not any(k.startswith("reports:") for k in b.summary_rows([], today, None)), "no reports list, no reports summaries")
    db2 = SqliteTurso()
    b.write_summaries(db2, bodies)
    b.write_summaries(db2, {"all": bodies["all"]}, keep=("reports:",))
    kept = {r[0] for r in query_rows(db2, "SELECT key FROM reported_summary")}
    check({"all", "reports:all", "reports:manila"} <= kept and not any(k.startswith("office:") for k in kept),
          f"a build without the reports keeps the stored ones and drops the rest it didn't make: {sorted(kept)}")
    check(b.refreshed_posts({"post:mumbai", "reports:manila", "reports:all", "reports:_none", "office:SFV", "all"})
          == ["manila", "mumbai"], "the consulates whose figures moved, never the summaries of every consulate")
    check([len(x) for x in b.chunks(list(range(450)), 200)] == [200, 200, 50], "a long list goes in calls of 200")

    # A bad row from one source is counted and left out, never allowed to stop the build.
    cases, counts = b.build_cases({"sheets": [sheet_row(), sheet_row(row_no=3, transfer_date="9/24/2026")]})
    check(len(cases) == 1 and counts["left_out"] == 1, "a row the merge can't read is left out and counted")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

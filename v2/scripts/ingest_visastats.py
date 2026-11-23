#!/usr/bin/env python3
"""Load VisaStats' community tracker (trackers.visastats.org): self-reported EB-2 NIW, EB-1A and O-1 I-140 cases, and
its RFE officer lookup.

WHY: every community record the site can use counts toward its figures. The tracker's own policy says "All records
are public and may be copied or stored by others". Its robots.txt closes /api/, so nothing here asks the site for
anything: the rows are read in a browser as a visitor sees them, page by page, and copied out as a bundle, and this
script loads that bundle.

WHAT GOES IN. Every column but the author's alias, which the browser read leaves out. The free-text columns (the case
basis, the notes, the RFE details, comments) are stored and never shown: free text can name a person.

A BUNDLE THAT SHRANK OR CHANGED SHAPE IS REFUSED: missing columns, under the floor, or more than half the stored rows
gone. The stored copy stays, the run ends red and names the reason.

    python3 scripts/ingest_visastats.py --cases FILE.json --officers FILE.json            # load both
    python3 scripts/ingest_visastats.py --cases FILE.json --officers FILE.json --dry-run  # parse only
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT = "ingest_visastats.py"
SOURCE = "https://trackers.visastats.org/"
CASES = "community_i140_reports"
OFFICERS = "community_rfe_officers"
KEEP_SHARE = 0.5
CASE_FLOOR = 100
OFFICER_FLOOR = 100

# Column by the tracker's own header.
CASE_COLUMNS = {
    "petition": "PETITION", "priority_date": "PRIORITY DATE (OR FILING DATE)", "criteria_path": "CRITERIA PATH",
    "filing_assistance": "FILING & CASE ASSISTANCE", "case_basis": "CASE BASIS (FREE FORM)",
    "employer_situation": "US EMPLOYER SITUATION", "field": "PROFESSIONAL FIELD", "years_in_field": "YEARS IN FIELD",
    "education": "EDUCATION LEVEL", "publications": "PUBLICATIONS", "citations": "CITATIONS",
    "lors": "RECOMMEND. LETTERS (LOR)", "chargeability": "COUNTRY OF CHARGEABILITY", "origin": "COUNTRY OF ORIGIN",
    "service_center_text": "I-140 SERVICE CENTER", "block": "I-140 BLOCK #", "premium_text": "PP (PREMIUM PROCESSING)",
    "pp_request_date": "PP REQUEST DATE", "rfe_status": "RFE / NOID STATUS", "rfe_dates": "RFE / NOID DATES",
    "rfe_count": "RFE / NOID COUNT", "rfe_details": "RFE / NOID DETAILS", "rfe_responded": "RFE / NOID RESPONDED",
    "rfe_officer": "RFE OFFICER #", "silent_updates": "SILENT UPDATE DATES", "decision": "I-140 DECISION",
    "decision_date": "DECISION DATE", "duration_days": "CASE DURATION (DAYS)", "notes": "NOTES AND THOUGHTS (FREE FORM)",
    "comments": "COMMENTS (ANY USER)", "updated": "UPDATED", "created": "CREATED",
}
CASE_REQUIRED = ("petition", "priority_date", "decision", "decision_date", "created")
OFFICER_COLUMNS = {"petition": "PETITION", "officer": "RFE OFFICER #", "rfe_status": "RFE / NOID STATUS",
                   "decision": "I-140 DECISION", "details": "RFE / NOID DETAILS", "rfe_dates": "RFE / NOID DATES"}
OFFICER_REQUIRED = ("petition", "officer")
CENTERS = {"tsc": "TSC", "texas": "TSC", "texas service center": "TSC", "nsc": "NSC", "nebraska": "NSC",
           "nebraska service center": "NSC"}
PLACEHOLDERS = ("be the first to comment",)


class Refused(Exception):
    """The bundle can't be stored as it stands; the stored copy stays."""


def clean(v: str | None) -> str | None:
    v = re.sub(r"\s+", " ", (v or "")).strip()
    return None if not v or v.lower().startswith(PLACEHOLDERS) else v


def iso_day(v: str | None) -> str | None:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", (v or "").strip())
    return f"{m[1]}-{m[2]}-{m[3]}" if m else None


def days_list(v: str | None) -> str:
    return json.dumps(sorted({f"{y}-{m}-{d}" for y, m, d in re.findall(r"(\d{4})-(\d{2})-(\d{2})", v or "")}))


def number(v: str | None) -> int | None:
    m = re.fullmatch(r"\s*(\d{1,6})\s*", v or "")
    return int(m[1]) if m else None


def premium(v: str | None) -> str | None:
    n = (v or "").strip().lower()
    if n.startswith("with initial"):
        return "with filing"
    if n.startswith("after initial"):
        return "after filing"
    if n.startswith("not pursued"):
        return "none"
    return None


def index_of(heads: list[str], wanted: dict[str, str], required: tuple[str, ...], what: str) -> dict[str, int]:
    at = {field: heads.index(h) for field, h in wanted.items() if h in heads}
    missing = [f for f in required if f not in at]
    if missing:
        raise Refused(f"the {what} columns changed: no {', '.join(missing)} in {heads[:12]}")
    return at


def parse_cases(bundle: dict) -> list[dict]:
    at = index_of(bundle["heads"], CASE_COLUMNS, CASE_REQUIRED, "tracker")
    if any(h.upper() == "AUTHOR" for h in bundle["heads"]):
        raise Refused("the bundle carries the author column; the browser read must leave it out")
    cell = lambda r, f: clean(r[at[f]]) if f in at and at[f] < len(r) else None  # noqa: E731
    out = []
    for r in bundle["rows"]:
        if not any(clean(c) for c in r):
            continue
        sc_text = cell(r, "service_center_text")
        out.append({
            "row_no": len(out) + 1,
            **{f: cell(r, f) for f in ("petition", "criteria_path", "filing_assistance", "case_basis", "employer_situation",
                                       "field", "education", "chargeability", "origin", "block", "rfe_status",
                                       "rfe_responded", "rfe_officer", "rfe_details", "decision", "notes", "comments")},
            "service_center_text": sc_text,
            "service_center": CENTERS.get((sc_text or "").lower()),
            "premium": premium(cell(r, "premium_text")),
            "premium_text": cell(r, "premium_text"),
            "priority_date": iso_day(cell(r, "priority_date")),
            "pp_request_date": iso_day(cell(r, "pp_request_date")),
            "decision_date": iso_day(cell(r, "decision_date")),
            "created": iso_day(cell(r, "created")),
            "updated": iso_day(cell(r, "updated")),
            "rfe_dates": days_list(cell(r, "rfe_dates")),
            "silent_updates": days_list(cell(r, "silent_updates")),
            "years_in_field": number(cell(r, "years_in_field")),
            "publications": number(cell(r, "publications")),
            "citations": number(cell(r, "citations")),
            "lors": number(cell(r, "lors")),
            "rfe_count": number(cell(r, "rfe_count")),
            "duration_days": number(cell(r, "duration_days")),
        })
    if len(out) < CASE_FLOOR:
        raise Refused(f"{len(out)} cases, under the floor of {CASE_FLOOR}")
    return out


def parse_officers(bundle: dict) -> list[dict]:
    at = index_of(bundle["heads"], OFFICER_COLUMNS, OFFICER_REQUIRED, "officer lookup")
    cell = lambda r, f: clean(r[at[f]]) if f in at and at[f] < len(r) else None  # noqa: E731
    out = []
    for r in bundle["rows"]:
        if not cell(r, "officer"):
            continue
        out.append({"row_no": len(out) + 1, "petition": cell(r, "petition"), "officer": cell(r, "officer"),
                    "rfe_status": cell(r, "rfe_status"), "decision": cell(r, "decision"), "details": cell(r, "details"),
                    "rfe_dates": days_list(cell(r, "rfe_dates"))})
    if len(out) < OFFICER_FLOOR:
        raise Refused(f"{len(out)} officer records, under the floor of {OFFICER_FLOOR}")
    return out


CASE_FIELDS = ("row_no", "petition", "priority_date", "criteria_path", "filing_assistance", "case_basis",
               "employer_situation", "field", "years_in_field", "education", "publications", "citations", "lors",
               "chargeability", "origin", "service_center", "service_center_text", "block", "premium", "premium_text",
               "pp_request_date", "rfe_status", "rfe_dates", "rfe_count", "rfe_details", "rfe_responded", "rfe_officer",
               "silent_updates", "decision", "decision_date", "duration_days", "notes", "comments", "created", "updated")
OFFICER_FIELDS = ("row_no", "petition", "officer", "rfe_status", "decision", "details", "rfe_dates")
INTS = {"row_no", "years_in_field", "publications", "citations", "lors", "rfe_count", "duration_days"}


def ensure_tables(db) -> None:
    for table, fields in ((CASES, CASE_FIELDS), (OFFICERS, OFFICER_FIELDS)):
        cols = ", ".join(f"{f} {'INTEGER' if f in INTS else 'TEXT'}" for f in fields)
        # Table and column names are this module's constants, never input.
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query
        db.execute(f"CREATE TABLE IF NOT EXISTS {table} ({cols}, fetched_at INTEGER NOT NULL, PRIMARY KEY (row_no))")


def write(db, table: str, fields: tuple[str, ...], rows: list[dict], force: bool = False) -> int:
    """Replace a table's rows: the new ones in first, then the stored ones past the new count out."""
    from lib_db import query_rows, stmt
    stored = int(query_rows(db, f"SELECT count(*) FROM {table}")[0][0] or 0)  # nosemgrep
    if stored and len(rows) < stored * KEEP_SHARE and not force:
        raise Refused(f"{table}: {len(rows)} rows against {stored} stored, more than half gone: the stored copy stays")
    stamp = int(time.time() * 1000)
    sql = f"INSERT OR REPLACE INTO {table} ({', '.join(fields)}, fetched_at) VALUES ({', '.join('?' * (len(fields) + 1))})"  # nosemgrep
    reqs = [stmt(sql, [*(r[f] for f in fields), stamp]) for r in rows]
    reqs.append(stmt(f"DELETE FROM {table} WHERE row_no > ?", [len(rows)]))  # nosemgrep
    for i in range(0, len(reqs), 200):
        db.pipeline(reqs[i:i + 200])
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cases", required=True, help="the EB and O tracker's bundle (JSON)")
    ap.add_argument("--officers", required=True, help="the RFE officer lookup's bundle (JSON)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="store a bundle that lost more than half its rows")
    a = ap.parse_args()
    started = time.time()
    try:
        cases = parse_cases(json.load(open(a.cases, encoding="utf-8")))
        officers = parse_officers(json.load(open(a.officers, encoding="utf-8")))
    except (Refused, ValueError, KeyError) as e:
        print(f"::error::REFUSED: {e}", flush=True)
        if not a.dry_run:
            from lib_db import Database, record_run
            record_run(Database(), SCRIPT, status="failed", rows_written=0, note=f"refused: {e}", started_at=started)
        return 1
    decided = sum(1 for c in cases if c["decision"] in ("Approved", "Denied"))
    note = f"{len(cases)} I-140 cases ({decided} decided), {len(officers)} RFE officer records"
    print(note, flush=True)
    if a.dry_run:
        return 0
    from lib_db import Database, record_run, stamp_freshness
    db = Database()
    ensure_tables(db)
    try:
        write(db, CASES, CASE_FIELDS, cases, a.force)
        write(db, OFFICERS, OFFICER_FIELDS, officers, a.force)
    except Refused as e:
        print(f"::error::REFUSED: {e}", flush=True)
        record_run(db, SCRIPT, status="failed", rows_written=0, note=f"refused: {e}", started_at=started)
        return 1
    stamp_freshness(db, "community-visastats", source=SOURCE, cadence="weekly, copied in a browser (robots.txt closes /api/)",
                    note=note, max_age_days=10)
    record_run(db, SCRIPT, status="ok", rows_written=len(cases) + len(officers), note=note, started_at=started)
    return 0


if __name__ == "__main__":
    sys.exit(main())

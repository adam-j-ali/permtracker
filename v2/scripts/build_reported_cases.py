"""Build the reported-cases list: every imported source's cases, merged so each person is one case.

Reads what the loaders stored (the community sheets, VisaStats' tracker, and the Reddit and Telegram reports once
they're loaded), turns each row into a merge record, merges them (scripts/lib_reported_cases.py) and replaces
`reported_cases`. The pages read that table; the office pages whose cases changed are refreshed.

Run: python3 scripts/build_reported_cases.py [--from-convex] [--dry-run]

The server runs it hourly with --from-convex (permtracker-uscis reported-cases), the one writer of the table, and again
after each VisaStats load.

A row the merge can't read is left out and counted in the run's note, never allowed to stop the build. A build that
would shrink the stored list by more than half is refused (`--force` stores it), so one broken source can't empty
the pages.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
from typing import NamedTuple

import lib_reported_cases as rc

SCRIPT = "build_reported_cases"
TABLE = "reported_cases"
KEEP_SHARE = 0.5
COLUMNS = ("case_id", *rc.FIELDS, "as_of", "sources", "source_names", "checked", "shows", "possible_dupes",
           "adds_nothing", "conflicts", "built_at")
INTS = {"visa_available", "checked", "shows", "adds_nothing", "built_at"}
# A sheet's "visa availability": available, not available; "Approved" and "Unknown" say nothing about the number.
VISA_AVAILABLE = {"visa available": True, "available": True, "current": True, "not available": False,
                  "not current": False}
# Country codes and names the sources use, as the names the pages print.
COUNTRIES = {"in": "India", "india": "India", "cn": "China", "china": "China", "mx": "Mexico", "mexico": "Mexico",
             "ph": "Philippines", "philippines": "Philippines", "irn": "Iran", "ir": "Iran", "row": "ROW"}
# VisaStats' "RFE / NOID STATUS": what came, or that nothing did.
VISASTATS_RFE = {"rfe received": "rfe", "noid received": "noid", "never received": "none"}
# Petitions filed by the person themself: the priority date is the I-140's own filing day.
SELF_PETITIONS = {"EB-2 NIW", "EB-1A"}
GREEN_CARD = re.compile(r"^EB-?\d")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _country(v: str | None) -> str | None:
    v = (v or "").strip()
    return COUNTRIES.get(v.lower(), v) if v else None


def _day(v: str | None) -> str | None:
    return v if v and DAY.match(v) else None


def sheet_record(row: dict) -> dict:
    """A community sheet's stored row (community_case_reports) as a merge record."""
    approved = _day(row.get("approval_date"))
    rfe = re.search(r"(\d{4}-\d{2}-\d{2})", row.get("rfe") or "")
    return {
        "source": row["source"], "key": str(row["row_no"]), "as_of": row.get("valid_as_of"),
        "office": row.get("office") or None, "category": row.get("category"),
        "chargeability": _country(row.get("country")) or _country(row.get("chargeability")),
        "priority_date": row.get("priority_date"),
        "i485_receipt": row.get("receipt_date"), "biometrics": row.get("biometrics_date"),
        "transfer": row.get("transfer_date"), "i485_rfe_issued": rfe[1] if rfe else None,
        "i485_decided": approved, "i485_decision": "approved" if approved else None,
        "card": row.get("card_date"),
        # A consulate sheet's interview is the consular one; an I-485 sheet's is at the field office.
        "interview": None if row.get("post") else _day(row.get("interview_date")),
        "post": row.get("post") or None, "nvc_complete": _day(row.get("nvc_complete")),
        "consular_scheduled": _day(row.get("consular_scheduled")),
        "consular_interview": _day(row.get("interview_date")) if row.get("post") else None,
        "visa_issued": _day(row.get("visa_issued")),
        "consular_outcome": "issued" if _day(row.get("visa_issued")) else None,
        "ead": _day(row.get("ead_date")),
        "i140_receipt": _day(row.get("i140_receipt_date")), "i140_decided": _day(row.get("i140_approval_date")),
        "i140_decision": "approved" if _day(row.get("i140_approval_date")) else None,
        "visa_available": VISA_AVAILABLE.get((row.get("visa_availability") or "").strip().lower()),
        "nonimmigrant_status": (row.get("visa_status") or "").strip() or None,
        "priority_note": None if row.get("priority_date") else (row.get("priority_note") or None),
    }


def visastats_record(row: dict) -> dict | None:
    """A VisaStats tracker row (community_i140_reports) as a merge record; None for an O-1 or a row with no petition."""
    petition = (row.get("petition") or "").strip()
    if not GREEN_CARD.match(petition):
        return None
    decision = (row.get("decision") or "").strip().lower() or None
    decision = decision if decision in rc.DECISIONS else None
    rfe_days = sorted(json.loads(row.get("rfe_dates") or "[]"))
    premium = row.get("premium") if row.get("premium") in rc.PREMIUMS else None
    return {
        "source": "visastats", "key": str(row["row_no"]), "as_of": row.get("updated") or row.get("created"),
        "category": petition, "center": row.get("service_center"),
        "chargeability": _country(row.get("chargeability")), "premium": premium,
        "priority_date": _day(row.get("priority_date")),
        "i140_receipt": _day(row.get("priority_date")) if petition in SELF_PETITIONS else None,
        "i140_rfe_issued": rfe_days[0] if rfe_days else None,
        "i140_rfe_answered": _day((row.get("rfe_responded") or "").strip()),
        "i140_rfe": VISASTATS_RFE.get((row.get("rfe_status") or "").strip().lower()),
        "i140_decision": decision,
        "i140_decided": _day(row.get("decision_date")) if decision in ("approved", "denied") else None,
    }


# Our own forms' words, as the merge's.
TIMELINE_CATEGORIES = {"eb1": "EB-1", "eb2": "EB-2", "eb2-niw": "EB-2 NIW", "eb3": "EB-3", "eb3-other": "EB-3 EW"}
CONSULAR_LINES = {"eb1": "EB-1", "eb2": "EB-2", "eb3": "EB-3", "ew": "EB-3 EW", "eb4": "EB-4", "eb5": "EB-5"}
CENTERS_BY_NAME = {"nebraska": "NSC", "texas": "TSC"}
CONSULAR_OUTCOME = {"waiting": "pending", "approved": "approved", "issued": "issued", "passport-returned": "issued",
                    "221g": "221g", "refused": "refused", "cancelled": "pending", "rescheduled": "pending"}


def _et_day(ms) -> str | None:
    from lib_db import et_date
    return et_date(int(ms)) if ms else None


def timeline_record(row: dict) -> dict:
    """A timeline shared on this site (Convex's export) as a merge record: owner-reviewed, so checked. A private one
    only stops a repeat (`shows` false), and the merge keeps its dates off every page."""
    consular = row.get("route") == "consular"
    premium = None
    if row.get("premium") is not None:
        premium = "after filing" if row.get("premiumOn") else ("yes" if row["premium"] else "none")
    approved = row.get("greenCardOn")
    rfe_form = row.get("rfeForm")
    return {
        "source": "timeline", "key": str(row["id"]), "checked": True, "shows": bool(row.get("public")),
        "as_of": _et_day(row.get("updatedAt")),
        "category": TIMELINE_CATEGORIES.get(row.get("category") or ""),
        "chargeability": _country(row.get("country")),
        "office": row.get("fieldOffice"), "center": CENTERS_BY_NAME.get(row.get("i140Center") or ""),
        "premium": premium,
        "perm_filed": row.get("permFiledOn"), "perm_decided": row.get("permCertifiedOn"),
        "perm_decision": "approved" if row.get("permCertifiedOn") else None,
        "i140_receipt": row.get("i140FiledOn"), "i140_decided": row.get("i140ApprovedOn"),
        "i140_decision": "approved" if row.get("i140ApprovedOn") else None,
        "i140_rfe_issued": row.get("rfeIssuedOn") if rfe_form == "i140" else None,
        "i140_rfe": "rfe" if rfe_form == "i140" else None,
        "i140_rfe_answered": row.get("rfeRespondedOn") if rfe_form == "i140" else None,
        "i485_rfe_issued": row.get("rfeIssuedOn") if rfe_form == "i485" else None,
        "i485_receipt": None if consular else row.get("i485FiledOn"),
        "biometrics": None if consular else row.get("biometricsOn"),
        "ead": row.get("eadOn"), "ap": row.get("apOn"), "transfer": row.get("officeMovedOn"),
        "interview": None if consular else row.get("interviewOn"),
        "i485_decided": None if consular else approved,
        "i485_decision": "approved" if approved and not consular else None,
        "card": row.get("cardArrivedOn"),
        "consular_interview": row.get("interviewOn") if consular else None,
        "visa_issued": approved if consular else None,
        "consular_outcome": "issued" if approved and consular else None,
    }


APP_CATEGORIES = {"EB-1": "EB-1", "EB-2": "EB-2", "EB-2-NIW": "EB-2 NIW", "EB-3": "EB-3"}


def app_record(row: dict) -> dict:
    """A case saved in the app by an account that chose to count its cases in the public figures (Settings; Convex's
    caseFigures.exportForMerge): its dates, the I-140's category and premium processing, nothing else. It counts in
    the figures and is never listed or named as a source (`shows` false). Each case is its own person: an attorney's
    account holds many people's cases."""
    premium = None
    if row.get("i140PremiumProcessing") is not None:
        premium = "yes" if row["i140PremiumProcessing"] else "none"
    certified, denied = row.get("eta9089CertificationDate"), row.get("eta9089DenialDate")
    approved, refused = row.get("i140ApprovalDate"), row.get("i140DenialDate")
    return {
        "source": "app", "key": str(row["id"]), "checked": True, "shows": False,
        "as_of": _et_day(row.get("updatedAt")),
        "category": APP_CATEGORIES.get(row.get("i140Category") or ""),
        "premium": premium,
        "pwd_filed": row.get("pwdFilingDate"), "pwd_issued": row.get("pwdDeterminationDate"),
        "perm_filed": row.get("eta9089FilingDate"), "perm_audit": row.get("eta9089AuditDate"),
        "perm_decided": certified or denied,
        "perm_decision": "approved" if certified else ("denied" if denied else None),
        "i140_receipt": row.get("i140FilingDate"), "i140_decided": approved or refused,
        "i140_decision": "approved" if approved else ("denied" if refused else None),
    }


def consular_record(row: dict) -> dict:
    """A consulate report shared on this site as a merge record. Reports post at once and are moderated after, so
    they aren't counted as checked."""
    outcome = CONSULAR_OUTCOME.get(row.get("outcome") or "")
    return {
        "source": "consular-report", "key": str(row["id"]), "checked": False, "shows": True,
        "as_of": _et_day(row.get("updatedAt")),
        "post": row.get("post"), "category": CONSULAR_LINES.get(row.get("line") or ""),
        "nvc_complete": row.get("nvcCompleteMonth"), "consular_scheduled": row.get("scheduledOn"),
        "consular_interview": row.get("interviewOn"), "consular_outcome": outcome,
        "visa_issued": row.get("resolvedOn") if outcome == "issued" else None,
    }


def post_record(row: dict) -> dict:
    """A Reddit or Telegram report (community_post_reports) is stored in the merge's own shape."""
    out = {k: v for k, v in row.items() if (k in rc.FIELDS or k in rc.META_FIELDS) and v is not None}
    for k in ("checked", "shows", "visa_available"):
        if k in out:
            out[k] = bool(int(out[k]))
    return out


def build_cases(sources: dict[str, list[dict]]) -> tuple[list[dict], dict]:
    """Merge every source's rows. `sources`: "sheets", "visastats" and "posts", each a list of stored rows."""
    makers = {"sheets": sheet_record, "visastats": visastats_record, "posts": post_record,
              "timelines": timeline_record, "consular": consular_record, "app": app_record}
    records, left_out = [], 0
    for name, rows in sources.items():
        for row in rows:
            r = makers[name](row)
            if r is None:
                left_out += 1
                continue
            r = {k: v for k, v in r.items() if v is not None}
            try:
                rc.check_record(r)
            except ValueError as e:
                print(f"::warning::{name} row {row.get('row_no') or row.get('key')}: {str(e)[:160]}", flush=True)
                left_out += 1
                continue
            records.append(r)
    cases = rc.merge(records)
    counts = {
        "records": len(records), "left_out": left_out, "cases": len(cases), "people": rc.count_people(cases),
        "merged": sum(1 for c in cases if len(c["sources"]) > 1 and not all(m["likely"] for m in c["sources"][1:])),
        "likely": sum(1 for c in cases for m in c["sources"] if m["likely"]),
        "possible_dupes": sum(1 for c in cases if c["possible_dupes"]),
    }
    return cases, counts


def case_row(case: dict, built_at: int) -> dict:
    """A merged case as `reported_cases` stores it."""
    row = {"case_id": case["id"]}
    for f in rc.FIELDS:
        v = case.get(f)
        row[f] = (1 if v else 0) if f == "visa_available" and v is not None else v
    row.update({
        "as_of": case.get("as_of"),
        "sources": json.dumps(case["sources"]),
        # A private timeline's source is never named: the case it joined shows only where its public reports came from.
        "source_names": json.dumps(sorted({m["source"] for m in case["sources"] if m.get("shows", True)})),
        "checked": int(case["checked"]), "shows": int(case["shows"]),
        "possible_dupes": json.dumps(case["possible_dupes"]), "adds_nothing": int(case["adds_nothing"]),
        "conflicts": json.dumps(case["conflicts"]), "built_at": built_at,
    })
    return row


def ensure_table(db) -> None:
    cols = ", ".join(f"{c} {'INTEGER' if c in INTS else 'TEXT'}" for c in COLUMNS if c != "case_id")
    # Table and column names are this module's constants, never input.
    # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query
    db.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} (case_id TEXT PRIMARY KEY, {cols})")
    # CREATE ... IF NOT EXISTS never adds a column to a table an older build made: the merge's fields grow.
    from lib_db import add_missing_columns
    add_missing_columns(db, TABLE, {c: ("INTEGER" if c in INTS else "TEXT") for c in COLUMNS if c != "case_id"})
    db.execute(f"CREATE INDEX IF NOT EXISTS {TABLE}_office ON {TABLE} (office, transfer)")  # nosemgrep
    db.execute(f"CREATE INDEX IF NOT EXISTS {TABLE}_category ON {TABLE} (category, i140_decided)")  # nosemgrep


def table_exists(db, name: str) -> bool:
    from lib_db import query_rows
    return bool(query_rows(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]))


def read_convex() -> dict[str, list[dict]]:
    """Our own timelines and consulate reports, from Convex's GET /reported-export (the server's secret). A read that
    fails raises: a build without them would drop every shared timeline and let a private one's repeat show."""
    from check_watched_cases import convex_call
    doc = convex_call("/reported-export")
    if not doc.get("ok") or not isinstance(doc.get("timelines"), list) or not isinstance(doc.get("consular"), list):
        raise RuntimeError(f"Convex's export answered without its lists: {str(doc)[:200]}")
    # The cases counted from the app: absent from a Convex deployment older than the setting (Nov 20 2026).
    app = doc.get("cases", [])
    if not isinstance(app, list):
        raise RuntimeError(f"Convex's export answered with a cases list that isn't one: {str(app)[:200]}")
    return {"timelines": doc["timelines"], "consular": doc["consular"], "app": app}


def read_sources(db, convex: bool = False) -> dict[str, list[dict]]:
    from lib_db import query_dicts
    out: dict[str, list[dict]] = read_convex() if convex else {}
    for name, table in (("sheets", "community_case_reports"), ("visastats", "community_i140_reports"),
                        ("posts", "community_post_reports")):
        if table_exists(db, table):
            # Typed: libSQL hands integers back as strings, and "0" is true in Python.
            out[name] = query_dicts(db, f"SELECT * FROM {table}", typed=True)  # nosemgrep: a constant table name
    return out


def _fingerprint(r: dict) -> str:
    # Every value through `canon`, so a row read back from the database (integers as strings) matches the row this
    # build wrote.
    from lib_db import canon
    return "\x1e".join(canon(r.get(c)) for c in COLUMNS if c != "built_at")


def office_digests(rows: list[dict]) -> dict[str, str]:
    """A fingerprint of each office's shown cases, to refresh only the offices that changed."""
    from lib_db import canon_hash
    per: dict[str, list[str]] = {}
    for r in rows:
        if r.get("office") and int(r.get("shows") or 0):
            per.setdefault(r["office"], []).append(_fingerprint(r))
    return {o: canon_hash(sorted(v)) for o, v in per.items()}


def list_digest(rows: list[dict]) -> str:
    """A fingerprint of every shown case, office or not: the overview and the I-140 page read the whole list."""
    from lib_db import canon_hash
    return canon_hash(sorted(_fingerprint(r) for r in rows if int(r.get("shows") or 0)))


class Changes(NamedTuple):
    offices: set[str]   # the offices whose shown cases changed: their own pages are refreshed
    anything: bool      # any shown case changed: the pages reading the whole list are refreshed


def write(db, rows: list[dict], force: bool = False) -> Changes:
    """Bring the stored list to this build: the cases that are new or changed are written, the ones gone are deleted
    by id, and one statement gives every case this build's stamp (the pages' "last built"). Returns what changed: the
    offices whose shown cases changed, and whether any shown case did.

    Only the changes go over the wire: rewriting all of them each hour (20,000 cases by Nov 20 2026) took the build
    from 80 seconds to past its 5-minute limit."""
    from lib_db import query_dicts, query_rows, stmt
    stored = int(query_rows(db, f"SELECT count(*) FROM {TABLE}")[0][0] or 0)  # nosemgrep
    if stored and len(rows) < stored * KEEP_SHARE and not force:
        raise RuntimeError(f"{len(rows)} cases against {stored} stored, more than half gone: the stored list stays")
    stored_rows = query_dicts(db, f"SELECT * FROM {TABLE}")  # nosemgrep
    before, before_all = office_digests(stored_rows), list_digest(stored_rows)
    held = {r["case_id"]: _fingerprint(r) for r in stored_rows}
    ids = {r["case_id"] for r in rows}
    stamp = rows[0]["built_at"] if rows else int(time.time() * 1000)
    sql = f"INSERT OR REPLACE INTO {TABLE} ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})"  # nosemgrep
    reqs = [stmt(sql, [r[c] for c in COLUMNS]) for r in rows if held.get(r["case_id"]) != _fingerprint(r)]
    reqs += [stmt(f"DELETE FROM {TABLE} WHERE case_id = ?", [cid]) for cid in held if cid not in ids]  # nosemgrep
    reqs.append(stmt(f"UPDATE {TABLE} SET built_at = ?", [stamp]))  # nosemgrep
    for i in range(0, len(reqs), 200):
        db.pipeline(reqs[i:i + 200])
    after = office_digests(rows)
    return Changes({o for o in set(before) | set(after) if before.get(o) != after.get(o)},
                   before_all != list_digest(rows))


SUMMARY_TABLE = "reported_summary"


def summary_rows(cases: list[dict], today) -> dict[str, str]:
    """Every summary the pages read (scripts/lib_reported_summary.py), by key, as stored JSON. Counted from every
    member's dates, a private timeline's too, which no figure can trace back to a person."""
    import lib_reported_summary as rs
    return {k: json.dumps(v, sort_keys=True, separators=(",", ":"))
            for k, v in rs.all_summaries([c["figures"] for c in cases], today).items()}


def write_summaries(db, bodies: dict[str, str]) -> set[str]:
    """Store the summaries and drop the ones no longer made. Returns the keys whose figures changed."""
    from lib_db import query_rows, stmt
    db.execute(f"CREATE TABLE IF NOT EXISTS {SUMMARY_TABLE} (key TEXT PRIMARY KEY, body TEXT NOT NULL, built_at INTEGER NOT NULL)")
    stored = {k: b for k, b in query_rows(db, f"SELECT key, body FROM {SUMMARY_TABLE}")}  # nosemgrep
    built = int(time.time() * 1000)
    reqs = [stmt(f"INSERT OR REPLACE INTO {SUMMARY_TABLE} (key, body, built_at) VALUES (?, ?, ?)", [k, b, built])  # nosemgrep
            for k, b in bodies.items()]
    reqs.append(stmt(f"DELETE FROM {SUMMARY_TABLE} WHERE built_at < ?", [built]))  # nosemgrep
    for i in range(0, len(reqs), 200):
        db.pipeline(reqs[i:i + 200])
    return {k for k in set(stored) | set(bodies) if stored.get(k) != bodies.get(k)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="read and merge; write nothing")
    ap.add_argument("--force", action="store_true", help="store a list that lost more than half its cases")
    ap.add_argument("--from-convex", action="store_true",
                    help="also merge the timelines and consulate reports shared on this site (the server's run)")
    a = ap.parse_args()
    started = time.time()
    from lib_db import Database, record_run, stamp_freshness
    db = Database()
    try:
        sources = read_sources(db, convex=a.from_convex)
        cases, counts = build_cases(sources)
        line = (f"{counts['cases']} cases ({counts['people']} people) from {counts['records']} records: "
                f"{counts['merged']} merged across sources, {counts['likely']} likely repeats joined, "
                f"{counts['possible_dupes']} possible repeats kept apart, {counts['left_out']} rows left out")
        print(line, flush=True)
        if a.dry_run:
            from lib_db import et_today
            bodies = summary_rows(cases, dt.date.fromisoformat(et_today()))
            whole = json.loads(bodies["all"])
            print(f"summaries: {len(bodies)} ({sum(k.startswith('office:') for k in bodies)} offices, "
                  f"{sum(k.startswith('post:') for k in bodies)} consulates); {whole['headline']}", flush=True)
            for f in whole["steps"]:
                print(f"  {f['label']}: n={f['n']} window={f['windowDays']} median={f['median']} before={f['before']}", flush=True)
            return 0
        ensure_table(db)
        built = int(time.time() * 1000)
        changed = write(db, [case_row(c, built) for c in cases], force=a.force)
        from lib_db import et_today
        moved = write_summaries(db, summary_rows(cases, dt.date.fromisoformat(et_today())))
        stamp_freshness(db, "reported-cases", source="https://permtracker.app/green-card-timelines",
                        cadence="hourly", note=line, max_age_days=3)
        notes = [line]
        offices = changed.offices | {k.split(":", 1)[1] for k in moved if k.startswith("office:")}
        posts = sorted(k.split(":", 1)[1] for k in moved if k.startswith("post:"))
        if changed.anything or offices or moved:
            from lib_policy_feed import expire_policy_page
            ok = expire_policy_page(print, route="/api/revalidate-timelines",
                                    body={"offices": sorted(offices), "posts": posts})
            notes.append(f"refreshed the list's pages{' and ' + ', '.join(sorted(offices)) if offices else ''}"
                         if ok else "the pages weren't refreshed; their own window will")
        record_run(db, SCRIPT, status="ok", rows_written=len(cases), note="; ".join(notes), started_at=started)
        return 0
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"::error::{msg}", flush=True)
        if not a.dry_run:
            record_run(db, SCRIPT, status="failed", rows_written=None, note=msg, started_at=started)
        return 1


if __name__ == "__main__":
    sys.exit(main())

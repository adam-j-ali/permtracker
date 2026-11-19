#!/usr/bin/env python3
"""Load the public community sheets people keep their own green card cases in (scripts/data/community_sheets.json).

WHY: people waiting on an I-485 at one USCIS field office keep a shared Google Sheet of their own dates (receipt,
biometrics, the move to the office, approval). The "San Fernando Filers" sheet held 131 cases on Nov 19 2026, against
a handful of timelines shared with this site for every office together. The owner asked for all of it (Nov 19 2026).

WHAT GOES IN, AND WHAT NEVER DOES. Every case's dates, category, country, current visa and the yes-or-no columns. The
two columns that point to a person never leave the sheet: the Reddit username and the receipt-number prefix. Rows
are numbered in the sheet's own order, so a reload replaces the set without keeping any key that names anyone.

A SHEET ANYONE CAN EDIT IS A SOURCE THAT CAN BE EMPTIED. A sheet whose headers changed, that holds fewer rows than its
floor, or that lost more than half of what is stored, is refused: the stored copy stays, the run ends red and the
refusal names the reason. Nothing is ever deleted before the new rows are in.

    python3 scripts/ingest_community_sheets.py                 # every sheet, write and refresh the office pages
    python3 scripts/ingest_community_sheets.py --dry-run       # read and parse, write nothing
    python3 scripts/ingest_community_sheets.py --from-file F --sheet sfv-filers --dry-run
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "community_sheets.json")
TABLE = "community_case_reports"
SCRIPT = "ingest_community_sheets.py"
# A stored copy is replaced only by a sheet holding at least this share of it: vandalism or a bad export never wins.
KEEP_SHARE = 0.5

# Each column by its header, matched whole after lowercasing and squeezing spaces. "Status" is the category, and
# "Current Visa Status" is the visa the person holds now, so a header is never matched by a part of it.
HEADERS: dict[str, tuple[str, ...]] = {
    "category": ("status",),
    "visa_availability": ("visa availability",),
    "visa_status": ("current visa status",),
    "priority_date": ("priority date",),
    "receipt_date": ("rd", "receipt date"),
    "biometrics_date": ("bio", "biometrics"),
    "transfer_date": ("transfer",),
    "country": ("country",),
    "dependent": ("dependent",),
    "approval_date": ("approval",),
    "card_date": ("card received",),
}
# Headers whose words run long or change: matched by how they start.
HEADER_PREFIXES: dict[str, tuple[str, ...]] = {
    "silent_updates": ("silent updates",),
    "fta0": ("3rd (or 4th", "fta0", "3rd fta0"),
    "fta1": ("fta1",),
    "rfe": ("rfe",),
    "valid_as_of": ("information valid as of", "valid as of"),
}
REQUIRED = ("category", "receipt_date", "transfer_date", "approval_date")
COLUMNS = ("source", "row_no", "office", "category", "visa_availability", "visa_status", "chargeability", "country",
           "priority_date", "priority_note", "receipt_date", "biometrics_date", "transfer_date", "silent_updates",
           "fta0", "fta1", "rfe", "dependent", "approval_date", "card_date", "valid_as_of", "fetched_at")

CATEGORIES = {"eb-1": "EB-1", "eb1": "EB-1", "eb-2": "EB-2", "eb2": "EB-2", "eb2-niw": "EB-2 NIW", "eb-2 niw": "EB-2 NIW",
              "eb2 niw": "EB-2 NIW", "niw": "EB-2 NIW", "eb-3": "EB-3", "eb3": "EB-3", "eb-1a": "EB-1", "eb1a": "EB-1"}
CHARGEABILITY = {"india": "india", "china": "china", "mexico": "mexico", "philippines": "philippines"}


class Refused(Exception):
    """The sheet can't be stored as it stands; the stored copy stays."""


def norm(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower())


def column_map(header: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for i, h in enumerate(header):
        n = norm(h)
        for field, names in HEADERS.items():
            if field not in out and n in names:
                out[field] = i
        for field, starts in HEADER_PREFIXES.items():
            if field not in out and any(n.startswith(s) for s in starts):
                out[field] = i
    missing = [f for f in REQUIRED if f not in out]
    if missing:
        raise Refused(f"the sheet's columns changed: no {', '.join(missing)} column in {header[:20]}")
    return out


def parse_date(v: str) -> str | None:
    """A whole date as the sheet writes it (11/15/2026, 11/15/26, 11-15-2026), or None."""
    v = (v or "").strip()
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})", v)
    if not m:
        return None
    mo, d, y = int(m[1]), int(m[2]), int(m[3])
    y = y + 2000 if y < 100 else y
    try:
        return dt.date(y, mo, d).isoformat()
    except ValueError:
        return None


def month_days(v: str, after: str | None, before: str) -> list[str]:
    """The "10/12, 10/20" days a cell lists without a year, each placed in the year that falls between `after` (the
    receipt) and `before` (the row's as-of day). A day that fits neither of the two candidate years is left out."""
    out: list[str] = []
    for mo, d, y in re.findall(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", v or ""):
        if y:
            iso = parse_date(f"{mo}/{d}/{y}")
            if iso:
                out.append(iso)
            continue
        hi = dt.date.fromisoformat(before)
        for year in (hi.year, hi.year - 1):
            try:
                c = dt.date(year, int(mo), int(d))
            except ValueError:
                break
            if c <= hi and (after is None or c.isoformat() >= after):
                out.append(c.isoformat())
                break
    return sorted(set(out))


def yes_with_day(v: str, after: str | None, before: str) -> str | None:
    """"Yes (10/12)" as "yes 2026-10-12", "Yes" as "yes", "No" as "no", anything else as None."""
    n = norm(v)
    if not n:
        return None
    if n.startswith("no"):
        return "no"
    days = month_days(v, after, before)
    if n.startswith("yes") or days:
        return "yes" + (f" {days[0]}" if days else "")
    return None


def parse_sheet(data: bytes, sheet: dict, today: str) -> tuple[list[dict], dict]:
    """The rows to store and a count of what was read, skipped and kept as words."""
    rows = list(csv.reader(io.StringIO(data.decode("utf-8", errors="replace"))))
    if not rows:
        raise Refused("the export was empty")
    cols = column_map(rows[0])
    cell = lambda r, f: (r[cols[f]].strip() if f in cols and cols[f] < len(r) else "")  # noqa: E731
    out: list[dict] = []
    counts = {"read": 0, "empty": 0, "priority_words": 0, "bad_dates": 0}
    for r in rows[1:]:
        if not any(c.strip() for c in r):
            continue
        counts["read"] += 1
        receipt = parse_date(cell(r, "receipt_date"))
        category_raw = cell(r, "category")
        if not receipt and not category_raw:
            counts["empty"] += 1
            continue
        valid = parse_date(cell(r, "valid_as_of"))
        # A day listed without a year falls on or before the row's own as-of day (today when it has none).
        before = valid if valid and valid <= today else today
        pd_raw = cell(r, "priority_date")
        pd = parse_date(pd_raw)
        if pd_raw and not pd:
            counts["priority_words"] += 1
        for f in ("biometrics_date", "transfer_date", "approval_date", "card_date"):
            if cell(r, f) and not parse_date(cell(r, f)):
                counts["bad_dates"] += 1
        country = cell(r, "country")
        dep = norm(cell(r, "dependent"))
        out.append({
            "source": sheet["key"], "row_no": len(out) + 1, "office": sheet["office"],
            "category": CATEGORIES.get(norm(category_raw), category_raw or None),
            "visa_availability": cell(r, "visa_availability") or None,
            "visa_status": cell(r, "visa_status") or None,
            "chargeability": CHARGEABILITY.get(norm(country), "row" if country else None),
            "country": country or None,
            "priority_date": pd, "priority_note": None if pd else (pd_raw or None),
            "receipt_date": receipt,
            "biometrics_date": parse_date(cell(r, "biometrics_date")),
            "transfer_date": parse_date(cell(r, "transfer_date")),
            "silent_updates": json.dumps(month_days(cell(r, "silent_updates"), receipt, before)),
            "fta0": yes_with_day(cell(r, "fta0"), receipt, before),
            "fta1": yes_with_day(cell(r, "fta1"), receipt, before),
            "rfe": yes_with_day(cell(r, "rfe"), receipt, before),
            "dependent": 1 if dep.startswith("y") else 0 if dep.startswith("n") else None,
            "approval_date": parse_date(cell(r, "approval_date")),
            "card_date": parse_date(cell(r, "card_date")),
            "valid_as_of": valid,
        })
    if len(out) < sheet.get("min_rows", 1):
        raise Refused(f"{len(out)} cases, under the sheet's floor of {sheet.get('min_rows', 1)}")
    return out, counts


def ensure_table(db) -> None:
    # TABLE is this module's constant, never input.
    # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query
    db.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        source TEXT NOT NULL, row_no INTEGER NOT NULL, office TEXT NOT NULL, category TEXT, visa_availability TEXT,
        visa_status TEXT, chargeability TEXT, country TEXT, priority_date TEXT, priority_note TEXT, receipt_date TEXT,
        biometrics_date TEXT, transfer_date TEXT, silent_updates TEXT, fta0 TEXT, fta1 TEXT, rfe TEXT,
        dependent INTEGER, approval_date TEXT, card_date TEXT, valid_as_of TEXT, fetched_at INTEGER NOT NULL,
        PRIMARY KEY (source, row_no))""")
    # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query
    db.execute(f"CREATE INDEX IF NOT EXISTS {TABLE}_office ON {TABLE} (office, transfer_date)")


def write(db, sheet: dict, rows: list[dict], force: bool = False) -> int:
    """Replace one sheet's rows: the new ones in first, then the stored rows past the new count out."""
    from lib_db import query_rows, stmt
    stored = int(query_rows(db, f"SELECT count(*) FROM {TABLE} WHERE source = ?", [sheet["key"]])[0][0] or 0)  # nosemgrep
    if stored and len(rows) < stored * KEEP_SHARE and not force:
        raise Refused(f"{len(rows)} cases against {stored} stored: more than half gone, so the stored copy stays "
                      f"(run with --force once the sheet is checked)")
    stamp = int(time.time() * 1000)
    placeholders = ", ".join("?" * len(COLUMNS))
    reqs = [stmt(f"INSERT OR REPLACE INTO {TABLE} ({', '.join(COLUMNS)}) VALUES ({placeholders})",  # nosemgrep
                 [*(r[c] for c in COLUMNS[:-1]), stamp]) for r in rows]
    reqs.append(stmt(f"DELETE FROM {TABLE} WHERE source = ? AND row_no > ?", [sheet["key"], len(rows)]))  # nosemgrep
    for i in range(0, len(reqs), 200):
        db.pipeline(reqs[i:i + 200])
    return len(rows)


def load_config(path: str = CONFIG) -> list[dict]:
    with open(path) as fh:
        return json.load(fh)["sheets"]


def export_url(sheet: dict) -> str:
    return f"https://docs.google.com/spreadsheets/d/{sheet['sheet_id']}/export?format=csv&gid={sheet['gid']}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="read and parse; write nothing")
    ap.add_argument("--sheet", help="only this sheet's key")
    ap.add_argument("--from-file", help="parse this CSV instead of fetching; needs --sheet")
    ap.add_argument("--force", action="store_true", help="store a sheet that lost more than half its rows")
    a = ap.parse_args()
    sheets = [s for s in load_config() if not a.sheet or s["key"] == a.sheet]
    if not sheets:
        ap.error(f"no sheet {a.sheet!r} in {CONFIG}")
    if a.from_file and len(sheets) != 1:
        ap.error("--from-file needs --sheet")
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
    started = time.time()
    db = None
    if not a.dry_run:
        from lib_db import Database
        db = Database()
        ensure_table(db)
    failed: list[str] = []
    notes: list[str] = []
    offices: set[str] = set()
    for sheet in sheets:
        try:
            if a.from_file:
                with open(a.from_file, "rb") as fh:
                    data = fh.read()
            else:
                from lib_gov_data import fetch
                data = fetch(export_url(sheet))
            rows, counts = parse_sheet(data, sheet, today)
            approved = sum(1 for r in rows if r["approval_date"])
            line = (f"{sheet['name']}: {len(rows)} cases ({approved} approved), {counts['empty']} empty rows skipped"
                    + (f", {counts['priority_words']} priority dates in words" if counts["priority_words"] else "")
                    + (f", {counts['bad_dates']} dates that don't read" if counts["bad_dates"] else ""))
            print(line, flush=True)
            if db is not None:
                write(db, sheet, rows, force=a.force)
                from lib_db import stamp_freshness
                stamp_freshness(db, f"community-sheet-{sheet['key']}", source=export_url(sheet).split("/export")[0],
                                cadence="hourly", note=line, max_age_days=3)
                offices.add(sheet["office"])
            notes.append(line)
        except Exception as e:  # noqa: BLE001
            # One sheet's trouble never costs the others, and never passes quietly: it ends the run red.
            msg = f"{sheet['name']}: {type(e).__name__}: {str(e)[:200]}"
            print(f"::error::{msg}", flush=True)
            failed.append(msg)
    if db is not None:
        if offices:
            from lib_policy_feed import expire_policy_page
            ok = expire_policy_page(print, route="/api/revalidate-timelines", body={"offices": sorted(offices)})
            if ok is False:
                notes.append("the office pages weren't refreshed; their own window will")
        from lib_db import record_run
        status = "ok" if not failed else ("partial" if notes else "failed")
        record_run(db, SCRIPT, status=status, rows_written=None,
                   note="; ".join(notes + [f"FAILED: {f}" for f in failed]), started_at=started)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

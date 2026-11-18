#!/usr/bin/env python3
"""USCIS's monthly report to Congress: each month's receipts, approvals, denials, pending, pending over six months
and average processing time for six forms (the I-485 by basis, the I-765, I-130, I-360, I-751 and N-400).

USCIS files it under the Consolidated Appropriations Act, 2022 ("FY22 Appropriations Reporting Requirement,
Application Processing Data for <Month YYYY>"), one CSV a month, about seven weeks after the month ends (September
2026's went up Nov 17 2026). It is the only monthly count USCIS publishes for these forms; the quarterly workbooks
(`ingest_uscis_quarterly.py`) carry more forms but four points a year.

WHAT THE FILE SAYS ABOUT ITSELF (its own notes, read Nov 18 2026), which the pages repeat rather than paraphrase:
- "Avg. Processing Time" is months from receipt to completion over everything completed that month, and "may
  differ from processing times reported on other USCIS.gov webpages": it is not the posted 8-in-10 figure.
- Counts "may differ from counts reported in previously published reports" as USCIS revises them, so every month
  the listing still carries is read again on each run and the newer copy replaces the older.
- Some completions "may have been received in previous reporting periods".

DISCOVERED, NEVER CONSTRUCTED: the files have five spellings so far (`Appropriation_Requirement_November_2022.csv`,
`AppropriationRequirementFebruary2023.csv`, `appropriation_requirement_september%202025.csv`, `_v1.0`, `_v1`), so
every address comes from USCIS's own listing, searched under both of the report's names. The listing carried 34
months from Nov 2022 to Sep 2026 on Nov 18 2026, with 13 between them that it doesn't list under any name; the doc
names those months instead of drawing them as zero.

    python3 scripts/ingest_uscis_monthly_forms.py                 # every month the listing carries (daily, on the server)
    python3 scripts/ingest_uscis_monthly_forms.py --file x.csv --month 2026-09   # one local copy, for a check
"""
from __future__ import annotations

import argparse
import calendar
import csv
import io
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lib_gov_data import POLITE_PAUSE_S, fetch, log  # noqa: E402
from lib_db import Database, query_rows, record_run, stamp_freshness, write_doc  # noqa: E402

HOST = "https://www.uscis.gov"
LISTING = HOST + "/tools/reports-and-studies/immigration-and-citizenship-data?items_per_page=100&query="
# The report's two titles on the listing: the older months only under the first, the newer under both.
QUERIES = ("Appropriation", "Application%20Processing%20Data")
TABLE = "uscis_monthly_forms"
DOC = "uscis_monthly_forms"
SCRIPT = "ingest_uscis_monthly_forms.py"

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]
LINK_RE = re.compile(r'href="(/sites/default/files/document/data/[^"]*ppropriation[^"]*\.csv)"', re.I)
NAME_RE = re.compile(r"(" + "|".join(MONTHS) + r")[\s_]*(\d{4})", re.I)
TITLE_RE = re.compile(r"^For the Month of ([A-Za-z]+) (\d{4})\s*$")
FORM_RE = re.compile(r"^[A-Z]-\d{2,4}[A-Z]?$")
# Columns by the header's own words: "Pending Over 6 Months" from 2025, "Pending Over Six Months" before.
COLUMNS = {
    "received": re.compile(r"^Forms Received$", re.I),
    "approved": re.compile(r"^Approvals$", re.I),
    "denied": re.compile(r"^Denials$", re.I),
    "pending": re.compile(r"^Pending$", re.I),
    "pending_6mo": re.compile(r"^Pending Over (6|Six) Months$", re.I),
    "avg_months": re.compile(r"^Avg\.? Processing Time$", re.I),
}
# USCIS posts a month 4 to 7 weeks after it ends (Aug 2026 on Sep 28, Sep 2026 on Nov 17): the newest month's last
# day is stale past 80 days. Our own run failing is the runs check's to catch, not this budget's.
MAX_AGE_DAYS = 80


class Refusal(Exception):
    """The file isn't the report this reads: nothing is stored from it."""


def month_of_name(path: str) -> str | None:
    """'2026-09' from any of the file's spellings; None for another report's file."""
    name = path.rsplit("/", 1)[-1].replace("%20", "_")
    if "ppropriation" not in name.lower():
        return None
    m = NAME_RE.search(name)
    return f"{m.group(2)}-{MONTHS.index(m.group(1).lower()) + 1:02d}" if m else None


def discover_files(pages: list[str]) -> list[tuple[str, str]]:
    """(address, month) for every month the listings carry, oldest first, one file a month."""
    by_month: dict[str, str] = {}
    for html in pages:
        for path in LINK_RE.findall(html):
            month = month_of_name(path)
            if month:
                by_month.setdefault(month, HOST + path)
    if not by_month:
        raise Refusal("no monthly report on USCIS's data listing")
    return [(by_month[k], k) for k in sorted(by_month)]


def number(raw: str, *, decimal: bool = False) -> int | float | None:
    """A figure as USCIS prints it ("17,190", "12.9"); a dash or a blank is no figure, never a zero."""
    s = raw.strip().replace(",", "")
    if s in ("", "-", "--", "N/A", "n/a"):
        return None
    try:
        return float(s) if decimal else int(s)
    except ValueError:
        raise Refusal(f"{raw!r} is not a number") from None


def parse_report(text: str) -> tuple[str, list[dict]]:
    """The report's own month and one dict per form line. Refuses any shape it wasn't built for."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    month = None
    for r in rows[:8]:
        m = TITLE_RE.match((r[0] if r else "").strip())
        if m and m.group(1).lower() in MONTHS:
            month = f"{m.group(2)}-{MONTHS.index(m.group(1).lower()) + 1:02d}"
            break
    if month is None:
        raise Refusal("no 'For the Month of' line: not the monthly report's shape")
    head_at = next((i for i, r in enumerate(rows) if r and r[0].strip() == "Form Number"), None)
    if head_at is None:
        raise Refusal("no 'Form Number' header row")
    header = [c.strip() for c in rows[head_at]]
    cols: dict[str, int] = {}
    for key, rx in COLUMNS.items():
        at = [i for i, c in enumerate(header) if rx.match(c)]
        if len(at) != 1:
            raise Refusal(f"header has no single column for {key}: {header}")
        cols[key] = at[0]
    out: list[dict] = []
    for r in rows[head_at + 1:]:
        if not r or not FORM_RE.match(r[0].strip()):
            continue
        line = r[1].strip()
        basis = re.search(r"\(([^()]+)\)\s*$", line) if r[0].strip() == "I-485" else None
        out.append({
            "form": r[0].strip(),
            "line": line,
            "basis": basis.group(1) if basis else "",
            **{k: number(r[i], decimal=(k == "avg_months")) for k, i in cols.items()},
        })
    if not out:
        raise Refusal("no form rows under the header")
    return month, out


def check_month(named: str, stated: str) -> None:
    if named != stated:
        raise Refusal(f"the file named {named} says it covers {stated}")


def ensure(db: Database) -> None:
    db.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        month TEXT NOT NULL, form TEXT NOT NULL, line TEXT NOT NULL, basis TEXT NOT NULL,
        received INTEGER, approved INTEGER, denied INTEGER, pending INTEGER, pending_6mo INTEGER,
        avg_months REAL, source TEXT NOT NULL,
        PRIMARY KEY (month, form, line))""")
    db.execute("""CREATE TABLE IF NOT EXISTS perm_docs (
        key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER NOT NULL)""")


def store(db: Database, month: str, rows: list[dict], source: str) -> int:
    db.execute(f"DELETE FROM {TABLE} WHERE month = ?", [month])
    for r in rows:
        db.execute(
            f"INSERT INTO {TABLE} (month, form, line, basis, received, approved, denied, pending, pending_6mo, avg_months, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [month, r["form"], r["line"], r["basis"], r["received"], r["approved"], r["denied"], r["pending"],
             r["pending_6mo"], r["avg_months"], source])
    stored = query_rows(db, f"SELECT count(*) FROM {TABLE} WHERE month = ?", [month])
    if int(stored[0][0]) != len(rows):
        raise Refusal(f"{month}: stored {stored[0][0]} of {len(rows)} rows")
    return len(rows)


def months_between(first: str, last: str) -> list[str]:
    y, m = int(first[:4]), int(first[5:])
    out = []
    while f"{y}-{m:02d}" <= last:
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def build_doc(db: Database) -> dict:
    rows = query_rows(db, f"SELECT month, form, line, basis, received, approved, denied, pending, pending_6mo, avg_months "
                          f"FROM {TABLE} ORDER BY form, line, month")
    held = sorted({str(r[0]) for r in rows})
    lines: dict[tuple[str, str], dict] = {}
    for month, form, line, basis, *figs in rows:
        entry = lines.setdefault((str(form), str(line)), {"form": str(form), "line": str(line), "basis": str(basis), "points": []})
        keys = ["received", "approved", "denied", "pending", "pending_6mo", "avg_months"]
        entry["points"].append({"month": str(month), **{k: (None if v is None else (float(v) if k == "avg_months" else int(v))) for k, v in zip(keys, figs)}})
    return {
        "newest": held[-1] if held else None,
        "months": held,
        # Months between the first and the newest that USCIS's listing doesn't carry: named, never drawn as zero.
        "missing": [mo for mo in months_between(held[0], held[-1]) if mo not in held] if held else [],
        "lines": list(lines.values()),
        "source": "USCIS, Report to Congress: Number of Service-Wide Forms by Month, Form Status, and Processing Time",
    }


def finish(db: Database, newest: str, n: int) -> None:
    doc = build_doc(db)
    write_doc(db, DOC, doc)
    y, mo = int(newest[:4]), int(newest[5:])
    stamp_freshness(
        db, "uscis-monthly-forms", as_of=f"{newest}-{calendar.monthrange(y, mo)[1]:02d}",
        source="USCIS monthly report to Congress (uscis.gov)", cadence="Monthly",
        note=f"{len(doc['months'])} months held, {len(doc['missing'])} not listed", max_age_days=MAX_AGE_DAYS)
    record_run(db, SCRIPT, status="ok", rows_written=n, note=f"newest {newest}, {len(doc['months'])} months")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--file", help="a local copy of one month's CSV")
    ap.add_argument("--month", help="the month the --file covers, YYYY-MM")
    args = ap.parse_args(argv)
    db = Database()
    ensure(db)

    if args.file:
        month, rows = parse_report(pathlib.Path(args.file).read_text(encoding="utf-8-sig"))
        if args.month:
            check_month(args.month, month)
        n = store(db, month, rows, pathlib.Path(args.file).name)
        finish(db, month, n)
        log(f"  {month}: {n} rows from {args.file}")
        return 0

    pages = [fetch(LISTING + q).decode("utf8", "ignore") for q in QUERIES]
    files = discover_files(pages)
    log(f"  {len(files)} month(s) listed: {files[0][1]} to {files[-1][1]}")
    total, newest = 0, None
    for url, named in files:
        month, rows = parse_report(fetch(url, referer=LISTING + QUERIES[0]).decode("utf-8-sig", "replace"))
        check_month(named, month)
        total += store(db, month, rows, url.rsplit("/", 1)[-1])
        newest = month
        time.sleep(POLITE_PAUSE_S)
    if newest is None:
        raise Refusal("stored nothing: refusing to report success")
    finish(db, newest, total)
    log(f"  stored {total} rows, newest {newest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

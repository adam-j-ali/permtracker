#!/usr/bin/env python3
"""DOL's quarterly Selected Statistics for PERM and wage requests, read strictly into perm_docs (Batch 4).

    python3 scripts/ingest_dol_selected_stats.py [--dry-run]

Finds each program's newest sheet on OFLC's performance page (the address is discovered there, never built), reads it
with lib_selected_stats, and writes perm_docs['dol_selected_statistics']: {perm, pw, sources, readOn}. These are DOL's
official counts our own are scored against: our live census against "applications remaining", our decisions against
DOL's certified, denied and withdrawn. A sheet already stored (the same file) isn't fetched again, so a day without a
new quarter costs one page read. A sheet that doesn't read keeps the stored copy, and the run ends red with the reason:
a guessed number is worse than none. The server's daily quarterly job runs it (scripts/oracle/bin/permtracker-uscis).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_days import today_et  # noqa: E402
from lib_gov_data import discover_links, fetch, log  # noqa: E402
from lib_selected_stats import SelectedStatsError, parse_perm, parse_pw  # noqa: E402

PAGE = "https://www.dol.gov/agencies/eta/foreign-labor/performance"
HOST = "https://www.dol.gov"
DOC = "dol_selected_statistics"
SCRIPT = "ingest_dol_selected_stats.py"
PROGRAMS = {"perm": ("PERM", parse_perm), "pw": ("PW", parse_pw)}


def newest_sheet(links: dict[str, str], prefix: str) -> tuple[str, str] | None:
    """The newest sheet for a program on the page: the latest fiscal year, then the latest quarter (a sheet named
    without one, like 'FY2021', covers the whole year)."""
    best: tuple[tuple[int, int], str, str] | None = None
    for name, url in links.items():
        m = re.match(rf"^{prefix}_Selected_Statistics_FY_?(\d{{4}})(?:_Q(\d))?\.pdf$", name, re.I)
        if not m:
            continue
        key = (int(m.group(1)), int(m.group(2) or 4))
        if best is None or key > best[0]:
            best = (key, name, url)
    return (best[1], best[2]) if best else None


def read_on() -> str:
    """Today, Eastern, as the ISO day the document stores (today_et gives a date, which JSON can't write)."""
    return today_et().isoformat()


def text_of(pdf: bytes) -> str:
    import pdfplumber  # the server and the Mac both have it; the tests never reach here

    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        if len(doc.pages) != 1:
            raise SelectedStatsError(f"a sheet is one page; this one has {len(doc.pages)}")
        return doc.pages[0].extract_text() or ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="read and print, write nothing")
    args = ap.parse_args()
    started = time.time()

    links = discover_links(fetch(PAGE).decode("utf-8", "replace"), r".*_Selected_Statistics_.*\.pdf$", HOST)
    db = None
    stored: dict = {}
    if not args.dry_run:
        from lib_db import Database, read_doc  # noqa: E402

        db = Database()
        stored = read_doc(db, DOC) or {}
    out = dict(stored)
    sources = dict(stored.get("sources") or {})
    changed: list[str] = []
    problems: list[str] = []
    for key, (prefix, parse) in PROGRAMS.items():
        sheet = newest_sheet(links, prefix)
        if not sheet:
            problems.append(f"no {prefix} sheet on DOL's performance page")
            continue
        name, url = sheet
        if (sources.get(key) or {}).get("file") == name and key in out:
            log(f"  {name}: already read")
            continue
        try:
            got = parse(text_of(fetch(url, referer=PAGE)))
        except SelectedStatsError as exc:
            problems.append(f"{name}: {exc}")
            continue
        out[key] = got
        sources[key] = {"file": name, "url": url}
        changed.append(name)
        log(f"  {name}: as of {got['asOf']}")
    out["sources"] = sources
    out["readOn"] = read_on()

    if args.dry_run:
        print(json.dumps(out, indent=1))
        for p in problems:
            log(f"REFUSED: {p}")
        return 1 if problems else 0

    from lib_db import record_run, write_doc  # noqa: E402

    if changed:
        write_doc(db, DOC, out)
    note = "; ".join(changed) if changed else "nothing new"
    if problems:
        note += "; refused: " + "; ".join(problems)
    landed = record_run(db, SCRIPT, status="failed" if problems else "ok", rows_written=len(changed), note=note,
                        started_at=started)
    for p in problems:
        log(f"REFUSED: {p}")
    return 1 if problems or not landed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Each night, read DOL's disclosure page once and start the load for any file it hasn't listed before.

WHY: DOL posts each quarter's disclosure files a few weeks after the quarter ends, on no fixed day. The loaders
looked only on set days (PERM on the 8th and 20th, the wage, LCA and seasonal files on the 10th and 22nd), so FY2026
Q4, posted between Nov 14 and Nov 17 2026, would have waited days for PERM and weeks for the rest. This reads the one
page each night (a few hundred KB, the address the loaders already read) and dispatches a loader only when a file name
appears that the last night's read didn't list.

ONE LOAD A NIGHT, PERM FIRST. A quarter brings every program's files on one day. The PERM load and the FLAG load
(wage requests, LCAs, H-2A, H-2B, CW-1) each read gigabytes from www.dol.gov and write hundreds of thousands of rows,
and the loaders were scheduled on different mornings on purpose. So a night with new files for both starts PERM, and
the FLAG files stay new until the next night's read starts them.

NIGHT ONLY. GitHub's schedule can start a run hours late. A run outside 1 to 6 AM Eastern reads and reports, starts
nothing and records nothing, so the next night's run starts the load inside the window.

    python3 scripts/watch_disclosure_files.py            # read, compare, dispatch (the nightly workflow)
    python3 scripts/watch_disclosure_files.py --dry-run  # read and compare only
    python3 scripts/watch_disclosure_files.py --seed     # record today's listing as seen, start nothing
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PAGE = "https://www.dol.gov/agencies/eta/foreign-labor/performance"
DOC = "dol_disclosure_listing"
# Every program's main disclosure workbook, as DOL names them ("PERM_Disclosure_Data_FY2026_Q4.xlsx",
# "PERM_Disclosure_Data_New_Form_FY2024_Q4.xlsx", "CW-1_Disclosure_Data_FY2026_Q4.xlsx"). Appendices, addenda and
# worksite files aren't loaded, so they aren't watched.
FILE_RE = re.compile(r"((?:PERM|PW|LCA|H-2A|H-2B|CW-1)_Disclosure_Data_[A-Za-z0-9_]*?FY_?\d{4}[A-Za-z0-9_]*\.xlsx)", re.I)
WORKFLOWS = {"perm": ("perm-disclosure-ingest.yml", []),
             "flag": ("flag-disclosure-ingest.yml", ["-f", "program=all"])}
NIGHT = (1, 6)  # Eastern hours a run may start a load in: from 1 AM to before 6 AM


def listed_files(html: str) -> list[str]:
    """Every main disclosure workbook the page links, each once, sorted."""
    return sorted({m.group(1) for m in FILE_RE.finditer(html)})


def program_of(name: str) -> str:
    return "perm" if name.upper().startswith("PERM_") else "flag"


def plan(listed: list[str], seen: list[str] | None) -> tuple[str | None, list[str]]:
    """What to start tonight, and which names count as seen once it's started.

    No earlier read (`seen` is None) counts every listed file as new: a first read that only recorded the listing
    swallowed FY2026 Q4, posted before the watch began (Nov 20 2026), and the loaders write only what changed, so an
    extra load costs nothing. PERM goes first when it has a new file; the FLAG files go on a night with no new PERM
    file. `--seed` still records a listing without starting anything, by hand."""
    seen = seen or []
    new = [n for n in listed if n not in set(seen)]
    for program in ("perm", "flag"):
        mine = [n for n in new if program_of(n) == program]
        if mine:
            return program, sorted(set(seen) | set(mine))
    return None, list(seen)


def in_night(now: dt.datetime) -> bool:
    hour = now.astimezone(ZoneInfo("America/New_York")).hour
    return NIGHT[0] <= hour < NIGHT[1]


def main() -> int:
    from lib_db import Database, dicts_of, write_doc
    from lib_gov_data import fetch, log

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="read and compare only")
    ap.add_argument("--seed", action="store_true", help="record today's listing as seen and start nothing")
    a = ap.parse_args()

    listed = listed_files(fetch(PAGE).decode("utf-8", "replace"))
    if not listed:
        # A page that lists none means the layout changed or the read was refused: never "nothing new".
        print("::error::DOL's disclosure page listed no disclosure files: the layout changed or the read was refused")
        return 1
    db = Database()
    row = dicts_of(db.execute("SELECT json FROM perm_docs WHERE key = ?", [DOC]))
    seen = json.loads(row[0]["json"])["files"] if row else None
    if a.seed:
        write_doc(db, DOC, {"files": listed, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                            "started": None, "page": PAGE})
        log(f"recorded {len(listed)} files as seen; started nothing")
        return 0
    program, now_seen = plan(listed, seen)
    new = [n for n in listed if seen is not None and n not in set(seen)]
    log(f"DOL lists {len(listed)} disclosure files; new since the last read: {', '.join(new) or 'none'}")
    if a.dry_run:
        log(f"dry run: would start {program or 'nothing'}")
        return 0
    if program and not in_night(dt.datetime.now(dt.timezone.utc)):
        log(f"{program} has a new file, but it's outside 1 to 6 AM Eastern: the next night's run starts it")
        return 0
    if program:
        workflow, inputs = WORKFLOWS[program]
        subprocess.run(["gh", "workflow", "run", workflow, *inputs], check=True)
        log(f"started {workflow}")
    write_doc(db, DOC, {"files": now_seen, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "started": program, "page": PAGE})
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Load the USCIS case-status sample into the database (Batch 3, Nov 25 2026).

    python3 scripts/ingest_uscis_sample.py load <dir>            # sample-cases.csv and sample-figures.json
    python3 scripts/ingest_uscis_sample.py load <dir> --dry-run  # check and count, write nothing
    python3 scripts/ingest_uscis_sample.py load <dir> --figures-only  # the figures now, the cases table at night

The sample is a spread of USCIS receipt numbers checked on USCIS's public Case Status page. Its files are prepared off
this server and copied into <dir>:
- sample-cases.csv: each number with a case, at its newest status, the Eastern day it was checked and the day that
  status was first seen;
- sample-figures.json: the estimated shares by receipt month and by block, each with its margin, and the day it's for.

Each load writes only what changed since the last one (the last loaded file is kept beside the new one): a changed row
is upserted into uscis_sample_cases, a number gone from the file deleted, and a status that changed recorded in
uscis_sample_events (a first sighting isn't a move). The figures go to perm_docs 'uscis_sample_months' and
'uscis_sample_blocks', and 'uscis_sample' holds the day, the count and when it loaded; 'uscis_sample_load' records the
last load of the cases table, which --figures-only (a few small documents, safe in the day) leaves alone. A repeat of
the last day is skipped; an older day, a file under 95% of the last load's cases, figures that disagree with the cases file, and
figures holding any receipt number are refused, leaving the last good load in place. A receipt number reaches a reader
only through that number's own lookup.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT = "ingest_uscis_sample.py"
DATASET = "uscis-sample"
CASE_FIELDS = ("receipt", "form", "grp", "status", "checked_on", "since_on", "month", "kind")
GROUPS = frozenset({"approved", "denied", "withdrawn", "closed", "revoked", "rfe", "waiting", "rejected", "decided", "other"})
RECEIPT = re.compile(r"^[A-Z]{3}[0-9]{10}$")
ANY_RECEIPT = re.compile(r"[A-Z]{3}[0-9]{10}")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHRINK_FLOOR = 0.95
LOADED = "loaded"
DDL = [
    """CREATE TABLE IF NOT EXISTS uscis_sample_cases (
        receipt TEXT PRIMARY KEY, prefix TEXT NOT NULL, block TEXT, form TEXT, grp TEXT NOT NULL, status TEXT NOT NULL,
        checked_on TEXT NOT NULL, since_on TEXT NOT NULL, month TEXT, kind TEXT)""",
    "CREATE INDEX IF NOT EXISTS uscis_sample_cases_block ON uscis_sample_cases (block, grp)",
    """CREATE TABLE IF NOT EXISTS uscis_sample_events (
        receipt TEXT NOT NULL, on_day TEXT NOT NULL, from_grp TEXT, to_grp TEXT NOT NULL, from_status TEXT,
        to_status TEXT NOT NULL, form TEXT, PRIMARY KEY (receipt, on_day, to_status))""",
    "CREATE INDEX IF NOT EXISTS uscis_sample_events_day ON uscis_sample_events (on_day, to_grp)",
]


class SampleError(ValueError):
    """A file the loader refuses; the last good load stays."""


def block_of(receipt: str) -> str | None:
    """An online (IOE) number's 100,000-number block, the way people name it ("IOE09366"); others have none."""
    return receipt[:8] if receipt.startswith("IOE") else None


def read_cases(path: str) -> dict[str, dict]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != CASE_FIELDS:
            raise SampleError(f"sample-cases.csv has the columns {reader.fieldnames}, not {list(CASE_FIELDS)}")
        out: dict[str, dict] = {}
        for i, row in enumerate(reader, start=2):
            if not RECEIPT.match(row["receipt"] or ""):
                raise SampleError(f"line {i}: a malformed receipt")
            if row["grp"] not in GROUPS:
                raise SampleError(f"line {i}: the group '{row['grp']}' isn't one the site knows")
            if not (DAY.match(row["checked_on"] or "") and DAY.match(row["since_on"] or "")):
                raise SampleError(f"line {i}: a day that isn't YYYY-MM-DD")
            out[row["receipt"]] = dict(row)
        return out


def check_figures(figures: dict, *, last: dict | None, cases_read: int) -> str:
    """'load' or 'repeat'; raises SampleError for anything the site mustn't show."""
    as_of = figures.get("as_of")
    if not isinstance(as_of, str) or not DAY.match(as_of):
        raise SampleError("sample-figures.json names no day")
    if figures.get("cases") != cases_read:
        raise SampleError(f"the figures count {figures.get('cases')} cases and the cases file holds {cases_read}")
    if not isinstance(figures.get("by_month"), dict) or not isinstance(figures.get("by_block"), dict):
        raise SampleError("sample-figures.json lacks its month or block estimates")
    check_issued(figures.get("issued", []))
    if ANY_RECEIPT.search(json.dumps(figures)):
        raise SampleError("sample-figures.json holds a receipt number; only a number's own lookup may show one")
    if last:
        if as_of == last.get("as_of"):
            return "repeat"
        if as_of < str(last.get("as_of")):
            raise SampleError(f"the files are for {as_of}, older than the last load's {last.get('as_of')} (out of order)")
        if cases_read < SHRINK_FLOOR * int(last.get("cases") or 0):
            raise SampleError(f"{cases_read:,} cases against the last load's {last.get('cases'):,}: a shrink past 5%")
    return "load"


BLOCK = re.compile(r"^[A-Z]{3}[0-9]{2}$")


def check_issued(runs) -> None:
    """The cases issued between census runs (counted in the sample's own export, Nov 25 2026): each run a day, a block (three letters
    and two digits), a count, the hours since the last edge and the count by form, adding up. Raises SampleError."""
    if not isinstance(runs, list):
        raise SampleError("sample-figures.json's issued runs aren't a list")
    for r in runs:
        ok = (isinstance(r, dict) and isinstance(r.get("day"), str) and DAY.match(r["day"])
              and isinstance(r.get("block"), str) and BLOCK.match(r["block"])
              and isinstance(r.get("issued"), int) and r["issued"] >= 0
              and isinstance(r.get("hours"), (int, float)) and r["hours"] > 0
              and isinstance(r.get("by_form"), dict)
              and all(isinstance(k, str) and isinstance(v, int) and v >= 0 for k, v in r["by_form"].items())
              and sum(r["by_form"].values()) == r["issued"])
        if not ok:
            raise SampleError(f"sample-figures.json holds a malformed issued run: {json.dumps(r)[:120]}")


def diff_cases(prev: dict[str, dict], new: dict[str, dict]) -> tuple[list[dict], list[str], list[dict]]:
    """Rows to upsert (new or changed), receipts to delete (gone from the file), and moves (a changed status)."""
    upserts, events = [], []
    for r, row in new.items():
        old = prev.get(r)
        if old == row:
            continue
        upserts.append(row)
        if old and old["status"] != row["status"]:
            events.append({"receipt": r, "on_day": row["since_on"], "from_grp": old["grp"], "to_grp": row["grp"],
                           "from_status": old["status"], "to_status": row["status"], "form": row["form"]})
    deletes = sorted(set(prev) - set(new))
    return upserts, deletes, events


def write_figures(db, figures: dict, cases: int) -> None:
    from lib_db import stamp_freshness, write_doc

    write_doc(db, "uscis_sample_months", {"as_of": figures["as_of"], "groups": figures.get("groups"),
                                          "by_month": figures["by_month"]})
    write_doc(db, "uscis_sample_blocks", {"as_of": figures["as_of"], "groups": figures.get("groups"),
                                          "by_block": figures["by_block"]})
    if figures.get("issued"):
        write_doc(db, "uscis_sample_issued", {"as_of": figures["as_of"], "runs": figures["issued"]})
    write_doc(db, "uscis_sample", {"as_of": figures["as_of"], "cases": cases, "made_at": figures.get("made_at"),
                                   "loaded_at": int(time.time() * 1000)})
    stamp_freshness(db, DATASET, as_of=figures["as_of"], source="USCIS Case Status Online, a spread of receipt numbers",
                    cadence="Daily", note=f"{cases:,} cases", max_age_days=3)


def load(folder: str, dry_run: bool, figures_only: bool = False) -> int:
    from lib_db import Database, read_doc, record_run, run_stmts, stmt, write_doc

    started = time.time()
    db = Database()
    cases_path = os.path.join(folder, "sample-cases.csv")
    figures = json.load(open(os.path.join(folder, "sample-figures.json"), encoding="utf-8"))
    new = read_cases(cases_path)
    last = read_doc(db, "uscis_sample" if figures_only else "uscis_sample_load")
    verdict = check_figures(figures, last=last, cases_read=len(new))
    if verdict == "repeat":
        print(f"already loaded {figures['as_of']}; nothing to do")
        return 0
    if figures_only:
        print(f"{figures['as_of']}: the figures for {len(new):,} cases" + (" (dry run)" if dry_run else ""))
        if not dry_run:
            write_figures(db, figures, len(new))
            record_run(db, SCRIPT, status="ok", rows_written=3, note=f"{figures['as_of']}: figures only", started_at=started)
        return 0
    prev_path = os.path.join(folder, LOADED, "sample-cases.csv")
    prev = read_cases(prev_path) if os.path.exists(prev_path) and last else {}
    upserts, deletes, events = diff_cases(prev, new)
    print(f"{figures['as_of']}: {len(new):,} cases, {len(upserts):,} to write, {len(deletes):,} to delete, "
          f"{len(events):,} moves")
    if dry_run:
        return 0
    db.script(DDL)
    put = ("INSERT OR REPLACE INTO uscis_sample_cases (receipt, prefix, block, form, grp, status, checked_on, since_on, "
           "month, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    statements = [stmt(put, [r["receipt"], r["receipt"][:3], block_of(r["receipt"]), r["form"] or None, r["grp"],
                             r["status"], r["checked_on"], r["since_on"], r["month"] or None, r["kind"] or None])
                  for r in upserts]
    statements += [stmt("DELETE FROM uscis_sample_cases WHERE receipt = ?", [r]) for r in deletes]
    statements += [stmt("INSERT OR IGNORE INTO uscis_sample_events (receipt, on_day, from_grp, to_grp, from_status, "
                        "to_status, form) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [e["receipt"], e["on_day"], e["from_grp"], e["to_grp"], e["from_status"], e["to_status"],
                         e["form"] or None]) for e in events]
    # One transaction a request: each case committed alone ran about 150 a second on the server, so the first full load
    # (1.47 million cases) stopped at its 30 minutes with 275,000 written (Nov 26 2026); in one, about 5,000 a second.
    run_stmts(db, statements, per_request=500, one_commit=True)
    write_figures(db, figures, len(new))
    write_doc(db, "uscis_sample_load", {"as_of": figures["as_of"], "cases": len(new), "loaded_at": int(time.time() * 1000)})
    os.makedirs(os.path.join(folder, LOADED), exist_ok=True)
    shutil.copyfile(cases_path, prev_path + ".tmp")
    os.replace(prev_path + ".tmp", prev_path)
    note = f"{figures['as_of']}: {len(new):,} cases, {len(upserts):,} written, {len(deletes):,} deleted, {len(events):,} moves"
    landed = record_run(db, SCRIPT, status="ok", rows_written=len(upserts) + len(deletes) + len(events), note=note,
                        started_at=started)
    return 0 if landed else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("load")
    p.add_argument("folder")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--figures-only", action="store_true", help="write the figures, leave the cases table for the night")
    args = ap.parse_args()
    try:
        return load(args.folder, args.dry_run, args.figures_only)
    except SampleError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        from lib_db import Database, record_run

        record_run(Database(), SCRIPT, status="failed", rows_written=0, note=f"refused: {exc}"[:500])
        return 1


if __name__ == "__main__":
    sys.exit(main())

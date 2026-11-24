#!/usr/bin/env python3
"""USCIS's published figures as one file, for a reader with no database access.

Copies three things the USCIS ingests store into one JSON file: the monthly report's doc
(perm_docs['uscis_monthly_forms']) as stored, every row of uscis_form_quarters, and both freshness rows. It adds
each month's source file and the export's time. A reader can then fetch exactly the figures the site holds, and score
against the copy it names, with no database token and no sudo.

The file is written by an atomic rename, mode 644 in a 755 folder, so a reader sees the old file or the new one and
never half of either. A missing or unreadable monthly doc, a doc with no months, or no quarterly rows stops the run with
an error and leaves the last good file in place: a failed read is never an empty export.

    python3 scripts/export_uscis_published.py                      # the server's default path
    python3 scripts/export_uscis_published.py --out /tmp/x.json    # anywhere else
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lib_days import today_et  # noqa: E402
from lib_db import Database, query_dicts, query_rows, read_doc, record_run  # noqa: E402

SCRIPT = "export_uscis_published.py"
DEFAULT_OUT = pathlib.Path("/srv/permtracker/app/exports/uscis_published.json")
DATASETS = ("uscis-monthly-forms", "uscis-form-quarters")


class ExportRefused(ValueError):
    """The stored figures can't make a whole export; the last good file stays."""


def build_export(monthly: dict | None, quarters: list[dict], freshness: list[dict], monthly_sources: dict[str, str],
                 now: dt.datetime) -> dict:
    if not monthly or not monthly.get("months"):
        raise ExportRefused("the monthly report's doc is missing or holds no months")
    if not quarters:
        raise ExportRefused("uscis_form_quarters holds no rows")
    instant = now.astimezone(dt.timezone.utc)
    return {
        "exported_at": instant.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "exported_day_et": today_et(instant).isoformat(),
        "counts": {"months": len(monthly["months"]), "quarter_rows": len(quarters)},
        "monthly": monthly,
        "monthly_sources": monthly_sources,
        "quarters": quarters,
        "freshness": freshness,
    }


def write_atomic(path: pathlib.Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o755)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def read_all(db: Database) -> tuple[dict | None, list[dict], list[dict], dict[str, str]]:
    monthly = read_doc(db, "uscis_monthly_forms")
    quarters = query_dicts(db, "SELECT * FROM uscis_form_quarters ORDER BY fy, quarter, form, title", typed=True)
    marks = ", ".join("?" for _ in DATASETS)
    freshness = query_dicts(db, f"SELECT * FROM data_freshness WHERE dataset IN ({marks}) ORDER BY dataset",
                            list(DATASETS), typed=True)
    sources = {str(m): str(s) for m, s in query_rows(
        db, "SELECT month, MAX(source) FROM uscis_monthly_forms GROUP BY month ORDER BY month")}
    return monthly, quarters, freshness, sources


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    db = Database()
    try:
        doc = build_export(*read_all(db), dt.datetime.now(dt.timezone.utc))
    except ExportRefused as e:
        print(f"{SCRIPT}: not written, {e}; the last good file stays", file=sys.stderr)
        return 1
    write_atomic(args.out, doc)
    note = f"{doc['counts']['months']} months, {doc['counts']['quarter_rows']} quarterly rows to {args.out}"
    record_run(db, SCRIPT, status="ok", rows_written=doc["counts"]["quarter_rows"], note=note)
    print(f"{SCRIPT}: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

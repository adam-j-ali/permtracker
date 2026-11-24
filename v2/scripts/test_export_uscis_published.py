#!/usr/bin/env python3
"""The export of USCIS's published figures is whole or absent, never empty or half written.

export_uscis_published.py copies the monthly report's stored doc, every quarterly row and their freshness stamps into
one file a reader with no database access fetches. These hold:

* the file carries the monthly doc as stored, each quarterly row, the freshness rows, each month's source file and
  the export's instant and Eastern day;
* a missing monthly doc, a doc with no months, or no quarterly rows stops the export, so the last good file stays;
* the write is atomic: a reader sees the old file or the new one, the file is mode 644 in a 755 folder, and a failed
  write leaves the old file untouched and no temporary file behind.

Run: python3 scripts/test_export_uscis_published.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import stat
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import export_uscis_published as ex  # noqa: E402

failures: list[str] = []


def check(cond: bool, what: str) -> None:
    if not cond:
        failures.append(what)


MONTHLY = {"newest": "2026-09", "months": ["2026-08", "2026-09"], "missing": [],
           "lines": [{"form": "I-765", "line": "All", "basis": "All",
                      "points": [{"month": "2026-09", "received": 10, "approved": 5, "denied": 1, "pending": 40,
                                  "pending_6mo": 12, "avg_months": 2.5}]}],
           "source": "USCIS, Report to Congress"}
QUARTERS = [{"fy": 2026, "quarter": 3, "form": "I-140", "title": "Immigrant petition", "category": "Employment",
             "quarter_start": "2026-04-01", "quarter_end": "2026-06-30", "received": 100, "approved": 80,
             "denied": 5, "completed": 85, "pending": 300, "median_months": 6.1, "ytd_received": 300,
             "ytd_approved": 240, "ytd_denied": 15, "ytd_completed": 255, "ytd_pending": 300,
             "source_file": "quarterly_all_forms_fy2026_q3_v1.xlsx"}]
FRESH = [{"dataset": "uscis-monthly-forms", "as_of": "2026-09-30", "fetched_at": 1, "source": "s", "cadence": "Monthly",
          "note": "n", "max_age_days": 75}]
SOURCES = {"2026-08": "aug.csv", "2026-09": "sep.csv"}
NOW = dt.datetime(2026, 11, 25, 3, 30, tzinfo=dt.timezone.utc)  # 10:30 PM Eastern on Nov 24


def test_build() -> None:
    doc = ex.build_export(MONTHLY, QUARTERS, FRESH, SOURCES, NOW)
    check(doc["monthly"] == MONTHLY, "the monthly doc is carried as stored")
    check(doc["quarters"] == QUARTERS, "every quarterly row is carried")
    check(doc["freshness"] == FRESH, "the freshness rows are carried")
    check(doc["monthly_sources"] == SOURCES, "each month's source file is named")
    check(doc["exported_at"] == "2026-11-25T03:30:00Z", f"the instant is UTC with a Z: {doc['exported_at']}")
    check(doc["exported_day_et"] == "2026-11-24", f"the day is the Eastern day: {doc['exported_day_et']}")
    check(doc["counts"] == {"months": 2, "quarter_rows": 1}, f"counts: {doc['counts']}")


def test_refusals() -> None:
    for monthly, quarters, what in ((None, QUARTERS, "a missing monthly doc"),
                                    ({**MONTHLY, "months": []}, QUARTERS, "a monthly doc with no months"),
                                    (MONTHLY, [], "no quarterly rows")):
        try:
            ex.build_export(monthly, quarters, FRESH, SOURCES, NOW)
        except ex.ExportRefused:
            continue
        failures.append(f"{what} must stop the export")


def test_write() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "exports" / "uscis_published.json"
        ex.write_atomic(out, {"a": 1})
        check(json.loads(out.read_text()) == {"a": 1}, "the file reads back")
        check(stat.S_IMODE(out.stat().st_mode) == 0o644, f"file mode {oct(stat.S_IMODE(out.stat().st_mode))}")
        check(stat.S_IMODE(out.parent.stat().st_mode) == 0o755, "folder mode 755")
        ex.write_atomic(out, {"a": 2})
        check(json.loads(out.read_text()) == {"a": 2}, "a second write replaces the first")

        class Boom:  # json.dump fails part way: the old file must survive, with no temporary file left
            pass
        try:
            ex.write_atomic(out, {"a": Boom()})
            failures.append("an unserializable doc must raise")
        except TypeError:
            pass
        check(json.loads(out.read_text()) == {"a": 2}, "a failed write keeps the old file")
        left = [p.name for p in out.parent.iterdir() if p.name != out.name]
        check(not left, f"no temporary file left: {left}")


def main() -> int:
    os.umask(0o077)  # the server's umask can be strict; the modes must not depend on it
    test_build()
    test_refusals()
    test_write()
    for f in failures:
        print("FAIL", f)
    print(f"{'FAILED' if failures else 'ok'}: export_uscis_published, {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""build_filings_by_day.py: one count a day, a case counted once, live first.

* `merge` sums each list onto its day, keeps the waiting and the files' own counts apart, and drops empty days;
* the whole read, on SQLite: a case in the live table counts on its live day even when a file dates it otherwise
  (and is a mismatch there), a case only in a file counts on the file's day, a case in two files counts once.

Run: python3 scripts/test_filings_by_day.py
"""
from __future__ import annotations

import pathlib
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_filings_by_day as b  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


rows = b.merge([("2026-11-04", 10, 7), ("2026-11-05", "3", "3")], [("2026-11-04", 2), ("2026-10-01", 5)],
               [("2026-11-04", 1)])
check("days in order, each list on its day", rows == [["2026-10-01", 5, 0, 5, 0], ["2026-11-04", 12, 7, 2, 1],
                                                    ["2026-11-05", 3, 3, 0, 0]], str(rows))
check("an empty or unreadable day is left out", b.merge([("2026-11-04", 0, 0), (None, 4, 0), ("bad", 2, 0)], [], []) == [])


class Lite:
    """Database.execute over SQLite, in the shape rows_of reads, so query_rows runs the real SQL."""

    def __init__(self) -> None:
        self.c = sqlite3.connect(":memory:")

    def execute(self, sql, args=()):
        cur = self.c.execute(sql, list(args))
        data = cur.fetchall()
        return {"response": {"result": {
            "cols": [{"name": d[0]} for d in (cur.description or [])],
            "rows": [[{"type": "null"} if v is None else {"type": "text", "value": str(v)} for v in r] for r in data]}}}


db = Lite()
db.c.executescript("""
CREATE TABLE perm_case_status (case_number TEXT PRIMARY KEY, filing_date TEXT, is_final INTEGER);
CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, received_date TEXT);
CREATE TABLE perm_cases_history (case_number TEXT PRIMARY KEY, received_date TEXT);
INSERT INTO perm_case_status VALUES ('G-1', '2026-03-02', 0), ('G-2', '2026-03-02', 1), ('G-3', '2026-03-03', 1);
INSERT INTO perm_cases VALUES ('G-2', '2026-03-02'), ('G-3', '2026-03-02'), ('G-4', '2026-03-02'), ('G-5', '2024-01-08');
INSERT INTO perm_cases_history VALUES ('G-5', '2024-01-09'), ('A-6', '2020-05-01');
""")
try:
    got, meta = b.program_days(db, b.PROGRAMS["perm"], "2019-10-01", "2026-11-05")
except Exception as e:  # noqa: BLE001 (a fake that can't run the SQL is a failed check, not a crash)
    got, meta = [], {}
    check("the read runs", False, repr(e))
by = {r[0]: r[1:] for r in got}
check("a live case counts on its live day, and its file's other day is a mismatch there",
      by.get("2026-03-03") == [1, 0, 0, 1], str(by))
check("the live day keeps its waiting count; a file-only case adds to the filed count",
      by.get("2026-03-02") == [3, 1, 1, 0], str(by))
check("a case in two files counts once, on the first file's day", by.get("2024-01-08") == [1, 0, 1, 0]
      and "2024-01-09" not in by, str(by))
check("a case only in the older file counts on its day", by.get("2020-05-01") == [1, 0, 1, 0], str(by))
check("the live record's first day is reported", meta.get("liveFrom") == "2026-03-02", str(meta))


# An H-2B and a CW-1 wage request sit in DOL's prevailing wage file; their live rows are under seasonal. They count
# under seasonal and never under wage requests, so no case is filed twice (Nov 20 2026).
db2 = Lite()
db2.c.executescript("""
CREATE TABLE pwd_case_status (case_number TEXT PRIMARY KEY, filing_date TEXT, is_final INTEGER);
CREATE TABLE seasonal_case_status (case_number TEXT PRIMARY KEY, filing_date TEXT, is_final INTEGER);
CREATE TABLE pwd_cases (case_number TEXT PRIMARY KEY, received_date TEXT);
CREATE TABLE seasonal_cases (case_number TEXT PRIMARY KEY, received_date TEXT);
INSERT INTO pwd_case_status VALUES ('P-100-26001-000001', '2026-01-02', 0);
INSERT INTO seasonal_case_status VALUES ('P-400-26001-000002', '2026-01-02', 1), ('H-300-26001-000003', '2026-01-02', 0);
INSERT INTO pwd_cases VALUES ('P-100-26001-000009', '2026-01-02'), ('P-400-26001-000002', '2026-01-02'),
                             ('P-400-26001-000004', '2026-01-02'), ('P-500-26001-000005', '2026-01-02');
INSERT INTO seasonal_cases VALUES ('H-400-26001-000006', '2026-01-02');
""")
pwd_days, _ = b.program_days(db2, b.PROGRAMS["pwd"], "2019-10-01", "2026-11-05")
season_days, _ = b.program_days(db2, b.PROGRAMS["seasonal"], "2019-10-01", "2026-11-05")
check("a wage request day counts only the ETA-9141 queue's own numbers", {r[0]: r[1:] for r in pwd_days}.get("2026-01-02") == [2, 1, 1, 0],
      str(pwd_days))
check("the H-2B and CW-1 wage requests count under seasonal, each once",
      {r[0]: r[1:] for r in season_days}.get("2026-01-02") == [5, 1, 3, 0], str(season_days))
check("the boundary is the site's", "SEASONAL_WAGE_REQUEST_FROM = \"P-400-\"" in (pathlib.Path(__file__).parent / "lib_flag_serials.py").read_text()
      and 'SEASONAL_WAGE_REQUEST_FROM = "P-400-"' in (pathlib.Path(__file__).parent.parent / "src" / "lib" / "wageRequestRanges.ts").read_text())

sys.exit(1 if failures else 0)

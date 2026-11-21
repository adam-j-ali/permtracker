#!/usr/bin/env python3
"""The alphabet chart's filing months from January 2023 count the older PERM table's cases too.

build_alphabet.py reads filing months from SINCE_MONTH (2023-01) in perm_cases, which holds decisions from October
2023 on, so January to September 2023 kept only their slow cases: their fast ones were decided before October 2023
and sit in perm_cases_history (the Nov 20 2026 sweep, item 27). The older table changes only when a history file
loads, so its cases from SINCE_MONTH on are counted once, by filing month and employer initial, into
perm_history_alphabet, and the chart adds them.

Run:  python3 scripts/test_alphabet_history.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_alphabet as bal  # noqa: E402
import ingest_perm_history as iph  # noqa: E402
import sqlite3  # noqa: E402

FAILURES: list[str] = []


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


def plain(a: dict):
    t, v = a.get("type"), a.get("value")
    if t == "null":
        return None
    if t == "integer":
        return int(v)
    if t == "float":
        return float(v)
    return v


def cell(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    return {"type": "text", "value": str(v)}


class SqliteDb:
    """Enough of lib_db.Database for these functions: execute and pipeline on a real SQLite."""

    def __init__(self):
        self.conn = sqlite3.connect(":memory:")
        self.statements: list[str] = []

    def _run(self, sql, args):
        self.statements.append(sql)
        cur = self.conn.execute(sql, args or [])
        rows = cur.fetchall()
        self.conn.commit()
        return {"cols": [{"name": d[0]} for d in (cur.description or [])],
                "rows": [[cell(v) for v in r] for r in rows], "affected_row_count": cur.rowcount}

    def execute(self, sql, args=None):
        return {"response": {"result": self._run(sql, args)}}

    def pipeline(self, requests, **_):
        out = []
        for r in requests:
            if r.get("type") != "execute":
                out.append({})
                continue
            s = r["stmt"]
            out.append({"response": {"result": self._run(s["sql"], [plain(a) for a in s.get("args", [])])}})
        return {"results": out}


def seed() -> SqliteDb:
    db = SqliteDb()
    db.conn.executescript("""
        CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, employer_name TEXT, received_date TEXT, days INTEGER);
        CREATE TABLE perm_cases_history (case_number TEXT PRIMARY KEY, status TEXT, employer_name TEXT,
                                         received_date TEXT, decision_date TEXT, days INTEGER);
        CREATE INDEX idx_pch_recv ON perm_cases_history(received_date);
        CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);
    """)
    # February 2023: the fast A and Z cases were decided before October 2023 (older table), the slow ones after.
    hist = [("h-a1", "Certified", "Acme", "2023-02-03", "2023-08-01", 100),
            ("h-a2", "Certified", " apex ", "2023-02-14", "2023-08-02", 110),
            ("h-z1", "Certified", "Zeta", "2023-02-25", "2023-08-03", 140),
            ("h-dup", "Certified", "Acme", "2023-02-05", "2023-08-04", 400),   # also in perm_cases
            ("h-old", "Certified", "Acme", "2022-12-20", "2023-04-01", 90),    # before SINCE_MONTH
            ("h-nod", "Certified", "Acme", "2023-02-06", "2023-04-01", None)]  # no days
    db.conn.executemany("INSERT INTO perm_cases_history VALUES (?, ?, ?, ?, ?, ?)", hist)
    cur = [("c-a1", "Alpha", "2023-02-10", 400), ("c-z1", "Zulu", "2023-02-11", 420),
           ("h-dup", "Acme", "2023-02-05", 400)]
    db.conn.executemany("INSERT INTO perm_cases VALUES (?, ?, ?, ?)", cur)
    return db


print("the older table's cases from the chart's first filing month, by month and initial")
db = seed()
n = iph.build_alphabet_history(db)
rows = db.conn.execute("SELECT month, letter, n, sum_days FROM perm_history_alphabet ORDER BY month, letter").fetchall()
check("February 2023's A cases from the older table, trimmed and upper-cased",
      ("2023-02", "A", 2, 210.0) in rows, str(rows))
check("its Z case", ("2023-02", "Z", 1, 140.0) in rows, str(rows))
check("a case perm_cases also holds, a month before the chart's first, and a case with no days are left out",
      all(r[0] >= bal.SINCE_MONTH for r in rows) and sum(r[2] for r in rows) == 3, str(rows))
check("the builder says how many rows it wrote", n == len(rows), f"{n} vs {len(rows)}")
check("it reads the older table in filing-day slices, never one grouping",
      not any("FROM perm_cases_history" in s and "received_date >=" not in s and "MIN(" not in s and "MAX(" not in s
              for s in db.statements), str([s for s in db.statements if "perm_cases_history" in s][:3]))

print("the chart counts both tables")
bal.MIN_CASES, bal.MIN_CASES_PER_MONTH = 1, 1
doc = bal.build(db)
by = {r["letter"]: r for r in doc["letters"]}
check("A counts the older table's two fast cases with perm_cases' two", by["A"]["cases"] == 4, str(by.get("A")))
check("A's mean is over all four (100, 110, 400, 400)", by["A"]["meanDays"] == 252.5, str(by.get("A")))
check("Z counts both (140 and 420)", by["Z"]["cases"] == 2 and by["Z"]["meanDays"] == 280.0, str(by.get("Z")))
gap = {g["month"]: g for g in doc["monthlyGaps"]}.get("2023-02")
check("February 2023's gap compares both tables' ends (Z 280 against A 252.5)",
      gap is not None and gap["gapDays"] == 27.5 and gap["cases"] == 6, str(gap))

print("before the older table's counts exist, the chart reads perm_cases alone")
bare = seed()
doc = bal.build(bare)
by = {r["letter"]: r for r in doc["letters"]}
check("A from perm_cases alone", by["A"]["cases"] == 2, str(by.get("A")))

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

#!/usr/bin/env python3
"""The case page's "how the rest of its filing month went" counts both PERM tables.

A month filed before October 2023 had its fast cases decided before then, so they sit in perm_cases_history, and
the percentiles read from perm_cases alone came out slow (the Nov 20 2026 sweep, item 26). The older table changes
only when a history file loads, so its days are counted once into perm_history_month_days, a month at a time on the
received_date index, and the month document merges those counts with perm_cases' own.

Run:  python3 scripts/test_history_month_days.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest_case_status_direct as icsd  # noqa: E402
import ingest_perm_history as iph  # noqa: E402

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
        return {"rows": [[cell(v) for v in r] for r in rows], "affected_row_count": cur.rowcount}

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
        CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, received_date TEXT, days INTEGER);
        CREATE TABLE perm_cases_history (case_number TEXT PRIMARY KEY, status TEXT, received_date TEXT,
                                         decision_date TEXT, days INTEGER);
        CREATE INDEX idx_pch_recv ON perm_cases_history(received_date);
        CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);
    """)
    # January 2023: the fast half was decided before October 2023 (the older table), the slow half after.
    hist = [(f"G-100-23001-{i:06d}", "Certified", "2023-01-10", "2023-06-01", d)
            for i, d in enumerate([100, 120, 140, 160, 180, 200])]
    hist += [("G-100-23001-999999", "Certified", "2023-01-20", "2023-09-01", 230),  # also in perm_cases
             ("G-100-23001-888888", "Certified", "2023-01-21", "2023-09-02", None),  # no days
             ("G-100-23001-777777", "Certified", None, "2023-09-03", 50),            # no received day
             ("G-100-22300-000001", "Certified", "2022-12-31", "2023-05-01", 130)]   # another month
    db.conn.executemany("INSERT INTO perm_cases_history VALUES (?, ?, ?, ?, ?)", hist)
    cur = [(f"G-100-23001-5{i:05d}", "2023-01-15", d) for i, d in enumerate([400, 420, 440, 460, 480, 500])]
    cur += [("G-100-23001-999999", "2023-01-20", 230),
            ("G-100-24001-000001", "2024-01-05", 300), ("G-100-24001-000002", "2024-01-06", 310)]
    db.conn.executemany("INSERT INTO perm_cases VALUES (?, ?, ?)", cur)
    return db


print("percentiles from counts, by the same nearest-rank positions as the SQL")
got = icsd.percentiles_from_counts({1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1})
check("eight days: n 8, p25 the 2nd, p50 the 4th, p75 the 6th", got == (8, 2, 4, 6), str(got))
got = icsd.percentiles_from_counts({10: 3})
check("one value three times: every percentile is it", got == (3, 10, 10, 10), str(got))
got = icsd.percentiles_from_counts({5: 2, 1: 1})
check("counts are ordered by day, never by insertion", got == (3, 1, 5, 5), str(got))
check("no cases: n 0 and no percentiles", icsd.percentiles_from_counts({}) == (0, None, None, None))

print("the older table's days, counted once per filing month")
db = seed()
n = iph.build_month_days(db)
rows = db.conn.execute("SELECT m, days, n FROM perm_history_month_days ORDER BY m, days").fetchall()
jan = {d: c for m, d, c in rows if m == "2023-01"}
check("January 2023 holds the six older cases' days", jan == {100: 1, 120: 1, 140: 1, 160: 1, 180: 1, 200: 1},
      str(jan))
check("a case the newer table also holds is counted once, there", 230 not in jan, str(jan))
check("a case with no days or no filing day is left out", 50 not in jan and None not in jan, str(rows))
check("December 2022 is its own month", ("2022-12", 130, 1) in rows, str(rows))
check("the builder says how many rows it wrote", n == len(rows), f"{n} vs {len(rows)}")
reads = [s for s in db.statements if "FROM perm_cases_history" in s and "received_date >=" in s]
check("it reads a month at a time on the filing-day range", len(reads) >= 2, str(len(reads)))
check("no read groups the whole older table at once",
      not any("GROUP BY substr(received_date" in s and "FROM perm_cases_history" in s for s in db.statements))
iph.build_month_days(db)
again = db.conn.execute("SELECT COUNT(*) FROM perm_history_month_days").fetchone()[0]
check("rebuilding replaces the table, never doubles it", again == len(rows), f"{again} vs {len(rows)}")

print("the month document counts both tables")
icsd.write_decided_percentiles(db)
doc = json.loads(db.conn.execute("SELECT json FROM perm_docs WHERE key = 'decided_month_percentiles'").fetchone()[0])
by = {m["m"]: m for m in doc["months"]}
jan = by.get("2023-01", {})
# Merged January: 100 120 140 160 180 200 230 400 420 440 460 480 500 (13 cases, 230 once).
check("January 2023 counts the older table's fast cases", jan.get("n") == 13, json.dumps(jan))
check("its median comes from both tables (the 7th of 13 is 230)", jan.get("p50") == 230, json.dumps(jan))
check("its p25 is the 3rd (140), not the newer table's slow 420", jan.get("p25") == 140, json.dumps(jan))
check("a month only the newer table holds is unchanged", by.get("2024-01", {}).get("n") == 2, json.dumps(by))
check("a month only the older table holds is there too", by.get("2022-12", {}).get("n") == 1, json.dumps(by))

print("without the older table's counts (a database before the history load) it reads the newer table alone")
bare = seed()
icsd.write_decided_percentiles(bare)
doc = json.loads(bare.conn.execute("SELECT json FROM perm_docs WHERE key = 'decided_month_percentiles'").fetchone()[0])
jan = {m["m"]: m for m in doc["months"]}.get("2023-01", {})
check("January 2023 from the newer table alone", jan.get("n") == 7, json.dumps(jan))

print("on the newer table alone, the new statement gives what the old window-function one did")
import random  # noqa: E402

OLD_SQL = """
    WITH f AS (SELECT substr(received_date, 1, 7) AS m, days FROM perm_cases
                WHERE days IS NOT NULL AND received_date IS NOT NULL AND received_date <> ''),
         o AS (SELECT m, days, ROW_NUMBER() OVER (PARTITION BY m ORDER BY days) AS rn,
                      COUNT(*) OVER (PARTITION BY m) AS n FROM f)
    SELECT m, MAX(n), MAX(CASE WHEN rn = MAX(1, n / 4) THEN days END),
           MAX(CASE WHEN rn = (n + 1) / 2 THEN days END), MAX(CASE WHEN rn = MAX(1, n * 3 / 4) THEN days END)
      FROM o GROUP BY m ORDER BY m"""
rng = random.Random(20261121)
for trial in range(25):
    r = SqliteDb()
    r.conn.executescript("CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, received_date TEXT, days INTEGER);"
                         "CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);")
    rows = [(f"c{i}", f"2024-{rng.randint(1, 4):02d}-{rng.randint(1, 28):02d}", rng.choice([None, *range(0, 60)]))
            for i in range(rng.randint(1, 300))]
    r.conn.executemany("INSERT INTO perm_cases VALUES (?, ?, ?)", rows)
    want = [{"m": m, "n": n, "p25": a, "p50": b, "p75": c} for m, n, a, b, c in r.conn.execute(OLD_SQL).fetchall()]
    icsd.write_decided_percentiles(r)
    got = json.loads(r.conn.execute("SELECT json FROM perm_docs").fetchone()[0])["months"]
    if got != want:
        check(f"random corpus {trial} matches the old statement", False, f"{got} vs {want}")
        break
else:
    check("25 random corpora give the old statement's months exactly", True)

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

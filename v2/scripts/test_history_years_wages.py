#!/usr/bin/env python3
"""The older PERM table's year totals and wage cells, counted once at the history load.

/perm-cases read FY2024 on: its headline total, its fiscal-year list and its outcome counts left out FY2008 to
FY2023, and a case page's wage ladder had nothing to place an older case in (the Nov 20 2026 sweep, items 20 and 21).
The older table changes only when a history file loads, so one pass over it, five decision days at a time on
idx_pch_dec, writes two small things: perm_docs['perm_history_years'] (each fiscal year's cases by outcome, and
each worksite state's) and perm_history_wage_cells (each fiscal year's certified wages by occupation, nationally and
by state, as percentiles). Every published decision counts, as /perm-cases lists it.

Run:  python3 scripts/test_history_years_wages.py
"""
from __future__ import annotations

import json
import random
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest_perm_history as iph  # noqa: E402

FAILURES: list[str] = []


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
    """Enough of lib_db.Database for the builder: execute, pipeline and scalar on a real SQLite."""

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


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


def seed(rows: list[tuple], current: list[str] = ()) -> SqliteDb:
    db = SqliteDb()
    db.conn.executescript("""
        CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY);
        CREATE TABLE perm_cases_history (case_number TEXT PRIMARY KEY, status TEXT NOT NULL, decision_date TEXT,
                                         fiscal_year TEXT, soc_code TEXT, state TEXT, wage REAL);
        CREATE INDEX idx_pch_dec ON perm_cases_history(decision_date);
        CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);
    """)
    db.conn.executemany("INSERT INTO perm_cases_history VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    db.conn.executemany("INSERT INTO perm_cases VALUES (?)", [(c,) for c in current])
    return db


# FY2016: 40 certified software developers (30 in WA), two denials, a withdrawal; FY2009 a few others.
ROWS = [(f"A-15{i:03d}-00001", "certified", f"2016-0{1 + i % 8}-{10 + i % 15:02d}", "2016", "15-1132.00",
         "WA" if i < 30 else "CA", 90000 + 1000 * i) for i in range(40)]
ROWS += [("A-15900-00001", "denied", "2016-03-04", "2016", "15-1132.00", "WA", 70000),
         ("A-15900-00002", "denied", "2015-10-01", "2016", "15-1132", "WA", 71000),
         ("A-15900-00003", "withdrawn", "2016-09-30", "2016", "15-1132.00", "WA", None),
         ("A-08900-00001", "certified", "2009-01-05", "2009", "13-2011.01", "NY", 60000),
         ("A-08900-00002", "certified", "2008-11-05", "2009", "13-2011", None, 61000),
         # Decided in FY2016 here and again later (perm_cases holds that decision): this one is still FY2016's.
         ("A-15999-00009", "certified", "2016-05-05", "2016", "15-1132.00", "WA", 999999),
         # No wage, a zero wage and no SOC code: counted in the year's totals, never in a wage cell.
         ("A-15800-00001", "certified", "2016-06-06", "2016", "15-1132.00", "WA", None),
         ("A-15800-00002", "certified", "2016-06-07", "2016", "15-1132.00", "WA", 0),
         ("A-15800-00003", "certified", "2016-06-08", "2016", None, "WA", 95000)]

print("the older table's years, by outcome")
db = seed(ROWS, current=["A-15999-00009"])
n = iph.build_history_years_wages(db, min_cells=5)
doc = json.loads(db.conn.execute("SELECT json FROM perm_docs WHERE key = 'perm_history_years'").fetchone()[0])
years = {y["fiscalYear"]: y for y in doc["years"]}
check("FY2016 counts 44 certified, 2 denied, 1 withdrawn", years.get("2016") == {
    "fiscalYear": "2016", "total": 47, "certified": 44, "denied": 2, "withdrawn": 1}, json.dumps(years.get("2016")))
check("a decision perm_cases also holds a later one of still counts, as the list shows it",
      years["2016"]["certified"] == 44)
check("FY2009 is its own year, newest year first", [y["fiscalYear"] for y in doc["years"]] == ["2016", "2009"],
      json.dumps(doc["years"]))
check("the doc says where the table's decisions start", doc.get("from") == "2008-11-05", json.dumps(doc))
states = {s["state"]: s for s in doc["byState"]}
check("each worksite state by outcome, the busiest first", doc["byState"][0]["state"] == "WA" and states["WA"] == {
    "state": "WA", "total": 37, "certified": 34, "denied": 2, "withdrawn": 1}, json.dumps(doc["byState"]))
check("a case with no worksite state counts under none", states.get("", {}).get("total") == 1, json.dumps(states))

print("the older table's wage cells, by year, occupation and state")
cells = {(r[0], r[1], r[2]): r[3:] for r in db.conn.execute(
    "SELECT fy, soc, state, n, avg, p5, p25, p50, p75, p95 FROM perm_history_wage_cells").fetchall()}
nat = cells.get((2016, "15-1132", ""))
check("FY2016 software developers nationally: the 41 certified with a wage, either spelling of the code",
      nat is not None and nat[0] == 41, str(nat))
wages = sorted([90000 + 1000 * i for i in range(40)] + [999999])


def pct(p: float) -> float:
    k = (len(wages) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(wages) - 1)
    v = wages[lo] + (wages[hi] - wages[lo]) * (k - lo)
    return float(int(v + 0.5))


check("its percentiles interpolate as the site's SQL does (p50 of 90,000..129,000)",
      nat is not None and nat[4] == pct(0.5) and nat[2] == pct(0.05) and nat[6] == pct(0.95), str(nat))
check("its average is the plain mean", nat is not None and abs(nat[1] - sum(wages) / 41) < 0.01, str(nat))
wa = cells.get((2016, "15-1132", "WA"))
check("Washington's own cell holds its 31", wa is not None and wa[0] == 31, str(wa))
check("a cell under the floor isn't written (California's 10 under a floor of 5 is; NY's 1 isn't)",
      (2016, "15-1132", "CA") in cells and (2009, "13-2011", "NY") not in cells, str(sorted(cells)))
check("denials and withdrawals never enter a wage cell", all(c[0] <= 41 for c in cells.values()))
check("the builder says how many rows it wrote", n == len(cells) + len(doc["years"]), f"{n}")

print("how it reads the older table")
reads = [s for s in db.statements if "FROM perm_cases_history" in s and "decision_date >=" in s]
check("it reads decision days in slices, never the whole table at once", len(reads) >= 6, str(len(reads)))
check("no read groups or scans the whole older table",
      not any("FROM perm_cases_history" in s and "decision_date >=" not in s and "MIN(" not in s and "MAX(" not in s
              for s in db.statements), "\n".join(db.statements))
check("each slice is five days or fewer", all(iph.days_between(a, b) <= 5 for a, b in iph.decision_slices(
    "2008-11-05", "2016-09-30")), "")
check("the slices cover every day once, from the first decision to the last",
      iph.decision_slices("2016-01-30", "2016-02-02")[0][0] == "2016-01-30"
      and iph.decision_slices("2016-01-30", "2016-02-02")[-1][1] > "2016-02-02", "")
iph.build_history_years_wages(db, min_cells=5)
again = db.conn.execute("SELECT COUNT(*) FROM perm_history_wage_cells").fetchone()[0]
check("rebuilding replaces the cells, never doubles them", again == len(cells), f"{again} vs {len(cells)}")

print("an empty older table writes an empty record, never a failure")
empty = seed([])
iph.build_history_years_wages(empty)
doc = json.loads(empty.conn.execute("SELECT json FROM perm_docs WHERE key = 'perm_history_years'").fetchone()[0])
check("no years and no start", doc["years"] == [] and doc.get("from") is None, json.dumps(doc))

print("against the site's own percentile SQL, on random wages")
rng = random.Random(20261121)
for trial in range(20):
    ws = [float(rng.choice([rng.randint(30000, 300000), 100000, 100000.5])) for _ in range(rng.randint(1, 80))]
    got = iph.wage_percentiles(sorted(ws))
    r = SqliteDb()
    r.conn.execute("CREATE TABLE t (wage REAL)")
    r.conn.executemany("INSERT INTO t VALUES (?)", [(w,) for w in ws])
    parts = []
    for p, name in ((0.05, "p5"), (0.25, "p25"), (0.5, "p50"), (0.75, "p75"), (0.95, "p95")):
        k = f"(c.n - 1) * {p}"
        lo = f"1 + CAST({k} AS INTEGER)"
        parts.append(f"(SELECT ROUND(lo.wage + (hi.wage - lo.wage) * ({k} - CAST({k} AS INTEGER))) FROM c "
                     f"JOIN o lo ON lo.rn = {lo} JOIN o hi ON hi.rn = MIN({lo} + 1, c.n)) AS {name}")
    want = r.conn.execute("WITH f AS (SELECT wage FROM t), c AS (SELECT COUNT(*) AS n FROM f), "
                          "o AS (SELECT wage, ROW_NUMBER() OVER (ORDER BY wage) AS rn FROM f) "
                          f"SELECT {', '.join(parts)}").fetchone()
    if tuple(got) != tuple(want):
        check(f"random wages {trial} match the SQL", False, f"{got} vs {want}")
        break
else:
    check("20 random wage lists give the SQL's percentiles exactly", True)

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

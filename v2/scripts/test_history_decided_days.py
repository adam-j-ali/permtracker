#!/usr/bin/env python3
"""The PERM wait trend reaches back to FY2015 (item 27's second half, the Nov 20 2026 sweep).

"Is PERM getting faster?" groups DOL's decisions by the month DOL decided, and perm_cases holds decisions from
October 2023 on, so the trend started there. The months before are in perm_cases_history, which changes only when a
history file loads: so its decision days are counted once into perm_history_decided_days (decision month, days,
cases; certified and denied only, as the trend counts them), a few days of decisions at a time on idx_pch_dec, and
build_wait_trends.py reads that small table beside perm_cases' own months.

Run:  python3 scripts/test_history_decided_days.py
"""
from __future__ import annotations

import json
import random
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_wait_trends as w  # noqa: E402
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
        self.statements: list[tuple[str, list]] = []

    def _run(self, sql, args):
        self.statements.append((sql, list(args or [])))
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


def seed(rng: random.Random, *, index: bool = True) -> SqliteDb:
    db = SqliteDb()
    for ddl in iph.SCHEMA:
        db.conn.execute(ddl)
    if index:
        db.conn.execute("CREATE INDEX idx_pch_dec ON perm_cases_history(decision_date)")
    db.conn.executescript("""
        CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, status TEXT, received_date TEXT, decision_date TEXT,
                                 days INTEGER);
        CREATE TABLE perm_case_status (case_number TEXT PRIMARY KEY, filing_date TEXT);
        CREATE TABLE perm_case_events (case_number TEXT, changed_at INTEGER, from_status TEXT, to_status TEXT,
                                       source TEXT);
        CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);
    """)
    hist = []
    # Two busy months in the older table (each over the trend's floor), one thin one, and the edges of the span.
    for month, k, lo, hi in (("2019-03", 640, 120, 900), ("2021-07", 580, 200, 700), ("2016-02", 40, 100, 300)):
        y, mo = int(month[:4]), int(month[5:7])
        for i in range(k):
            dec = date(y, mo, 1 + rng.randrange(28))
            d = rng.randint(lo, hi)
            hist.append((f"H-{month}-{i:05d}", rng.choice(["certified"] * 9 + ["denied"]),
                         (dec - timedelta(days=d)).isoformat(), dec.isoformat(), d))
    hist += [
        # Withdrawals are left out of the trend, as perm_cases' own months leave them out.
        *[(f"W-{i}", "withdrawn", "2018-01-01", "2019-03-15", 5) for i in range(30)],
        ("N-1", "certified", None, "2019-03-16", None),              # no days: left out
        ("E-1", "certified", "2014-01-02", "2014-09-30", 271),       # before FY2015
        ("E-2", "certified", "2014-01-02", "2014-10-01", 272),       # FY2015's first day
        ("E-3", "denied", "2023-01-02", "2023-09-29", 270),          # the older table's last month
    ]
    db.conn.executemany("INSERT INTO perm_cases_history (case_number, status, received_date, decision_date, days) "
                        "VALUES (?, ?, ?, ?, ?)", hist)
    cur = []
    for i in range(520):
        dec = date(2024, 2, 1 + i % 28)
        d = 400 + i % 90
        cur.append((f"G-{i}", "certified", (dec - timedelta(days=d)).isoformat(), dec.isoformat(), d))
    db.conn.executemany("INSERT INTO perm_cases VALUES (?, ?, ?, ?, ?)", cur)
    db.conn.commit()
    return db


rng = random.Random(20261121)
db = seed(rng)

print("the older table's decision days, counted once per decision month")
n = iph.build_decided_days(db)
rows = db.conn.execute("SELECT m, days, n FROM perm_history_decided_days ORDER BY m, days").fetchall()
want = db.conn.execute(
    "SELECT substr(decision_date, 1, 7), days, COUNT(*) FROM perm_cases_history "
    "WHERE decision_date >= '2014-10-01' AND decision_date < '2023-10-01' AND days IS NOT NULL "
    "AND status IN ('certified', 'denied') GROUP BY 1, 2 ORDER BY 1, 2").fetchall()
check("each decision month's days equal a grouping of the older table", rows == want and len(rows) > 100,
      f"{len(rows)} vs {len(want)}")
check("the builder says how many rows it wrote", n == len(rows), f"{n} vs {len(rows)}")
months = {m for m, _, _ in rows}
check("withdrawals and cases with no days are left out",
      sum(c for m, _, c in rows if m == "2019-03") == db.conn.execute(
          "SELECT COUNT(*) FROM perm_cases_history WHERE decision_date LIKE '2019-03%' AND status <> 'withdrawn' "
          "AND days IS NOT NULL").fetchone()[0])
check("it starts at FY2015's first month (October 2014)", "2014-09" not in months and "2014-10" in months,
      str(sorted(months)[:3]))
check("and reaches the older table's last month", "2023-09" in months, str(sorted(months)[-3:]))

reads = [(s, a) for s, a in db.statements if "FROM perm_cases_history" in s]
ends = [s for s, _ in reads if "MAX(decision_date)" in s or "MIN(decision_date)" in s]
sliced = [(s, a) for s, a in reads if s not in ends]
check("every read but the table's ends is a decision-day range on idx_pch_dec",
      sliced and all("WHERE decision_date >= ? AND decision_date < ?" in s for s, _ in sliced), str(sliced[:1]))
spans = [(date.fromisoformat(a[1]) - date.fromisoformat(a[0])).days for _, a in sliced]
check("each range is ten days or less (a grouped ten-day slice measured 0.65 s on the live database)",
      spans and max(spans) <= 11, str(max(spans) if spans else None))
check("each slice groups its own rows by days, never by month across the table",
      all("GROUP BY days" in s and "substr(" not in s for s, _ in sliced))
plan = " | ".join(r[3] for r in db.conn.execute("EXPLAIN QUERY PLAN " + sliced[0][0], sliced[0][1]).fetchall())
check("and SQLite answers it on idx_pch_dec", "idx_pch_dec" in plan, plan)
lo = min(a[0] for _, a in sliced)
hi = max(a[1] for _, a in sliced)
check("the slices run from Oct 1 2014 to Oct 1 2023 and no further", lo == "2014-10-01" and hi == "2023-10-01",
      f"{lo} .. {hi}")

iph.build_decided_days(db)
again = db.conn.execute("SELECT COUNT(*) FROM perm_history_decided_days").fetchone()[0]
check("rebuilding replaces the table, never doubles it", again == len(rows), f"{again} vs {len(rows)}")

bare = seed(random.Random(2), index=False)
bare.statements.clear()
check("without idx_pch_dec it reads nothing (each slice would scan the table)",
      iph.build_decided_days(bare) == 0 and not any("FROM perm_cases_history" in s for s, _ in bare.statements))

print("the trend reads both")
doc = w.perm_trend(db)
by = {m["m"]: m for m in (doc or {}).get("months", [])}
raw = {}
for m, nn, p25, p50, p75 in db.conn.execute(
        "WITH f AS (SELECT substr(decision_date, 1, 7) AS m, days AS d FROM perm_cases_history "
        "WHERE days IS NOT NULL AND status IN ('certified', 'denied') AND decision_date >= '2014-10-01')"
        + w.PERCENTILE_SQL).fetchall():
    raw[m] = {"m": m, "n": nn, "p25": p25, "p50": p50, "p75": p75, "from": "files"}
check("an older busy month's median and middle half equal the trend's own SQL over the older rows",
      by.get("2019-03") == raw["2019-03"] and by.get("2021-07") == raw["2021-07"],
      f"{by.get('2019-03')} vs {raw.get('2019-03')}")
check("a thin older month is left out, as any month under the floor is", "2016-02" not in by)
check("perm_cases' own months follow, unchanged", by.get("2024-02", {}).get("n") == 520, json.dumps(by.get("2024-02")))
check("the months run oldest first", list(by) == sorted(by), str(list(by)))
check("the older months come from the small table alone, never the older case table",
      not any("perm_cases_history" in s for s, _ in db.statements[-6:]))

bare = seed(random.Random(3))
doc = w.perm_trend(bare)
check("before the first history build the trend starts at October 2023 as before",
      doc is not None and all(m["m"] >= "2023-10" for m in doc["months"]), json.dumps(doc)[:200])
bare.conn.execute("DROP TABLE perm_history_decided_days")
doc = w.perm_trend(bare)
check("and a database without the small table yet still builds it", doc is not None and doc["months"],
      json.dumps(doc)[:200])

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

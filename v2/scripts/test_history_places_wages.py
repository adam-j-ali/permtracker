#!/usr/bin/env python3
"""The older PERM table's worksites and wages, counted once at the history load.

perm_cases holds decisions from FY2024 on and perm_cases_history FY2008 to FY2023, and three readers stopped at the
first (the Nov 20 2026 sweep): the Wage and Hour, OSHA, SAM, PPP and TAA joins tested a record's state and city
against a sponsor's recent PERM worksites only (item 31), and the wage bands by year and the salary explorer's
year picker stopped at FY2024 (item 34). The older table changes only when a history file loads, so one pass over
it, ten days of decisions at a time on idx_pch_dec, writes what each reader needs into small tables:
perm_history_worksites, perm_history_wage_bands, and the explorer's views for each older year in wage_views.

Run:  python3 scripts/test_history_places_wages.py
"""
from __future__ import annotations

import json
import pathlib
import random
import re
import sqlite3
import sys
from datetime import date

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_wage_bands as bwb  # noqa: E402
import build_wage_views as bwv  # noqa: E402
import ingest_perm_history as iph  # noqa: E402
import lib_dol_records as dol  # noqa: E402
from build_lca_facets import min_for_median, percentile_select  # noqa: E402

FAILURES: list[str] = []


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


def cell(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    return {"type": "text", "value": str(v)}


def plain(a: dict):
    t, v = a.get("type"), a.get("value")
    if t == "null":
        return None
    if t == "integer":
        return int(v)
    if t == "float":
        return float(v)
    return v


class SqliteDb:
    """Enough of lib_db.Database for these functions, on a real SQLite: every statement and its arguments kept."""

    def __init__(self):
        self.conn = sqlite3.connect(":memory:")
        self.statements: list[tuple[str, list]] = []

    def _run(self, sql, args):
        self.statements.append((sql, list(args or [])))
        try:
            cur = self.conn.execute(sql, args or [])
        except sqlite3.Error as exc:  # the real client's shape: RuntimeError("libsql error: ...")
            raise RuntimeError(f"libsql error: {exc}") from exc
        rows = cur.fetchall()
        self.conn.commit()
        return {"cols": [{"name": d[0]} for d in (cur.description or [])],
                "rows": [[cell(v) for v in r] for r in rows], "affected_row_count": cur.rowcount}

    def execute(self, sql, args=None):
        return {"response": {"result": self._run(sql, args)}}

    def scalar(self, sql, args=None):
        rows = self._run(sql, args)["rows"]
        return plain(rows[0][0]) if rows else None

    def script(self, statements):
        for s in statements:
            self._run(s, [])

    def pipeline(self, requests, **_):
        out = []
        for r in requests:
            if r.get("type") != "execute":
                out.append({})
                continue
            s = r["stmt"]
            out.append({"response": {"result": self._run(s["sql"], [plain(a) for a in s.get("args", [])])}})
        return {"results": out}


def fy_of(day: str) -> str:
    d = date.fromisoformat(day)
    return str(d.year + 1 if d.month >= 10 else d.year)


def seed(rng: random.Random) -> SqliteDb:
    db = SqliteDb()
    for ddl in iph.SCHEMA + iph.SEARCH_INDEXES:
        db.conn.execute(ddl)
    db.conn.executescript("""
        CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, status TEXT, fiscal_year TEXT, employer_slug TEXT,
                                 state TEXT, worksite_city TEXT, soc_code TEXT, wage REAL);
        CREATE TABLE perm_entities (kind TEXT, slug TEXT, merge_key TEXT, total INTEGER, code TEXT, name TEXT);
        CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);
        CREATE TABLE wage_views (key TEXT PRIMARY KEY, program TEXT NOT NULL, n INTEGER NOT NULL, json TEXT NOT NULL,
                                 built_at INTEGER NOT NULL);
        INSERT INTO perm_entities VALUES ('employer', 'acme-corp', 'acme corp', 12, NULL, NULL),
                                         ('employer', 'beta-farms-llc', 'beta farms llc', 3, NULL, NULL);
        INSERT INTO perm_cases VALUES ('G-100-24001-000001', 'certified', '2024', 'acme-corp', 'CA', 'San Jose',
                                       '15-1252.00', 150000),
                                      ('G-100-24001-000002', 'certified', '2024', 'beta-farms-llc', 'OH', 'Dayton',
                                       '45-2092.00', 32000);
        -- The quarterly build's views, which the history build must leave alone.
        INSERT INTO wage_views VALUES ('perm|certified|||2025', 'perm', 9000, '{}', 1),
                                      ('perm|certified|||', 'perm', 90000, '{}', 1);
    """)
    rows = [
        # acme-corp worked in Texas and Nevada before FY2024, and in California since.
        ("A-14300-00001", "certified", "2014-10-01", "acme-corp", "TX", "Houston", "15-1132.00", 95000.0),
        ("A-15100-00002", "denied", "2015-09-30", "acme-corp", "NV", "Las Vegas", "15-1132.00", 61000.0),
        ("A-15200-00003", "certified", "2015-10-01", "acme-corp", "TX", "houston ", "15-1132.00", 99000.0),
        # beta-farms-llc's older case names a state and no city, and one names neither.
        ("A-15200-00004", "withdrawn", "2016-03-11", "beta-farms-llc", "KY", None, "45-2092.00", 28000.0),
        ("A-15200-00005", "certified", "2016-03-21", "beta-farms-llc", None, None, "45-2092.00", 29000.0),
        # No employer page slug: in the wages, never a worksite.
        ("A-15200-00006", "certified", "2016-05-01", "", "WA", "Seattle", "15-1132.00", 120000.0),
        ("A-15200-00007", "certified", "2016-05-02", None, "WA", "Seattle", "15-1132.00", 121000.0),
        # No usable wage: a worksite, never a wage.
        ("A-15200-00008", "certified", "2016-06-01", "acme-corp", "AZ", "Phoenix", "15-1132.00", None),
        ("A-15200-00009", "denied", "2016-06-02", "acme-corp", "AZ", "Tempe", "15-1132.00", 0.0),
        # A city with no state: the city test ignores the state, so the city counts.
        ("A-15200-00010", "certified", "2016-07-01", "gamma-inc", None, "Reno", "15-1132.00", 70000.0),
        # Wages exactly on band edges belong to the band above (the page's `wage < edge`).
        ("A-15200-00011", "denied", "2016-07-02", "gamma-inc", "NV", "Reno", "15-1132.00", 40000.0),
        ("A-15200-00012", "denied", "2016-07-03", "gamma-inc", "NV", "Reno", "15-1132.00", 160000.0),
    ]
    socs = ["15-1132.00", "15-1121.00", "13-2011.01", "45-2092.02", None]
    states = ["CA", "TX", "NY", "WA", "", None]
    for i in range(2400):
        day = date.fromordinal(date(2013, 10, 1).toordinal() + rng.randrange(0, 3 * 365))
        rows.append((f"A-R{i:06d}", rng.choice(["certified"] * 7 + ["denied", "withdrawn"]), day.isoformat(),
                     rng.choice(["acme-corp", "beta-farms-llc", "gamma-inc", ""]), rng.choice(states),
                     rng.choice(["Austin", "Dallas", None]), rng.choice(socs),
                     rng.choice([None, 0.0] + [round(rng.uniform(15_000, 260_000), 2)] * 12)))
    db.conn.executemany(
        "INSERT INTO perm_cases_history (case_number, status, decision_date, employer_slug, state, worksite_city, "
        "soc_code, wage, fiscal_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(*r, fy_of(r[2])) for r in rows])
    db.conn.commit()
    return db


rng = random.Random(20261121)
db = seed(rng)
floor = min_for_median()

print("one pass over the older table, ten days of decisions at a time")
n = iph.build_places_and_wages(db)
check("the pass says how many rows it wrote", n > 0, str(n))
reads = [(s, a) for s, a in db.statements if "FROM perm_cases_history" in s]
ends = [s for s, _ in reads if "MIN(decision_date)" in s or "MAX(decision_date)" in s]
control = [(s, a) for s, a in reads if s.startswith("WITH f AS")]
ranged = [(s, a) for s, a in reads if s not in ends and (s, a) not in control]
check("the table's two ends are one seek each", len(ends) == 2 and all("MIN" not in s or "MAX" not in s for s in ends),
      str(ends))
check("every other read but one control is a decision-day range",
      ranged and all("WHERE decision_date >= ? AND decision_date < ?" in s and len(a) == 2 for s, a in ranged))
spans = [(date.fromisoformat(a[1]) - date.fromisoformat(a[0])).days for _, a in ranged]
check("each range is about ten days (a busy month whole took 1.7 s)", spans and max(spans) <= 11, str(max(spans)))
check("no read groups the older table", not any("GROUP BY" in s for s, _ in reads))
check("the control recomputes one small view from one state's fiscal year, on the state index",
      len(control) == 1 and "state = ? AND decision_date >= ? AND decision_date < ?" in control[0][0], str(control))
days = sorted({a[0] for _, a in ranged} | {a[1] for _, a in ranged})
check("the ranges tile the fiscal years the table holds, from Oct 1 2013 to Oct 1 2016",
      days[0] == "2013-10-01" and days[-1] == "2016-10-01"
      and all(any(a[0] == d for _, a in ranged) for d in days[:-1]), f"{days[0]} .. {days[-1]}")

print("worksites, for the enforcement records' joins (item 31)")
places = set(db.conn.execute("SELECT slug, state, city FROM perm_history_worksites").fetchall())
check("a state and its city, upper case and trimmed", ("acme-corp", "TX", "HOUSTON") in places, str(places))
check("both spellings of a city are one row", sum(1 for p in places if p[:2] == ("acme-corp", "TX")) ==
      len({p for p in places if p[:2] == ("acme-corp", "TX")}))
check("a state with no city keeps the state", ("beta-farms-llc", "KY", "") in places)
check("a case with neither adds nothing", not any(p[0] == "beta-farms-llc" and p[1] == "" and p[2] == ""
                                                  for p in places))
check("a case with no wage still names its worksite", ("acme-corp", "AZ", "PHOENIX") in places)
check("a city with no state keeps the city", ("gamma-inc", "", "RENO") in places)
check("a case with no employer slug names no worksite", not any(p[0] in ("", None) for p in places))

print("the enforcement loaders read both tables")
sponsors, states = dol.load_sponsors(db)
check("a sponsor's states are its recent and its older PERM worksites",
      {"CA", "TX", "NV", "AZ"} <= states.get("acme-corp", set()), str(states.get("acme-corp")))
check("a state named only in the older table counts", "KY" in states.get("beta-farms-llc", set()),
      str(states.get("beta-farms-llc")))
check("a blank state is no state", "" not in states.get("beta-farms-llc", set()))
hist_reads = [s for s, _ in db.statements if "FROM perm_history_worksites" in s]
check("the older worksites are read a slug window at a time", len(hist_reads) >= len(dol.SLUG_WINDOWS) // 2,
      str(len(hist_reads)))
cities = dol.sponsor_cities(db, {"acme-corp", "beta-farms-llc"})
check("a sponsor's cities are its recent and its older ones",
      {"SAN", "HOUSTON", "LAS", "PHOENIX", "TEMPE"} <= cities.get("acme-corp", set()), str(cities.get("acme-corp")))
bare = seed(random.Random(1))
_, only_recent = dol.load_sponsors(bare)
check("before the first history build, the recent worksites still match", only_recent.get("acme-corp") == {"CA"},
      str(only_recent.get("acme-corp")))
bare.conn.execute("DROP TABLE perm_history_worksites")
_, no_table = dol.load_sponsors(bare)
check("a database without the older worksites' table yet matches on the recent ones",
      no_table.get("acme-corp") == {"CA"} and dol.sponsor_cities(bare, {"acme-corp"}) == {"acme-corp": {"SAN"}},
      str(no_table.get("acme-corp")))
bare.conn.execute("DROP TABLE perm_cases")
try:
    dol.load_sponsors(bare)
    check("any other failed read stops the loader", False, "no error")
except RuntimeError:
    check("any other failed read stops the loader", True)

print("wage bands by fiscal year (item 34)")
ts = (HERE.parent / "src" / "lib" / "wageLadder.ts").read_text()
m = re.search(r"WAGE_BAND_EDGES_FINE = \[([^\]]+)\]", ts)
edges = [int(x.strip().replace("_", "")) for x in m.group(1).split(",") if x.strip()] if m else []
check("the band edges are the page's own (wageLadder.ts)", edges == list(bwb.FINE_EDGES), f"{edges} vs {bwb.FINE_EDGES}")
case = "CASE " + " ".join(f"WHEN wage < {e} THEN {0 if i == 0 else edges[i - 1]}" for i, e in enumerate(edges)) + \
    f" ELSE {edges[-1]} END"
want = {(str(fy), int(b)): (int(d), int(n)) for fy, b, d, n in db.conn.execute(
    f"SELECT fiscal_year, {case} AS band, COUNT(*), SUM(status = 'denied') FROM perm_cases_history "
    "WHERE wage IS NOT NULL AND wage > 0 AND status IN ('certified', 'denied') GROUP BY 1, 2").fetchall()}
got = {(str(fy), int(b)): (int(d), int(n)) for fy, b, d, n in db.conn.execute(
    "SELECT fy, band, decided, denied FROM perm_history_wage_bands").fetchall()}
check("each year's bands equal the page's own CASE over the older table", got == want and len(got) > 20,
      f"{len(got)} vs {len(want)}")
check("a wage on an edge sits in the band above it",
      got.get(("2016", 40_000), (0, 0))[1] >= 1 and got.get(("2016", 160_000), (0, 0))[1] >= 1
      and bwb.band_floor(40_000.0) == 40_000 and bwb.band_floor(39_999.99) == 0, str(got.get(("2016", 40_000))))
check("withdrawn cases and missing wages sit in no band",
      sum(d for d, _ in got.values()) == db.conn.execute(
          "SELECT COUNT(*) FROM perm_cases_history WHERE wage > 0 AND status IN ('certified', 'denied')").fetchone()[0])

print("the salary explorer's older years (item 34)")
views = {k: (p, json.loads(j)) for k, p, j in db.conn.execute("SELECT key, program, json FROM wage_views").fetchall()}
hist = {k: v for k, (p, v) in views.items() if p == bwv.HISTORY_PROGRAM}
check("the quarterly build's views are left alone",
      views.get("perm|certified|||2025", ("",))[0] == "perm" and views.get("perm|certified|||", ("",))[0] == "perm")
check("every older-year key names a fiscal year, under the reader's own key layout",
      hist and all(k.startswith("perm|") and k.split("|")[4] in ("2014", "2015", "2016") for k in hist),
      str(sorted(hist)[:3]))
expected: dict[str, int] = {}
for status, wage, soc, state, fy in db.conn.execute(
        "SELECT status, wage, substr(soc_code, 1, 7), state, fiscal_year FROM perm_cases_history "
        "WHERE wage IS NOT NULL AND wage > 0").fetchall():
    for st in (status, "all"):
        for s in {"", soc or ""}:
            for t in {"", state or ""}:
                k = f"perm|{st}|{s}|{t}|{fy}"
                expected[k] = expected.get(k, 0) + 1
check("every selection holding a case has its view, thin ones too, so a missing key means none",
      {k: v["stats"]["n"] for k, v in hist.items()} == expected, f"{len(hist)} vs {len(expected)}")
bad = 0
for k, v in hist.items():
    _, status, soc, state, fy = k.split("|")
    where, args = ["wage IS NOT NULL", "wage > 0", "fiscal_year = ?"], [fy]
    if status != "all":
        where.append("status = ?"); args.append(status)
    if soc:
        where.append("substr(soc_code, 1, 7) = ?"); args.append(soc)
    if state:
        where.append("state = ?"); args.append(state)
    db.conn.row_factory = sqlite3.Row
    live = db.conn.execute(
        f"WITH f AS (SELECT wage FROM perm_cases_history WHERE {' AND '.join(where)}), "
        "c AS (SELECT COUNT(*) AS n FROM f), o AS (SELECT wage, ROW_NUMBER() OVER (ORDER BY wage) AS rn FROM f) "
        f"SELECT (SELECT n FROM c) AS n, {percentile_select()}", args).fetchone()
    db.conn.row_factory = None
    s = v["stats"]
    if live["n"] != s["n"] or any(live[q] != s[q] for q in ("p5", "p25", "p50", "p75", "p95")):
        bad += 1
check("each view equals the explorer's own percentile SQL over the older table", bad == 0, f"{bad} differ")
stateless = [v for k, v in hist.items() if k.split("|")[3] == ""]
check("a view without a state carries its by-state table at the page's floor",
      stateless and all(isinstance(v["byState"], list) and v["minCases"] == floor for v in stateless))
doc = json.loads(db.conn.execute("SELECT json FROM perm_docs WHERE key = ?", [bwv.HISTORY_DOC]).fetchone()[0])
check("its record lists the years it built", doc.get("years") == ["2014", "2015", "2016"], json.dumps(doc))

print("the year picker offers the older years")
db.conn.execute("INSERT INTO perm_docs VALUES ('wage_filter_options', ?, 1)", [json.dumps(
    {"minCases": floor, "occupations": [{"value": "15-1252", "label": "x", "n": 1}],
     "states": [{"value": "CA", "label": "CA", "n": 1}], "fiscalYears": ["2026", "2025", "2024"]})])
bwb.refresh_history_years(db)
opts = json.loads(db.conn.execute("SELECT json FROM perm_docs WHERE key = 'wage_filter_options'").fetchone()[0])
check("the picker's years run newest first through the older ones",
      opts["fiscalYears"] == ["2026", "2025", "2024", "2016", "2015", "2014"], str(opts["fiscalYears"]))
check("and say which come from the older table", opts.get("historyYears") == ["2016", "2015", "2014"],
      str(opts.get("historyYears")))
facets = bwb.with_history_years(db, {"fiscalYears": ["2025", "2024"]})
check("the quarterly facet build adds them too", facets["fiscalYears"] == ["2025", "2024", "2016", "2015", "2014"],
      str(facets))

print("without the decision-day index it reads nothing")
plain_db = seed(random.Random(2))
plain_db.conn.execute("DROP INDEX idx_pch_dec")
plain_db.statements.clear()
check("no pass runs without idx_pch_dec (each slice would scan the table)",
      iph.build_places_and_wages(plain_db) == 0
      and not any("FROM perm_cases_history" in s for s, _ in plain_db.statements)
      and plain_db.conn.execute("SELECT COUNT(*) FROM wage_views WHERE program = ?",
                                [bwv.HISTORY_PROGRAM]).fetchone()[0] == 0)

print("rebuilding replaces, never doubles")
before = {t: db.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
          for t in ("perm_history_worksites", "perm_history_wage_bands", "wage_views")}
iph.build_places_and_wages(db)
after = {t: db.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in before}
check("the same rows after a second build", before == after, f"{before} vs {after}")

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

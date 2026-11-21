#!/usr/bin/env python3
"""What an employer's and a law firm's older PERM cases were made of, and the older cases' state counts.

The employer and firm pages list the jobs, states, firms, cities, industries and clients behind their figures from
perm_cases alone (decisions from October 2023 on), and the case search's state list counts perm_cases alone (the
Nov 20 2026 sweep, items 28 and 35). The older table changes only when a history file loads, so both are counted
once, about ten decision days at a time on its decision_date index, into perm_history_entity_facets (each entity's
own total and fiscal years beside its rows) and perm_docs['perm_history'].byState. A case perm_cases also holds is
counted there, never twice.

Run:  python3 scripts/test_history_entity_facets.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import tracemalloc
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest_perm_history as iph  # noqa: E402
from entity_identity import entity_key  # noqa: E402
from lib_sqlite_shim import SqliteTurso  # noqa: E402

FAILURES: list[str] = []


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


class Watched(SqliteTurso):
    """The shim, keeping every statement it ran, so the test can see how the table was read."""

    def __init__(self) -> None:
        super().__init__()
        self.statements: list[str] = []
        self.calls: list[tuple[str, list]] = []

    def execute(self, sql, args=None, **kw):
        self.statements.append(sql)
        self.calls.append((sql, list(args or [])))
        return super().execute(sql, args, **kw)

    def pipeline(self, reqs, **kw):
        self.statements.extend(r["stmt"]["sql"] for r in reqs if r.get("type") == "execute")
        return super().pipeline(reqs, **kw)


def row(case, status, decided, fy, emp_name, emp_slug, state="WA", city="Seattle", soc="15-1252.00",
        soc_title="Software Developers", att_name=None, att_slug="", naics="541511"):
    """A perm_cases_history row in iph.COLUMNS order."""
    vals = {c: None for c in iph.COLUMNS}
    vals.update({
        "case_number": case, "status": status, "decision_date": decided, "fiscal_year": str(fy),
        "employer_name": emp_name, "employer_slug": emp_slug, "state": state, "worksite_city": city,
        "soc_code": soc, "soc_title": soc_title, "attorney_name": att_name, "attorney_slug": att_slug,
        "naics": naics,
    })
    return tuple(vals[c] for c in iph.COLUMNS)


def seed() -> Watched:
    db = Watched()
    db.script(iph.SCHEMA)
    db.conn.executescript("""
        CREATE INDEX idx_pch_dec ON perm_cases_history(decision_date);
        CREATE TABLE perm_entities (kind TEXT, slug TEXT, name TEXT, merge_key TEXT, code TEXT, total INTEGER);
        CREATE TABLE perm_entity_alias (kind TEXT, slug TEXT, target_slug TEXT);
        CREATE TABLE perm_cases (case_number TEXT PRIMARY KEY, employer_slug TEXT, fiscal_year TEXT, status TEXT);
        CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER);
    """)
    db.conn.executemany("INSERT INTO perm_entities VALUES (?,?,?,?,?,?)", [
        ("employer", "acme-inc", "ACME INC", entity_key("ACME INC"), None, 500),
        ("employer", "beta-corp", "Beta Corp", entity_key("Beta Corp"), None, 40),
        ("employer", "gamma-llc", "Gamma LLC", entity_key("Gamma LLC"), None, 30),
        ("employer", "delta-co", "Delta Co", entity_key("Delta Co"), None, 20),
        ("attorney", "law-firm-llp", "Law Firm LLP", entity_key("Law Firm LLP"), None, 80),
        ("occupation", "software-developers", "Software Developers", None, "15-1252.00", 900),
    ])
    # A page merged into another: its older rows still carry the retired slug.
    db.conn.execute("INSERT INTO perm_entity_alias VALUES ('employer', 'acme-old', 'acme-inc')")
    # A firm page merged into another: a row still carrying the retired slug, under a spelling of its own.
    db.conn.execute("INSERT INTO perm_entity_alias VALUES ('attorney', 'law-firm-old', 'law-firm-llp')")
    hist = [
        # Acme, FY2015 to FY2019, in two decision months and more.
        row("A-1", "certified", "2015-03-02", 2015, "ACME INC", "acme-inc", att_name="Law Firm LLP",
            att_slug="law-firm-llp"),
        row("A-2", "certified", "2015-03-20", 2015, "Acme Inc.", "acme-inc", city="SEATTLE",
            att_name="Law Firm, LLP", att_slug="law-firm-llp"),
        row("A-3", "denied", "2017-06-01", 2017, "ACME INC", "acme-inc", state="CA", city="San Jose",
            soc="15-1132.00", soc_title="Software Developers, Applications", att_name="Other Firm PC"),
        row("A-4", "withdrawn", "2019-01-15", 2019, "ACME INC", "acme-old", city="Redmond", naics=None),
        # Also in perm_cases (decided again after October 2023): counted there, never here.
        row("A-5", "certified", "2019-02-01", 2019, "ACME INC", "acme-inc", state="NY", city="New York"),
        # Gamma's older rows were stored with no page (the fallback slug): today its name finds one.
        row("G-1", "certified", "2016-05-01", 2016, "GAMMA LLC", "gamma-llc-old-spelling", state="TX",
            city="Austin", att_name="Law Firm LLP", att_slug="law-firm-llp"),
        row("G-2", "certified", "2016-05-02", 2016, "GAMMA LLC", "gamma-llc-old-spelling", state="TX",
            city="Austin"),
        row("G-3", "denied", "2016-06-02", 2016, "GAMMA LLC", "gamma-llc-old-spelling", state="TX",
            city="Austin"),
        # Beta: two cases, under the floor, so no rows of its own.
        row("B-1", "certified", "2018-02-01", 2018, "Beta Corp", "beta-corp", state="NJ", city="Newark"),
        row("B-2", "certified", "2018-02-02", 2018, "Beta Corp", "beta-corp", state="NJ", city="Newark"),
        # An employer with no page, filed by the firm: the firm's client list names it, unlinked.
        row("N-1", "certified", "2020-04-01", 2020, "NOBODY LLC", "nobody-llc", state="TX", city="Austin",
            att_name="Law Firm LLP", att_slug="law-firm-llp"),
        # No state: counted in its entity's total, never in the state list.
        row("N-2", "certified", "2020-04-02", 2020, "NOBODY LLC", "nobody-llc", state=None, city=None),
        # Delta: three cases alike in every column on one day (one grouped row, counted three times), filed by the
        # firm under an older name that reaches its page only through the retired slug.
        *[row(f"D-{i}", "certified", "2017-09-05", 2017, "DELTA CO", "delta-co", state="OR", city="Portland",
              soc="11-1021.00", soc_title="General and Operations Managers", att_name="LAW FIRM OF OLDEN DAYS",
              att_slug="law-firm-old") for i in range(1, 4)],
    ]
    marks = ",".join("?" * len(iph.COLUMNS))
    db.conn.executemany(f"INSERT INTO perm_cases_history ({','.join(iph.COLUMNS)}) VALUES ({marks})", hist)
    db.conn.execute("INSERT INTO perm_cases VALUES ('A-5', 'acme-inc', '2024', 'certified')")
    db.conn.execute("INSERT INTO perm_docs VALUES ('perm_history', ?, 0)",
                    [json.dumps({"files": {"PERM_FY2019.xlsx": {"fy": 2019, "caseRows": 9}}})])
    db.conn.commit()
    return db


def facets(db) -> dict:
    out: dict = {}
    for kind, slug, facet, pos, key, label, code, n, cert, den, total, fy_from, fy_to in db.conn.execute(
            "SELECT kind, slug, facet, pos, key, label, code, n, certified, denied, total, fy_from, fy_to "
            "FROM perm_history_entity_facets ORDER BY kind, slug, facet, pos"):
        out.setdefault((kind, slug), {"total": total, "years": (fy_from, fy_to), "facets": {}})
        out[(kind, slug)]["facets"].setdefault(facet, []).append(
            {"key": key, "label": label, "code": code, "n": n, "certified": cert, "denied": den})
    return out


print("each employer's and firm's older cases, by what they were made of")
db = seed()
n = iph.build_entity_facets(db)
got = facets(db)
acme = got.get(("employer", "acme-inc"), {})
check("Acme's total is its four older cases: the alias's row joins, the case perm_cases holds doesn't",
      acme.get("total") == 4, json.dumps(acme.get("total")))
check("its years are its own first and last fiscal year", acme.get("years") == (2015, 2019), str(acme.get("years")))
occ = acme.get("facets", {}).get("occupation", [])
check("its jobs: the code with a page links to it, busiest first",
      occ[:1] == [{"key": "software-developers", "label": "Software Developers", "code": "15-1252.00", "n": 3,
                   "certified": 2, "denied": 0}], json.dumps(occ))
check("a code with no page today still names the job, unlinked",
      {"key": None, "label": "Software Developers, Applications", "code": "15-1132.00", "n": 1, "certified": 0,
       "denied": 1} in occ, json.dumps(occ))
states = {r["key"]: r["n"] for r in acme.get("facets", {}).get("state", [])}
check("its states", states == {"WA": 3, "CA": 1}, json.dumps(states))
cities = {r["label"]: r["n"] for r in acme.get("facets", {}).get("city", [])}
check("one city whatever the capitals, spelled the way most filers mixed-cased it",
      cities.get("Seattle, WA") == 2 and cities.get("Redmond, WA") == 1, json.dumps(cities))
ind = acme.get("facets", {}).get("industry", [])
check("its industry, with Census's title", ind[:1] == [{"key": "541511", "label": "Custom Computer Programming Services",
                                                       "code": None, "n": 3, "certified": 2, "denied": 1}],
      json.dumps(ind))
firms = acme.get("facets", {}).get("attorney", [])
check("its firms: one with a page under the page's name, whatever the filing's spelling",
      firms[:1] == [{"key": "law-firm-llp", "label": "Law Firm LLP", "code": None, "n": 2, "certified": 2,
                     "denied": 0}], json.dumps(firms))
check("a firm with no page is still named, unlinked", any(f["key"] is None and f["label"] == "Other Firm PC"
                                                         for f in firms), json.dumps(firms))
gamma = got.get(("employer", "gamma-llc"), {})
check("rows stored under a spelling with no page reach today's page by name",
      gamma.get("total") == 3 and gamma.get("years") == (2016, 2016), json.dumps(gamma.get("total")))
check("an employer under the floor gets no rows", ("employer", "beta-corp") not in got, str(sorted(got)))
check("an employer with no page gets no rows", not any(k == ("employer", "nobody-llc") for k in got))
firm = got.get(("attorney", "law-firm-llp"), {})
check("the firm's total is every older case naming it, the retired slug's too", firm.get("total") == 7,
      json.dumps(firm.get("total")))
clients = {(c["key"], c["label"]): c["n"] for c in firm.get("facets", {}).get("employer", [])}
check("its clients: pages under their names, and one with no page unlinked",
      clients == {("acme-inc", "ACME INC"): 2, ("gamma-llc", "Gamma LLC"): 1, (None, "NOBODY LLC"): 1,
                  ("delta-co", "Delta Co"): 3},
      json.dumps(sorted(map(str, clients.items()))))
check("the firm's jobs and states too",
      {r["key"] for r in firm.get("facets", {}).get("state", [])} == {"WA", "TX", "OR"}
      and firm.get("facets", {}).get("occupation", [{}])[0].get("n") == 4, json.dumps(firm.get("facets")))
delta = got.get(("employer", "delta-co"), {})
check("three cases alike in every column count three times",
      delta.get("total") == 3 and delta.get("facets", {}).get("state", [{}])[0].get("n") == 3
      and delta.get("facets", {}).get("occupation", [{}])[0].get("certified") == 3, json.dumps(delta))
check("the builder says how many rows it wrote",
      n == db.conn.execute("SELECT COUNT(*) FROM perm_history_entity_facets").fetchone()[0], str(n))

print("read five decision days at a time, grouped inside the slice, never the whole table at once")
reads = [(q, a) for q, a in db.calls if "FROM perm_cases_history" in q and "MIN(" not in q and "MAX(" not in q]
check("every read of the older table is bounded by a decision-day range",
      reads and all("decision_date >= ?" in q and "decision_date < ?" in q for q, _ in reads),
      "\n".join(q for q, _ in reads))
check("every read leaves out the cases perm_cases holds",
      all("NOT EXISTS (SELECT 1 FROM perm_cases p WHERE p.case_number = h.case_number)" in q for q, _ in reads))
spans = [(date.fromisoformat(a[1]) - date.fromisoformat(a[0])).days for _, a in reads]
check("no read spans more than five days (a raw ten-day slice of 4,858 rows took 1.09 s on the live database)",
      spans and max(spans) <= 5, str(sorted(set(spans))))
covered = sorted((a[0], a[1]) for _, a in reads)
check("the slices meet end to end, from the first decision month to the last",
      covered[0][0] == "2015-03-01" and covered[-1][1] == "2020-05-01"
      and all(x[1] == y[0] for x, y in zip(covered, covered[1:])), str(covered[:3]))
check("each slice is grouped inside its own range, so a busy week comes back as its distinct combinations",
      all(re.search(r"WHERE decision_date >= \? AND decision_date < \?[\s\S]*GROUP BY", q) for q, _ in reads),
      reads[0][0] if reads else "")
check("no statement groups the older table outside a decision-day range",
      not any(re.search(r"FROM perm_cases_history[\s\S]*GROUP BY", s) and "decision_date >= ?" not in s
              for s in db.statements))
leading = {re.search(r"\((\w+)", ddl).group(1) for ddl in iph.SCHEMA + iph.SEARCH_INDEXES
           if ddl.lstrip().startswith("CREATE INDEX") and "perm_cases_history" in ddl}
first_group = (re.search(r"GROUP BY\s+(\w+)", reads[0][0]) or [None, ""])[1] if reads else ""
check("the grouping leads with a column no index leads with, so no index can stand in for the day range",
      bool(first_group) and first_group not in leading | {"case_number"}, f"{first_group} vs {sorted(leading)}")

print("the case search's state counts")
doc = json.loads(db.conn.execute("SELECT json FROM perm_docs WHERE key = 'perm_history'").fetchone()[0])
check("the loaded files stay in the doc", doc.get("files", {}).get("PERM_FY2019.xlsx", {}).get("caseRows") == 9,
      json.dumps(doc.get("files")))
by = {s["state"]: s for s in doc.get("byState", [])}
check("WA counts Acme's three", by.get("WA") == {"state": "WA", "total": 3, "certified": 2, "denied": 0,
                                                 "withdrawn": 1}, json.dumps(by.get("WA")))
check("TX counts Gamma's three and the one with no page",
      by.get("TX", {}).get("total") == 4 and by.get("TX", {}).get("denied") == 1, json.dumps(by.get("TX")))
check("a case perm_cases holds isn't counted here (no NY)", "NY" not in by, json.dumps(sorted(by)))
check("a case with no state isn't a state", None not in by and "" not in by, json.dumps(sorted(map(str, by))))
check("Delta's three in Oregon", by.get("OR", {}).get("total") == 3, json.dumps(by.get("OR")))
check("busiest state first", [s["state"] for s in doc["byState"]][:1] == ["TX"], json.dumps(doc["byState"]))
check("the doc says which fiscal years its state counts cover",
      doc.get("byStateYears") == {"from": 2015, "to": 2020}, json.dumps(doc.get("byStateYears")))

print("an occupation's older cases: who filed it, which firms, where")
job = got.get(("occupation", "software-developers"), {})
check("its total and years: every older case under a code with a page", job.get("total") == 10
      and job.get("years") == (2015, 2020), json.dumps([job.get("total"), job.get("years")]))
sponsors = {(r["key"], r["label"]): r["n"] for r in job.get("facets", {}).get("employer", [])}
check("its sponsors: pages under their names (an under-the-floor page too), one with no page unlinked",
      sponsors == {("acme-inc", "ACME INC"): 3, ("gamma-llc", "Gamma LLC"): 3, ("beta-corp", "Beta Corp"): 2,
                   (None, "NOBODY LLC"): 2}, json.dumps(sorted(map(str, sponsors.items()))))
job_firms = {(r["key"], r["label"]): r["n"] for r in job.get("facets", {}).get("attorney", [])}
check("its firms", job_firms == {("law-firm-llp", "Law Firm LLP"): 4}, json.dumps(sorted(map(str, job_firms.items()))))
job_states = {r["key"]: r["n"] for r in job.get("facets", {}).get("state", [])}
check("its states", job_states == {"TX": 4, "WA": 3, "NJ": 2}, json.dumps(job_states))
job_cities = {r["label"]: r["n"] for r in job.get("facets", {}).get("city", [])}
check("its cities", job_cities == {"Austin, TX": 4, "Seattle, WA": 2, "Newark, NJ": 2, "Redmond, WA": 1},
      json.dumps(job_cities))
check("a code with no page gets no occupation rows",
      not any(k[0] == "occupation" and k[1] != "software-developers" for k in got), str(sorted(got)))

print("a name withheld on the site: a spelling that reached a page is never written, only the page's own name")
names = {(k, s_): n for k, s_, n in db.conn.execute("SELECT kind, slug, name FROM perm_entities")}
linked = db.conn.execute(
    "SELECT facet, key, label FROM perm_history_entity_facets WHERE facet IN ('attorney','employer') "
    "AND key IS NOT NULL").fetchall()
check("every linked firm or employer carries its page's slug and its page's name, which the masker knows",
      bool(linked) and all(label == names.get((facet, key)) for facet, key, label in linked), str(linked))
labels = {r[0] for r in db.conn.execute("SELECT label FROM perm_history_entity_facets")}
older = {"LAW FIRM OF OLDEN DAYS", "Law Firm, LLP", "Acme Inc.", "GAMMA LLC", "DELTA CO"}
check("no older spelling of a page is written: not the firm's name before its merge, nor a filing's own spelling",
      not labels & older, str(sorted(labels & older)))
delta_firm = got.get(("employer", "delta-co"), {}).get("facets", {}).get("attorney", [])
check("Delta's firm, filed under its old name and slug, is the page", delta_firm[:1] == [
    {"key": "law-firm-llp", "label": "Law Firm LLP", "code": None, "n": 3, "certified": 3, "denied": 0}],
      json.dumps(delta_firm))

print("its counts wait on disk, so memory doesn't grow with the pairs the older table holds")


def corpus(n: int):
    """The seed, plus n cases filed by the firm for n employers with no page, each in a town of its own: 25 a
    day, so a slice holds as many however big n is, and only the pairs grow."""
    big = seed()
    start = date(2016, 1, 1)
    rows = [row(f"Z-{i}", "certified", (start + timedelta(days=i // 25)).isoformat(), 2016,
                f"CLIENT {i:05d} WIDGETS", f"client-{i:05d}-widgets", state="WA", city=f"Town {i:05d}",
                att_name="Law Firm LLP", att_slug="law-firm-llp") for i in range(n)]
    marks = ",".join("?" * len(iph.COLUMNS))
    big.conn.executemany(f"INSERT INTO perm_cases_history ({','.join(iph.COLUMNS)}) VALUES ({marks})", rows)
    big.conn.commit()
    return big


def peak(n: int):
    big = corpus(n)
    held = getattr(iph, "NAME_CACHE_MAX", None)
    iph.NAME_CACHE_MAX = 200
    tracemalloc.start()
    try:
        iph.build_entity_facets(big)
        return tracemalloc.get_traced_memory()[1], big
    finally:
        tracemalloc.stop()
        iph.NAME_CACHE_MAX = held


small, _ = peak(2000)
large, big = peak(10000)
check("8,000 more employers and towns cost under 300 KB more at the peak", large - small < 300_000,
      f"{small:,} -> {large:,} bytes")
big_firm = facets(big).get(("attorney", "law-firm-llp"), {})
check("and the counts are still exact", big_firm.get("total") == 10007
      and {r["key"]: r["n"] for r in big_firm["facets"]["state"]}.get("WA") == 10002, json.dumps(big_firm.get("total")))

opened: list[str] = []
real_open = getattr(iph, "open_scratch", None)


def watch_open(path):
    opened.append(str(path))
    return real_open(path)


iph.open_scratch = watch_open
with tempfile.TemporaryDirectory() as scratch:
    try:
        iph.build_entity_facets(seed(), scratch_dir=scratch)
    except TypeError as exc:
        check("the builder takes a scratch folder", False, str(exc))
    check("the counts were kept in a file in the scratch folder",
          len(opened) == 1 and opened[0].startswith(scratch), str(opened))
    check("and the file is gone afterwards", os.listdir(scratch) == [], str(os.listdir(scratch)))
iph.open_scratch = real_open

print("a rebuild replaces the table, and pages never read it half-written")
iph.build_entity_facets(db)
again = db.conn.execute("SELECT COUNT(*) FROM perm_history_entity_facets").fetchone()[0]
check("rebuilding replaces the rows, never doubles them", again == n, f"{again} vs {n}")
check("the new rows are written aside and swapped in whole",
      any("INTO perm_history_entity_facets_next" in s for s in db.statements)
      and not any(re.match(r"\s*DELETE FROM perm_history_entity_facets\b", s) for s in db.statements))
left = db.conn.execute("SELECT name FROM sqlite_master WHERE name = 'perm_history_entity_facets_next'").fetchall()
check("no table is left aside after the swap", left == [], str(left))

print("without the decision-day index it refuses rather than scan the table once a month")
bare = seed()
bare.conn.execute("DROP INDEX idx_pch_dec")
try:
    iph.build_entity_facets(bare)
    check("it refused", False, "built without the index")
except RuntimeError as exc:
    check("it refused, naming the index", "idx_pch_dec" in str(exc), str(exc))

print("the flag builds just this piece")
flagged = seed()
iph.Database = lambda: flagged
old_argv = sys.argv
sys.argv = ["ingest_perm_history.py", "--entity-facets"]
try:
    rc = iph.main()
finally:
    sys.argv = old_argv
check("--entity-facets exits 0", rc == 0, str(rc))
check("--entity-facets wrote the table and the state counts",
      flagged.conn.execute("SELECT COUNT(*) FROM perm_history_entity_facets").fetchone()[0] == n
      and "byState" in json.loads(flagged.conn.execute(
          "SELECT json FROM perm_docs WHERE key = 'perm_history'").fetchone()[0]))
check("--entity-facets read no workbook and touched no case row",
      not any(re.search(r"(INTO|UPDATE)\s+perm_cases_history", s) for s in flagged.statements))

print("the pages are read a slug window at a time, busiest still winning a shared spelling")
paged = seed()
# A page whose slug sorts first shares a spelling's key with a busier page whose slug sorts after it.
paged.conn.executemany("INSERT INTO perm_entities VALUES (?,?,?,?,?,?)", [
    ("employer", "aaa-zeta", "ZETA INC", entity_key("ZETA INC"), None, 5),
    ("employer", "zeta-inc", "Zeta, Inc.", entity_key("ZETA INC"), None, 900),
])
paged.conn.commit()
paged.statements.clear()
pages = iph.EntityPages(paged)
reads = [q for q in paged.statements if "FROM perm_entities" in q]
check("every read of the pages is bounded by a slug window, with no sort over the whole table (1.10 s live, Nov 21)",
      bool(reads) and all("slug >= ?" in q and "ORDER BY" not in q for q in reads), "\n".join(reads[:3]))
check("one read per slug window", len(reads) == len(iph.SLUG_WINDOWS), str(len(reads)))
check("the busiest page wins a shared spelling, whatever its slug sorts like",
      pages.by_name["employer"].get(entity_key("ZETA INC")) == "zeta-inc",
      str(pages.by_name["employer"].get(entity_key("ZETA INC"))))
check("every page is still known", ("employer", "aaa-zeta") in pages.names and ("attorney", "law-firm-llp") in pages.names)

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

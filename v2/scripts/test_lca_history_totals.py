#!/usr/bin/env python3
"""DOL's FY2008 to FY2019 H-1B files reach the employer pages and the city pages, counted once at their load.

The older files sit in `lca_cases_history` (the LCA database) and change only when one loads. The nightly employer
map read `lca_cases` alone, so an employer with only older LCAs got no page (the owner's standing decision is that
every employer with filings gets one), and the city pages' LCA totals said FY2020 on while the builder called them
every LCA (the Nov 20 2026 sweep, items 29 and 30). The older table's share is now counted at its load, a fiscal
year at a time, into two small tables in the main database (lca_history_totals.py), which the two nightly builders
fold in beside `lca_cases`.

Run:  python3 scripts/test_lca_history_totals.py
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_employer_map as bem  # noqa: E402
import build_lca_cities as blc  # noqa: E402
import ingest_flag_disclosure as ifd  # noqa: E402
import lca_history_totals as lht  # noqa: E402
from lib_db import request_sqls  # noqa: E402
from lib_sqlite_shim import SplitSqlite  # noqa: E402

FAILED: list[str] = []


def check(name: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {name}: {got!r}" + ("" if ok else f" (want {want!r})"))
    if not ok:
        FAILED.append(name)


class Recorder(SplitSqlite):
    """SplitSqlite that keeps every statement it was sent, in order."""

    def __init__(self) -> None:
        super().__init__()
        self.sent: list[str] = []

    def execute(self, sql, args=None, **kw):
        self.sent.append(sql)
        return super().execute(sql, args, **kw)

    def script(self, statements):
        self.sent.extend(statements)
        return super().script(statements)

    def pipeline(self, reqs, **kw):
        self.sent.extend(request_sqls(reqs))
        return super().pipeline(reqs, **kw)


LCA_COLS = """(case_number TEXT PRIMARY KEY, case_status TEXT, received_date TEXT, decision_date TEXT,
               employer_name TEXT, employer_slug TEXT, worksite_city TEXT, worksite_state TEXT,
               visa_class TEXT, fiscal_year INTEGER, soc_code TEXT, soc_title TEXT)"""


def history_row(n: int, fy: int, name: str | None, slug: str | None, city: str | None = "Boise",
                state: str | None = "ID", status: str = "CERTIFIED", received: str | None = None) -> list:
    return [f"I-200-{fy % 100:02d}001-{n:06d}", status, received or f"{fy - 1}-11-{1 + n % 27:02d}",
            f"{fy - 1}-12-{1 + n % 27:02d}", name, slug, city, state, "H-1B", fy, "15-1252.00", "Software Developers"]


def seed() -> Recorder:
    db = Recorder()
    db.script([
        f"CREATE TABLE lca_cases {LCA_COLS}",
        f"CREATE TABLE lca_cases_history {LCA_COLS}",
        # The index every older-file read rides (ingest_flag_disclosure.index_ddl): a read naming it fails here
        # as it would live when the name is wrong.
        "CREATE INDEX lca_cases_history_fy ON lca_cases_history (fiscal_year, case_status, visa_class)",
    ])
    rows = []
    n = 0

    def add(k: int, fy: int, name, slug, **kw) -> None:
        nonlocal n
        for _ in range(k):
            n += 1
            rows.append(history_row(n, fy, name, slug, **kw))

    # An employer whose LCAs are all in the older files.
    add(3, 2012, "Old Only Corp", "old-only-corp", city="St. Louis", state="MO")
    add(2, 2015, "OLD ONLY CORP", "old-only-corp", city="ST LOUIS", state="MO")
    # An older spelling of a PERM employer.
    add(4, 2016, "INTEL CORP", "intel-corp", city="Hillsboro", state="OR")
    # An employer that files today too: its older LCAs add to its count and move its first filing back.
    add(2, 2018, "Acme Robotics LLC", "acme-robotics-llc", city="Boise", state="ID", status="DENIED")
    # A city only the older files hold, with 25 LCAs.
    add(25, 2010, "Prairie Labs Inc", "prairie-labs-inc", city="Ames", state="IA")
    # Rows that can't be placed: no employer, no city.
    add(1, 2011, None, None, city="Boise", state="ID")
    add(1, 2011, "Nowhere Inc", "nowhere-inc", city=None, state="ID")
    for r in rows:
        db.execute("INSERT INTO lca_cases_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", r)
    # A case the newer files hold too (republished with a later decision): counted there, never twice.
    both = history_row(999, 2019, "Acme Robotics LLC", "acme-robotics-llc", city="Boise", state="ID")
    db.execute("INSERT INTO lca_cases_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", both)
    db.execute("INSERT INTO lca_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
               [both[0], "CERTIFIED - WITHDRAWN", both[2], "2019-11-02", *both[4:9], 2020, *both[10:]])
    db.sent.clear()
    return db


def table(db: Recorder, sql: str) -> list[tuple]:
    return [tuple(r) for r in db.main.conn.execute(sql).fetchall()]


def check_build() -> None:
    print("the older files' counts, built once")
    db = seed()
    got = lht.build(db)
    spell = {(s, nm): (n, a, b) for s, nm, n, a, b in table(
        db, f"SELECT employer_slug, employer_name, n, first_received, last_decided FROM {lht.SPELLINGS}")}
    check("one row per spelling as printed", spell.get(("old-only-corp", "Old Only Corp")),
          (3, "2011-11-02", "2011-12-04"))
    check("a second printing of the same slug keeps its own row", spell.get(("old-only-corp", "OLD ONLY CORP"))[0], 2)
    check("a case the newer files hold is left out", spell.get(("acme-robotics-llc", "Acme Robotics LLC"))[0], 2)
    check("a row with no employer makes no spelling", [k for k in spell if not k[0]], [])
    cities = {(c, s): (n, cert, lo, hi) for c, s, n, cert, lo, hi in table(
        db, f"SELECT worksite_city, worksite_state, n, certified, fy_from, fy_to FROM {lht.CITIES}")}
    check("a city as printed, with its certified count and its years", cities.get(("ST LOUIS", "MO")),
          (2, 2, 2015, 2015))
    check("denied LCAs count, and aren't certified", cities.get(("Boise", "ID")), (3, 1, 2011, 2018))
    check("a row with no city makes no city row", [k for k in cities if not k[0]], [])
    check("the build says what it holds", (got["spellings"], got["cities"]), (len(spell), len(cities)))

    reads = [s for s in db.sent if "lca_cases_history" in s]
    yearly = [s for s in reads if "fiscal_year = ?" in s]
    check("the older table is read a fiscal year at a time (two reads a year, FY2010 to FY2019)", len(yearly), 20)
    check("every yearly read rides the fiscal-year index",
          all("INDEXED BY lca_cases_history_fy" in s for s in yearly), True)
    # One MIN and one MAX each seek the index's end; both in one statement walk the whole index (SQLite's
    # min/max shortcut takes a lone aggregate only).
    check("its only other reads are the span's two ends, one statement each",
          [" ".join(s.split()) for s in reads if s not in yearly],
          ["SELECT MIN(fiscal_year) FROM lca_cases_history", "SELECT MAX(fiscal_year) FROM lca_cases_history"])
    check("nothing it writes names the older table",
          [s for s in db.sent if s.lstrip().upper().startswith(("INSERT", "DELETE", "UPDATE"))
           and "lca_cases" in s], [])

    print("a rebuild writes only what changed")
    db.sent.clear()
    lht.build(db)
    writes = [s for s in db.sent if s.lstrip().upper().startswith(("INSERT", "DELETE"))]
    check("an unchanged rebuild writes nothing", writes, [])
    db.lca.conn.execute("DELETE FROM lca_cases_history WHERE employer_name = 'OLD ONLY CORP'")
    db.lca.conn.execute("INSERT INTO lca_cases_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        history_row(5000, 2013, "Old Only Corp", "old-only-corp", city="St. Louis", state="MO"))
    db.lca.conn.commit()
    lht.build(db)
    spell = {(s, nm): n for s, nm, n in table(db, f"SELECT employer_slug, employer_name, n FROM {lht.SPELLINGS}")}
    check("a changed count is rewritten", spell.get(("old-only-corp", "Old Only Corp")), 4)
    check("a spelling the older files no longer hold is removed", ("old-only-corp", "OLD ONLY CORP") in spell, False)
    cities = {(c, s) for c, s in table(db, f"SELECT worksite_city, worksite_state FROM {lht.CITIES}")}
    check("a city the older files no longer hold is removed", ("ST LOUIS", "MO") in cities, False)

    print("no older table, no rebuild: what the tables hold stays")
    before = table(db, f"SELECT COUNT(*) FROM {lht.SPELLINGS}")
    db.lca.conn.execute("DROP TABLE lca_cases_history")
    try:
        lht.build(db)
        refused = False
    except RuntimeError as e:
        refused = "lca_cases_history" in str(e)
    check("an older table that's missing stops the build by name", refused, True)
    check("and leaves the counts it had", table(db, f"SELECT COUNT(*) FROM {lht.SPELLINGS}"), before)


def check_employer_map() -> None:
    print("the employer map folds the older spellings in")
    db = seed()
    db.script([
        "CREATE TABLE perm_entities (kind TEXT, slug TEXT, name TEXT, merge_key TEXT, total INTEGER)",
        "CREATE TABLE perm_entity_alias (kind TEXT, slug TEXT, target_slug TEXT)",
        "CREATE TABLE lca_case_numbers (case_number TEXT PRIMARY KEY, received_date TEXT)",
        "INSERT INTO perm_entities VALUES ('employer', 'intel-corporation', 'Intel Corporation', 'intel', 900)",
    ])
    db.execute("INSERT INTO lca_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
               ["I-200-25001-000001", "CERTIFIED", "2024-10-01", "2024-10-08", "Acme Robotics LLC",
                "acme-robotics-llc", "Boise", "ID", "H-1B", 2025, "15-1252.00", "Software Developers"])
    before = bem.plan(bem.read_sources(db), bem.read_pages(db))
    check("before the older counts are built, an employer with only older LCAs has no page",
          "old-only-corp" in {r[0] for r in before[1]}, False)
    check("and no table missing stops the nightly map", len(before[0]) > 0, True)

    lht.build(db)
    db.sent.clear()
    rows, index_rows, _ = bem.plan(bem.read_sources(db), bem.read_pages(db))
    page = {r[0]: (r[1], r[2]) for r in rows}
    idx = {r[0]: dict(zip(bem.INDEX_COLS, r)) for r in index_rows}
    check("an employer with only older LCAs gets a page", page.get("old-only-corp"), ("old-only-corp", "other"))
    old = idx.get("old-only-corp", {})
    check("its page counts every older LCA under each printing", (old.get("lca"), old.get("cases")), (5, 5))
    check("its first filing and latest activity are the older files' days",
          (old.get("first_filed"), old.get("last_changed")), ("2011-11-02", "2014-12-06"))
    check("an older spelling of a PERM employer reaches the PERM page", page.get("intel-corp"),
          ("intel-corporation", "perm"))
    acme = idx.get("acme-robotics-llc", {})
    check("an employer filing today adds its older LCAs, the shared case once", acme.get("lca"), 4)
    check("and its first filing moves back to the older files", acme.get("first_filed"), "2017-11-11")
    check("the nightly map never reads the older table itself",
          [s for s in db.sent if "lca_cases_history" in s], [])
    check("it reads the counts a slice of spellings at a time",
          all("employer_slug >= ?" in s for s in db.sent if lht.SPELLINGS in s), True)


def check_cities() -> None:
    print("the city pages' LCA totals cover the older files")
    db = seed()
    db.script([
        "CREATE TABLE employer_page_map (source_slug TEXT PRIMARY KEY, page_slug TEXT, page_kind TEXT, key TEXT)",
        "CREATE TABLE perm_entities (kind TEXT, slug TEXT, code TEXT)",
        "CREATE TABLE perm_groups (kind TEXT, slug TEXT, key TEXT)",
    ])
    for i in range(22):
        db.execute("INSERT INTO lca_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   [f"I-200-25001-{i:06d}", "CERTIFIED", "2024-10-01", "2024-10-08", "Acme Robotics LLC",
                    "acme-robotics-llc", "Boise", "ID", "H-1B", 2025, "15-1252.00", "Software Developers"])
    bare = {r[0]: dict(zip(blc.COLS, r)) for r in blc.plan(blc.read(db))}
    check("before the older counts are built, Boise reads the newer files alone",
          (bare["BOISE|ID"]["total"], bare["BOISE|ID"]["fy_from"]), (23, 2020))

    lht.build(db)
    db.sent.clear()
    by = {r[0]: dict(zip(blc.COLS, r)) for r in blc.plan(blc.read(db))}
    boise = by["BOISE|ID"]
    check("a city's total adds the older files' LCAs", (boise["total"], boise["certified"]), (26, 23))
    check("and its years say so", (boise["fy_from"], boise["fy_to"]), (2011, 2025))
    ames = by.get("AMES|IA", {})
    check("a city only the older files hold, with 20 or more, gets its row", (ames.get("total"), ames.get("slug")),
          (25, "ames-ia"))
    check("its label comes from the older files' spellings", ames.get("label"), "Ames, IA")
    detail = json.loads(ames.get("detail") or "{}")
    check("its top lists stay the newest three years, so they're empty, not old",
          (detail.get("employers"), detail.get("occupations")), ([], []))
    check("a city under 20 with the older files added still has no row", "HILLSBORO|OR" in by, False)
    check("the nightly city build never reads the older table itself",
          [s for s in db.sent if "lca_cases_history" in s], [])


def check_loader() -> None:
    print("the loader builds them after an older file, and alone by a flag")
    db = seed()
    real_db, real_argv = ifd.Database, sys.argv
    ifd.Database = lambda *a, **k: db  # noqa: E731
    try:
        sys.argv = ["ingest_flag_disclosure.py", "--program", "lca", "--history-totals"]
        code = ifd.main()
    finally:
        ifd.Database, sys.argv = real_db, real_argv
    check("--history-totals builds both tables and stops", code, 0)
    check("the spellings are there", table(db, f"SELECT COUNT(*) FROM {lht.SPELLINGS}")[0][0] > 0, True)
    check("no download, no load: the older table is only read",
          [s for s in db.sent if s.lstrip().upper().startswith(("INSERT", "DELETE"))
           and "lca_cases" in s.split("(")[0]], [])
    runs = table(db, "SELECT script, status FROM ingest_runs")
    check("the run is recorded under its own name",
          runs, [("ingest_flag_disclosure.py --program lca --history-totals", "ok")])

    body = (pathlib.Path(__file__).resolve().parent / "ingest_flag_disclosure.py").read_text()
    load = body[body.index('log(f"Loading {name} into {table}")'):]
    load = load[:load.index("stamp_freshness(")]
    check("an older file's load rebuilds them before it reports the run",
          load.index("history_totals(db") < load.index('note=f"{name}: {stats.kept:,} cases (history)"'), True)


def main() -> int:
    check_build()
    check_employer_map()
    check_cities()
    check_loader()
    print(f"\n{len(FAILED)} failure(s)")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

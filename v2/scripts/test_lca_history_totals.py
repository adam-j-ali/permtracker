#!/usr/bin/env python3
"""DOL's FY2008 to FY2019 H-1B files reach the employer pages and the city pages, counted once at their load.

The older files sit in `lca_cases_history` (the LCA database) and change only when one loads. The nightly employer
map read `lca_cases` alone, so an employer with only older LCAs got no page (the owner's standing decision is that
every employer with filings gets one), and the city pages' LCA totals said FY2020 on while the builder called them
every LCA (the Nov 20 2026 sweep, items 29 and 30). An employer page's program ledger and its LCA profile read the
newer files alone too (items 16 and 17). The older table's share is now counted at its load into two small tables
in the main database (lca_history_totals.py), which the readers add beside `lca_cases`.

Every read of the older table must stay under a second on the live database (Nov 21 2026: grouping its smallest
fiscal year took 4.8 s, a ten-day decision slice 2.97 s), so it's read in pages of rows by rowid, grouped inside
the page, and these checks hold the reads to that shape.

Run:  python3 scripts/test_lca_history_totals.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_employer_map as bem  # noqa: E402
import build_lca_cities as blc  # noqa: E402
import ingest_flag_disclosure as ifd  # noqa: E402
import lca_history_totals as lht  # noqa: E402
from lib_db import request_sqls  # noqa: E402
from lib_sqlite_shim import SplitSqlite  # noqa: E402

FAILED: list[str] = []
V2 = pathlib.Path(__file__).resolve().parent.parent


def check(name: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {name}: {got!r}" + ("" if ok else f" (want {want!r})"))
    if not ok:
        FAILED.append(name)


class Recorder(SplitSqlite):
    """SplitSqlite that keeps every statement it was sent, in order, with its arguments."""

    def __init__(self) -> None:
        super().__init__()
        self.sent: list[str] = []
        self.calls: list[tuple[str, list]] = []

    def execute(self, sql, args=None, **kw):
        self.sent.append(sql)
        self.calls.append((sql, list(args or [])))
        return super().execute(sql, args, **kw)

    def script(self, statements):
        self.sent.extend(statements)
        return super().script(statements)

    def pipeline(self, reqs, **kw):
        self.sent.extend(request_sqls(reqs))
        return super().pipeline(reqs, **kw)


COLS = ["case_number", "case_status", "received_date", "decision_date", "employer_name", "employer_slug",
        "worksite_city", "worksite_state", "visa_class", "fiscal_year", "soc_code", "soc_title", "workers",
        "new_employment", "continued_employment", "change_previous_employment", "new_concurrent_employment",
        "change_employer", "amended_petition", "wage_level", "h1b_dependent", "willful_violator"]
LCA_COLS = ("(case_number TEXT PRIMARY KEY, case_status TEXT, received_date TEXT, decision_date TEXT, "
            "employer_name TEXT, employer_slug TEXT, worksite_city TEXT, worksite_state TEXT, visa_class TEXT, "
            "fiscal_year INTEGER, soc_code TEXT, soc_title TEXT, workers INTEGER, new_employment INTEGER, "
            "continued_employment INTEGER, change_previous_employment INTEGER, new_concurrent_employment INTEGER, "
            "change_employer INTEGER, amended_petition INTEGER, wage_level TEXT, h1b_dependent INTEGER, "
            "willful_violator INTEGER)")


def row(n: int, fy: int, name: str | None, slug: str | None, city: str | None = "Boise", state: str | None = "ID",
        status: str = "CERTIFIED", **extra) -> dict:
    r = {"case_number": f"I-200-{fy % 100:02d}001-{n:06d}", "case_status": status,
         "received_date": f"{fy - 1}-11-{1 + n % 27:02d}", "decision_date": f"{fy - 1}-12-{1 + n % 27:02d}",
         "employer_name": name, "employer_slug": slug, "worksite_city": city, "worksite_state": state,
         "visa_class": "H-1B", "fiscal_year": fy, "soc_code": "15-1252.00", "soc_title": "Software Developers",
         "workers": 1}
    r.update(extra)
    return r


def insert(db: Recorder, table: str, r: dict) -> None:
    cols = [c for c in COLS if c in r]
    db.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [r[c] for c in cols])


def seed() -> Recorder:
    db = Recorder()
    db.script([
        f"CREATE TABLE lca_cases {LCA_COLS}",
        f"CREATE TABLE lca_cases_history {LCA_COLS}",
        # The loader's indexes on the older table: a read that names one fails here as it would live.
        "CREATE INDEX lca_cases_history_fy ON lca_cases_history (fiscal_year, case_status, visa_class)",
        "CREATE INDEX lca_cases_history_decided ON lca_cases_history (decision_date)",
    ])
    n = 0

    def add(k: int, fy: int, name, slug, **kw) -> None:
        nonlocal n
        for _ in range(k):
            n += 1
            insert(db, "lca_cases_history", row(n, fy, name, slug, **kw))

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
    # A case the newer files hold too (republished with a later decision): counted there, never twice.
    both = row(999, 2019, "Acme Robotics LLC", "acme-robotics-llc", city="Boise", state="ID")
    insert(db, "lca_cases_history", both)
    insert(db, "lca_cases", {**both, "case_status": "CERTIFIED - WITHDRAWN", "decision_date": "2019-11-02",
                             "fiscal_year": 2020})
    db.sent.clear()
    db.calls.clear()
    return db


def table(db: Recorder, sql: str) -> list[tuple]:
    return [tuple(r) for r in db.main.conn.execute(sql).fetchall()]


def history_reads(db: Recorder) -> list[tuple[str, list]]:
    return [(s, a) for s, a in db.calls if "lca_cases_history" in s]


def check_build() -> None:
    print("the older files' counts, built once")
    db = seed()
    got = lht.build(db, page_rows=4, pause=0)
    spell = {(s, nm): (n, a, b) for s, nm, n, a, b in table(
        db, f"SELECT employer_slug, employer_name, n, first_received, last_decided FROM {lht.SPELLINGS}")}
    check("one row per spelling as printed", spell.get(("old-only-corp", "Old Only Corp")),
          (3, "2011-11-02", "2011-12-04"))
    check("a second printing of the same slug keeps its own row", spell.get(("old-only-corp", "OLD ONLY CORP"))[0], 2)
    check("a case the newer files hold is left out", spell.get(("acme-robotics-llc", "Acme Robotics LLC"))[0], 2)
    check("a row with no employer makes no spelling", [k for k in spell if not k[0]], [])
    years = dict(((s, nm), (lo, hi)) for s, nm, lo, hi in table(
        db, f"SELECT employer_slug, employer_name, fy_from, fy_to FROM {lht.SPELLINGS}"))
    check("each spelling carries its first and last fiscal year", years.get(("old-only-corp", "Old Only Corp")),
          (2012, 2012))
    cities = {(c, s): (n, cert, lo, hi) for c, s, n, cert, lo, hi in table(
        db, f"SELECT worksite_city, worksite_state, n, certified, fy_from, fy_to FROM {lht.CITIES}")}
    check("a city as printed, with its certified count and its years", cities.get(("ST LOUIS", "MO")),
          (2, 2, 2015, 2015))
    check("denied LCAs count, and aren't certified", cities.get(("Boise", "ID")), (3, 1, 2011, 2018))
    check("a row with no city makes no city row", [k for k in cities if not k[0]], [])
    check("the build says what it holds", (got["spellings"], got["cities"], got["from"], got["to"]),
          (len(spell), len(cities), 2010, 2018))
    check("nothing it writes names the older table",
          [s for s in db.sent if s.lstrip().upper().startswith(("INSERT", "DELETE", "UPDATE"))
           and "lca_cases" in s], [])

    print("the older table is read a page of rows at a time, never a year or a day")
    reads = history_reads(db)
    pages = [(s, a) for s, a in reads if lht.PAGE_WHERE in s]
    seeks = [s for s, _ in reads if lht.PAGE_WHERE not in s]
    check("no read groups or filters by the fiscal year", [s for s, _ in reads if "fiscal_year = ?" in s], [])
    check("no read walks a range of decision days", [s for s, _ in reads if "decision_date >=" in s], [])
    check("every page read opens at most a page of rows", all(a[1] - a[0] + 1 <= 4 for _, a in pages), True)
    check("two grouped reads a page, the spellings and the cities",
          (len(pages) % 2, {("GROUP BY employer_slug" in s, "GROUP BY worksite_city" in s) for s, _ in pages}),
          (0, {(True, False), (False, True)}))
    check("its only other reads are seeks on the rowid: the two ends and the next row after a page",
          sorted({" ".join(s.split()) for s in seeks}),
          sorted({lht.FIRST_ROW_SQL, lht.LAST_ROW_SQL, lht.NEXT_ROW_SQL}))
    check("every page leaves out the cases the newer files hold", all(lht.NOT_CURRENT in s for s, _ in pages), True)

    print("a gap in the rowids costs no empty pages")
    db = seed()
    db.lca.conn.execute("DELETE FROM lca_cases_history WHERE rowid BETWEEN 6 AND 30")
    db.lca.conn.commit()
    lht.build(db, page_rows=4, pause=0)
    starts = [a[0] for s, a in history_reads(db) if "GROUP BY worksite_city" in s]
    check("the next page starts at the next row that exists", 6 in starts or any(6 <= s <= 30 for s in starts), False)
    spell = {(s, nm): n for s, nm, n in table(db, f"SELECT employer_slug, employer_name, n FROM {lht.SPELLINGS}")}
    left = {(str(s), str(nm or "")): n for s, nm, n in db.lca.conn.execute(
        "SELECT employer_slug, employer_name, COUNT(*) FROM lca_cases_history h WHERE employer_slug <> '' AND "
        "NOT EXISTS (SELECT 1 FROM lca_cases c WHERE c.case_number = h.case_number) "
        "GROUP BY employer_slug, employer_name").fetchall()}
    check("pages add up to the whole table's grouping", spell, left)

    print("a rebuild writes only what changed")
    db = seed()
    lht.build(db, page_rows=50, pause=0)
    db.sent.clear()
    lht.build(db, page_rows=50, pause=0)
    writes = [s for s in db.sent if s.lstrip().upper().startswith(("INSERT", "DELETE"))]
    check("an unchanged rebuild writes nothing", writes, [])
    db.lca.conn.execute("DELETE FROM lca_cases_history WHERE employer_name = 'OLD ONLY CORP'")
    db.lca.conn.commit()
    insert(db, "lca_cases_history", row(5000, 2013, "Old Only Corp", "old-only-corp", city="St. Louis", state="MO"))
    lht.build(db, page_rows=50, pause=0)
    spell = {(s, nm): n for s, nm, n in table(db, f"SELECT employer_slug, employer_name, n FROM {lht.SPELLINGS}")}
    check("a changed count is rewritten", spell.get(("old-only-corp", "Old Only Corp")), 4)
    check("a spelling the older files no longer hold is removed", ("old-only-corp", "OLD ONLY CORP") in spell, False)
    cities = {(c, s) for c, s in table(db, f"SELECT worksite_city, worksite_state FROM {lht.CITIES}")}
    check("a city the older files no longer hold is removed", ("ST LOUIS", "MO") in cities, False)

    print("no older table, no rebuild: what the tables hold stays")
    before = table(db, f"SELECT COUNT(*) FROM {lht.SPELLINGS}")
    db.lca.conn.execute("DROP TABLE lca_cases_history")
    try:
        lht.build(db, page_rows=50, pause=0)
        refused = False
    except RuntimeError as e:
        refused = "lca_cases_history" in str(e)
    check("an older table that's missing stops the build by name", refused, True)
    check("and leaves the counts it had", table(db, f"SELECT COUNT(*) FROM {lht.SPELLINGS}"), before)


def check_profile() -> None:
    print("what the older LCAs were for, counted only in the years that print each figure")
    db = seed()
    n = 7000

    def add(fy: int, status: str = "CERTIFIED", **extra) -> None:
        nonlocal n
        n += 1
        insert(db, "lca_cases_history", row(n, fy, "Profile Labs Inc", "profile-labs-inc", status=status, **extra))

    # FY2012's file prints the worker count and neither the breakdown nor a level nor the two declarations.
    add(2012, workers=5)
    add(2012, workers=3)
    # FY2016's prints the two declarations and no level.
    add(2016, workers=2, h1b_dependent=1, willful_violator=0)
    add(2016, status="DENIED", workers=1, h1b_dependent=0, willful_violator=0)
    # FY2018's prints the breakdown and the level: two named, one blank (another wage source).
    add(2018, workers=4, new_employment=3, change_employer=1, continued_employment=0, wage_level="II",
        h1b_dependent=0)
    add(2018, workers=2, new_employment=0, change_employer=2, continued_employment=0, wage_level="IV")
    add(2018, workers=6, new_employment=6, change_employer=0, continued_employment=0)
    # A withdrawn FY2018 LCA: its boxes are never certified positions.
    add(2018, status="WITHDRAWN", workers=9, new_employment=9, wage_level="I")
    # Another employer's FY2016 row with a level: its year now "prints" one, but this employer's FY2016 certified
    # LCA named none, so it's a blank there. (The year decides, never the employer.)
    insert(db, "lca_cases_history", row(8000, 2016, "Leveller Co", "leveller-co", wage_level="III"))
    insert(db, "lca_cases_history", {**row(8001, 2018, "Profile Labs Inc", "profile-labs-inc"),
                                     "visa_class": "E-3 Australian"})
    lht.build(db, page_rows=3, pause=0)
    cols = ", ".join(lht.SPELLING_COLS)
    got = table(db, f"SELECT {cols} FROM {lht.SPELLINGS} WHERE employer_slug = 'profile-labs-inc'")
    p = dict(zip(lht.SPELLING_COLS, got[0])) if got else {}
    check("every LCA counts, whatever its status or visa", p.get("n"), 9)
    check("certified LCAs", p.get("certified"), 7)
    check("the breakdown rows are certified rows that print a box", p.get("detail_rows"), 3)
    check("positions are summed over those rows only (FY2012's 8 and the withdrawn 9 left out)", p.get("positions"),
          12)
    check("the boxes, over certified rows", (p.get("new_employment"), p.get("change_employer")), (9, 3))
    check("the levels named", (p.get("level_1"), p.get("level_2"), p.get("level_3"), p.get("level_4")),
          (0, 1, 0, 1))
    check("the level's rows are certified rows in the years that name a level (FY2016 and FY2018, never FY2012)",
          p.get("level_rows"), 5)
    check("a declaration counts only the rows that answered",
          (p.get("dependent_rows"), p.get("dependent_yes"), p.get("violator_rows"), p.get("violator_yes")),
          (3, 1, 2, 0))
    check("the visas", (p.get("visa_h1b"), p.get("visa_e3")), (8, 1))
    check("its years", (p.get("fy_from"), p.get("fy_to")), (2012, 2018))

    print("a table built before the profile figures gains their columns")
    db = seed()
    db.main.conn.execute(f"""CREATE TABLE {lht.SPELLINGS} (employer_slug TEXT NOT NULL, employer_name TEXT NOT NULL,
        n INTEGER NOT NULL, first_received TEXT, last_decided TEXT, PRIMARY KEY (employer_slug, employer_name))""")
    db.main.conn.execute(f"INSERT INTO {lht.SPELLINGS} VALUES ('old-only-corp', 'Old Only Corp', 3, NULL, NULL)")
    db.main.conn.commit()
    lht.build(db, page_rows=50, pause=0)
    have = {r[1] for r in db.main.conn.execute(f"PRAGMA table_info({lht.SPELLINGS})").fetchall()}
    check("every column is there", [c for c in lht.SPELLING_COLS if c not in have], [])
    check("and filled", table(db, f"SELECT certified, fy_from FROM {lht.SPELLINGS} "
                                  "WHERE employer_slug = 'old-only-corp' AND employer_name = 'Old Only Corp'"),
          [(3, 2012)])

    print("the site reads the columns this writes")
    src = (V2 / "src/lib/db/olderFiles.ts").read_text()
    named = set(re.findall(r"SUM\((\w+)\)", src))
    check("every column the page's read sums is one the build writes", sorted(named - set(lht.SPELLING_COLS)), [])
    check("and it reads every profile figure", sorted(set(lht.PROFILE_COLS) - named), [])


def check_employer_map() -> None:
    print("the employer map folds the older spellings in")
    db = seed()
    db.script([
        "CREATE TABLE perm_entities (kind TEXT, slug TEXT, name TEXT, merge_key TEXT, total INTEGER)",
        "CREATE TABLE perm_entity_alias (kind TEXT, slug TEXT, target_slug TEXT)",
        "CREATE TABLE lca_case_numbers (case_number TEXT PRIMARY KEY, received_date TEXT)",
        "INSERT INTO perm_entities VALUES ('employer', 'intel-corporation', 'Intel Corporation', 'intel', 900)",
    ])
    insert(db, "lca_cases", {**row(1, 2025, "Acme Robotics LLC", "acme-robotics-llc"),
                             "case_number": "I-200-25001-000001", "received_date": "2024-10-01",
                             "decision_date": "2024-10-08"})
    before = bem.plan(bem.read_sources(db), bem.read_pages(db))
    check("before the older counts are built, an employer with only older LCAs has no page",
          "old-only-corp" in {r[0] for r in before[1]}, False)
    check("and no table missing stops the nightly map", len(before[0]) > 0, True)

    lht.build(db, page_rows=50, pause=0)
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
        insert(db, "lca_cases", {**row(i, 2025, "Acme Robotics LLC", "acme-robotics-llc"),
                                 "case_number": f"I-200-25001-{i:06d}", "received_date": "2024-10-01",
                                 "decision_date": "2024-10-08"})
    bare = {r[0]: dict(zip(blc.COLS, r)) for r in blc.plan(blc.read(db))}
    check("before the older counts are built, Boise reads the newer files alone",
          (bare["BOISE|ID"]["total"], bare["BOISE|ID"]["fy_from"]), (23, 2020))

    lht.build(db, page_rows=50, pause=0)
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
    real_db, real_argv, real_pause = ifd.Database, sys.argv, lht.PAUSE_S
    ifd.Database = lambda *a, **k: db  # noqa: E731
    lht.PAUSE_S = 0
    try:
        sys.argv = ["ingest_flag_disclosure.py", "--program", "lca", "--history-totals"]
        code = ifd.main()
    finally:
        ifd.Database, sys.argv, lht.PAUSE_S = real_db, real_argv, real_pause
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
    check_profile()
    check_employer_map()
    check_cities()
    check_loader()
    print(f"\n{len(FAILED)} failure(s)")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

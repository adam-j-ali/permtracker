#!/usr/bin/env python3
"""The older H-1B files' share of the firm and sponsor figures, counted once when they load (lca_history_rollups.py).

FY2019's LCA file names the law firm, and the older files that ask carry the employer's willful-violator answer, but the
nightly builders read `lca_cases` alone (FY2020 on): the H-1B firm rankings, a firm's H-1B line and a sponsor's
willful-violator count missed them (the Nov 20 2026 sweep, items 32 and 33). The older table changes only when one of
its files loads, so its share is counted then into two small tables in the main database, ten days of decisions at a
time on its decision-date index:

* firm_lca_history: per fiscal year, firm, worksite state and employer, every LCA naming the firm, those certified,
  the certified H-1B LCAs and their positions, the first and last decision; per year and state, the certified H-1B
  LCAs naming no firm; only for a year whose file names a firm;
* willful_lca_history: per employer spelling and fiscal year, the LCAs it declared itself a willful violator on.

Run:  python3 scripts/test_lca_history_rollups.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest_flag_disclosure as ifd  # noqa: E402
import lca_history_rollups as r  # noqa: E402
from lib_db import statement_home  # noqa: E402
from lib_sqlite_shim import SplitSqlite  # noqa: E402

FAILURES: list[str] = []


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


class Watched(SplitSqlite):
    """The two databases routed as the real client routes them, keeping every statement sent."""

    def __init__(self) -> None:
        super().__init__()
        self.sqls: list[str] = []

    def execute(self, sql, args=None, **kw):
        self.sqls.append(sql)
        return super().execute(sql, args, **kw)

    def pipeline(self, reqs, **kw):
        self.sqls.extend(q["stmt"]["sql"] for q in reqs if q.get("type") == "execute")
        return super().pipeline(reqs, **kw)


def seed() -> Watched:
    db = Watched()
    db.script(ifd.table_ddl("lca_cases_history"))
    db.script(ifd.index_ddl("lca_cases_history"))
    n = 0

    def add(fy, day, status, visa, firm, firm_name, emp, emp_name, state, workers=None, willful=None, times=1):
        nonlocal n
        for _ in range(times):
            n += 1
            db.lca.conn.execute(
                "INSERT INTO lca_cases_history (case_number, case_status, decision_date, visa_class, attorney_slug, "
                "attorney_name, employer_slug, employer_name, worksite_state, workers, willful_violator, fiscal_year) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                [f"I-200-19{n:09d}", status, day, visa, firm, firm_name, emp, emp_name, state, workers, willful, fy])

    # FY2019: one firm, two employers in two states.
    add(2019, "2018-10-01", "CERTIFIED", "H-1B", "fragomen-llp", "FRAGOMEN LLP", "acme", "ACME", "CA", 3, times=2)
    add(2019, "2018-10-11", "CERTIFIED", "H-1B", "fragomen-llp", "Fragomen LLP", "acme", "ACME INC", "CA", None)
    add(2019, "2019-03-20", "CERTIFIED", "H-1B", "fragomen-llp", "FRAGOMEN LLP", "beta", "BETA", "TX", 2, willful=1)
    add(2019, "2019-09-30", "DENIED", "H-1B", "fragomen-llp", "FRAGOMEN LLP", "beta", "BETA", "TX")
    add(2019, "2019-05-05", "CERTIFIED", "E-3 Australian", "fragomen-llp", "FRAGOMEN LLP", "beta", "BETA", "TX")
    # FY2019 LCAs naming no firm: counted per state, never per employer; one is a willful violator's.
    add(2019, "2019-01-02", "CERTIFIED", "H-1B", None, None, "self", "SELF", "CA", 5, times=2)
    add(2019, "2019-01-03", "CERTIFIED", "H-1B", "", None, "bad-co", "BAD CO", "TX", willful=1)
    add(2019, "2019-01-04", "DENIED", "H-1B", None, None, "self", "SELF", "CA")
    # FY2017: no file before FY2019 names the firm; only the willful answer counts.
    add(2017, "2017-02-01", "CERTIFIED", "H-1B", None, None, "old-co", "OLD CO", "NY", willful=1, times=3)
    add(2017, "2017-02-02", "CERTIFIED", "H-1B", None, None, "old-co", "OLD CO", "NY", willful=0)
    db.lca.conn.commit()
    return db


print("what the older files say, counted once")
db = seed()
got = r.build(db)
firms = {tuple(row[:4]): row[4:] for row in db.main.conn.execute(f"SELECT {','.join(r.FIRM_COLS)} FROM {r.FIRMS}")}
acme = firms.get((2019, "fragomen-llp", "CA", "acme"))
check("a firm's employer in a state: filings, certified, certified H-1B, positions, first and last day",
      acme is not None and acme[2:] == (3, 3, 3, 7, "2018-10-01", "2018-10-11"), str(acme))
check("its names are DOL's, one spelling kept", acme is not None and acme[0] == "Fragomen LLP" and acme[1] == "ACME INC",
      str(acme))
beta = firms.get((2019, "fragomen-llp", "TX", "beta"))
check("a denial and an E-3 count as filings; only the certified H-1B counts for the rankings",
      beta is not None and beta[2:6] == (3, 2, 1, 2), str(beta))
unnamed = {k[2]: v for k, v in firms.items() if k[0] == 2019 and k[1] == ""}
check("the certified H-1B LCAs naming no firm, per state, with no employer",
      {st: v[4] for st, v in unnamed.items()} == {"CA": 2, "TX": 1}
      and all(k[3] == "" for k in firms if k[1] == ""), str(unnamed))
check("a year whose file names no firm writes no firm rows", not any(k[0] == 2017 for k in firms), str(sorted(firms)))
willful = {(e, fy): n for e, fy, n in db.main.conn.execute(f"SELECT employer_slug, fy, lcas FROM {r.WILLFUL}")}
check("each employer's willful-violator LCAs per year, named firm or not",
      willful == {("beta", 2019): 1, ("bad-co", 2019): 1, ("old-co", 2017): 3}, str(willful))
check("the build says what it holds", got == {"firm_rows": len(firms), "willful_rows": 3}, str(got))

reads = [s for s in db.sqls if "FROM lca_cases_history" in s and "GROUP BY" in s]
check("it reads ten days of decisions at a time, never the whole table",
      bool(reads) and all("decision_date >= ?" in s and "decision_date < ?" in s for s in reads), str(reads[:1]))
plan = " ".join(str(x) for x in db.lca.conn.execute(
    "EXPLAIN QUERY PLAN " + reads[0].replace("?", "'2019-01-01'", 1).replace("?", "'2019-01-11'", 1)).fetchall())
check("each slice rides the decision-date index", "lca_cases_history_decided" in plan, plan)
check("the older table's reads go to the LCA database",
      all(statement_home(s) == "lca" for s in db.sqls if "lca_cases_history" in s))
check("the two small tables live in the main database, beside the builders that read them",
      all(statement_home(s) == "main" for s in db.sqls if r.FIRMS in s or r.WILLFUL in s)
      and any(r.FIRMS in s for s in db.sqls))
check("the small tables were written to the main database, the older table left alone",
      db.main.conn.execute(f"SELECT COUNT(*) FROM {r.FIRMS}").fetchone()[0] == len(firms)
      and not db.lca.conn.execute("SELECT name FROM sqlite_master WHERE name IN (?, ?)", [r.FIRMS, r.WILLFUL]).fetchall())
check("no statement names both databases' tables",
      not any("lca_cases_history" in s and (r.FIRMS in s or r.WILLFUL in s) for s in db.sqls))

db.sqls.clear()
r.build(db)
check("a rebuild of the same files writes nothing",
      not any(s.lstrip().upper().startswith(("INSERT", "DELETE", "UPDATE")) for s in db.sqls),
      str([s[:40] for s in db.sqls if s.lstrip().upper().startswith(("INSERT", "DELETE"))]))
db.lca.conn.execute("DELETE FROM lca_cases_history WHERE employer_slug = 'beta'")
db.lca.conn.commit()
r.build(db)
left = {tuple(x) for x in db.main.conn.execute(f"SELECT fy, attorney_slug, worksite_state, employer_slug FROM {r.FIRMS}")}
check("a group the files no longer hold is removed", (2019, "fragomen-llp", "TX", "beta") not in left, str(left))

print("who builds it: a write to the older table, and a flag")
wired = seed()
ifd.after_history_write(wired, "lca_cases", "test", 0.0)
check("a load of the current table leaves the small tables alone", not any(r.FIRMS in s for s in wired.sqls))
ifd.after_history_write(wired, "lca_cases_history", "test", 0.0)
check("a write to the older table builds them",
      wired.main.conn.execute(f"SELECT COUNT(*) FROM {r.FIRMS}").fetchone()[0] == 4)
flagged = seed()
ifd.Database = lambda: flagged
argv = sys.argv
try:
    sys.argv = ["ingest_flag_disclosure.py", "--program", "lca", "--history-rollups"]
    rc = ifd.main()
    sys.argv = ["ingest_flag_disclosure.py", "--program", "pw", "--history-rollups"]
    try:
        ifd.main()
        refused = False
    except SystemExit as exc:
        refused = exc.code == 2
finally:
    sys.argv = argv
check("--program lca --history-rollups builds them with no file", rc == 0 and
      flagged.main.conn.execute(f"SELECT COUNT(*) FROM {r.WILLFUL}").fetchone()[0] == 3, str(rc))
check("and is refused for another program", refused)
check("it downloads nothing", not any("dol.gov" in s for s in flagged.sqls))

print("before the first older file loads")
bare = Watched()
bare.script(ifd.table_ddl("lca_cases_history"))
check("an empty table builds empty", r.build(bare) == {"firm_rows": 0, "willful_rows": 0})

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

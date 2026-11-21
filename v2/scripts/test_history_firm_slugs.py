#!/usr/bin/env python3
"""An older PERM case keeps its law firm's slug, page or not (ingest_perm_history.py).

A history row took its firm's slug from the firm pages of the day its year loaded, and a firm with no page got none.
build_firm_ranks.py counts a row with no slug as naming no firm, so such a firm dropped out of its own FY2015 to FY2023
rankings, and its older cases never linked once it had a page (the Nov 20 2026 sweep, item 32). The rule is now the
employer's: today's page when there is one, else the firm's own name slugified by the shared rule (lib_slugs.py and
src/lib/entitySlug.ts), never another firm's page. `--fill-firm-slugs` puts every stored row on that rule, ten days of
decisions at a time on idx_pch_dec, writing only the rows whose slug moves.

Run:  python3 scripts/test_history_firm_slugs.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest_perm_history as iph  # noqa: E402
from entity_identity import SpacedKeyMap, entity_key  # noqa: E402
from lib_sqlite_shim import SqliteTurso  # noqa: E402

FAILURES: list[str] = []


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


class Watched(SqliteTurso):
    """The shim, keeping every statement it was sent."""

    def __init__(self) -> None:
        super().__init__()
        self.sqls: list[str] = []

    def execute(self, sql, args=None, **kw):
        self.sqls.append(sql)
        return super().execute(sql, args, **kw)

    def pipeline(self, reqs, **kw):
        self.sqls.extend(r["stmt"]["sql"] for r in reqs if r.get("type") == "execute")
        return super().pipeline(reqs, **kw)


iph.FILL_PAUSE_S = 0  # the pace has its own check below
ATT = SpacedKeyMap({entity_key("Fragomen Del Rey Bernsen & Loewy LLP"): "fragomen-del-rey-bernsen-loewy-llp",
                    entity_key("Smith Law"): "smith-law"})
PAGES = frozenset(dict.values(ATT))

print("the slug a firm's older case carries")
check("a firm with a page gets its page", iph.firm_slug_for("FRAGOMEN, DEL REY, BERNSEN & LOEWY, LLP", ATT, PAGES)
      == "fragomen-del-rey-bernsen-loewy-llp")
check("a firm with no page gets its own name, by the shared slug rule",
      iph.firm_slug_for("Quiet Immigration Group, P.C.", ATT, PAGES) == "quiet-immigration-group-p-c")
check("never another firm's page: a name that slugifies onto a page it doesn't match keeps no slug",
      iph.firm_slug_for("SMITH-LAW", SpacedKeyMap({entity_key("Smith, Law"): "smith-law-2",
                                                      "something else": "smith-law"}),
                        frozenset({"smith-law-2", "smith-law"})) == "smith-law-2"
      and iph.firm_slug_for("Smith Law!", SpacedKeyMap({"other firm": "smith-law"}), frozenset({"smith-law"})) == "")
check("no name, no slug", iph.firm_slug_for(None, ATT, PAGES) == "" and iph.firm_slug_for("", ATT, PAGES) == "")

row = {"caseNumber": "A-17001-00001", "status": "certified", "receivedDate": "2016-01-01",
       "decisionDate": "2017-01-01", "days": 366, "fiscalYear": "2017", "employerName": "Acme Inc",
       "state": "CA", "jobTitle": "Engineer", "socCode": "15-1132", "socTitle": "Developers",
       "attorneyName": "Quiet Immigration Group, P.C.", "wage": 100000.0, "naics": None, "worksiteCity": None}
check("a row loaded today carries the fallback", iph.row_tuple(row, {}, ATT)[13] == "quiet-immigration-group-p-c",
      str(iph.row_tuple(row, {}, ATT)[13]))
check("a row with a page carries the page",
      iph.row_tuple({**row, "attorneyName": "Fragomen Del Rey Bernsen and Loewy"}, {}, ATT)[13]
      == "fragomen-del-rey-bernsen-loewy-llp")


def seed() -> Watched:
    db = Watched()
    db.script(iph.SCHEMA)
    db.script(iph.SEARCH_INDEXES)
    db.conn.execute("CREATE TABLE perm_entities (kind TEXT, slug TEXT, name TEXT, merge_key TEXT, code TEXT, "
                    "total INTEGER)")
    db.conn.executemany("INSERT INTO perm_entities VALUES ('attorney', ?, ?, ?, NULL, ?)", [
        ("fragomen-del-rey-bernsen-loewy-llp", "Fragomen Del Rey Bernsen & Loewy LLP",
         entity_key("Fragomen Del Rey Bernsen & Loewy LLP"), 900),
        ("new-page-llp", "New Page LLP", entity_key("New Page LLP"), 5),
    ])
    cases = [
        # (case, decided, firm, stored slug)
        ("A-16001-00001", "2016-01-04", "Quiet Immigration Group, P.C.", ""),     # no page: its own name
        ("A-16001-00002", "2016-01-15", "Quiet Immigration Group, P.C.", None),   # stored NULL, the same
        ("A-17001-00003", "2017-03-30", "FRAGOMEN DEL REY BERNSEN LOEWY", ""),     # a page that missed at load
        ("A-18001-00004", "2018-06-21", "New Page, LLP", "new-page"),             # a stale slug: the page moved
        ("A-18001-00005", "2018-06-22", "Fragomen Del Rey Bernsen & Loewy LLP",
         "fragomen-del-rey-bernsen-loewy-llp"),                                   # already right
        ("A-19001-00006", "2019-02-11", None, ""),                                 # no firm at all
        ("A-19001-00007", "2019-02-12", "", ""),                                   # an 'N/A' firm, stored blank
        ("A-12001-00008", "2012-05-01", None, ""),                                 # before any file named a firm
    ]
    db.conn.executemany(
        "INSERT INTO perm_cases_history (case_number, status, decision_date, attorney_name, attorney_slug) "
        "VALUES (?, 'certified', ?, ?, ?)", cases)
    db.conn.commit()
    return db


print("putting the stored rows on the rule")
db = seed()
n = iph.fill_firm_slugs(db)
got = dict(db.conn.execute("SELECT case_number, attorney_slug FROM perm_cases_history").fetchall())
check("a firm with no page gets its own name's slug, whether stored blank or NULL",
      got["A-16001-00001"] == got["A-16001-00002"] == "quiet-immigration-group-p-c", str(got))
check("a firm whose page missed at load gets its page", got["A-17001-00003"] == "fragomen-del-rey-bernsen-loewy-llp",
      str(got))
check("a stale slug moves to today's page", got["A-18001-00004"] == "new-page-llp", str(got))
check("a row with no firm keeps no slug",
      got["A-19001-00006"] == got["A-19001-00007"] == got["A-12001-00008"] == "", str(got))
check("it counts the rows it moved", n == 4, str(n))
updates = [s for s in db.sqls if s.startswith("UPDATE perm_cases_history")]
check("only the moved rows are written, keyed on the case number",
      len(updates) >= 1 and all("WHERE case_number IN" in s for s in updates), str(updates))
reads = [s for s in db.sqls if s.startswith("SELECT") and "FROM perm_cases_history" in s and "attorney_name" in s]
check("it reads ten days of decisions at a time, never the whole table",
      bool(reads) and all("decision_date >= ?" in s and "decision_date < ?" in s for s in reads), str(reads[:2]))
check("a month is three slices", len(reads) >= 3 * 12, str(len(reads)))
plan = " ".join(str(r) for r in db.conn.execute(
    "EXPLAIN QUERY PLAN " + reads[0].replace("?", "'2016-01-01'", 1).replace("?", "'2016-01-11'", 1)).fetchall())
check("each slice rides the decision-date index", "idx_pch_dec" in plan, plan)
db.sqls.clear()
again = iph.fill_firm_slugs(db)
check("a second pass writes nothing", again == 0 and not any(s.startswith("UPDATE") for s in db.sqls), str(again))

print("at a history load's pace")
slept: list[float] = []


class Clock:
    @staticmethod
    def sleep(s: float) -> None:
        slept.append(s)


real_time, iph.time, iph.FILL_PAUSE_S = iph.time, Clock, 0.25
try:
    iph.fill_firm_slugs(seed())
finally:
    iph.time, iph.FILL_PAUSE_S = real_time, 0
check("it rests after each month it wrote, and only those (January 2016, March 2017, June 2018)",
      slept == [0.25, 0.25, 0.25], str(slept))

print("an empty table")
bare = Watched()
bare.script(iph.SCHEMA)
bare.conn.execute("CREATE TABLE perm_entities (kind TEXT, slug TEXT, name TEXT, merge_key TEXT, code TEXT, total INTEGER)")
check("has nothing to fill", iph.fill_firm_slugs(bare) == 0)

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

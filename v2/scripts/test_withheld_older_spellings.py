#!/usr/bin/env python3
"""A withheld firm's older spellings stay masked in everything the builders write (Nov 21 2026).

The older PERM and H-1B files print a firm under spellings the withheld list may not hold. Since the firm-slug fill,
an older row carries its firm's page slug, or its own name's when it has no page, so the rankings count it: a no-page
spelling of a withheld firm would be ranked under its own printed name, and one whose name key differs from the
entry's could appear. Every builder now asks lib_withheld.Matcher first, which knows the entry by every slug and name
it carries, by the aliases and page-map spellings pointing at it, and by entity key, whole or spaceless; a spelling it
knows is put on the withheld page, which the site masks by slug and name (convex/lib/withheldNames.ts).

Every name here is made up. The real lists are server settings and secrets, never in this public repository.

Run:  python3 scripts/test_withheld_older_spellings.py
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
from collections import Counter
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_employer_map as bem  # noqa: E402
import build_firm_programs as bfp  # noqa: E402
import build_firm_ranks as bfr  # noqa: E402
import ingest_perm_history as iph  # noqa: E402
import lca_history_rollups as lhr  # noqa: E402
from entity_identity import SpacedKeyMap, entity_key  # noqa: E402
from lib_db import dicts_of  # noqa: E402
from lib_sqlite_shim import SqliteTurso  # noqa: E402
from lib_withheld import Matcher, env_entries, matcher_for, parse  # noqa: E402

FAILURES: list[str] = []


def check(what: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f" ({detail})"))
    if not ok:
        FAILURES.append(what)


# The withheld firm: its page, two more slugs and two more names. "Oldname Partners Immigration" is an older name the
# owner's entry lists (the tool gathers every name the firm's rows print); "The Example Law Group & Company" and
# "ExampleLaw Group" it doesn't, but their entity key is the firm's.
FIRMS = ("example-law-group-pllc|Example Law Group, PLLC|Law firm||3|example-law-group-pllc-2,exampel-law-group|"
         "EXAMPLE LAW GROUP PLLC^Oldname Partners Immigration")
PAGE = "example-law-group-pllc"
ENTRIES = parse(FIRMS, "firm")
MATCH = Matcher(ENTRIES, "firm", {"old-alias-slug": PAGE})

print("which spellings are the withheld firm")
for name, slug in [
    ("Example Law Group, PLLC", None),
    ("Oldname Partners Immigration", None),
    ("The Example Law Group & Company", "the-example-law-group-company"),
    ("ExampleLaw Group P.L.L.C.", "examplelaw-group-p-l-l-c"),
    ("EXAMPLE LAW GROUP &amp; CO.", "example-law-group-amp-co"),
    (None, "exampel-law-group"),
    (None, "old-alias-slug"),
    (None, "oldname-partners-immigration"),
]:
    check(f"{name or slug!r} is the withheld firm", MATCH.page_for(name=name, slug=slug) == PAGE)
for name in ["Example Law Partners", "Exemplary Law Group", "Quiet Immigration Group, P.C.", "Exa", ""]:
    check(f"{name!r} isn't", MATCH.page_for(name=name, slug=None) is None)
check("an employer entry never matches a firm", Matcher(parse("example-co|Example Law Group PLLC|Employer||1", "employer"),
                                                        "firm").page_for(name="Example Law Group PLLC") is None)
check("no list, no match", not Matcher(None, "firm") and Matcher(None, "firm").page_for(name="Example Law Group") is None)

print("where a builder finds the lists")
with tempfile.TemporaryDirectory() as tmp:
    env_file = Path(tmp) / "production.env"
    env_file.write_text(f'OTHER=1\nWITHHELD_FIRMS="{FIRMS}"\nWITHHELD_EMPLOYERS=\n')
    check("the environment first", [e.slug for e in env_entries({"WITHHELD_FIRMS": FIRMS}, str(env_file))] == [PAGE])
    check("else the server's settings file", [e.slug for e in env_entries({}, str(env_file))] == [PAGE])
    check("neither: unknown, never an empty list", env_entries({}, str(Path(tmp) / "missing.env")) is None)
    # A workflow passes a secret it can't read (a fork, a renamed secret) as an empty string: that's not a list.
    check("an empty setting is no setting", env_entries({"WITHHELD_FIRMS": "", "WITHHELD_EMPLOYERS": ""},
                                                        str(Path(tmp) / "missing.env")) is None)
    heard: list[str] = []
    m = matcher_for(None, "firm", env={}, path=str(Path(tmp) / "missing.env"), log=heard.append)
    check("and the builder says so in one line naming no one",
          not m and len(heard) == 1 and not any(w in heard[0].lower() for w in ("example", "oldname")), str(heard))

db = SqliteTurso()
db.conn.execute("CREATE TABLE perm_entity_alias (kind TEXT, slug TEXT, target_slug TEXT)")
db.conn.execute("CREATE TABLE firm_page_map (source_slug TEXT, page_slug TEXT, key TEXT)")
db.conn.executemany("INSERT INTO perm_entity_alias VALUES (?, ?, ?)",
                    [("attorney", "an-alias-made-later", PAGE), ("employer", "not-a-firm", PAGE), ("attorney", "x", "other")])
db.conn.execute("INSERT INTO firm_page_map VALUES ('a-map-spelling', ?, '')", [PAGE])
db.conn.commit()
read = matcher_for(lambda s, a: dicts_of(db.execute(s, a)), "firm", env={"WITHHELD_FIRMS": FIRMS})
check("an alias or a page-map spelling made since the entry is the firm too",
      read.page_for(slug="an-alias-made-later") == PAGE and read.page_for(slug="a-map-spelling") == PAGE
      and read.page_for(slug="not-a-firm") is None and read.page_for(slug="x") is None)

print("an older PERM case's firm slug (ingest_perm_history.py)")
ATT = SpacedKeyMap({entity_key("Example Law Group, PLLC"): PAGE, entity_key("Smith Law"): "smith-law",
                    # A busier page that shares the old name's key would otherwise win it.
                    entity_key("Oldname Partners Immigration"): "oldname-partners-immigration-2"})
PAGES = frozenset(dict.values(ATT))
check("a spelling the list holds goes to the withheld page, never its own name's slug or another page",
      iph.firm_slug_for("Oldname Partners Immigration", ATT, PAGES, MATCH) == PAGE)
check("so does one whose entity key is the firm's",
      iph.firm_slug_for("The Example Law Group & Company", ATT, PAGES, MATCH) == PAGE)
check("another firm keeps today's rule", iph.firm_slug_for("Quiet Immigration Group, P.C.", ATT, PAGES, MATCH)
      == "quiet-immigration-group-p-c" and iph.firm_slug_for("Smith Law", ATT, PAGES, MATCH) == "smith-law")
row = {"caseNumber": "A-17001-00001", "status": "certified", "receivedDate": "2016-01-01", "decisionDate": "2017-01-01",
       "days": 366, "fiscalYear": "2017", "employerName": "Acme Inc", "state": "CA", "jobTitle": "Engineer",
       "socCode": "15-1132", "socTitle": "Developers", "attorneyName": "Oldname Partners Immigration", "wage": 1.0,
       "naics": None, "worksiteCity": None}
check("a row loaded today carries the withheld page", iph.row_tuple(row, {}, ATT, PAGES, MATCH)[13] == PAGE)

hist = SqliteTurso()
hist.script(iph.SCHEMA)
hist.script(iph.SEARCH_INDEXES)
hist.conn.executemany(
    "INSERT INTO perm_cases_history (case_number, status, decision_date, attorney_name, attorney_slug) "
    "VALUES (?, 'certified', ?, ?, ?)", [
        ("A-16001-00001", "2016-01-04", "Oldname Partners Immigration", ""),
        ("A-16001-00002", "2016-01-05", "The Example Law Group & Company", "the-example-law-group-company"),
        ("A-16001-00003", "2016-01-06", "Quiet Immigration Group, P.C.", ""),
    ])
hist.conn.commit()
iph.FILL_PAUSE_S = 0
iph.fill_firm_slugs(hist, ATT, MATCH)
got = dict(hist.conn.execute("SELECT case_number, attorney_slug FROM perm_cases_history").fetchall())
check("the fill puts the withheld firm's older spellings on its page",
      got["A-16001-00001"] == got["A-16001-00002"] == PAGE, str(got))
check("and another firm on its own rule", got["A-16001-00003"] == "quiet-immigration-group-p-c", str(got))

print("the rankings (build_firm_ranks.py)")
rdb = SqliteTurso()
rdb.script(iph.SCHEMA)
rdb.script(iph.SEARCH_INDEXES)
cases = []
for i, (name, slug) in enumerate([("Oldname Partners Immigration", "oldname-partners-immigration")] * 4
                                 + [("The Example Law Group & Company", "the-example-law-group-company")] * 3
                                 + [("Quiet Immigration Group", "quiet-immigration-group")] * 2):
    cases.append((f"A-19001-{i:05d}", "certified", f"2019-0{1 + i % 3}-1{i % 9}", 100 + i, "2019", name, slug, "CA",
                  f"client-{i % 2}"))
rdb.conn.executemany("INSERT INTO perm_cases_history (case_number, status, decision_date, days, fiscal_year, "
                     "attorney_name, attorney_slug, state, employer_slug) VALUES (?,?,?,?,?,?,?,?,?)", cases)
rdb.conn.execute("CREATE TABLE perm_cases (case_number TEXT, fiscal_year TEXT, decision_date TEXT)")
rdb.script(lhr.DDL)
rdb.conn.executemany(f"INSERT INTO {lhr.FIRMS} ({','.join(lhr.FIRM_COLS)}) VALUES ({','.join('?' * 12)})", [
    (2019, "example-law-group-amp-co", "CA", "acme", "EXAMPLE LAW GROUP &amp; CO.", "ACME", 5, 5, 5, 6, "2019-01-02",
     "2019-02-01"),
    (2019, "oldname-partners-immigration", "TX", "beta", "OLDNAME PARTNERS IMMIGRATION", "BETA", 2, 2, 2, 2,
     "2019-03-01", "2019-03-02"),
])
rdb.conn.commit()
names = bfr.names_with_withheld({"quiet-immigration-group": "Quiet Immigration Group"}, MATCH)
check("the withheld page is named by its entry, which the site masks", names.get(PAGE) == "Example Law Group, PLLC")
for program, reader in (("perm", bfr.read_perm), ("lca", bfr.read_lca)):
    agg, _ = reader(rdb, 2019, {}, MATCH)
    rows, _ = bfr.plan_year(program, 2019, agg, {}, names, {PAGE}, Counter())
    shown = {(r[3], r[5]) for r in rows}
    printed = json.dumps(rows).lower()
    check(f"{program}: the withheld firm's older spellings are ranked as its page, under its entry's name",
          {s for s, _ in shown if s != "quiet-immigration-group"} == {PAGE}
          and (PAGE, "Example Law Group, PLLC") in shown, str(shown))
    check(f"{program}: no older spelling of it is printed or linked", not any(
        w in printed for w in ("oldname", "the example law group", "&amp;", "examplelaw", "the-example")), printed[:300])
    us = next(r for r in rows if r[2] == "US" and r[3] == PAGE)
    check(f"{program}: and every filing still counts", us[8] == (7 if program == "perm" else 7), str(us))

print("a firm's program lines (build_firm_programs.py)")
lines = bfp.roll_up([("oldname-partners-immigration", "acme", "ACME", 3, 3, "2019-01-01", "2019-02-01"),
                     ("example-law-group-amp-co", "beta", "BETA", 2, 2, "2019-01-03", "2019-01-04"),
                     ("quiet-firm", "gamma", "GAMMA", 1, 1, "2019-01-05", "2019-01-05")],
                    # The page map, built before the list held the old name, put it on another page; the "&amp;"
                    # spelling it puts on the withheld page (plan_firms, below, knows it by its printed name).
                    {"quiet-firm": "quiet-firm", "oldname-partners-immigration": "oldname-partners-immigration-2",
                     "example-law-group-amp-co": PAGE}, "lca", True, MATCH)
check("a withheld firm's spellings count on its page, whatever the page map holds",
      {r[0]: r[2] for r in lines} == {PAGE: 5, "quiet-firm": 1}, str(lines))

print("the firm page map (build_employer_map.py)")
spellings = {"oldname-partners-immigration": Counter({"OLDNAME PARTNERS IMMIGRATION": 9}),
             "example-law-group-amp-co": Counter({"EXAMPLE LAW GROUP &amp; CO.": 4}),
             "quiet-firm": Counter({"QUIET FIRM": 2})}
pages = {PAGE: ("Example Law Group, PLLC", entity_key("Example Law Group, PLLC"), 50),
         "oldname-partners-immigration-2": ("Oldname Partners Immigration", entity_key("Oldname Partners Immigration"), 900),
         "quiet-firm": ("Quiet Firm", entity_key("Quiet Firm"), 3)}
map_rows, stats = bem.plan_firms(spellings, pages, MATCH)
check("a withheld firm's spellings map to its page, never to another page sharing the key",
      {r[0]: r[1] for r in map_rows} == {"oldname-partners-immigration": PAGE, "example-law-group-amp-co": PAGE,
                                         "quiet-firm": "quiet-firm"}, str(map_rows))
check("and the count says how many, naming none", stats.get("withheld") == 2, str(stats))

print("nothing printed names anyone")
out = io.StringIO()
with redirect_stdout(out):
    matcher_for(None, "firm", env={"WITHHELD_FIRMS": FIRMS}, log=print)
    bem.plan_firms(spellings, pages, MATCH)
check("no builder step above printed a withheld name", not any(
    w in out.getvalue().lower() for w in ("example", "oldname")), out.getvalue()[:200])

print(f"\n{len(FAILURES)} failed")
raise SystemExit(1 if FAILURES else 0)

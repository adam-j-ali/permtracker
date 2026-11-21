#!/usr/bin/env python3
"""Tests for build_firm_ranks.py: ranking, places, medians, last year's rank and the diffed write."""
from __future__ import annotations

import sys
from collections import Counter, defaultdict

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import build_firm_ranks as b  # noqa: E402

FAILED = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global FAILED
    print(("PASS " if cond else "FAIL ") + name + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILED += 1


def agg_of(entries: list[tuple[str, str, int, int, int]]) -> dict:
    """(page, state, filings, certified, denied) -> the builder's aggregate, country and state alike."""
    agg: dict = defaultdict(b.blank)
    for page, st, filings, cert, den in entries:
        def add(a, filings=filings, cert=cert, den=den, page=page):
            a["filings"] += filings
            a["certified"] += cert
            a["denied"] += den
            a["employers"].add(f"{page}-client")
            a["spell"][page.upper()] += filings
        b.fold(agg, page, st, add)
    return agg


def main() -> int:
    agg = agg_of([
        ("alpha", "CA", 30, 28, 2),
        ("alpha", "TX", 10, 9, 1),
        ("beta", "CA", 40, 39, 1),
        ("gamma", "TX", 40, 40, 0),
        ("delta", "XX", 5, 5, 0),  # a placeholder state counts for the country only
    ])
    rows, totals = b.plan_year("perm", 2025, agg, {("beta", "US"): 1}, {"alpha": "Alpha LLP"}, {"alpha"}, Counter({"US": 7}))
    us = sorted((r for r in rows if r[2] == "US"), key=lambda r: r[6])
    check("the country adds every state's filings", [r[3] for r in us] == ["alpha", "beta", "gamma", "delta"]
          and us[0][8] == 40, str([(r[3], r[8]) for r in us]))
    check("a tie is broken by slug, so the order never flickers", [r[3] for r in us][1:3] == ["beta", "gamma"])
    check("a placeholder state counts for the country and makes no place of its own", "XX" not in {r[2] for r in rows})
    ca = {r[3]: r for r in rows if r[2] == "CA"}
    check("a state ranks only the filings at its worksites", ca["beta"][6] == 1 and ca["alpha"][6] == 2)
    check("last year's rank rides beside this year's, and is empty for a firm not ranked then",
          {r[3]: r[7] for r in us} == {"alpha": None, "beta": 1, "gamma": None, "delta": None})
    check("a firm with a page is linked and named as its page names it",
          us[0][4] == 1 and us[0][5] == "Alpha LLP" and next(r for r in us if r[3] == "beta")[4] == 0)
    check("a firm without a page keeps DOL's commonest spelling", next(r for r in us if r[3] == "beta")[5] == "BETA")
    check("the totals hold the filings, the firms, the top ten and those naming no firm",
          totals["US"] == {"filings": 125, "firms": 4, "top10": 125, "unnamed": 7}, str(totals["US"]))

    # Only the busiest TOP firms are ranked.
    many = agg_of([(f"f{i:03d}", "NY", 200 - i, 200 - i, 0) for i in range(b.TOP + 20)])
    r2, _ = b.plan_year("lca", 2025, many, {}, {}, set(), Counter())
    check("each place keeps its busiest TOP firms", len([r for r in r2 if r[2] == "US"]) == b.TOP)

    check("a median needs MIN_DAYS certifications", b.median(Counter({100: b.MIN_DAYS - 1})) is None)
    check("a median is interpolated between the two middle cases",
          b.median(Counter({100: 5, 200: 5}), floor=1) == 150.0, str(b.median(Counter({100: 5, 200: 5}), floor=1)))

    # The H-1B rankings' older years: FY2019's file names the firm, and its counts come from the small table its
    # load builds (lca_history_rollups.py), never from lca_cases_history itself.
    import lca_history_rollups as lhr
    from lib_db import statement_home
    from lib_sqlite_shim import SqliteTurso

    class Watched(SqliteTurso):
        sqls: list[str] = []

        def execute(self, sql, args=None, **kw):
            self.sqls.append(sql)
            return super().execute(sql, args, **kw)

    db = Watched()
    db.script(["CREATE TABLE lca_cases (case_number TEXT, fiscal_year INTEGER, case_status TEXT, visa_class TEXT, "
               "attorney_slug TEXT, attorney_name TEXT, worksite_state TEXT, employer_slug TEXT, workers INTEGER, "
               "decision_date TEXT)"])
    db.conn.execute("INSERT INTO lca_cases VALUES ('I-200-1', 2020, 'CERTIFIED', 'H-1B', 'fragomen-llp', 'FRAGOMEN', "
                    "'CA', 'acme', 2, '2020-03-01')")
    check("no small table yet: FY2020 on", b.years(db, "lca") == [2020], str(b.years(db, "lca")))
    db.script(lhr.DDL)
    db.conn.executemany(f"INSERT INTO {lhr.FIRMS} ({','.join(lhr.FIRM_COLS)}) VALUES ({','.join('?' * 12)})", [
        (2019, "fragomen-llp", "CA", "acme", "FRAGOMEN LLP", "ACME", 3, 3, 3, 7, "2018-10-01", "2019-09-27"),
        (2019, "fragomen-llp", "TX", "beta", "FRAGOMEN LLP", "BETA", 3, 2, 1, 2, "2019-03-20", "2019-09-30"),
        (2019, "e3-only", "WA", "gamma", "E3 ONLY", "GAMMA", 1, 1, 0, 0, "2019-05-05", "2019-05-05"),
        (2019, "", "CA", "", None, None, 3, 2, 2, 10, "2019-01-02", "2019-01-04"),
        (2019, "", "TX", "", None, None, 1, 1, 1, 1, "2019-01-03", "2019-01-03"),
    ])
    db.conn.commit()
    check("FY2019 joins the H-1B years from the older file", b.years(db, "lca") == [2019, 2020], str(b.years(db, "lca")))
    agg, unnamed = b.read_lca(db, 2019, {"fragomen-llp": "fragomen"})
    us = agg.get(("fragomen", "US"))
    check("a firm's FY2019 certified H-1B LCAs, positions and employers, on its page",
          us is not None and (us["filings"], us["certified"], us["positions"], sorted(us["employers"]))
          == (4, 4, 9, ["acme", "beta"]), str(us))
    check("and in each state where the jobs are", agg[("fragomen", "CA")]["filings"] == 3 and agg[("fragomen", "TX")]["filings"] == 1)
    check("a firm with no certified H-1B LCA that year isn't ranked", not any(k[0] == "e3-only" for k in agg), str(list(agg)))
    check("the LCAs naming no firm, by place", dict(unnamed) == {"US": 3, "CA": 2, "TX": 1}, str(unnamed))
    check("its last decision day is the small table's", b.through(db, "lca", 2019) == "2019-09-30",
          str(b.through(db, "lca", 2019)))
    agg20, _ = b.read_lca(db, 2020, {"fragomen-llp": "fragomen"})
    check("FY2020 still reads lca_cases", agg20.get(("fragomen", "US"), {}).get("filings") == 1)
    check("no statement reads the older table itself", not any("lca_cases_history" in s for s in db.sqls))
    check("the small table's reads go to the main database",
          all(statement_home(s) == "main" for s in db.sqls if lhr.FIRMS in s) and any(lhr.FIRMS in s for s in db.sqls))

    # The older PERM table is read ten days of decisions at a time on idx_pch_dec, never a whole fiscal year at once
    # (it has no fiscal-year index, so `fiscal_year = ?` read every row, twice a year, for 16 years). A history row's
    # fiscal year is its decision day's, so the slices give the year's own figures.
    import random

    import ingest_perm_history as iph
    pdb = Watched()
    pdb.sqls = []
    pdb.script(iph.SCHEMA)
    pdb.script(iph.SEARCH_INDEXES)
    rng = random.Random(20261121)
    rows = []
    for i in range(400):
        fy = rng.choice([2018, 2019])
        m = rng.randint(1, 12)
        day = f"{fy if m <= 9 else fy - 1}-{m:02d}-{rng.randint(1, 28):02d}"
        firm = rng.choice(["fragomen", "quiet-group", "", None])
        rows.append((f"A-{i:05d}", rng.choice(["certified", "denied", "withdrawn"]), day, rng.choice([None, *range(90, 99)]),
                     str(fy), firm and firm.upper(), firm, rng.choice(["CA", "TX", None, "XX"]), rng.choice(["acme", "beta", None])))
    pdb.conn.executemany("INSERT INTO perm_cases_history (case_number, status, decision_date, days, fiscal_year, "
                         "attorney_name, attorney_slug, state, employer_slug) VALUES (?,?,?,?,?,?,?,?,?)", rows)
    pdb.conn.execute("CREATE TABLE perm_cases (case_number TEXT, fiscal_year TEXT, decision_date TEXT)")
    pdb.conn.commit()

    def old_read(fy: int) -> tuple[dict, dict]:
        """The statements read_perm sent before (a whole fiscal year each), on the same rows."""
        agg: dict = defaultdict(b.blank)
        unnamed: Counter = Counter()
        for slug, name, st, status, emp, n in pdb.conn.execute(
                "SELECT attorney_slug, MAX(attorney_name), state, status, employer_slug, COUNT(*) FROM perm_cases_history "
                "WHERE fiscal_year = ? GROUP BY attorney_slug, state, status, employer_slug", [str(fy)]):
            if not slug:
                for p in {b.NATION, b.place(st)} - {None}:
                    unnamed[p] += n
                continue

            def add(a, kind=status, n=n, emp=emp, name=name):
                a["filings"] += n
                a[kind] += n
                if emp:
                    a["employers"].add(emp)
                a["spell"][name or ""] += n
            b.fold(agg, slug, st, add)
        for slug, st, days, n in pdb.conn.execute(
                "SELECT attorney_slug, state, days, COUNT(*) FROM perm_cases_history WHERE fiscal_year = ? AND "
                "status = 'certified' AND attorney_slug IS NOT NULL AND days IS NOT NULL GROUP BY attorney_slug, state, days",
                [str(fy)]):
            b.fold(agg, slug, st, lambda a, d=days, n=n: a["days"].update({d: n}))
        return agg, unnamed

    for fy in (2018, 2019):
        want_agg, want_unnamed = old_read(fy)
        got_agg, got_unnamed = b.read_perm(pdb, fy, {})
        same = {k: v for k, v in got_agg.items() if v["filings"] or v["days"]} == \
            {k: v for k, v in want_agg.items() if v["filings"] or v["days"]}
        check(f"FY{fy} read in slices equals the whole-year statements", same and got_unnamed == want_unnamed,
              f"{sorted(got_agg)} vs {sorted(want_agg)}")
    hist_reads = [s for s in pdb.sqls if "FROM perm_cases_history" in s and "GROUP BY" in s]
    check("each history read is a slice of decision days", bool(hist_reads)
          and all("decision_date >= ?" in s and "decision_date < ?" in s and "fiscal_year" not in s for s in hist_reads),
          str(hist_reads[:1]))
    plan = " ".join(str(x) for x in pdb.conn.execute(
        "EXPLAIN QUERY PLAN " + hist_reads[0].replace("?", "'2018-10-01'", 1).replace("?", "'2018-10-11'", 1)).fetchall())
    check("on the decision-date index", "idx_pch_dec" in plan, plan)
    pdb.sqls.clear()
    check("the PERM years are the older table's span and perm_cases' own", b.years(pdb, "perm") == [2018, 2019],
          str(b.years(pdb, "perm")))
    check("found without a DISTINCT over the older table",
          not any("DISTINCT" in s and "perm_cases_history" in s for s in pdb.sqls), str(pdb.sqls))

    planned = ["perm", 2025, "US", "alpha", 1, "Alpha LLP", 1, None, 40, 37, 3, 0, 0, 2, 120.0]
    stored = ["perm", "2025", "US", "alpha", "1", "Alpha LLP", "1", None, "40", "37", "3", "0", "0", "2", "120.0"]
    check("a stored row reads the same as the planned one, so an unchanged rebuild writes nothing",
          b.norm(planned) == b.norm(stored))
    check("a moved figure reads as changed", b.norm(planned) != b.norm(stored[:8] + ["41"] + stored[9:]))

    print(f"\n{FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

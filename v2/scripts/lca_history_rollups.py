"""What DOL's older H-1B files say about law firms and willful violators, counted once when they load.

`lca_cases_history` (FY2008 to FY2019, on the LCA database) changes only when one of DOL's older files loads
(scripts/ingest_flag_disclosure.py), so no nightly builder reads it. Its share of the firm and sponsor figures is
counted here into two small tables in the MAIN database, beside the builders that read them, by that load and by
`ingest_flag_disclosure.py --program lca --history-rollups`:

    firm_lca_history     one row per fiscal year, law firm, worksite state and employer: every LCA naming the firm,
                         those certified, the certified H-1B LCAs and their positions, and the first and last decision
                         day. Per year and state, a row with no firm and no employer holds the LCAs that name no firm.
                         Only a year whose file names a firm is written: FY2019's names it
                         (AGENT_ATTORNEY_LAW_FIRM_BUSINESS_NAME), FY2015 to FY2018 name the individual attorney, which
                         the site never does, and older files neither. Read by build_firm_ranks.py (the H-1B rankings'
                         older years), build_firm_programs.py (a firm's H-1B line) and build_employer_map.py (the
                         firm's spellings in those years).
    willful_lca_history  one row per employer spelling and fiscal year: the LCAs on which it declared itself a willful
                         violator. Read by build_sponsor_index.py, whose count otherwise starts with FY2020.

The older table is read ten days of decisions at a time on its decision-date index, never grouped whole (a busy month
of the older PERM table read whole took 1.7 s on the live database, a ten-day slice 0.3 s; Nov 21 2026). Each slice
groups the rows naming a firm by firm, state and employer, the rest by state, and keeps an employer apart only where
it answered willful, so a slice returns a few thousand groups, never a row per filing. Both tables are written as
diffs (lib_reference.sync_rows): a rebuild of unchanged files writes nothing, and one that stops part way leaves the
old rows, never an empty table.
"""
from __future__ import annotations

import time
from collections import defaultdict

from lib_db import rows_of
from lib_reference import sync_rows

HISTORY = "lca_cases_history"
FIRMS = "firm_lca_history"
WILLFUL = "willful_lca_history"
FIRM_COLS = ["fy", "attorney_slug", "worksite_state", "employer_slug", "attorney_name", "employer_name",
             "filings", "certified", "h1b_certified", "h1b_positions", "first_decided", "last_decided"]
WILLFUL_COLS = ["employer_slug", "fy", "lcas"]
DDL = [
    f"""CREATE TABLE IF NOT EXISTS {FIRMS} (
        fy INTEGER NOT NULL,
        attorney_slug TEXT NOT NULL,
        worksite_state TEXT NOT NULL,
        employer_slug TEXT NOT NULL,
        attorney_name TEXT,
        employer_name TEXT,
        filings INTEGER NOT NULL,
        certified INTEGER NOT NULL,
        h1b_certified INTEGER NOT NULL,
        h1b_positions INTEGER NOT NULL,
        first_decided TEXT,
        last_decided TEXT,
        PRIMARY KEY (fy, attorney_slug, worksite_state, employer_slug))""",
    f"""CREATE TABLE IF NOT EXISTS {WILLFUL} (
        employer_slug TEXT NOT NULL,
        fy INTEGER NOT NULL,
        lcas INTEGER NOT NULL,
        PRIMARY KEY (employer_slug, fy))""",
]

# The H-1B rankings count certified LCAs of the H-1B class (H-1B1 and E-3 are other visas), their positions counted
# as build_firm_ranks.read_lca counts them; a firm's line counts every LCA naming it, as build_firm_programs does.
SLICE_SQL = (
    "SELECT fiscal_year AS g_fy, COALESCE(attorney_slug, '') AS g_att, COALESCE(worksite_state, '') AS g_st, "
    "CASE WHEN COALESCE(attorney_slug, '') <> '' OR willful_violator = 1 THEN COALESCE(employer_slug, '') "
    "ELSE '' END AS g_emp, "
    "MAX(attorney_name), MAX(employer_name), COUNT(*), "
    "SUM(CASE WHEN case_status = 'CERTIFIED' THEN 1 ELSE 0 END), "
    "SUM(CASE WHEN case_status = 'CERTIFIED' AND visa_class = 'H-1B' THEN 1 ELSE 0 END), "
    "SUM(CASE WHEN case_status = 'CERTIFIED' AND visa_class = 'H-1B' THEN COALESCE(workers, 1) ELSE 0 END), "
    "MIN(decision_date), MAX(decision_date), "
    "SUM(CASE WHEN willful_violator = 1 THEN 1 ELSE 0 END) "
    f"FROM {HISTORY} WHERE decision_date >= ? AND decision_date < ? "
    "GROUP BY g_fy, g_att, g_st, g_emp"
)


def log(msg: str) -> None:
    print(f"[lca-history-rollups] {msg}", flush=True)


def next_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y + (mo == 12)}-{1 if mo == 12 else mo + 1:02d}"


def slices(first: str, last: str) -> list[tuple[str, str]]:
    """[start, end) day ranges of about ten days, each month in three, from `first`'s month to `last`'s."""
    out, m, stop = [], first[:7], next_month(last[:7])
    while m != stop:
        nxt = next_month(m)
        out += [(f"{m}-01", f"{m}-11"), (f"{m}-11", f"{m}-21"), (f"{m}-21", f"{nxt}-01")]
        m = nxt
    return out


def num(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def fold(groups, firms: dict, willful: dict) -> None:
    """One slice's groups into the running totals (a group can span slices: its sums add, its names and days don't)."""
    for fy, att, st, emp, aname, ename, n, cert, h1b, pos, lo, hi, wil in groups:
        fy = num(fy)
        if not fy:
            continue
        att, st, emp = str(att or ""), str(st or ""), str(emp or "")
        if num(wil) and emp:
            willful[(emp, fy)] += num(wil)
        key = (fy, att, st, emp if att else "")
        acc = firms.get(key)
        if acc is None:
            acc = firms[key] = [None, None, 0, 0, 0, 0, None, None]
        if att:
            for i, name in ((0, aname), (1, ename)):
                if name is not None and (acc[i] is None or str(name) > acc[i]):
                    acc[i] = str(name)
        for i, v in ((2, n), (3, cert), (4, h1b), (5, pos)):
            acc[i] += num(v)
        if lo and (acc[6] is None or str(lo) < acc[6]):
            acc[6] = str(lo)[:10]
        if hi and (acc[7] is None or str(hi) > acc[7]):
            acc[7] = str(hi)[:10]


def plan(firms: dict, willful: dict) -> tuple[list[list], list[list]]:
    """The two tables' rows. A year with no LCA naming a firm writes no firm rows, not even its unnamed counts: the
    rankings and a firm's line would otherwise hold a year in which no firm can be ranked."""
    named_years = {k[0] for k in firms if k[1]}
    firm_rows = [[*k, *acc] for k, acc in sorted(firms.items()) if k[0] in named_years]
    willful_rows = [[emp, fy, n] for (emp, fy), n in sorted(willful.items()) if n]
    return firm_rows, willful_rows


def build(db) -> dict[str, int]:
    """Count the older table's share into both small tables; how many rows each holds after."""
    for ddl in DDL:
        db.execute(ddl)
    started = time.time()
    lo = rows_of(db.execute(f"SELECT MIN(decision_date) FROM {HISTORY} WHERE decision_date > ''"))
    hi = rows_of(db.execute(f"SELECT MAX(decision_date) FROM {HISTORY}"))
    first, last = (lo[0][0] if lo else None), (hi[0][0] if hi else None)
    firms: dict[tuple, list] = {}
    willful: dict[tuple[str, int], int] = defaultdict(int)
    if first and last:
        for a, b in slices(str(first), str(last)):
            fold(rows_of(db.execute(SLICE_SQL, [a, b])), firms, willful)
            if a.endswith("-12-21"):
                log(f"read through {b}: {len(firms):,} firm groups, {len(willful):,} willful employer-years "
                    f"({time.time() - started:.0f}s)")
    firm_rows, willful_rows = plan(firms, willful)
    f = sync_rows(db, FIRMS, FIRM_COLS[:4], FIRM_COLS, firm_rows, pause_s=0.2)
    w = sync_rows(db, WILLFUL, WILLFUL_COLS[:2], WILLFUL_COLS, willful_rows, pause_s=0.2)
    log(f"{FIRMS}: {len(firm_rows):,} rows ({f['written']:,} written, {f['deleted']:,} removed); "
        f"{WILLFUL}: {len(willful_rows):,} rows ({w['written']:,} written, {w['deleted']:,} removed); "
        f"{time.time() - started:.0f}s")
    return {"firm_rows": len(firm_rows), "willful_rows": len(willful_rows)}

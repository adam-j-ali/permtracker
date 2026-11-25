#!/usr/bin/env python3
"""Precompute every wage selection big enough to be slow, for both explorers.

Why: the PERM salary explorer and the H-1B (LCA) wage explorer compute five
percentiles, a histogram and a per-state table over whatever the reader
filtered to, live, with window functions. On a big selection that reads
millions of rows (about 8.5M for one PERM page) and can outrun the read
layer's 20 s deadline (`lca_cases` holds 2.38M rows, and one big occupation is
most of them).

`build_lca_facets.py` already precomputed ONE selection (the LCA default
view). This does all of them that matter: every combination of status x
occupation group x state x fiscal year holding at least MIN_ROWS filings, for
both tables, written to `wage_views` keyed exactly as
`src/lib/db/wageViews.ts` builds its keys. A selection under MIN_ROWS is
served live, where an index narrows it and it is fast.

HOW. One keyset read of each table's five filter columns (roughly the rows of
one live query of the biggest selection), then everything is computed here in
the arithmetic the SQL uses, which `test_wage_views.py` pins against the SQL
itself on a real SQLite:

- a percentile interpolates between ranks floor(k) and floor(k)+1 with
  k = (n - 1) * p, then rounds half away from zero (SQLite's ROUND);
- a histogram bin is CAST(wage / width AS INTEGER) * width, width from
  bin_width() (the port in build_lca_facets.py of wageStats.ts);
- the per-state table keeps states with at least MIN_FOR_MEDIAN filings,
  busiest first.

The data behind both explorers changes when a disclosure file is loaded, so
this runs after those loads, not nightly.

    python3 scripts/build_wage_views.py              # both programs
    python3 scripts/build_wage_views.py --program lca
    python3 scripts/build_wage_views.py --dry-run    # compute, count, write nothing
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys
import time
from itertools import islice

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_lca_facets import STATE_QUANTILES, bin_width, min_for_median  # noqa: E402
from lib_wage import ANNUAL_WAGE_SQL, FLAG_BAND  # noqa: E402
from lib_db import Database, cell, insert_stmts, query_rows, record_run, run_stmts  # noqa: E402

# A selection at or above this many filings is precomputed. Below it the live
# query touches at most an index slice and returns in well under a second.
MIN_ROWS = 5_000

# THE OLDER PERM YEARS (FY2008 to FY2023, perm_cases_history) HAVE NO LIVE QUERY. The explorer's live query reads
# perm_cases, which holds FY2024 on, and a page never scans the older table. So the history load
# (ingest_perm_history.build_places_and_wages) precomputes every selection of each older year that holds a case,
# under the reader's own keys, and the reader answers a missing key in such a year as none. Its rows carry this
# `program`, so this script's quarterly rewrite of the PERM views (which deletes by program) leaves them alone, and
# the reader tells an older year by it (src/lib/db/wageViews.ts).
HISTORY_PROGRAM = "perm_history"
HISTORY_DOC = "perm_history_wage_views"
# Views to a statement when written: a view without a state carries its by-state table, a few kilobytes.
VIEWS_PER_STMT = 50
# Statements to a write request.
STMTS_PER_REQUEST = 4

# THE WRITE IS BIG, SO IT'S PACED. The history load writes about 300,000 views (an estimate: every selection of
# sixteen older years that holds a case), on the database the pages read while the sweep and sign-ups write. Each
# request holds the write lock for its own rows only, and a pause after it lets anyone waiting have the lock.
WRITE_PAUSE_S = 0.3
# Stale views are deleted this many at a time, each its own short write, with the same pause between.
DELETE_CHUNK = 2_000

WAGE_VIEWS_DDL = (
    """CREATE TABLE IF NOT EXISTS wage_views (
         key TEXT PRIMARY KEY, program TEXT NOT NULL, n INTEGER NOT NULL,
         json TEXT NOT NULL, built_at INTEGER NOT NULL)""",
    # The writer deletes and counts by program. Without this both read every view, and with the older years' views
    # the table is mostly those (made on a table of a few thousand rows: built at night with the history load).
    "CREATE INDEX IF NOT EXISTS wage_views_program ON wage_views (program, built_at)",
)


def pause(seconds: float) -> None:
    """The wait between two write requests (a test counts them)."""
    time.sleep(seconds)

PAGE = 25_000
QUANTILES = ((0.05, "p5"), (0.25, "p25"), (0.5, "p50"), (0.75, "p75"), (0.95, "p95"))
STATUSES = ("certified", "denied", "withdrawn", "all")

# Dimension order in a key: status|soc|state|fy. MUST MATCH wageViewKey() in
# src/lib/db/wageViews.ts; test_wage_views.py reads that function.
SOC, STATE, FY = 1, 2, 4

# LCA rows outside this annual band are data defects, the same band as
# lcaWages.ts (MIN_ANNUAL / MAX_ANNUAL) and build_lca_facets.py.
LCA_MIN, LCA_MAX = FLAG_BAND

LCA_STATUS = {
    "CERTIFIED": "certified",
    "DENIED": "denied",
    "WITHDRAWN": "withdrawn",
    "CERTIFIED - WITHDRAWN": "withdrawn",
}

READS = {
    # PERM: wageWhere() in publicData.ts filters `wage > 0` and a lowercase
    # status; state and fiscal_year are compared as stored.
    "perm": (
        "SELECT rowid, wage, status, substr(soc_code, 1, 7), state, fiscal_year "
        "FROM perm_cases WHERE rowid > ? AND wage IS NOT NULL AND wage > 0 "
        "ORDER BY rowid LIMIT ?"
    ),
    # LCA: where() in lcaWages.ts annualises first and keeps 10k to 1.5M.
    "lca": (
        f"SELECT rowid, ({ANNUAL_WAGE_SQL}), case_status, substr(soc_code, 1, 7), "
        "worksite_state, fiscal_year FROM lca_cases "
        "WHERE rowid > ? AND wage IS NOT NULL AND wage > 0 ORDER BY rowid LIMIT ?"
    ),
}


def sql_round(x: float) -> float:
    """SQLite's ROUND(x): half away from zero (Python's round() is half-even)."""
    return float(math.floor(x + 0.5)) if x >= 0 else -float(math.floor(-x + 0.5))


def percentiles(vals: list[float], quantiles: tuple = QUANTILES) -> dict:
    """n, avg and the interpolated percentiles (the five, or a state's seven) of an ASCENDING list."""
    n = len(vals)
    out: dict = {"n": n, "avg": (math.fsum(vals) / n) if n else None}
    for p, name in quantiles:
        if not n:
            out[name] = None
            continue
        k = (n - 1) * p
        i = int(k)
        lo, hi = vals[i], vals[min(i + 1, n - 1)]
        out[name] = sql_round(lo + (hi - lo) * (k - i))
    return out


def histogram(vals: list[float], width: int) -> list[list[int]]:
    """Every occupied bin, lowest first, as [from, count]."""
    bins: dict[int, int] = {}
    for w in vals:
        b = math.trunc(w / width) * width
        bins[b] = bins.get(b, 0) + 1
    return [[b, bins[b]] for b in sorted(bins)]


def key(program: str, status: str, soc: str, state: str, fy: str) -> str:
    return f"{program}|{status}|{soc}|{state}|{fy}"


def view_row(program: str, wage, raw_status, soc, state, fy) -> tuple | None:
    """One row as the explorer sees it, (wage, statuses, soc, state, fy), or None when it can't see it: the reader's
    own filters (a positive wage, the LCA band) and its spelling of each column."""
    wage = None if wage is None else float(wage)
    if wage is None or wage <= 0:
        return None
    raw_status = raw_status or ""
    if program == "lca":
        if not (LCA_MIN <= wage <= LCA_MAX):
            return None
        s = LCA_STATUS.get(raw_status)
    else:
        s = raw_status if raw_status in ("certified", "denied", "withdrawn") else None
    statuses = ("all",) if s is None else (s, "all")
    soc = soc or ""
    state = (state or "").upper() if program == "lca" else (state or "")
    fy = "" if fy is None else str(fy)
    return (wage, statuses, soc, state, fy)


def read_rows(db: Database, program: str) -> list[tuple]:
    """(wage, statuses, soc, state, fy) for every row the explorer can see."""
    sql = READS[program]
    out: list[tuple] = []
    last = 0
    while True:
        rows = query_rows(db, sql, [last, PAGE])
        if not rows:
            break
        for v in rows:
            last = int(v[0])
            row = view_row(program, *v[1:6])
            if row is not None:
                out.append(row)
        if len(rows) < PAGE:
            break
    out.sort(key=lambda t: t[0])
    return out


def build(program: str, rows: list[tuple], min_cases: int, *, min_rows: int | None = None,
          fy_only: bool = False) -> dict[str, dict]:
    """Every precomputed view for one program, keyed as wageViews.ts keys them.

    `rows` ascending by wage. A view is built for each selection holding `min_rows` rows (MIN_ROWS unless given);
    `fy_only` keeps to the selections that name a fiscal year (an older PERM year's, whose pooled selections are the
    quarterly build's)."""
    floor = MIN_ROWS if min_rows is None else min_rows
    masks = [m for m in range(8) if m & FY or not fy_only]
    views: dict[str, dict] = {}
    for status in STATUSES:
        mine = [r for r in rows if status in r[1]]
        # Pass 1: counts for all eight subsets of (soc, state, fy).
        counts: dict[str, int] = {}
        for _, _, soc, state, fy in mine:
            for mask in masks:
                if (mask & SOC and not soc) or (mask & STATE and not state) or (mask & FY and not fy):
                    continue
                k = key(program, status, soc if mask & SOC else "",
                        state if mask & STATE else "", fy if mask & FY else "")
                counts[k] = counts.get(k, 0) + 1
        heavy = {k for k, c in counts.items() if c >= floor}
        if not heavy:
            continue
        # Pass 2: ascending wage lists for the heavy keys, plus each heavy
        # state-less key's per-state children (for its by-state table).
        lists: dict[str, list[float]] = {k: [] for k in heavy}
        children: dict[str, dict[str, list[float]]] = {}
        for wage, _, soc, state, fy in mine:
            for mask in masks:
                if (mask & SOC and not soc) or (mask & FY and not fy):
                    continue
                s_soc = soc if mask & SOC else ""
                s_fy = fy if mask & FY else ""
                if mask & STATE:
                    if not state:
                        continue
                    k = key(program, status, s_soc, state, s_fy)
                    if k in lists:
                        lists[k].append(wage)
                    parent = key(program, status, s_soc, "", s_fy)
                    if parent in lists:
                        children.setdefault(parent, {}).setdefault(state, []).append(wage)
                else:
                    k = key(program, status, s_soc, "", s_fy)
                    if k in lists:
                        lists[k].append(wage)
        for k, vals in lists.items():
            stats = percentiles(vals)
            width = bin_width(stats["p5"], stats["p95"])
            view = {
                "stats": stats,
                "binWidth": width,
                "histogram": histogram(vals, width),
                "minCases": min_cases,
                "byState": None,
            }
            if k.split("|")[3] == "":
                by = []
                for st, sv in (children.get(k) or {}).items():
                    if len(sv) >= min_cases:
                        by.append({"state": st, **percentiles(sv, STATE_QUANTILES)})
                by.sort(key=lambda x: (-x["n"], x["state"]))
                view["byState"] = by
            views[k] = view
    return views


def serialize(views: dict[str, dict]) -> list[tuple[str, int, str]]:
    """(key, n, json) per view: the history build holds every older year's views this way, a fraction of the
    memory the dicts take."""
    return [(k, int(v["stats"]["n"]), json.dumps(v, separators=(",", ":"))) for k, v in views.items()]


def write(db: Database, program: str, views: dict[str, dict]) -> int:
    return write_serialized(db, program, serialize(views))


def write_serialized(db: Database, program: str, items: list[tuple[str, int, str]]) -> int:
    """Every view of one `program` value, replacing the ones it held before."""
    built = begin_views(db)
    put_views(db, program, items, built)
    return finish_views(db, program, built, len(items))


def begin_views(db: Database) -> int:
    """The table and its index, and the stamp this build's views carry."""
    for ddl in WAGE_VIEWS_DDL:
        db.execute(ddl, [])
    return int(time.time() * 1000)


def put_views(db: Database, program: str, items: list[tuple[str, int, str]], built: int) -> None:
    """Insert or replace `items`, a request at a time with a pause after each."""
    stmts = insert_stmts("wage_views", ["key", "program", "n", "json", "built_at"],
                         [(k, program, n, j, built) for k, n, j in items], VIEWS_PER_STMT)
    while chunk := list(islice(stmts, STMTS_PER_REQUEST)):
        run_stmts(db, chunk, STMTS_PER_REQUEST)
        pause(WRITE_PAUSE_S)


def finish_views(db: Database, program: str, built: int, expected: int) -> int:
    """Delete the views of `program` this build didn't write, then demand the count it did.

    Keys that no longer clear the floor go, so a stale view can't outlive the data it described. Only AFTER every
    new row is in, a chunk at a time on wage_views_program."""
    while True:
        res = db.execute("DELETE FROM wage_views WHERE key IN (SELECT key FROM wage_views "
                         "WHERE program = ? AND built_at < ? LIMIT ?)", [program, built, DELETE_CHUNK])
        gone = int(((res or {}).get("response") or {}).get("result", {}).get("affected_row_count") or 0)
        if gone < DELETE_CHUNK:
            break
        pause(WRITE_PAUSE_S)
    got = int(db.scalar("SELECT COUNT(*) FROM wage_views WHERE program = ?", [program]) or 0)
    if got != expected:
        raise SystemExit(f"FATAL: wrote {expected} {program} views, read back {got}")
    return got


def verify_history(db: Database, fy: str, views: dict[str, dict]) -> str | None:
    """Recompute one small view of an older year through the site's own percentile SQL, and demand agreement.

    The view read is one state's fiscal year with every outcome, on idx_pch_state_dec (state, decision_date): the
    smallest such view at the median floor, so the control reads a few dozen rows. A fiscal year is its decision
    days, October to September (ingest_perm_history.py sets it from the decision date). The key checked, or None
    when the year has no such view."""
    from build_lca_facets import percentile_select
    floor = min_for_median()
    picks = [k for k, v in views.items()
             if k.split("|")[1] == "all" and not k.split("|")[2] and k.split("|")[3] and v["stats"]["n"] >= floor]
    if not picks:
        return None
    k = min(picks, key=lambda x: (views[x]["stats"]["n"], x))
    state = k.split("|")[3]
    sql = ("WITH f AS (SELECT wage FROM perm_cases_history "
           "WHERE state = ? AND decision_date >= ? AND decision_date < ? AND fiscal_year = ? "
           "AND wage IS NOT NULL AND wage > 0), c AS (SELECT COUNT(*) AS n FROM f), "
           "o AS (SELECT wage, ROW_NUMBER() OVER (ORDER BY wage) AS rn FROM f) "
           f"SELECT (SELECT n FROM c) AS n, {percentile_select()}")
    res = db.execute(sql, [state, f"{int(fy) - 1}-10-01", f"{fy}-10-01", fy])["response"]["result"]
    live = dict(zip([c["name"] for c in res["cols"]], [cell(c) for c in res["rows"][0]]))
    mine = views[k]["stats"]
    if int(live["n"]) != mine["n"]:
        raise SystemExit(f"FATAL: {k} n live {live['n']} != precomputed {mine['n']}")
    for _, name in QUANTILES:
        if abs(float(live[name]) - mine[name]) > 1:
            raise SystemExit(f"FATAL: {k} {name} live {live[name]} != precomputed {mine[name]}")
    return k


def verify(db: Database, program: str, views: dict[str, dict]) -> None:
    """Recompute the smallest precomputed selection live and demand agreement.

    The smallest one because it is the cheapest honest control: a few thousand
    rows read, through the site's own percentile SQL (not a Python copy).
    """
    from build_lca_facets import percentile_select
    k = min(views, key=lambda x: views[x]["stats"]["n"])
    _, status, soc, state, fy = k.split("|")
    if program == "perm":
        where = ["wage IS NOT NULL", "wage > 0"]
        args: list = []
        if status != "all":
            where.append("status = ?"); args.append(status)
        if soc:
            where.append("substr(soc_code, 1, 7) = ?"); args.append(soc)
        if state:
            where.append("state = ?"); args.append(state)
        if fy:
            where.append("fiscal_year = ?"); args.append(fy)
        f = f"SELECT wage FROM perm_cases WHERE {' AND '.join(where)}"
    else:
        where = [f"wage IS NOT NULL AND wage > 0 AND ({ANNUAL_WAGE_SQL}) BETWEEN {LCA_MIN} AND {LCA_MAX}"]
        args = []
        if status == "certified":
            where.append("case_status = 'CERTIFIED'")
        elif status == "denied":
            where.append("case_status = 'DENIED'")
        elif status == "withdrawn":
            where.append("case_status IN ('WITHDRAWN', 'CERTIFIED - WITHDRAWN')")
        if soc:
            where.append("substr(soc_code, 1, 7) = ?"); args.append(soc)
        if state:
            where.append("worksite_state = ?"); args.append(state)
        if fy:
            where.append("fiscal_year = ?"); args.append(int(fy))
        f = f"SELECT ({ANNUAL_WAGE_SQL}) AS wage FROM lca_cases WHERE {' AND '.join(where)}"
    sql = (f"WITH f AS ({f}), c AS (SELECT COUNT(*) AS n FROM f), "
           "o AS (SELECT wage, ROW_NUMBER() OVER (ORDER BY wage) AS rn FROM f) "
           f"SELECT (SELECT n FROM c) AS n, {percentile_select()}")
    res = db.execute(sql, args)["response"]["result"]
    row = [cell(c) for c in res["rows"][0]]
    live = dict(zip([c["name"] for c in res["cols"]], row))
    mine = views[k]["stats"]
    if int(live["n"]) != mine["n"]:
        raise SystemExit(f"FATAL: {k} n live {live['n']} != precomputed {mine['n']}")
    for _, name in QUANTILES:
        if abs(float(live[name]) - mine[name]) > 1:
            raise SystemExit(f"FATAL: {k} {name} live {live[name]} != precomputed {mine[name]}")
    print(f"[wage-views] {program}: verified {k} (n={mine['n']:,}) against the live SQL", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--program", choices=("perm", "lca", "both"), default="both")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    started = time.time()
    db = Database()
    floor = min_for_median()
    programs = ("perm", "lca") if a.program == "both" else (a.program,)
    notes = []
    for program in programs:
        t0 = time.time()
        rows = read_rows(db, program)
        # A read that came back thin is a broken read, not a small corpus.
        if len(rows) < 100_000:
            print(f"[wage-views] {program}: only {len(rows):,} rows read; not writing", flush=True)
            return 1
        views = build(program, rows, floor)
        print(f"[wage-views] {program}: {len(rows):,} rows, {len(views):,} views "
              f"at >= {MIN_ROWS:,} in {time.time() - t0:.0f}s", flush=True)
        if not views:
            print(f"[wage-views] {program}: no views; not writing", flush=True)
            return 1
        verify(db, program, views)
        if a.dry_run:
            continue
        got = write(db, program, views)
        notes.append(f"{program} {got} views")
    if not a.dry_run:
        record_run(db, "build_wage_views.py", status="ok", note="; ".join(notes),
                   started_at=started)
    return 0


if __name__ == "__main__":
    sys.exit(main())

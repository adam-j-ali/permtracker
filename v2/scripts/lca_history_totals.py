"""DOL's FY2008 to FY2019 H-1B files, counted once at their load for the employer and city pages.

The older LCA files sit in `lca_cases_history` (the LCA database, ingest_flag_disclosure.HISTORY_TABLES) and change
only when one of them loads. Two nightly builders need their share: the employer map (build_employer_map.py), so an
employer with only older LCAs gets a page and every older spelling reaches its page, and the city pages
(build_lca_cities.py), whose totals cover every LCA. Neither may scan the older table each night, so its counts are
written here into two small tables in the MAIN database (neither name matches lib_db.LCA_TABLE_RE):

  history_lca_spellings  one row per spelling as printed (employer_slug, employer_name): its LCAs, the first day
                         one was received and the last day one was decided
  history_lca_cities     one row per worksite city (spaces collapsed) and state: its LCAs, how many DOL certified,
                         and the first and last fiscal year with one

Read a fiscal year at a time on the older table's `_fy` index, two grouped reads a year, never one grouping of the
whole table. Cases `lca_cases` also holds (one republished in a newer file with a later decision) are left out:
the nightly builders count them there. Every row counts, whatever its visa, as the builders count `lca_cases`.

Rebuilt by every older file the loader writes (ingest_flag_disclosure.py), or alone:

    python3 scripts/ingest_flag_disclosure.py --program lca --history-totals

Written as a diff, so a rerun writes nothing, and a run that stops part way leaves the last good counts: the
nightly map reads an empty table as every older employer gone. A missing older table, or one holding no year,
stops the build by name and writes nothing.
"""
from __future__ import annotations

import time

from lib_db import SLUG_WINDOWS, rows_of, slug_window, stmt

HISTORY = "lca_cases_history"
CURRENT = "lca_cases"
HISTORY_INDEX = "lca_cases_history_fy"
SPELLINGS = "history_lca_spellings"
CITIES = "history_lca_cities"
SPELLING_COLS = ["employer_slug", "employer_name", "n", "first_received", "last_decided"]
CITY_COLS = ["worksite_city", "worksite_state", "n", "certified", "fy_from", "fy_to"]
DDL = [
    f"""CREATE TABLE IF NOT EXISTS {SPELLINGS} (
        employer_slug TEXT NOT NULL,
        employer_name TEXT NOT NULL,
        n INTEGER NOT NULL,
        first_received TEXT,
        last_decided TEXT,
        PRIMARY KEY (employer_slug, employer_name))""",
    f"""CREATE TABLE IF NOT EXISTS {CITIES} (
        worksite_city TEXT NOT NULL,
        worksite_state TEXT NOT NULL,
        n INTEGER NOT NULL,
        certified INTEGER NOT NULL,
        fy_from INTEGER,
        fy_to INTEGER,
        PRIMARY KEY (worksite_city, worksite_state))""",
]
# Every read of the older table names its index: with no ANALYZE on the server, a GROUP BY on the employer could
# take the employer index and walk all twelve years for each one.
NOT_CURRENT = f"NOT EXISTS (SELECT 1 FROM {CURRENT} c WHERE c.case_number = h.case_number)"
# The span's two ends, one statement each: a lone MIN or MAX seeks the `_fy` index's end, while both in one
# statement walk the whole index (SQLite's min/max shortcut takes a lone aggregate only).
FIRST_YEAR_SQL = f"SELECT MIN(fiscal_year) FROM {HISTORY}"
LAST_YEAR_SQL = f"SELECT MAX(fiscal_year) FROM {HISTORY}"
YEAR_SPELLINGS_SQL = (
    "SELECT employer_slug, COALESCE(employer_name, ''), COUNT(*), MIN(received_date), MAX(decision_date) "
    f"FROM {HISTORY} AS h INDEXED BY {HISTORY_INDEX} "
    f"WHERE fiscal_year = ? AND employer_slug IS NOT NULL AND employer_slug <> '' AND {NOT_CURRENT} "
    "GROUP BY employer_slug, employer_name")
YEAR_CITIES_SQL = (
    "SELECT worksite_city, worksite_state, COUNT(*), SUM(CASE WHEN case_status = 'CERTIFIED' THEN 1 ELSE 0 END) "
    f"FROM {HISTORY} AS h INDEXED BY {HISTORY_INDEX} "
    f"WHERE fiscal_year = ? AND worksite_city IS NOT NULL AND worksite_state IS NOT NULL AND {NOT_CURRENT} "
    "GROUP BY worksite_city, worksite_state")
BATCH = 200
PAUSE_S = 0.2


def log(msg: str) -> None:
    print(msg, flush=True)


def years(db) -> list[int]:
    """Every fiscal year the older table spans: the first and last entry of its `_fy` index."""
    try:
        first = rows_of(db.execute(FIRST_YEAR_SQL))
        last = rows_of(db.execute(LAST_YEAR_SQL))
    except Exception as e:  # noqa: BLE001 (the client raises RuntimeError, SQLite OperationalError)
        if "no such table" in str(e):
            raise RuntimeError(f"{HISTORY} isn't there: nothing to count, and the tables keep their counts") from e
        raise
    lo = first[0][0] if first else None
    hi = last[0][0] if last else None
    if lo is None or hi is None:
        raise RuntimeError(f"{HISTORY} holds no fiscal year: nothing to count, and the tables keep their counts")
    return list(range(int(lo), int(hi) + 1))


def day(v) -> str | None:
    s = "" if v is None else str(v)
    return s[:10] if len(s) >= 10 and s[4] == "-" else None


def count(db, fys: list[int]) -> tuple[dict, dict]:
    """(spellings, cities) over the given years: {(slug, name): [n, first, last]}, {(city, state): [n, cert, lo, hi]}."""
    spellings: dict[tuple[str, str], list] = {}
    cities: dict[tuple[str, str], list] = {}
    for fy in fys:
        t = time.time()
        got = rows_of(db.execute(YEAR_SPELLINGS_SQL, [fy]))
        for slug, name, n, first, last in got:
            rec = spellings.setdefault((str(slug), str(name or "")), [0, None, None])
            rec[0] += int(n or 0)
            first, last = day(first), day(last)
            if first and (rec[1] is None or first < rec[1]):
                rec[1] = first
            if last and (rec[2] is None or last > rec[2]):
                rec[2] = last
        places = rows_of(db.execute(YEAR_CITIES_SQL, [fy]))
        for city, state, n, cert in places:
            name = " ".join(str(city).split())
            if not name or not state:
                continue
            rec = cities.setdefault((name, str(state)), [0, 0, None, None])
            rec[0] += int(n or 0)
            rec[1] += int(cert or 0)
            rec[2] = fy if rec[2] is None else min(rec[2], fy)
            rec[3] = fy if rec[3] is None else max(rec[3], fy)
        log(f"  FY{fy}: {len(got):,} spellings, {len(places):,} cities ({time.time() - t:.1f}s)")
    return spellings, cities


def norm(row, cols: list[str]) -> tuple:
    """One shape for a stored row and a built one: libSQL hands integers back as text."""
    ints = {"n", "certified", "fy_from", "fy_to"}
    return tuple(None if v is None else int(float(v)) if c in ints else str(v) for c, v in zip(cols, row))


def held(db, name: str, cols: list[str]) -> dict[tuple, tuple]:
    """What a table holds now, keyed by its first two columns; the spellings a slice of slugs at a time."""
    sql = f"SELECT {', '.join(cols)} FROM {name}"
    if name == SPELLINGS:
        got: list = []
        for lo, hi in SLUG_WINDOWS:
            where, args = slug_window("employer_slug", lo, hi)
            got += rows_of(db.execute(f"{sql} WHERE {where}", args))
    else:
        got = rows_of(db.execute(sql))
    return {(str(r[0]), str(r[1])): norm(r, cols) for r in got}


def writes(name: str, cols: list[str], want: dict[tuple, tuple], have: dict[tuple, tuple]) -> list[dict]:
    """The statements that bring `have` to `want`: changed rows upserted first, then the rows gone removed."""
    changed = [want[k] for k in sorted(want) if have.get(k) != want[k]]
    gone = sorted(set(have) - set(want))
    out: list[dict] = []
    marks = "(" + ",".join("?" * len(cols)) + ")"
    keep = ", ".join(f"{c} = excluded.{c}" for c in cols[2:])
    for i in range(0, len(changed), BATCH):
        part = changed[i:i + BATCH]
        out.append(stmt(f"INSERT INTO {name} ({', '.join(cols)}) VALUES " + ",".join([marks] * len(part))
                        + f" ON CONFLICT ({cols[0]}, {cols[1]}) DO UPDATE SET {keep}",
                        [v for row in part for v in row]))
    for i in range(0, len(gone), BATCH):
        part = gone[i:i + BATCH]
        out.append(stmt(f"DELETE FROM {name} WHERE ({cols[0]}, {cols[1]}) IN (VALUES "
                        + ",".join(["(?, ?)"] * len(part)) + ")", [v for k in part for v in k]))
    return out


def write(db, name: str, cols: list[str], want: dict[tuple, tuple]) -> int:
    todo = writes(name, cols, want, held(db, name, cols))
    for s in todo:
        db.pipeline([s, {"type": "close"}])
        if PAUSE_S:
            time.sleep(PAUSE_S)
    return len(todo)


def build(db) -> dict:
    """Count every fiscal year the older table holds and bring both tables to it. Raises before any write when
    the older table is missing or empty."""
    fys = years(db)
    spellings, cities = count(db, fys)
    db.script(DDL)
    want_s = {k: norm([k[0], k[1], *v], SPELLING_COLS) for k, v in spellings.items()}
    want_c = {k: norm([k[0], k[1], *v], CITY_COLS) for k, v in cities.items()}
    n_s = write(db, SPELLINGS, SPELLING_COLS, want_s)
    n_c = write(db, CITIES, CITY_COLS, want_c)
    log(f"  {SPELLINGS}: {len(want_s):,} spellings ({n_s} write(s)); {CITIES}: {len(want_c):,} cities "
        f"({n_c} write(s)); FY{fys[0]} to FY{fys[-1]}")
    return {"spellings": len(want_s), "cities": len(want_c), "writes": n_s + n_c, "from": fys[0], "to": fys[-1]}

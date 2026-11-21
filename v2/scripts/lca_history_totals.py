"""DOL's FY2008 to FY2019 H-1B files, counted once at their load for the employer and city pages.

The older LCA files sit in `lca_cases_history` (the LCA database, ingest_flag_disclosure.HISTORY_TABLES) and change
only when one of them loads. Three readers need their share, and none may scan the older table each night or on each
page: the employer map (build_employer_map.py), so an employer with only older LCAs gets a page and every older
spelling reaches its page; the city pages (build_lca_cities.py), whose totals cover every LCA; and an employer
page's program ledger and LCA profile (src/lib/db/olderFiles.ts), which add the older files to the newer ones. So
the counts are written here into two small tables in the MAIN database (neither name matches lib_db.LCA_TABLE_RE):

  history_lca_spellings  one row per spelling as printed (employer_slug, employer_name): its LCAs, the first day one
                         was received, the last day one was decided, its first and last fiscal year, and what its
                         LCAs were for (the LCA profile's figures, PROFILE_COLS)
  history_lca_cities     one row per worksite city (spaces collapsed) and state: its LCAs, how many DOL certified,
                         and the first and last fiscal year with one

READ IN PAGES OF ROWS, NEVER BY THE YEAR. Every statement on the older table must stay under a second on the live
database: grouping a whole fiscal year took 4.8 s for FY2008, its smallest year, and a ten-day decision slice grouped
2.97 s (Nov 21 2026). A day slice can't promise a bound either: in the H-1B cap season one decision day holds several
times an ordinary day's LCAs. So the table is read by `rowid`, PAGE_ROWS rows at a time, on its own b-tree (no index,
and the rows of one file sit together): each read opens at most PAGE_ROWS rows whatever the day or the year, and is
grouped inside the page, two reads a page (the spellings, the cities). The next page starts at the next rowid that
exists, so gaps left by a reloaded file cost nothing.

THE FIGURES ONLY SOME YEARS PRINT. The older layouts differ (ingest_flag_disclosure.py, the LCA "columns"): the
worker breakdown (Form ETA-9035 Section B, Item 7) and the OES wage level are in some years' files and not others.
A field a year doesn't print is NULL, so its sums leave that year out by themselves, but two denominators would not:
  - worker positions and "certified with the breakdown" count only certified rows that carry at least one of the six
    breakdown boxes, so a share of positions is over the same rows as its boxes;
  - the level's denominator (`level_rows`) counts only certified rows in a fiscal year whose file names a level at
    all (any certified row with level I to IV): a blank level in such a year means the wage came from another source,
    and in a year that never prints the column it means nothing, so it isn't counted.
The two declarations (H-1B-dependent, willful violator) count only the rows that answered, as the newer files' do.

Cases `lca_cases` also holds (one republished in a newer file with a later decision) are left out: the readers count
them there. Every row counts, whatever its visa, as the readers count `lca_cases`.

Rebuilt by every older file the loader writes (ingest_flag_disclosure.py), or alone:

    python3 scripts/ingest_flag_disclosure.py --program lca --history-totals

Written as a diff, so a rerun writes nothing, and a run that stops part way leaves the last good counts: the nightly
map reads an empty table as every older employer gone. A missing or empty older table stops the build by name and
writes nothing.
"""
from __future__ import annotations

import time

from lib_db import SLUG_WINDOWS, add_missing_columns, rows_of, slug_window, stmt

HISTORY = "lca_cases_history"
CURRENT = "lca_cases"
SPELLINGS = "history_lca_spellings"
CITIES = "history_lca_cities"
# Rows one read may open. A ten-day slice of 15,000 to 16,000 rows grouped in 2.97 s through the tunnel (about 0.19 ms
# a row), so 2,000 rows is about 0.4 s; `--page-rows` on the flag changes it after a timing.
PAGE_ROWS = 2_000
CERT = "case_status = 'CERTIFIED'"
# A row that carries the worker breakdown: any one of the six boxes (Section B, Item 7) printed.
BREAKDOWN = ("COALESCE(new_employment, change_employer, continued_employment, change_previous_employment, "
             "new_concurrent_employment, amended_petition) IS NOT NULL")
# The LCA profile's figures, by the names src/lib/lcaProfile.ts reads (LcaProfileRow), less `level_blank`, which a
# reader takes from `level_rows` minus the four levels. One SQL expression each, summed inside a page.
PROFILE_SQL: dict[str, str] = {
    "certified": f"SUM(CASE WHEN {CERT} THEN 1 ELSE 0 END)",
    "detail_rows": f"SUM(CASE WHEN {CERT} AND {BREAKDOWN} THEN 1 ELSE 0 END)",
    "positions": f"SUM(CASE WHEN {CERT} AND {BREAKDOWN} THEN workers END)",
    "new_employment": f"SUM(CASE WHEN {CERT} THEN new_employment END)",
    "change_employer": f"SUM(CASE WHEN {CERT} THEN change_employer END)",
    "continued_employment": f"SUM(CASE WHEN {CERT} THEN continued_employment END)",
    "change_previous_employment": f"SUM(CASE WHEN {CERT} THEN change_previous_employment END)",
    "new_concurrent_employment": f"SUM(CASE WHEN {CERT} THEN new_concurrent_employment END)",
    "amended_petition": f"SUM(CASE WHEN {CERT} THEN amended_petition END)",
    "level_1": f"SUM(CASE WHEN {CERT} AND wage_level = 'I' THEN 1 ELSE 0 END)",
    "level_2": f"SUM(CASE WHEN {CERT} AND wage_level = 'II' THEN 1 ELSE 0 END)",
    "level_3": f"SUM(CASE WHEN {CERT} AND wage_level = 'III' THEN 1 ELSE 0 END)",
    "level_4": f"SUM(CASE WHEN {CERT} AND wage_level = 'IV' THEN 1 ELSE 0 END)",
    "dependent_rows": "SUM(CASE WHEN h1b_dependent IS NOT NULL THEN 1 ELSE 0 END)",
    "dependent_yes": "SUM(CASE WHEN h1b_dependent = 1 THEN 1 ELSE 0 END)",
    "violator_rows": "SUM(CASE WHEN willful_violator IS NOT NULL THEN 1 ELSE 0 END)",
    "violator_yes": "SUM(CASE WHEN willful_violator = 1 THEN 1 ELSE 0 END)",
    "visa_h1b": "SUM(CASE WHEN visa_class = 'H-1B' THEN 1 ELSE 0 END)",
    "visa_e3": "SUM(CASE WHEN visa_class = 'E-3 Australian' THEN 1 ELSE 0 END)",
    "visa_h1b1_chile": "SUM(CASE WHEN visa_class = 'H-1B1 Chile' THEN 1 ELSE 0 END)",
    "visa_h1b1_singapore": "SUM(CASE WHEN visa_class = 'H-1B1 Singapore' THEN 1 ELSE 0 END)",
}
SUMMED = list(PROFILE_SQL)
LEVELS = ["level_1", "level_2", "level_3", "level_4"]
PROFILE_COLS = [*SUMMED, "level_rows"]
SPELLING_COLS = ["employer_slug", "employer_name", "n", "first_received", "last_decided", "fy_from", "fy_to",
                 *PROFILE_COLS]
CITY_COLS = ["worksite_city", "worksite_state", "n", "certified", "fy_from", "fy_to"]
INT_COLS = {"n", "certified", "fy_from", "fy_to", *PROFILE_COLS}
DDL = [
    f"""CREATE TABLE IF NOT EXISTS {SPELLINGS} (
        employer_slug TEXT NOT NULL,
        employer_name TEXT NOT NULL,
        n INTEGER NOT NULL,
        first_received TEXT,
        last_decided TEXT,
        fy_from INTEGER,
        fy_to INTEGER,
        {", ".join(f"{c} INTEGER NOT NULL DEFAULT 0" for c in PROFILE_COLS)},
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
# The columns a table built before the profile figures lacks (CREATE TABLE IF NOT EXISTS never adds one).
SPELLING_TYPES = {"fy_from": "INTEGER", "fy_to": "INTEGER",
                  **{c: "INTEGER NOT NULL DEFAULT 0" for c in PROFILE_COLS}}
NOT_CURRENT = f"NOT EXISTS (SELECT 1 FROM {CURRENT} c WHERE c.case_number = h.case_number)"
# The table's two ends and the next row after a page: each one seek on the rowid b-tree.
FIRST_ROW_SQL = f"SELECT MIN(rowid) FROM {HISTORY}"
LAST_ROW_SQL = f"SELECT MAX(rowid) FROM {HISTORY}"
NEXT_ROW_SQL = f"SELECT MIN(rowid) FROM {HISTORY} WHERE rowid > ?"
PAGE_WHERE = "h.rowid BETWEEN ? AND ?"
PAGE_SPELLINGS_SQL = (
    "SELECT employer_slug, COALESCE(employer_name, ''), fiscal_year, COUNT(*), MIN(received_date), "
    f"MAX(decision_date), {', '.join(PROFILE_SQL.values())} "
    f"FROM {HISTORY} AS h "
    f"WHERE {PAGE_WHERE} AND employer_slug IS NOT NULL AND employer_slug <> '' AND {NOT_CURRENT} "
    "GROUP BY employer_slug, employer_name, fiscal_year")
PAGE_CITIES_SQL = (
    f"SELECT worksite_city, worksite_state, COUNT(*), SUM(CASE WHEN {CERT} THEN 1 ELSE 0 END), "
    "MIN(fiscal_year), MAX(fiscal_year) "
    f"FROM {HISTORY} AS h "
    f"WHERE {PAGE_WHERE} AND worksite_city IS NOT NULL AND worksite_state IS NOT NULL AND {NOT_CURRENT} "
    "GROUP BY worksite_city, worksite_state")
BATCH = 200
PAUSE_S = 0.2


def log(msg: str) -> None:
    print(msg, flush=True)


def scalar_int(db, sql: str, args: list | None = None) -> int | None:
    got = rows_of(db.execute(sql, args or []))
    v = got[0][0] if got else None
    return None if v is None else int(float(v))


def ends(db) -> tuple[int, int]:
    """The older table's first and last rowid. Raises when it's missing or holds nothing."""
    try:
        lo, hi = scalar_int(db, FIRST_ROW_SQL), scalar_int(db, LAST_ROW_SQL)
    except Exception as e:  # noqa: BLE001 (the client raises RuntimeError, SQLite OperationalError)
        if "no such table" in str(e):
            raise RuntimeError(f"{HISTORY} isn't there: nothing to count, and the tables keep their counts") from e
        raise
    if lo is None or hi is None:
        raise RuntimeError(f"{HISTORY} holds no rows: nothing to count, and the tables keep their counts")
    return lo, hi


def day(v) -> str | None:
    s = "" if v is None else str(v)
    return s[:10] if len(s) >= 10 and s[4] == "-" else None


def year(v) -> int | None:
    try:
        return None if v is None or v == "" else int(float(v))
    except ValueError:
        return None


def to_int(v) -> int:
    return 0 if v is None or v == "" else int(float(v))


class Counts:
    """What the pages add up to. Per spelling: [n, first, last, fy_from, fy_to, *SUMMED, {fy: certified}]."""

    def __init__(self) -> None:
        self.spellings: dict[tuple[str, str], list] = {}
        self.cities: dict[tuple[str, str], list] = {}
        # Per fiscal year, the certified rows that named a level: a year with none doesn't print the column.
        self.levels_named: dict[int, int] = {}
        self.pages = 0
        self.rows_read = 0
        self.slowest = 0.0

    def add_spellings(self, got: list[list]) -> None:
        for slug, name, fy, n, first, last, *sums in got:
            fy = year(fy)
            rec = self.spellings.get((str(slug), str(name or "")))
            if rec is None:
                rec = [0, None, None, None, None, *([0] * len(SUMMED)), {}]
                self.spellings[(str(slug), str(name or ""))] = rec
            rec[0] += to_int(n)
            first, last = day(first), day(last)
            if first and (rec[1] is None or first < rec[1]):
                rec[1] = first
            if last and (rec[2] is None or last > rec[2]):
                rec[2] = last
            if fy is not None:
                rec[3] = fy if rec[3] is None else min(rec[3], fy)
                rec[4] = fy if rec[4] is None else max(rec[4], fy)
            values = [to_int(v) for v in sums]
            for i, v in enumerate(values):
                rec[5 + i] += v
            certified = values[SUMMED.index("certified")]
            if fy is not None and certified:
                by_fy = rec[-1]
                by_fy[fy] = by_fy.get(fy, 0) + certified
                named = sum(values[SUMMED.index(c)] for c in LEVELS)
                self.levels_named[fy] = self.levels_named.get(fy, 0) + named

    def add_cities(self, got: list[list]) -> None:
        for city, state, n, cert, lo, hi in got:
            name = " ".join(str(city).split())
            if not name or not state:
                continue
            rec = self.cities.setdefault((name, str(state)), [0, 0, None, None])
            rec[0] += to_int(n)
            rec[1] += to_int(cert)
            lo, hi = year(lo), year(hi)
            if lo is not None:
                rec[2] = lo if rec[2] is None else min(rec[2], lo)
            if hi is not None:
                rec[3] = hi if rec[3] is None else max(rec[3], hi)

    def printing_years(self) -> set[int]:
        """The fiscal years whose files name an OES wage level."""
        return {fy for fy, named in self.levels_named.items() if named > 0}

    def spelling_rows(self) -> dict[tuple, tuple]:
        printing = self.printing_years()
        out = {}
        for (slug, name), rec in self.spellings.items():
            level_rows = sum(n for fy, n in rec[-1].items() if fy in printing)
            row = [slug, name, *rec[:5], *rec[5:5 + len(SUMMED)], level_rows]
            out[(slug, name)] = norm(row, SPELLING_COLS)
        return out

    def city_rows(self) -> dict[tuple, tuple]:
        return {k: norm([k[0], k[1], *v], CITY_COLS) for k, v in self.cities.items()}


def count(db, first: int, last: int, page_rows: int, pause: float) -> Counts:
    """Every row from `first` to `last` rowid, a page at a time."""
    out = Counts()
    start: int | None = first
    while start is not None and start <= last:
        stop = min(start + page_rows - 1, last)
        t = time.time()
        got = rows_of(db.execute(PAGE_SPELLINGS_SQL, [start, stop]))
        places = rows_of(db.execute(PAGE_CITIES_SQL, [start, stop]))
        took = time.time() - t
        out.add_spellings(got)
        out.add_cities(places)
        out.pages += 1
        out.slowest = max(out.slowest, took)
        if out.pages % 250 == 0:
            log(f"  page {out.pages:,}: rows {start:,} to {stop:,} of {last:,}, {len(out.spellings):,} spellings, "
                f"slowest page {out.slowest:.2f}s")
        start = scalar_int(db, NEXT_ROW_SQL, [stop])
        if pause and start is not None:
            time.sleep(pause)
    return out


def norm(row, cols: list[str]) -> tuple:
    """One shape for a stored row and a built one: libSQL hands integers back as text."""
    return tuple(None if v is None else int(float(v)) if c in INT_COLS else str(v) for c, v in zip(cols, row))


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


def write(db, name: str, cols: list[str], want: dict[tuple, tuple], pause: float) -> int:
    todo = writes(name, cols, want, held(db, name, cols))
    for s in todo:
        db.pipeline([s, {"type": "close"}])
        if pause:
            time.sleep(pause)
    return len(todo)


def build(db, page_rows: int | None = None, pause: float | None = None) -> dict:
    """Count every row the older table holds and bring both tables to it. Raises before any write when the older
    table is missing or empty. `page_rows` and `pause` default to PAGE_ROWS and PAUSE_S."""
    page_rows = max(1, page_rows or PAGE_ROWS)
    pause = PAUSE_S if pause is None else max(0.0, pause)
    first, last = ends(db)
    t = time.time()
    counts = count(db, first, last, page_rows, pause)
    years = sorted({fy for rec in counts.spellings.values() for fy in (rec[3], rec[4]) if fy is not None})
    printing = sorted(counts.printing_years())
    named = ", ".join(f"FY{y}" for y in printing) if printing else "no year"
    log(f"  {HISTORY}: {counts.pages:,} pages of up to {page_rows:,} rows in {time.time() - t:.0f}s, slowest page "
        f"{counts.slowest:.2f}s; a wage level printed in {named}")
    db.script(DDL)
    add_missing_columns(db, SPELLINGS, SPELLING_TYPES)
    want_s = counts.spelling_rows()
    want_c = counts.city_rows()
    n_s = write(db, SPELLINGS, SPELLING_COLS, want_s, pause)
    n_c = write(db, CITIES, CITY_COLS, want_c, pause)
    lo = years[0] if years else None
    hi = years[-1] if years else None
    log(f"  {SPELLINGS}: {len(want_s):,} spellings ({n_s} write(s)); {CITIES}: {len(want_c):,} cities "
        f"({n_c} write(s)); FY{lo} to FY{hi}")
    return {"spellings": len(want_s), "cities": len(want_c), "writes": n_s + n_c, "from": lo, "to": hi,
            "pages": counts.pages, "slowest": round(counts.slowest, 2)}

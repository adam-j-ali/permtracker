#!/usr/bin/env python3
"""A rebuilt database: the tables the site and the sweep read exist once their owners have run.

Four tables lost their CREATE when the scripts that first wrote them were deleted: perm_case_status and
perm_case_events went with the old status mirror, rfi_funnel and perm_month_stats with their one-off reads. On a
database rebuilt from the backups (scripts/dump_observations.py) there was nothing to restore them into, and the
sweep's first CREATE INDEX on perm_case_events failed on a missing table. The case-corpus load had the same gap from
the other side: run incrementally, as the ingest runs it, it read fingerprints from a perm_cases a fresh database
hasn't got and failed, rather than falling back to the full load whose SCHEMA creates the table.

    python3 scripts/test_fresh_database.py
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
V2 = HERE.parent
sys.path.insert(0, str(HERE))


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


csd = load("csd", "ingest_case_status_direct.py")
dbm = load("dbm", "db_migrate.py")

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'' if cond else f': {detail}'}")
    if not cond:
        failures.append(label)


def cell(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}


class SqliteDb:
    """Enough of lib_db.Database for these functions, on a real SQLite that starts empty."""

    def __init__(self):
        self.conn = sqlite3.connect(":memory:")

    def execute(self, sql, args=None, **_):
        cur = self.conn.execute(sql, args or [])
        rows = cur.fetchall()
        self.conn.commit()
        return {"response": {"result": {"cols": [{"name": d[0]} for d in (cur.description or [])],
                                        "rows": [[cell(v) for v in r] for r in rows]}}}

    def script(self, statements):
        for s in statements:
            self.conn.execute(s)
        self.conn.commit()

    def tables(self) -> set[str]:
        return {r[0] for r in self.conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}

    def columns(self, table: str) -> set[str]:
        return {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")}


def insert_columns(file: str, table: str) -> list[list[str]]:
    """The column list of every `INSERT ... INTO <table> (...)` in a source file, string pieces joined."""
    text = (V2 / file).read_text()
    out = []
    for m in re.finditer(rf"INTO {table}(?!\w)", text):
        # Adjacent string pieces, f-strings included, read as one.
        tail = re.sub(r"[\"'`]\s*\n\s*[fFrRbB]?[\"'`]?|[\"'`\n]", " ", text[m.end():m.end() + 600])
        cols = re.match(r"\s*\(([^)]*)\)", tail)
        if cols:
            out.append([c.strip() for c in cols.group(1).split(",") if c.strip()])
    return out


def reads_of(file: str, table: str) -> list[str]:
    """Every backtick SQL string in a TypeScript file that reads `table`."""
    return re.findall(rf"`([^`]*\bFROM {table}\b[^`]*)`", (V2 / file).read_text())


def main() -> int:
    print("the sweep's tables on a database that has none")
    db = SqliteDb()
    csd.ensure_case_tables(db)
    want = {"perm_case_status", "perm_case_events", "rfi_funnel", "perm_month_stats"}
    check("the sweep creates the four tables a rebuilt database lacks", want <= db.tables(), str(db.tables()))
    db.execute("INSERT INTO perm_case_status (case_number, source, fetched_at) VALUES ('G-1', 's', 1)")
    try:
        csd.ensure_case_tables(db)
        again = True
    except sqlite3.Error as e:  # noqa: PERF203
        again = str(e)
    check("a second run changes nothing", again is True and
          db.execute("SELECT count(*) FROM perm_case_status")["response"]["result"]["rows"][0][0]["value"] == "1",
          str(again))

    # The sweep's own index statements, read from the script, now find their tables.
    src = (HERE / "ingest_case_status_direct.py").read_text()
    # One level of nesting inside the column list: case_status_month indexes substr(filing_date,1,7).
    indexes = re.findall(r"CREATE INDEX IF NOT EXISTS \w+\s+ON perm_case_(?:status|events) \((?:[^()]|\([^()]*\))*\)", src)
    errors = []
    for ddl in indexes:
        try:
            db.execute(ddl)
        except sqlite3.Error as e:
            errors.append(f"{ddl[:60]}: {e}")
    check("every index the sweep builds on them can be built", len(indexes) >= 3 and not errors,
          f"{len(indexes)} found; {errors}")

    # Every writer's columns exist: the sweep, the published-file sync and the site's own discovery.
    status_cols = db.columns("perm_case_status")
    for file in ("scripts/ingest_case_status_direct.py", "scripts/sync_published_live.py",
                 "src/lib/db/caseDiscovery.ts"):
        lists = insert_columns(file, "perm_case_status")
        missing = sorted({c for cols in lists for c in cols} - status_cols)
        check(f"{file} writes only columns perm_case_status has", bool(lists) and not missing,
              f"{len(lists)} inserts; missing {missing}")
    event_cols = db.columns("perm_case_events")
    for file in ("scripts/ingest_case_status_direct.py", "scripts/check_watched_cases.py"):
        lists = insert_columns(file, "perm_case_events") or insert_columns(file, r"\{events\}")
        missing = sorted({c for cols in lists for c in cols} - event_cols)
        check(f"{file} writes only columns perm_case_events has", bool(lists) and not missing,
              f"{len(lists)} inserts; missing {missing}")

    # Every reader of the two frozen tables finds them, with no rows rather than no table.
    for file, table in (("src/lib/db/rfi.ts", "rfi_funnel"), ("convex/caseAlerts.ts", "rfi_funnel"),
                        ("src/lib/db/publicData.ts", "perm_month_stats")):
        sqls = reads_of(file, table)
        outcomes = []
        for sql in sqls:
            try:
                outcomes.append(len(db.execute(sql)["response"]["result"]["rows"]))
            except sqlite3.Error as e:
                outcomes.append(str(e))
        check(f"{file}'s read of {table} runs and finds no rows", bool(sqls) and outcomes == [0] * len(sqls),
              str(outcomes))

    print("the case-corpus load on a database with no perm_cases")
    fresh = SqliteDb()
    try:
        got = dbm.existing_fingerprints(fresh)
    except sqlite3.Error as e:
        got = f"raised: {e}"
    check("an incremental load finds nothing stored, so it falls back to the full load", got == {}, str(got))

    print(f"\n{'FAIL' if failures else 'PASS'}: {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

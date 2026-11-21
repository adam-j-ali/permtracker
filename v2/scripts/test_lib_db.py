#!/usr/bin/env python3
"""The shared readers, writers and date helper in lib_db.

    python3 scripts/test_lib_db.py

Every ingest reads and writes through these, so they run here against real
SQLite (through the shim), never against hand-built result shapes. Integers
must stay strings unless a caller asks for numbers: a diff that compares a
stored '0' with a built 0 rewrites every row.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lib_sqlite_shim import SqliteTurso  # noqa: E402
from lib_db import (  # noqa: E402
    canon, canon_hash, case_update, cell, day_slices, dicts_of, et_date, insert_rows, insert_stmts, lit,
    month_thirds, months_between, next_month, query_dicts, query_rows, restamp_note, rows_of, run_stmts,
    stamp_freshness, stmt, typed_cell,
)

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ok   {name}")
    else:
        FAILURES.append(name)
        print(f"  FAIL {name}\n         got  {got!r}\n         want {want!r}")


def seeded() -> SqliteTurso:
    db = SqliteTurso()
    db.conn.execute("CREATE TABLE t (name TEXT, n INTEGER, wage REAL, note TEXT)")
    db.conn.executemany("INSERT INTO t VALUES (?,?,?,?)",
                        [("acme", 3, 104000.5, None), ("zeta", 0, 50000.0, "x")])
    db.conn.commit()
    return db


def main() -> int:
    check("a NULL cell is None", cell({"type": "null"}), None)
    check("an integer cell stays a string", cell(lit(42)), "42")
    check("typed_cell converts integers", typed_cell(lit(42)), 42)
    check("typed_cell converts floats", typed_cell(lit(1.5)), 1.5)
    check("typed_cell leaves text alone", typed_cell(lit("7")), "7")
    check("typed_cell keeps NULL as None", typed_cell({"type": "null"}), None)

    db = seeded()
    sql = "SELECT name, n, wage, note FROM t ORDER BY name"
    check("query_rows decodes every cell, integers as strings",
          query_rows(db, sql), [["acme", "3", 104000.5, None], ["zeta", "0", 50000.0, "x"]])
    check("rows_of reads the same rows from a response", rows_of(db.execute(sql)), query_rows(db, sql))
    check("query_dicts keys each row by column",
          query_dicts(db, sql)[0], {"name": "acme", "n": "3", "wage": 104000.5, "note": None})
    check("query_dicts(typed=True) converts numbers",
          query_dicts(db, sql, typed=True)[1], {"name": "zeta", "n": 0, "wage": 50000.0, "note": "x"})
    check("dicts_of matches query_dicts", dicts_of(db.execute(sql)), query_dicts(db, sql))
    check("query_rows binds arguments",
          query_rows(db, "SELECT name FROM t WHERE n > ?", [1]), [["acme"]])
    check("no rows is an empty list", query_rows(db, "SELECT name FROM t WHERE n > 99"), [])

    # 1790307000000 is 11:30 PM EDT on 2026-09-24, already 2026-09-25 in UTC.
    check("et_date keeps a late-evening EDT event on its Eastern day", et_date(1790307000000), "2026-09-24")
    check("et_date reads a string stamp", et_date("1790307000000"), "2026-09-24")
    check("et_date tolerates seconds", et_date(1790307000), "2026-09-24")
    check("et_date of an absent stamp is None", (et_date(None), et_date("")), (None, None))

    check("canon reads a REAL's whole number as the integer", (canon(93205.0), canon(93205), canon("93205")),
          ("93205", "93205", "93205"))
    check("canon keeps a fraction and text", (canon(1.5), canon("abc"), canon(None), canon("")),
          ("1.5", "abc", "", ""))
    check("canon_hash ignores storage type", canon_hash(["a", 93205.0]), canon_hash(["a", "93205"]))
    check("canon_hash sees a real change", canon_hash(["a", 1]) != canon_hash(["a", 2]), True)

    # Writers. Five rows at two to a statement and two statements to a request
    # cross both boundaries, so a builder that drops its last chunk shows.
    w = SqliteTurso()
    w.conn.execute("CREATE TABLE c (case_number TEXT PRIMARY KEY, a TEXT, b INTEGER)")
    rows = [(f"C{i}", f"a{i}", i) for i in range(5)]
    check("insert_stmts makes one statement per chunk",
          len(list(insert_stmts("c", ["case_number", "a", "b"], rows, per_stmt=2))), 3)
    check("insert_rows returns the rows sent",
          insert_rows(w, "c", ["case_number", "a", "b"], rows, per_stmt=2, per_request=2), 5)
    check("insert_rows wrote every row, integers intact",
          query_rows(w, "SELECT case_number, a, b FROM c ORDER BY case_number"),
          [[f"C{i}", f"a{i}", str(i)] for i in range(5)])
    run_stmts(w, [case_update("c", "case_number", ["a", "b"], [("C1", "x", 10), ("C3", None, 30)])])
    check("case_update gives each named row its own values and leaves the rest",
          query_rows(w, "SELECT case_number, a, b FROM c ORDER BY case_number"),
          [["C0", "a0", "0"], ["C1", "x", "10"], ["C2", "a2", "2"], ["C3", None, "30"], ["C4", "a4", "4"]])
    counts = run_stmts(w, [stmt("UPDATE c SET a = 'y' WHERE b > ?", [5]),
                           stmt("UPDATE c SET a = 'z' WHERE b > ?", [99])], per_request=1)
    check("run_stmts returns each statement's affected rows, in order", counts, [2, 0])
    check("run_stmts draws from a generator",
          run_stmts(w, (stmt("SELECT 1") for _ in range(3)), per_request=2), [0, 0, 0])

    # A source loaded by hand, only when there's something to load, has no maximum age: NULL, which no reader calls
    # stale (check_ingest_health.py, src/lib/freshnessBudget.ts), and a later note keeps it NULL.
    # Names through variables: src/lib/__tests__/dataset-coverage.test.ts reads a literal name here as a real dataset.
    f = SqliteTurso()
    by_hand, daily = "by-hand", "daily"
    stamp_freshness(f, by_hand, as_of="2026-11-20", source="https://example.org", cadence="by hand", note="3 reports",
                    max_age_days=None)
    stamp_freshness(f, daily, as_of="2026-11-20", source="https://example.org", cadence="daily", note="x", max_age_days=2)
    check("no maximum age is stored as NULL",
          query_rows(f, "SELECT dataset, max_age_days FROM data_freshness ORDER BY dataset"), [[by_hand, None], [daily, "2"]])
    check("a note on a row with no maximum age is written", restamp_note(f, by_hand, "why"), True)
    check("and keeps no maximum age",
          query_rows(f, "SELECT max_age_days, note FROM data_freshness WHERE dataset = ?", [by_hand]), [[None, "why"]])

    # A big table's days, a slice at a time: each month in three [start, end) ranges, end to end.
    check("December runs into January", next_month("2018-12"), "2019-01")
    check("a month is three slices of about ten days", month_thirds("2019-02"),
          [("2019-02-01", "2019-02-11"), ("2019-02-11", "2019-02-21"), ("2019-02-21", "2019-03-01")])
    check("the months from one day's to another's", months_between("2018-11-30", "2019-02-01"),
          ["2018-11", "2018-12", "2019-01", "2019-02"])
    fy = day_slices("2018-10-01", "2019-09-30")
    check("a fiscal year is 36 slices, October 1 to the next October 1, with no gap or overlap",
          (len(fy), fy[0][0], fy[-1][1], all(a[1] == b[0] for a, b in zip(fy, fy[1:]))),
          (36, "2018-10-01", "2019-10-01", True))

    print(f"\n{len(FAILURES)} failure(s)")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())

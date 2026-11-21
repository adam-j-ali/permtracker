"""Which indexes the FLAG disclosure ingest creates on each table (scripts/ingest_flag_disclosure.py, index_ddl).

The site's reads name these indexes with INDEXED BY (src/lib/db/flagCases.ts), so a table that loses one turns a
fast read into an error or a walk of every row. Run: python3 scripts/test_flag_disclosure_indexes.py
"""
from __future__ import annotations

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ingest_flag_disclosure as fd  # noqa: E402
import lib_flag_serials as serials  # noqa: E402


def names(table: str) -> set[str]:
    return {ddl.split("EXISTS ", 1)[1].split(" ON ", 1)[0] for ddl in fd.index_ddl(table)}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    check("lca_cases_emp_title" in names("lca_cases"), "the current LCA files keep their title index")
    # "Deloitte" and one job title opened 97,155 FY2008 to FY2019 LCAs on the employer index (Sentry 61, Nov 19 2026).
    check("lca_cases_history_emp_title" in names("lca_cases_history"),
          "the older LCA files get the same title index the search names")
    check("lca_cases_history_soc_state_st_dec" not in names("lca_cases_history"),
          "the job-and-state index stays on the current LCA files only")
    check("pwd_cases_emp_title" not in names("pwd_cases"), "the wage-request files get no title index")

    # The decision activity feed reads the seasonal programs' wage requests (P-400, P-500) from pwd_cases. Those are
    # about one in seven of its rows, so without an index of their own a job or state filter walks every program's
    # wage requests in the range to find them (src/lib/db/decidedDays.ts, ownRows).
    seasonal = {"pwd_cases_seasonal_dec", "pwd_cases_seasonal_state_dec", "pwd_cases_seasonal_soc_dec",
                "pwd_cases_seasonal_att_dec"}
    check(seasonal <= names("pwd_cases"), "the prevailing wage file gets the seasonal rows' own indexes")
    check(not any(n.startswith(("lca_cases_seasonal", "seasonal_cases_seasonal")) for t in
                  ("lca_cases", "lca_cases_history", "seasonal_cases") for n in names(t)),
          "no other file gets them")
    where = f"WHERE case_number >= '{serials.SEASONAL_WAGE_REQUEST_FROM}'"
    partial = [d for d in fd.index_ddl("pwd_cases") if "_seasonal_" in d]
    check(len(partial) == 4 and all(d.endswith(where) for d in partial),
          "each covers only the seasonal rows, by the one boundary (lib_flag_serials)")

    db = sqlite3.connect(":memory:")
    for ddl in fd.table_ddl("pwd_cases") + fd.index_ddl("pwd_cases"):
        db.execute(ddl)

    def plan(sql: str, args: list) -> str:
        return " | ".join(r[3] for r in db.execute("EXPLAIN QUERY PLAN " + sql, args).fetchall())

    feed = ("SELECT case_number FROM pwd_cases WHERE decision_date >= ? AND decision_date <= ? "
            "AND case_number >= 'P-400-'{n} ORDER BY decision_date DESC, case_number DESC LIMIT ?")
    for label, narrow, args, index in (
            ("no filter", "", [], "pwd_cases_seasonal_dec"),
            ("a state", " AND worksite_state = ?", ["CA"], "pwd_cases_seasonal_state_dec"),
            ("a job", " AND substr(soc_code, 1, 7) = ?", ["15-1252"], "pwd_cases_seasonal_soc_dec"),
            ("a law firm", " AND attorney_slug = ?", ["fragomen"], "pwd_cases_seasonal_att_dec")):
        got = plan(feed.format(n=narrow), ["2024-01-01", "2026-01-01", *args, 1001])
        check(f"USING INDEX {index} " in got, f"the seasonal feed with {label} reads {index} ({got})")
    count = ("SELECT COUNT(*) AS n FROM pwd_cases WHERE decision_date >= ? AND decision_date <= ? "
             "AND case_number >= 'P-400-'")
    got = plan(count, ["2025-03-01", "2025-03-01"])
    check("pwd_cases_seasonal_dec" in got, f"a day's seasonal count reads the seasonal rows only ({got})")
    own = ("SELECT case_number FROM pwd_cases WHERE decision_date >= ? AND decision_date <= ? "
           "AND case_number < 'P-400-' AND visa_class = ? ORDER BY decision_date DESC, case_number DESC LIMIT ?")
    got = plan(own, ["2024-01-01", "2026-01-01", "PERM", 1001])
    check("_seasonal_" not in got, f"the wage request program's own read never takes them ({got})")
    print("ALL PASS" if not failures else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

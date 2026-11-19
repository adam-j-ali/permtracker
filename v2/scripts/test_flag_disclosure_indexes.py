"""Which indexes the FLAG disclosure ingest creates on each table (scripts/ingest_flag_disclosure.py, index_ddl).

The site's reads name these indexes with INDEXED BY (src/lib/db/flagCases.ts), so a table that loses one turns a
fast read into an error or a walk of every row. Run: python3 scripts/test_flag_disclosure_indexes.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ingest_flag_disclosure as fd  # noqa: E402


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
    print("ALL PASS" if not failures else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

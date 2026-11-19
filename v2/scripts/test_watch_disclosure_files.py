"""The nightly read of DOL's disclosure page (scripts/watch_disclosure_files.py): which files it sees, what it starts.

The fixture is the links of DOL's own page as the Internet Archive held it on Nov 17 2026, the night FY2026 Q4 was up.
Run: python3 scripts/test_watch_disclosure_files.py
"""
from __future__ import annotations

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import watch_disclosure_files as w  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    page = open(os.path.join(HERE, "fixtures", "dol", "performance-links-2026-11-17.html")).read()
    listed = w.listed_files(page)
    check("PERM_Disclosure_Data_FY2026_Q4.xlsx" in listed, "the page's PERM workbook is seen")
    check({"CW-1_Disclosure_Data_FY2026_Q4.xlsx", "PW_Disclosure_Data_FY2026_Q4.xlsx", "LCA_Disclosure_Data_FY2026_Q4.xlsx"} <= set(listed),
          "the wage, LCA and seasonal workbooks are seen too")
    check(not any("Appendix" in n or "Addendum" in n or "Worksites" in n for n in listed),
          "appendices, addenda and worksite files aren't watched")
    check(len(listed) == len(set(listed)), "each file is listed once")
    check(w.listed_files('<a href="/x/PERM_Disclosure_Data_New_Form_FY2024_Q4.xlsx">') == ["PERM_Disclosure_Data_New_Form_FY2024_Q4.xlsx"],
          "the FY2024 new-form PERM file's name is seen")

    q3 = ["PERM_Disclosure_Data_FY2026_Q3.xlsx", "PW_Disclosure_Data_FY2026_Q3.xlsx", "LCA_Disclosure_Data_FY2026_Q3.xlsx"]
    q4 = q3 + ["PERM_Disclosure_Data_FY2026_Q4.xlsx", "PW_Disclosure_Data_FY2026_Q4.xlsx", "LCA_Disclosure_Data_FY2026_Q4.xlsx"]
    program, seen = w.plan(q3, None)
    check(program is None and seen == q3, "the first read records the listing and starts nothing")
    program, seen = w.plan(q4, q3)
    check(program == "perm", "a quarter with new PERM and FLAG files starts PERM first")
    check("PERM_Disclosure_Data_FY2026_Q4.xlsx" in seen and "PW_Disclosure_Data_FY2026_Q4.xlsx" not in seen,
          "only PERM's new file counts as seen, so the FLAG files stay new for the next night")
    program, seen = w.plan(q4, seen)
    check(program == "flag" and set(seen) == set(q4), "the next night starts the FLAG files")
    program, seen2 = w.plan(q4, seen)
    check(program is None and seen2 == seen, "a night with nothing new starts nothing")

    est = dt.datetime(2026, 11, 20, 6, 30, tzinfo=dt.timezone.utc)   # 1:30 AM EST
    edt = dt.datetime(2026, 7, 20, 9, 30, tzinfo=dt.timezone.utc)    # 5:30 AM EDT
    late = dt.datetime(2026, 11, 20, 15, 24, tzinfo=dt.timezone.utc)  # 10:24 AM EST, a late GitHub schedule
    check(w.in_night(est) and w.in_night(edt), "1:30 AM EST and 5:30 AM EDT are inside the night")
    check(not w.in_night(late), "a schedule that starts at 10:24 AM is outside it")

    print("ALL PASS" if not failures else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

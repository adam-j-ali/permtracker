"""The office reader (scripts/lib_offices.py): an office written any way, as one code or none.

Run: python3 scripts/test_lib_offices.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib_offices import office_code, office_in_post  # noqa: E402


def main() -> int:
    failures = 0

    def check(got, want, what: str) -> None:
        nonlocal failures
        ok = got == want
        print(("  ok   " if ok else "  FAIL ") + f"{what}: {got!r}" + ("" if ok else f" (want {want!r})"))
        failures += not ok

    for text, want in (
        ("San Bernardino", "SBD"), ("San Bernardino FO", "SBD"), ("SB", "SBD"), ("San Fernando Valley", "SFV"),
        ("SFV", "SFV"), ("LA", "LOS"), ("Los Angeles", "LOS"), ("LA County", "LAC"), ("Los Angeles County FO", "LAC"),
        ("NBC", "NBC"), ("National Benefits Center", "NBC"), ("TSC", "SSC"), ("Fairfax", "WAS"),
        ("Washington DC", "WAS"), ("Long Island", "LNY"), ("NJ Central", "NJC"), ("New Jersey Central", "NJC"),
        ("San Jose (non-local)", "SNJ"), ("San Jose, CA", "SNJ"), ("St. Louis", "STL"), ("Saint Paul", "SPM"),
        ("Santa Ana", "SAA"), ("Seattle field office", "SEA"), ("Brooklyn", "BNY"), ("chicago", "CHI"),
        ("Portland Oregon", "POO"), ("Portland, ME", "POM"), ("Charleston SC", "CHL"), ("Charleston, WV", "CHS"),
        ("Kendall", "KND"), ("Harlingen", "HLG"), ("SAA", "SAA"),
    ):
        check(office_code(text), want, text)
    for text in ("Portland", "Charleston", "SA", "Oakland", "Texas", "", None, "pending", "local", "N/A"):
        check(office_code(text), None, f"can't be told: {text!r}")
    # A post's own field office, from the words around it: the name before "FO" or "field office", after
    # "transferred to", or after "interview at". One office named, or None; a service centre is never a field office.
    santa_ana = ("Stuck at Santa Ana FO since early Feb 2026.  Anyone else?\nEB2->EB3 (Interfile) India PERM.\n"
                 "Per Emma, 485/485Js were transferred to Santa Ana FO (non-local) in early Feb 2026.\n"
                 "08/15/26: EAD/AP combo card approved. Notice issued by Texas SC.")
    for text, want in (
        (santa_ana, "SAA"),
        ("Transferred to San Fernando Valley on 9/24, interview waived", "SFV"),
        ("NBC -> Tampa FO on 4/28, still waiting", "TAM"),
        ("Interview at Newark on 3/4, approved the same day", "NEW"),
        ("Case moved from NBC to the Orlando field office", "ORL"),
        ("Stuck At Santa Ana FO", "SAA"),
    ):
        check(office_in_post(text), want, f"post: {text[:40]!r}")
    for text, why in (
        ("Case transferred to NBC last week", "a service centre"),
        ("My friend is at Tampa FO and mine is at Orlando FO", "two offices"),
        ("My field office is so slow, no update since March", "no office named"),
        ("Portland FO, interview done", "Portland alone is two offices"),
        ("Interview at 10 AM tomorrow", "a time, not a place"),
        ("", "nothing"),
    ):
        check(office_in_post(text), None, f"post with {why}")
    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

"""The office reader (scripts/lib_offices.py): an office written any way, as one code or none.

Run: python3 scripts/test_lib_offices.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib_offices import office_code  # noqa: E402


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
    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

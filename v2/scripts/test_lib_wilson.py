#!/usr/bin/env python3
"""lib_wilson gives the same Wilson interval as convex/lib/wilson.ts.

Both halves test against scripts/data/wilson_cases.json, so a change to either one's arithmetic fails here or there.

Run: python3 scripts/test_lib_wilson.py
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lib_wilson import Z_95, wilson_interval  # noqa: E402

FIXTURE = json.loads((pathlib.Path(__file__).resolve().parent / "data" / "wilson_cases.json").read_text())
FAILS: list[str] = []
N = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global N
    N += 1
    if not ok:
        FAILS.append(f"{label} {detail}".strip())


def main() -> int:
    check("the z matches the shared answers", Z_95 == FIXTURE["z"], f"{Z_95} != {FIXTURE['z']}")
    for c in FIXTURE["cases"]:
        got = wilson_interval(c["k"], c["n"])
        label = f"{c['k']} of {c['n']}"
        if c["lo"] is None:
            check(label, got is None, f"got {got!r}, want None")
            continue
        check(label, got is not None, "got None")
        if got is not None:
            lo, hi = got
            check(f"{label} low", math.isclose(lo, c["lo"], abs_tol=1e-9), f"{lo!r} != {c['lo']!r}")
            check(f"{label} high", math.isclose(hi, c["hi"], abs_tol=1e-9), f"{hi!r} != {c['hi']!r}")
    for k, n in ((math.nan, 100), (1, math.nan), (1, math.inf), (math.inf, 10)):
        check(f"{k} of {n} has no interval", wilson_interval(k, n) is None)
    # The interval always holds the share itself: 100 of 100 came out as 99.99999999999999 from the arithmetic alone.
    for n in (1, 7, 12, 100, 2000, 140.2):
        check(f"{n} of {n} reaches 100", wilson_interval(n, n)[1] == 100.0, repr(wilson_interval(n, n)))
        check(f"0 of {n} starts at 0", wilson_interval(0, n)[0] == 0.0, repr(wilson_interval(0, n)))
    # A spotless record is never known to be spotless.
    check("zero of three", wilson_interval(0, 3)[1] > 50)
    if FAILS:
        print("\n".join(FAILS))
        print(f"{len(FAILS)} of {N} checks failed")
        return 1
    print(f"all {N} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

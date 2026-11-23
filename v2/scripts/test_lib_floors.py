#!/usr/bin/env python3
"""lib_floors applies scripts/data/floors.json the way src/lib/floors.ts does.

Both test against scripts/data/floor_cases.json, so a figure the data scripts withhold is withheld on the page too,
with the same words and the same margin.

Run: python3 scripts/test_lib_floors.py
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lib_floors import FLOORS, margin_words, meets_floor, sample_share, too_few_words  # noqa: E402

DATA = pathlib.Path(__file__).resolve().parent / "data"
CASES = json.loads((DATA / "floor_cases.json").read_text())
TABLE = json.loads((DATA / "floors.json").read_text())
FAILS: list[str] = []
N = 0


def check(label: str, got, want) -> None:
    global N
    N += 1
    ok = math.isclose(got, want, abs_tol=1e-9) if isinstance(want, float) and isinstance(got, float) else got == want
    if not ok:
        FAILS.append(f"{label}: got {got!r}, want {want!r}")


def main() -> int:
    check("the one table", FLOORS, TABLE["floors"])
    for c in CASES["shares"]:
        got = sample_share(c["k"], c["n"], c["unit"])
        label = f"{c['k']} of {c['n']}"
        if "words" in c:
            check(label, got, {"shown": False, "words": c["words"]})
            continue
        check(f"{label} shown", got.get("shown"), True)
        check(f"{label} share", float(got.get("pct", -1)), float(c["pct"]))
        check(f"{label} margin", got.get("margin"), c["margin"])
        check(f"{label} range holds the share", got["lo"] <= got["pct"] <= got["hi"], True)
    for c in CASES["medians"]:
        check(f"median floor at {c['n']}", meets_floor("median", c["n"]), c["meets"])
        if not c["meets"]:
            check(f"median words at {c['n']}", too_few_words("median", c["n"], c["unit"]), c["words"])
    for c in CASES["marginWords"]:
        check(f"margin words {c['points']}", margin_words(c["points"]), c["words"])
    if FAILS:
        print("\n".join(FAILS))
        print(f"{len(FAILS)} of {N} checks failed")
        return 1
    print(f"all {N} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""lib_perm_line holds the same rule as src/lib/permLine.ts: the shared fixture and the two constants."""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import lib_perm_line as pl  # noqa: E402

fails = 0


def check(name: str, ok: bool) -> None:
    global fails
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        fails += 1


for case in json.loads((HERE / "fixtures/perm_line.json").read_text())["cases"]:
    check(case["name"], pl.perm_line_month(case["matrix"]) == case["month"])

rule = (HERE.parent / "convex/lib/permLine.ts").read_text()


def ts_const(name: str) -> float | None:
    m = re.search(rf"export const {name} = ([\d.]+)", rule)
    return float(m.group(1)) if m else None


check("FRONT_MIN_CASES matches LINE_MIN_CASES", ts_const("LINE_MIN_CASES") == pl.FRONT_MIN_CASES)
check("STARTED_MIN matches LINE_STARTED_MIN", ts_const("LINE_STARTED_MIN") == pl.STARTED_MIN)
check("PREVIOUS_DONE matches LINE_PREVIOUS_DONE", ts_const("LINE_PREVIOUS_DONE") == pl.PREVIOUS_DONE)
check("STARTED_FIRMLY matches LINE_STARTED_FIRMLY", ts_const("LINE_STARTED_FIRMLY") == pl.STARTED_FIRMLY)

print("perm line:", "FAIL" if fails else "ok")
sys.exit(1 if fails else 0)

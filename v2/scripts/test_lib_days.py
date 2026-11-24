#!/usr/bin/env python3
"""lib_days counts days the way convex/lib/time.ts does.

Both test against scripts/data/day_cases.json, so the site and the data scripts can't count a gap differently.

Run: python3 scripts/test_lib_days.py
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lib_days import day_of, days_between  # noqa: E402

FIXTURE = json.loads((pathlib.Path(__file__).resolve().parent / "data" / "day_cases.json").read_text())
FAILS: list[str] = []
N = 0


def check(label: str, got, want) -> None:
    global N
    N += 1
    if got != want:
        FAILS.append(f"{label}: got {got!r}, want {want!r}")


def _raises(fn) -> bool:
    try:
        fn()
    except ValueError:
        return True
    return False


def main() -> int:
    for c in FIXTURE["cases"]:
        check(f"{c['from']!r} to {c['to']!r}", days_between(c["from"], c["to"]), c["days"])
    # A date object is a day too; a stamp isn't one, but its first ten characters are.
    check("two dates", days_between(dt.date(2026, 1, 1), dt.date(2026, 1, 10)), 9)
    check("a date and a day", days_between(dt.date(2026, 1, 1), "2026-01-10"), 9)
    check("a stamp", days_between("2026-01-01 09:30:00", "2026-01-10"), None)
    check("a stamp's day", days_between("2026-01-01 09:30:00"[:10], "2026-01-10T23:59:59Z"[:10]), 9)
    check("day_of a stamp", day_of("2026-01-01 09:30:00"), "2026-01-01")
    check("day_of a datetime", day_of(dt.datetime(2026, 1, 1, 9, 30)), "2026-01-01")
    check("day_of nothing", (day_of(None), day_of("")), (None, None))
    check("a row's two stamps", days_between(day_of("2026-01-01T09:30:00Z"), day_of(dt.date(2026, 1, 10))), 9)
    # Today is the Eastern day whatever the machine's clock: 1:30 AM UTC on Nov 24 is still 8:30 PM on the 23rd in New
    # York, and in July (EDT) 3:59 AM UTC is still the day before.
    from lib_days import today_et
    utc = dt.timezone.utc
    check("evening in winter", today_et(dt.datetime(2026, 11, 24, 1, 30, tzinfo=utc)), dt.date(2026, 11, 23))
    check("evening in summer", today_et(dt.datetime(2026, 7, 2, 3, 59, tzinfo=utc)), dt.date(2026, 7, 1))
    check("past midnight Eastern", today_et(dt.datetime(2026, 11, 24, 5, 0, tzinfo=utc)), dt.date(2026, 11, 24))
    check("a clock with no zone is refused", _raises(lambda: today_et(dt.datetime(2026, 11, 24, 1, 30))), True)
    check("no clock given: a date", isinstance(today_et(), dt.date) and not isinstance(today_et(), dt.datetime), True)
    if FAILS:
        print("\n".join(FAILS))
        print(f"{len(FAILS)} of {N} checks failed")
        return 1
    print(f"all {N} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Gates for lib_holidays.py: DOL's working days and the day DOL decided.

Held to scripts/fixtures/federal_holidays.json, which the site's own
getFederalHolidays is held to by src/lib/__tests__/dol-workdays-parity.test.ts,
so the backtest and the page count the same days."""
from __future__ import annotations

import json
import pathlib
import sys
from datetime import date, datetime, timedelta, timezone

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lib_holidays import (DOL_DAY_STARTS_HOUR, RULE_FROM_MS, SEEN_NEXT_MORNING_BEFORE_HOUR, add_workdays,  # noqa: E402
                          decided_on, dol_day_starts, federal_holidays, is_dol_workday,
                          next_workday, workdays_between)
from lib_db import ET  # noqa: E402

fails: list[str] = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


fixture = json.loads((HERE / "fixtures/federal_holidays.json").read_text())["years"]
check(len(fixture) >= 5, "the fixture holds several years")
for y, want in fixture.items():
    got = sorted([d.isoformat(), n] for n, d in federal_holidays(int(y)))
    check(got == want, f"{y}: the holidays are the fixture's")

check(not is_dol_workday(date(2026, 10, 12)), "Columbus Day 2026 is no working day")
check(not is_dol_workday(date(2026, 7, 3)), "July 4 2026 is a Saturday, observed Friday the 3rd")
check(is_dol_workday(date(2026, 10, 13)) and not is_dol_workday(date(2026, 10, 10)), "a Tuesday works, a Saturday doesn't")
check(next_workday(date(2026, 10, 10)) == date(2026, 10, 13), "after Saturday the 10th, DOL next works Tuesday the 13th")
check(add_workdays(date(2026, 10, 9), 1) == date(2026, 10, 13), "one working day after Friday the 9th is Tuesday the 13th")
check(add_workdays(date(2026, 11, 24), 3) == date(2026, 11, 30), "three after Tue Nov 24: Wed, Fri (Thanksgiving skipped), Mon")
check(workdays_between(date(2026, 10, 9), date(2026, 10, 13)) == 1, "Friday to Tuesday over Columbus Day is 1")
check(workdays_between(date(2026, 10, 14), date(2026, 10, 9)) == -2, "and backwards, Wednesday to Friday before is -2")
check(workdays_between(date(2026, 10, 10), date(2026, 10, 14)) == 1, "a Saturday counts as the working day after it")


def ms(y, m, d, h, mi=0):
    return int(datetime(y, m, d, h, mi, tzinfo=timezone.utc).timestamp() * 1000)


# The same instants as the TypeScript test (decidedOnFromSeen).
check(decided_on(ms(2026, 10, 13, 9, 40)) == date(2026, 10, 12), "seen 5:40 AM EDT, decided the day before")
check(decided_on(ms(2026, 10, 9, 21, 5)) == date(2026, 10, 9), "seen 5:05 PM EDT, decided that day")
check(decided_on(ms(2026, 10, 14, 15, 59)) == date(2026, 10, 13), "11:59 AM is still the morning's reading")
check(decided_on(ms(2026, 10, 14, 16, 0)) == date(2026, 10, 14), "noon is not")
check(decided_on(ms(2027, 1, 2, 6, 0)) == date(2027, 1, 1), "1 AM EST on Jan 2, the day before, across a year")

# Nov 25 2026 (D5): from RULE_FROM the day is the site's DOL day, from 7 AM Eastern (src/lib/dolDay.ts): the wage requests
# are read every hour since Nov 23, so a status seen at 10 AM was decided that morning. Before RULE_FROM the noon rule
# stands, so days and grades already recorded keep their dates (every sighting then came from the 5 AM pass, where the
# two rules agree). Nov 30 2026 is a Monday; EST is UTC-5.
check(decided_on(ms(2026, 11, 30, 11, 59)) == date(2026, 11, 29), "after the switch, 6:59 AM EST is still the day before")
check(decided_on(ms(2026, 11, 30, 12, 1)) == date(2026, 11, 30), "after the switch, 7:01 AM EST is that day")
check(decided_on(ms(2026, 11, 30, 16, 59)) == date(2026, 11, 30), "after the switch, 11:59 AM EST is that day (noon said the day before)")
check(decided_on(ms(2026, 11, 30, 17, 1)) == date(2026, 11, 30), "after the switch, 12:01 PM EST is that day")
check(decided_on(ms(2026, 11, 24, 15, 0)) == date(2026, 11, 23), "before the switch, 10 AM keeps the noon rule's day before")
check(decided_on(RULE_FROM_MS) == date(2026, 11, 24), "the switch instant itself, midnight Eastern, is the day before")
check(DOL_DAY_STARTS_HOUR == 7 and SEEN_NEXT_MORNING_BEFORE_HOUR == 12, "the two hours as written")

# Inauguration Day on a Saturday isn't observed on another day (OPM, 2029); on a Sunday it's Monday (5 U.S.C. 6103(c)).
check(is_dol_workday(date(2029, 1, 19)), "Friday Jan 19 2029 is a working day: Jan 20 is a Saturday, not observed")
check(not is_dol_workday(date(2041, 1, 21)), "Monday Jan 21 2041 is Inauguration Day, Jan 20 being a Sunday")

# New Year's Day 2028 is a Saturday, so it's observed Friday Dec 31, 2027, a date in 2028's list.
check(not is_dol_workday(date(2027, 12, 31)), "Dec 31 2027 is the observed New Year's Day, not a workday")
check(is_dol_workday(date(2027, 12, 30)), "the day before it still is")

# The backtest's queue snapshot and decided_on share one boundary: 7 AM Eastern from Nov 25 2026, noon before. Every
# quarter hour from Nov 23 to Nov 27 belongs to exactly the DOL day whose window holds it.
check(dol_day_starts(date(2026, 11, 24)).hour == 12, "Nov 24 began at noon on our clock (the old rule)")
check(dol_day_starts(date(2026, 11, 25)).hour == 7, "Nov 25 began at 7 AM (the switch)")
_t = datetime(2026, 11, 23, tzinfo=ET)
while _t < datetime(2026, 11, 27, tzinfo=ET):
    _d = decided_on(int(_t.timestamp() * 1000))
    check(dol_day_starts(_d) <= _t < dol_day_starts(_d + timedelta(days=1)), f"{_t} sits in the window of {_d}")
    _t += timedelta(minutes=15)

print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)

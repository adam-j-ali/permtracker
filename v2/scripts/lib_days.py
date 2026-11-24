"""The one day difference for the data scripts.

The Python half of `daysBetween` in convex/lib/time.ts: whole calendar days from one day to the next, negative when the
second is earlier, and None when either side isn't a real "YYYY-MM-DD" day or a date. Both are held to
scripts/data/day_cases.json. A stamp isn't a day: pass its first ten characters.
"""
from __future__ import annotations

import datetime as dt
import re

_DAY_SHAPE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _day(value: object) -> dt.date | None:
    if isinstance(value, dt.datetime):
        return None
    if isinstance(value, dt.date):
        return value
    if not isinstance(value, str) or not _DAY_SHAPE.fullmatch(value):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def day_of(value: object) -> str | None:
    """The day a value names: a date's ISO day, or the first ten characters of a day or a stamp. None for nothing."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.date):
        return value.isoformat()[:10]
    return str(value)[:10]


def days_between(a: object, b: object) -> int | None:
    """Days from a to b, each a "YYYY-MM-DD" day or a date; None when either isn't one."""
    start, end = _day(a), _day(b)
    if start is None or end is None:
        return None
    return (end - start).days

#!/usr/bin/env python3
"""Find copy that says a deadline is still ahead after the day has passed.

The failure this catches has happened here: on November 12, 2026 seven articles still said comments on two proposed
rules "close November 9" or were "open until Nov 10". Each sentence was true the day it was written and went wrong
by itself, and nobody was told.

It reads every article and guide and reports a sentence that puts a date in the future ("comments close", "open
until", "comments are due", "closes on") when that date is before today, Eastern. A sentence that names the date as
a deadline ("comment deadline of November 13, 2026") or says what happened ("comments closed November 9, 2026") is
never reported: that's how to write one so it stays true.

Run:  python3 scripts/audit_passed_deadlines.py            (exits 1 with findings)
      python3 scripts/audit_passed_deadlines.py --today 2026-11-14
"""
from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCAN = [ROOT / "content" / "blog", ROOT / "content" / "guides"]

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]
MONTH_NUMBER = {m: i + 1 for i, m in enumerate(MONTHS)} | {m[:3]: i + 1 for i, m in enumerate(MONTHS)} | {"sept": 9}
_MONTH = "|".join(sorted(MONTH_NUMBER, key=len, reverse=True))
_DAY = r"(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,? )?"
DATE = rf"{_DAY}(?P<month>{_MONTH})\.? (?P<day>\d{{1,2}}),? (?P<year>20\d\d)"

# Words that put the date ahead of the reader. Past forms ("closed", "were due") and the noun ("deadline") aren't here.
# A bold label counts too ("**Comments close:** Tuesday, November 10, 2026"): one of the seven was written that way.
AHEAD = re.compile(
    rf"\b(?P<lead>"
    rf"comments?(?: on [^.|]{{0,60}}?)? (?:close|closes|are due|is due|are open|stay open|remain open)(?: on| by| until| to| through)?"
    rf"|open (?:until|to|through)"
    rf"|(?:closes|close|ends|expires) on"
    rf"|comment (?:period|window) (?:closes|ends|runs (?:until|to|through)|is open (?:until|to|through))"
    rf")(?:\s*[:*]+\s*|\s+){DATE}",
    re.I,
)
PICTURE_WORDS = re.compile(r"\s*(?:alt=|imageAlt:|poster=|caption=)")


def et_today() -> dt.date:
    return dt.datetime.now(ZoneInfo("America/New_York")).date()


def findings(text: str, today: dt.date) -> list[tuple[int, str, dt.date]]:
    """(line number, the words, the date) for each sentence that puts a passed date ahead."""
    out = []
    for n, line in enumerate(text.split("\n"), 1):
        # A picture's description says what a recorded screen shows, and the recording doesn't change.
        if PICTURE_WORDS.match(line):
            continue
        for m in AHEAD.finditer(line):
            try:
                day = dt.date(int(m["year"]), MONTH_NUMBER[m["month"].lower()], int(m["day"]))
            except ValueError:
                continue
            if day < today:
                out.append((n, m.group(0), day))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--today", help="YYYY-MM-DD, in place of today's Eastern date")
    args = ap.parse_args()
    today = dt.date.fromisoformat(args.today) if args.today else et_today()
    files = sorted(p for d in SCAN for p in d.glob("*.mdx"))
    if not files:
        print("no articles found to read", file=sys.stderr)
        return 2
    hits = 0
    for p in files:
        for n, words, day in findings(p.read_text(encoding="utf-8"), today):
            hits += 1
            print(f"{p.relative_to(ROOT)}:{n}: \"{words}\" ({(today - day).days} days ago)")
    print(f"{len(files)} articles read, {hits} passed deadline{'s' if hits != 1 else ''} still written as ahead")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())

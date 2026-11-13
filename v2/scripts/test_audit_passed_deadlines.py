#!/usr/bin/env python3
"""The passed-deadline audit: what it must report, and what it must leave alone.

Run:  python3 scripts/test_audit_passed_deadlines.py
"""
from __future__ import annotations

import datetime as dt
import sys

import audit_passed_deadlines as a

NOV_12 = dt.date(2026, 11, 12)
failed = 0


def check(name: str, got: object, want: object) -> None:
    global failed
    ok = got == want
    failed += 0 if ok else 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"\n       got  {got!r}\n       want {want!r}"))


def count(text: str, today: dt.date = NOV_12) -> int:
    return len(a.findings(text, today))


print("a passed date written as still ahead is reported")
check("comments close", count("Comments close November 9, 2026. Until a final rule is published, nothing changes."), 1)
check("comments on the rule close", count("Comments on the rule close November 9, 2026, and no final rule exists."), 1)
check("open until, short month, in a table cell", count("| Oct 8, 2026 | OPT fees | paid by the school | Open until Nov 9, 2026 |"), 1)
check("comments open to", count("DHS has proposed removing it, with comments open to November 10, 2026."), 1)
check("with the weekday", count("Comments close Tuesday, November 10, 2026."), 1)
check("a bold label", count("**Comments close:** Tuesday, November 10, 2026. **Effective date:** none."), 1)
check("comment period ends", count("The comment period ends November 10, 2026."), 1)
check("closes on", count("The window closes on October 31, 2026."), 1)
check("the line number is the sentence's", a.findings("one\ntwo\nComments close November 9, 2026.", NOV_12)[0][0], 3)

print("a date that is today or ahead is left alone")
check("closes tomorrow", count("Comments close Friday, November 13, 2026."), 0)
check("closes today", count("Comments close November 12, 2026."), 0)
check("the same line a day later", count("Comments close Friday, November 13, 2026.", dt.date(2026, 11, 14)), 1)

print("a sentence that stays true is left alone")
check("closed", count("Comments closed November 9, 2026, and no final rule had been published."), 0)
check("a deadline", count("It's a proposal with a comment deadline of Friday, November 13, 2026."), 0)
check("a table's deadline", count("| November 9, 2026 | Deadline for comments on the rule |"), 0)
check("were taken until", count("Comments went through regulations.gov until November 9, 2026."), 0)
check("a filing window in an example", count("Your window was open until March 29, 2027."), 0)
check("an impossible date", count("Comments close February 31, 2026."), 0)
check("a picture's description of a recorded screen", count('  alt="A case form with the I-140 window, open until March 29, 2025"'), 0)
check("the same words in a sentence", count("The I-140 window is open until March 29, 2025."), 1)

print(f"\n{'FAILED: ' + str(failed) if failed else 'all passed'}")
sys.exit(1 if failed else 0)

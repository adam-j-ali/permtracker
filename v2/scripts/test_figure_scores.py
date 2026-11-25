#!/usr/bin/env python3
"""Our figures against the agency's own (lib_figure_scores.py, D11, Batch 4, Nov 25 2026).

The pending case uses the real Sep 30 2026 figures: DOL's sheet says 90,121 applications remaining, and our census
that day held 92,931 open cases (v2/docs/notes/data.md).

    python3 scripts/test_figure_scores.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_figure_scores import DAYS_TOLERANCE, analyst_review_scores, pending_scores  # noqa: E402

fails: list[str] = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


SHEET = {"asOf": "2026-09-30", "remaining": 90121}
CENSUS_SEP30 = [("ANALYST REVIEW", 86374), ("RECONSIDERATION APPEALS", 2677), ("APPLICATION ON HOLD", 2071),
                ("BALCA APPEALS", 891), ("RFI ISSUED", 793), ("NORD ISSUED", 115), ("REQUEST FOR REVIEW", 6),
                ("SUPERVISED RECRUITMENT", 3), ("PENDING AUDIT RESPONSE", 1)]


def test_pending_two_ways():
    scores, skipped = pending_scores(SHEET, CENSUS_SEP30, source="DOL sheet", read_on="2026-11-25")
    check(skipped == [] and len(scores) == 2, "two scores for the census, nothing skipped")
    every, scoped = scores
    check((every.ours, every.theirs, every.gap) == (92931, 90121, 2810), "every open case: 92,931 against 90,121, 2,810 over")
    check(every.gap_pct == 3.12 and not every.within, "every open case: 3.12% over, outside the 1% tolerance")
    check((scoped.ours, scoped.gap) == (89969, -152), "DOL's apparent scope: 89,969, 152 under")
    check(scoped.gap_pct == -0.17 and scoped.within, "DOL's apparent scope: 0.17% under, inside the tolerance")
    check(every.tolerance == 901, "the tolerance is 1% of DOL's count, 901 cases")
    check("inference" in scoped.note, "the scoped score says its mapping is an inference")


def test_no_census_scores_nothing():
    scores, skipped = pending_scores(SHEET, [], source="DOL sheet", read_on=None)
    check(scores == [] and skipped and "no census" in skipped[0], "no census that day: no score, never a zero, and why")


READING = {"permAsOf": "2026-10-31", "permAverageDays": [
    {"determination": "Analyst Review", "period": "Last 30 Days", "calendarDays": 300},
    {"determination": "Analyst Review", "period": "Last 90 Days", "calendarDays": 315},
    {"determination": "Analyst Review", "period": "Last 180 Days", "calendarDays": 360},
]}


def test_analyst_review_windows():
    decisions = [("2025-12-01", "2026-10-15"), ("2025-12-20", "2026-10-20"), ("2026-01-05", "2026-10-31"),
                 ("2025-11-01", "2026-09-30"), ("2025-10-01", "2026-10-01")]  # the last two fall outside (Oct 1, Oct 31]
    scores, skipped = analyst_review_scores(READING, decisions, history_from="2026-08-29", source="DOL page",
                                            read_on="2026-11-02")
    check([s.figure for s in scores] == ["perm.analyst_review_mean_30d"], "only the 30-day window scores")
    waits = [318, 304, 299]
    check(scores[0].ours == round(sum(waits) / 3, 1) and scores[0].theirs == 300,
          "the mean over the window's decisions, the 30 days after Oct 1 (a decision on Oct 1 itself is the 31st day)")
    check(scores[0].tolerance == DAYS_TOLERANCE and not scores[0].within, "307 against 300 is outside 3 days")
    check(len(skipped) == 2 and all("before our history" in s for s in skipped),
          "the 90- and 180-day windows start before our history, and say so")


def test_analyst_review_edges():
    s, k = analyst_review_scores({"permAsOf": "2026-10-31", "permAverageDays": [
        {"determination": "Analyst Review", "period": "Last 30 Days", "calendarDays": 300}]}, [],
        history_from="2026-08-29", source="x", read_on=None)
    check(s == [] and "no decisions" in k[0], "a window with none of our decisions scores nothing")
    s, k = analyst_review_scores({"permAverageDays": []}, [], history_from="2026-08-29", source="x", read_on=None)
    check(s == [] and "no as-of day" in k[0], "a reading without its day scores nothing")
    s, k = analyst_review_scores({"permAsOf": "2026-10-31", "permAverageDays": [
        {"determination": "Analyst Review", "period": "Past month", "calendarDays": 300}]}, [],
        history_from="2026-08-29", source="x", read_on=None)
    check(s == [] and "can't read" in k[0], "a period in other words is named, never guessed")


def main() -> int:
    for fn in (test_pending_two_ways, test_no_census_scores_nothing, test_analyst_review_windows, test_analyst_review_edges):
        fn()
    print(f"\n{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

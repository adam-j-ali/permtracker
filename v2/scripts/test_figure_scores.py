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
from lib_figure_scores import (  # noqa: E402
    DAYS_TOLERANCE,
    PWD_SCORABLE_FROM,
    analyst_review_scores,
    pending_scores,
    pwd_pending_scores,
)

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


# DOL's PERM wage requests remaining by receipt month on Oct 31 2026, and ours rebuilt for that day (notes/data.md).
PWD_OCT31 = {"pwdAsOf": "2026-10-31", "pwdPermBacklog": [
    {"receiptMonth": "2026-05", "remainingRequests": 12}, {"receiptMonth": "2026-06", "remainingRequests": 30},
    {"receiptMonth": "2026-07", "remainingRequests": 1346}, {"receiptMonth": "2026-08", "remainingRequests": 14925},
    {"receiptMonth": "2026-09", "remainingRequests": 14400}, {"receiptMonth": "2026-10", "remainingRequests": 13179}]}
OURS_OCT31 = {"2026-05": 15, "2026-06": 41, "2026-07": 4098, "2026-08": 15005, "2026-09": 14428, "2026-10": 13311}


def test_pwd_pending_waits_for_a_month_end_after_the_fix():
    scores, skipped = pwd_pending_scores(PWD_OCT31, OURS_OCT31, source="DOL page", read_on="2026-11-02")
    check(scores == [], "Oct 31's table scores nothing: our check's older requests lagged before Nov 23")
    check(len(skipped) == 1 and PWD_SCORABLE_FROM in skipped[0], "and the run says why, naming the first scorable day")


def test_pwd_pending_by_month():
    reading = dict(PWD_OCT31, pwdAsOf=PWD_SCORABLE_FROM)
    scores, skipped = pwd_pending_scores(reading, OURS_OCT31, source="DOL page", read_on="2026-12-03")
    by = {s.scope: s for s in scores}
    check(skipped == [] and len(scores) == 7, "one score per receipt month DOL lists, and their total")
    aug = by["received 2026-08"]
    check((aug.ours, aug.theirs, aug.gap, aug.figure) == (15005, 14925, 80, "pwd.pending_perm"),
          "August: 15,005 against 14,925, 80 over")
    check(aug.within and aug.tolerance == 149, "August inside 1% of DOL's count (149 requests)")
    may = by["received 2026-05"]
    check(may.tolerance == 10 and may.within, "a month DOL counts in dozens gets the 10-request floor: May, 3 over")
    check(not by["received 2026-07"].within, "July's 4,098 against 1,346 is outside")
    total = by["every receipt month DOL lists"]
    check((total.ours, total.theirs) == (46898, 43892), "the total: 46,898 against 43,892")
    no_month = pwd_pending_scores(dict(reading, pwdPermBacklog=[{"receiptMonth": "2026-11", "remainingRequests": 9}]),
                                  {}, source="DOL page", read_on="2026-12-03")[0]
    check([s.ours for s in no_month] == [0, 0], "a month we hold no open request for counts 0, never missing")


def test_pwd_pending_missing_table():
    scores, skipped = pwd_pending_scores({"pwdAsOf": "2026-12-31"}, OURS_OCT31, source="x", read_on=None)
    check(scores == [] and "table" in skipped[0], "a reading without DOL's table scores nothing and says so")
    scores, skipped = pwd_pending_scores({}, OURS_OCT31, source="x", read_on=None)
    check(scores == [] and "as-of" in skipped[0], "a reading without its as-of day scores nothing and says so")


def main() -> int:
    for fn in (test_pending_two_ways, test_no_census_scores_nothing, test_analyst_review_windows, test_analyst_review_edges,
               test_pwd_pending_waits_for_a_month_end_after_the_fix, test_pwd_pending_by_month,
               test_pwd_pending_missing_table):
        fn()
    print(f"\n{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

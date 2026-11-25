"""Our figures scored against the agency's own (D11, Batch 4, Nov 25 2026).

A score sets one figure of ours beside the official one on the same definition, window, day and scope, and says how
far apart they are and whether that's inside the stated tolerance (the scoring rules in .planning's R5 map: same
definition, same window, same as-of day, same scope, DOL's rounding). A late or missing official figure scores
nothing, never zero: these functions return no score and the reason, and the caller records the reason.
score_official_figures.py writes the rows to `figure_scores`; the morning report and the admin page read them.
"""

from __future__ import annotations

import datetime as dt
import statistics
from dataclasses import dataclass

from lib_days import days_between

# Pending counts agree inside 1% of DOL's: DOL rounds, and our census and DOL's cutoff are hours apart.
PENDING_TOLERANCE_SHARE = 0.01
# Durations agree inside 3 days: DOL prints whole days, and a decision's day can sit either side of a window's edge.
DAYS_TOLERANCE = 3
# Statuses DOL's Selected Statistics appear not to count among "applications remaining" (an INFERENCE: the sheet
# defines nothing; on Sep 30 2026 leaving these out put our census 0.2% from DOL's count, v2/docs/notes/data.md).
NOT_IN_DOL_SCOPE = frozenset({"APPLICATION ON HOLD", "BALCA APPEALS"})


@dataclass(frozen=True)
class FigureScore:
    figure: str
    scope: str
    as_of: str
    unit: str
    ours: float
    theirs: float
    tolerance: float
    ours_source: str
    theirs_source: str
    theirs_read_on: str | None
    note: str

    @property
    def gap(self) -> float:
        return round(self.ours - self.theirs, 1)

    @property
    def gap_pct(self) -> float | None:
        return round((self.ours - self.theirs) / self.theirs * 100, 2) if self.theirs else None

    @property
    def within(self) -> bool:
        return abs(self.ours - self.theirs) <= self.tolerance


def pending_scores(sheet: dict, census: list[tuple[str, int]], *, source: str, read_on: str | None
                   ) -> tuple[list[FigureScore], list[str]]:
    """Our census of open PERM cases on the sheet's day against DOL's 'applications remaining', counted two ways:
    every open case, and DOL's apparent scope."""
    as_of, theirs = sheet["asOf"], int(sheet["remaining"])
    if not census:
        return [], [f"perm.pending: no census of ours for {as_of}"]
    tolerance = round(theirs * PENDING_TOLERANCE_SHARE)
    every = sum(int(n) for _, n in census)
    scoped = sum(int(n) for s, n in census if str(s).upper() not in NOT_IN_DOL_SCOPE)
    ours_source = f"perm_census_days, {as_of}, every case not final"
    return [
        FigureScore("perm.pending", "every open case", as_of, "cases", every, theirs, tolerance, ours_source, source,
                    read_on, "every status not final, holds and BALCA appeals included"),
        FigureScore("perm.pending", "DOL's apparent scope", as_of, "cases", scoped, theirs, tolerance, ours_source,
                    source, read_on, "leaving out cases on hold and at BALCA, which DOL's sheet appears not to count "
                    "(an inference: the sheet defines nothing)"),
    ], []


def analyst_review_scores(reading: dict, decisions: list[tuple[str, str]], *, history_from: str, source: str,
                          read_on: str | None) -> tuple[list[FigureScore], list[str]]:
    """Our mean days from filing to a decision out of analyst review, over each window DOL averages ('Last 30 Days'
    and so on, ending on DOL's as-of day), against DOL's average. `decisions` are (filing day, decided day) pairs. A
    window that starts before our history doesn't score: it would hold only part of its decisions."""
    as_of = reading.get("permAsOf")
    if not as_of:
        return [], ["perm.analyst_review: DOL's reading has no as-of day"]
    end = dt.date.fromisoformat(as_of)
    scores: list[FigureScore] = []
    skipped: list[str] = []
    for avg in reading.get("permAverageDays") or []:
        if str(avg.get("determination", "")).lower() != "analyst review" or avg.get("calendarDays") is None:
            continue
        period = str(avg.get("period", ""))
        words = period.split()
        if len(words) != 3 or words[0] != "Last" or not words[1].isdigit():
            skipped.append(f"perm.analyst_review: a period this can't read, '{period}'")
            continue
        days = int(words[1])
        start = end - dt.timedelta(days=days)
        figure = f"perm.analyst_review_mean_{days}d"
        if start.isoformat() < history_from:
            skipped.append(f"{figure}: the window starts {start}, before our history ({history_from})")
            continue
        waits = [w for f, d in decisions
                 if start.isoformat() < d <= as_of and (w := days_between(f, d)) is not None and w >= 0]
        if not waits:
            skipped.append(f"{figure}: no decisions of ours in the window")
            continue
        scores.append(FigureScore(
            figure, "analyst review decisions", as_of, "days", round(statistics.mean(waits), 1),
            float(avg["calendarDays"]), DAYS_TOLERANCE,
            f"perm_case_events, {len(waits):,} decisions out of analyst review, {start} to {as_of}", source, read_on,
            f"DOL's '{period}' average; ours is the mean over the decisions our daily check saw, withdrawals left out"))
    return scores, skipped

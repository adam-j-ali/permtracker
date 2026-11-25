#!/usr/bin/env python3
"""Score our PERM figures against DOL's own, into figure_scores (D11, Batch 4, Nov 25 2026).

    python3 scripts/score_official_figures.py [--dry-run]

Three scores so far, each on the official figure's own definition, window, day and scope (lib_figure_scores.py):
- our census of open PERM cases against "applications remaining" on the day of DOL's newest Selected Statistics sheet
  (perm_docs['dol_selected_statistics'], from ingest_dol_selected_stats.py), counted two ways;
- our mean days to a decision out of analyst review against DOL's "Last 30 Days" (and longer) averages on its
  processing-times page (processing_time_readings), over each window our history covers;
- our PERM wage requests (P-100) still waiting on DOL's day, by receipt month, against the same page's table of
  remaining requests, from DOL's Nov 30 2026 table on (PWD_SCORABLE_FROM).
A missing or late official figure scores nothing and the run says why. One row per figure, scope and as-of day,
rewritten when recomputed. The server's daily quarterly job runs it after the sheet reader.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_case_status_direct import HISTORY_FROM, SOURCE as DIRECT_SOURCE  # noqa: E402
from lib_figure_scores import (  # noqa: E402
    PWD_SCORABLE_FROM,
    FigureScore,
    analyst_review_scores,
    pending_scores,
    pwd_pending_scores,
)
from lib_gov_data import log  # noqa: E402
from lib_holidays import decided_on  # noqa: E402

SCRIPT = "score_official_figures.py"
DAY_MS = 86_400_000
DDL = [
    """CREATE TABLE IF NOT EXISTS figure_scores (
        figure TEXT NOT NULL, scope TEXT NOT NULL, as_of TEXT NOT NULL, unit TEXT NOT NULL,
        ours REAL NOT NULL, theirs REAL NOT NULL, tolerance REAL NOT NULL, gap REAL NOT NULL, gap_pct REAL,
        within INTEGER NOT NULL, ours_source TEXT NOT NULL, theirs_source TEXT NOT NULL, theirs_read_on TEXT,
        note TEXT, computed_at INTEGER NOT NULL,
        PRIMARY KEY (figure, scope, as_of))""",
]
UPSERT = """INSERT INTO figure_scores (figure, scope, as_of, unit, ours, theirs, tolerance, gap, gap_pct, within,
    ours_source, theirs_source, theirs_read_on, note, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (figure, scope, as_of) DO UPDATE SET unit = excluded.unit, ours = excluded.ours,
    theirs = excluded.theirs, tolerance = excluded.tolerance, gap = excluded.gap, gap_pct = excluded.gap_pct,
    within = excluded.within, ours_source = excluded.ours_source, theirs_source = excluded.theirs_source,
    theirs_read_on = excluded.theirs_read_on, note = excluded.note, computed_at = excluded.computed_at"""


def row_of(s: FigureScore, now_ms: int) -> list:
    return [s.figure, s.scope, s.as_of, s.unit, s.ours, s.theirs, s.tolerance, s.gap, s.gap_pct, int(s.within),
            s.ours_source, s.theirs_source, s.theirs_read_on, s.note, now_ms]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="score and print, write nothing")
    args = ap.parse_args()
    started = time.time()
    from lib_db import Database, et_date, query_rows, read_doc  # noqa: E402

    db = Database()
    scores: list[FigureScore] = []
    skipped: list[str] = []

    sheet_doc = read_doc(db, "dol_selected_statistics") or {}
    sheet = sheet_doc.get("perm")
    if not sheet:
        skipped.append("perm.pending: DOL's Selected Statistics haven't been read yet")
    else:
        census = [(str(s), int(n)) for s, n in query_rows(
            db, "SELECT status, n FROM perm_census_days WHERE day = ? AND is_final = 0", [sheet["asOf"]])]
        source = (sheet_doc.get("sources") or {}).get("perm", {}).get("url") or "DOL's PERM Selected Statistics"
        got, why = pending_scores(sheet, census, source=source, read_on=sheet_doc.get("readOn"))
        scores += got
        skipped += why

    reading_rows = query_rows(db, "SELECT json, fetched_at FROM processing_time_readings ORDER BY fetched_at DESC LIMIT 1")
    if not reading_rows:
        skipped.append("perm.analyst_review: no reading of DOL's processing-times page")
    else:
        reading = json.loads(reading_rows[0][0])
        as_of = reading.get("permAsOf")
        if as_of:
            end_ms = int(dt.datetime.fromisoformat(as_of).replace(tzinfo=dt.timezone.utc).timestamp()) * 1000
            # Every decision out of analyst review the check saw within 181 days before DOL's day and 2 after; the
            # day each counts on is D5's one rule (decided_on), and each window keeps its own days.
            rows = query_rows(db, """
                SELECT r.filing_date, MIN(e.changed_at) FROM perm_case_events e
                  JOIN perm_live_recent r ON r.case_number = e.case_number
                 WHERE e.from_status = 'ANALYST REVIEW' AND e.changed_at >= ? AND e.changed_at < ?
                   AND e.to_final = 1 AND e.source = ? AND e.to_status NOT LIKE 'WITHDRAWN%'
                 GROUP BY e.case_number""", [end_ms - 181 * DAY_MS, end_ms + 2 * DAY_MS, DIRECT_SOURCE])
            decisions = [(str(f)[:10], decided_on(int(t)).isoformat()) for f, t in rows if f and t]
            source = reading.get("sourceUrl") or "https://flag.dol.gov/processingtimes"
            read_on = et_date(int(reading_rows[0][1]))
            got, why = analyst_review_scores(reading, decisions, history_from=HISTORY_FROM, source=source,
                                             read_on=read_on)
            scores += got
            skipped += why
        else:
            skipped.append("perm.analyst_review: DOL's reading has no as-of day")

        pwd_as_of = reading.get("pwdAsOf")
        table = reading.get("pwdPermBacklog") or []
        ours_by_month: dict[str, int] = {}
        # Count only when the table can score: a table from before the fix scores nothing, and says so below.
        if pwd_as_of and table and pwd_as_of >= PWD_SCORABLE_FROM:
            first = min(str(r["receiptMonth"]) for r in table) + "-01"
            # The end of DOL's day, Eastern: a request decided after it was still waiting on DOL's day.
            day_end = dt.datetime.combine(dt.date.fromisoformat(pwd_as_of) + dt.timedelta(days=1), dt.time(),
                                          tzinfo=ZoneInfo("America/New_York"))
            end_ms = int(day_end.timestamp() * 1000)
            ours_by_month = {str(m): int(n) for m, n in query_rows(db, """
                SELECT substr(s.filing_date, 1, 7), COUNT(*) FROM pwd_case_status s
                 WHERE s.filing_date >= ? AND s.filing_date <= ?
                   AND s.case_number >= 'P-100-' AND s.case_number < 'P-100.'
                   AND (s.is_final = 0 OR (SELECT MIN(e.changed_at) FROM pwd_case_events e
                                            WHERE e.case_number = s.case_number AND e.to_final = 1) >= ?)
                 GROUP BY 1""", [first, pwd_as_of, end_ms])}
        got, why = pwd_pending_scores(reading, ours_by_month, source=reading.get("sourceUrl")
                                      or "https://flag.dol.gov/processingtimes", read_on=et_date(int(reading_rows[0][1])))
        scores += got
        skipped += why

    for s in scores:
        log(f"  {s.figure} [{s.scope}] {s.as_of}: ours {s.ours:,} against {s.theirs:,}, gap {s.gap:+,} "
            f"({s.gap_pct:+.2f}%), {'inside' if s.within else 'outside'} {s.tolerance:,} {s.unit}")
    for k in skipped:
        log(f"  skipped: {k}")
    if args.dry_run:
        return 0

    from lib_db import record_run, stmt  # noqa: E402

    db.script(DDL)
    now_ms = int(time.time() * 1000)
    if scores:
        db.pipeline([stmt(UPSERT, row_of(s, now_ms)) for s in scores] + [{"type": "close"}])
    note = f"{len(scores)} scores" + (f"; skipped: {'; '.join(skipped)}" if skipped else "")
    landed = record_run(db, SCRIPT, status="ok", rows_written=len(scores), note=note, started_at=started)
    return 0 if landed else 1


if __name__ == "__main__":
    sys.exit(main())

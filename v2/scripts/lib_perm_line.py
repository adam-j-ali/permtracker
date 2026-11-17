"""Where DOL is in the PERM line by our own daily check of its case status.

The Python twin of permLineFrom in convex/lib/permLine.ts: the newest filing month DOL has begun deciding, read from
the census matrix (one row per filing month and status, with is_final). A month has begun once DOL has made
STARTED_MIN of its own decisions on it (a withdrawal is the employer's, never DOL's) and the month before is
PREVIOUS_DONE decided among the cases DOL can decide, or once DOL has made STARTED_FIRMLY decisions on it whatever the
month before shows. DOL's processing-times page stopped printing a filing month on Oct 31 2026, so the scripts that
read DOL's month take this one when DOL prints none. scripts/fixtures/perm_line.json holds both twins to the same
answers; the reasons and the measurements are in the TypeScript copy.
"""

from __future__ import annotations

import json
from typing import Iterable, Mapping

# convex/lib/permLine.ts; test_perm_line.py reads that file and holds these equal.
FRONT_MIN_CASES = 100
STARTED_MIN = 50
PREVIOUS_DONE = 0.8
STARTED_FIRMLY = 500

_ON_HOLD = "APPLICATION ON HOLD"


def _tally(matrix: Iterable[Mapping]) -> dict[str, dict[str, int]]:
    months: dict[str, dict[str, int]] = {}
    for r in matrix:
        m = str(r.get("month") or "")
        if len(m) != 7 or m[4] != "-":
            continue
        t = months.setdefault(m, {"total": 0, "final": 0, "dol": 0, "withdrawn": 0, "held": 0})
        n = int(r.get("n") or 0)
        status = str(r.get("status") or "").strip().upper()
        t["total"] += n
        if int(r.get("is_final") or 0) == 1:
            t["final"] += n
            if status.startswith("WITHDRAWN"):
                t["withdrawn"] += n
            else:
                t["dol"] += n
        elif status == _ON_HOLD:
            t["held"] += n
    return months


def perm_line_month(matrix: Iterable[Mapping]) -> str | None:
    """The month DOL is deciding, "YYYY-MM", or None when no month on record has begun."""
    busy = sorted((m, t) for m, t in _tally(matrix).items() if t["total"] >= FRONT_MIN_CASES)
    line = None
    for i, (month, t) in enumerate(busy):
        if t["dol"] < STARTED_MIN:
            continue
        before = busy[i - 1][1] if i > 0 else None
        workable = before["total"] - before["held"] - before["withdrawn"] if before else 0
        before_done = before is None or (workable > 0 and before["dol"] / workable >= PREVIOUS_DONE)
        if before_done or t["dol"] >= STARTED_FIRMLY:
            line = month
    return line


def _rows(db, query_rows, sql: str, args: list) -> list:
    """The rows, or none when the table doesn't exist yet (a fresh database); any other error is raised."""
    try:
        return query_rows(db, sql, args)
    except Exception as e:  # sqlite3 and libSQL raise different classes for the same message
        if "no such table" in str(e).lower():
            return []
        raise


def line_now(db, query_rows) -> tuple[str | None, str | None]:
    """(month, our check's day) from perm_docs['live_census'], or (None, None)."""
    rows = _rows(db, query_rows, "SELECT json FROM perm_docs WHERE key = 'live_census'", [])
    if not rows or not rows[0][0]:
        return None, None
    try:
        doc = json.loads(rows[0][0])
    except ValueError:
        return None, None
    return perm_line_month(doc.get("matrix") or []), doc.get("asOf")


def line_on(db, query_rows, day: str) -> str | None:
    """The month by the census as it stood on a past day (perm_census_days, from Aug 30 2026), or None."""
    got = _rows(db, query_rows, "SELECT MAX(day) FROM perm_census_days WHERE day <= ?", [day])
    newest = got[0][0] if got else None
    if not newest:
        return None
    rows = query_rows(db, "SELECT month, status, is_final, SUM(n) FROM perm_census_days WHERE day = ? "
                      "GROUP BY month, status, is_final", [newest])
    return perm_line_month({"month": r[0], "status": r[1], "is_final": r[2], "n": r[3]} for r in rows)

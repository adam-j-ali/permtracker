#!/usr/bin/env python3
"""The stage statistics count the moves the sweep watched, never its catch-up.

    python3 scripts/test_stage_stats_first_pass.py

NO NETWORK and no production database: the real SQL in
`ingest_case_status_direct.write_stage_stats` runs against in-memory SQLite
through `lib_sqlite_shim`. What has to hold:

  1. A status change written during the sweep's catch-up (through HISTORY_FROM) is a
     first sighting: it is no move out of a stage, so "DENIED to BALCA APPEALS",
     which only the first pass ever wrote, is not among the moves.
  2. It is no entry to a stage either: a case first seen at reconsideration has
     no known start, so it isn't among the stays the duration curve times.
  3. A move out of a stage that the sweep did watch still counts, whenever the
     case entered it.
  4. The retired mirror's rows, older than the sweep's first, never count.
  5. The rule is what the test sees: with the catch-up counted, it fails.
"""
from __future__ import annotations

import datetime
import json
import pathlib
import sys
from zoneinfo import ZoneInfo

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lib_sqlite_shim import SqliteTurso  # noqa: E402
import ingest_case_status_direct as core  # noqa: E402

FAILS: list[str] = []
ET = ZoneInfo("America/New_York")
R = "RECONSIDERATION APPEALS"
MIRROR = "retired mirror (third party; underlying: flag.dol.gov case status)"


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {label}{'' if cond else '  ' + detail}")
    if not cond:
        FAILS.append(label)


def ts(day: str, hour: int = 8) -> int:
    d = datetime.datetime.strptime(day, "%Y-%m-%d").replace(hour=hour, tzinfo=ET)
    return int(d.timestamp() * 1000)


def seeded() -> SqliteTurso:
    db = SqliteTurso()
    db.conn.execute("""CREATE TABLE perm_case_events (
        case_number TEXT NOT NULL, changed_at INTEGER NOT NULL,
        from_status TEXT NOT NULL, to_status TEXT NOT NULL,
        to_final INTEGER NOT NULL, source TEXT NOT NULL,
        PRIMARY KEY (case_number, changed_at))""")
    db.conn.execute("""CREATE TABLE perm_case_status (
        case_number TEXT PRIMARY KEY, filing_date TEXT, current_status TEXT, is_final INTEGER)""")
    final = {"CERTIFIED", "DENIED", "WITHDRAWN"}

    def event(case: str, day: str, frm: str, to: str, source: str = core.SOURCE, hour: int = 8) -> None:
        db.conn.execute("INSERT INTO perm_case_events VALUES (?, ?, ?, ?, ?, ?)",
                        [case, ts(day, hour), frm, to, 1 if to in final else 0, source])

    # The retired mirror's last rows, the day before the sweep's first.
    for i in range(4):
        event(f"M-{i}", "2026-08-27", "DENIED", "BALCA APPEALS", MIRROR)
    # The catch-up, day one: what DOL held against the mirror's last word.
    for i in range(40):
        event(f"A-{i}", "2026-08-28", "DENIED", R)
    for i in range(5):
        event(f"B-{i}", "2026-08-28", "DENIED", "BALCA APPEALS")
    # Its second day: the same first read.
    for i in range(10):
        event(f"C-{i}", "2026-08-29", "DENIED", R, hour=6)
    # Watched: 20 of the cases first seen in the catch-up are certified on reconsideration.
    for i in range(20):
        event(f"A-{i}", "2026-09-20", R, "CERTIFIED")
    # Watched from the start: 35 denials go to reconsideration, 4 are certified and 3 get a NORD.
    for i in range(35):
        event(f"W-{i}", "2026-09-08", "ANALYST REVIEW", "DENIED")
        event(f"W-{i}", "2026-09-10", "DENIED", R)
    for i in range(4):
        event(f"W-{i}", "2026-10-10", R, "CERTIFIED")
    for i in range(4, 7):
        event(f"W-{i}", "2026-10-20", R, "NORD ISSUED")
    # The cases still waiting, so the stage has an age to report.
    for i in range(8):
        db.conn.execute("INSERT INTO perm_case_status VALUES (?, '2025-06-01', ?, 0)", [f"P-{i}", R])
    db.conn.commit()
    return db


def stats_of(db: SqliteTurso) -> dict:
    core.write_stage_stats(db)
    row = db.conn.execute("SELECT json FROM perm_docs WHERE key = 'stage_stats'").fetchone()
    return json.loads(row[0]) if row else {}


def main() -> int:
    doc = stats_of(seeded())
    moves = {(m["from"], m["to"]): m["n"] for m in doc.get("exits", [])}
    check("the stage statistics were written", bool(doc.get("stages")), str(doc)[:200])
    check("a denial's watched moves are the 35 the sweep saw, never the catch-up's 50",
          moves.get(("DENIED", R)) == 35, str(moves))
    check("a move only the catch-up and the retired mirror wrote isn't a move",
          ("DENIED", "BALCA APPEALS") not in moves, str(moves))
    check("a watched move out of a stage counts whenever the case entered it",
          moves.get((R, "CERTIFIED")) == 24 and moves.get((R, "NORD ISSUED")) == 3, str(moves))
    timed = {d["stage"]: d for d in doc.get("durations", [])}
    check("only the stays whose start the sweep saw are timed",
          timed.get(R, {}).get("entered") == 35, str({k: v.get("entered") for k, v in timed.items()}))
    curve = timed.get(R, {}).get("curve", [])
    by_day = {pt["days"]: pt for pt in curve}
    check("the curve counts a watched stay from its own start: 4 of 35 had left by day 30",
          by_day.get(30, {}).get("left") == 4 and by_day.get(30, {}).get("eligible") == 35, str(by_day.get(30)))
    check("and 7 of 35 by day 40", by_day.get(40, {}).get("left") == 7, str(by_day.get(40)))

    check("the doc names the day its moves are counted from", doc.get("since") == "2026-08-30", str(doc.get("since")))

    # The rule is what these checks see: count the catch-up and the same data reads differently.
    kept = core.WATCHED_FROM_MS
    core.WATCHED_FROM_MS = 0
    try:
        broken = stats_of(seeded())
    finally:
        core.WATCHED_FROM_MS = kept
    bm = {(m["from"], m["to"]): m["n"] for m in broken.get("exits", [])}
    bt = {d["stage"]: d.get("entered") for d in broken.get("durations", [])}
    check("with the catch-up counted, the false move and the false entries come back",
          bm.get(("DENIED", "BALCA APPEALS")) == 5 and bm.get(("DENIED", R)) == 85 and bt.get(R) == 85, f"{bm} {bt}")

    print(f"\n{'FAILED: ' + ', '.join(FAILS) if FAILS else 'all passed'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

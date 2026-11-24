"""Where each alert goes, from the one list in scripts/data/alert_routes.json.

Every program that raises an alert names its kind (an id such as "alarm.disk") and asks this list how to send it:
by phone and email, in the morning report, by email, or onto the admin page only. Convex reads the same file
through convex/lib/alertRoutes.ts; scripts/test_alert_routes.py holds the list and the programs to each other.

A list that can't be read never silences an alarm: every kind then goes by phone and email, at its program's own
level, and `problem` says why, for the email.

Installed as /usr/local/lib/permtracker/alert_routes.py with the list beside it (alert_routes.json); run from the
repository, it reads scripts/data/alert_routes.json.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHANNELS = ("phone", "report", "email", "admin")
LEVELS = ("urgent", "high")
# The installed copy beside this file, the repository's (tests, scripts run from a checkout), and the server's checkout.
CANDIDATES = (HERE / "alert_routes.json", HERE.parent.parent / "data" / "alert_routes.json",
              Path("/srv/permtracker/repo/v2/scripts/data/alert_routes.json"))


def problems(doc: object) -> list[str]:
    """What's wrong with a routing list, in plain words; empty when it's sound."""
    if not isinstance(doc, dict) or not isinstance(doc.get("routes"), list):
        return ["the list has no routes"]
    out: list[str] = []
    runs = doc.get("runs") if isinstance(doc.get("runs"), dict) else {}
    channels = doc.get("channels") if isinstance(doc.get("channels"), dict) else {}
    if sorted(channels) != sorted(CHANNELS):
        out.append(f"the channels must be exactly {', '.join(CHANNELS)}")
    seen: set[str] = set()
    for i, r in enumerate(doc["routes"]):
        rid = r.get("id") if isinstance(r, dict) else None
        if not isinstance(rid, str) or "." not in rid:
            out.append(f"route {i} has no id shaped like family.kind")
            continue
        if rid in seen:
            out.append(f"{rid} is listed twice")
        seen.add(rid)
        if r.get("runs") not in runs:
            out.append(f"{rid} runs in {r.get('runs')!r}, which isn't one of the places listed under runs")
        if r.get("channel") not in CHANNELS:
            out.append(f"{rid} has channel {r.get('channel')!r}")
        for field in ("what", "repeat"):
            if not isinstance(r.get(field), str) or not r[field].strip():
                out.append(f"{rid} says nothing under {field}")
        phone = r.get("channel") == "phone"
        if phone and r.get("level") not in LEVELS:
            out.append(f"{rid} goes by phone, so it needs a level: urgent or high")
        if phone and "remindHours" not in r:
            out.append(f"{rid} goes by phone, so it needs remindHours (a number, or null for never)")
        if not phone and ("level" in r or "remindHours" in r):
            out.append(f"{rid} doesn't go by phone, so it takes no level or remindHours")
        remind = r.get("remindHours")
        if remind is not None and not (isinstance(remind, (int, float)) and remind > 0):
            out.append(f"{rid} has remindHours {remind!r}")
    return out


class Routes:
    """The list, looked up by id. `ok` is False when it couldn't be read (every kind is then loud)."""

    def __init__(self, doc: dict | None, problem: str | None = None):
        self.problem = problem
        self.by_id = {r["id"]: r for r in (doc or {}).get("routes", []) if isinstance(r, dict) and "id" in r}
        self.ok = problem is None

    def get(self, rid: str) -> dict | None:
        return self.by_id.get(rid)

    def channel(self, rid: str) -> str:
        """Where a kind goes. An unlisted kind, or an unreadable list, goes by phone: never silent."""
        r = self.by_id.get(rid)
        return r["channel"] if r else "phone"

    def loud(self, rid: str) -> bool:
        """True when the kind is sent as it happens (phone, or email), not left to the report or the admin page."""
        return self.channel(rid) in ("phone", "email")

    def level(self, rid: str, default: str = "high") -> str | None:
        """The push's level for a kind that goes by phone; None for any other channel."""
        r = self.by_id.get(rid)
        if r is None:
            return default
        return r.get("level", default) if r["channel"] == "phone" else None

    def remind_s(self, rid: str, default: float | None = 6 * 3600) -> float | None:
        """Seconds between reminder emails while a phone kind lasts; None for never."""
        r = self.by_id.get(rid)
        if r is None:
            return default
        hours = r.get("remindHours")
        return None if hours is None else float(hours) * 3600


def load(path: str | os.PathLike | None = None) -> Routes:
    """The list from `path`, PT_ALERT_ROUTES, or the first of CANDIDATES that exists."""
    picked = path or os.environ.get("PT_ALERT_ROUTES")
    tries = [Path(picked)] if picked else [p for p in CANDIDATES if p.exists()]
    if not tries:
        return Routes(None, "the routing list (alert_routes.json) isn't installed")
    try:
        doc = json.loads(tries[0].read_text())
    except (OSError, ValueError) as exc:
        return Routes(None, f"the routing list couldn't be read ({type(exc).__name__})")
    bad = problems(doc)
    if bad:
        return Routes(None, f"the routing list is unsound: {bad[0]}")
    return Routes(doc)

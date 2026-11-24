#!/usr/bin/env python3
"""Store the owner's Mac's own health check in perm_docs['mac_health'] for the morning report.

The Mac checks its own scheduled jobs every two hours and sends the result here over ssh, on standard input. Only the
fields the morning report reads are kept, each bounded, so the stored document has a known shape and size whatever
arrives. Each job's detail stays on the Mac.

    ssh <server> "sudo -u permtracker bash -c 'set -a; . <env file>; cd <repo>/v2 && python3 scripts/store_mac_health.py'" < health.json
"""
from __future__ import annotations

import json
import sys

MAX_INPUT = 256 * 1024
MAX_LINES = 12
MAX_CHARS = 300
MAX_IDS = 30


def _lines(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v[:MAX_CHARS] for v in value if isinstance(v, str)][:MAX_LINES]


def _int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _asks(jobs) -> dict | None:
    asks = jobs.get("Asks") if isinstance(jobs, dict) else None
    if not isinstance(asks, dict):
        return None
    counts = asks.get("counts") if isinstance(asks.get("counts"), dict) else {}
    behind = [b[:20] for b in asks.get("behind") or [] if isinstance(b, str)][:MAX_IDS]
    unreadable = asks.get("unreadable")
    error = asks.get("error")
    return {
        "total": _int(asks.get("total")),
        "open": _int(counts.get("open")),
        "behind": behind,
        "unreadable": len(unreadable) if isinstance(unreadable, list) else 0,
        "error": error[:MAX_CHARS] if isinstance(error, str) else None,
    }


def clean(raw: dict) -> dict:
    """The report's fields from the Mac's health file. A wrong type reads as missing, never as healthy."""
    if not isinstance(raw, dict):
        raise ValueError("the Mac's health check is not a JSON object")
    free = raw.get("free_gb")
    return {
        "at": raw.get("at") if isinstance(raw.get("at"), str) else None,
        "ok": raw.get("ok") is True,
        "problems": _lines(raw.get("problems")),
        "notes": _lines(raw.get("notes")),
        "freeGb": round(float(free), 1) if isinstance(free, (int, float)) and not isinstance(free, bool) else None,
        "asks": _asks(raw.get("jobs")),
    }


def main() -> int:
    text = sys.stdin.read(MAX_INPUT + 1)
    if len(text) > MAX_INPUT:
        print(f"refused: more than {MAX_INPUT} bytes", file=sys.stderr)
        return 2
    try:
        doc = clean(json.loads(text))
    except ValueError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    from lib_db import Database, read_doc, write_doc  # noqa: PLC0415 - the server's database, only when storing

    db = Database()
    stored = write_doc(db, "mac_health", doc)
    # Read it back: a write that didn't land is a failure here, never a quiet morning report.
    if read_doc(db, "mac_health") != json.loads(stored):
        print("the stored document doesn't read back the same", file=sys.stderr)
        return 1
    print(f"stored: ok={doc['ok']} problems={len(doc['problems'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

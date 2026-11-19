"""The community posts loader (scripts/ingest_community_posts.py): what it keeps, what it never keeps, what it refuses.

Every row here is made up. Run: python3 scripts/test_ingest_community_posts.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ingest_community_posts as icp  # noqa: E402
import lib_reported_cases as rc  # noqa: E402


def row(**f) -> dict:
    base = {"source_id": "c123", "kind": "comment", "subreddit": "USCIS_EB3", "created_utc": "2026-11-04T15:00:00Z",
            "author_hash": "abc123def456", "category": "EB3", "priority_date": "2023-07-10", "receipt_date": "2026-03-06",
            "transfer_to_sfv_date": "2026-09-24", "approval_date": "2026-11-03", "ead_ap_date": "2026-05-01",
            "biometrics_date": "2026-03-31", "i485j_approval_date": None, "interview": "unknown",
            "quote_short": "approved today", "notes": "a note", "permalink": "/r/x/comments/1/y/c123/",
            "confidence": "high", "sfv_basis": "explicit"}
    return {**base, **f}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    r = icp.reddit_record(row(), salt="s")
    check(r["source"] == "reddit" and r["key"] == "c123" and r["office"] == "SFV", "a Reddit row is a San Fernando record")
    check(r["category"] == "EB-3" and r["i485_receipt"] == "2026-03-06" and r["transfer"] == "2026-09-24", "its category and days")
    check(r["i485_decided"] == "2026-11-03" and r["i485_decision"] == "approved", "an approval day is an approval")
    check(r["ead"] == "2026-05-01" and r["biometrics"] == "2026-03-31", "the work permit and biometrics")
    check(r["as_of"] == "2026-11-04", "as of the day it was posted, an Eastern day")
    check(r["person"] != "abc123def456" and len(r["person"]) == 16, "the author link is salted again")
    check(icp.reddit_record(row(), salt="s")["person"] == r["person"], "the same person gets the same link")
    check(icp.reddit_record(row(), salt="t")["person"] != r["person"], "another salt gives another link")
    text = json.dumps(r)
    for never in ("approved today", "a note", "/r/x/", "abc123def456", "USCIS_EB3"):
        check(never not in text, f"never kept: {never}")
    rc.check_record({k: v for k, v in r.items() if v is not None})
    check(True, "the record passes the merge's own check")

    check(icp.reddit_record(row(category="EB2-NIW"), salt="s")["category"] == "EB-2 NIW", "EB2-NIW is EB-2 NIW")
    check(icp.reddit_record(row(category="unknown"), salt="s")["category"] is None, "an unknown category is left blank")
    check(icp.reddit_record(row(category="family"), salt="s")["category"] == "Family", "a family case is marked as one")
    check(icp.reddit_record(row(approval_date="2026"), salt="s")["i485_decided"] is None, "a year alone is no day")
    check(icp.reddit_record(row(transfer_to_sfv_date="2026-09"), salt="s")["transfer"] == "2026-09", "a month is kept")
    check(icp.reddit_record(row(approval_date=None), salt="s")["i485_decision"] is None, "no approval day: no decision")
    check(icp.reddit_record(row(transfer_to_sfv_date="9/24/2026"), salt="s")["transfer"] is None, "a date it can't read is dropped")

    rows, counts = icp.prepare([row(), row(source_id="c124", author_hash="zzz"), row(source_id="c124")], salt="s")
    check(len(rows) == 2 and counts["repeated_ids"] == 1, f"one row per post or comment: {counts}")
    try:
        icp.prepare([row(author_hash=None)], salt="s")
        check(False, "refuses a row with no author link")
    except ValueError:
        check(True, "refuses a row with no author link")
    try:
        icp.prepare([row()], salt="")
        check(False, "refuses an empty salt")
    except ValueError:
        check(True, "refuses an empty salt")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

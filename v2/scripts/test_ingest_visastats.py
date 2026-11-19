"""The VisaStats loader (scripts/ingest_visastats.py): what it reads, what it refuses.

The fixtures are synthetic: the tracker's own column headers (Nov 19 2026) over made-up rows.
Run: python3 scripts/test_ingest_visastats.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ingest_visastats as vs  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    vs.CASE_FLOOR = vs.OFFICER_FLOOR = 1
    cases_b = json.load(open(os.path.join(HERE, "fixtures", "community", "visastats_eb_o_synthetic.json")))
    officers_b = json.load(open(os.path.join(HERE, "fixtures", "community", "visastats_officers_synthetic.json")))
    cases = vs.parse_cases(cases_b)
    check(len(cases) == 2, "two cases read, the empty row passed over")
    a, b = cases
    check(a["service_center"] == "TSC" and b["service_center"] is None and b["service_center_text"] == "NSC TSC after PP",
          "a center is named by its code, and a case that moved keeps the words it was written in")
    check(a["premium"] == "with filing" and b["premium"] == "after filing", "premium processing reads with or after filing")
    check(a["decision"] == "Approved" and a["decision_date"] == "2026-03-20" and a["duration_days"] == 18,
          "the decision, its day and the case's length")
    check(b["rfe_dates"] == '["2026-01-20", "2026-02-01"]' and b["silent_updates"] == '["2026-03-01"]',
          "lists of days kept as lists")
    check(a["comments"] is None, "the tracker's 'Be the first to comment' placeholder isn't kept as a comment")
    check(a["created"] == "2026-11-01" and a["publications"] == 12 and a["citations"] == 340,
          "the created day and the counts as numbers")
    officers = vs.parse_officers(officers_b)
    check(len(officers) == 1 and officers[0]["officer"] == "XM1234", "an officer record needs an officer number")

    with_author = dict(cases_b, heads=["AUTHOR", *cases_b["heads"]], rows=[["alias", *r] for r in cases_b["rows"]])
    try:
        vs.parse_cases(with_author)
        check(False, "a bundle carrying the author column is refused")
    except vs.Refused:
        check(True, "a bundle carrying the author column is refused")
    renamed = dict(cases_b, heads=[("DECIDED ON" if h == "DECISION DATE" else h) for h in cases_b["heads"]])
    try:
        vs.parse_cases(renamed)
        check(False, "a bundle whose columns changed is refused, naming the missing one")
    except vs.Refused as e:
        check("decision_date" in str(e), "a bundle whose columns changed is refused, naming the missing one")
    vs.CASE_FLOOR = 100
    try:
        vs.parse_cases(cases_b)
        check(False, "a bundle under its floor is refused")
    except vs.Refused:
        check(True, "a bundle under its floor is refused")

    print("ALL PASS" if not failures else f"{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

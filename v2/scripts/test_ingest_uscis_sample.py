#!/usr/bin/env python3
"""The USCIS sample's loader (ingest_uscis_sample.py, Batch 3, Nov 25 2026): what it accepts, refuses and changes.

    python3 scripts/test_ingest_uscis_sample.py
"""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_uscis_sample import (  # noqa: E402
    CASE_FIELDS, SampleError, block_of, check_figures, diff_cases, read_cases,
)

fails: list[str] = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def refused(fn, needle: str) -> bool:
    try:
        fn()
    except SampleError as exc:
        return needle in str(exc)
    return False


HEAD = ",".join(CASE_FIELDS) + "\n"
A = "EAC3512345678,I-485,approved,Case Was Approved,2026-11-25,2026-11-24,,daily\n"
B = "IOE0000000000,I-765,rfe,Request for Evidence Was Sent,2026-11-24,2026-11-20,2026-10,tracked\n"


def cases_file(text: str) -> str:
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
    f.write(text)
    f.close()
    return f.name


def test_read_cases():
    got = read_cases(cases_file(HEAD + A + B))
    check(set(got) == {"EAC3512345678", "IOE0000000000"}, "both rows read, keyed by receipt")
    check(got["IOE0000000000"]["grp"] == "rfe" and got["IOE0000000000"]["since_on"] == "2026-11-20", "fields kept")
    check(refused(lambda: read_cases(cases_file("receipt,form\n" + A)), "columns"), "another header is refused")
    check(refused(lambda: read_cases(cases_file(HEAD + A.replace("EAC3512345678", "EAC35"))), "receipt"),
          "a malformed receipt is refused")
    check(refused(lambda: read_cases(cases_file(HEAD + A.replace(",approved,", ",maybe,"))), "group"),
          "a group the site doesn't know is refused")
    check(read_cases(cases_file(HEAD + A.replace(",approved,", ",rejected,")))["EAC3512345678"]["grp"] == "rejected",
          "a rejected filing, an unnamed decision and an other status load (the kit's own groups)")
    check(refused(lambda: read_cases(cases_file(HEAD + A.replace("2026-11-24", "Nov 24"))), "day"),
          "a day that isn't YYYY-MM-DD is refused")


def test_block_of():
    check(block_of("IOE0000000000") == "IOE00000", "an online number's block is its first eight characters")
    check(block_of("EAC3512345678") is None, "a service-center number has no block")


def test_check_figures():
    good = {"as_of": "2026-11-25", "cases": 1000, "by_month": {}, "by_block": {"IOE09366": {}}}
    check(check_figures(good, last={"as_of": "2026-11-24", "cases": 990}, cases_read=1000) == "load", "a new day loads")
    check(check_figures(good, last=None, cases_read=1000) == "load", "the first load loads")
    check(check_figures(good, last={"as_of": "2026-11-25", "cases": 1000}, cases_read=1000) == "repeat",
          "the same day again is a repeat, skipped")
    check(refused(lambda: check_figures(good, last={"as_of": "2026-11-26", "cases": 1000}, cases_read=1000), "order"),
          "an older day than the last load is refused")
    check(refused(lambda: check_figures(good, last={"as_of": "2026-11-24", "cases": 1100}, cases_read=1000), "shrink"),
          "a file with under 95% of the last load's cases is refused")
    check(refused(lambda: check_figures({**good, "cases": 7}, last=None, cases_read=1000), "cases"),
          "figures that disagree with the cases file are refused")
    leaky = {**good, "by_month": {"note": "see IOE0000000000"}}
    check(refused(lambda: check_figures(leaky, last=None, cases_read=1000), "receipt"),
          "figures holding a receipt number are refused: only a number's own lookup shows it")


def test_diff_cases():
    prev = read_cases(cases_file(HEAD + A + B))
    moved = B.replace(",rfe,Request for Evidence Was Sent,2026-11-24,2026-11-20,",
                      ",approved,Case Was Approved,2026-11-25,2026-11-25,")
    new_one = "EAC3512345679,I-485,waiting,Case Was Received,2026-11-25,2026-11-25,,daily\n"
    new = read_cases(cases_file(HEAD + moved + new_one))
    upserts, deletes, events = diff_cases(prev, new)
    check(sorted(r["receipt"] for r in upserts) == ["EAC3512345679", "IOE0000000000"], "the moved and the new rows upsert")
    check(deletes == ["EAC3512345678"], "a number gone from the file is deleted")
    check(len(events) == 1 and events[0]["from_grp"] == "rfe" and events[0]["to_grp"] == "approved"
          and events[0]["on_day"] == "2026-11-25", "one move, dated the day the new status was first seen")
    same_status = B.replace("2026-11-24,2026-11-20", "2026-11-25,2026-11-20")
    up2, _, ev2 = diff_cases(prev, read_cases(cases_file(HEAD + A + same_status)))
    check(len(up2) == 1 and ev2 == [], "a re-check with the same status updates its day and makes no move")


def main() -> int:
    for fn in (test_read_cases, test_block_of, test_check_figures, test_diff_cases):
        fn()
    print(f"\n{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

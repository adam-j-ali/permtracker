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
    CASE_FIELDS, SampleError, block_mix, block_of, check_figures, diff_cases, reached_by_month, read_cases,
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
    # A second export the same day, made after the last load, loads (Nov 26 2026: the morning's export missed a block
    # the census walked an hour later); the same export again is still a repeat.
    loaded = {"as_of": "2026-11-25", "cases": 1000, "loaded_at": 1795701600000}  # Nov 26 2026, 9:00 AM EST
    later = {**good, "made_at": "2026-11-26T09:10:00-05:00"}
    earlier = {**good, "made_at": "2026-11-20T06:37:00-05:00"}
    check(check_figures(later, last=loaded, cases_read=1000) == "load", "a same-day export made after the last load loads")
    check(check_figures(earlier, last=loaded, cases_read=1000) == "repeat", "one made before the last load is a repeat")
    check(check_figures({**good, "made_at": "not a time"}, last=loaded, cases_read=1000) == "repeat",
          "one with no readable time is a repeat")
    check(refused(lambda: check_figures(good, last={"as_of": "2026-11-26", "cases": 1000}, cases_read=1000), "order"),
          "an older day than the last load is refused")
    check(refused(lambda: check_figures(good, last={"as_of": "2026-11-24", "cases": 1100}, cases_read=1000), "shrink"),
          "a file with under 95% of the last load's cases is refused")
    check(refused(lambda: check_figures({**good, "cases": 7}, last=None, cases_read=1000), "cases"),
          "figures that disagree with the cases file are refused")
    # The issued counts (Nov 25 2026): optional (older files have none), and refused when malformed.
    run = {"day": "2026-11-25", "block": "IOE09", "issued": 30, "hours": 50.2, "per_day": 14,
           "by_form": {"I-485": 10, "I-765": 20}}
    check(check_figures({**good, "issued": [run]}, last=None, cases_read=1000) == "load", "issued runs load")
    check(check_figures(good, last=None, cases_read=1000) == "load", "a file without issued runs still loads")
    for bad, why in (({**run, "block": "IOE0912"}, "a block longer than five characters"),
                     ({**run, "hours": 0}, "a run with no hours"),
                     ({**run, "issued": -1}, "a negative count"),
                     ({**run, "by_form": {"I-485": 5}}, "forms that don't add up to the count"),
                     ({**run, "day": "Nov 25"}, "a day that isn't a date")):
        check(refused(lambda: check_figures({**good, "issued": [bad]}, last=None, cases_read=1000), "issued"),
              f"an issued run with {why} is refused")
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


def test_load_one_commit():
    """A load writes in one transaction a request (Nov 26 2026): each case committed alone ran about 150 a second on the
    server, and the first full load (1.47 million cases) stopped at its 30 minutes with 275,000 written."""
    import json
    import lib_db
    import ingest_uscis_sample
    from lib_sqlite_shim import SqliteTurso
    with tempfile.TemporaryDirectory() as folder:
        rows = "".join(f"IOE00000{i:05d},I-765,waiting,Case Was Received,2026-11-25,2026-11-20,2026-10,daily\n" for i in range(1200))
        with open(os.path.join(folder, "sample-cases.csv"), "w") as f:
            f.write(HEAD + rows)
        with open(os.path.join(folder, "sample-figures.json"), "w") as f:
            json.dump({"as_of": "2026-11-25", "cases": 1200, "by_month": {}, "by_block": {"IOE00000": {}}}, f)
        db = SqliteTurso()
        db.execute("CREATE TABLE IF NOT EXISTS perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER)")
        sent = []
        real = db.pipeline

        def spy(reqs, **kw):
            sent.append([r["stmt"]["sql"].split()[0] if r.get("type") == "execute" else r.get("type") for r in reqs])
            return real(reqs, **kw)

        db.pipeline = spy
        was = lib_db.Database
        lib_db.Database = lambda: db
        try:
            code = ingest_uscis_sample.load(folder, dry_run=False)
            writes = [r for r in sent if "INSERT" in r]
            check(code == 0 and len(writes) >= 3 and all(r[0] == "BEGIN" and r[-2] == "COMMIT" for r in writes),
                  f"a load writes its cases in one transaction a request ({len(writes)} requests)")
            check(int(db.scalar("SELECT count(*) FROM uscis_sample_cases")) == 1200, "every case is written")
            doc = json.loads(db.scalar("SELECT json FROM perm_docs WHERE key = 'uscis_sample_block_mix'") or "{}")
            check(doc.get("as_of") == "2026-11-25" and doc.get("by_block", {}).get("IOE00000") == {"I-765": [["waiting", "Case Was Received", 1200]]},
                  f"the load saves each block's counts for its card: {str(doc)[:120]}")
            again = ingest_uscis_sample.load(folder, dry_run=False)
            check(again == 0, "the same day again is a repeat, nothing written")
        finally:
            lib_db.Database = was


def test_rows_stay_small():
    """A night's file holds about 1.75 million cases (Nov 26 2026): read as dicts with their statements built in one
    list, the load reached 2.97 GB under its unit's 3 GB ceiling and crawled. Each row is a small tuple read by field
    name, its repeated words shared, and the statements are made as they're sent."""
    import sys as _sys
    rows = read_cases(cases_file(HEAD + A + B))
    row = rows["IOE0000000000"]
    check(isinstance(row, tuple) and row["grp"] == "rfe" and row["status"] == "Request for Evidence Was Sent",
          "a row is a tuple read by field name")
    check(_sys.getsizeof(row) <= 140, f"a row costs no more than a tuple of its eight fields: {_sys.getsizeof(row)} bytes")
    twice = read_cases(cases_file(HEAD + A + A.replace("EAC3512345678", "EAC3512345670")))
    a, b = twice["EAC3512345678"], twice["EAC3512345670"]
    check(a["status"] is b["status"] and a["form"] is b["form"], "a repeated status or form is one shared string")
    import ingest_uscis_sample
    gen = ingest_uscis_sample.case_statements(rows.values(), [], [])
    check(not isinstance(gen, (list, tuple)) and len(list(gen)) == 2, "the statements are made one at a time")


def test_block_mix():
    """Each online block's cases counted once a night for its page's card (Nov 26 2026): the outcome groups by group, the
    waiting cases by USCIS's own words, a paper filing's number in no block, and no receipt number in the counts. Every
    number here is from the IOE00000000 family or a fiscal year never issued (test-receipts-safe.test.ts)."""
    def case(r, grp, status):
        return {"receipt": r, "form": "I-485", "grp": grp, "status": status, "checked_on": "2026-11-26",
                "since_on": "2026-11-20", "month": "", "kind": "census"}
    cases = {c["receipt"]: c for c in [
        case("IOE0000000001", "approved", "Case Was Approved"),
        case("IOE0000000002", "approved", "New Card Is Being Produced"),
        case("IOE0000000003", "waiting", "Case Was Received and A Receipt Notice Was Sent"),
        case("IOE0000000004", "waiting", "Case Was Received and A Receipt Notice Was Sent"),
        case("IOE0000000005", "waiting", "Interview Was Scheduled"),
        case("IOE0000000006", "denied", "Case Was Denied"),
        case("EAC3512345678", "approved", "Case Was Approved"),
    ]}
    cases["IOE0000000007"] = {**case("IOE0000000007", "approved", "Case Was Approved"), "form": "I-765"}
    mix = block_mix(cases)
    check(set(mix) == {"IOE00000"}, f"one entry per online block, none for a paper number: {sorted(mix)}")
    check(set(mix["IOE00000"]) == {"I-485", "I-765"}, f"each block's cases form by form: {sorted(mix['IOE00000'])}")
    check(sorted(map(tuple, mix["IOE00000"]["I-485"])) == [("approved", "", 2), ("denied", "", 1),
                                                          ("waiting", "Case Was Received and A Receipt Notice Was Sent", 2),
                                                          ("waiting", "Interview Was Scheduled", 1)],
          f"outcomes by group, waiting by its words: {mix['IOE00000']['I-485']}")
    check(mix["IOE00000"]["I-765"] == [["approved", "", 1]], f"a form's own counts: {mix['IOE00000']['I-765']}")
    check(not any("IOE" in str(cell) for forms in mix.values() for rows in forms.values() for row in rows for cell in row),
          "no receipt number in a count")
    many = {f"IOE00000000{i:02d}": case(f"IOE00000000{i:02d}", "waiting", f"Step {i % 15}") for i in range(90)}
    rows = block_mix(many)["IOE00000"]["I-485"]
    named = [r for r in rows if r[1]]
    check(len(named) == 12 and rows[-1] == ["waiting", "", 18] and sum(r[2] for r in rows) == 90,
          f"a block keeps its 12 commonest waiting steps by name and counts the rest together: {rows[-2:]}")


def test_reached_by_month():
    row = lambda form, grp, month: {"form": form, "grp": grp, "status": "", "month": month}
    cases = {
        "IOE0000000001": row("I-485", "approved", "2026-03"),
        "IOE0000000002": row("I-485", "waiting", "2026-03"),
        "IOE0000000003": row("I-485", "denied", "2026-03"),
        "IOE0000000004": row("I-485", "rfe", "2026-04"),
        "IOE0000000005": row("I-485", "approved", "2026-11"),
        "LIN3590012345": row("I-485", "approved", "2026-03"),
        "IOE0000000006": row("N-400", "approved", "2026-03"),
    }
    got = reached_by_month(cases, "2026-11-26")
    mar = got["I-485"][0]
    check(mar["month"] == "2026-03" and mar["counted"] == 3 and abs(mar["decided"] - 2 / 3) < 0.001 and 0 < mar["low"] < mar["decided"] < mar["high"] < 1,
          f"a month's decided share counts every outcome but waiting and evidence requests, with its range: {mar}")
    check([r["month"] for r in got["I-485"]] == ["2026-03", "2026-04"] and got["I-485"][1]["decided"] == 0,
          "the month still filling and paper receipts are left out; an evidence request is still open")
    check(set(got) == {"I-485"}, "only the forms the list shows")


def main() -> int:
    for fn in (test_read_cases, test_block_of, test_check_figures, test_diff_cases, test_rows_stay_small, test_block_mix, test_reached_by_month, test_load_one_commit):
        fn()
    print(f"\n{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

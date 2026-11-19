"""The reported-cases merge (scripts/lib_reported_cases.py): one case per person, whichever sources reported it.

Every record here is made up. Run: python3 scripts/test_lib_reported_cases.py
"""
from __future__ import annotations

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib_reported_cases as rc  # noqa: E402


def rec(source: str, key: str, **f) -> dict:
    return {"source": source, "key": key, **f}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    def sources(case: dict) -> list[str]:
        return sorted(f"{m['source']}:{m['key']}" for m in case["sources"])

    # 1. Three dates agree: one case, and each source fills the other's gaps.
    sheet = rec("sfv-filers", "12", office="SFV", category="EB-2", i485_receipt="2026-06-12",
                biometrics="2026-07-08", transfer="2026-09-24")
    post = rec("reddit", "p1", office="SFV", i485_receipt="2026-06-12", transfer="2026-09-24",
               biometrics="2026-07-08", i485_decision="approved", i485_decided="2026-11-03")
    cases = rc.merge([sheet, post])
    check(len(cases) == 1, "three agreeing dates make one case")
    c = cases[0]
    check(sources(c) == ["reddit:p1", "sfv-filers:12"], "the case names both sources")
    check(c["i485_decided"] == "2026-11-03" and c["category"] == "EB-2", "each source filled the other's gaps")

    # 2. A batch: three people share a receipt day and a transfer day. A post with only those two can't be placed.
    batch = [rec("sfv-filers", str(i), office="SFV", i485_receipt="2026-06-12", transfer="2026-09-24",
                 biometrics=f"2026-07-0{i}") for i in (1, 3, 5)]
    vague = rec("reddit", "p2", office="SFV", i485_receipt="2026-06-12", transfer="2026-09-24")
    cases = rc.merge([*batch, vague])
    check(len(cases) == 4, "a post matching three people on two days stays its own case")
    lone = next(x for x in cases if sources(x) == ["reddit:p2"])
    check(len(lone["possible_dupes"]) == 3, "and is flagged as possibly one of the three")
    check(rc.count_people(cases) == 3, "counted once: it adds nothing the three don't hold")

    # 3. Two dates, one person holds them, and the post adds nothing new: the same case, marked likely.
    one = rec("sfv-filers", "7", office="SFV", i485_receipt="2026-05-02", transfer="2026-10-06", biometrics="2026-06-01")
    sub = rec("reddit", "p3", office="SFV", i485_receipt="2026-05-02", transfer="2026-10-06")
    cases = rc.merge([one, sub])
    check(len(cases) == 1, "a post holding nothing new that only one person matches joins that case")
    check(any(m["source"] == "reddit" and m["likely"] for m in cases[0]["sources"]), "marked as likely the same")

    # 3b. The same two dates with something new (an approval) is not absorbed: a wrong approval is worse than a repeat.
    more = rec("reddit", "p4", office="SFV", i485_receipt="2026-05-02", transfer="2026-10-06", i485_decided="2026-11-10",
               i485_decision="approved")
    cases = rc.merge([one, more])
    check(len(cases) == 2, "two matching dates never carry a new approval onto someone")
    check(rc.count_people(cases) == 2, "and both count until a third date ties them")

    # 4. A contradiction keeps them apart, however much else agrees.
    other_office = {**post, "key": "p5", "office": "LOS"}
    check(len(rc.merge([sheet, other_office])) == 2, "a different office keeps them apart")
    off_by_two = {**post, "key": "p6", "transfer": "2026-09-26"}
    check(len(rc.merge([sheet, off_by_two])) == 2, "a date two days apart is a contradiction")
    off_by_one = {**post, "key": "p7", "transfer": "2026-09-25"}
    check(len(rc.merge([sheet, off_by_one])) == 1, "a date one day apart agrees (typed by hand)")

    # 5. Months: agree with any day in them, never count toward a match, contradict another month.
    a = rec("visastats", "1", category="EB-2 NIW", priority_date="2025-03-14", i140_receipt="2025-03-14",
            i140_rfe_issued="2025-06-01", i140_decided="2025-09-02", i140_decision="approved", center="TSC")
    b = rec("telegram", "u1", category="EB-2 NIW", priority_date="2025-03", i140_receipt="2025-03-14",
            i140_rfe_issued="2025-06-01", i140_decided="2025-09-02", center="TSC", i140_rfe_answered="2025-07-15")
    cases = rc.merge([a, b])
    check(len(cases) == 1 and cases[0]["priority_date"] == "2025-03-14", "a month agrees, and the day wins")
    check(cases[0]["i140_rfe_answered"] == "2025-07-15", "the chat's RFE answer fills the tracker's gap")
    # One day typed into two columns is one piece of evidence: a self-petition's priority date is its filing day.
    twice = rec("telegram", "u3", category="EB-2 NIW", priority_date="2025-03-14", i140_receipt="2025-03-14",
                i140_decided="2025-09-02", i140_rfe_answered="2025-07-15")
    check(len(rc.merge([a, twice])) == 2, "the same day in two columns counts once toward a match")
    c_month = {**b, "key": "u2", "priority_date": "2025-04"}
    check(len(rc.merge([a, c_month])) == 2, "a different month contradicts")

    # 6. Categories: a refinement agrees and wins; another category contradicts.
    eb2 = rec("sfv-filers", "31", category="EB-2", office="SFV", i485_receipt="2026-01-02", biometrics="2026-02-03",
              transfer="2026-04-05")
    niw = {**eb2, "source": "reddit", "key": "p8", "category": "EB-2 NIW"}
    cases = rc.merge([eb2, niw])
    check(len(cases) == 1 and cases[0]["category"] == "EB-2 NIW", "EB-2 NIW refines EB-2")
    check(len(rc.merge([eb2, {**niw, "key": "p9", "category": "EB-3"}])) == 2, "EB-3 against EB-2 contradicts")

    # 7. Decisions: a decision beats pending; approved against denied contradicts.
    pend = {**eb2, "i485_decision": "pending"}
    appr = {**niw, "key": "p10", "i485_decision": "approved", "i485_decided": "2026-06-01"}
    cases = rc.merge([pend, appr])
    check(len(cases) == 1 and cases[0]["i485_decision"] == "approved", "an approval beats pending")
    deny = {**appr, "key": "p11", "i485_decision": "denied"}
    check(len(rc.merge([{**eb2, "i485_decision": "approved"}, deny])) == 2, "approved against denied contradicts")

    # 8. One source never merges two of its own rows. Rows that match in every value are one entry made twice:
    # both kept, linked, counted once. Rows that differ anywhere (a spouse, a batch-mate) count twice.
    twin = {**eb2, "key": "2"}
    cases = rc.merge([eb2, twin])
    check(len(cases) == 2, "two rows of one sheet stay two rows")
    check(rc.count_people(cases) == 1 and all(c["possible_dupes"] for c in cases), "an entry made twice counts once")
    spouse = {**eb2, "key": "3", "card": "2026-05-01"}
    cases = rc.merge([eb2, spouse])
    check(rc.count_people(cases) == 2 and all(c["possible_dupes"] for c in cases), "a near-twin is linked, counted twice")
    pair = [rec("sfv-filers", "41", office="SFV", i485_receipt="2026-01-02", transfer="2026-04-05"),
            rec("sfv-filers", "42", office="SFV", i485_receipt="2026-01-02", transfer="2026-04-05")]
    cases = rc.merge(pair)
    check(rc.count_people(cases) == 2 and not any(c["possible_dupes"] for c in cases),
          "two rows sharing only two days are batch-mates, not linked")

    # 9. One person's posts fold into one record, the later post winning a correction.
    early = rec("reddit", "c1", person="h1", as_of="2026-10-01", office="SFV", i485_receipt="2026-06-12",
                transfer="2026-09-24")
    later = rec("reddit", "c2", person="h1", as_of="2026-11-04", office="SFV", transfer="2026-09-23",
                i485_decision="approved", i485_decided="2026-11-03")
    cases = rc.merge([later, early])
    check(len(cases) == 1, "one person's two posts are one case")
    check(cases[0]["transfer"] == "2026-09-23" and cases[0]["i485_decided"] == "2026-11-03", "the later post wins")
    check(any(x["field"] == "transfer" for x in cases[0]["conflicts"]), "and the correction is noted")

    # 10. A private timeline only stops a repeat: none of its own dates show.
    private = rec("timeline", "t1", checked=True, shows=False, office="SFV", i485_receipt="2026-06-12",
                  biometrics="2026-07-08", transfer="2026-09-24", card="2026-11-12")
    cases = rc.merge([private, sheet])
    check(len(cases) == 1 and cases[0]["shows"], "a private timeline merges with the sheet's row, which still shows")
    check(cases[0].get("card") is None, "and the timeline's own card day stays private")
    alone = rc.merge([private])
    check(len(alone) == 1 and not alone[0]["shows"], "a private timeline alone doesn't show")

    # 11. A checked source wins a one-day difference.
    checked = rec("timeline", "t2", checked=True, office="SFV", i485_receipt="2026-06-12", biometrics="2026-07-08",
                  transfer="2026-09-25")
    cases = rc.merge([sheet, checked])
    check(len(cases) == 1 and cases[0]["transfer"] == "2026-09-25" and cases[0]["checked"], "the checked day wins")

    # 12. Countries: a specific country agrees with "rest of world" unless it has its own line.
    ca = {**post, "key": "p12", "chargeability": "Canada"}
    row = {**sheet, "chargeability": "ROW"}
    cases = rc.merge([row, ca])
    check(len(cases) == 1 and cases[0]["chargeability"] == "Canada", "Canada refines rest of world")
    check(len(rc.merge([row, {**ca, "key": "p13", "chargeability": "India"}])) == 2, "India isn't rest of world")
    india_sheet = {**sheet, "chargeability": "India"}
    check(len(rc.merge([india_sheet, {**ca, "key": "p15", "chargeability": "ROW"}])) == 2,
          "rest of world isn't India, whichever side says it")

    # 13. A record matching two cases equally well joins neither.
    s1 = rec("sfv-filers", "21", office="SFV", i485_receipt="2026-03-01", biometrics="2026-04-01", transfer="2026-06-01")
    s2 = rec("sfv-filers", "22", office="SFV", i485_receipt="2026-03-01", biometrics="2026-04-01", transfer="2026-06-01")
    tie = rec("reddit", "p14", office="SFV", i485_receipt="2026-03-01", biometrics="2026-04-01", transfer="2026-06-01",
              card="2026-07-01")
    cases = rc.merge([s1, s2, tie])
    check(len(cases) == 3, "a tie joins neither case")
    check(len(next(x for x in cases if sources(x) == ["reddit:p14"])["possible_dupes"]) == 2, "and names both")

    # 14. The same answer whatever order the records arrive in.
    pool = [sheet, post, *batch, vague, one, sub, a, b, eb2, niw, s1, s2, tie, early, later]
    want = sorted(tuple(sources(x)) for x in rc.merge(pool))
    stable = True
    for seed in range(8):
        shuffled = pool[:]
        random.Random(seed).shuffle(shuffled)
        stable &= sorted(tuple(sources(x)) for x in rc.merge(shuffled)) == want
    check(stable, "the same cases from any order")
    ids = [x["id"] for x in rc.merge(pool)]
    check(len(ids) == len(set(ids)), "every case has its own id")

    # 15. Bad input is refused, never guessed.
    for bad, what in ((rec("reddit", "x", transfer="9/24/2026"), "a date not in ISO form"),
                      (rec("reddit", "x", nickname="z"), "a field the merge doesn't know"),
                      ({"key": "x"}, "a record with no source"),
                      (rec("reddit", "x", transfer="2026-02-30"), "a day that doesn't exist")):
        try:
            rc.merge([bad])
            check(False, f"refuses {what}")
        except ValueError:
            check(True, f"refuses {what}")

    try:
        rc.merge([rec("reddit", "x"), rec("reddit", "x")])
        check(False, "refuses two records with one key")
    except ValueError:
        check(True, "refuses two records with one key")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

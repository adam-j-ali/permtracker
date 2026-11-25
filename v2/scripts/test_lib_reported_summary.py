"""The reported-case figures (scripts/lib_reported_summary.py): windows, the line by month, who's waiting, the I-140s.

Run: python3 scripts/test_lib_reported_summary.py
"""
from __future__ import annotations

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib_reported_summary as rs  # noqa: E402

TODAY = dt.date(2026, 11, 19)


def ago(days: int) -> str:
    return (TODAY - dt.timedelta(days=days)).isoformat()


def i485(filed_ago: int, took: int, **kw) -> dict:
    return {"i485_receipt": ago(filed_ago), "i485_decided": ago(filed_ago - took), "i485_decision": "approved",
            "as_of": ago(filed_ago - took), **kw}


def step(sid: str) -> dict:
    return next(s for s in rs.STEPS if s["id"] == sid)


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    # The window: 6 months once it holds PREFER cases, else 12, else nothing; old cases never outvote new ones.
    old = [i485(1500, 30) for _ in range(200)]                 # decided four years ago, fast
    recent = [i485(200 + k, 150) for k in range(25)]           # decided in the last 6 months, slow
    f = rs.step_figure(old + recent, step("i485-gc"), TODAY)
    check(f["windowDays"] == rs.RECENT_DAYS and f["n"] == 25 and f["median"] == 150 and f["allTime"] == 225,
          "a step with 25 cases in 6 months uses those, never the 200 old fast ones")
    few = [i485(300 + k, 120) for k in range(8)]                # decided 6 to 12 months ago
    f = rs.step_figure(old + few, step("i485-gc"), TODAY)
    check(f["windowDays"] == rs.WIDE_DAYS and f["n"] == 8 and f["median"] == 120,
          "too few in 6 months widens to 12, and says so")
    f = rs.step_figure(old + few[:3], step("i485-gc"), TODAY)
    check(f["windowDays"] is None and f["median"] is None and f["n"] == 3, "under the floor: no figure, the count kept")

    # The direction: the last 6 months against the 6 before, each with PREFER cases.
    before = [i485(400 + k, 200) for k in range(25)]           # decided 200 to 225 days ago
    f = rs.step_figure(recent + before, step("i485-gc"), TODAY)
    check(f["before"] == {"median": 200, "n": 25} and f["median"] == 150, "faster than the 6 months before, both counted")

    # The line by month: 12 months, oldest first, a month under the floor a gap, never a zero.
    months = f["months"]
    check(len(months) == 12 and months[-1]["month"] == "2026-11" and months[0]["month"] == "2025-12",
          "twelve months ending this one")
    check(all(m["median"] is None or m["n"] >= rs.FLOOR for m in months) and any(m["median"] is None for m in months),
          "a month under the floor has no median")

    # A decision step counts only approvals; a denial's days don't read as a green card's.
    denied = [dict(i485(100 + k, 10), i485_decision="denied") for k in range(30)]   # decided inside the 6 months
    f = rs.step_figure(recent + denied, step("i485-gc"), TODAY)
    check(f["n"] == 25 and f["median"] == 150, "denials leave the green card step")

    # Premium and regular apart; premium added later can't be timed and is left out.
    i140 = lambda p, took: {"i140_receipt": ago(100 + took), "i140_decided": ago(100), "i140_decision": "approved",  # noqa: E731
                            "premium": p}
    cases = [i140("with filing", 12)] * 20 + [i140("none", 180)] * 20 + [i140("after filing", 60)] * 20
    check(rs.step_figure(cases, step("i140-premium"), TODAY)["median"] == 12
          and rs.step_figure(cases, step("i140-regular"), TODAY)["median"] == 180
          and rs.step_figure(cases, step("i140-premium"), TODAY)["n"] == 20, "premium and regular kept apart")

    # A month-only date counts, as the 15th, only on a span of 120 days or more, where half a month is a small part of
    # the wait (Nov 20 2026: every month-only report, most of Reddit's and every consulate report's NVC month, was
    # dropped). A short step keeps needing both days.
    month_cases = [{"nvc_complete": "2026-01", "consular_interview": "2026-06-20", "consular_outcome": "issued",
                    "visa_issued": "2026-06-25"}]
    got = rs.spans(month_cases, step("nvc-interview"))
    check(got and got[0][1] == (dt.date(2026, 6, 20) - dt.date(2026, 1, 15)).days, f"a month-only start counts on a long step: {got}")
    short = [{"i485_receipt": "2026-05", "biometrics": "2026-06-10"}]
    check(rs.spans(short, step("i485-bio")) == [], "and never on a short one")
    both = [{"i485_receipt": "2025-06", "i485_decided": "2026-05", "i485_decision": "approved"}]
    check(rs.spans(both, step("i485-gc"))[0][1] == (dt.date(2026, 5, 15) - dt.date(2025, 6, 15)).days,
          "two month-only ends count from the 15th to the 15th")

    # A span past ten years, or a negative one, is a typo.
    bad = [{"i485_receipt": ago(5000), "i485_decided": ago(10), "i485_decision": "approved"},
           {"i485_receipt": ago(10), "i485_decided": ago(50), "i485_decision": "approved"}]
    check(rs.spans(bad, step("i485-gc")) == [], "typos never count")

    # Who's waiting: heard from within a year, at the furthest step, denials out, small lines folded.
    people = ([{"i485_receipt": ago(100), "as_of": ago(20), "category": "EB-2", "chargeability": "India"}] * 6
              + [{"i485_receipt": ago(900), "as_of": ago(800), "category": "EB-2", "chargeability": "India"}] * 50
              + [{"i140_receipt": ago(60), "as_of": ago(10), "category": "EB-3", "chargeability": "ROW"}] * 2
              + [{"i485_receipt": ago(100), "i485_decided": ago(5), "i485_decision": "denied", "as_of": ago(5)}] * 3
              + [{"perm_filed": ago(400), "as_of": ago(30)}] * 4)
    w = rs.waiting(people, TODAY)
    stages = {s["id"]: s["count"] for s in w["byStage"]}
    check(w["heard"] == 12 and stages["i485"] == 6 and stages["i140"] == 2 and stages["perm"] == 4,
          "only people heard from within a year count, a denial leaves")
    check(len(w["lines"]) == 1 and w["lines"][0]["country"] == "India" and w["lines"][0]["total"] == 6
          and w["unlisted"] == 6, "a line under five people folds into the unlisted count")
    # The step before PERM counts, and the people who gave no category or country are counted by step too, so a
    # column never reads all zeros while those people sit in one line under the table (Nov 20 2026).
    pre = people + [{"pwd_filed": ago(90), "as_of": ago(15)}] * 7
    w2 = rs.waiting(pre, TODAY)
    ids = [s_["id"] for s_ in w2["byStage"]]
    check(ids[0] == "pwd" and w2["byStage"][0]["count"] == 7, f"the wage request is its own first step: {w2['byStage'][:2]}")
    by = dict(zip(ids, w2["unlistedCounts"]))
    check(by["pwd"] == 7 and by["perm"] is None and by["i140"] is None and by["i485"] == 0,
          f"the unlisted people by step, under five shown as under five: {by}")
    check(sum(x or 0 for x in w2["unlistedCounts"]) <= w2["unlisted"], "the by-step counts never add past the unlisted total")
    check(rs.stage({"pwd_issued": ago(30)}) == "pwd" and rs.stage({"pwd_filed": ago(90), "perm_filed": ago(10)}) == "perm",
          "a wage request is the step until PERM is filed")
    check(rs.stage({"post": "mumbai", "nvc_complete": ago(30)}) == "consular"
          and rs.stage({"post": "mumbai", "visa_issued": ago(3)}) == "done", "the consulate has its own stage")

    # Every country but the four with their own bulletin line is Rest of world (Nov 20 2026: Canada, Nigeria and Iran
    # counted as "no country"); a placeholder says nothing; EB-3 other workers has its own line.
    check([rs._country(v) for v in ("India", "ROW", "Canada", "nigeria", "Iran", "Brazil")]
          == ["India", "Rest of world", "Rest of world", "Rest of world", "Rest of world", "Rest of world"],
          "any other country is Rest of world")
    check([rs._country(v) for v in ("", None, "N/A", "-", "unknown", "?", "na")] == [None] * 7, "a placeholder is no country")
    check([rs._country(v) for v in ("IN", "PRC", "Mainland China", "Taiwan", "Hong Kong", "PH", "Indian")]
          == ["India", "China (mainland born)", "China (mainland born)", "Rest of world", "Rest of world", "Philippines", "India"],
          "the four's other spellings keep their line; Taiwan and Hong Kong are Rest of world")
    check(rs.CATEGORY_LABELS.get("EB-3 EW") == "EB-3 other workers", "EB-3 other workers is a line")

    # The I-140s by category and premium, over the window.
    nv = [{"category": "EB-2 NIW", "premium": "none", "i140_receipt": ago(300), "i140_decided": ago(30 + k),
           "i140_decision": "approved" if k % 5 else "denied", "i140_rfe": "rfe" if k % 2 else "none"} for k in range(25)]
    nv += [{"category": "EB-2 NIW", "premium": "none", "i140_receipt": ago(3000), "i140_decided": ago(2990),
            "i140_decision": "approved"}] * 100
    fig = next(x for x in rs.i140_figures(nv, TODAY) if x["category"] == "EB-2 NIW" and x["premium"] == "none")
    check(fig["windowDays"] == rs.RECENT_DAYS and fig["decided"] == 25 and fig["decidedAllTime"] == 125
          and abs(fig["approvedShare"] - 0.8) < 1e-9 and fig["medianDays"] == 270-12, "the I-140s over the window, old ones out")

    # An office gets its own summary only with enough cases.
    office = [dict(c, office="SFV") for c in recent] + [dict(c, office="NYC") for c in recent[:4]]
    offices = rs.office_summaries(office, TODAY)
    check(list(offices) == ["SFV"] and {s["id"] for s in offices["SFV"]["steps"]} == set(rs.OFFICE_STEPS),
          "an office with 25 cases gets a summary, one with 4 doesn't")
    # The office pages are about employment-based I-485s: family cases reported there count nowhere on them.
    family = [dict(c, office="SFV", category="Family") for c in recent]
    fam = rs.office_summaries(office + family, TODAY)
    check(fam["SFV"]["cases"] == offices["SFV"]["cases"] and "SFV" not in rs.office_summaries(family, TODAY),
          f"a family case counts toward no office: {fam['SFV']['cases']} vs {offices['SFV']['cases']}")

    # Every group has its steps, the ids are unique, and every field a step reads is one the merge carries.
    import lib_reported_cases as rc
    check({x["group"] for x in rs.STEPS} == set(rs.GROUPS) and len({x["id"] for x in rs.STEPS}) == len(rs.STEPS)
          and all(x["from"] in rc.FIELDS and x["to"] in rc.FIELDS for x in rs.STEPS),
          "every step reads fields the merge carries, in a known group")
    posts = [dict(nvc_complete=ago(100 + k), consular_interview=ago(40 + k), post="mumbai") for k in range(25)]
    keys = set(rs.all_summaries(posts + office, TODAY))
    check(keys == {"all", "office:SFV", "post:mumbai"}, "one summary for all, each busy office and each busy consulate")

    # A self-petition's priority date is its I-140's filing day; an employer's petition's isn't.
    sp = rs.prepared([{"category": "EB-1A", "priority_date": ago(90), "i140_decided": ago(10)},
                      {"category": "EB-2", "priority_date": ago(900), "i140_decided": ago(10)}])
    check(sp[0]["i140_receipt"] == ago(90) and "i140_receipt" not in sp[1], "a self-petition's priority date is its filing day")

    # The week's approvals: the last 7 days, today included, no count under 5, a denial never an approval.
    wk = rs.week([{"ead": ago(k)} for k in range(7)] + [{"ead": ago(7)}] * 9
                 + [{"i485_decided": ago(2), "i485_decision": "denied"}] * 9, TODAY)
    counts = {x["id"]: x["count"] for x in wk["steps"]}
    check(wk["from"] == ago(6) and counts["eadOn"] == 7 and counts["greenCardOn"] is None,
          "a week is the last 7 days; a count under 5 and every denial stay out")

    h = rs.headline(recent + denied, TODAY)
    check(h["cases"] == 55 and h["greenCards30"] == 0, "the headline counts cases and the month's green cards")
    # Nov 25 2026: the NVC-to-interview step for employment cases only, which the planner reads.
    def consular(cat: str, took: int) -> dict:
        return {"nvc_complete": ago(100 + took), "consular_interview": ago(100), "category": cat, "as_of": ago(100)}
    mixed = [consular("EB-2", 60) for _ in range(6)] + [consular("F2A", 200) for _ in range(20)] + [consular("", 300)]
    eb = rs.step_figure(mixed, step("nvc-interview-eb"), TODAY)
    every = rs.step_figure(mixed, step("nvc-interview"), TODAY)
    check(eb["n"] == 6 and eb["median"] == 60, f"the employment step counts EB cases only: {eb['n']} at {eb['median']} days")
    check(every["n"] == 27, f"the plain step still counts every case: {every['n']}")
    check(step("nvc-interview-eb")["id"] in rs.POST_STEPS, "it's a consulate step, so a consulate's own summary carries it")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

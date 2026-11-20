"""The model reader (scripts/lib_post_model.py): what it keeps from a model's answer, and what it refuses.

No model is called: a stand-in returns fixed answers. Every post here is made up.
Run: python3 scripts/test_lib_post_model.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib_post_dates as pd  # noqa: E402
import lib_post_model as pm  # noqa: E402


def post(i: str, text: str, posted: str = "2024-01-22", kind: str = "mixed") -> dict:
    return {"id": i, "posted": posted, "kind": kind, "text": text}


def answer(i: str, steps: list[tuple[str, str | None]], own: bool = True, category: str | None = None) -> dict:
    return {"id": i, "own_case": own, "steps": [{"step": s, "date": d} for s, d in steps], "category": category}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    p = post("a", "Took 9 days in my case. 140 filed on 12/4 at NSC, approved on 12/12, receipt notice on 12/13")
    r = pm.from_answer(answer("a", [("i140_filed", "2023-12-04"), ("i140_approved", "2023-12-12")]), p)
    check(r == {"i140_receipt": "2023-12-04", "i140_decided": "2023-12-12", "i140_decision": "approved"},
          f"a free-form timeline, dates the post writes: {r}")
    check(pm.from_answer(answer("a", [("i140_filed", "2023-12-04"), ("i140_approved", "2023-12-19")]), p) is None,
          "a date the post never writes drops the whole answer")
    check(pm.from_answer(answer("a", [("i140_approved", "2023-12-12")], own=False), p) is None,
          "not the poster's own case: nothing")
    r = pm.from_answer(answer("a", [("i140_approved", "2023-12-12")]), p)
    check(r == {"i140_decided": "2023-12-12", "i140_decision": "approved"}, f"one date with its decision counts: {r}")
    late = post("a2", p["text"], posted="2024-06-01")
    check(pm.from_answer(answer("a2", [("i140_approved", "2023-12-12")]), late) is None,
          "the shared checks still apply: a lone decision day months before the post is dropped")
    p2 = post("b", "My i140 was approved today with PP", posted="2025-02-25")
    r = pm.from_answer(answer("b", [("i140_approved", "2025-02-25")]), p2)
    check(r == {"i140_decided": "2025-02-25", "i140_decision": "approved"}, f"'today' is the post's day: {r}")
    p3 = post("c", "PD Aug 2023, perm certified 11/18/2024, i140 filed 12/02/2024", posted="2024-12-03", kind="perm")
    r = pm.from_answer(answer("c", [("perm_filed", "2023-08"), ("perm_approved", "2024-11-18"),
                                    ("i140_filed", "2024-12-02")], category="EB-2"), p3)
    check(r == {"perm_filed": "2023-08", "perm_decided": "2024-11-18", "perm_decision": "approved",
                "i140_receipt": "2024-12-02", "category": "EB-2"}, f"a month alone, and a category: {r}")
    check(pm.from_answer(answer("c", [("perm_approved", "2024-11-18"), ("perm_filed", "2024-12-02")]), p3) is None,
          "steps out of order: dropped")
    check(pm.from_answer(answer("c", [("perm_approved", "2024-11-18"), ("perm_denied", "2024-11-18")]), p3) is None,
          "approved and denied at once: dropped")
    check(pm.from_answer(answer("c", [("made_up_step", "2024-11-18")]), p3) is None, "a step it doesn't know: dropped")
    p4 = post("d", "PD: 06/13/23 RD: 10/31/25 01/01/26 - Derivative EAD approval 03/11/26 - Principal EAD approval "
                   "03/20/26 - I485 Approval", posted="2026-04-10")
    r = pm.from_answer(answer("d", [("priority_date", "2023-06-13"), ("i485_filed", "2025-10-31"),
                                    ("ead_approved", "2026-01-01"), ("ead_approved", "2026-03-11"),
                                    ("i485_approved", "2026-03-20")], category="EB-3"), p4)
    check(r == {"priority_date": "2023-06-13", "i485_receipt": "2025-10-31", "i485_decided": "2026-03-20",
                "i485_decision": "approved", "category": "EB-3"},
          f"two days for one step leave that step out, the rest stands: {r}")
    p5 = post("e", "Nov 22 PD, RD Oct 17, 2023. San Diego FO on March 19. Current since March", posted="2024-04-01")
    r = pm.from_answer(answer("e", [("i485_filed", "2023-10-17"), ("transferred", "2024-03-19")]), p5)
    check(r == {"i485_receipt": "2023-10-17", "transfer": "2024-03-19"}, f"'March 19' is a day the post writes: {r}")
    p6 = post("f", "Today my PERM certified. My PD is October, 5 2023.", posted="2025-03-04")
    r = pm.from_answer(answer("f", [("perm_approved", "2025-03-04"), ("priority_date", "2023-10-05")]), p6)
    check(r == {"perm_decided": "2025-03-04", "perm_decision": "approved", "priority_date": "2023-10-05"},
          f"'October, 5 2023' with its comma: {r}")
    check(pm.from_answer(answer("c", [("perm_approved", "11/18/2024")]), p3) is None, "a date not written ISO: dropped")
    r = pm.from_answer(answer("c", [("perm_filed", "2023-08"), ("perm_approved", None)], category="EB-9"), p3)
    check(r == {"perm_filed": "2023-08", "perm_decision": "approved"},
          f"a decision with no day counts beside a date, and a category it doesn't know is left out: {r}")

    # Days written without a year.
    p7 = post("g", "PERM approved not sure when (notified by employer) PD: 7/17 Good luck everyone", posted="2024-08-21",
              kind="perm")
    check(pm.from_answer(answer("g", [("perm_filed", "2024-07-17"), ("perm_approved", None)]), p7) is None,
          "a PERM filing day without a year is never placed: 'PD: 7/17' in an August 2024 approval is 2023")
    p8 = post("h", "EB3 RD 04/22 Bio 06/01, 2 fta0 after bio", posted="2026-09-03")
    r = pm.from_answer(answer("h", [("i485_filed", "2026-04-22"), ("biometrics", "2026-06-01")], category="EB-3"), p8)
    check(r == {"i485_receipt": "2026-04-22", "biometrics": "2026-06-01", "category": "EB-3"},
          f"a receipt and biometrics without a year take the most recent such days: {r}")
    check(pm.from_answer(answer("h", [("i485_filed", "2025-04-22"), ("biometrics", "2026-06-01")]), p8) is None,
          "a year further back than the most recent such day is left out, and one date is too little")
    check(pm._placed("2026-04-22", "i485_receipt", dt.date(2026, 9, 3)) and
          not pm._placed("2025-04-22", "i485_receipt", dt.date(2026, 9, 3)) and
          not pm._placed("2026-12-05", "biometrics", dt.date(2026, 11, 20)) and
          pm._placed("2025-12-05", "biometrics", dt.date(2026, 11, 20)) and
          pm._placed("2024-02-29", "ead", dt.date(2024, 3, 1)) and
          not pm._placed("2024-07-17", "perm_filed", dt.date(2024, 8, 21)),
          "the most recent such day on or before the post, a leap day too, and never a PERM filing day")
    p9 = post("i", "Filled on Nov 26th, Approved Today. My receipt number starts with IOE", posted="2024-12-03")
    check(pm.from_answer(answer("i", [("i485_filed", "2024-11-26"), ("i485_approved", "2024-12-03")]), p9) is None,
          "an I-485 decided a week after its receipt is a premium I-140 misread: both I-485 dates go")

    # A saved answer is checked again with today's checks.
    check(pm.recheck({"i485_receipt": "2024-11-26", "i485_decided": "2024-12-03", "i485_decision": "approved"}, p9) is None,
          "an answer saved before a check existed is held to it on the next run")
    r = pm.recheck({"i485_receipt": "2026-04-22", "biometrics": "2026-06-01", "category": "EB-3"}, p8)
    check(r == {"i485_receipt": "2026-04-22", "biometrics": "2026-06-01", "category": "EB-3"}, f"a sound one stands: {r}")
    check(pm.recheck(None, p8) is None and pm.recheck({}, p8) is None, "nothing saved gives nothing")

    # The written dates themselves.
    w = pd.written_dates("filed 02/03/2024, approved 6/1", dt.date(2024, 6, 2))
    check({"2024-02-03", "2024-03-02", "2024-06-01", "2024-01-06", "2024-02", "2024-06"} <= w,
          "a day that reads both ways gives both, and a day without a year gives the nearby years")
    check("2025-06-01" in w and "2023-06-01" in w, "a day without a year gives the years either side too")
    check(pd.written_dates("approved today", dt.date(2024, 6, 2)) >= {"2024-06-02"}, "'today'")
    check(pd.written_dates("approved yesterday", dt.date(2024, 6, 2)) >= {"2024-06-01"}, "'yesterday'")
    check("2024-06-02" not in pd.written_dates("approved in June", dt.date(2024, 6, 2)), "no day it doesn't write")

    # Batches, and posts a reply leaves out.
    calls = []

    def stand_in(prompt: str) -> dict:
        posts = json.loads(prompt)
        calls.append(len(posts))
        return {"posts": [answer(x["id"], [("i140_filed", "2023-12-04"), ("i140_approved", "2023-12-12")])
                          for x in posts if x["id"] != "skip"]}

    many = [post(str(i), p["text"]) for i in range(pm.BATCH + 5)] + [post("skip", p["text"])]
    got = pm.read_posts(many, runner=stand_in)
    check(calls == [pm.BATCH, 6], f"asked in batches of {pm.BATCH}: {calls}")
    check("skip" not in got and len(got) == pm.BATCH + 5, "a post the reply leaves out is asked again next time")
    check(all(v and v["i140_decided"] == "2023-12-12" for v in got.values()), "each answered post read")
    saved = {}
    flaky_calls = []

    def flaky(prompt: str) -> dict:
        flaky_calls.append(1)
        if len(flaky_calls) == 1:
            raise RuntimeError("model unavailable")
        return stand_in(prompt)

    try:
        pm.read_posts(many, runner=flaky, on_batch=saved.update)
        check(False, "a failed batch turns the run red")
    except pm.ModelBatchesFailed as e:
        check("1 of 2 batches failed" in str(e) and len(e.read) == 5 and len(saved) == 5,
              f"a failed batch turns the run red, and the other batch's answers are kept: {e}")
    check(pm.worth_asking("approved on 12/12") and not pm.worth_asking("thanks all") and not pm.worth_asking("12/12"),
          "only a post with a date and a step is worth asking about")
    long = post("long", "x" * 5000)
    check(len(json.loads(pm.prompt_for([long]))[0]["text"]) == pm.MAX_TEXT, "a very long post is cut to its opening")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

"""Figures over every case people reported (the merged list, scripts/lib_reported_cases.py), worked out once a build
and stored for the pages: how long each step took, a line by month, who's waiting, and the I-140s by category and
premium. One summary for every source together, and one for each USCIS office with enough cases.

A step's days count over the cases that FINISHED it recently: the last 6 months when that holds at least PREFER cases,
else the last 12 months, and no figure under FLOOR cases. An all-time median would mostly describe past years (on Nov
19 2026 the I-140's was 21 days all time and 148 over the last 6 months). Each figure says its window.

Who's waiting counts the people heard from in the last year, at the furthest step they reported: a post from 2023
saying "I-485 filed", with nothing since, isn't someone still waiting. A private timeline counts in every figure (the
share form promises that) and is never listed.
"""
from __future__ import annotations

import datetime as dt
import statistics

FLOOR = 5            # no figure from fewer cases (the board's METRIC_MIN_N)
PREFER = 20          # the 6-month window is used once it holds this many
RECENT_DAYS = 183
WIDE_DAYS = 365
HEARD_DAYS = 365     # who's waiting: heard from within a year
MAX_DAYS = 3650      # a span past ten years is a typo
MONTHS = 12          # the line by month
OFFICE_FLOOR = FLOOR  # an office or a consulate gets its own summary from this many cases (each step keeps its own floor)

# Every step people report, in the order a case goes, each in its group (the page that shows it). The ids match the
# board's metrics where the step is the same (convex/lib/communityTimeline.ts METRICS), so one component draws both.
def _s(sid, label, a, b, group, premium=None):
    return {"id": sid, "label": label, "from": a, "to": b, "group": group, "premium": premium, "verified": False}


STEPS = (
    _s("lca-h1b", "LCA certified to H-1B filed", "lca_certified", "h1b_filed", "h1b"),
    _s("h1b", "H-1B filed to decided", "h1b_filed", "h1b_decided", "h1b"),
    _s("pwd", "Wage request filed to the wage issued", "pwd_filed", "pwd_issued", "pwd"),
    _s("pwd-to-perm", "Wage issued to PERM filed", "pwd_issued", "perm_filed", "pwd"),
    _s("perm-audit", "PERM filed to an audit", "perm_filed", "perm_audit", "perm"),
    _s("perm", "PERM filed to decided", "perm_filed", "perm_decided", "perm"),
    _s("cert-to-i140", "PERM certified to I-140 filed", "perm_decided", "i140_receipt", "i140"),
    _s("i140-premium", "I-140 filed to decided, premium", "i140_receipt", "i140_decided", "i140", "premium"),
    _s("i140-regular", "I-140 filed to decided, regular", "i140_receipt", "i140_decided", "i140", "regular"),
    _s("i140-rfe", "I-140 RFE issued to answered", "i140_rfe_issued", "i140_rfe_answered", "i140"),
    _s("i485-bio", "I-485 filed to biometrics", "i485_receipt", "biometrics", "i485"),
    _s("i485-ead", "I-485 filed to work permit", "i485_receipt", "ead", "i485"),
    _s("i485-ap", "I-485 filed to travel document", "i485_receipt", "ap", "i485"),
    _s("i485-office", "I-485 filed to the move to a field office", "i485_receipt", "transfer", "i485"),
    _s("i485-interview", "I-485 filed to interview", "i485_receipt", "interview", "i485"),
    _s("i485-gc", "I-485 filed to green card", "i485_receipt", "i485_decided", "i485"),
    _s("office-gc", "Move to a field office to green card", "transfer", "i485_decided", "i485"),
    _s("interview-gc", "Interview to green card", "interview", "i485_decided", "i485"),
    _s("gc-card", "Green card approved to the card in the mail", "i485_decided", "card", "i485"),
    _s("nvc-interview", "NVC documents accepted to the consulate interview", "nvc_complete", "consular_interview", "consular"),
    _s("consular-visa", "Consulate interview to visa issued", "consular_interview", "visa_issued", "consular"),
)
GROUPS = ("h1b", "pwd", "perm", "i140", "i485", "consular")
# The steps an office's own summary carries (the I-485's), and a consulate's (its own two).
OFFICE_STEPS = tuple(x["id"] for x in STEPS if x["group"] == "i485")
POST_STEPS = tuple(x["id"] for x in STEPS if x["group"] == "consular")
# A step that ends in a decision counts only an approval.
APPROVAL = {"i485_decided": "i485_decision", "i140_decided": "i140_decision", "perm_decided": "perm_decision"}

# The board's stages and labels (convex/lib/communityTimeline.ts WAITING_STAGES), plus the consulate's.
STAGES = (
    ("perm", "PERM pending"),
    ("certified", "PERM certified, I-140 not filed"),
    ("i140", "I-140 pending"),
    ("approved", "I-140 approved, waiting on the bulletin"),
    ("i485", "I-485 pending"),
    ("consular", "At the NVC or the consulate"),
    ("done", "Green card received"),
)
CATEGORY_LABELS = {"EB-1": "EB-1", "EB-1A": "EB-1", "EB-1B": "EB-1", "EB-2": "EB-2", "EB-2 NIW": "EB-2 with a national interest waiver",
                   "EB-3": "EB-3", "Family": "Family"}
COUNTRY_LABELS = {"row": "Rest of world", "rest of world": "Rest of world", "india": "India", "china": "China (mainland born)",
                  "mexico": "Mexico", "philippines": "Philippines"}
MIN_CELL = 5         # a category and country line shows from this many people (the board's WAITING_MIN_CELL)

I140_CATEGORIES = ("EB-2 NIW", "EB-1A", "EB-1B", "EB-1", "EB-2", "EB-3")
# A petition people file for themselves: its priority date is the day its I-140 was filed.
SELF_PETITIONS = ("EB-2 NIW", "EB-1A")
I140_PREMIUMS = ("with filing", "after filing", "yes", "none", "not given")


def _day(v) -> dt.date | None:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _approved(c: dict, end: str) -> bool:
    field = APPROVAL.get(end)
    if field is None:
        return True
    return c.get(field) in (None, "approved")


def _premium(c: dict) -> str | None:
    """'premium' when the clock ran premium from filing, 'regular' when there was none, None when it can't be told:
    premium added later starts its own clock on a day the merge doesn't carry."""
    p = c.get("premium")
    return "premium" if p in ("yes", "with filing") else "regular" if p == "none" else None


def spans(cases: list[dict], step: dict) -> list[tuple[dt.date, int]]:
    """(the day the step finished, its days) for every case that holds both ends."""
    a, b, prem = step["from"], step["to"], step["premium"]
    out = []
    for c in cases:
        start, end = _day(c.get(a)), _day(c.get(b))
        if not start or not end or not _approved(c, b):
            continue
        if prem and _premium(c) != prem:
            continue
        d = (end - start).days
        if 0 <= d <= MAX_DAYS:
            out.append((end, d))
    return out


def _quartiles(xs: list[int]) -> tuple[int, int, int]:
    s = sorted(xs)
    q = statistics.quantiles(s, n=4, method="inclusive") if len(s) > 1 else [s[0], s[0], s[0]]
    return round(q[0]), round(statistics.median(s)), round(q[2])


def _month_key(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def months_back(today: dt.date, n: int = MONTHS) -> list[str]:
    """The last n months, oldest first, this month last."""
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[::-1]


def step_figure(cases: list[dict], step: dict, today: dt.date) -> dict:
    """One step's figure: its window, count, quartiles, the 6 months before for a direction, and the line by month."""
    done = [(e, d) for e, d in spans(cases, step) if e <= today]
    recent = [d for e, d in done if (today - e).days < RECENT_DAYS]
    wide = [d for e, d in done if (today - e).days < WIDE_DAYS]
    if len(recent) >= PREFER:
        window, vals = RECENT_DAYS, recent
    elif len(wide) >= FLOOR:
        window, vals = WIDE_DAYS, wide
    else:
        window, vals = None, []
    fig = {"id": step["id"], "label": step["label"], "group": step["group"], "verified": step["verified"],
           "n": len(vals) if window else len(wide),
           "windowDays": window, "median": None, "p25": None, "p75": None, "before": None, "allTime": len(done)}
    if window:
        fig["p25"], fig["median"], fig["p75"] = _quartiles(vals)
    # The direction: the last 6 months against the 6 before, each with PREFER cases.
    before = [d for e, d in done if RECENT_DAYS <= (today - e).days < 2 * RECENT_DAYS]
    if len(recent) >= PREFER and len(before) >= PREFER:
        fig["before"] = {"median": round(statistics.median(before)), "n": len(before)}
    by_month: dict[str, list[int]] = {}
    for e, d in done:
        by_month.setdefault(_month_key(e), []).append(d)
    fig["months"] = [
        {"month": k, "n": len(by_month.get(k, [])),
         "median": round(statistics.median(by_month[k])) if len(by_month.get(k, [])) >= FLOOR else None}
        for k in months_back(today)
    ]
    return fig


def stage(c: dict) -> str:
    """The furthest step a case reports (the board's waitingStage, with the consulate's own stage)."""
    if c.get("visa_issued") or c.get("card") or (c.get("i485_decided") and c.get("i485_decision") in (None, "approved")):
        return "done"
    if c.get("nvc_complete") or c.get("consular_scheduled") or c.get("consular_interview") or c.get("post"):
        return "consular"
    if any(c.get(f) for f in ("i485_receipt", "biometrics", "ead", "ap", "transfer", "interview")):
        return "i485"
    if c.get("i140_decided") and c.get("i140_decision") in (None, "approved"):
        return "approved"
    if c.get("i140_receipt"):
        return "i140"
    if c.get("perm_decided") and c.get("perm_decision") in (None, "approved"):
        return "certified"
    if c.get("perm_filed"):
        return "perm"
    return ""


def _country(v) -> str | None:
    return COUNTRY_LABELS.get(str(v or "").strip().lower())


def waiting(cases: list[dict], today: dt.date) -> dict:
    """The people heard from within HEARD_DAYS, at their furthest step, then by category and country. A denial at
    the last step leaves the count: that person isn't waiting on it."""
    ids = [s for s, _ in STAGES]
    by_stage = {s: 0 for s in ids}
    lines: dict[tuple[str, str], list[int]] = {}
    unlisted = 0
    heard = 0
    for c in cases:
        last = _day(c.get("as_of"))
        if not last or (today - last).days >= HEARD_DAYS or last > today:
            continue
        if c.get("i485_decision") == "denied" or (c.get("i140_decision") == "denied" and not c.get("i485_receipt")):
            continue
        s = stage(c)
        if not s:
            continue
        heard += 1
        by_stage[s] += 1
        cat = CATEGORY_LABELS.get(c.get("category") or "")
        ctry = _country(c.get("chargeability"))
        if not cat or not ctry:
            unlisted += 1
            continue
        lines.setdefault((cat, ctry), [0] * len(ids))[ids.index(s)] += 1
    shown = []
    for (cat, ctry), counts in lines.items():
        total = sum(counts)
        if total < MIN_CELL:
            unlisted += total
            continue
        shown.append({"category": cat, "country": ctry, "total": total,
                      "counts": [n if n >= MIN_CELL or n == 0 else None for n in counts]})
    shown.sort(key=lambda x: (-x["total"], x["category"], x["country"]))
    return {"open": heard >= MIN_CELL, "heardDays": HEARD_DAYS, "heard": heard,
            "byStage": [{"id": s, "label": label, "count": by_stage[s]} for s, label in STAGES],
            "lines": shown, "unlisted": unlisted}


def i140_figures(cases: list[dict], today: dt.date) -> list[dict]:
    """The I-140s by category and kind of premium: decided in the window, the share approved, the median days and the
    share with an RFE. The window is the steps' rule, by the day of the decision."""
    out = []
    for category in I140_CATEGORIES:
        for premium in I140_PREMIUMS:
            group = [c for c in cases if c.get("category") == category and (c.get("premium") or "not given") == premium
                     and (c.get("i140_receipt") or c.get("i140_decided") or c.get("i140_decision"))]
            if not group:
                continue
            decided = [c for c in group if c.get("i140_decision") in ("approved", "denied") and _day(c.get("i140_decided"))]
            decided = [c for c in decided if _day(c["i140_decided"]) <= today]
            recent = [c for c in decided if (today - _day(c["i140_decided"])).days < RECENT_DAYS]
            wide = [c for c in decided if (today - _day(c["i140_decided"])).days < WIDE_DAYS]
            window, pool = (RECENT_DAYS, recent) if len(recent) >= PREFER else (WIDE_DAYS, wide)
            waits = [(_day(c["i140_decided"]) - _day(c["i140_receipt"])).days for c in pool if _day(c.get("i140_receipt"))]
            waits = [w for w in waits if 0 <= w <= MAX_DAYS]
            approved = sum(1 for c in pool if c["i140_decision"] == "approved")
            told = [c for c in group if c.get("i140_rfe") in ("rfe", "noid", "none")]
            out.append({
                "category": category, "premium": premium, "reported": len(group), "decidedAllTime": len(decided),
                "windowDays": window, "decided": len(pool),
                "approvedShare": approved / len(pool) if len(pool) >= FLOOR else None,
                "medianDays": round(statistics.median(waits)) if len(waits) >= FLOOR else None,
                "rfeShare": sum(1 for c in told if c["i140_rfe"] != "none") / len(told) if len(told) >= FLOOR else None,
            })
    return out


def headline(cases: list[dict], today: dt.date) -> dict:
    """The figures at the top: cases, people heard from within a year, and green cards reported in the last 30 days."""
    def recent(field: str, days: int) -> int:
        n = 0
        for c in cases:
            d = _day(c.get(field))
            if d and 0 <= (today - d).days < days and _approved(c, field):
                n += 1
        return n
    heard = sum(1 for c in cases if _day(c.get("as_of")) and 0 <= (today - _day(c["as_of"])).days < HEARD_DAYS)
    return {"cases": len(cases), "heard": heard, "heardDays": HEARD_DAYS,
            "greenCards30": recent("i485_decided", 30) + recent("visa_issued", 30),
            "i140s30": recent("i140_decided", 30), "perm30": recent("perm_decided", 30)}


# The week's approvals, as the board's (convex/lib/communityTimeline.ts RECENT_STEPS, RECENT_DAYS, RECENT_MIN): each
# step's count of cases whose day fell in the last 7 days, today included, and no count under 5.
WEEK_DAYS = 7
WEEK_STEPS = (
    ("eadOn", "Work permits (EAD)", ("ead",)),
    ("apOn", "Travel documents (advance parole)", ("ap",)),
    ("greenCardOn", "Green cards", ("i485_decided", "visa_issued")),
    ("i140ApprovedOn", "I-140 approvals", ("i140_decided",)),
)


def week(cases: list[dict], today: dt.date) -> dict:
    start = today - dt.timedelta(days=WEEK_DAYS - 1)
    steps = []
    for sid, label, fields in WEEK_STEPS:
        n = 0
        for c in cases:
            if any((d := _day(c.get(f))) and start <= d <= today and _approved(c, f) for f in fields):
                n += 1
        steps.append({"id": sid, "label": label, "count": n if n >= FLOOR else None})
    return {"from": start.isoformat(), "through": today.isoformat(), "steps": steps}


def summarize(cases: list[dict], today: dt.date) -> dict:
    return {"today": today.isoformat(), "headline": headline(cases, today), "week": week(cases, today),
            "steps": [step_figure(cases, s, today) for s in STEPS],
            "waiting": waiting(cases, today), "i140": i140_figures(cases, today)}


def office_summaries(cases: list[dict], today: dt.date) -> dict[str, dict]:
    """Each office with OFFICE_FLOOR cases or more: its I-485 steps and who's waiting there."""
    by_office: dict[str, list[dict]] = {}
    for c in cases:
        # The office pages are about employment-based I-485s: a family case reported at an office counts nowhere on
        # them (the office list leaves it out the same way, src/lib/db/communityReports.ts).
        if c.get("office") and c.get("category") != "Family":
            by_office.setdefault(c["office"], []).append(c)
    steps = [s for s in STEPS if s["id"] in OFFICE_STEPS]
    out = {}
    for code, group in sorted(by_office.items()):
        if len(group) < OFFICE_FLOOR:
            continue
        out[code] = {"today": today.isoformat(), "cases": len(group),
                     "steps": [step_figure(group, s, today) for s in steps], "waiting": waiting(group, today)}
    return out


def post_summaries(cases: list[dict], today: dt.date) -> dict[str, dict]:
    """Each consulate with OFFICE_FLOOR cases or more: its two steps."""
    by_post: dict[str, list[dict]] = {}
    for c in cases:
        if c.get("post"):
            by_post.setdefault(c["post"], []).append(c)
    steps = [s for s in STEPS if s["id"] in POST_STEPS]
    return {post: {"today": today.isoformat(), "cases": len(group), "steps": [step_figure(group, s, today) for s in steps]}
            for post, group in sorted(by_post.items()) if len(group) >= OFFICE_FLOOR}


def prepared(cases: list[dict]) -> list[dict]:
    """The cases as the figures read them: a self-petition's priority date stands in for its I-140 filing day when the
    source gave only that (VisaStats' tracker does)."""
    out = []
    for c in cases:
        if not c.get("i140_receipt") and c.get("category") in SELF_PETITIONS and c.get("priority_date"):
            c = {**c, "i140_receipt": c["priority_date"]}
        out.append(c)
    return out


def all_summaries(cases: list[dict], today: dt.date) -> dict[str, dict]:
    """Every stored summary by its key: "all", "office:<code>", "post:<slug>"."""
    cases = prepared(cases)
    out = {"all": summarize(cases, today)}
    out.update({f"office:{k}": v for k, v in office_summaries(cases, today).items()})
    out.update({f"post:{k}": v for k, v in post_summaries(cases, today).items()})
    return out

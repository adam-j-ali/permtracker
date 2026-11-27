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
import re
import statistics

FLOOR = 5            # no figure from fewer cases (the board's METRIC_MIN_N)
PREFER = 20          # the 6-month window is used once it holds this many
RECENT_DAYS = 183
WIDE_DAYS = 365
HEARD_DAYS = 365     # who's waiting: heard from within a year
MAX_DAYS = 3650      # a span past ten years is a typo
MONTHS = 12          # the line by month
OFFICE_FLOOR = FLOOR  # an office or a consulate gets its own summary from this many cases (each step keeps its own floor)

# Every step people report, in the order a case goes, each in its group (the page that shows it). This module is the
# one place a figure over people's reports is worked out (D7, Nov 25 2026): Convex and the pages read what it stores.
def _s(sid, label, a, b, group, premium=None, employment=False, **more):
    return {"id": sid, "label": label, "from": a, "to": b, "group": group, "premium": premium, "verified": False,
            "employment": employment, **more}


STEPS = (
    _s("lca-h1b", "LCA certified to H-1B filed", "lca_certified", "h1b_filed", "h1b"),
    _s("h1b", "H-1B filed to decided", "h1b_filed", "h1b_decided", "h1b"),
    _s("pwd", "Wage request filed to the wage issued", "pwd_filed", "pwd_issued", "pwd"),
    _s("pwd-to-perm", "Wage issued to PERM filed", "pwd_issued", "perm_filed", "pwd"),
    _s("perm-audit", "PERM filed to an audit", "perm_filed", "perm_audit", "perm"),
    _s("perm", "PERM filed to decided", "perm_filed", "perm_decided", "perm"),
    _s("cert-to-i140", "PERM certified to I-140 filed", "perm_decided", "i140_receipt", "i140"),
    # Premium asked for after filing starts its own clock, on the day it was asked for when the report gives it.
    _s("i140-premium", "I-140 filed to decided, premium", "i140_receipt", "i140_decided", "i140", "premium",
       from_first="i140_premium_on"),
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
    # Employment cases only (an EB category), for the green card planner: the step above is mostly family visas.
    _s("nvc-interview-eb", "NVC documents accepted to the interview, employment cases", "nvc_complete",
       "consular_interview", "consular", employment=True),
    _s("consular-visa", "Consulate interview to visa issued", "consular_interview", "visa_issued", "consular"),
)
GROUPS = ("h1b", "pwd", "perm", "i140", "i485", "consular")
# Beside the case, never a step of it: each RFE on either form, and a spouse's H-4 papers, which can come before PERM
# or after the I-485. A step with `pairs` reads each pair as its own span: one value per RFE, so the count is RFEs.
SIDE_STEPS = (
    _s("rfe-answer", "RFE issued to answered", "i140_rfe_issued", "i140_rfe_answered", "side",
       pairs=(("i140_rfe_issued", "i140_rfe_answered"), ("i485_rfe_issued", "i485_rfe_answered"))),
    # The decision after an RFE is its own form's approval: a denial after the answer never counts.
    _s("rfe-decision", "RFE answered to approved", "i140_rfe_answered", "i140_decided", "side",
       pairs=(("i140_rfe_answered", "i140_decided"), ("i485_rfe_answered", "i485_decided"))),
    _s("h4-i539", "H-4 extension, filed to approved", "h4_filed", "h4_approved", "side"),
    # USCIS posts the two ways in as separate times, so a work permit that doesn't say how it went in counts in neither.
    _s("h4-ead-together", "H-4 work permit filed with the I-539, filed to approved", "h4_ead_filed", "h4_ead_approved",
       "side", route="with-i539"),
    _s("h4-ead-alone", "H-4 work permit filed on its own, filed to approved", "h4_ead_filed", "h4_ead_approved", "side",
       route="alone"),
)
# The steps an office's own summary carries (the I-485's), and a consulate's (its own two).
OFFICE_STEPS = tuple(x["id"] for x in STEPS if x["group"] == "i485")
POST_STEPS = tuple(x["id"] for x in STEPS if x["group"] == "consular")
# A step that ends in a decision counts only an approval.
APPROVAL = {"i485_decided": "i485_decision", "i140_decided": "i140_decision", "perm_decided": "perm_decision"}

# The board's stages and labels (convex/lib/communityTimeline.ts WAITING_STAGES), plus the consulate's.
STAGES = (
    ("pwd", "Wage request or recruitment"),
    ("perm", "PERM pending"),
    ("certified", "PERM certified, I-140 not filed"),
    ("i140", "I-140 pending"),
    ("approved", "I-140 approved, waiting on the bulletin"),
    ("i485", "I-485 pending"),
    ("consular", "At the NVC or the consulate"),
    ("done", "Green card received"),
)
CATEGORY_LABELS = {"EB-1": "EB-1", "EB-1A": "EB-1", "EB-1B": "EB-1", "EB-2": "EB-2", "EB-2 NIW": "EB-2 with a national interest waiver",
                   "EB-3": "EB-3", "EB-3 EW": "EB-3 other workers", "Family": "Family"}
COUNTRY_LABELS = {"row": "Rest of world", "rest of world": "Rest of world", "india": "India", "china": "China (mainland born)",
                  "mexico": "Mexico", "philippines": "Philippines",
                  # The other ways sources write the four with their own line, so none falls into Rest of world.
                  "in": "India", "ind": "India", "indian": "India",
                  "cn": "China (mainland born)", "prc": "China (mainland born)", "mainland china": "China (mainland born)",
                  "china mainland": "China (mainland born)", "china (mainland)": "China (mainland born)",
                  "china (mainland born)": "China (mainland born)", "chinese": "China (mainland born)",
                  "mx": "Mexico", "mexican": "Mexico", "ph": "Philippines", "phl": "Philippines", "filipino": "Philippines"}
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
    """'premium' when the clock ran premium, 'regular' when there was none, None when it can't be told: premium added
    later starts its own clock, so it counts only when the report gives the day it was asked for."""
    p = c.get("premium")
    if p in ("yes", "with filing") or (p == "after filing" and _day(c.get("i140_premium_on"))):
        return "premium"
    return "regular" if p == "none" else None


# A month-only end counts as the month's 15th on a span this long or longer, where half a month is a small share of
# the wait (at most about 12%); a shorter step needs both days. Most Reddit reports and every consulate report's NVC
# month give a month only, and were dropped from every figure until Nov 20 2026.
MONTH_SPAN_MIN = 120


def _when(v) -> tuple[dt.date | None, bool]:
    """A field's day, and whether it was a month only (then the 15th)."""
    d = _day(v)
    if d:
        return d, False
    if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}", v):
        try:
            return dt.date(int(v[:4]), int(v[5:7]), 15), True
        except ValueError:
            return None, False
    return None, False


def spans(cases: list[dict], step: dict) -> list[tuple[dt.date, int]]:
    """(the day the step finished, its days) for every case that holds both ends: one value a case, or one a pair for
    a step with `pairs` (each RFE)."""
    prem, first, route = step["premium"], step.get("from_first"), step.get("route")
    out = []
    for c in cases:
        if prem and _premium(c) != prem:
            continue
        if step.get("employment") and not str(c.get("category") or "").upper().startswith("EB"):
            continue
        if route and c.get("h4_ead_route") != route:
            continue
        for a, b in step.get("pairs") or ((step["from"], step["to"]),):
            (start, rough_start), (end, rough_end) = _when(c.get(a)), _when(c.get(b))
            if not start or not end or not _approved(c, b):
                continue
            later = _day(c.get(first)) if first else None
            if later and later > start:
                start = later
            d = (end - start).days
            if (rough_start or rough_end) and d < MONTH_SPAN_MIN:
                continue
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
    # Before PERM: the wage request, then recruitment under its wage, until PERM is filed.
    if c.get("pwd_filed") or c.get("pwd_issued"):
        return "pwd"
    return ""


# What a source writes for "no country": never a country.
NO_COUNTRY = {"", "n/a", "na", "-", "--", "?", "unknown", "none", "not given", "not said", "other", "tbd"}


def _country(v) -> str | None:
    """The bulletin line a country is charged to: its own for the four with one, Rest of world for every other
    country (Nov 20 2026: Canada, Nigeria and Iran counted as no country), None for a placeholder."""
    t = str(v or "").strip().lower()
    if t in COUNTRY_LABELS:
        return COUNTRY_LABELS[t]
    if t in NO_COUNTRY or not re.search(r"[a-z]{2}", t):
        return None
    return "Rest of world"


def waiting(cases: list[dict], today: dt.date) -> dict:
    """The people heard from within HEARD_DAYS, at their furthest step, then by category and country. A denial at
    the last step leaves the count: that person isn't waiting on it."""
    ids = [s for s, _ in STAGES]
    by_stage = {s: 0 for s in ids}
    lines: dict[tuple[str, str], list[int]] = {}
    unlisted = 0
    # The people no line shows, by step: those who gave no category or country (most at PERM and before, when
    # neither is known yet) and those on a line under MIN_CELL. Without it a step's column read all zeros.
    unlisted_by = [0] * len(ids)
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
            unlisted_by[ids.index(s)] += 1
            continue
        lines.setdefault((cat, ctry), [0] * len(ids))[ids.index(s)] += 1
    shown = []
    for (cat, ctry), counts in lines.items():
        total = sum(counts)
        if total < MIN_CELL:
            unlisted += total
            unlisted_by = [a + b for a, b in zip(unlisted_by, counts)]
            continue
        shown.append({"category": cat, "country": ctry, "total": total,
                      "counts": [n if n >= MIN_CELL or n == 0 else None for n in counts]})
    shown.sort(key=lambda x: (-x["total"], x["category"], x["country"]))
    return {"open": heard >= MIN_CELL, "heardDays": HEARD_DAYS, "heard": heard,
            "byStage": [{"id": s, "label": label, "count": by_stage[s]} for s, label in STAGES],
            "lines": shown, "unlisted": unlisted,
            "unlistedCounts": [n if n >= MIN_CELL or n == 0 else None for n in unlisted_by]}


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
            "side": [step_figure(cases, s, today) for s in SIDE_STEPS],
            "waiting": waiting(cases, today), "i140": i140_figures(cases, today)}


def office_summaries(cases: list[dict], today: dt.date, family: bool = False) -> dict[str, dict]:
    """Each office with OFFICE_FLOOR cases or more: its I-485 steps and who's waiting there. Employment-based cases by
    default; `family` gives the family-based cases their own ("office-family:<code>", Nov 26 2026), never mixed in."""
    by_office: dict[str, list[dict]] = {}
    for c in cases:
        # An office's employment-based figures never count a family case, nor its family figures an employment one
        # (the office list leaves family cases out the same way, src/lib/db/communityReports.ts).
        if c.get("office") and (c.get("category") == "Family") == family:
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


# The consulate reports sent through this site's form (convex/consularReports.ts), every kind of visa: each
# consulate's "What people report". They're the only source that says how an interview ended (a 221(g), a drop box,
# a cancelled interview) or covers a work, family or visitor visa, so these figures read the reports alone, each
# report once; the employment steps over every source are the consulate's own summary ("post:<slug>"). The rules
# were convex/lib/consularReport.ts summarizeReports until Nov 25 2026 (D7); the medians are now this module's own.
#
# A report row (scripts/build_reported_cases.py report_row): post, category, mode, line, outcome, nvc_month,
# scheduled, interview, approved, resolved, hold_reason, cancelled_by, saved (the Eastern day it was last saved).
REPORT_FLOOR = 3           # a figure, a breakdown, a week or a median shows from this many reports (MIN_REPORTS in TS)
REPORT_WINDOWS = (30, 90)  # the windows the reports are counted in, by the day of each one's newest step
REPORT_WEEKS = 12          # weeks of interviews held, the newest holding today
WAIT_WINDOW = 180          # NVC to the interview, and the interview to the visa, read appointments in this many days
RESULT_WINDOW = 90         # the share that ended in 221(g) reads results in this many days
MOVED_WINDOW = 90
APPROVED_OUTCOMES = ("approved", "issued", "passport-returned")
DECIDED_OUTCOMES = (*APPROVED_OUTCOMES, "221g", "refused")
MOVED_OUTCOMES = ("cancelled", "rescheduled")
BUSIEST = 20               # the most consulates the index page's panel lists
NO_REPORTS = "_none"       # the key of the figures for a consulate nobody has reported yet (never a slug)


def _plus(day: dt.date, n: int) -> str:
    return (day + dt.timedelta(days=n)).isoformat()


def report_day(r: dict) -> str:
    """The day a report speaks for: its newest step (the visa, the approval, the interview, the appointment), or the
    day it was saved when it holds only NVC's month. An interview from 2022 reported today is old news."""
    days = [r.get(f) for f in ("resolved", "approved", "interview", "scheduled") if r.get(f)]
    return max(days) if days else r["saved"]


def _appeared(r: dict) -> bool:
    """The appointment took place, or waits on its result: not cancelled, not moved."""
    return bool(r.get("interview")) and r.get("outcome") not in MOVED_OUTCOMES


def _held(r: dict) -> bool:
    """An interview was held: the appointment took place, and it wasn't a drop box."""
    return _appeared(r) and r.get("mode") != "dropbox"


def report_wait(r: dict) -> int | None:
    """Days from NVC's month to an interview held, counted from the month's 15th (wrong by at most half a month)."""
    if not r.get("nvc_month") or not _held(r):
        return None
    start, _ = _when(r["nvc_month"])
    end = _day(r["interview"])
    if not start or not end:
        return None
    d = (end - start).days
    return d if d >= 0 else None


def after_appointment(r: dict) -> int | str | None:
    """After the interview or drop box: days to the approval or the visa (a 221(g) to the day it cleared), "waiting"
    (no result yet, or a 221(g) not cleared), or None (refused, cancelled, moved, or no appointment day)."""
    if not _appeared(r):
        return None
    outcome = r.get("outcome")
    end = r.get("resolved") if outcome == "221g" else (r.get("approved") or r.get("resolved")) if outcome in APPROVED_OUTCOMES else None
    if end:
        a, b = _day(r["interview"]), _day(end)
        return (b - a).days if a and b and b >= a else None
    return "waiting" if outcome in ("waiting", "221g") else None


def week_starts(today: dt.date, n: int = REPORT_WEEKS) -> list[str]:
    """The Mondays that start the last n weeks, oldest first, the newest holding today."""
    monday = today - dt.timedelta(days=today.weekday())
    return [_plus(monday, -7 * (n - 1 - i)) for i in range(n)]


def _median(xs: list[int]) -> int | None:
    return round(statistics.median(xs)) if xs else None


def _counts(rows: list[dict], field: str) -> dict[str, int]:
    """How many reports gave each answer, leaving out the ones that gave none."""
    out: dict[str, int] = {}
    for r in rows:
        if r.get(field):
            out[r[field]] = out.get(r[field], 0) + 1
    return out


def report_view(reports: list[dict], today: dt.date) -> dict:
    """The figures for one set of reports (one consulate's, or every one's). Only what a page may print: every
    breakdown, cell, week and median under REPORT_FLOOR comes back empty or None, so no page can print one by mistake.
    Counts by answer are keyed by the form's ids; the page puts the form's words and order on them."""
    shown = lambda n: n >= REPORT_FLOOR  # noqa: E731
    since = lambda days: _plus(today, -(days - 1))  # noqa: E731
    windows = []
    for days in REPORT_WINDOWS:
        rows = [r for r in reports if report_day(r) >= since(days)]
        windows.append({"days": days, "total": len(rows), "open": shown(len(rows)),
                        "byOutcome": _counts(rows, "outcome") if shown(len(rows)) else {}})
    recent = [r for r in reports if report_day(r) >= since(90)]
    appt_from = since(WAIT_WINDOW)
    recent_appt = lambda rows: [r for r in rows if r.get("interview") and r["interview"] >= appt_from]  # noqa: E731
    waits_of = lambda rows: [w for w in map(report_wait, recent_appt(rows)) if w is not None]  # noqa: E731

    categories = {}
    for cat in sorted({r["category"] for r in reports}):
        rows = [r for r in recent if r["category"] == cat]
        mine = [r for r in reports if r["category"] == cat]
        waits = waits_of(mine)
        finished, waiting = [], 0
        for r in recent_appt(mine):
            a = after_appointment(r)
            if a == "waiting":
                waiting += 1
            elif a is not None:
                finished.append(a)
        after = ({"finished": len(finished), "waiting": waiting,
                  "median": _median(finished) if shown(len(finished)) else None}
                 if shown(len(finished) + waiting) else {"finished": None, "waiting": None, "median": None})
        categories[cat] = {"count": len(rows) if shown(len(rows)) else None, "open": shown(len(rows)),
                           "byOutcome": _counts(rows, "outcome") if shown(len(rows)) else {},
                           "byLine": _counts(rows, "line") if shown(len(rows)) else {},
                           "waitMedian": _median(waits) if shown(len(waits)) else None, "after": after}

    weeks = []
    for start in week_starts(today):
        end = _plus(dt.date.fromisoformat(start), 7)
        n = sum(1 for r in reports if _held(r) and start <= r["interview"] < end)
        weeks.append({"start": start, "count": n if shown(n) else None, "partial": end > today.isoformat()})

    decided = [r for r in reports if r.get("outcome") in DECIDED_OUTCOMES and report_day(r) >= since(RESULT_WINDOW)]
    holds = [r for r in decided if r["outcome"] == "221g"]
    results_open = shown(len(decided))
    moved = [r for r in recent if r.get("outcome") in MOVED_OUTCOMES]
    waits = waits_of(reports)
    return {
        "today": today.isoformat(), "total": len(reports), "floor": REPORT_FLOOR, "windows": windows,
        "categories": categories, "weeks": weeks,
        "results": {"days": RESULT_WINDOW, "n": len(decided) if results_open else None,
                    "g221": len(holds) if results_open else None,
                    "share": len(holds) / len(decided) if results_open else None,
                    "holdReasons": _counts(holds, "hold_reason") if results_open and shown(len(holds)) else {}},
        "moved": {"days": MOVED_WINDOW, "n": len(moved) if shown(len(moved)) else None,
                  "byWho": _counts(moved, "cancelled_by") if shown(len(moved)) else {}},
        "wait": {"days": WAIT_WINDOW, "n": len(waits) if shown(len(waits)) else None,
                 "median": _median(waits) if shown(len(waits)) else None},
    }


def report_summaries(reports: list[dict], today: dt.date) -> dict[str, dict]:
    """"reports:all" (every consulate, with the busiest ones), "reports:<slug>" for each consulate with a report, and
    "reports:_none" for a consulate nobody has reported yet."""
    by_post: dict[str, list[dict]] = {}
    for r in reports:
        by_post.setdefault(r["post"], []).append(r)
    out = {f"reports:{post}": report_view(rows, today) for post, rows in sorted(by_post.items())}
    busiest = []
    for post, rows in by_post.items():
        v = out[f"reports:{post}"]
        if v["windows"][0]["total"] >= REPORT_FLOOR:
            busiest.append({"post": post, "reports30": v["windows"][0]["total"], "results": v["results"]["n"],
                            "g221": v["results"]["g221"], "share": v["results"]["share"]})
    busiest.sort(key=lambda b: (-b["reports30"], b["post"]))
    out["reports:all"] = {**report_view(reports, today), "busiest": busiest[:BUSIEST]}
    out[f"reports:{NO_REPORTS}"] = report_view([], today)
    return out


def all_summaries(cases: list[dict], today: dt.date, reports: list[dict] | None = None) -> dict[str, dict]:
    """Every stored summary by its key: "all", "office:<code>", "post:<slug>", and the consulate reports' own when
    they were read ("reports:..."; None when the export didn't send them)."""
    cases = prepared(cases)
    out = {"all": summarize(cases, today)}
    out.update({f"office:{k}": v for k, v in office_summaries(cases, today).items()})
    out.update({f"office-family:{k}": v for k, v in office_summaries(cases, today, family=True).items()})
    out.update({f"post:{k}": v for k, v in post_summaries(cases, today).items()})
    if reports is not None:
        out.update(report_summaries(reports, today))
    return out

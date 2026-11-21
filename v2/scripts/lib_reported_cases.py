"""One case per person, whichever sources reported it: the merge behind every reported-cases list on the site.

People report their own green card dates in several places: our timeline form and consulate reports, community sheets,
VisaStats' tracker, Reddit threads, Telegram chats and Facebook groups. One person often appears in several, each holding some of the
dates. `merge` folds the records into cases, filling each case's gaps from every source that holds it, and keeps two
records apart whenever they can't be shown to be the same person.

The rules, in order:

1. One person's records inside one source fold first (the same Reddit author or Telegram sender, `person`); the newer
   record wins a correction, and the correction is noted in `conflicts`.
2. Two rows of one source are two people (a sheet's rows, a tracker's rows), so a case holds one record per source.
3. A record joins a case when they agree on THREE distinct dates (a day typed one day apart agrees, for typing by hand;
   one day typed into two columns counts once) and contradict on nothing, and no other case matches it as well.
   Three, because whole batches share two: an office transfers dozens of cases on one day, received on one day.
4. A record that agrees on two dates, adds nothing the case lacks, and fits only that case joins it as `likely`.
   It adds nothing, so joining can't put a wrong date on anyone. Two dates never carry a new date onto a case: a wrong
   approval on someone's timeline is worse than counting them twice.
5. Anything else is its own case. A case that agrees with another on two dates is linked in `possible_dupes`, and one
   that adds nothing to such a case isn't counted twice (`count_people`).

A contradiction is a date more than a day apart, another month, another office, centre or post, another category
(EB-2 NIW refines EB-2; EB-3 contradicts it), another country (a specific country refines "rest of world" unless it
has its own line), or approved against denied. A missing value never contradicts.

A record from a source that doesn't show (a private timeline) only stops a repeat: it can join a case, and none of its
own values reach what's shown.
"""
from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict

# The dates a case can hold. Every one is "YYYY-MM-DD", or "YYYY-MM" when only the month was given.
DATE_FIELDS = (
    # Before PERM: the H-1B and its LCA, then the wage request.
    "h1b_filed", "h1b_decided", "lca_certified", "pwd_filed", "pwd_issued",
    # PERM.
    "perm_filed", "perm_audit", "perm_decided", "priority_date",
    # The I-140.
    "i140_receipt", "i140_rfe_issued", "i140_rfe_answered", "i140_decided",
    # Adjustment at a USCIS office.
    "i485_receipt", "biometrics", "ead", "ap", "i485_rfe_issued", "transfer", "interview", "i485_decided", "card",
    # Or the consular path.
    "nvc_complete", "consular_scheduled", "consular_interview", "visa_issued",
)
# What a case is, compared for contradictions and never counted toward a match.
IDENTITY_FIELDS = ("category", "office", "center", "post", "chargeability")
DECISION_FIELDS = ("h1b_decision", "perm_decision", "i140_decision", "i485_decision", "consular_outcome")
# Carried along, never compared: what a source adds about the wait (a sheet's "visa available", the status held
# while waiting, a priority date given in words).
OTHER_FIELDS = ("premium", "i140_rfe", "visa_available", "nonimmigrant_status", "priority_note")
META_FIELDS = ("source", "key", "person", "as_of", "checked", "shows")
FIELDS = DATE_FIELDS + IDENTITY_FIELDS + DECISION_FIELDS + OTHER_FIELDS

DECISIONS = ("approved", "denied", "withdrawn", "pending")
# A consulate's outcomes: a 221(g) is a hold for more documents, after which the visa is issued or refused.
CONSULAR_OUTCOMES = ("issued", "refused", "221g", "approved", "pending")
# How far along an outcome is: a later one replaces an earlier one, and never contradicts it. "approved" is a
# consulate's approval at the window, before the visa is printed.
CONSULAR_PROGRESS = {"pending": 0, "221g": 1, "approved": 1}
DECISION_PROGRESS = {"pending": 0}
# Premium processing, most specific first: from the filing, added later, said yes with no timing, or not used.
PREMIUMS = ("with filing", "after filing", "yes", "none")
PREMIUM_DETAIL = {"with filing": 3, "after filing": 3, "yes": 2, "none": 1}
# Whether an I-140 got a request for evidence or a notice of intent to deny: a yes beats "none" (it came later).
I140_RFE = ("noid", "rfe", "none")
I140_RFE_DETAIL = {"noid": 3, "rfe": 2, "none": 1}


def outcomes_for(field: str) -> tuple[str, ...]:
    return CONSULAR_OUTCOMES if field == "consular_outcome" else DECISIONS


def progress(field: str, v: str) -> int:
    """How far along a decision is: a later one replaces an earlier one. Each field has its own words."""
    return (CONSULAR_PROGRESS if field == "consular_outcome" else DECISION_PROGRESS).get(v, 2)
# Our own reviewed sources first, then the sheets, then the trackers and chats. The first member founds a case's id.
# Facebook groups' posts are typed in by hand from screenshots, so they rank after Reddit and before Telegram's parsed
# posts; never as a sheet, which any name not listed here is.
SOURCE_RANK = {"timeline": 0, "consular-report": 1, "app": 2, "visastats": 30, "reddit": 40, "facebook": 45,
               "telegram": 50}
SHEET_RANK = 20  # any other source name is a community sheet's key
# Countries with their own line in the Visa Bulletin: never "rest of world".
OWN_LINE = {"india", "china", "mexico", "philippines", "el salvador", "guatemala", "honduras"}
REST_OF_WORLD = {"row", "rest of world", "all chargeability", "all chargeability areas"}

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
SOURCE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MATCH_DATES = 3
LIKELY_DATES = 2


def rank(source: str) -> int:
    return SOURCE_RANK.get(source, SHEET_RANK)


def check_record(r: dict) -> None:
    """Refuse a record the merge can't read, rather than guess at it."""
    if not isinstance(r.get("source"), str) or not SOURCE_RE.match(r["source"]):
        raise ValueError(f"a record needs a source name: {r!r}")
    if not isinstance(r.get("key"), str) or not r["key"]:
        raise ValueError(f"a record needs its key in its source: {r!r}")
    unknown = set(r) - set(FIELDS) - set(META_FIELDS)
    if unknown:
        raise ValueError(f"fields the merge doesn't know: {sorted(unknown)}")
    for f in DATE_FIELDS:
        v = r.get(f)
        if v is not None and not (isinstance(v, str) and (DAY_RE.match(v) or MONTH_RE.match(v))):
            raise ValueError(f"{f} must be YYYY-MM-DD or YYYY-MM, got {v!r}")
        if isinstance(v, str) and DAY_RE.match(v):
            dt.date.fromisoformat(v)  # a 31st of February raises
    for f in DECISION_FIELDS:
        if r.get(f) is not None and r[f] not in outcomes_for(f):
            raise ValueError(f"{f} must be one of {outcomes_for(f)}, got {r[f]!r}")
    if r.get("premium") is not None and r["premium"] not in PREMIUMS:
        raise ValueError(f"premium must be one of {PREMIUMS}, got {r['premium']!r}")
    if r.get("i140_rfe") is not None and r["i140_rfe"] not in I140_RFE:
        raise ValueError(f"i140_rfe must be one of {I140_RFE}, got {r['i140_rfe']!r}")


def _day(v: str) -> dt.date:
    return dt.date.fromisoformat(v)


def dates_agree(a: str, b: str) -> bool:
    """Two values of one date field agree: days within one day, a month with any day in it, a month with itself."""
    if DAY_RE.match(a) and DAY_RE.match(b):
        return abs((_day(a) - _day(b)).days) <= 1
    return a[:7] == b[:7]


def _family(category: str) -> str:
    c = category.upper().replace(" ", "").replace("-", "")
    m = re.match(r"^(EB\d)", c)
    return m[1] if m else c


def _norm_category(category: str) -> str:
    return category.upper().replace(" ", "").replace("-", "")


def categories_agree(a: str, b: str) -> bool:
    """Equal, or one is the other's family (EB-2 and EB-2 NIW). EB-1A and EB-1B are two categories."""
    x, y = _norm_category(a), _norm_category(b)
    if x == y:
        return True
    return _family(x) == _family(y) and (x == _family(x) or y == _family(y))


def _country(v: str) -> str:
    return v.strip().lower()


def countries_agree(a: str, b: str) -> bool:
    x, y = _country(a), _country(b)
    if x == y:
        return True
    if x in REST_OF_WORLD:
        return y not in OWN_LINE
    if y in REST_OF_WORLD:
        return x not in OWN_LINE
    return False


def _agree(field: str, a, b) -> bool:
    if field in DATE_FIELDS:
        return dates_agree(a, b)
    if field == "category":
        return categories_agree(a, b)
    if field == "chargeability":
        return countries_agree(a, b)
    if field in DECISION_FIELDS:
        return a == b or progress(field, a) < 2 or progress(field, b) < 2
    return str(a).strip().upper() == str(b).strip().upper()


def contradicts(a: dict, b: dict) -> bool:
    """Any field both hold, with values that can't both be true."""
    for f in DATE_FIELDS + IDENTITY_FIELDS + DECISION_FIELDS:
        if a.get(f) is not None and b.get(f) is not None and not _agree(f, a[f], b[f]):
            return True
    return False


def agreeing_dates(a: dict, b: dict) -> int:
    """How many distinct days the two agree on: months never count, and a day in two columns counts once."""
    days: list[dt.date] = []
    for f in DATE_FIELDS:
        x, y = a.get(f), b.get(f)
        if x is None or y is None or not (DAY_RE.match(x) and DAY_RE.match(y)) or not dates_agree(x, y):
            continue
        d = _day(x)
        if all(abs((d - e).days) > 1 for e in days):
            days.append(d)
    return len(days)


def adds_to(r: dict, case: dict) -> bool:
    """The record holds something the case doesn't: a field the case lacks, a day where it has a month, a decision."""
    for f in FIELDS:
        v = r.get(f)
        if v is None or (f in DECISION_FIELDS and v == "pending"):
            continue
        have = case.get(f)
        if have is None:
            return True
        if f in DATE_FIELDS and DAY_RE.match(v) and MONTH_RE.match(have):
            return True
        if f == "category" and _family(_norm_category(v)) == _norm_category(have) != _norm_category(v):
            return True
        if f == "chargeability" and _country(have) in REST_OF_WORLD and _country(v) not in REST_OF_WORLD:
            return True
        if f in DECISION_FIELDS and progress(f, v) > progress(f, have):
            return True
        if f == "premium" and PREMIUM_DETAIL[v] > PREMIUM_DETAIL.get(have, 0):
            return True
        if f == "i140_rfe" and I140_RFE_DETAIL[v] > I140_RFE_DETAIL.get(have, 0):
            return True
    return False


def fold_people(records: list[dict]) -> list[dict]:
    """One record per person per source: the newer record wins each field, and a changed value is noted."""
    out: list[dict] = []
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in records:
        if r.get("person"):
            groups[(r["source"], r["person"])].append(r)
        else:
            out.append({**r, "conflicts": []})
    for (_source, _person), rs in groups.items():
        rs = sorted(rs, key=lambda r: (r.get("as_of") or "", r["key"]))
        folded: dict = {**rs[0], "conflicts": []}
        for r in rs[1:]:
            for f in FIELDS:
                v = r.get(f)
                if v is None:
                    continue
                old = folded.get(f)
                if old is not None and old != v and not (f in DECISION_FIELDS and progress(f, old) < progress(f, v)):
                    if not (f in DATE_FIELDS and MONTH_RE.match(old) and v.startswith(old)):
                        folded["conflicts"].append({"field": f, "values": [old, v]})
                folded[f] = v
            folded["as_of"] = r.get("as_of") or folded.get("as_of")
            folded["checked"] = folded.get("checked") or r.get("checked")
        folded["key"] = rs[0]["key"]  # the first record's key: the case keeps its id as the person posts again
        out.append(folded)
    return out


def _better(f: str, cur, cur_m: dict | None, v, m: dict) -> bool:
    """Whether member m's value v should replace the value shown so far (cur, from member cur_m)."""
    if cur is None:
        return True
    if f in DECISION_FIELDS:
        return progress(f, v) > progress(f, cur)
    if f == "premium":
        return PREMIUM_DETAIL[v] > PREMIUM_DETAIL.get(cur, 0)
    if f == "i140_rfe":
        return I140_RFE_DETAIL[v] > I140_RFE_DETAIL.get(cur, 0)
    if f in DATE_FIELDS and MONTH_RE.match(cur) and DAY_RE.match(v):
        return True
    if f in DATE_FIELDS and DAY_RE.match(cur) and MONTH_RE.match(v):
        return False
    if f == "category":
        return _norm_category(cur) == _family(_norm_category(v)) != _norm_category(v)
    if f == "chargeability":
        return _country(cur) in REST_OF_WORLD and _country(v) not in REST_OF_WORLD
    return bool(m.get("checked")) and not (cur_m or {}).get("checked")


def _combine(members: list[dict], everyone: bool = False) -> dict:
    """The case's values: every field from its best member. A member that doesn't show adds nothing shown, except to
    the anonymous figures (`everyone`), which count a private timeline as its form promises."""
    shown = members if everyone else [m for m in members if m.get("shows", True)]
    out: dict = {}
    by: dict[str, dict] = {}
    for m in sorted(shown, key=lambda m: (rank(m["source"]), m["key"])):
        for f in FIELDS:
            v = m.get(f)
            if v is None:
                continue
            if f == "priority_note" and out.get("priority_date"):
                continue
            if _better(f, out.get(f), by.get(f), v, m):
                out[f] = v
                by[f] = m
    return out


def _evidence(members: list[dict]) -> dict:
    """Every value any member holds, shown or not, for matching: a private timeline still stops a repeat."""
    out: dict = {}
    for m in sorted(members, key=lambda m: (rank(m["source"]), m["key"])):
        for f in FIELDS:
            if m.get(f) is not None and _better(f, out.get(f), None, m[f], m):
                out[f] = m[f]
    return out


def _date_keys(r: dict) -> set[str]:
    """The days a record holds, each with its neighbours, so a lookup finds every record within a day of it."""
    keys: set[str] = set()
    for f in DATE_FIELDS:
        v = r.get(f)
        if v and DAY_RE.match(v):
            d = _day(v)
            keys.update(str(d + dt.timedelta(days=k)) for k in (-1, 0, 1))
    return keys


def merge(records: list[dict]) -> list[dict]:
    """Cases from reported records. Each case: its values, `sources` (each with `likely`), `checked`, `shows`,
    `conflicts` (corrections inside one person's records), `possible_dupes` (ids) and `adds_nothing`."""
    seen_keys: set[tuple[str, str]] = set()
    for r in records:
        check_record(r)
        if (r["source"], r["key"]) in seen_keys:
            raise ValueError(f"two records with the key {r['source']}:{r['key']}")
        seen_keys.add((r["source"], r["key"]))
    folded = sorted(fold_people(records), key=lambda r: (rank(r["source"]), r["source"], r["key"]))

    clusters: list[dict] = []  # {"id", "members", "evidence"}
    by_day: dict[str, set[int]] = defaultdict(set)

    def candidates(r: dict) -> list[tuple[int, int]]:
        seen: set[int] = set()
        for k in _date_keys(r):
            seen |= by_day.get(k, set())
        out = []
        for i in sorted(seen):
            c = clusters[i]
            if any(m["source"] == r["source"] for m in c["members"]) or contradicts(r, c["evidence"]):
                continue
            n = agreeing_dates(r, c["evidence"])
            if n >= LIKELY_DATES:
                out.append((i, n))
        return out

    def place(r: dict, i: int | None, likely: bool) -> None:
        if i is None:
            clusters.append({"id": f"{r['source']}:{r['key']}", "members": [], "evidence": {}})
            i = len(clusters) - 1
        c = clusters[i]
        c["members"].append({**r, "likely": likely})
        c["evidence"] = _evidence(c["members"])
        for k in _date_keys(c["evidence"]):
            by_day[k].add(i)

    for r in folded:
        cands = candidates(r)
        best = max((n for _, n in cands), default=0)
        top = [i for i, n in cands if n == best]
        if best >= MATCH_DATES and len(top) == 1:
            place(r, top[0], likely=False)
        elif len(cands) == 1 and not adds_to(r, clusters[cands[0][0]]["evidence"]):
            place(r, cands[0][0], likely=True)
        else:
            place(r, None, likely=False)

    cases = []
    for i, c in enumerate(clusters):
        shown = _combine(c["members"])
        # The id names the first member that shows, so a private timeline's own key never reaches a page.
        first = next((m for m in c["members"] if m.get("shows", True)), c["members"][0])
        cases.append({
            "id": f"{first['source']}:{first['key']}",
            **{f: shown.get(f) for f in FIELDS},
            "sources": [{"source": m["source"], "key": m["key"], "likely": m["likely"], "shows": m.get("shows", True)}
                        for m in c["members"]],
            # What the anonymous figures count (scripts/lib_reported_summary.py): every member, a private one too.
            "figures": {**_combine(c["members"], everyone=True),
                        "as_of": max((m["as_of"] for m in c["members"] if m.get("as_of")), default=None)},
            "checked": any(m.get("checked") and m.get("shows", True) for m in c["members"]),
            "shows": any(m.get("shows", True) for m in c["members"]),
            "conflicts": [x for m in c["members"] for x in m.get("conflicts", [])],
            # The newest "as of" a shown member gives: when the case was last brought up to date.
            "as_of": max((m["as_of"] for m in c["members"] if m.get("as_of") and m.get("shows", True)), default=None),
            "possible_dupes": [],
            "adds_nothing": False,
            "_evidence": c["evidence"],
            "_sources": {m["source"] for m in c["members"]},
            "_i": i,
        })

    # Possible repeats: two cases that agree on two dates, contradict on nothing and share no source. Two rows of one
    # source are linked only on three dates (batch-mates and spouses share two, often three), and count once only
    # when every value matches: the same entry made twice.
    index: dict[str, set[int]] = defaultdict(set)
    for c in cases:
        for k in _date_keys(c["_evidence"]):
            index[k].add(c["_i"])
    for c in cases:
        near: set[int] = set()
        for k in _date_keys(c["_evidence"]):
            near |= index[k]
        for j in sorted(near - {c["_i"]}):
            o = cases[j]
            if contradicts(c["_evidence"], o["_evidence"]):
                continue
            if c["_sources"] & o["_sources"]:
                if agreeing_dates(c["_evidence"], o["_evidence"]) >= MATCH_DATES:
                    c["possible_dupes"].append(o["id"])
                    if all(c.get(f) == o.get(f) for f in FIELDS) and c["id"] > o["id"]:
                        c["adds_nothing"] = True
                continue
            if agreeing_dates(c["_evidence"], o["_evidence"]) >= LIKELY_DATES:
                c["possible_dupes"].append(o["id"])
                if not adds_to(c["_evidence"], o["_evidence"]):
                    c["adds_nothing"] = True
    # Cases that are only each other's repeats (every one of them adds nothing to the others) still count once:
    # the first of them by id counts. A case held by one that adds something stays uncounted.
    by_id = {c["id"]: c for c in cases}
    marked = {c["id"] for c in cases if c["adds_nothing"]}
    for c in cases:
        if c["id"] in marked and all(d in marked for d in c["possible_dupes"]) and c["id"] == min([c["id"], *c["possible_dupes"]]):
            by_id[c["id"]]["adds_nothing"] = False
    for c in cases:
        c["possible_dupes"].sort()
        for k in ("_evidence", "_sources", "_i"):
            del c[k]
    return sorted(cases, key=lambda c: c["id"])


def count_people(cases: list[dict]) -> int:
    """How many people the shown cases are: a case that adds nothing to a possible repeat isn't counted again."""
    return sum(1 for c in cases if c["shows"] and not c["adds_nothing"])

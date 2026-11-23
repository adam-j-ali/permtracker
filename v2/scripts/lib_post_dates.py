"""Read the dates a person gives about their own case in a chat post, and never guess one.

People in the PERM and green card chats post their own updates, often in a template ("Filing: 09/23/2022 State: TX
Status: Approved Approval date: 8/18/23"), sometimes in a sentence ("my perm is certified today, pd is 01/06/2023").
`read_post` turns one post into the merge's fields (scripts/lib_reported_cases.py), or None.

A date counts only when a label sits right before it ("Filing:", "I-140 approved", "RD", "Bio"), the nearest label
winning. What makes a post unreadable, so it gives nothing rather than a wrong date:

- someone else's case (a friend's, a colleague's), or two values for one step (a roundup of other people's cases);
- a filing day with no year (an approval day without one takes the post's year when that's within 120 days);
- a day that reads both ways (05/06) in a chat with no settled order, unless another date in the post settles it;
- a date after the post was written (an interview or biometrics appointment may be up to 180 days ahead);
- steps out of order (decided before filed), which means something was misread;
- in a chat about several forms, a bare "filed" or "approved" that doesn't name which form.

A label must sit right against its date ("Approval date: 07/18", "pd is 01/06/2023", "approved in July 2024"); one
with other words between ("waiting for approval ( FD May 3rd") labels nothing. Some people write a timeline date first
("Oct 2022 - Perm filed, Oct 2023 - Perm approved"): a post where more dates carry a step right after them than right
before them is read that way, each date taking the step that follows it. A post must give a date, and either a
decision or a second date: one filing day alone says nothing happened. A post giving one date counts only when it's the
poster's own update ("my perm ...", or a template's "Status: Approved"), asks nothing, and supposes nothing.
"""
from __future__ import annotations

import datetime as dt
import re

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10,
          "nov": 11, "dec": 12}
MON = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?"
       r"|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?")
DATE_RE = re.compile(
    r"(?<![\w/.])(?<!\d-)(?:"
    r"(?P<iso>(?P<iy>20\d{2})-(?P<im>\d{1,2})-(?P<id>\d{1,2}))"
    r"|(?P<my>(?P<mym>\d{1,2})[/.-](?P<myy>20\d{2}))"
    r"|(?P<num>(?P<a>\d{1,2})[/.-](?P<b>\d{1,2})(?:[/.-](?P<y>\d{4}|\d{2}))?)"
    rf"|(?P<mdy>(?P<mn>{MON}),?\s+(?P<md>\d{{1,2}})(?P<msuf>st|nd|rd|th)?(?!\d)(?:,?\s+(?P<mdyy>20\d{{2}}))?)"
    rf"|(?P<dmy>(?P<dd>\d{{1,2}})(?:st|nd|rd|th)?[\s-]+(?:of\s+)?(?P<dmn>{MON})(?:[,\s-]+(?P<dmyy>20\d{{2}}))?)"
    rf"|(?P<mony>(?P<monm>{MON})\s+(?P<monyy>20\d{{2}}))"
    r")(?![\w/])",
    re.I,
)

# Labels, the more specific first: at one spot the first that fits wins, and the nearest label before a date is its.
LABELS = (
    ("pwd_filed", r"pwd\s*(?:filed|filing|submitted|submission|sent|applied)(?:\s*(?:date|on))?"),
    ("pwd_issued", r"pwd\s*(?:issued|received|approved|determin\w*|came\s*out)(?:\s*(?:date|on))?"),
    ("i140_rfe_answered", r"(?:(?:i[- ]?)?140\s*)?rfe\s*(?:response|responded|answered|replied)(?:\s*(?:date|on))?"),
    ("i140_rfe_issued", r"(?:i[- ]?)?140\s*rfe(?:\s*(?:issued|received))?(?:\s*(?:date|on))?"),
    ("i140_receipt", r"(?:i[- ]?)?140\s*(?:filed|filing|receipt|received|rd|submitted|rcvd)(?:\s*(?:date|on))?"),
    ("i140_decided", r"(?:i[- ]?)?140\s*(?:approv\w*|appr)(?:\s*(?:notice|received))?(?:\s*(?:date|on))?"),
    ("i485_receipt", r"(?:(?:i[- ]?)?485|aos)\s*(?:filed|filing|receipt|received|rd|submitted|rcvd)(?:\s*(?:date|on))?"),
    ("i485_decided", r"(?:(?:i[- ]?)?485|aos|gc|green\s*card)\s*approv\w*(?:\s*(?:notice|received))?(?:\s*(?:date|on))?"),
    # The work permit (I-765) and travel document (I-131) approved, by form number ("I-765: Approval document appeared on").
    ("ead765", r"(?:i[- ]?)?765\s*:?\s*approv\w*(?:\s*(?:notice|document|doc))?(?:\s*(?:appeared\s*on|appeared|date|on))?"),
    ("ap131", r"(?:i[- ]?)?131\s*:?\s*approv\w*(?:\s*(?:notice|document|doc))?(?:\s*(?:appeared\s*on|appeared|date|on))?"),
    ("ead_ap", r"ead\s*(?:/|\+|&|and)\s*ap(?:\s*combo)?(?:\s*card)?(?:\s*(?:approv\w*|received))?(?:\s*(?:date|on))?"),
    ("ead", r"ead(?:\s*card)?(?:\s*(?:approv\w*|received))?(?:\s*(?:date|on))?"),
    ("ap", r"(?:ap|advance\s*parole)\s*(?:approv\w*|received)(?:\s*(?:date|on))?"),
    ("biometrics", r"bio(?:metrics?|s)?(?:\s*(?:appointment|appt|done|date|scheduled|completed))?(?:\s*on)?"),
    ("transfer", r"transferr?(?:ed|ing)?(?:\s*to\s*[a-z]{2,}(?:\s*fo)?)?(?:\s*(?:date|on))?"),
    ("interview", r"interview(?:\s*(?:date|scheduled|notice|on))?"),
    ("card", r"(?:gc|green\s*card)\s*(?:card\s*)?(?:produced|mailed|delivered|received|is\s*being\s*produced)"
             r"(?:\s*(?:date|on))?"),
    ("perm_filed", r"perm\s*(?:filed|filing|submitted|submission|applied)(?:\s*(?:date|on))?"),
    ("perm_decided", r"perm\s*(?:approv\w*|certif\w*)(?:\s*(?:notice|received))?(?:\s*(?:date|on))?"),
    ("perm_audit", r"audit(?:ed)?(?:\s*(?:date|received|issued|on))?"),
    ("pd", r"pd|priority\s*date"),
    ("denied", r"not\s*certified|denial(?:\s*date)?|denied(?:\s*(?:date|on))?"),
    ("filed", r"fil(?:l)?ing(?:\s*date)?|fil(?:l)?ed(?:\s*on)?|file\s*date|submitted(?:\s*on)?|receipt(?:\s*date)?|rd"
              r"|fd|application(?:\s*date)?|date\s*of\s*(?:application|filing)|submission(?:\s*date)?|applied(?:\s*on)?"),
    # "Received": a receipt in an I-485 chat; in a PERM post it's the day the decision came, so it labels nothing there.
    ("received", r"received(?:\s*on)?"),
    ("decided", r"approv\w*(?:\s*(?:notice|received))?(?:\s*(?:date|on))?|certif\w*(?:\s*(?:date|on))?|decision(?:\s*date)?|cert\s*date"),
)
LABEL_RE = re.compile("|".join(rf"\b(?P<{name}>{pat})\b" for name, pat in LABELS), re.I)
WINDOW = 45  # characters before a date that its label may sit in

HEARSAY = re.compile(r"\b(friends?|friend's|colleagues?|co-?workers?|cousins?|someone|somebody|relatives?|dependents?|"
                     r"dependent's|daughter'?s?|sons?|son's|kids?|child(?:ren)?|parents?|mom|mother|dad|father|brother|"
                     r"sister)\b", re.I)
DATE_FIRST_SEP = re.compile(r"\s*[-\u2013\u2014:]\s*")
STEP_NEAR = 25  # a date-first step starts within this many characters after its separator
FORM_TOKEN = re.compile(r"\b(i[- ]?140|140|i[- ]?485|485|i-?129|ead|ap|gc|green\s*card|h-?1b?|h-?4|extension|visa|perm)\b",
                        re.I)
PERM_DENIED = re.compile(r"\bnot\s+certified\b|\b(?:perm|status)\b[^.!?\n]{0,20}?\b(?:denied|denial)\b", re.I)
PERM_APPROVED = re.compile(r"\bcertified\b|\bperm\b[^.!?\n]{0,20}?\bapproved\b|\bstatus\s*:?\s*approved\b", re.I)
TODAY = re.compile(r"\b(?P<word>certified|approved|denied)\s+(?:today|this\s+morning|just\s+now)\b", re.I)
TODAY_FORM = re.compile(r"\b(perm|i[- ]?140|140|i[- ]?485|485|ead|ap|gc|green\s*card)\b", re.I)
ASKING = re.compile(r"\?|\b(any\s*one|anybody|who)\b", re.I)
SUPPOSING = re.compile(r"\b(assum\w*|suppose\w*|hypothetic\w*|wonder\w*|whether)\b|\bif\s+(?:my|i|we|our|it|the|you)\b"
                       r"|\btrying\s+to\b|\bwill\s+(?:be|get)\s+(?:approved|certified)\b|\bat\s+this\s+pace\b"
                       r"|\bpredict\w*|\bestimat\w*", re.I)
CONDITIONAL = re.compile(r"\b(if|when|once|until|unless)\b", re.I)
OWN = re.compile(r"\b(my|mine|our|i'm|i am|i got|we got|got my|received my|i received)\b|"
                 r"\bstatus\s*[:\-]\s*(?:approved|certified|denied|not\s+certified)\b|"
                 r"^\W*(?:finally\W*)?(?:perm|(?:i[- ]?)?140|(?:i[- ]?)?485|gc|green\s*card)\s+(?:is\s+)?(?:certified|approved|denied)\b",
                 re.I)
# What may sit between a label and its date: punctuation and a word or two like "date", "on", "is" or "in".
BETWEEN = re.compile(r"^[\s:;=\-\u2013\u2014\uff1a,.()#*]*(?:(?:date|dt|on|is|was|in|of|at|as|notice|notification|received)\b"
                     r"[\s:;=\-\u2013\u2014\uff1a,.()#*]*){0,2}$",
                     re.I)
PREMIUM = re.compile(r"\b(pp|premium)\b", re.I)
EB = re.compile(r"\beb[- ]?([123])(?:[- ]?([abc]))?\b|\b(niw)\b", re.I)

NEEDS_YEAR = {"perm_filed", "priority_date", "pwd_filed", "pwd_issued", "i140_receipt", "i485_receipt", "perm_audit"}
AHEAD_OK = {"interview": 180, "biometrics": 180}
RECENT_DAYS = 120
ANNOUNCED_WITHIN = 60  # a post giving only a decision day tells news: that day is within two months of the post
IN_ORDER = (("pwd_filed", "pwd_issued"), ("pwd_issued", "perm_filed"), ("perm_filed", "perm_audit"),
            ("perm_audit", "perm_decided"), ("perm_filed", "perm_decided"), ("perm_decided", "i140_receipt"),
            ("i140_receipt", "i140_decided"), ("i485_receipt", "biometrics"), ("i485_receipt", "i485_decided"),
            ("i485_receipt", "transfer"), ("i485_receipt", "interview"))


def _month(word: str) -> int:
    return MONTHS[word.lower()[:3]]


def _order_of(a: int, b: int) -> str | None:
    """Which order a day like 25/03 or 03/25 settles: 'dmy', 'mdy', or None when it reads both ways."""
    if a > 12 >= b:
        return "dmy"
    if b > 12 >= a:
        return "mdy"
    return None


def _from_match(m: re.Match, order: str) -> tuple[str, bool] | None:
    """(value, has_year): 'YYYY-MM-DD' or 'YYYY-MM' with a year; 'MM-DD' without one. None when it can't be read."""
    try:
        if m.group("iso"):
            d = dt.date(int(m.group("iy")), int(m.group("im")), int(m.group("id")))
            return d.isoformat(), True
        if m.group("my"):
            mo = int(m.group("mym"))
            return (f"{m.group('myy')}-{mo:02d}", True) if 1 <= mo <= 12 else None
        if m.group("num"):
            a, b = int(m.group("a")), int(m.group("b"))
            settled = _order_of(a, b)
            if settled is None and a != b:
                if order not in ("mdy", "dmy"):
                    return None
                settled = order
            month, day = (b, a) if settled == "dmy" else (a, b)
            y = m.group("y")
            if y is None:
                dt.date(2000, month, day)  # a leap year, so Feb 29 passes here and is checked with its year later
                return f"{month:02d}-{day:02d}", False
            year = int(y) + (2000 if len(y) == 2 else 0)
            return dt.date(year, month, day).isoformat(), True
        if m.group("mdy"):
            month, day, y = _month(m.group("mn")), int(m.group("md")), m.group("mdyy")
            if y is None and not m.group("msuf") and 19 <= day <= 30:
                return None  # "aug 23" may be August 2023: a two-digit year reads the same as a day
        elif m.group("dmy"):
            month, day, y = _month(m.group("dmn")), int(m.group("dd")), m.group("dmyy")
        else:
            return f"{m.group('monyy')}-{_month(m.group('monm')):02d}", True
        if y is None:
            dt.date(2000, month, day)
            return f"{month:02d}-{day:02d}", False
        return dt.date(int(y), month, day).isoformat(), True
    except ValueError:
        return None


def parse_date(s: str, posted: dt.date, order: str) -> tuple[str, bool] | None:
    """One date written alone, read in the chat's order ('mdy', 'dmy' or 'unknown')."""
    m = DATE_RE.fullmatch(s.strip())
    return _from_match(m, order) if m else None


def chat_order(samples: list[str]) -> str:
    """The order a chat writes days in, from the days that settle it: at least 10 of them and 9 in 10 agreeing."""
    seen = {"mdy": 0, "dmy": 0}
    for s in samples:
        for m in DATE_RE.finditer(s):
            if m.group("num"):
                o = _order_of(int(m.group("a")), int(m.group("b")))
                if o:
                    seen[o] += 1
    total = seen["mdy"] + seen["dmy"]
    if total < 10:
        return "unknown"
    for o in ("mdy", "dmy"):
        if seen[o] / total >= 0.9:
            return o
    return "unknown"


def _with_year(value: str, field: str, posted: dt.date) -> str | None:
    """A month-day without a year, for a step that just happened (or an appointment ahead): the nearest such year."""
    if field in NEEDS_YEAR:
        return None
    month, day = (int(x) for x in value.split("-"))
    ahead = AHEAD_OK.get(field, 0)
    for year in (posted.year, posted.year - 1, posted.year + 1):
        try:
            d = dt.date(year, month, day)
        except ValueError:
            continue
        if -ahead <= (posted - d).days <= RECENT_DAYS:
            return d.isoformat()
    return None


def _targets(label: str, kind: str) -> list[tuple[str, str | None, str | None]]:
    """(date field, decision field, decision) for one label in one kind of chat ('perm', 'i485' or 'mixed')."""
    if label == "pd":
        return [("perm_filed" if kind == "perm" else "priority_date", None, None)]
    if label == "filed":
        return {"perm": [("perm_filed", None, None)], "i485": [("i485_receipt", None, None)]}.get(kind, [])
    if label == "received":
        return [("i485_receipt", None, None)] if kind == "i485" else []
    if label == "decided":
        return {"perm": [("perm_decided", "perm_decision", "approved")],
                "i485": [("i485_decided", "i485_decision", "approved")]}.get(kind, [])
    if label == "denied":
        return {"perm": [("perm_decided", "perm_decision", "denied")],
                "i485": [("i485_decided", "i485_decision", "denied")]}.get(kind, [])
    if label == "perm_decided":
        return [("perm_decided", "perm_decision", "approved")]
    if label == "i140_decided":
        return [("i140_decided", "i140_decision", "approved")]
    if label == "i140_rfe_issued":
        return [("i140_rfe_issued", "i140_rfe", "rfe")]
    if label == "i485_decided":
        return [("i485_decided", "i485_decision", "approved")]
    if label == "ead_ap":
        return [("ead", None, None), ("ap", None, None)]
    if label in ("ead765", "ap131"):
        return [("ead" if label == "ead765" else "ap", None, None)]
    return [(label, None, None)]


def _form_before(text: str) -> re.Match | None:
    """The form named nearest before a bare step, within 40 characters and the same sentence: whose step it is."""
    tokens = list(FORM_TOKEN.finditer(text[-60:]))
    if not tokens:
        return None
    gap = text[-60:][tokens[-1].end():]
    return tokens[-1] if len(gap) <= 40 and not re.search(r"[.!?\n]", gap) else None


def _category(text: str) -> str | None:
    found = set()
    for m in EB.finditer(text):
        if m.group(3) or (m.group(1) == "2" and m.group(2) is None and re.match(r"[- ]?niw", text[m.end():], re.I)):
            found.add("EB-2 NIW")
        elif m.group(1):
            found.add(f"EB-{m.group(1)}")
    if found == {"EB-2", "EB-2 NIW"}:
        return "EB-2 NIW"
    return found.pop() if len(found) == 1 else None


def _earlier(a: str, b: str) -> bool:
    n = min(len(a), len(b))
    return a[:n] <= b[:n]


def _bare_step(label: str, form: str | None, kind: str) -> list[tuple[str, str | None, str | None]]:
    """A bare step ("filed", "approved", "received", "denied") for the form named with it, or the chat's own kind."""
    if form is None:
        return _targets(label, kind)
    form = form.lower()
    if form == "perm":
        return _targets(label, "perm") if label != "received" else []
    named = re.sub(r"[^0-9]", "", form)
    if named not in ("140", "485"):
        return []
    step = {"decided": "decided", "denied": "decided", "filed": "receipt", "received": "receipt"}[label]
    return [(f"i{named}_{step}", f"i{named}_decision" if step == "decided" else None,
             ("denied" if label == "denied" else "approved") if step == "decided" else None)]


def _both_forms(text: str) -> bool:
    """A sentence naming both the I-140 and the I-485 can't say whose a bare step is."""
    nums = {re.sub(r"[^0-9]", "", f.group(1)) for f in FORM_TOKEN.finditer(text)}
    return {"140", "485"} <= nums


BARE = ("decided", "filed", "denied", "received")


OTHER_FORMS = re.compile(r"\b(ead|ap|combo|i[- ]?765|765|i[- ]?131|131|gc|green\s*card|h-?1b?|h-?4)\b", re.I)


def _subject_form(t: str) -> str | None:
    """The one form a post is about, for a bare step far from any form: the form its opening names, else the only one.

    Never when the post also names a work permit, a travel document or the green card itself: their approvals read
    the same ("Approved - Jan 15"), so a bare step there could be any of them."""
    if OTHER_FORMS.search(t):
        return None
    for text in (t[:40], t):
        nums = {re.sub(r"[^0-9]", "", f.group(1)) for f in FORM_TOKEN.finditer(text)} & {"140", "485"}
        if len(nums) == 1:
            return nums.pop()
        if len(nums) > 1:
            return None
    return None


def _label_before(t: str, matches: list, i: int, kind: str):
    """The step a label right before date i names ("Approval date: 07/18"), or None."""
    m = matches[i]
    prev_end = matches[i - 1].end() if i else 0
    window = t[max(prev_end, m.start() - WINDOW):m.start()]
    labels = list(LABEL_RE.finditer(window))
    if not labels or not BETWEEN.match(window[labels[-1].end():]):
        return None
    label = labels[-1].lastgroup
    if label not in BARE:
        return _targets(label, kind) or None
    label_at = m.start() - len(window) + labels[-1].start()
    sentence = t[max(t.rfind(". ", 0, label_at), t.rfind("! ", 0, label_at), t.rfind("? ", 0, label_at)) + 1:label_at]
    form = _form_before(t[:label_at])
    if form and form.group(1).lower() != "perm" and _both_forms(sentence):
        return None
    if form is None and kind == "mixed":
        return _bare_step(label, _subject_form(t), kind) or None
    return _bare_step(label, form.group(1) if form else None, kind) or None


def _label_after(t: str, matches: list, i: int, kind: str):
    """The step written right after date i, in a date-first timeline ("Oct 2023 - Perm approved"), or None."""
    m = matches[i]
    end = matches[i + 1].start() if i + 1 < len(matches) else len(t)
    seg = t[m.end():end][:60]
    sep = DATE_FIRST_SEP.match(seg)
    if not sep or not sep.group(0).strip():
        return None
    seg = seg[sep.end():]
    labels = [lb for lb in LABEL_RE.finditer(seg) if lb.start() <= STEP_NEAR]
    if not labels:
        return None
    label = labels[0].lastgroup
    if label not in BARE:
        return _targets(label, kind) or None
    if _both_forms(seg):
        return None
    forms = list(FORM_TOKEN.finditer(seg))
    return _bare_step(label, forms[0].group(1) if forms else None, kind) or None


def _is_pd_label(t: str, matches: list, i: int) -> bool:
    m = matches[i]
    prev_end = matches[i - 1].end() if i else 0
    labels = list(LABEL_RE.finditer(t[max(prev_end, m.start() - WINDOW):m.start()]))
    return bool(labels) and labels[-1].lastgroup == "pd"


DATE_KEYS = ("pwd_filed", "pwd_issued", "perm_filed", "perm_audit", "perm_decided", "priority_date", "i140_receipt",
             "i140_rfe_issued", "i140_rfe_answered", "i140_decided", "i485_receipt", "biometrics", "ead", "ap", "transfer",
             "interview", "i485_decided", "card")


def sound(out: dict, posted: dt.date, own: bool) -> bool:
    """The checks every reading of a post must pass, however it was read.

    A date, and either a second date or a decision the poster gives as their own; no date before 2000 or after the post
    (an appointment may be ahead); a lone decision day within two months of the post; the steps in order."""
    dates = [f for f in DATE_KEYS if out.get(f)]
    decisions = [f for f in out if f.endswith("_decision")]
    if not dates or (len(dates) < 2 and not (decisions and own)):
        return False
    for f in dates:
        v = out[f]
        if v[:4] < "2000":
            return False
        if len(v) == 10:
            if (dt.date.fromisoformat(v) - posted).days > AHEAD_OK.get(f, 1):
                return False
        elif v > posted.isoformat()[:7] and f not in AHEAD_OK:
            return False
    if len(dates) == 1 and dates[0].endswith("_decided") and len(out[dates[0]]) == 10 \
            and (posted - dt.date.fromisoformat(out[dates[0]])).days > ANNOUNCED_WITHIN:
        return False  # "Perm certified: 7/14/23" posted a year later is a filing day, written after the news
    return all(_earlier(out[a], out[b]) for a, b in IN_ORDER if a in out and b in out)


RELATIVE = {"today": 0, "this morning": 0, "tonight": 0, "yesterday": 1}


def written_dates(text: str, posted: dt.date) -> set[str]:
    """Every date a post writes, read every plausible way: a reading that returns a date outside this set made it up.

    A day that reads both ways gives both; a day without a year gives the post's year and the years either side; a day
    also gives its month; "today" and "yesterday" give the post's day and the day before."""
    explicit, yearless = dates_written(text, posted)
    return explicit | yearless


def dates_written(text: str, posted: dt.date) -> tuple[set[str], set[str]]:
    """written_dates, split: (the readings of dates written with a year, "today" and "yesterday" among them; the
    readings a day without a year gives). A reading in the second set alone took its year from the post."""
    t = " ".join((text or "").split())
    found: set[str] = set()
    yearless: set[str] = set()
    for m in DATE_RE.finditer(t):
        if m.group("mdy") and not m.group("mdyy") and not m.group("msuf"):
            # "March 19" is a day here as well as a possible month and year: a guard takes every reading.
            month, day = _month(m.group("mn")), int(m.group("md"))
            for year in (posted.year - 1, posted.year, posted.year + 1):
                try:
                    d = dt.date(year, month, day).isoformat()
                    yearless.update({d, d[:7]})
                except ValueError:
                    pass
        for order in ("mdy", "dmy"):
            read = _from_match(m, order)
            if read is None:
                continue
            value, has_year = read
            values = [value] if has_year else []
            if not has_year:
                month, day = (int(x) for x in value.split("-"))
                for year in (posted.year - 1, posted.year, posted.year + 1):
                    try:
                        values.append(dt.date(year, month, day).isoformat())
                    except ValueError:
                        pass
            for v in values:
                (found if has_year else yearless).update({v, v[:7]})
    low = t.lower()
    for word, back in RELATIVE.items():
        if re.search(rf"\b{word}\b", low):
            d = posted - dt.timedelta(days=back)
            found.update({d.isoformat(), d.isoformat()[:7]})
    return found, yearless


def read_post(text: str, posted: dt.date, kind: str, order: str) -> dict | None:
    """The merge's fields from one person's post about their own case, or None. kind: 'perm', 'i485' or 'mixed'."""
    t = " ".join((text or "").split())
    if not t or HEARSAY.search(t) or SUPPOSING.search(t):
        return None
    matches = list(DATE_RE.finditer(t))
    settles = {o for m in matches if m.group("num") for o in [_order_of(int(m.group("a")), int(m.group("b")))] if o}
    if len(settles) > 1:
        return None
    post_order = settles.pop() if settles else order
    out: dict[str, str] = {}

    def put(field: str, value: str) -> bool:
        if out.get(field, value) != value:
            return False
        out[field] = value
        return True

    before = [_label_before(t, matches, i, kind) for i in range(len(matches))]
    after = [_label_after(t, matches, i, kind) for i in range(len(matches))]
    date_first = sum(a is not None for a in after) >= 2 and sum(a is not None for a in after) > sum(
        b is not None for b in before)
    for i, m in enumerate(matches):
        targets = after[i] if date_first else before[i]
        if date_first and targets is None and _is_pd_label(t, matches, i):
            targets = before[i]
        if not targets:
            continue
        read = _from_match(m, post_order)
        if read is None:
            continue
        value, has_year = read
        for field, decision_field, decision in targets:
            v = value if has_year else _with_year(value, field, posted)
            if v is None:
                continue
            if v[:4] < "2000":
                return None
            if len(v) == 10:
                ahead = (dt.date.fromisoformat(v) - posted).days
                if ahead > AHEAD_OK.get(field, 1):
                    return None
            elif v > posted.isoformat()[:7] and field not in AHEAD_OK:
                return None
            if not put(field, v):
                return None
            if decision_field and not put(decision_field, decision):
                return None

    for m in TODAY.finditer(t):
        start = max(t.rfind(". ", 0, m.start()), t.rfind("! ", 0, m.start()), t.rfind("? ", 0, m.start())) + 1
        sentence = re.split(r"(?<=[.!?])\s", t[start:], maxsplit=1)[0]
        if ASKING.search(sentence) or CONDITIONAL.search(sentence):
            continue
        near = list(TODAY_FORM.finditer(t[max(start, m.start() - 30):m.start()]))
        form = near[-1].group(1).lower().replace(" ", "").replace("-", "") if near else ""
        if form in ("ap",):
            continue
        word = m.group("word").lower()
        field = {"perm": "perm", "i140": "i140", "140": "i140", "i485": "i485", "485": "i485", "gc": "i485",
                 "greencard": "i485", "ead": "ead"}.get(
            form, "perm" if kind == "perm" and word == "certified" or (kind == "perm" and not form) else None)
        if field == "ead":
            out.setdefault("ead", posted.isoformat())
        elif field:
            out.setdefault(f"{field}_decided", posted.isoformat())
            out.setdefault(f"{field}_decision", "denied" if word == "denied" else "approved")

    if kind == "perm" and "perm_decision" not in out:
        for pattern, decision in ((PERM_DENIED, "denied"), (PERM_APPROVED, "approved")):
            hit = pattern.search(t)
            near = _form_before(t[:hit.start()]) if hit else None
            if hit and not (near and near.group(1).lower() != "perm"):
                out["perm_decision"] = decision
                break

    if not sound(out, posted, own=bool(OWN.search(t)) and not ASKING.search(t)):
        return None
    category = _category(t)
    if category:
        out["category"] = category
    if PREMIUM.search(t) and any(f.startswith("i140") for f in out):
        out["premium"] = "yes"
    return out

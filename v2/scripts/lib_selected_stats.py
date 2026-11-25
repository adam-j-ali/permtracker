"""DOL's quarterly "Selected Statistics" sheets for PERM and wage requests, read strictly (Batch 4, Nov 25 2026).

Each is a one-page PDF on OFLC's performance page (https://www.dol.gov/agencies/eta/foreign-labor/performance):
the fiscal year's applications received, the determinations by outcome, each by quarter, and what was still pending
on the sheet's date. They're the official count our own figures are scored against: our live census against
"applications remaining", our quarterly decisions against DOL's certified, denied and withdrawn.

The text comes out with the sheet's columns interleaved, so every figure is read from a line anchored on its own
label, and the sheet checks itself: a row's quarters add up to its year (the sheets say "All figures are rounded",
so within ROUNDING cases), certified plus denied plus withdrawn is the total, the number of quarters matches the
"Data as of" date, and the pending date matches it too. Anything missing or inconsistent raises SelectedStatsError
with the reason; a guessed number is worse than none.
"""

from __future__ import annotations

import re

NUM = r"\d{1,3}(?:,\d{3})*"
# "All figures are rounded": a quarter row may miss its year by a case or two.
ROUNDING = 3
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
     "December"], start=1)}
# A federal fiscal year's quarters end in December, March, June and September.
QUARTER_BY_MONTH = {12: 1, 3: 2, 6: 3, 9: 4}


class SelectedStatsError(ValueError):
    """The sheet didn't read the way it must; the message says which part."""


def _int(s: str) -> int:
    return int(s.replace(",", ""))


def _fiscal_year(text: str) -> int:
    m = re.search(r"Selected Statistics, Fiscal Year \(FY\) (\d{4})", text)
    if not m:
        raise SelectedStatsError("no 'Selected Statistics, Fiscal Year (FY) YYYY' title")
    return int(m.group(1))


def _as_of(text: str) -> tuple[str, int]:
    """The sheet's date as an ISO day, and the fiscal quarter it closes."""
    m = re.search(r"Data as of (" + "|".join(MONTHS) + r") (\d{1,2}), (\d{4})\.", text)
    if not m:
        raise SelectedStatsError("no 'Data as of Month D, YYYY.' line")
    month = MONTHS[m.group(1)]
    if month not in QUARTER_BY_MONTH:
        raise SelectedStatsError(f"'Data as of' {m.group(1)} doesn't close a fiscal quarter")
    return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(2)):02d}", QUARTER_BY_MONTH[month]


def _row(text: str, label: str, quarters: int) -> dict:
    """A labelled row: the year's figure, then one per quarter so far."""
    m = re.search(rf"^{re.escape(label)} ({NUM}((?: {NUM}){{{quarters}}}))(?: |$)", text, re.M)
    if not m:
        raise SelectedStatsError(f"no '{label}' row with a year and {quarters} quarters")
    year = _int(m.group(1).split(" ")[0])
    by_quarter = [_int(x) for x in m.group(2).split()]
    return {"year": year, "quarters": by_quarter}


def _sums(name: str, row: dict) -> None:
    if abs(sum(row["quarters"]) - row["year"]) > ROUNDING:
        raise SelectedStatsError(f"'{name}' quarters add to {sum(row['quarters']):,}, not its year's {row['year']:,}")


def _us_day(month: str, day: str, year: str) -> str:
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def parse_perm(text: str) -> dict:
    """The PERM sheet: received, certified, denied, withdrawn and total by quarter, and applications remaining."""
    if "Permanent Employment Program" not in text:
        raise SelectedStatsError("not the Permanent Employment Program sheet")
    fy = _fiscal_year(text)
    as_of, quarters = _as_of(text)
    rec = re.search(rf"^({NUM})((?: {NUM}){{{quarters}}}) ([+-]?\d+(?:\.\d+)?)%", text, re.M)
    if not rec:
        raise SelectedStatsError(f"no applications-received row with a year, {quarters} quarters and a change")
    received = {"year": _int(rec.group(1)), "quarters": [_int(x) for x in rec.group(2).split()],
                "changePct": float(rec.group(3))}
    rows = {name: _row(text, label, quarters) for name, label in
            (("certified", "Certified"), ("denied", "Denied"), ("withdrawn", "Withdrawn"))}
    for name, row in [("received", received), *rows.items()]:
        _sums(name, row)
    parts = {"year": sum(r["year"] for r in rows.values()),
             "quarters": [sum(q) for q in zip(*(r["quarters"] for r in rows.values()))]}
    # Sheets through FY2024 print no Total row: the total is then the three outcomes added, and says so.
    try:
        total = _row(text, "Total", quarters)
    except SelectedStatsError:
        total = {**parts, "derived": True}
    if abs(parts["year"] - total["year"]) > ROUNDING:
        raise SelectedStatsError(f"certified, denied and withdrawn add to {parts['year']:,}, not the total {total['year']:,}")
    rows["total"] = total
    rem = re.search(rf"({NUM}) applications remaining as of (\d{{1,2}})/(\d{{1,2}})/(\d{{4}})", text)
    if not rem:
        raise SelectedStatsError("no 'N applications remaining as of M/D/YYYY' line")
    if _us_day(rem.group(2), rem.group(3), rem.group(4)) != as_of:
        raise SelectedStatsError(f"applications remaining are dated {rem.group(2)}/{rem.group(3)}/{rem.group(4)}, not {as_of}")
    return {"program": "perm", "fy": fy, "quarter": quarters, "asOf": as_of, "received": received, **rows,
            "remaining": _int(rem.group(1))}


def parse_pw(text: str) -> dict:
    """The wage request sheet: PERM's and every program's requests received, determinations, withdrawals and pending."""
    if "Prevailing Wage Program" not in text:
        raise SelectedStatsError("not the Prevailing Wage Program sheet")
    fy = _fiscal_year(text)
    as_of, quarters = _as_of(text)

    def received(label: str) -> dict:
        m = re.search(rf"^{re.escape(label)} ({NUM})((?: {NUM}){{{quarters}}}) ([+-]?\d+(?:\.\d+)?)%", text, re.M)
        if not m:
            raise SelectedStatsError(f"no '{label}' requests-received row")
        row = {"year": _int(m.group(1)), "quarters": [_int(x) for x in m.group(2).split()], "changePct": float(m.group(3))}
        _sums(f"{label} received", row)
        return row

    perm, total = received("PERM"), received("TOTAL")
    determinations = _row(text, "Total Determinations", quarters)
    withdrawn = _row(text, "Withdrawn", quarters)
    for name, row in (("determinations", determinations), ("withdrawn", withdrawn)):
        _sums(name, row)
    pending = _row(text, "Pending", quarters)
    # Pending is a count on each quarter's last day, not a sum: the year's figure is the last quarter's.
    if pending["year"] != pending["quarters"][-1]:
        raise SelectedStatsError(f"pending for the year ({pending['year']:,}) isn't the last quarter's ({pending['quarters'][-1]:,})")
    rem = re.search(rf"({NUM}) Determinations Remaining as of (\d{{1,2}})/(\d{{1,2}})/(\d{{4}})", text)
    if not rem:
        raise SelectedStatsError("no 'N Determinations Remaining as of M/D/YYYY' line")
    if _us_day(rem.group(2), rem.group(3), rem.group(4)) != as_of or _int(rem.group(1)) != pending["year"]:
        raise SelectedStatsError("the determinations remaining line disagrees with the pending row or the sheet's date")
    return {"program": "pw", "fy": fy, "quarter": quarters, "asOf": as_of, "receivedPerm": perm, "receivedAll": total,
            "determinations": determinations, "withdrawn": withdrawn, "pending": pending}

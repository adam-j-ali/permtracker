#!/usr/bin/env python3
"""Load the public community sheets people keep their own green card cases in (scripts/data/community_sheets.json).

WHY: people waiting on an I-485 at one USCIS field office keep a shared Google Sheet of their own dates (receipt,
biometrics, the move to the office, approval). The "San Fernando Filers" sheet held 131 cases on Nov 19 2026, against
a handful of timelines shared with this site for every office together, so every such sheet is read.

WHAT GOES IN, AND WHAT NEVER DOES. Every case's dates, category, country, current visa and the yes-or-no columns. The
two columns that point to a person never leave the sheet: the Reddit username and the receipt-number prefix. Rows
are numbered in the sheet's own order, so a reload replaces the set without keeping any key that names anyone.

A SHEET ANYONE CAN EDIT IS A SOURCE THAT CAN BE EMPTIED. A sheet whose headers changed, that holds fewer rows than its
floor, or that lost more than half of what is stored, is refused: the stored copy stays, the run ends red and the
refusal names the reason. Nothing is ever deleted before the new rows are in.

    python3 scripts/ingest_community_sheets.py                 # every sheet, write and refresh the office pages
    python3 scripts/ingest_community_sheets.py --dry-run       # read and parse, write nothing
    python3 scripts/ingest_community_sheets.py --from-file F --sheet sfv-filers --dry-run
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
from lib_days import today_et  # noqa: E402 - the scripts folder is on the path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "community_sheets.json")
# Each sheet's parse settings (its tabs, header names, required fields, row floor and defaults) are private: the file
# --parse or COMMUNITY_SHEETS_PARSE names ({"sheets": {key: {...}}}), on the server beside the job's other settings.
# The public list above holds what the site shows: each sheet's name, office, link and where it was shared.
PARSE_ENV = "COMMUNITY_SHEETS_PARSE"
PARSE_FIELDS = ("gid", "tabs", "headers", "required", "min_rows", "category", "post")
TABLE = "community_case_reports"
SCRIPT = "ingest_community_sheets.py"
# A stored copy is replaced only by a sheet holding at least this share of it: vandalism or a bad export never wins.
KEEP_SHARE = 0.5
PAUSE = 1.2  # seconds between one sheet's tab exports, so the hourly read stays a polite one
# The run's own deadline, under the workflow step's 20 minutes: a run that's slow stops on its own, names the sheets
# it didn't reach and ends red, so a timeout never kills it before the failure is recorded.
DEADLINE_S = 15 * 60

# Each column by what its header means, matched on the header lowercased with everything but letters and digits as
# spaces ("I-485 Received\nDate (RD)" reads "i 485 received date rd"). The sheets word the same column many ways
# ("RD", "Receipt / Filing Date", "receipt_date"), and the words that mean something else stay apart: "GC Received
# Date" is the card, never the receipt; "Status" is a case's status in one sheet and its category in another, so it
# means the category only where a sheet's config says so. The first pattern a header fits wins, and each field takes
# the first column that fits it.
SKIP = re.compile(r"\b(dependent|derivative|i 485j|days|counter|since|percentile|estimate|p\d\d|user|username|"
                  r"comments?|notes?|questions?|discord|reddit|block|lockbox|submission|notice|why|display)\b|^name$")
PATTERNS: tuple[tuple[str, re.Pattern], ...] = tuple((f, re.compile(p)) for f, p in (
    ("card_date", r"^(gc|green card|card) (received|receive|in hand)( date)?$|^card received"),
    ("post", r"^(u s )?(embassy|consulate)( or consulate)?$|^u s embassy or consulate$|^consulate$"),
    ("nvc_complete", r"documentarily qualified|^dq( date)?$|^date dq"),
    ("consular_scheduled", r"^interview letter|^date interview assigned"),
    ("visa_issued", r"^visa (ready|issued)( date)?$"),
    ("i140_approval_date", r"^i 140 approv(al|ed)( date)?$"),
    ("approval_date", r"^(gc |green card |i 485 |primary s )?(approval( close)?( date)?|approved( close)? date|"
                      r"approved on( if approved)?)$|^date approved$"),
    ("receipt_date", r"^(i 485 )?(received|receipt|receive|filing|rd)( date)?( rd)?$|^receipt filing date$|^rd$"),
    ("priority_date", r"^(i 140 )?(priority date|pd)( pd)?$"),
    ("category", r"^(eb )?category$|^eb type$|^eb1 2 3$|^visa category$|^eb category$"),
    ("visa_status", r"^(underlying|underlaying|current visa) status$"),
    ("visa_availability", r"^visa availability$"),
    ("biometrics_date", r"^(biometric|biometrics|bio|fingerprints?)( date| done| appointment)?$"),
    ("ead_date", r"^ead( and ap| ap)?( i 765)?( approval| approved)?( date)?( if applied)?( primary)?$"
                 r"|^ap ead (received|approval|approved)( date)?$"),
    ("transfer_date", r"transfer"),
    ("moved_to", r"^fo if moved"),
    ("office", r"^(latest )?(field office|fo|office|local office)( name)?( local non local)?$"),
    ("still_here", r"^case still at\b"),
    ("interview_date", r"^interview( date)?( if any)?$|^interview yes or no$|^date of interview$"),
    ("silent_updates", r"^silent (api )?updates?"),
    ("fta0", r"^(3rd|third)( or 4th| or latest)?( fta0| fta)?|^fta ?0|^fta updates"),
    ("fta1", r"^(recent )?fta ?1"),
    ("rfe", r"^rfe"),
    ("dependent", r"^dependent$"),
    ("row", r"^row( non row| nrow)?$"),
    ("country", r"^country( of birth| of chargeability)?$|^chargeability$"),
    ("valid_as_of", r"^(information )?valid as of|^last updated"),
))
DEFAULT_REQUIRED = ("receipt_date",)
COLUMNS = ("source", "row_no", "office", "category", "visa_availability", "visa_status", "chargeability", "country",
           "priority_date", "priority_note", "receipt_date", "biometrics_date", "transfer_date", "silent_updates",
           "fta0", "fta1", "rfe", "dependent", "approval_date", "card_date", "valid_as_of", "interview_date",
           "ead_date", "i140_approval_date", "i140_receipt_date", "post", "nvc_complete", "consular_scheduled",
           "visa_issued", "fetched_at")

CATEGORIES = {"eb1": "EB-1", "eb1a": "EB-1", "eb1b": "EB-1", "eb1c": "EB-1", "eb2": "EB-2", "eb2niw": "EB-2 NIW",
              "niw": "EB-2 NIW", "eb2nationalinterestwaiver": "EB-2 NIW", "eb3": "EB-3", "eb3skilled": "EB-3",
              "eb3unskilled": "EB-3", "eb3professional": "EB-3", "eb3ew": "EB-3", "ew": "EB-3",
              "eb3otherworkers": "EB-3", "eb2perm": "EB-2", "eb3perm": "EB-3", "marriage": "Family",
              "marriagebased": "Family", "familybased": "Family", "family": "Family", "ir1": "Family", "cr1": "Family"}
CHARGEABILITY = {"india": "india", "china": "china", "mexico": "mexico", "philippines": "philippines"}


class Refused(Exception):
    """The sheet can't be stored as it stands; the stored copy stays."""


def norm(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower())


def header_key(h: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (h or "").lower())).strip()


def column_map(header: list[str], sheet: dict | None = None) -> dict[str, int]:
    """Each field's column in a header row: the sheet's own names first (its config's "headers"), then the patterns."""
    named = {f: {header_key(n) for n in names} for f, names in ((sheet or {}).get("headers") or {}).items()}
    out: dict[str, int] = {}
    for i, h in enumerate(header):
        k = header_key(h)
        if not k:
            continue
        # A sheet's own names match a header exactly or as its opening words ("11 rd date" for "11. RD date 您的...").
        own = [f for f, names in named.items() if (f == "ignore" or f not in out)
               and any(k == n or k.startswith(n + " ") for n in names)]
        if own:
            if own[0] != "ignore":
                out[own[0]] = i
            continue
        if SKIP.search(k) and k != "dependent":
            continue
        for field, pattern in PATTERNS:
            if field in named:
                continue  # the sheet names this field's column itself
            if pattern.search(k):
                if field not in out:
                    out[field] = i
                break
    return out


def find_header(rows: list[list[str]], sheet: dict, tab: str) -> tuple[int, dict[str, int]]:
    """The header row (a tab may carry a banner above it) and its columns, or Refused naming what's missing."""
    required = tuple(sheet.get("required") or DEFAULT_REQUIRED)
    for i, r in enumerate(rows[:15]):
        cols = column_map(r, sheet)
        if all(f in cols for f in required):
            return i, cols
    first = next((r for r in rows if any(c.strip() for c in r)), [])
    raise Refused(f"the sheet's columns changed: tab {tab!r} has no {', '.join(required)} column in "
                  f"{[c for c in first if c.strip()][:20]}")


def parse_date(v: str) -> str | None:
    """A whole date as a sheet writes it (11/15/2026, 11/15/26, 11-15-2026, 2026-11-15, Nov 15, 2026), or None."""
    v = (v or "").strip()
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})", v)
    if m:
        mo, d, y = int(m[1]), int(m[2]), int(m[3])
        y = y + 2000 if y < 100 else y
        try:
            return dt.date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = re.fullmatch(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?", v)
    if m:
        try:
            return dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return None
    if re.search(r"[a-z]", v, re.I) and re.search(r"\b20\d{2}\b", v):
        import lib_post_dates
        got = lib_post_dates.parse_date(v, today_et(), "mdy")
        if got and got[1] and len(got[0]) == 10:
            return got[0]
    return None


FULL_DATE = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2})\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b")
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def cell_date(v: str) -> str | None:
    """A cell's date: the whole cell, or the first full date written in it ("EAD & AP 6/12/2026", "6/12/2026 (primary),
    6/15/26 (derivative)": the applicant's own comes first). A day without a year gives nothing."""
    whole = parse_date(v)
    if whole:
        return whole
    m = FULL_DATE.search(v or "")
    return parse_date(m.group(0)) if m else None


def month_of(v: str) -> str | None:
    """A month and year alone ("2023-Mar", "Mar 2023", "03/2023", "2023-03") as YYYY-MM, or None."""
    v = (v or "").strip().lower()
    m = (re.fullmatch(r"(\d{4})[-/ ]([a-z]{3})[a-z]*", v) or re.fullmatch(r"([a-z]{3})[a-z]*\.?,?[-/ ](\d{4})", v))
    if m:
        year, mon = (m[1], m[2]) if m[1].isdigit() else (m[2], m[1])
        return f"{year}-{MONTHS.index(mon) + 1:02d}" if mon in MONTHS else None
    m = re.fullmatch(r"(\d{1,2})[-/](\d{4})", v) or re.fullmatch(r"(\d{4})[-/](\d{1,2})", v)
    if m:
        year, month = (m[2], m[1]) if len(m[1]) <= 2 else (m[1], m[2])
        return f"{year}-{int(month):02d}" if 1 <= int(month) <= 12 else None
    return None


def category_of(raw: str) -> str | None:
    k = re.sub(r"[^a-z0-9]", "", (raw or "").lower())
    if not k:
        return None
    if k in CATEGORIES:
        return CATEGORIES[k]
    for prefix, cat in (("eb2niw", "EB-2 NIW"), ("eb1", "EB-1"), ("eb2", "EB-2"), ("eb3", "EB-3")):
        if k.startswith(prefix):
            return cat
    # A family category as a consulate sheet writes it ("IR-1: Spouse of a U.S. Citizen", "F2A: ...", "CR-1").
    if re.match(r"(ir|cr)\d|f(1|2a|2b|3|4)", k):
        return "Family"
    return None


def month_days(v: str, after: str | None, before: str) -> list[str]:
    """The "10/12, 10/20" days a cell lists without a year, each placed in the year that falls between `after` (the
    receipt) and `before` (the row's as-of day). A day that fits neither of the two candidate years is left out."""
    out: list[str] = []
    for mo, d, y in re.findall(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", v or ""):
        if y:
            iso = parse_date(f"{mo}/{d}/{y}")
            if iso:
                out.append(iso)
            continue
        hi = dt.date.fromisoformat(before)
        for year in (hi.year, hi.year - 1):
            try:
                c = dt.date(year, int(mo), int(d))
            except ValueError:
                break
            if c <= hi and (after is None or c.isoformat() >= after):
                out.append(c.isoformat())
                break
    return sorted(set(out))


def yes_with_day(v: str, after: str | None, before: str) -> str | None:
    """"Yes (10/12)" as "yes 2026-10-12", "Yes" as "yes", "No" as "no", anything else as None."""
    n = norm(v)
    if not n:
        return None
    if n.startswith("no"):
        return "no"
    days = month_days(v, after, before)
    if n.startswith("yes") or days:
        return "yes" + (f" {days[0]}" if days else "")
    return None


def parse_tab(rows: list[list[str]], sheet: dict, today: str, tab: str, counts: dict,
              tab_office: str | None = None) -> list[dict]:
    """One tab's cases, unnumbered. A tab that is one office's (LA, LA County) gives that office to a row naming none."""
    head, cols = find_header(rows, sheet, tab)
    cell = lambda r, f: (r[cols[f]].strip() if f in cols and cols[f] < len(r) else "")  # noqa: E731
    out: list[dict] = []
    # A step after the priority date: a row with only a priority date isn't a case yet (the I-485 not yet filed).
    dated = ("receipt_date", "biometrics_date", "transfer_date", "approval_date", "card_date", "interview_date",
             "ead_date", "i140_approval_date", "i140_receipt_date", "nvc_complete", "consular_scheduled", "visa_issued")
    for r in rows[head + 1:]:
        if not any(c.strip() for c in r):
            continue
        counts["read"] += 1
        receipt = parse_date(cell(r, "receipt_date"))
        category_raw = cell(r, "category")
        if not any(cell_date(cell(r, f)) for f in dated):
            counts["empty"] += 1  # a row with no date gives the merge nothing
            continue
        valid = parse_date(cell(r, "valid_as_of"))
        # A day listed without a year falls on or before the row's own as-of day (today when it has none).
        before = valid if valid and valid <= today else today
        pd_raw = cell(r, "priority_date")
        pd = parse_date(pd_raw) or month_of(pd_raw)
        if pd_raw and not pd:
            counts["priority_words"] += 1
        for f in ("biometrics_date", "transfer_date", "approval_date", "card_date", "interview_date", "ead_date"):
            v = cell(r, f)
            if v and re.search(r"\d", v) and not cell_date(v):
                counts["bad_dates"] += 1  # a day written without its year, or a shape no rule reads
        country = cell(r, "country")
        row_word = norm(cell(r, "row"))
        dep = norm(cell(r, "dependent"))
        office = tab_office or sheet.get("office")
        if "office" in cols:
            from lib_offices import office_code
            written = cell(r, "office")
            office = office_code(written) or (office if not written else None)
            if written and office is None:
                counts["unknown_offices"] = counts.get("unknown_offices", 0) + 1
        post = sheet.get("post")
        if "post" in cols:
            from lib_posts import post_key
            post = post_key(cell(r, "post")) or (post if not cell(r, "post") else None)
            if cell(r, "post") and post is None:
                counts["unknown_posts"] = counts.get("unknown_posts", 0) + 1
        if norm(cell(r, "still_here")).startswith("no"):
            office = None  # the case moved on from the sheet's office, to one the sheet doesn't name
        if cell(r, "moved_to"):
            from lib_offices import office_code
            office = office_code(cell(r, "moved_to"))  # moved away: the office it moved to, when that reads
        if norm(category_raw) in ("row", "nrow", "non row", "non-row"):
            # Some sheets keep ROW/NROW (rest of world or not) under "Category": that's chargeability.
            row_word, category_raw = norm(category_raw), ""
        category = category_of(category_raw) or sheet.get("category")
        if category_raw and category is None:
            counts["unknown_categories"] = counts.get("unknown_categories", 0) + 1
        chargeability = CHARGEABILITY.get(norm(country), "row" if country else None)
        if chargeability is None and norm(cell(r, "born_in_china")).startswith("yes"):
            chargeability = "china"
        if chargeability is None and row_word in ("row", "yes"):
            chargeability = "row"
        out.append({
            "source": sheet["key"], "office": office or "",
            "category": category,
            "visa_availability": cell(r, "visa_availability") or None,
            "visa_status": cell(r, "visa_status") or None,
            "chargeability": chargeability,
            "country": country or None,
            "priority_date": pd, "priority_note": None if pd else (pd_raw or None),
            "receipt_date": receipt,
            "biometrics_date": cell_date(cell(r, "biometrics_date")),
            "transfer_date": cell_date(cell(r, "transfer_date")),
            "silent_updates": json.dumps(month_days(cell(r, "silent_updates"), receipt, before)),
            "fta0": yes_with_day(cell(r, "fta0"), receipt, before),
            "fta1": yes_with_day(cell(r, "fta1"), receipt, before),
            "rfe": yes_with_day(cell(r, "rfe"), receipt, before),
            "dependent": 1 if dep.startswith("y") else 0 if dep.startswith("n") else None,
            "approval_date": cell_date(cell(r, "approval_date")),
            "card_date": cell_date(cell(r, "card_date")),
            "valid_as_of": valid,
            "interview_date": cell_date(cell(r, "interview_date")),
            "ead_date": cell_date(cell(r, "ead_date")),
            "i140_approval_date": cell_date(cell(r, "i140_approval_date")),
            "i140_receipt_date": cell_date(cell(r, "i140_receipt_date")),
            "post": post,
            "nvc_complete": cell_date(cell(r, "nvc_complete")),
            "consular_scheduled": cell_date(cell(r, "consular_scheduled")),
            "visa_issued": cell_date(cell(r, "visa_issued")),
        })
    return out


def parse_tabs(tabs: list[tuple], sheet: dict, today: str) -> tuple[list[dict], dict]:
    """Every chosen tab's cases, numbered across the tabs in their order, and a count of what was read. Each tab is
    (name, export) or (name, export, the tab's own office)."""
    counts = {"read": 0, "empty": 0, "priority_words": 0, "bad_dates": 0, "tabs": len(tabs)}
    out: list[dict] = []
    for tab in tabs:
        name, data = tab[0], tab[1]
        rows = list(csv.reader(io.StringIO(data.decode("utf-8", errors="replace"))))
        if not rows:
            raise Refused(f"tab {name!r}: the export was empty")
        out += parse_tab(rows, sheet, today, name, counts, tab[2] if len(tab) > 2 else None)
    for i, r in enumerate(out, 1):
        r["row_no"] = i
    if len(out) < sheet.get("min_rows", 1):
        raise Refused(f"{len(out)} cases, under the sheet's floor of {sheet.get('min_rows', 1)}")
    return out, counts


def parse_sheet(data: bytes, sheet: dict, today: str) -> tuple[list[dict], dict]:
    """A one-tab sheet's cases (the export of one gid)."""
    return parse_tabs([(sheet.get("gid", "0"), data)], sheet, today)


def ensure_table(db) -> None:
    # TABLE is this module's constant, never input.
    # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query
    db.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        source TEXT NOT NULL, row_no INTEGER NOT NULL, office TEXT NOT NULL, category TEXT, visa_availability TEXT,
        visa_status TEXT, chargeability TEXT, country TEXT, priority_date TEXT, priority_note TEXT, receipt_date TEXT,
        biometrics_date TEXT, transfer_date TEXT, silent_updates TEXT, fta0 TEXT, fta1 TEXT, rfe TEXT,
        dependent INTEGER, approval_date TEXT, card_date TEXT, valid_as_of TEXT, fetched_at INTEGER NOT NULL,
        PRIMARY KEY (source, row_no))""")
    # Columns added Nov 19 2026 for the sheets that hold more steps: an older table gains them before the first write.
    from lib_db import add_missing_columns
    add_missing_columns(db, TABLE, {c: "TEXT" for c in ("interview_date", "ead_date", "i140_approval_date",
                                                         "i140_receipt_date", "post", "nvc_complete",
                                                         "consular_scheduled", "visa_issued")})
    # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query
    db.execute(f"CREATE INDEX IF NOT EXISTS {TABLE}_office ON {TABLE} (office, transfer_date)")


def write(db, sheet: dict, rows: list[dict], force: bool = False) -> int:
    """Replace one sheet's rows: the new ones in first, then the stored rows past the new count out."""
    from lib_db import query_rows, stmt
    stored = int(query_rows(db, f"SELECT count(*) FROM {TABLE} WHERE source = ?", [sheet["key"]])[0][0] or 0)  # nosemgrep
    if stored and len(rows) < stored * KEEP_SHARE and not force:
        raise Refused(f"{len(rows)} cases against {stored} stored: more than half gone, so the stored copy stays "
                      f"(run with --force once the sheet is checked)")
    stamp = int(time.time() * 1000)
    placeholders = ", ".join("?" * len(COLUMNS))
    reqs = [stmt(f"INSERT OR REPLACE INTO {TABLE} ({', '.join(COLUMNS)}) VALUES ({placeholders})",  # nosemgrep
                 [*(r[c] for c in COLUMNS[:-1]), stamp]) for r in rows]
    reqs.append(stmt(f"DELETE FROM {TABLE} WHERE source = ? AND row_no > ?", [sheet["key"], len(rows)]))  # nosemgrep
    for i in range(0, len(reqs), 200):
        db.pipeline(reqs[i:i + 200])
    return len(rows)


def chosen_tabs(sheet: dict, listed: list[tuple[str, str]]) -> list[tuple[str, str, str | None]]:
    """The tabs a sheet's config asks for, from the sheet's own list of (name, gid): (name, gid, the tab's office). A
    pattern that matches no tab refuses the sheet, so a renamed tab never passes for an empty one."""
    out = []
    for spec in sheet["tabs"]:
        hits = [(n, g) for n, g in listed if re.search(spec["match"], n.strip(), re.I)]
        if not hits:
            raise Refused(f"no tab matches {spec['match']!r} in {[n for n, _ in listed][:30]}")
        out += [(n, g, spec.get("office")) for n, g in hits]
    return out


def _js_string(text: str) -> str:
    """A JavaScript string literal's text as it reads: Google writes "June '25" as June \\x2725 on the sheet's page."""
    def one(m: re.Match) -> str:
        e = m.group(1)
        if e[0] in "xu" and len(e) > 1:
            return chr(int(e[1:], 16))
        return {"n": "\n", "t": "\t"}.get(e, e)
    return re.sub(r"\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)", one, text)


def tabs_in(page: str) -> list[tuple[str, str]]:
    """The (name, gid) of every tab a sheet's public page lists."""
    import html as html_lib
    found = re.findall(r'items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"', page)
    return [(html_lib.unescape(_js_string(n)), g) for n, g in found]


def list_tabs(sheet_id: str) -> list[tuple[str, str]]:
    """A sheet's tabs as (name, gid), read from its public page."""
    from lib_gov_data import fetch
    return tabs_in(fetch(f"https://docs.google.com/spreadsheets/d/{sheet_id}/htmlview").decode("utf-8", "replace"))


def load_config(path: str = CONFIG, parse: str | None = None) -> list[dict]:
    """The public list with each sheet's parse settings merged in, from the private file `parse` (or
    COMMUNITY_SHEETS_PARSE). A sheet with no settings in either is refused by name: read with no row floor or
    headers, a changed sheet would load as if nothing were wrong."""
    with open(path) as fh:
        sheets = json.load(fh)["sheets"]
    parse = parse or os.environ.get(PARSE_ENV) or None
    private: dict = {}
    if parse:
        with open(parse) as fh:
            private = json.load(fh)["sheets"]
    merged = [{**s, **{k: v for k, v in private.get(s["key"], {}).items() if k in PARSE_FIELDS}} for s in sheets]
    missing = [s["key"] for s in merged if "min_rows" not in s]
    if missing:
        raise ValueError(f"no parse settings for {', '.join(missing)}: they're private (--parse or {PARSE_ENV})")
    return merged


def export_url(sheet: dict) -> str:
    return f"https://docs.google.com/spreadsheets/d/{sheet['sheet_id']}/export?format=csv&gid={sheet['gid']}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="read and parse; write nothing")
    ap.add_argument("--sheet", help="only this sheet's key")
    ap.add_argument("--from-file", help="parse this CSV instead of fetching; needs --sheet")
    ap.add_argument("--force", action="store_true", help="store a sheet that lost more than half its rows")
    ap.add_argument("--parse", help=f"the private parse settings (default: ${PARSE_ENV})")
    a = ap.parse_args()
    sheets = [s for s in load_config(parse=a.parse) if not a.sheet or s["key"] == a.sheet]
    if not sheets:
        ap.error(f"no sheet {a.sheet!r} in {CONFIG}")
    if a.from_file and len(sheets) != 1:
        ap.error("--from-file needs --sheet")
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
    started = time.time()
    db = None
    if not a.dry_run:
        from lib_db import Database
        db = Database()
        ensure_table(db)
    failed: list[str] = []
    notes: list[str] = []
    for sheet in sheets:
        if time.time() - started > DEADLINE_S:
            msg = f"{sheet['name']}: not read, the run passed its {DEADLINE_S // 60}-minute deadline"
            print(f"::error::{msg}", flush=True)
            failed.append(msg)
            continue
        try:
            if a.from_file:
                with open(a.from_file, "rb") as fh:
                    rows, counts = parse_sheet(fh.read(), sheet, today)
            elif "tabs" in sheet:
                from lib_gov_data import fetch
                tabs = []
                for name, gid, office in chosen_tabs(sheet, list_tabs(sheet["sheet_id"])):
                    time.sleep(PAUSE)
                    tabs.append((name, fetch(export_url({**sheet, "gid": gid})), office))
                rows, counts = parse_tabs(tabs, sheet, today)
            else:
                from lib_gov_data import fetch
                rows, counts = parse_sheet(fetch(export_url(sheet)), sheet, today)
            approved = sum(1 for r in rows if r["approval_date"])
            line = (f"{sheet['name']}: {len(rows)} cases ({approved} approved), {counts['empty']} empty rows skipped"
                    + (f", {counts['priority_words']} priority dates in words" if counts["priority_words"] else "")
                    + (f", {counts['bad_dates']} dates that don't read" if counts["bad_dates"] else "")
                    + (f", {counts['unknown_offices']} offices that don't read" if counts.get("unknown_offices") else "")
                    + (f", {counts['unknown_categories']} categories that don't read"
                       if counts.get("unknown_categories") else ""))
            print(line, flush=True)
            if db is not None:
                write(db, sheet, rows, force=a.force)
                from lib_db import stamp_freshness
                stamp_freshness(db, f"community-sheet-{sheet['key']}",
                                source=f"https://docs.google.com/spreadsheets/d/{sheet['sheet_id']}",
                                cadence="hourly", note=line, max_age_days=3)
            notes.append(line)
        except Exception as e:  # noqa: BLE001
            # One sheet's trouble never costs the others, and never passes quietly: it ends the run red.
            msg = f"{sheet['name']}: {type(e).__name__}: {str(e)[:200]}"
            print(f"::error::{msg}", flush=True)
            failed.append(msg)
    if db is not None:
        # The office pages read the merged list, so scripts/build_reported_cases.py (the next step) refreshes them.
        from lib_db import record_run
        status = "ok" if not failed else ("partial" if notes else "failed")
        record_run(db, SCRIPT, status=status, rows_written=None,
                   note="; ".join(notes + [f"FAILED: {f}" for f in failed]), started_at=started)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

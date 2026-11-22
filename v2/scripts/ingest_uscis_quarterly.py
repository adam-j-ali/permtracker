#!/usr/bin/env python3
"""Ingest USCIS's quarterly performance data.

Four spreadsheets USCIS posts each quarter on its immigration-and-citizenship
data page, plus one static factsheet, none of which the site read before:

* `quarterly_all_forms_fy<FY>_q<Q>` - every form USCIS adjudicates: receipts,
  approvals, denials, completions, pending, and the MEDIAN months to complete
  in that quarter. This is the one place USCIS prints a median: the figure on
  egov.uscis.gov is the 80th percentile, and the two are routinely confused.
* `i485_performance_data_fy<FY>_q<Q>` - the I-485 by field office and service
  center, family / employment / humanitarian / other, received, approved,
  denied and pending. The only public answer to "which office is slowest".
* `eb_i140_i360_i526_performancedata_fy<FY>_q<Q>` - approved employment-based
  petitions whose beneficiary is waiting for a visa number, by preference and
  country of birth. The India wait, counted rather than guessed.
* `i140_rec_by_class_country_fy<FY>_q<Q>` - I-140 receipts by fiscal year
  received and current status, all countries and the top five, with approvals
  by class (E11, E12, E13, E21, NIW, E31, E32, EW3).
* `historical_pt_factsheet_fy16_to_fy24.pdf` - median months FY2016 to FY2024
  for sixteen form/basis rows, the only history USCIS publishes for medians.
  Not linked from the data page; fetched at its own URL.

Five more families from the same page (Nov 21 2026), each with its own table:

* `i765_application_for_employment_fy<FY>_q<Q>` - the I-765 by eligibility
  category ((c)(9) pending I-485, (c)(26) H-4, ...) and filing type (initial,
  renewal, replacement, card not requested), received, approved, denied and
  pending. Read from FY2025 Q1; the yearly files before it have no pending.
* `i765_p_allcat_c08_fy<FY>[_]q<Q>` (xlsx or csv) - pending I-765s by days
  waited, all categories and (c)(8) asylum, initial and renewal, as of the
  quarter's last day. A different system (NPD) from the category file
  (CLAIMS3 and ELIS), so the two never agree and are never compared.
* `net_backlog_frontlog_fy<FY>_q<Q>` (and the FY2023 Q4 pair of csv files) -
  USCIS's net backlog by form, rounded to hundreds, and the frontlog of
  applications not yet opened.
* `i907_premium_processing_fy<FY>_q<Q>` - premium processing requests by form,
  filed with the petition or as an upgrade. No decisions, no times.
* `n400_performance_data_fy<FY>_q<Q>` - the N-400 by field office, civilian
  and military, laid out like the I-485 office file (whose older
  `i485_performancedata_*` spelling is read too, for history).

WHY THESE FILES ARE READ THE WAY THEY ARE, each a lesson from a sibling ingest:

* EVERY LISTED QUARTER IS LOADED, oldest first, and a file is identified by
  its FILENAME. The listing's first page carries the newest three or four
  quarters of each family and the older ones sit on later pages (back to
  2012), so every page is read, following the page's own "Next" link until
  there is none (at most LISTING_PAGE_CAP pages). USCIS re-issues a file
  under `_v2` when it corrects one, which is a new name and therefore a
  reload that replaces the quarter's rows. A quarter already recorded under
  the same name is skipped, so a monthly poll costs the listing pages alone
  on the months nothing changed.
* TEN SECONDS BETWEEN REQUESTS. www.uscis.gov's robots.txt asks for
  `Crawl-delay: 10` (read Nov 21 2026), so every request this ingest makes
  there waits until ten seconds have passed since the one before.
* ONE FILE'S REFUSAL IS THAT FILE'S. With every page read, a run walks some
  eighty files; a refused one is named, left unrecorded so the next run tries
  it again, and the run ends red, but the files after it still load. A newer
  quarter must never wait behind an old file USCIS laid out differently.
* A LOST ROW NEEDS A WITNESS. An all-forms or office file missing a row the
  quarter before carried is refused, unless the next quarter lacks it too:
  then USCIS retired it (I-924A in FY2024 Q4). Those kinds are parsed before
  anything is stored, so even a load into an empty database has the next
  quarter listed to ask. The newest quarter has none and waits for a person.
* DISCOVERED, NEVER CONSTRUCTED. FY2026 Q1 sits under `/document/reports/`
  while Q2 and Q3 sit under `/document/data/`, and FY2025 Q4's awaiting-visa
  file spells it `performance_data` where the later ones say
  `performancedata`. A guessed URL 404s in a styled page that reads exactly
  like a dead link.
* FOOTNOTE GLUE. USCIS types its footnote markers into the cell, so `I-600`
  with footnote 7 arrives as `I-6007`, `I-924` with footnote 10 as `I-92410`,
  and `Legalization` with 13 as `Legalization13`. A form number is a letter
  prefix, a hyphen and exactly three digits, optionally one letter; every
  digit after that is a footnote. The same glue puts `(E21)2` on a class
  label and `9.16` on a median that is 9.1 with footnote 6.
* PARSED MUST EQUAL STORED. `INSERT OR REPLACE` overwrites a primary-key
  collision silently and the only evidence is a smaller count, which is how
  the I-485 inventory lost 130 cells on its first run. Every store here
  counts back and refuses on a mismatch.
* THE FILE'S OWN TOTALS ARE THE RECONCILIATION. Each workbook carries a total
  the parts must sum to (the TOTAL row per category, the TOTAL column per
  year, approvals by class against approved), and a parse that does not add
  up is refused before a row is written. A renamed column or a shifted block
  cannot pass that; a plausible-looking wrong number is worse than none.
  Where two files count the same thing (the I-765 and N-400 totals in the
  all-forms file), the newer families are checked against it too, whenever
  that quarter's all-forms rows are held; `all_forms` sorts first, so they are.
* COLUMNS AND SHEETS BY THEIR TEXT. The newer families find their sheet, their
  header row and every column by the words USCIS prints there, never by
  position or sheet name (one sheet is called `I765_FY5Q1`), and a heading
  that isn't where the text says it should be is refused.
* THE QUARTER COMES FROM THE FILENAME. The date the sheet prints is read only
  to check its end date: the FY2026 Q3 N-400 file opens its range on
  "April 1, 2025".

www.uscis.gov serves residential addresses and 403s GitHub's datacenter
runners, so the server's timer is the only runner
(scripts/oracle/bin/permtracker-uscis quarterly); no workflow runs it.

Usage:
    python3 scripts/ingest_uscis_quarterly.py                  # discover, load what is new
    python3 scripts/ingest_uscis_quarterly.py --dry-run        # parse and reconcile, write nothing
    python3 scripts/ingest_uscis_quarterly.py --local DIR      # parse the files in DIR instead
    python3 scripts/ingest_uscis_quarterly.py --force          # reload files already recorded
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import http.client
import io
import os
import pathlib
import re
import sys
import time
import urllib.parse
import zipfile
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_gov_data import (  # noqa: E402
    RobotsDisallowed, fetch, iter_rows, log, quarter_end, read_shared_strings,
)
from lib_db import (  # noqa: E402
    Database, et_today, insert_rows, query_rows, read_doc, record_run, rows_of, stamp_freshness, write_doc,
)

# THE FULL LISTING, NOT THE LANDING PAGE. The bare page shows ten items and
# the quarterly files push each other off it; `items_per_page=100` is the
# page's own control, and its "Next" link leads to the older pages.
DATA_PAGE = ("https://www.uscis.gov/tools/reports-and-studies/"
             "immigration-and-citizenship-data?items_per_page=100")
HOST = "https://www.uscis.gov"
FACTSHEET_URL = ("https://www.uscis.gov/sites/default/files/document/fact-sheets/"
                 "historical_pt_factsheet_fy16_to_fy24.pdf")
LOADS_DOC = "uscis_quarterly_loads"
FACTSHEET_DOC = "uscis_historical_pt"
# www.uscis.gov's robots.txt: `Crawl-delay: 10` (read Nov 21 2026). The shared
# POLITE_PAUSE_S (1.5 s) is DOL's pace and too quick for this host.
USCIS_CRAWL_DELAY_S = 10.0
# The listing ran to 18 pages of 100 on Nov 21 2026 (page 17 the last). A run
# that reaches this many stops reading pages, loads what it found, and says so.
LISTING_PAGE_CAP = 25

# Filename -> (kind, fiscal year, quarter). The version suffix is optional and
# a re-issued `_v2` is a NEW name on purpose (see the module docstring). A
# two-digit year (`net_backlog_fy23_q4.csv`) is in this century.
KINDS: dict[str, tuple[re.Pattern[str], ...]] = {
    "all_forms": (re.compile(
        r"^quarterly_all_forms_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
    # `i485_performancedata_fy2024_q1.xlsx` is the same layout under the older
    # spelling: seven quarters of history (FY2024 Q1 to FY2025 Q3).
    "i485_offices": (re.compile(
        r"^i485_performance_?data_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
    "eb_awaiting": (re.compile(
        r"^eb_i140_i360_i526_performance_?data_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
    "i140_class_country": (re.compile(
        r"^i140_rec_by_class_country_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
    # Quarterly from FY2025 Q1. The yearly files (`..._fy24.xlsx`,
    # `i-765_..._fy23.csv`) have no pending column and are not read.
    "i765_categories": (re.compile(
        r"^i765_application_for_employment_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
    # `I765_P_AllCat_C08_FY2023Q1.csv`, `..._fy2023q3.csv`, `..._fy2024_q1.xlsx`, `..._fy2025_q4_v1.xlsx`.
    "i765_pending_days": (re.compile(
        r"^i765_p_allcat_c08_fy(?P<fy>\d{4})_?q(?P<q>[1-4])(?:_v[\d.]+)?\.(?:xlsx|csv)$", re.I),),
    # One workbook a quarter from FY2024 Q1; FY2023 Q4 is two csv files.
    "net_backlog": (
        re.compile(r"^net_backlog_frontlog_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),
        re.compile(r"^net_(?:backlog|frontlog)_fy(?P<fy>\d{2})_q(?P<q>[1-4])\.csv$", re.I),
    ),
    "i907_premium": (re.compile(
        r"^i907_premium_processing_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
    "n400_offices": (re.compile(
        r"^n400_performance_?data_fy(?P<fy>\d{4})_q(?P<q>[1-4])(?:_v[\d.]+)?\.xlsx$", re.I),),
}

# What each kind stamps in data_freshness. The as-of is the quarter's last
# day and USCIS posts a quarter roughly 80 to 90 days after it ends, so at
# the moment the next file lands the newest as-of is about 175 days old. A
# 200-day budget is therefore "the next quarter is late", not ordinary lag;
# the health check warns on a paused source up to three times that before it
# fails, so a quarter USCIS skips is visible without crying wolf monthly.
FRESHNESS: dict[str, dict[str, str]] = {
    "all_forms": dict(dataset="uscis-form-quarters",
                      source="USCIS quarterly all-forms performance data (uscis.gov)"),
    "i485_offices": dict(dataset="uscis-i485-offices",
                         source="USCIS quarterly I-485 by field office (uscis.gov)"),
    "eb_awaiting": dict(dataset="uscis-eb-awaiting-visa",
                        source="USCIS approved employment-based petitions awaiting a visa (uscis.gov)"),
    "i140_class_country": dict(dataset="uscis-i140-class-country",
                               source="USCIS I-140 receipts by class and country of birth (uscis.gov)"),
    "i765_categories": dict(dataset="uscis-i765-categories",
                            source="USCIS quarterly I-765 by eligibility category (uscis.gov)"),
    "i765_pending_days": dict(dataset="uscis-i765-pending-days",
                              source="USCIS pending I-765s by days pending (uscis.gov)"),
    "net_backlog": dict(dataset="uscis-net-backlog",
                        source="USCIS net backlog and frontlog by form (uscis.gov)"),
    "i907_premium": dict(dataset="uscis-i907-premium",
                         source="USCIS I-907 premium processing requests by form (uscis.gov)"),
    "n400_offices": dict(dataset="uscis-n400-offices",
                         source="USCIS quarterly N-400 by field office (uscis.gov)"),
}
MAX_AGE_DAYS = 200

# Kinds whose quarter-to-quarter loss of a key is refused until a person reads
# the list (see drift_findings). The others lose and gain keys as USCIS splits
# and adds rows (I-130 into two, I-526 into three, I-765 codes that come and
# go), so their changes are logged and loaded.
DRIFT_REFUSES = frozenset({"all_forms", "i485_offices", "n400_offices"})

MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}

# A form number: a letter prefix, a hyphen, exactly three digits, and at most
# one letter (I-129F, I-601A, I-956K, G-325A). Everything after that is a
# footnote marker USCIS typed into the cell.
FORM_RE = re.compile(r"^([A-Z]{1,2}-\d{3}[A-Z]?)(\d{1,2})?$")
# A prose label with a footnote glued on: "Legalization13", "Waivers21",
# "EOIR Adjustment22", "Professionals with Advanced Degrees (E21)2".
LABEL_GLUE_RE = re.compile(r"^(.*[A-Za-z)])(\d{1,2})$")
QUARTER_RANGE_RE = re.compile(
    r"^([A-Z][a-z]+) (\d{1,2}), (\d{4})\s*-\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})$")
CLASS_CODE_RE = re.compile(r"\(([A-Z]{1,2}\d{1,2}|NIW)\)\s*\d{0,2}\s*$")
PREFERENCE_RE = re.compile(r"\((EB\d)\)\s*$")
YEAR_RE = re.compile(r"^(\d{4})(?:\.0)?$")

# Awaiting-visa column headings, normalised (whitespace collapsed) and matched
# in this order; the two-part ones must precede their one-part siblings.
AWAITING_CATEGORIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^1st\b", re.I), "EB1"),
    (re.compile(r"^2nd\b", re.I), "EB2"),
    (re.compile(r"^3rd\b.*Other", re.I), "EW3"),
    (re.compile(r"^3rd\b", re.I), "EB3"),
    (re.compile(r"^4th\b.*Religious", re.I), "EB4R"),
    (re.compile(r"^4th\b", re.I), "EB4"),
    (re.compile(r"^5th\b.*Set", re.I), "EB5S"),
    (re.compile(r"^5th\b", re.I), "EB5U"),
    (re.compile(r"^TOTAL$", re.I), "TOTAL"),
]
AWAITING_COUNTRIES = {"TOTAL", "China", "India", "Mexico", "Philippines", "Rest of the World"}

# The office sheet's twenty measures, in column order after the code column:
# five groups (family, employment, humanitarian, other, all) of four.
OFFICE_GROUPS = ("fam", "emp", "hum", "oth", "all")
OFFICE_MEASURES = ("received", "approved", "denied", "pending")
OFFICE_COLUMNS = [f"{g}_{m}" for g in OFFICE_GROUPS for m in OFFICE_MEASURES]
# Each office file's column groups as printed (footnote stripped), in order.
# The fifth I-485 group is the all-categories total and carries no heading.
I485_GROUP_HEADINGS = (r"^Family", r"^Employment", r"^Humanitarian", r"^Other")
# The N-400 sheet: civilian ("Naturalization"), military, and both.
N400_GROUPS = ("civ", "mil", "all")
N400_COLUMNS = [f"{g}_{m}" for g in N400_GROUPS for m in OFFICE_MEASURES]
N400_GROUP_HEADINGS = (r"^Naturalization$", r"^Naturalization \(Military\)$", r"^Total$")
# Each measure's heading under a group, footnote stripped.
OFFICE_MEASURE_HEADINGS = (r"^Applications Received$", r"^Approved$", r"^Denied$", r"^Pending$")

# The I-765 category sheet: four filing types and their total, four measures each.
I765_FILINGS = ("initial", "renewal", "replacement", "not_requested", "all")
I765_COLUMNS = [f"{f}_{m}" for f in I765_FILINGS for m in OFFICE_MEASURES]
I765_FILING_HEADINGS = {"initial": r"EAD-Initial$", "renewal": r"EAD-Renewal$",
                        "replacement": r"EAD-Replacement$", "not_requested": r"EAD-Not Requested$",
                        "all": r"^TOTAL$"}
I765_MEASURE_HEADINGS = {"received": r"^Receipt$", "approved": r"^Approval$",
                         "denied": r"^Denial$", "pending": r"^Pending$"}
# An eligibility code: a letter, two digits and at most one more letter or
# digit (C03B, C09P, C031), or the sheet's own UNKNOWN.
I765_CODE_RE = re.compile(r"^([AC]\d{2}[A-Z0-9]?|UNKNOWN)$")
# The codes that really end in a digit. Any other four-character code ending
# in one is a footnote marker the file's references don't explain, and is
# refused rather than stored as a code that doesn't exist.
I765_DIGIT_CODES = frozenset({"C011", "C031", "C032", "C033", "C091", "C171", "C172", "C173"})
I765_MARKER_RE = re.compile(
    r"^(\d+)\s+I-765 EAD Eligibility Category where .* is (mandatory|discretionary)\b", re.I)
# The all-forms file's I-765 rows, by the words in their title, and the codes
# each is the sum of. The four rows together are the category file's total.
I765_ALL_FORMS_ROWS = (("(Asylum)", ("C08",)),
                       ("(Adjustment Of Status)", ("C09", "C09P", "C091")),
                       ("(DACA)", ("C33",)))
# Between the codes and the printed Total: the codes add up to 1 to 4 less in
# the pending columns (FY2026 Q3). Never more, and never more than this.
I765_TOTAL_SLACK = 25

# Two of USCIS's files counting the same thing may disagree by this much (the
# larger of the two) where they aren't held exact; see compare_files.
CROSS_FILE_FLOOR = 25
CROSS_FILE_SHARE = 0.02

# Net backlog: the total is the sum of rounded parts, so it's off by a few
# hundred (500 of 7,736,000 in FY2026 Q3; 3,100 of 4,114,000 in FY2024 Q1).
BACKLOG_TOTAL_SLACK = 0.005

AS_OF_RE = re.compile(r"\bas of ([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\b", re.I)
# A value USCIS withheld: D is "disclosure standards not met" (1 to 9), H the
# cell that would let one work a D out (named in the I-765 sheet's key).
WITHHELD = frozenset({"D", "H"})


class Refusal(SystemExit):
    """A parse that does not reconcile. Nothing is written; the run fails."""


@dataclass
class Listed:
    kind: str
    fy: int
    quarter: int
    name: str
    url: str

    @property
    def key(self) -> tuple[int, int]:
        return (self.fy, self.quarter)


@dataclass
class Parsed:
    kind: str
    fy: int
    quarter: int
    name: str
    quarter_start: str | None = None
    quarter_end: str | None = None
    as_of: str | None = None
    rows: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    # Counts and medians this file stored with a fraction and was read as its sheet shows them (see ROUNDED).
    rounded: tuple[int, int] = (0, 0)


# ---------------------------------------------------------------------------
# Cells and labels
# ---------------------------------------------------------------------------

# A count USCIS stores with a fraction is shown by its own sheet as a whole
# number. The FY2024 Q1 and Q3 workbooks (read from the Internet Archive on
# Oct 28 2026) split completions into approvals and denials by a ratio, so
# I-817's 59 completions are stored as 27.775671406003159 approved and
# 31.224328593996841 denied, in cells formatted `#,##0` that show 28 and 31.
# Such a count is read as the sheet shows it. A column shifted into the wrong
# place is the reconciliation's to catch (medians over 240 months, the I-485
# pending sum, any form's pending over the TOTAL row), and it does.
ROUNDED = {"counts": 0, "medians": 0}


def cell_int(v: object) -> int | None:
    """An integer cell, or None where USCIS withheld it.

    `N/A` is "not available" and `D` is "disclosure standards not met" (a
    count of 1 to 9); both are None, because 0 would be a claim. A bare `-`
    is the table key's "zero or rounds to 0.0" and IS zero.
    """
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in ("", "N/A", "D", "n/a"):
        return None
    if s == "-":
        return 0
    try:
        f = float(s)
    except ValueError:
        return None
    if f != int(f):
        ROUNDED["counts"] += 1
        return int(Decimal(s).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return int(f)


def cell_float(v: object) -> float | None:
    """A months figure, or None for N/A. Footnote glue is refused loudly."""
    if v is None:
        return None
    s = str(v).strip()
    if s in ("", "N/A", "n/a", "-"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    # The FY2024 workbooks store medians unrounded (8.5479357999999994) in cells
    # formatted `#,##0.0`, so the sheet shows 8.5. Four or more decimals is that
    # storage, never footnote glue (glue adds one digit: 9.16 is 9.1 and note 6).
    decimals = len(s.split(".", 1)[1]) if "." in s else 0
    if decimals >= 4:
        ROUNDED["medians"] += 1
        return float(Decimal(s).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
    return f


def strip_footnote(label: str) -> str:
    """`I-6007` -> `I-600`, `Legalization13` -> `Legalization`, `I-129F` unchanged."""
    s = label.strip()
    m = FORM_RE.match(s)
    if m:
        return m.group(1)
    m = LABEL_GLUE_RE.match(s)
    if m:
        return m.group(1).strip()
    return s


def quarter_bounds(text: str) -> tuple[str, str] | None:
    """`April 1, 2026 - June 30, 2026` -> ('2026-04-01', '2026-06-30')."""
    m = QUARTER_RANGE_RE.match(text.strip())
    if not m:
        return None
    m1, d1, y1, m2, d2, y2 = m.groups()
    if m1 not in MONTHS or m2 not in MONTHS:
        return None
    return (f"{y1}-{MONTHS[m1]:02d}-{int(d1):02d}", f"{y2}-{MONTHS[m2]:02d}-{int(d2):02d}")


def norm(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def strict_count(v: object, where: str, *, blank: bool = False) -> int | None:
    """A count, None where USCIS withheld it (D, H) or printed N/A, and a refusal for anything else.

    `cell_int` reads unparseable text as None, which suits the older kinds'
    files; in the newer ones a word where a count belongs means a column moved,
    and that must stop the load. A blank is refused too unless `blank`.
    """
    s = "" if v is None else str(v).strip()
    if s in WITHHELD or s in ("N/A", "n/a"):
        return None
    if s == "":
        if blank:
            return None
        raise Refusal(f"{where}: a blank where a count belongs")
    n = cell_int(s)
    if n is None or n < 0:
        raise Refusal(f"{where}: {s!r} is not a count")
    return n


def withheld(v: object) -> bool:
    return str(v or "").strip() in WITHHELD


def as_of_date(text: str) -> str | None:
    """`As of September 30th, 2023` or `... as of June 30, 2026` -> the ISO day."""
    m = AS_OF_RE.search(norm(text))
    if not m or m.group(1).capitalize() not in MONTHS:
        return None
    return f"{m.group(3)}-{MONTHS[m.group(1).capitalize()]:02d}-{int(m.group(2)):02d}"


def check_quarter_end(name: str, printed: str | None, fy: int, quarter: int, *, snapshot: bool = False) -> None:
    """The quarter is the filename's; the date the sheet prints must end that quarter.

    A `snapshot` date ("As of ...") may also be the next morning: the FY2023 Q2
    days-pending file says "As of April 1, 2023" for the quarter that ended March 31.
    """
    want = quarter_end(fy, quarter)
    morning = (dt.date.fromisoformat(want) + dt.timedelta(days=1)).isoformat()
    if printed != want and not (snapshot and printed == morning):
        raise Refusal(f"{name}: the sheet's date ends {printed}, not {want} as its name says")


def heading(v: object) -> str:
    """A heading as printed, footnote marker and spare spaces removed."""
    return strip_footnote(norm(v))

def workbook_sheets(blob: bytes) -> list[tuple[str, list[dict[int, str]]]]:
    """Every sheet as (name, rows), rows being {column_index: text}."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    shared = read_shared_strings(z)
    names = re.findall(r'<sheet [^>]*name="([^"]+)"',
                       z.read("xl/workbook.xml").decode("utf8", "ignore"))
    out: list[tuple[str, list[dict[int, str]]]] = []
    for i, name in enumerate(names, start=1):
        path = f"xl/worksheets/sheet{i}.xml"
        if path not in z.namelist():
            continue
        out.append((name.replace("&amp;", "&"), list(iter_rows(z, path, shared))))
    return out


def csv_rows(blob: bytes) -> list[dict[int, str]]:
    """A csv file in the workbook's row shape: {column_index: text}, empty cells left out.

    USCIS's csv files open with a byte-order mark, end lines with CRLF, quote
    numbers that carry commas ("1,410,371") and write a zero as ` -   `.
    """
    text = blob.decode("utf-8-sig", errors="replace")
    return [{i: v for i, v in enumerate(row) if v != ""}
            for row in csv.reader(io.StringIO(text, newline=""))]


def sheets_of(listed: Listed, blob: bytes) -> list[tuple[str, list[dict[int, str]]]]:
    if listed.name.lower().endswith(".csv"):
        return [(listed.name, csv_rows(blob))]
    return workbook_sheets(blob)


def find_sheet(sheets: list[tuple[str, list[dict[int, str]]]], name: str, what: str,
               test) -> tuple[list[dict[int, str]], int]:
    """The sheet holding a row `test` accepts, and that row's index. Refuses when no sheet does."""
    for _, rows in sheets:
        for i, r in enumerate(rows):
            if test(r):
                return rows, i
    raise Refusal(f"{name}: no sheet holds {what}")


def identify(name: str) -> tuple[str, int, int] | None:
    for kind, patterns in KINDS.items():
        for rx in patterns:
            m = rx.match(name)
            if m:
                fy = int(m.group("fy"))
                return kind, (2000 + fy if fy < 100 else fy), int(m.group("q"))
    return None


FILE_LINK_RE = re.compile(r'href="([^"]+\.(?:xlsx|csv))"', re.I)


def discover(html: str, page: str = DATA_PAGE) -> list[Listed]:
    """Every quarterly file the page lists, one per filename, oldest first.

    Each link is read against `page`, the address the HTML came from, as a browser reads it.
    """
    seen: dict[str, Listed] = {}
    for href in FILE_LINK_RE.findall(html):
        name = href.rsplit("/", 1)[-1]
        ident = identify(name)
        if not ident or name in seen:
            continue
        kind, fy, q = ident
        seen[name] = Listed(kind, fy, q, name, urllib.parse.urljoin(page, href.replace("&amp;", "&")))
    return sort_listed(seen.values())


# ---------------------------------------------------------------------------
# The listing's pages, read at USCIS's pace
# ---------------------------------------------------------------------------

class Pacer:
    """At least `gap` seconds between the starts of two requests to one host."""

    def __init__(self, gap: float, clock=time.monotonic, sleep=time.sleep) -> None:
        self.gap, self.clock, self.sleep = gap, clock, sleep
        self.last: float | None = None

    def wait(self) -> None:
        if self.last is not None:
            left = self.gap - (self.clock() - self.last)
            if left > 0:
                self.sleep(left)
        self.last = self.clock()


USCIS_PACE = Pacer(USCIS_CRAWL_DELAY_S)


def fetch_uscis(url: str, referer: str | None = None) -> bytes:
    """`fetch`, never sooner than USCIS's crawl delay after the previous request."""
    USCIS_PACE.wait()
    return fetch(url, referer=referer)


# What a request to the agency can fail with: refused by robots.txt, an HTTP
# error, a dropped or cut-off connection. A styled 404 page in place of a
# workbook is a BadZipFile when it's opened.
READ_ERRORS = (OSError, http.client.HTTPException, RobotsDisallowed, zipfile.BadZipFile)


def page_number(url: str) -> int:
    got = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("page", ["0"])
    return int(got[0]) if got[0].isdigit() else -1


def next_page_link(html: str, page: str = DATA_PAGE) -> str | None:
    """The listing's own "Next" link (`<a ... rel="next">`), made absolute against `page`, or None on the last page.

    A query-only link (`?items_per_page=100&page=2`) belongs to the page it's on: joined to the
    host instead, it would be the homepage, which lists nothing and has no Next.
    """
    for tag in re.findall(r"<a\b[^>]*>", html, re.I):
        if re.search(r'\brel="next"', tag, re.I):
            m = re.search(r'\bhref="([^"]+)"', tag)
            if m:
                return urllib.parse.urljoin(page, m.group(1).replace("&amp;", "&"))
    return None


@dataclass
class Listing:
    files: list[Listed]
    pages: int
    stopped: str = ""      # why the walk stopped before the last page, when it did
    failed: str = ""       # a page that couldn't be read, which the run must end red on


def read_listing(get, first: str = DATA_PAGE, cap: int | None = None) -> Listing:
    """Every file the listing carries, following its "Next" link page by page.

    The first page must read, or there's nothing to load and the run fails. A
    later page that can't be read, a "Next" link that doesn't lead to the
    following page, or a following page with no file links at all (every real
    one has dozens, the sidebar's among them) ends the walk with what was found
    and `failed` saying why: the newest files are on the first page, so they
    still load, and the run ends red. Reaching `cap` pages (LISTING_PAGE_CAP)
    ends it with `stopped` saying so.
    """
    cap = LISTING_PAGE_CAP if cap is None else cap
    seen: dict[str, Listed] = {}
    url, pages, had_links = first, 0, False
    while True:
        try:
            html = get(url).decode("utf8", "ignore")
        except READ_ERRORS as exc:
            if pages == 0:
                raise
            return Listing(sort_listed(seen.values()), pages, failed=f"listing page {page_number(url)} not read ({exc})")
        links = bool(FILE_LINK_RE.search(html))
        if pages and had_links and not links:
            return Listing(sort_listed(seen.values()), pages,
                           failed=f"listing page {page_number(url)} ({url}) holds no file links, "
                                  "though the page before it did")
        pages += 1
        had_links = links
        for item in discover(html, url):
            seen.setdefault(item.name, item)
        nxt = next_page_link(html, url)
        if nxt is None:
            return Listing(sort_listed(seen.values()), pages)
        if pages >= cap:
            return Listing(sort_listed(seen.values()), pages,
                           stopped=f"stopped at the cap of {cap} listing pages; page {page_number(nxt)} on not read")
        if page_number(nxt) != page_number(url) + 1:
            return Listing(sort_listed(seen.values()), pages,
                           failed=f"page {page_number(url)}'s Next link leads to {nxt}, not the following page")
        url = nxt


def sort_listed(items) -> list[Listed]:
    # `all_forms` sorts first, so the families checked against it find its quarter held.
    return sorted(items, key=lambda x: (x.kind, x.fy, x.quarter, x.name))


# ---------------------------------------------------------------------------
# all_forms
# ---------------------------------------------------------------------------

def parse_all_forms(rows: list[dict[int, str]], listed: Listed) -> Parsed:
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    header_at = None
    for i, r in enumerate(rows):
        first = norm(r.get(0))
        if p.quarter_start is None:
            qb = quarter_bounds(first)
            if qb:
                p.quarter_start, p.quarter_end = qb
        if first == "Category and Form Number":
            header_at = i
            break
    if header_at is None or not p.quarter_end:
        raise Refusal(f"{listed.name}: no header row or quarter range found")
    category = ""
    for r in rows[header_at + 1:]:
        first = norm(r.get(0))
        if not first:
            continue
        if first.startswith(("Table Key", "References", "Notes", "Source")):
            break
        numbers = [r.get(c) for c in range(2, 13)]
        has_numbers = any(v not in (None, "") for v in numbers)
        title = norm(r.get(1))
        if not has_numbers and not title:
            category = strip_footnote(first)
            continue
        if first == "TOTAL":
            form, title, cat = "TOTAL", "All forms", ""
        else:
            form, cat = strip_footnote(first), category
            if not title:
                raise Refusal(f"{listed.name}: form {first!r} has no title")
        p.rows.append({
            "form": form, "title": title, "category": cat,
            "received": cell_int(r.get(2)), "approved": cell_int(r.get(3)),
            "denied": cell_int(r.get(4)), "completed": cell_int(r.get(5)),
            "pending": cell_int(r.get(6)), "median_months": cell_float(r.get(7)),
            "ytd_received": cell_int(r.get(8)), "ytd_approved": cell_int(r.get(9)),
            "ytd_denied": cell_int(r.get(10)), "ytd_completed": cell_int(r.get(11)),
            "ytd_pending": cell_int(r.get(12)),
        })
    reconcile_all_forms(p)
    return p


def reconcile_all_forms(p: Parsed) -> None:
    forms = {r["form"] for r in p.rows}
    for must in ("TOTAL", "I-140", "I-485", "I-765", "I-131", "N-400"):
        if must not in forms:
            raise Refusal(f"{p.name}: {must} missing from the all-forms sheet")
    if len(p.rows) < 60:
        raise Refusal(f"{p.name}: only {len(p.rows)} form rows; expected 60 or more")
    keys = [(r["form"], r["title"]) for r in p.rows]
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    if dupes:
        raise Refusal(f"{p.name}: duplicate form/title keys {dupes[:3]}")
    for r in p.rows:
        for k in ("received", "approved", "denied", "completed", "pending"):
            v = r[k]
            if v is not None and v < 0:
                raise Refusal(f"{p.name}: {r['form']} {k} is negative")
        m = r["median_months"]
        if m is not None and not (0 <= m <= 240):
            raise Refusal(f"{p.name}: {r['form']} median {m} months is implausible")
    total = next(r for r in p.rows if r["form"] == "TOTAL")
    # The six I-485 rows and the four I-765 rows sum to their form's total
    # (note 6 on the sheet); the TOTAL row is the whole service, so every
    # form's pending must be inside it. A shifted column fails this at once.
    for r in p.rows:
        if r["form"] != "TOTAL" and r["pending"] is not None and total["pending"] is not None:
            if r["pending"] > total["pending"]:
                raise Refusal(f"{p.name}: {r['form']} pending exceeds the TOTAL row")
    i485 = sum(r["pending"] or 0 for r in p.rows if r["form"] == "I-485")
    if i485 < 100_000:
        raise Refusal(f"{p.name}: I-485 pending sums to {i485:,}; a column has shifted")


# ---------------------------------------------------------------------------
# i485_offices
# ---------------------------------------------------------------------------

def parse_i485_offices(rows: list[dict[int, str]], listed: Listed) -> Parsed:
    p = parse_offices(rows, listed, I485_GROUP_HEADINGS, OFFICE_COLUMNS)
    reconcile_offices(p)
    return p


def parse_n400_offices(rows: list[dict[int, str]], listed: Listed) -> Parsed:
    """The N-400 by field office: the I-485 office file's layout, three groups of four.

    Its date range opened on the wrong year in FY2026 Q3 ("April 1, 2025 -
    June 30, 2026"), so only the end is checked, against the filename's
    quarter. A second block, `Field Office by Territory`, holds Guam, the U.S.
    Virgin Islands and Puerto Rico, each read like a state.
    """
    p = parse_offices(rows, listed, N400_GROUP_HEADINGS, N400_COLUMNS, strict=True)
    check_quarter_end(listed.name, p.quarter_end, listed.fy, listed.quarter)
    reconcile_offices(p, N400_COLUMNS)
    reconcile_n400(p)
    return p


def parse_offices(rows: list[dict[int, str]], listed: Listed, groups: tuple[str, ...],
                  columns: list[str], *, strict: bool = False) -> Parsed:
    """One office file: a Total row, state (or territory) label rows, and an office per row with its code.

    `strict` (the N-400) reads each cell with strict_count: a word or a blank where
    a count belongs is refused. The office totals can't catch one in a cell whose
    true value is 0 to 9, since a NULL there leaves the same room a D does.
    """
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    header_at = None
    for i, r in enumerate(rows):
        first = norm(r.get(0))
        if p.quarter_start is None:
            qb = quarter_bounds(first)
            if qb:
                p.quarter_start, p.quarter_end = qb
        if first.startswith("Field Office by State"):
            header_at = i
            break
    if header_at is None or not p.quarter_end:
        raise Refusal(f"{listed.name}: no header row or quarter range found")
    group_row, header = rows[header_at - 1], rows[header_at]
    for k, want in enumerate(groups):
        got = heading(group_row.get(2 + 4 * k))
        if not re.search(want, got):
            raise Refusal(f"{listed.name}: column group {want!r} not where expected (got {got!r})")
    for c in range(2, 2 + len(columns)):
        want = OFFICE_MEASURE_HEADINGS[(c - 2) % 4]
        got = heading(header.get(c))
        if not re.search(want, got):
            raise Refusal(f"{listed.name}: column {c} is headed {got!r}, not {want!r}")
    state = ""
    for r in rows[header_at + 1:]:
        first = norm(r.get(0))
        if not first:
            continue
        if first.startswith(("Table Key", "References", "Notes", "Source", "- Represents", "D ")):
            break
        code = norm(r.get(1))
        values = [r.get(c) for c in range(2, 2 + len(columns))]
        # A state's own row prints a single space in each number cell (the N-400 file).
        has_numbers = any(str(v or "").strip() for v in values)
        if not code and not has_numbers:
            if not first.startswith("Field Office by"):   # the territories' block heading
                state = first
            continue
        if first.lower() == "total" and not code:
            row = {"state": "", "office": "Total", "code": "ALL"}
        else:
            if not code:
                raise Refusal(f"{listed.name}: office {first!r} has no code")
            row = {"state": state, "office": first, "code": code}
        row["suppressed"] = sum(1 for v in values if withheld(v))
        for col, v in zip(columns, values):
            row[col] = strict_count(v, f"{listed.name} {row['code']} {col}") if strict else cell_int(v)
        p.rows.append(row)
    return p


def reconcile_offices(p: Parsed, columns: list[str] = OFFICE_COLUMNS) -> None:
    total = next((r for r in p.rows if r["code"] == "ALL"), None)
    if not total:
        raise Refusal(f"{p.name}: no Total row")
    offices = [r for r in p.rows if r["code"] != "ALL"]
    if len(offices) < 80:
        raise Refusal(f"{p.name}: only {len(offices)} office rows; expected 80 or more")
    states = {r["state"] for r in offices} - {"Service Center"}
    if len(states) < 45:
        raise Refusal(f"{p.name}: only {len(states)} states; expected 45 or more")
    codes = [r["code"] for r in offices]
    if len(set(codes)) != len(codes):
        raise Refusal(f"{p.name}: duplicate office codes")
    # The published Total is the reconciliation. Where USCIS suppressed a
    # cell the parts can only sum to LESS than the total (each D is 1 to 9),
    # so the check is exact when nothing is suppressed and a floor when
    # something is. Either way a shifted column or a dropped block fails.
    for col in columns:
        published = total[col]
        if published is None:
            continue
        parts = [r[col] for r in offices]
        held = sum(v for v in parts if v is not None)
        missing = sum(1 for v in parts if v is None)
        if missing == 0 and held != published:
            raise Refusal(f"{p.name}: {col} sums to {held:,} against a published {published:,}")
        if missing and not (held <= published <= held + 9 * missing):
            raise Refusal(f"{p.name}: {col} sums to {held:,} with {missing} suppressed "
                          f"cells against a published {published:,}")


def reconcile_n400(p: Parsed) -> None:
    """Within each row, both categories make the total: civilian plus military, measure by measure.

    Checked wherever all three cells are printed (164 D cells in FY2026 Q3 leave
    the rest of each row to check). Held for every office in three quarters.
    """
    for r in p.rows:
        for m in OFFICE_MEASURES:
            civ, mil, both = r[f"civ_{m}"], r[f"mil_{m}"], r[f"all_{m}"]
            if civ is not None and mil is not None and both is not None and civ + mil != both:
                raise Refusal(f"{p.name}: {r['code']} {m}: civilian {civ:,} and military {mil:,} "
                              f"against a total of {both:,}")


# ---------------------------------------------------------------------------
# eb_awaiting
# ---------------------------------------------------------------------------

def parse_eb_awaiting(rows: list[dict[int, str]], listed: Listed) -> Parsed:
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    header_at = None
    for i, r in enumerate(rows):
        first = norm(r.get(0))
        m = re.match(r"^As of ([A-Z][a-z]+) (\d{4})$", first)
        if m and m.group(1) in MONTHS:
            p.as_of = f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"
        if first == "Country":
            header_at = i
            break
    if header_at is None or not p.as_of:
        raise Refusal(f"{listed.name}: no Country header or 'As of' line")
    header = rows[header_at]
    columns: list[tuple[int, str]] = []
    for c in sorted(k for k in header if k > 0):
        label = norm(header[c])
        if not label:
            continue
        code = next((code for rx, code in AWAITING_CATEGORIES if rx.search(label)), None)
        if not code:
            raise Refusal(f"{listed.name}: unrecognised category heading {label!r}")
        columns.append((c, code))
    if {code for _, code in columns} != {c for _, c in AWAITING_CATEGORIES} or len(columns) != len(AWAITING_CATEGORIES):
        raise Refusal(f"{listed.name}: category columns are {[c for _, c in columns]}")
    for r in rows[header_at + 1:]:
        country = norm(r.get(0))
        if not country:
            continue
        if country.startswith(("Table Key", "Notes", "Source", "- Represents")):
            break
        if country not in AWAITING_COUNTRIES:
            raise Refusal(f"{listed.name}: unexpected country row {country!r}")
        for c, code in columns:
            n = cell_int(r.get(c))
            if n is None:
                raise Refusal(f"{listed.name}: {country} {code} is blank")
            p.rows.append({"country": country, "category": code, "count": n})
    reconcile_awaiting(p)
    return p


def reconcile_awaiting(p: Parsed) -> None:
    countries = {r["country"] for r in p.rows}
    if countries != AWAITING_COUNTRIES:
        raise Refusal(f"{p.name}: countries are {sorted(countries)}")
    by = {(r["country"], r["category"]): r["count"] for r in p.rows}
    parts = sorted(AWAITING_COUNTRIES - {"TOTAL"})
    for _, code in AWAITING_CATEGORIES:
        summed = sum(by[(c, code)] for c in parts)
        if summed != by[("TOTAL", code)]:
            raise Refusal(f"{p.name}: {code} countries sum to {summed:,} against a "
                          f"TOTAL row of {by[('TOTAL', code)]:,}")
    for c in AWAITING_COUNTRIES:
        summed = sum(by[(c, code)] for _, code in AWAITING_CATEGORIES if code != "TOTAL")
        if summed != by[(c, "TOTAL")]:
            raise Refusal(f"{p.name}: {c} categories sum to {summed:,} against a "
                          f"TOTAL column of {by[(c, 'TOTAL')]:,}")


# ---------------------------------------------------------------------------
# i140_class_country
# ---------------------------------------------------------------------------

def sheet_country(name: str) -> str:
    """`India FY26` -> India, `Vietnam 2026` -> Vietnam, `All Countries FY26` -> All Countries."""
    return re.sub(r"\s+(FY\s?\d{2,4}|\d{4})$", "", name.strip(), flags=re.I).strip()


def parse_i140_class_country(sheets: list[tuple[str, list[dict[int, str]]]],
                             listed: Listed) -> Parsed:
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    p.as_of = f"{listed.fy}-Q{listed.quarter}"
    for name, rows in sheets:
        country = sheet_country(name)
        header_at = None
        for i, r in enumerate(rows):
            if norm(r.get(0)).startswith("Petitions by Employment Preference"):
                header_at = i
                break
        if header_at is None:
            raise Refusal(f"{listed.name}: sheet {name!r} has no year header")
        header = rows[header_at]
        years: list[tuple[int, int]] = []
        total_col = None
        for c in sorted(k for k in header if k > 0):
            label = norm(header[c])
            m = YEAR_RE.match(label)
            if m:
                years.append((c, int(m.group(1))))
            elif label.upper() == "TOTAL":
                total_col = c
        fys = [fy for _, fy in years]
        if len(years) < 3 or total_col is None or fys != list(range(fys[0], fys[0] + len(fys))):
            raise Refusal(f"{listed.name}: sheet {name!r} header years are {fys} (TOTAL column: {total_col})")
        preference, approvals_block = "ALL", False
        for r in rows[header_at + 1:]:
            label = norm(r.get(0))
            if not label:
                continue
            if label.startswith(("Table Key", "References", "Notes", "Source")):
                break
            has_numbers = any(r.get(c) not in (None, "") for c, _ in years)
            pm = PREFERENCE_RE.search(label)
            if pm:
                preference, approvals_block = pm.group(1), False
                if has_numbers:
                    p.rows += measure_rows(country, preference, "total", r, years, total_col, p)
                continue
            if label.lower().startswith("other and unknown"):
                preference, approvals_block = "OTHER", False
                if has_numbers:
                    p.rows += measure_rows(country, preference, "total", r, years, total_col, p)
                continue
            if label.lower().startswith("approvals by category"):
                approvals_block = True
                continue
            if not has_numbers:
                continue
            if approvals_block:
                cm = CLASS_CODE_RE.search(label)
                if not cm:
                    raise Refusal(f"{listed.name}: no class code in {label!r}")
                measure = f"approved_{cm.group(1)}"
            else:
                low = label.lower()
                if low in ("total", "total petitions"):
                    measure = "total"
                elif low == "approved":
                    measure = "approved"
                elif low == "denied":
                    measure = "denied"
                elif low.startswith("pending"):
                    measure = "pending"
                else:
                    raise Refusal(f"{listed.name}: unrecognised row {label!r} in {name!r}")
            p.rows += measure_rows(country, preference, measure, r, years, total_col, p)
    reconcile_class_country(p)
    return p


def measure_rows(country: str, preference: str, measure: str, r: dict[int, str],
                 years: list[tuple[int, int]], total_col: int, p: Parsed) -> list[dict]:
    out = []
    summed = 0
    for c, fy in years:
        n = cell_int(r.get(c))
        if n is None:
            # USCIS leaves a class-approval cell EMPTY where nothing was
            # approved (Philippines E12 in 2018, for one). Read as zero, and
            # let the TOTAL column below say whether that was right.
            p.notes.append(f"{country} {preference} {measure} {fy} blank, read as 0")
            n = 0
        summed += n
        out.append({"country": country, "preference": preference,
                    "measure": measure, "fy": fy, "count": n})
    published = cell_int(r.get(total_col))
    # The TOTAL column is the sum of the years, printed by USCIS. A parse that
    # read the wrong columns cannot reproduce it.
    if published is not None and published != summed:
        raise Refusal(f"{p.name}: {country} {preference} {measure} years sum to "
                      f"{summed:,} against a TOTAL column of {published:,}")
    return out


def reconcile_class_country(p: Parsed) -> None:
    by: dict[tuple[str, str, str, int], int] = {
        (r["country"], r["preference"], r["measure"], r["fy"]): r["count"] for r in p.rows}
    countries = {r["country"] for r in p.rows}
    if "All Countries" not in countries or len(countries) < 2:
        raise Refusal(f"{p.name}: sheets held {sorted(countries)}")
    years = sorted({r["fy"] for r in p.rows})
    for country in countries:
        for fy in years:
            for pref in ("ALL", "EB1", "EB2", "EB3", "OTHER"):
                t = by.get((country, pref, "total", fy))
                if t is None:
                    raise Refusal(f"{p.name}: {country} {pref} has no total for {fy}")
                parts = sum(by.get((country, pref, m, fy), 0)
                            for m in ("approved", "denied", "pending"))
                if parts != t:
                    raise Refusal(f"{p.name}: {country} {pref} {fy}: approved+denied+pending "
                                  f"{parts:,} against a total of {t:,}")
            prefs = sum(by[(country, pr, "total", fy)] for pr in ("EB1", "EB2", "EB3", "OTHER"))
            if prefs != by[(country, "ALL", "total", fy)]:
                raise Refusal(f"{p.name}: {country} {fy}: preferences sum to {prefs:,} "
                              f"against {by[(country, 'ALL', 'total', fy)]:,}")
            # Approvals by class must sum to the preference's approvals.
            for pref in ("EB1", "EB2", "EB3"):
                classes = sum(v for (c, pr, m, y), v in by.items()
                              if c == country and pr == pref and y == fy
                              and m.startswith("approved_"))
                if classes != by[(country, pref, "approved", fy)]:
                    raise Refusal(f"{p.name}: {country} {pref} {fy}: classes sum to "
                                  f"{classes:,} against approved {by[(country, pref, 'approved', fy)]:,}")


# ---------------------------------------------------------------------------
# i765_categories
# ---------------------------------------------------------------------------

def i765_markers(rows: list[dict[int, str]]) -> dict[str, str]:
    """The footnote markers this file glues to its codes, from its own reference lines.

    FY2026 Q3: `5 I-765 EAD Eligibility Category where the statutory or
    regulatory basis is mandatory.` and 6 for discretionary. FY2025 Q1 has
    none; the yearly FY24 file used 4 and 5. Read, never assumed.
    """
    out: dict[str, str] = {}
    for r in rows:
        m = I765_MARKER_RE.match(norm(r.get(0)))
        if m:
            out[m.group(1)] = m.group(2).lower()
    return out


def i765_code(raw: str, markers: dict[str, str], name: str) -> tuple[str, str | None]:
    """`A025` -> ('A02', 'mandatory') when 5 marks mandatory; `C031`, `C09P` unchanged; junk refused.

    A final digit is a marker only when the file names it as one and what's
    left is a letter and two digits. Codes that really end in a digit (C011,
    C031 to C033, C091, C171 to C173) are taken as they are.
    """
    s = norm(raw).upper()
    if s in I765_DIGIT_CODES:
        return s, None
    for marker, discretion in markers.items():
        if s.endswith(marker) and re.fullmatch(r"[AC]\d{2}", s[:-len(marker)]):
            return s[:-len(marker)], discretion
    if not I765_CODE_RE.match(s):
        raise Refusal(f"{name}: {raw!r} is not an eligibility code")
    if len(s) == 4 and s[-1].isdigit():
        raise Refusal(f"{name}: {raw!r} ends in a digit no reference line explains (a footnote marker?)")
    return s, None


def heading_columns(groups: dict[int, str], header: dict[int, str], first: int, name: str,
                    group_rx: dict[str, str], measure_rx: dict[str, str]) -> dict[str, int]:
    """`{group}_{measure}` -> column, read from a two-row heading by its words.

    A measure sits under the nearest group heading at or left of its column. A
    heading that names no known group or measure, or a pair named twice, is
    refused, so a moved or renamed column stops the load.
    """
    starts = sorted((c, heading(v)) for c, v in groups.items() if c >= first and heading(v))
    out: dict[str, int] = {}
    for c in sorted(k for k in header if k >= first):
        label = heading(header[c])
        if not label:
            continue
        measure = next((m for m, rx in measure_rx.items() if re.search(rx, label, re.I)), None)
        over = next((g for gc, g in reversed(starts) if gc <= c), "")
        group = next((g for g, rx in group_rx.items() if re.search(rx, over, re.I)), None)
        if measure is None or group is None:
            raise Refusal(f"{name}: column {c} is headed {over!r} / {label!r}, which this reader doesn't know")
        key = f"{group}_{measure}"
        if key in out:
            raise Refusal(f"{name}: two columns are headed {over!r} / {label!r}")
        out[key] = c
    return out


def parse_i765_categories(sheets: list[tuple[str, list[dict[int, str]]]], listed: Listed) -> Parsed:
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    rows, header_at = find_sheet(sheets, listed.name, "an 'EAD Eligibility Category' header",
                                 lambda r: norm(r.get(0)) == "EAD Eligibility Category")
    for r in rows[:header_at]:
        qb = quarter_bounds(norm(r.get(0)))
        if qb:
            p.quarter_start, p.quarter_end = qb
            break
    check_quarter_end(listed.name, p.quarter_end, listed.fy, listed.quarter)
    header = rows[header_at]
    if heading(header.get(1)) != "EAD Category Description":
        raise Refusal(f"{listed.name}: column 1 is headed {norm(header.get(1))!r}, not the category description")
    cols = heading_columns(rows[header_at - 1], header, 2, listed.name,
                           I765_FILING_HEADINGS, I765_MEASURE_HEADINGS)
    if set(cols) != set(I765_COLUMNS):
        raise Refusal(f"{listed.name}: columns {sorted(set(I765_COLUMNS) - set(cols))} are missing")
    markers = i765_markers(rows[header_at + 1:])
    if markers:
        p.notes.append("footnote markers " + ", ".join(f"{k} {v}" for k, v in sorted(markers.items())))
    for r in rows[header_at + 1:]:
        first = norm(r.get(0))
        if not first:
            continue
        if first.startswith(("Table Key", "Reference", "Note", "Source")):
            break
        if first.lower() == "total":
            code, discretion, description = "ALL", None, "All eligibility categories"
        else:
            code, discretion = i765_code(first, markers, listed.name)
            description = norm(r.get(1))
            if not description:
                raise Refusal(f"{listed.name}: code {first!r} has no description")
        row: dict = {"code": code, "description": description, "discretion": discretion,
                     "withheld": {k: str(r.get(c)).strip() for k, c in cols.items() if withheld(r.get(c))}}
        row["suppressed"] = len(row["withheld"])
        for k, c in cols.items():
            row[k] = strict_count(r.get(c), f"{listed.name} {code} {k}")
        p.rows.append(row)
    reconcile_i765(p)
    return p


def reconcile_i765(p: Parsed) -> None:
    codes = [r["code"] for r in p.rows]
    dupes = sorted({c for c in codes if codes.count(c) > 1})
    if dupes:
        raise Refusal(f"{p.name}: codes {dupes} appear twice (a footnote marker read as part of a code?)")
    by = {r["code"]: r for r in p.rows}
    for must in ("ALL", "C08", "C09", "C26", "C33"):
        if must not in by:
            raise Refusal(f"{p.name}: no {must} row")
    parts = [r for r in p.rows if r["code"] != "ALL"]
    if len(parts) < 40:
        raise Refusal(f"{p.name}: only {len(parts)} eligibility codes; expected 40 or more")
    # Each row's TOTAL group is its four filing types added up, exactly.
    for r in p.rows:
        for m in OFFICE_MEASURES:
            types = [r[f"{f}_{m}"] for f in I765_FILINGS[:-1]]
            whole = r[f"all_{m}"]
            if whole is None or any(v is None for v in types):
                continue
            if sum(types) != whole:
                raise Refusal(f"{p.name}: {r['code']} {m}: the filing types add up to {sum(types):,} "
                              f"against a total of {whole:,}")
    # The codes against the printed Total row: never more, and at most a few
    # less (1 to 4 in the pending columns in FY2026 Q3). Each D is 1 to 9 more
    # room; an H hides a value of any size, so it leaves only the floor.
    total = by["ALL"]
    for col in I765_COLUMNS:
        published = total[col]
        if published is None:
            continue
        held = sum(r[col] for r in parts if r[col] is not None)
        marks = [r["withheld"].get(col) for r in parts if r[col] is None]
        gap = published - held
        if gap < 0:
            raise Refusal(f"{p.name}: {col}: the codes add up to {held:,}, more than the printed Total {published:,}")
        room = I765_TOTAL_SLACK + 9 * sum(1 for m in marks if m == "D")
        if "H" not in marks and gap > room:
            raise Refusal(f"{p.name}: {col}: the codes add up to {held:,}, {gap:,} below the printed "
                          f"Total {published:,} (at most {room} allowed)")
        if gap:
            p.notes.append(f"{col}: codes {gap:,} below the Total")


def compare_files(p: Parsed, what: str, mine: int | None, theirs: int | None, found: list[str],
                  *, exact: bool) -> None:
    """One figure against the all-forms file's: equal, or (unless `exact`) within CROSS_FILE_ROOM, noted.

    USCIS queries its files at different moments, and two of eighteen quarters
    read Nov 21 2026 disagree: FY2025 Q2's I-765 total by 2 received and 5
    pending, and FY2024 Q3's N-400 totals by up to 7,560 pending (1.6%), while
    each file's own totals add up. A figure from the wrong column or another
    quarter is further off than that; a disagreement inside it is put on the record.
    """
    if mine is None or theirs is None or mine == theirs:
        return
    room = 0 if exact else max(CROSS_FILE_FLOOR, round(CROSS_FILE_SHARE * theirs))
    if abs(mine - theirs) > room:
        raise Refusal(f"{p.name}: {what} is {mine:,}; the all-forms file says {theirs:,}"
                      + (f" (more than {room:,} apart)" if room else ""))
    found.append(f"{what} {mine:,}, the all-forms file {theirs:,}")


def check_i765_against_all_forms(p: Parsed, forms: list[dict]) -> list[str]:
    """The all-forms file's four I-765 rows, against the codes they count; the disagreements allowed.

    Asylum is (c)(8), adjustment of status is (c)(9) with (c)(9)P (and (c)(9)1
    when listed), DACA is (c)(33): exact on all four measures in every quarter
    from FY2025 Q1 to FY2026 Q3, so held exact. The four rows together are the
    Total, which FY2025 Q2's all-forms file put 2 and 5 higher.
    """
    rows = [f for f in forms if f["form"] == "I-765"]
    by = {r["code"]: r for r in p.rows}
    found: list[str] = []
    for words, codes in I765_ALL_FORMS_ROWS:
        row = next((f for f in rows if words.lower() in f["title"].lower()), None)
        if row is None:
            raise Refusal(f"{p.name}: the all-forms file has no I-765 {words} row to check against")
        for m in OFFICE_MEASURES:
            parts = [by[c][f"all_{m}"] for c in codes if c in by]
            mine = None if any(v is None for v in parts) else sum(parts)
            compare_files(p, f"{'+'.join(c for c in codes if c in by)} {m} ({words})", mine, row[m], found, exact=True)
    for m in OFFICE_MEASURES:
        values = [f[m] for f in rows]
        theirs = None if any(v is None for v in values) else sum(values)
        compare_files(p, f"Total {m}", by["ALL"][f"all_{m}"], theirs, found, exact=False)
    return found


# ---------------------------------------------------------------------------
# i765_pending_days
# ---------------------------------------------------------------------------

def bucket_range(label: str, name: str) -> tuple[int, int | None]:
    """`60 or fewer` -> (0, 60), `61 - 90 days` -> (61, 90), `180 to 540 days` -> (180, 540), `541 or more days` -> (541, None).

    FY2023 Q1 and Q2 word them `60 Days or Fewer`, `Between 61 and 90 Days`
    and `180 Days or More`.
    """
    s = re.sub(r"\s+", " ", re.sub(r"\bdays?\b", " ", norm(label), flags=re.I)).strip().lower()
    m = re.fullmatch(r"(\d+) or fewer", s)
    if m:
        return 0, int(m.group(1))
    m = re.fullmatch(r"(\d+) ?(?:-|to) ?(\d+)", s) or re.fullmatch(r"between (\d+) and (\d+)", s)
    if m and int(m.group(1)) <= int(m.group(2)):
        return int(m.group(1)), int(m.group(2))
    m = re.fullmatch(r"(\d+) or more", s)
    if m:
        return int(m.group(1)), None
    raise Refusal(f"{name}: {label!r} is not a range of days this reader knows")


PENDING_SCOPES = {"c8": r"^\(c\)\(8\) Pending Asylum$", "all": r"^All Categories$"}
PENDING_FILINGS = {"initial": r"^Initial Applications$", "renewal": r"^Renewal Applications$"}


def parse_i765_pending_days(sheets: list[tuple[str, list[dict[int, str]]]], listed: Listed) -> Parsed:
    """Pending I-765s by days waited, as of the quarter's last day.

    Five ranges through FY2025 Q4 (60 or fewer, 61-90, 91-121, 121-179 or
    122-179, 180 or more) and seven in FY2026 Q3 (30 or fewer up to 541 or
    more). The ranges are stored as printed, with their bounds; USCIS's own
    `91 - 121` and `121 - 179` share a day, which is allowed and nothing more.
    """
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    rows, header_at = find_sheet(sheets, listed.name, "a 'Number of Days Pending' header",
                                 lambda r: norm(r.get(0)) == "Number of Days Pending")
    printed = next((d for d in (as_of_date(norm(r.get(0))) for r in rows[:header_at]) if d), None)
    check_quarter_end(listed.name, printed, listed.fy, listed.quarter, snapshot=True)
    p.as_of = quarter_end(listed.fy, listed.quarter)
    cols = heading_columns(rows[header_at - 1], rows[header_at], 1, listed.name, PENDING_FILINGS, PENDING_SCOPES)
    if len(cols) != 4:
        raise Refusal(f"{listed.name}: columns {sorted(cols)}; expected initial and renewal, (c)(8) and all")
    total: dict[str, int] | None = None
    buckets: list[tuple[str, int, int | None, dict[str, int]]] = []
    for r in rows[header_at + 1:]:
        first = norm(r.get(0))
        if not first:
            continue
        if first.startswith(("Note", "Source", "Table Key", "Reference")):
            break
        counts: dict[str, int] = {}
        for k, c in cols.items():
            n = strict_count(r.get(c), f"{listed.name} {first!r} {k}")
            if n is None:
                raise Refusal(f"{listed.name}: {first!r} {k} is withheld; this file never withholds")
            counts[k] = n
        if first.lower() == "grand total":
            total = counts
            continue
        lo, hi = bucket_range(first, listed.name)
        buckets.append((first, lo, hi, counts))
    reconcile_pending_days(listed.name, total, buckets)
    for label, lo, hi, counts in buckets:
        for k, n in counts.items():
            filing, scope = k.split("_", 1)
            p.rows.append({"filing": filing, "scope": scope, "bucket": label,
                           "days_min": lo, "days_max": hi, "count": n})
    return p


def reconcile_pending_days(name: str, total: dict[str, int] | None,
                           buckets: list[tuple[str, int, int | None, dict[str, int]]]) -> None:
    if total is None:
        raise Refusal(f"{name}: no Grand Total row")
    if len(buckets) < 3:
        raise Refusal(f"{name}: only {len(buckets)} ranges of days")
    if buckets[0][1] != 0:
        raise Refusal(f"{name}: the first range starts at {buckets[0][1]} days, not 0")
    for (label, lo, hi, _), (nlabel, nlo, _, _) in zip(buckets, buckets[1:]):
        if hi is None:
            raise Refusal(f"{name}: {label!r} is open-ended but {nlabel!r} follows it")
        if nlo not in (hi, hi + 1):
            raise Refusal(f"{name}: {label!r} then {nlabel!r} leaves a gap or an overlap")
    if buckets[-1][2] is not None:
        raise Refusal(f"{name}: the last range {buckets[-1][0]!r} has an end; nothing counts the longest waits")
    for k, want in total.items():
        got = sum(counts[k] for _, _, _, counts in buckets)
        if got != want:
            raise Refusal(f"{name}: {k}: the ranges add up to {got:,} against a Grand Total of {want:,}")


# ---------------------------------------------------------------------------
# net_backlog
# ---------------------------------------------------------------------------

def backlog_value(v: object, where: str) -> int | None:
    """A net backlog figure: N/A is None, `-` is 0, and anything not a multiple of 100 is refused."""
    n = strict_count(v, where)
    if n is not None and n % 100:
        raise Refusal(f"{where}: {n:,} isn't rounded to the hundred, as every figure here is")
    return n


def parse_net_backlog(sheets: list[tuple[str, list[dict[int, str]]]], listed: Listed) -> Parsed:
    """The net backlog by form and the frontlog, from one workbook or (FY2023 Q4) one csv file each.

    Net backlog: cases pending past USCIS's target time, less the delays the
    applicant caused (evidence requests, intents to deny) and cases waiting on
    a visa number. Frontlog: applications not yet opened at the quarter's end,
    with no breakdown by form. Every backlog figure is rounded to the hundred;
    the frontlog often isn't (77,291 in FY2024 Q2, 247,974 in FY2025 Q4).
    """
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name, as_of=quarter_end(listed.fy, listed.quarter))
    name = listed.name.lower()
    if "backlog" in name:
        p.rows += parse_backlog_sheet(sheets, listed)
    if "frontlog" in name:
        p.rows += parse_frontlog_sheet(sheets, listed)
    reconcile_backlog(p)
    return p


def parse_backlog_sheet(sheets: list[tuple[str, list[dict[int, str]]]], listed: Listed) -> list[dict]:
    rows, header_at = find_sheet(
        sheets, listed.name, "a 'Category and Form Number' / 'Net Backlog' header",
        lambda r: norm(r.get(0)) == "Category and Form Number" and heading(r.get(2)).startswith("Net Backlog"))
    printed = next((d for d in (as_of_date(norm(r.get(0))) for r in rows[:header_at]) if d), None)
    check_quarter_end(listed.name, printed, listed.fy, listed.quarter, snapshot=True)
    if heading(rows[header_at].get(1)) != "Description":
        raise Refusal(f"{listed.name}: column 1 is headed {norm(rows[header_at].get(1))!r}, not Description")
    out: list[dict] = []
    category = ""
    for r in rows[header_at + 1:]:
        first = norm(r.get(0))
        if not first:
            continue
        if first.startswith(("Table Key", "References", "Notes", "Source")):
            break
        title, raw = norm(r.get(1)), norm(r.get(2))
        if not title and not raw:
            category = strip_footnote(first)
            continue
        if first == "TOTAL":
            form, title, cat = "TOTAL", "All forms", ""
        else:
            form, cat = strip_footnote(first), category
            if not title:
                raise Refusal(f"{listed.name}: form {first!r} has no title")
        out.append({"measure": "net_backlog", "form": form, "title": title, "category": cat,
                    "value": backlog_value(r.get(2), f"{listed.name} {form} {title}")})
    return out


def parse_frontlog_sheet(sheets: list[tuple[str, list[dict[int, str]]]], listed: Listed) -> list[dict]:
    rows, at = find_sheet(sheets, listed.name, "an 'All Forms Frontlog' row",
                          lambda r: heading(r.get(0)) == "All Forms Frontlog")
    # The workbook prints the date in its title ("Frontlog for All Forms as of
    # June 30, 2026"); the csv on a line of its own ("As of September 30,2023").
    printed = next((d for d in (as_of_date(norm(r.get(0))) for r in rows[:at]) if d), None)
    check_quarter_end(listed.name, printed, listed.fy, listed.quarter, snapshot=True)
    col = next((c for r in reversed(rows[:at]) for c, v in r.items() if norm(v) == "Total"), None)
    if col is None:
        raise Refusal(f"{listed.name}: no 'Total' heading over the frontlog")
    # The one figure here USCIS doesn't always round: FY2024 Q2 printed 77,291
    # under a note saying it rounds to the hundred, and four quarters since are
    # unrounded too. It has no parts to add up, so it's taken as printed.
    return [{"measure": "frontlog", "form": "ALL", "title": "All forms", "category": "",
             "value": strict_count(rows[at].get(col), f"{listed.name} frontlog")}]


def reconcile_backlog(p: Parsed) -> None:
    keys = [(r["measure"], r["form"], r["title"]) for r in p.rows]
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    if dupes:
        raise Refusal(f"{p.name}: duplicate rows {dupes[:3]}")
    backlog = [r for r in p.rows if r["measure"] == "net_backlog"]
    if not backlog:
        return
    forms = {r["form"] for r in backlog}
    for must in ("TOTAL", "I-140", "I-485", "I-765", "N-400"):
        if must not in forms:
            raise Refusal(f"{p.name}: {must} missing from the net backlog sheet")
    if len(backlog) < 40:
        raise Refusal(f"{p.name}: only {len(backlog)} net backlog rows; expected 40 or more")
    total = next(r["value"] for r in backlog if r["form"] == "TOTAL")
    if total is None:
        raise Refusal(f"{p.name}: the TOTAL row prints N/A, so the forms can't be checked against it")
    held = sum(r["value"] or 0 for r in backlog if r["form"] != "TOTAL")
    gap = total - held
    # Rounding each form to the hundred leaves a total a few hundred off its
    # parts; a dropped row or a shifted column is far more.
    if abs(gap) > BACKLOG_TOTAL_SLACK * total:
        raise Refusal(f"{p.name}: the forms add up to {held:,} against a total of {total:,} "
                      f"({gap:+,}, over {BACKLOG_TOTAL_SLACK:.1%})")
    if gap:
        p.notes.append(f"the forms add up to {gap:+,} off the total of {total:,}")


# ---------------------------------------------------------------------------
# i907_premium
# ---------------------------------------------------------------------------

I907_COLUMNS = {"concurrent": "Concurrent", "upgrade": "Upgrade", "total": "Total"}


def parse_i907_premium(sheets: list[tuple[str, list[dict[int, str]]]], listed: Listed) -> Parsed:
    """Premium processing requests by form: with the petition ("concurrent") or added to a pending one ("upgrade")."""
    p = Parsed(listed.kind, listed.fy, listed.quarter, listed.name)
    rows, header_at = find_sheet(sheets, listed.name, "a 'Form Number' header",
                                 lambda r: norm(r.get(0)) == "Form Number")
    for r in rows[:header_at]:
        qb = quarter_bounds(norm(r.get(0)))
        if qb:
            p.quarter_start, p.quarter_end = qb
            break
    check_quarter_end(listed.name, p.quarter_end, listed.fy, listed.quarter)
    header = rows[header_at]
    if heading(header.get(1)) != "Description":
        raise Refusal(f"{listed.name}: column 1 is headed {norm(header.get(1))!r}, not Description")
    cols = {k: c for k, label in I907_COLUMNS.items() for c, v in header.items() if heading(v) == label}
    if set(cols) != set(I907_COLUMNS) or len(set(cols.values())) != 3:
        raise Refusal(f"{listed.name}: headings {[norm(v) for v in header.values()]}; "
                      "expected Concurrent, Upgrade and Total")
    for r in rows[header_at + 1:]:
        first = norm(r.get(0))
        if not first:
            continue
        if first.startswith(("References", "Notes", "Source", "Table Key")):
            break
        if first.lower() == "grand total":
            form, title = "ALL", "All forms"
        else:
            form, title = strip_footnote(first), norm(r.get(1))
            if not FORM_RE.match(form) or not title:
                raise Refusal(f"{listed.name}: {first!r} / {title!r} is not a form and its title")
        row = {"form": form, "title": title}
        for k, c in cols.items():
            n = strict_count(r.get(c), f"{listed.name} {form} {k}")
            if n is None:
                raise Refusal(f"{listed.name}: {form} {k} is withheld; this file never withholds")
            row[k] = n
        p.rows.append(row)
    reconcile_i907(p)
    return p


def reconcile_i907(p: Parsed) -> None:
    forms = [r["form"] for r in p.rows]
    if len(set(forms)) != len(forms):
        raise Refusal(f"{p.name}: a form appears twice")
    for must in ("ALL", "I-129", "I-140"):
        if must not in forms:
            raise Refusal(f"{p.name}: no {must} row")
    for r in p.rows:
        if r["concurrent"] + r["upgrade"] != r["total"]:
            raise Refusal(f"{p.name}: {r['form']}: concurrent {r['concurrent']:,} and upgrade "
                          f"{r['upgrade']:,} against a total of {r['total']:,}")
    total = next(r for r in p.rows if r["form"] == "ALL")
    for k in I907_COLUMNS:
        held = sum(r[k] for r in p.rows if r["form"] != "ALL")
        if held != total[k]:
            raise Refusal(f"{p.name}: {k}: the forms add up to {held:,} against a Grand Total of {total[k]:,}")


# ---------------------------------------------------------------------------
# n400_offices against the all-forms file
# ---------------------------------------------------------------------------

def check_n400_against_all_forms(p: Parsed, forms: list[dict]) -> list[str]:
    """The office file's Total row against the all-forms file's two N-400 rows, civilian and military.

    Equal in ten of the eleven quarters from FY2024 Q1; FY2024 Q3's differ on
    every measure, by up to 1.6%, while the office file's offices add up to its own Total.
    """
    total = next(r for r in p.rows if r["code"] == "ALL")
    n400 = [f for f in forms if f["form"] == "N-400"]
    mil = next((f for f in n400 if "(military)" in f["title"].lower()), None)
    civ = next((f for f in n400 if "(military)" not in f["title"].lower()), None)
    if civ is None or mil is None:
        raise Refusal(f"{p.name}: the all-forms file lacks an N-400 civilian or military row to check against")
    found: list[str] = []
    for group, row in (("civ", civ), ("mil", mil)):
        for m in OFFICE_MEASURES:
            compare_files(p, f"Total {group}_{m}", total[f"{group}_{m}"], row[m], found, exact=False)
    return found


CROSS_CHECKS = {"i765_categories": check_i765_against_all_forms,
                "n400_offices": check_n400_against_all_forms}


def cross_check(p: Parsed, forms: list[dict] | None) -> str:
    """Check a parse against the all-forms file's quarter where one is held; say what happened."""
    check = CROSS_CHECKS.get(p.kind)
    if check is None:
        return ""
    if forms is None:
        return f"not checked against the all-forms file (its FY{p.fy} Q{p.quarter} rows aren't held)"
    found = check(p, forms)
    if not found:
        return "matches the all-forms file"
    return "DIFFERS from the all-forms file, within the room allowed: " + "; ".join(found)


# ---------------------------------------------------------------------------
# The historical factsheet (PDF)
# ---------------------------------------------------------------------------

FACTSHEET_ROW_RE = re.compile(r"^([A-Z]-\d{2,3}) (.+?) ((?:\d+(?:\.\d+)? ?){9})$")


def parse_factsheet_text(text: str) -> dict:
    """Table 1 of the factsheet, from its extracted text.

    One value per year per row, and two kinds of footnote glue: a
    classification ending in a marker ("Advance Parole Document3") and a
    median with the marker fused to its decimals ("9.16" is 9.1 with
    footnote 6 - the table never prints more than one decimal place).
    """
    m = re.search(r"Data as of (\d{2})/(\d{2})/(\d{4})", text)
    if not m:
        raise Refusal("factsheet: no 'Data as of' line")
    as_of = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
    ym = re.search(r"Basis for Filing ((?:\d{4}\d? ?){9})", text)
    if not ym:
        raise Refusal("factsheet: no year header")
    years = [int(y[:4]) for y in ym.group(1).split()]
    rows: list[dict] = []
    glued: list[str] = []
    for line in text.splitlines():
        if "%" in line:
            continue          # Table 2 is percent change and repeats the labels
        rm = FACTSHEET_ROW_RE.match(line.strip())
        if not rm:
            continue
        form, basis, values = rm.groups()
        basis = strip_footnote(basis)
        months: list[float] = []
        for v in values.split():
            if "." in v and len(v.split(".")[1]) > 1:
                glued.append(f"{form} {basis}: {v}")
                v = v[:v.index(".") + 2]
            months.append(float(v))
        if len(months) != len(years):
            raise Refusal(f"factsheet: {form} {basis} has {len(months)} values for {len(years)} years")
        rows.append({"form": form, "basis": basis, "months": months})
    if len(rows) < 12:
        raise Refusal(f"factsheet: only {len(rows)} rows parsed")
    if not any(r["form"] == "I-485" and "Employment" in r["basis"] for r in rows):
        raise Refusal("factsheet: the employment-based I-485 row is missing")
    return {"asOf": as_of, "years": years, "rows": rows, "glued": glued,
            "note": "FY2024 covers October 1, 2023 to January 31, 2024 (USCIS footnote 2).",
            "source": FACTSHEET_URL}


def fetch_factsheet() -> dict:
    import pdfplumber  # imported here: the workbooks need no PDF library
    blob = fetch_uscis(FACTSHEET_URL, referer=DATA_PAGE)
    with pdfplumber.open(io.BytesIO(blob)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    return parse_factsheet_text(text)


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

DDL = [
    """CREATE TABLE IF NOT EXISTS uscis_form_quarters (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL,
        category TEXT NOT NULL, quarter_start TEXT NOT NULL, quarter_end TEXT NOT NULL,
        received INTEGER, approved INTEGER, denied INTEGER, completed INTEGER, pending INTEGER,
        median_months REAL,
        ytd_received INTEGER, ytd_approved INTEGER, ytd_denied INTEGER, ytd_completed INTEGER,
        ytd_pending INTEGER, source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, form, title))""",
    """CREATE INDEX IF NOT EXISTS idx_ufq_form ON uscis_form_quarters (form, fy, quarter)""",
    """CREATE TABLE IF NOT EXISTS uscis_i485_offices (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, quarter_end TEXT NOT NULL,
        state TEXT NOT NULL, office TEXT NOT NULL, code TEXT NOT NULL,
        """ + ", ".join(f"{c} INTEGER" for c in OFFICE_COLUMNS) + """,
        suppressed INTEGER NOT NULL DEFAULT 0, source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, code))""",
    """CREATE TABLE IF NOT EXISTS uscis_eb_awaiting_visa (
        as_of TEXT NOT NULL, country TEXT NOT NULL, category TEXT NOT NULL,
        count INTEGER NOT NULL, source_file TEXT NOT NULL,
        PRIMARY KEY (as_of, country, category))""",
    """CREATE TABLE IF NOT EXISTS uscis_i140_class_country (
        as_of TEXT NOT NULL, country TEXT NOT NULL, preference TEXT NOT NULL,
        measure TEXT NOT NULL, fy INTEGER NOT NULL, count INTEGER NOT NULL,
        source_file TEXT NOT NULL,
        PRIMARY KEY (as_of, country, preference, measure, fy))""",
    # One row per eligibility code per quarter, wide like the office table:
    # `ALL` is the printed Total row; `discretion` is NULL where the file marks none.
    """CREATE TABLE IF NOT EXISTS uscis_i765_categories (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, quarter_end TEXT NOT NULL,
        code TEXT NOT NULL, description TEXT NOT NULL, discretion TEXT,
        """ + ", ".join(f"{c} INTEGER" for c in I765_COLUMNS) + """,
        suppressed INTEGER NOT NULL DEFAULT 0, source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, code))""",
    # `days_max` NULL is open-ended ("180 or more"); the bucket is the label as printed.
    """CREATE TABLE IF NOT EXISTS uscis_i765_pending_days (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, as_of TEXT NOT NULL,
        filing TEXT NOT NULL, scope TEXT NOT NULL, bucket TEXT NOT NULL,
        days_min INTEGER NOT NULL, days_max INTEGER, count INTEGER NOT NULL, source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, filing, scope, days_min))""",
    # `measure` net_backlog (form TOTAL is the total row) or frontlog (one row, form ALL).
    # `value` NULL where USCIS prints N/A (the backlog isn't tracked).
    """CREATE TABLE IF NOT EXISTS uscis_net_backlog (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, as_of TEXT NOT NULL,
        measure TEXT NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
        value INTEGER, source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, measure, form, title))""",
    """CREATE TABLE IF NOT EXISTS uscis_i907_premium (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, quarter_end TEXT NOT NULL,
        form TEXT NOT NULL, title TEXT NOT NULL,
        concurrent INTEGER NOT NULL, upgrade INTEGER NOT NULL, total INTEGER NOT NULL,
        source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, form))""",
    """CREATE TABLE IF NOT EXISTS uscis_n400_offices (
        fy INTEGER NOT NULL, quarter INTEGER NOT NULL, quarter_end TEXT NOT NULL,
        state TEXT NOT NULL, office TEXT NOT NULL, code TEXT NOT NULL,
        """ + ", ".join(f"{c} INTEGER" for c in N400_COLUMNS) + """,
        suppressed INTEGER NOT NULL DEFAULT 0, source_file TEXT NOT NULL,
        PRIMARY KEY (fy, quarter, code))""",
    """CREATE TABLE IF NOT EXISTS perm_docs (
        key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER NOT NULL)""",
]

# Each kind's table, the columns it writes (after fy and quarter), and how a
# row of the parse fills them. One file replaces its own quarter's rows.
TABLES: dict[str, tuple[str, list[str]]] = {
    "i765_categories": ("uscis_i765_categories",
                        ["quarter_end", "code", "description", "discretion", *I765_COLUMNS, "suppressed"]),
    "i765_pending_days": ("uscis_i765_pending_days",
                          ["as_of", "filing", "scope", "bucket", "days_min", "days_max", "count"]),
    "net_backlog": ("uscis_net_backlog", ["as_of", "measure", "form", "title", "category", "value"]),
    "i907_premium": ("uscis_i907_premium", ["quarter_end", "form", "title", "concurrent", "upgrade", "total"]),
    "n400_offices": ("uscis_n400_offices", ["quarter_end", "state", "office", "code", *N400_COLUMNS, "suppressed"]),
}


def ensure_tables(db: Database) -> None:
    for ddl in DDL:
        db.execute(ddl)


OFFICE_PAGES = pathlib.Path(__file__).resolve().parent.parent / "src" / "lib" / "uscisOffices.json"


def offices_without_a_page(rows: list[dict], path: pathlib.Path | None = None) -> list[str]:
    """Offices USCIS's file lists that the site holds no page for, each as "CODE Office (State)".

    The site gives every office a page of its own from a fixed list (src/lib/uscisOffices.json), which the sitemap
    and the search box read too. An office USCIS adds, or gives a new code, would sit on the index page with no
    page of its own and nothing would say so. The run that finds one ends red and names it.
    """
    import json
    held = {o["code"] for o in json.loads((path or OFFICE_PAGES).read_text())}
    return sorted(f'{r["code"]} {r["office"]} ({r["state"]})'
                  for r in rows if r["code"] != "ALL" and r["code"] not in held)


def newest_office_rows(db: Database, table: str = "uscis_i485_offices") -> list[dict]:
    """The offices of the newest quarter held, whatever this run loaded."""
    return [{"code": str(r[0]), "office": str(r[1]), "state": str(r[2] or "")} for r in query_rows(
        db, f"SELECT code, office, state FROM {table} WHERE (fy, quarter) = "
            f"(SELECT fy, quarter FROM {table} ORDER BY fy DESC, quarter DESC LIMIT 1)", [])]


def count_where(db: Database, table: str, where: str, args: list) -> int:
    return int(db.scalar(f"SELECT count(*) FROM {table} WHERE {where}", args) or 0)


def store(db: Database, p: Parsed) -> int:
    """Replace one file's rows wholesale, then count back. Refuses on loss."""
    if p.kind == "all_forms":
        cols = ["fy", "quarter", "form", "title", "category", "quarter_start", "quarter_end",
                "received", "approved", "denied", "completed", "pending", "median_months",
                "ytd_received", "ytd_approved", "ytd_denied", "ytd_completed", "ytd_pending",
                "source_file"]
        db.execute("DELETE FROM uscis_form_quarters WHERE fy = ? AND quarter = ?", [p.fy, p.quarter])
        insert_rows(db, "uscis_form_quarters", cols, [
            [p.fy, p.quarter, r["form"], r["title"], r["category"], p.quarter_start, p.quarter_end,
             r["received"], r["approved"], r["denied"], r["completed"], r["pending"],
             r["median_months"], r["ytd_received"], r["ytd_approved"], r["ytd_denied"],
             r["ytd_completed"], r["ytd_pending"], p.name] for r in p.rows])
        n = count_where(db, "uscis_form_quarters", "fy = ? AND quarter = ?", [p.fy, p.quarter])
    elif p.kind == "i485_offices":
        cols = ["fy", "quarter", "quarter_end", "state", "office", "code", *OFFICE_COLUMNS,
                "suppressed", "source_file"]
        db.execute("DELETE FROM uscis_i485_offices WHERE fy = ? AND quarter = ?", [p.fy, p.quarter])
        insert_rows(db, "uscis_i485_offices", cols, [
            [p.fy, p.quarter, p.quarter_end, r["state"], r["office"], r["code"],
             *[r[c] for c in OFFICE_COLUMNS], r["suppressed"], p.name] for r in p.rows])
        n = count_where(db, "uscis_i485_offices", "fy = ? AND quarter = ?", [p.fy, p.quarter])
    elif p.kind == "eb_awaiting":
        cols = ["as_of", "country", "category", "count", "source_file"]
        db.execute("DELETE FROM uscis_eb_awaiting_visa WHERE as_of = ?", [p.as_of])
        insert_rows(db, "uscis_eb_awaiting_visa", cols, [
            [p.as_of, r["country"], r["category"], r["count"], p.name] for r in p.rows])
        n = count_where(db, "uscis_eb_awaiting_visa", "as_of = ?", [p.as_of])
    elif p.kind == "i140_class_country":
        cols = ["as_of", "country", "preference", "measure", "fy", "count", "source_file"]
        db.execute("DELETE FROM uscis_i140_class_country WHERE as_of = ?", [p.as_of])
        insert_rows(db, "uscis_i140_class_country", cols, [
            [p.as_of, r["country"], r["preference"], r["measure"], r["fy"], r["count"], p.name]
            for r in p.rows])
        n = count_where(db, "uscis_i140_class_country", "as_of = ?", [p.as_of])
    elif p.kind in TABLES:
        table, cols = TABLES[p.kind]
        # The quarter's own day for every row: the filename's quarter, which
        # the parse has checked against the date the sheet prints.
        end = quarter_end(p.fy, p.quarter)
        filled = [[p.fy, p.quarter, *[end if c in ("quarter_end", "as_of") else r[c] for c in cols], p.name]
                  for r in p.rows]
        where, args = "fy = ? AND quarter = ?", [p.fy, p.quarter]
        if p.kind == "net_backlog":
            # FY2023 Q4 came as two files, one per measure: each replaces only its own.
            measures = sorted({r["measure"] for r in p.rows})
            where += f" AND measure IN ({', '.join('?' for _ in measures)})"
            args += measures
        db.execute(f"DELETE FROM {table} WHERE {where}", args)
        insert_rows(db, table, ["fy", "quarter", *cols, "source_file"], filled)
        n = count_where(db, table, where, args)
    else:
        raise Refusal(f"unknown kind {p.kind}")
    if n != len(p.rows):
        raise Refusal(f"REFUSING {p.name}: parsed {len(p.rows):,} rows but stored {n:,} - "
                      f"{len(p.rows) - n:,} collided on the primary key")
    return n


def read_loads(db: Database) -> dict:
    return read_doc(db, LOADS_DOC) or {}


# Each kind's identifying key for drift, as SQL over its table and from a parsed row.
DRIFT_KEYS: dict[str, tuple[str, str]] = {
    "all_forms": ("uscis_form_quarters", "form || '|' || title"),
    "i485_offices": ("uscis_i485_offices", "code"),
    "n400_offices": ("uscis_n400_offices", "code"),
    "i765_categories": ("uscis_i765_categories", "code"),
    "i907_premium": ("uscis_i907_premium", "form"),
    "net_backlog": ("uscis_net_backlog", "measure || '|' || form || '|' || title"),
}


def row_key(p: Parsed, r: dict) -> str:
    if p.kind == "all_forms":
        return f"{r['form']}|{r['title']}"
    if p.kind == "net_backlog":
        return f"{r['measure']}|{r['form']}|{r['title']}"
    if p.kind == "i907_premium":
        return r["form"]
    return r["code"]


def keys_on_measures(p: Parsed, keys: set[str]) -> set[str]:
    """`keys` as this parse can be compared on them: a net-backlog file holding one measure
    (the FY2023 Q4 csv pair) is compared on that measure alone."""
    if p.kind != "net_backlog":
        return keys
    measures = {r["measure"] for r in p.rows}
    return {k for k in keys if k.split("|", 1)[0] in measures}


def neighbour(db: Database, p: Parsed) -> tuple[tuple[int, int], set[str]] | None:
    """The nearest quarter held before this one and its identifying keys."""
    if p.kind not in DRIFT_KEYS:
        return None
    table, expr = DRIFT_KEYS[p.kind]
    rows = rows_of(db.execute(f"SELECT fy, quarter FROM {table} WHERE (fy < ?) OR (fy = ? AND quarter < ?) "
                              "ORDER BY fy DESC, quarter DESC LIMIT 1", [p.fy, p.fy, p.quarter]))
    if not rows:
        return None
    fy, q = int(rows[0][0]), int(rows[0][1])
    keys = {str(r[0]) for r in query_rows(
        db, f"SELECT {expr} FROM {table} WHERE fy = ? AND quarter = ?", [fy, q])}
    return (fy, q), keys_on_measures(p, keys)


def previous_keys(db: Database, p: Parsed) -> set[str] | None:
    """The identifying keys of the newest quarter held BEFORE this one, for drift."""
    got = neighbour(db, p)
    return got[1] if got else None


def held_after(db: Database, p: Parsed) -> dict[tuple[int, int], set[str]]:
    """Every quarter held AFTER this one, each with its identifying keys; empty when this is the newest."""
    if p.kind not in DRIFT_KEYS:
        return {}
    table, expr = DRIFT_KEYS[p.kind]
    out: dict[tuple[int, int], set[str]] = {}
    for fy, q, key in query_rows(db, f"SELECT fy, quarter, {expr} FROM {table} "
                                     "WHERE (fy > ?) OR (fy = ? AND quarter > ?)", [p.fy, p.fy, p.quarter]):
        out.setdefault((int(fy), int(q)), set()).add(str(key))
    return {quarter: keys_on_measures(p, keys) for quarter, keys in out.items()}


# A file read ahead (see read_ahead): its parse, or whatever stopped it, raised at the file's own turn.
Ahead = dict[str, "Parsed | Exception"]


def drift_witnesses(db: Database | None, p: Parsed, ahead: Ahead | None) -> dict[tuple[int, int], set[str]]:
    """Every quarter after this one known to the run, read ahead or held, each with its keys; empty when none.

    A history load into a database that holds no later quarter has nothing held
    to witness a retirement, so the files of the kinds that refuse a loss are
    all parsed before any is stored (read_ahead) and the quarters listed after
    this one stand in. Each later quarter counts, not only the next: a row
    misread in two quarters running is missing from the next one too, and comes
    back only in the one after. For a quarter read ahead and held, the file this
    run is about to store stands over the held rows it replaces; for a quarter
    listed twice, the last file listed (a `_v2` after its `_v1`), whose rows are
    the ones that end up held. A file that couldn't be read or parsed is no witness.
    """
    if p.kind not in DRIFT_REFUSES:
        return {}
    out = held_after(db, p) if db is not None else {}
    for o in (ahead or {}).values():
        if isinstance(o, Parsed) and o.kind == p.kind and (o.fy, o.quarter) > (p.fy, p.quarter):
            out[(o.fy, o.quarter)] = {row_key(o, r) for r in o.rows}
    return out


def quarters_named(quarters) -> str:
    """How many quarters and their span: `1 later quarter, FY2025 Q4`, `11 later quarters, FY2024 Q2 to FY2026 Q3`."""
    got = sorted(quarters)
    (f1, q1), (f2, q2) = got[0], got[-1]
    span = f"FY{f1} Q{q1}" + (f" to FY{f2} Q{q2}" if (f1, q1) != (f2, q2) else "")
    return f"{len(got)} later quarter{'s' if len(got) > 1 else ''}, {span}"


def drift_findings(previous: set[str] | None, p: Parsed, later: set[str] | None = None) -> list[str]:
    """Keys the previous quarter carried and this one does not, for the kinds that refuse a loss.

    A form USCIS retires is legitimate (I-924 is decommissioned and still
    listed); a form that vanishes because its row was misread is not, and
    the parser cannot tell them apart. So a loss is refused unless a human
    passes --accept-drift after reading the list. No baseline, no findings.

    A quarter with later ones held or read ahead has witnesses
    (drift_witnesses), and `later` is every key any of them carries: a key
    none of them carries was retired by then, as the I-924A was in FY2024 Q4
    and the single I-130 row in FY2025 Q1, and only a key that comes back in
    any later quarter is a finding. The newest quarter has no witness, so any
    loss there waits for a person. The kinds outside DRIFT_REFUSES report their
    changes through drift_notes.
    """
    if previous is None or p.kind not in DRIFT_REFUSES:
        return []
    lost = previous - {row_key(p, r) for r in p.rows}
    if later is not None:
        lost &= later
    lost_list = sorted(lost)
    return [f"{p.kind}: keys held last quarter and not now: {lost_list}"] if lost_list else []


def drift_notes(previous: set[str] | None, p: Parsed) -> list[str]:
    """What this quarter dropped and added against the one before, for the log. Never refuses."""
    if previous is None:
        return []
    now = {row_key(p, r) for r in p.rows}
    out = []
    if previous - now:
        out.append(f"held last quarter and not now: {sorted(previous - now)}")
    if now - previous:
        out.append(f"new this quarter: {sorted(now - previous)}")
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SHEET_PARSERS = {
    "i765_categories": parse_i765_categories,
    "i765_pending_days": parse_i765_pending_days,
    "net_backlog": parse_net_backlog,
    "i907_premium": parse_i907_premium,
}


def parse_counted(listed: Listed, blob: bytes) -> Parsed:
    """`parse_blob`, with what this file stored with a fraction counted on the parse."""
    before = dict(ROUNDED)
    p = parse_blob(listed, blob)
    p.rounded = (ROUNDED["counts"] - before["counts"], ROUNDED["medians"] - before["medians"])
    return p


def read_ahead(items: list[Listed], read) -> Ahead:
    """Read and parse each file now, keeping its parse or what stopped it, for load_one to take in turn.

    Each is read once: load_one uses the parse kept here rather than reading the file again.
    """
    out: Ahead = {}
    for item in items:
        log(f"  {item.name}: reading ahead")
        try:
            out[item.name] = parse_counted(item, read(item))
        except (Refusal, *READ_ERRORS) as exc:
            out[item.name] = exc
    return out


def parse_blob(listed: Listed, blob: bytes) -> Parsed:
    sheets = sheets_of(listed, blob)
    if not sheets:
        raise Refusal(f"{listed.name}: no worksheets")
    if listed.kind in SHEET_PARSERS:
        return SHEET_PARSERS[listed.kind](sheets, listed)
    if listed.kind == "n400_offices":
        rows, _ = find_sheet(sheets, listed.name, "a 'Field Office by State' header",
                             lambda r: norm(r.get(0)).startswith("Field Office by State"))
        return parse_n400_offices(rows, listed)
    if listed.kind == "all_forms":
        return parse_all_forms(sheets[0][1], listed)
    if listed.kind == "i485_offices":
        return parse_i485_offices(sheets[0][1], listed)
    if listed.kind == "eb_awaiting":
        return parse_eb_awaiting(sheets[0][1], listed)
    return parse_i140_class_country(sheets, listed)


def local_listing(directory: pathlib.Path) -> list[Listed]:
    out = []
    for path in sorted(directory.iterdir()):
        ident = identify(path.name)
        if ident:
            kind, fy, q = ident
            out.append(Listed(kind, fy, q, path.name, str(path)))
    return sort_listed(out)


def all_forms_rows(db: Database | None, cache: dict[tuple[int, int], list[dict]],
                   fy: int, quarter: int) -> list[dict] | None:
    """The all-forms file's rows for a quarter: parsed in this run, or held in the table; None when neither."""
    if (fy, quarter) in cache:
        return cache[(fy, quarter)]
    if db is None:
        return None
    try:
        got = query_rows(db, "SELECT form, title, received, approved, denied, pending "
                             "FROM uscis_form_quarters WHERE fy = ? AND quarter = ?", [fy, quarter])
    except Exception as exc:  # noqa: BLE001 - only "no such table" is an honest empty
        if "no such table" in str(exc).lower():
            return None
        raise
    if not got:
        return None
    return [{"form": str(r[0]), "title": str(r[1]),
             **{m: (None if v is None else int(v)) for m, v in zip(OFFICE_MEASURES, r[2:])}} for r in got]


def figure(v: int | float | None) -> str:
    """A figure for the log: with its commas, or N/A where USCIS withheld it or printed N/A."""
    return "N/A" if v is None else f"{v:,}"


def describe(p: Parsed) -> str:
    """One line on what a parse holds, for the log. Every figure goes through `figure`: any of them may be None."""
    if p.kind == "all_forms":
        i140 = next((r for r in p.rows if r["form"] == "I-140"), None)
        return (f"{len(p.rows)} forms, {p.quarter_start}..{p.quarter_end}; "
                f"I-140 median {figure(i140['median_months'])} months, pending {figure(i140['pending'])}" if i140 else
                f"{len(p.rows)} forms")
    if p.kind == "i485_offices":
        total = next(r for r in p.rows if r["code"] == "ALL")
        return (f"{len(p.rows) - 1} offices; employment pending {figure(total['emp_pending'])}; "
                f"{sum(r['suppressed'] for r in p.rows)} suppressed cells")
    if p.kind == "eb_awaiting":
        total = next(r["count"] for r in p.rows if r["country"] == "TOTAL" and r["category"] == "TOTAL")
        india = next(r["count"] for r in p.rows if r["country"] == "India" and r["category"] == "TOTAL")
        return f"as of {p.as_of}: {figure(total)} awaiting a visa, India {figure(india)}"
    if p.kind == "i765_categories":
        c9 = next(r for r in p.rows if r["code"] == "C09")
        return (f"{len(p.rows) - 1} codes; (c)(9) pending {figure(c9['all_pending'])} "
                f"({figure(c9['initial_pending'])} initial); {sum(r['suppressed'] for r in p.rows)} withheld cells")
    if p.kind == "i765_pending_days":
        top = next(r for r in reversed(p.rows) if r["filing"] == "initial" and r["scope"] == "all")
        return (f"as of {p.as_of}: {len({r['days_min'] for r in p.rows})} ranges; "
                f"{figure(top['count'])} initial applications pending {top['bucket']}")
    if p.kind == "net_backlog":
        by = {(r["measure"], r["form"]): r["value"] for r in p.rows}
        parts = []
        if ("net_backlog", "TOTAL") in by:
            forms = sum(1 for r in p.rows if r["measure"] == "net_backlog" and r["form"] != "TOTAL")
            parts.append(f"net backlog {figure(by[('net_backlog', 'TOTAL')])} across {forms} rows")
        if ("frontlog", "ALL") in by:
            parts.append(f"frontlog {figure(by[('frontlog', 'ALL')])}")
        return "; ".join(parts)
    if p.kind == "i907_premium":
        total = next(r for r in p.rows if r["form"] == "ALL")
        i140 = next(r for r in p.rows if r["form"] == "I-140")
        return f"{figure(total['total'])} premium requests, I-140 {figure(i140['total'])}"
    if p.kind == "n400_offices":
        total = next(r for r in p.rows if r["code"] == "ALL")
        return (f"{len(p.rows) - 1} offices; civilian pending {figure(total['civ_pending'])}, "
                f"all {figure(total['all_pending'])}; {sum(r['suppressed'] for r in p.rows)} suppressed cells")
    countries = sorted({r["country"] for r in p.rows})
    return f"{len(p.rows)} cells across {len(countries)} sheets ({', '.join(countries)})"


def stamp_moves_forward(held: str | None, run: str) -> bool:
    """Whether a run's newest quarter may be stamped: never over a newer stamp already held."""
    return held is None or run >= held


def held_as_of(db: Database, dataset: str) -> str | None:
    """The as-of day the health check holds for a dataset, or None when it holds none yet."""
    try:
        got = rows_of(db.execute("SELECT as_of FROM data_freshness WHERE dataset = ?", [dataset]))
    except Exception as exc:  # noqa: BLE001 - only "no such table" is an honest empty
        if "no such table" in str(exc).lower():
            return None
        raise
    return str(got[0][0]) if got and got[0][0] else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--local", help="Parse the quarterly workbooks in this directory instead of discovering")
    ap.add_argument("--dry-run", action="store_true", help="Parse and reconcile; write nothing")
    ap.add_argument("--force", action="store_true", help="Reload files already recorded as loaded")
    ap.add_argument("--accept-drift", action="store_true",
                    help="Load a quarter that lost keys the previous one carried")
    ap.add_argument("--skip-factsheet", action="store_true", help="Do not fetch the historical PDF")
    args = ap.parse_args(argv)
    started = time.time()

    listing_note, listing_failed = "", ""
    if args.local:
        listed = local_listing(pathlib.Path(args.local))
        read = lambda item: pathlib.Path(item.url).read_bytes()  # noqa: E731
    else:
        log(f"Discovering the quarterly files from {DATA_PAGE} and the pages after it")
        listing = read_listing(fetch_uscis)
        listed = listing.files
        listing_note, listing_failed = listing.stopped, listing.failed
        log(f"  {listing.pages} listing page(s) read")
        for line in (listing_note, listing_failed):
            if line:
                log(f"  {line}")
        read = lambda item: fetch_uscis(item.url, referer=DATA_PAGE)  # noqa: E731
    if not listed:
        raise SystemExit("no quarterly file found on the USCIS data page")
    by_kind: dict[str, list[Listed]] = {}
    for item in listed:
        by_kind.setdefault(item.kind, []).append(item)
    for kind, items in sorted(by_kind.items()):
        log(f"  {kind}: " + ", ".join(f"FY{i.fy} Q{i.quarter}" for i in items))
    for kind in KINDS:
        if kind not in by_kind:
            log(f"  WARNING: no {kind} file listed")

    db = None if args.dry_run else Database()
    if db is not None:
        ensure_tables(db)
    loads = {} if db is None else read_loads(db)

    written = 0
    loaded_names: list[str] = []
    refused: list[str] = []
    remarks: list[str] = []
    newest_as_of: dict[str, str] = {}
    forms_cache: dict[tuple[int, int], list[dict]] = {}
    due = [item for item in listed if args.force or item.name not in loads]
    # The kinds that refuse a lost row are parsed before anything is stored, so each quarter's next one
    # can witness a retirement even in a database that holds no later quarter (drift_witness).
    ahead = read_ahead([item for item in due if item.kind in DRIFT_REFUSES], read)
    for item in listed:
        if not args.force and item.name in loads:
            log(f"  {item.name}: already loaded {loads[item.name].get('loadedOn', '')}; skipping")
            prior = quarter_end(item.fy, item.quarter)
            if prior > newest_as_of.get(item.kind, ""):
                newest_as_of[item.kind] = prior
            continue
        log(f"  {item.name}: {'loading, read ahead above' if item.name in ahead else 'fetching'}")
        try:
            n = load_one(db, item, read, forms_cache, remarks, accept_drift=args.accept_drift, ahead=ahead)
        except (Refusal, *READ_ERRORS) as exc:
            # This file's alone: it isn't recorded, so the next run tries it again, and this run ends red.
            log(f"    REFUSED: {exc}")
            refused.append(f"{item.name} ({str(exc)[:160]})")
            continue
        # The freshness stamp is the quarter's last day for every kind. The
        # awaiting-visa sheet says "As of June 2026" and the class sheet names
        # a quarter, and neither is a date the health check can age.
        as_of = quarter_end(item.fy, item.quarter)
        if as_of > newest_as_of.get(item.kind, ""):
            newest_as_of[item.kind] = as_of
        if db is None:
            continue
        written += n
        loaded_names.append(item.name)
        loads[item.name] = {"kind": item.kind, "fy": item.fy, "quarter": item.quarter,
                            "rows": n, "asOf": as_of, "loadedOn": et_today()}
        write_doc(db, LOADS_DOC, loads)
        log(f"    stored {n:,} rows")

    factsheet_note = ""
    if not args.skip_factsheet:
        try:
            doc = fetch_factsheet()
            factsheet_note = f"; factsheet as of {doc['asOf']} ({len(doc['rows'])} rows)"
            for g in doc["glued"]:
                log(f"  factsheet footnote glue read past: {g}")
            if db is not None:
                write_doc(db, FACTSHEET_DOC, doc)
            log(f"  factsheet: {len(doc['rows'])} rows, data as of {doc['asOf']}")
        except (Exception, SystemExit) as exc:  # noqa: BLE001 - optional step, named in the run note
            # The factsheet is static and optional: a refusal here must not
            # fail the quarterly load it rides with. It is named in the run
            # note so the miss is on the record.
            factsheet_note = f"; factsheet NOT read ({exc})"
            log(f"  factsheet: not read ({exc})")

    trouble = ""
    if refused:
        trouble += f"; REFUSED {len(refused)} file(s): {'; '.join(refused)}"
    if listing_failed:
        trouble += f"; LISTING NOT READ TO THE END: {listing_failed}"
    if db is None:
        log(f"dry run: {len(listed) - len(refused)} of {len(listed)} file(s) parsed and reconciled, "
            f"nothing written{trouble}")
        return 1 if trouble else 0

    for kind, fresh in FRESHNESS.items():
        dataset, source = fresh["dataset"], fresh["source"]
        as_of = newest_as_of.get(kind)
        if not as_of:
            log(f"  {dataset}: nothing held, not stamped")
            continue
        held = held_as_of(db, dataset)
        if not stamp_moves_forward(held, as_of):
            # A history load (older quarters from the Internet Archive, through --local) describes the past:
            # stamping it would tell the health check the dataset is as old as the quarters it just read.
            log(f"  {dataset}: this run's newest quarter ends {as_of}, before the {held} already held; not stamped")
            continue
        stamp_freshness(db, dataset, as_of=as_of, source=source, cadence="Quarterly",
                        note=f"{len(by_kind.get(kind, []))} quarter(s) listed by USCIS; "
                             f"newest as of {as_of}",
                        max_age_days=MAX_AGE_DAYS)
    note = (f"loaded {', '.join(loaded_names)}" if loaded_names
            else f"nothing new among {len(listed)} listed file(s)") + factsheet_note
    if listing_note:
        note += f"; {listing_note}"
    for remark in remarks:
        note += f"; {remark}"
    note += trouble
    # Checked on every run against what's held, so the run stays red until the list is fixed.
    unpaged = offices_without_a_page(newest_office_rows(db))
    if unpaged:
        note += f"; NO PAGE on the site for {len(unpaged)} office(s): {', '.join(unpaged)}"
    # The N-400 offices share the I-485 offices' codes and pages. No page shows them yet, so one the
    # list lacks is named here for the day one does, without turning the run red.
    unpaged_n400 = offices_without_a_page(newest_office_rows(db, "uscis_n400_offices"))
    if unpaged_n400:
        note += f"; N-400 offices with no page on the site: {', '.join(unpaged_n400)}"
    record_run(db, "ingest_uscis_quarterly.py", status="failed" if trouble else "ok",
               rows_written=written, note=note, started_at=started)
    log(f"done: {note}")
    if unpaged:
        # The quarter is loaded and stamped. The run still ends red: an office with no page is work for a person.
        log("FAILED: add each office above to src/lib/uscisOffices.json (code, name, state, slug), then rerun")
    if trouble:
        log("FAILED: the files named above were not loaded; the next run tries them again")
    return 1 if unpaged or trouble else 0


def load_one(db: Database | None, item: Listed, read, forms_cache: dict[tuple[int, int], list[dict]],
             remarks: list[str], *, accept_drift: bool, ahead: Ahead | None = None) -> int:
    """Read, parse, check and (unless a dry run) store one file. Returns the rows parsed or stored; raises Refusal.

    A file read ahead (see read_ahead) is taken from `ahead`, its refusal or read error raised here as its own.
    A disagreement with the all-forms file inside the room allowed goes in `remarks`, for the run's note,
    and so does each row judged retired (drift_witnesses), with the quarter it went in.
    """
    got = (ahead or {}).get(item.name)
    if isinstance(got, BaseException):
        raise got
    p = got if got is not None else parse_counted(item, read(item))
    log(f"    parsed: {describe(p)}")
    counts, medians = p.rounded
    if counts or medians:
        log(f"    read as the sheet shows them: {counts} counts stored with a fraction, "
            f"{medians} medians stored unrounded")
    for note in p.notes:
        log(f"    note: {note}")
    if p.kind == "all_forms":
        forms_cache[(p.fy, p.quarter)] = [
            {"form": r["form"], "title": r["title"], **{m: r[m] for m in OFFICE_MEASURES}} for r in p.rows]
    checked = cross_check(p, all_forms_rows(db, forms_cache, p.fy, p.quarter))
    if checked:
        log(f"    {checked}")
    if checked.startswith("DIFFERS"):
        remarks.append(f"{item.name}: {checked}")
    if db is None:
        return len(p.rows)
    previous = previous_keys(db, p)
    for line in drift_notes(previous, p):
        log(f"    changed against the previous quarter: {line}")
    witnesses = drift_witnesses(db, p, ahead)
    later = set().union(*witnesses.values()) if witnesses else None
    lost = previous - {row_key(p, r) for r in p.rows} if witnesses and previous is not None else set()
    retired = sorted(lost - later) if lost else []
    if lost:
        if retired:
            log(f"    gone from every later quarter known too ({quarters_named(witnesses)}), "
                f"so retired rather than misread: {retired}")
        for key in sorted(lost & later):
            back = sorted(quarter for quarter, keys in witnesses.items() if key in keys)
            log(f"    {key!r} is back in FY{back[0][0]} Q{back[0][1]}"
                + (f" and {len(back) - 1} quarter(s) after it" if len(back) > 1 else "")
                + ", so its loss here isn't a retirement")
    findings = drift_findings(previous, p, later)
    if findings and not accept_drift:
        for f in findings:
            log(f"    DRIFT: {f}")
        raise Refusal(f"REFUSING {item.name}: keys were lost against the previous quarter; "
                      "read the list and re-run with --accept-drift if USCIS retired them")
    for f in findings:
        log(f"    drift accepted: {f}")
    n = store(db, p)
    if retired:
        # Named in the run's note too, each with the quarter it went in, once the quarter is stored.
        remarks.append(f"{p.kind} FY{p.fy} Q{p.quarter} retired (gone from every later quarter known): {retired}")
    return n


if __name__ == "__main__":
    sys.exit(main())

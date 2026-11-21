#!/usr/bin/env python3
"""PERM decisions from FY2008 to FY2023: a record per employer per year, and
the cases themselves.

The current corpus (`perm_cases`) starts with decisions on 2023-10-01, the
first day of FY2024, because that is where the quarterly ingest's `--since-fy`
starts. DOL publishes every year back to FY2008. This reads those files once
and writes two things, chosen for what they answer and what they cost:

    perm_employer_years   slug, fiscal year, certified / denied / withdrawn.
                          FY2008 onward. An employer's track record, the thing
                          an older year is actually useful for.
    perm_cases_history    the case rows for FY2008 to FY2023, perm_cases'
                          columns plus the worker's (citizenship, birth
                          country, visa at filing, education, field of study,
                          school, the job's required education: the old form
                          carries them, the new one doesn't), so a case can be
                          looked up, listed and searched. The worker's fields
                          begin with FY2016; before it they are NULL, and
                          before FY2015 so are the received date and the
                          duration (the files carry no received date).
                          Until Oct 3 2026 rows began at FY2016 to spare
                          Turso's per-row bill, which the server move ended.
    perm_country_years    decisions by country of citizenship and year,
                          national, FY2008 onward.
    perm_history_facets   each employer's and occupation's top values for the
                          worker's fields, from the history rows.
    perm_history_decided_days  decision days by the month DOL decided, FY2015
                          (the first file with a received date) to FY2023,
                          for the PERM wait trend (build_decided_days).
    perm_history_worksites, perm_history_wage_bands, and the salary
                          explorer's older years in wage_views: one pass,
                          ten days of decisions at a time, for the readers
                          that otherwise stop at FY2024 (build_places_and_wages).

`--current` fills FY2024 onward of `perm_employer_years` from `perm_cases`, so
one table carries the whole series; the quarterly ingest runs it after each
load.

WHAT THE OLD FILES DIFFER IN, read off DOL's record layouts (FY10 .doc, FY16,
FY2020 PDFs; Sep 26 2026):
- the case number is `CASE_NO` (to FY2014) or `CASE_NUMBER`, and old numbers
  are `A-YYDDD-NNNNN`;
- there is NO received date before FY2015, so a row is kept on its decision
  date alone and its duration is left empty;
- the law firm is `AGENT_FIRM_NAME` (FY2015 to FY2019) or
  `AGENT_ATTORNEY_FIRM_NAME` (FY2020 on), and absent before;
- the industry is `2007_NAICS_US_CODE`, `NAICS_US_CODE` or `NAICS_CODE`.
Every name that resolves nothing degrades to an empty field and is logged.

File names are DISCOVERED from DOL's performance page, never built: they run
`PERM_FY2008.xlsx`, `PERM_FY14_Q4.xlsx`, `PERM_Disclosure_Data_FY17.xlsx`,
`PERM_Disclosure_Data_FY2018_EOY.xlsx`, and no pattern covers them all.

RESUMABLE, because www.dol.gov refuses sustained traffic from one address
(measured: 200, then 403 about 240 MB later). Each file is downloaded, parsed,
written and recorded in `perm_docs['perm_history']` before the next is asked
for, and a recorded file is skipped next time unless `--force`.

Usage:
    python3 scripts/ingest_perm_history.py                 # every year not yet loaded
    python3 scripts/ingest_perm_history.py --from-fy 2020 --to-fy 2021
    python3 scripts/ingest_perm_history.py --local PERM_FY2010.xlsx --dry-run
    python3 scripts/ingest_perm_history.py --current       # FY2024 onward only
    python3 scripts/ingest_perm_history.py --fill-firm-slugs  # each row's firm on today's page or its own name
    python3 scripts/ingest_perm_history.py --places-wages  # the worksites, wage bands and explorer years only
    python3 scripts/ingest_perm_history.py --places-wages --dry-run  # the same reads; counts and sizes, no write
    python3 scripts/ingest_perm_history.py --decided-days  # the wait trend's FY2015 to FY2023 months only
    python3 scripts/ingest_perm_history.py --years-wages   # the years and wage cells only

The small records built from the case rows after every load (and alone by
their own flag): perm_history_month_days and perm_history_alphabet
(`--month-days`), perm_docs['perm_history_years'] and
perm_history_wage_cells (`--years-wages`). Each reads the table a few days
at a time, so no statement passes a second on the live database.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import os
import pathlib
import re
import sqlite3
import sys
import tempfile
import time
import zipfile
from collections import Counter, defaultdict
from datetime import date, timedelta
from xml.etree.ElementTree import iterparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ingest_perm_disclosure as ipd  # noqa: E402
from build_entity_detail import city_key, city_labels, industry_label  # noqa: E402
from entity_identity import SpacedKeyMap, entity_key  # noqa: E402
from lib_naics import normalize_naics  # noqa: E402
from lib_db import (  # noqa: E402
    SLUG_WINDOWS, Database, add_missing_columns, canon, canon_hash, case_update, counted_slices, dicts_of, next_month,
    insert_rows, insert_stmts, month_thirds, months_between, record_run, rows_of, run_stmts, slug_window, stmt,
    write_doc,
)
from lib_gov_data import SPREADSHEET_NS, column_index, fetch, log, read_shared_strings  # noqa: E402
from lib_slugs import slugify  # noqa: E402
from lib_withheld import Matcher, matcher_for  # noqa: E402

FIRST_FY, LAST_FY = 2008, 2023
ROWS_FROM_FY = 2008
DOC_KEY = "perm_history"
PAUSE_BETWEEN_FILES_S = 30
FILL_PAUSE_S = 1.0  # idle after each month of --fill-firm-slugs' writes

# The current parser's names, plus the old forms'. Copied, never mutated: the
# quarterly parser's candidate list is its own contract.
CANDIDATES: dict[str, list[str]] = copy.deepcopy(ipd.COLUMN_CANDIDATES)
CANDIDATES["attorney"] = CANDIDATES["attorney"] + ["AGENT_FIRM_NAME"]
CANDIDATES["naics"] = CANDIDATES["naics"] + ["2007_NAICS_US_CODE", "2012_NAICS_US_CODE"]
# The wage request each case was filed on, its own fields (sweep item 1). Names read from DOL's files on Nov 21 2026:
# FY2016 and FY2019 (PERM_Disclosure_Data_FY16.xlsx, PERM_FY2019.xlsx) print the _9089 and short forms, FY2020 to FY2023
# the long ones. A column maps to one field, so the offered wage no longer lists the PW_ columns as fallbacks:
# parse_workbook falls back to the prevailing wage itself when a year has no offered-wage column, as it always did.
CANDIDATES["wage"] = [n for n in CANDIDATES["wage"] if not n.startswith("PW_")]
CANDIDATES["wage_unit"] = [n for n in CANDIDATES["wage_unit"] if not n.startswith("PW_")]
CANDIDATES["pw_number"] = ["PW_TRACK_NUMBER", "PW_TRACK_NUM"]
CANDIDATES["pw_wage"] = ["PW_WAGE", "PW_AMOUNT_9089", "PW_AMOUNT"]
CANDIDATES["pw_unit"] = ["PW_UNIT_OF_PAY", "PW_UNIT_OF_PAY_9089"]
CANDIDATES["pw_level"] = ["PW_SKILL_LEVEL", "PW_LEVEL_9089"]
CANDIDATES["pw_determined"] = ["PW_DETERMINATION_DATE", "PW_DETERM_DATE"]
CANDIDATES["pw_expires"] = ["PW_EXPIRATION_DATE", "PW_EXPIRE_DATE"]
REQUIRED = ("case", "status", "decision", "employer")

COLUMNS = [
    "case_number", "status", "received_date", "decision_date", "days",
    "fiscal_year", "employer_name", "employer_slug", "state", "job_title",
    "soc_code", "soc_title", "attorney_name", "attorney_slug", "wage",
    "naics", "worksite_city",
    "citizenship", "birth_country", "visa_class", "education", "major",
    "institution", "job_education",
    # DOL's Y or N to "a layoff in this occupation in the six months before filing" (Nov 3 2026).
    "layoff",
    # The wage request: its number as DOL printed it (the older files' own form, P10019059473403, which no page of
    # wage requests holds), the prevailing wage a year, its level and its two dates (sweep item 1, Nov 21 2026).
    "pw_number", "pw_wage", "pw_level", "pw_determined", "pw_expires",
]
# The first CORE columns decide whether a stored row is the same case record;
# the rest (the worker's fields) can be filled into a row that is otherwise
# unchanged with a narrow UPDATE: one row write, where a whole-row replace
# deletes and reinserts the row and every index entry.
CORE = 17
EXTRA = COLUMNS[CORE:]
NARROW_ROWS = 60
YEAR_COLUMNS = ["slug", "fy", "certified", "denied", "withdrawn"]
STMTS_PER_REQUEST = 4

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS perm_employer_years (
         slug      TEXT NOT NULL,
         fy        INTEGER NOT NULL,
         certified INTEGER NOT NULL,
         denied    INTEGER NOT NULL,
         withdrawn INTEGER NOT NULL,
         PRIMARY KEY (slug, fy)
       )""",
    # A page reads every year of one employer: the index holds the whole row (3.6 to 1.5 ms, Nov 8 2026).
    "CREATE INDEX IF NOT EXISTS perm_employer_years_cover ON perm_employer_years(slug, fy, certified, denied, withdrawn)",
    """CREATE TABLE IF NOT EXISTS perm_cases_history (
         case_number   TEXT PRIMARY KEY,
         status        TEXT NOT NULL,
         received_date TEXT,
         decision_date TEXT,
         days          INTEGER,
         fiscal_year   TEXT,
         employer_name TEXT,
         employer_slug TEXT,
         state         TEXT,
         job_title     TEXT,
         soc_code      TEXT,
         soc_title     TEXT,
         attorney_name TEXT,
         attorney_slug TEXT,
         wage          REAL,
         naics         TEXT,
         worksite_city TEXT,
         citizenship   TEXT,
         birth_country TEXT,
         visa_class    TEXT,
         education     TEXT,
         major         TEXT,
         institution   TEXT,
         job_education TEXT,
         layoff        TEXT,
         pw_number     TEXT,
         pw_wage       REAL,
         pw_level      TEXT,
         pw_determined TEXT,
         pw_expires    TEXT
       )""",
    # An employer page lists its own cases, newest first: one equality and
    # the ordering column last, so the index supplies the order.
    "CREATE INDEX IF NOT EXISTS idx_pch_emp_dec ON perm_cases_history(employer_slug, decision_date)",
    # The page's recent-cases list reads only these columns, so the index carries them and the read never visits the
    # table's rows, scattered across the file (5.5 to 2.5 ms a page with nothing cached, Nov 8 2026).
    "CREATE INDEX IF NOT EXISTS idx_pch_emp_dec_cover ON perm_cases_history"
    "(employer_slug, decision_date, case_number, status, job_title, state, wage)",
    # An employer's PERM applications by the year it filed them (`src/lib/db/employerStarts.ts`, INDEXED BY this
    # name): the filing day and the case number are in the index. THIS TABLE IS BIG AND RARELY READ WHOLE: building
    # this on production by hand on Nov 12 2026 held the write lock for about six minutes in the daytime, the
    # watchdog restarted the database, and 11 page loads were refused. An index on this table is built at night,
    # with the watchdog's timer stopped for the build.
    "CREATE INDEX IF NOT EXISTS idx_pch_emp_dec_recv ON perm_cases_history"
    "(employer_slug, decision_date, received_date, case_number)",
    """CREATE TABLE IF NOT EXISTS perm_country_years (
         country   TEXT NOT NULL,
         fy        INTEGER NOT NULL,
         certified INTEGER NOT NULL,
         denied    INTEGER NOT NULL,
         withdrawn INTEGER NOT NULL,
         PRIMARY KEY (country, fy)
       )""",
    """CREATE TABLE IF NOT EXISTS perm_history_facets (
         kind  TEXT NOT NULL,
         slug  TEXT NOT NULL,
         facet TEXT NOT NULL,
         pos   INTEGER NOT NULL,
         key   TEXT NOT NULL,
         label TEXT NOT NULL,
         n     INTEGER NOT NULL,
         PRIMARY KEY (kind, slug, facet, pos)
       )""",
    # Decision days by filing month, cases perm_cases also holds left out: the month document adds these to
    # perm_cases' own (ingest_case_status_direct.write_decided_percentiles), so a month filed before October 2023
    # counts its fast cases too. Rebuilt whole whenever history loads.
    """CREATE TABLE IF NOT EXISTS perm_history_month_days (
         m    TEXT NOT NULL,
         days INTEGER NOT NULL,
         n    INTEGER NOT NULL,
         PRIMARY KEY (m, days)
       )""",
    # The alphabet chart's filing months (build_alphabet.SINCE_MONTH on) from the older table, by employer initial:
    # build_alphabet.py adds them to perm_cases' own, so January to September 2023 count their fast cases too.
    """CREATE TABLE IF NOT EXISTS perm_history_alphabet (
         month    TEXT NOT NULL,
         letter   TEXT NOT NULL,
         n        INTEGER NOT NULL,
         sum_days REAL NOT NULL,
         PRIMARY KEY (month, letter)
       )""",
    # Each employer's PERM worksites in the older table, state and city upper case ('' when the file left one
    # blank): the enforcement loaders (lib_dol_records.load_sponsors, sponsor_cities) test a record's state and city
    # against these and perm_cases' own. Rebuilt whole by build_places_and_wages.
    """CREATE TABLE IF NOT EXISTS perm_history_worksites (
         slug  TEXT NOT NULL,
         state TEXT NOT NULL,
         city  TEXT NOT NULL,
         PRIMARY KEY (slug, state, city)
       )""",
    # Decision days by the month DOL decided, certified and denied only, from FY2015 to where perm_cases starts:
    # the PERM wait trend (build_wait_trends.py) adds these months before perm_cases' own. Rebuilt whole by
    # build_decided_days whenever history loads.
    """CREATE TABLE IF NOT EXISTS perm_history_decided_days (
         m    TEXT NOT NULL,
         days INTEGER NOT NULL,
         n    INTEGER NOT NULL,
         PRIMARY KEY (m, days)
       )""",
    # Certified and denied cases with a yearly wage, by fiscal year and fine wage band (the lower edge, as
    # src/lib/db/wages.ts bands perm_cases): the wage bands by year add these years to perm_cases' own.
    """CREATE TABLE IF NOT EXISTS perm_history_wage_bands (
         fy      TEXT NOT NULL,
         band    INTEGER NOT NULL,
         decided INTEGER NOT NULL,
         denied  INTEGER NOT NULL,
         PRIMARY KEY (fy, band)
       )""",
    # Each fiscal year's certified wages by occupation (the SOC detail group, `15-1252`), nationally (state '') and
    # by worksite state, as the percentiles the case page's wage ladder draws: an older case is placed among its own
    # year's peers (src/lib/db/caseContext.ts), since the page never reads this table's rows. A cell under
    # WAGE_CELL_FLOOR cases isn't written. Rebuilt with the history (build_history_years_wages).
    """CREATE TABLE IF NOT EXISTS perm_history_wage_cells (
         fy       INTEGER NOT NULL,
         soc      TEXT NOT NULL,
         state    TEXT NOT NULL,
         n        INTEGER NOT NULL,
         avg      REAL,
         p5       REAL,
         p25      REAL,
         p50      REAL,
         p75      REAL,
         p95      REAL,
         built_at INTEGER NOT NULL,
         PRIMARY KEY (fy, soc, state)
       )""",
]

# The master case search reads history under the same leads as perm_cases.
# Built AFTER the rows (one pass each rather than maintained per insert), and
# every reader must work without them: they are the first thing to drop if the
# write budget cannot hold them.
SEARCH_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_pch_dec ON perm_cases_history(decision_date)",
    "CREATE INDEX IF NOT EXISTS idx_pch_state_dec ON perm_cases_history(state, decision_date)",
    "CREATE INDEX IF NOT EXISTS idx_pch_socg_dec ON perm_cases_history(substr(soc_code, 1, 7), decision_date)",
    "CREATE INDEX IF NOT EXISTS idx_pch_att_dec ON perm_cases_history(attorney_slug, decision_date)",
    "CREATE INDEX IF NOT EXISTS idx_pch_cit_dec ON perm_cases_history(citizenship, decision_date)",
    # One received day, for the filed-on-day pages (built on production by hand Nov 5 2026).
    "CREATE INDEX IF NOT EXISTS idx_pch_recv ON perm_cases_history(received_date)",
    # /perm-cases' list with an outcome and no other filter, newest or oldest first (src/lib/db/cases.ts): without
    # it the read walks idx_pch_dec opening each row for its status, a hundred rows for one denial. Built at night.
    "CREATE INDEX IF NOT EXISTS idx_pch_status_dec ON perm_cases_history(status, decision_date)",
]


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def history_files(html: str, first: int, last: int) -> list[tuple[str, str, int]]:
    """(name, url, fiscal year) for every PERM workbook DOL links in range, newest first.

    Pure, so it can be tested against the page's real names. A year DOL
    publishes as two workbooks keeps both; the rows are de-duplicated by case
    number when read.
    """
    found: dict[str, tuple[str, int]] = {}
    for href in re.findall(r'href="([^"]+)"', html):
        href = href.replace("&amp;", "&")
        name = href.rsplit("/", 1)[-1]
        if not re.match(r"^PERM_[^/]*\.xlsx$", name, re.I) or re.search(r"layout", name, re.I):
            continue
        fy = ipd.file_fiscal_year(name)
        if not first <= fy <= last:
            continue
        url = href if href.startswith("http") else f"https://www.dol.gov{href}"
        found[name] = (url, fy)
    return sorted(((n, u, fy) for n, (u, fy) in found.items()),
                  key=lambda t: (t[2], t[0]), reverse=True)


# ---------------------------------------------------------------------------
# Reading a workbook
# ---------------------------------------------------------------------------

def first_sheet(z: zipfile.ZipFile) -> str:
    """The path of the workbook's first sheet, read from the workbook itself.

    `xl/worksheets/sheet1.xml` is only a convention. An older export can put
    the first tab under another number, and reading the wrong one is a
    silently empty year.
    """
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    try:
        with z.open("xl/workbook.xml") as f:
            for _, el in iterparse(f, events=("end",)):
                if el.tag == SPREADSHEET_NS + "sheet":
                    rid = el.get(rel_ns + "id")
                    break
            else:
                rid = None
        if rid:
            with z.open("xl/_rels/workbook.xml.rels") as f:
                for _, el in iterparse(f, events=("end",)):
                    if el.get("Id") == rid:
                        target = el.get("Target", "").lstrip("/")
                        return target if target.startswith("xl/") else f"xl/{target}"
    except KeyError:
        pass
    return "xl/worksheets/sheet1.xml"


def iter_rows(path: str):
    """Each row of the first sheet as {column index: text}, header first."""
    z = zipfile.ZipFile(path)
    shared = read_shared_strings(z)
    with z.open(first_sheet(z)) as f:
        for _, el in iterparse(f, events=("end",)):
            if el.tag != SPREADSHEET_NS + "row":
                continue
            cells: dict[int, str] = {}
            for c in el.findall(SPREADSHEET_NS + "c"):
                ci = column_index(c.get("r", "A1"))
                if c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(SPREADSHEET_NS + "t"))
                else:
                    v = c.find(SPREADSHEET_NS + "v")
                    if v is None or v.text is None:
                        val = ""
                    elif c.get("t") == "s":
                        i = int(v.text)
                        val = shared[i] if i < len(shared) else ""
                    else:
                        val = v.text
                cells[ci] = val
            el.clear()
            yield cells


def header_name(v: str) -> str:
    """FY2009's workbook writes "CASE STATUS" where every other year writes
    CASE_STATUS; one spelling for both."""
    return re.sub(r"\s+", "_", v.strip().upper())


def resolve(header_cells: dict[int, str]) -> dict[int, str]:
    header = {header_name(v): k for k, v in header_cells.items() if v}
    colmap: dict[int, str] = {}
    for field, names in CANDIDATES.items():
        for name in names:
            if name in header:
                colmap[header[name]] = field
                break
    return colmap


def clean(s: str | None, n: int) -> str:
    return " ".join((s or "").split())[:n]


def parse_workbook(path: str, seen: set[str]) -> dict:
    """One workbook -> counts per (employer key, fiscal year) and case rows.

    Returns {counts, countries, rows, resolved, sheetRows, kept}. `rows`
    holds only decisions from ROWS_FROM_FY on; older years are counted, by
    employer and by country of citizenship.
    """
    counts: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0, 0])
    countries: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0, 0])
    rows: list[dict] = []
    colmap: dict[int, str] = {}
    sheet_rows = kept = 0
    for cells in iter_rows(path):
        sheet_rows += 1
        if sheet_rows == 1:
            colmap = resolve(cells)
            got = set(colmap.values())
            missing = [f for f in REQUIRED if f not in got]
            if missing:
                raise ValueError(f"{os.path.basename(path)} resolves none of {missing}. "
                                 f"Header was: {sorted(v for v in cells.values() if v)[:40]}")
            absent = sorted(f for f in CANDIDATES if f not in got)
            log(f"    resolved {sorted(got)}" + (f"; absent {absent}" if absent else ""))
            continue
        rec = {colmap[ci]: v for ci, v in cells.items() if ci in colmap}
        case_no = (rec.get("case") or "").strip()
        outcome = ipd.norm_status(rec.get("status") or "")
        decided = ipd.to_iso(rec.get("decision") or "")
        if not case_no or not outcome or not decided or case_no in seen:
            continue
        fy = int(ipd.fiscal_year(decided))
        if not FIRST_FY <= fy <= LAST_FY:
            continue
        seen.add(case_no)
        kept += 1
        employer = clean(rec.get("employer"), 80)
        key = entity_key(employer) if employer else ""
        slot = {"certified": 0, "denied": 1, "withdrawn": 2}[outcome]
        counts[(key, fy)][slot] += 1
        worker = ipd.worker_fields(rec)
        citizenship = worker["citizenship"] or ""
        if citizenship:
            countries[(citizenship, fy)][slot] += 1
        if fy < ROWS_FROM_FY:
            continue

        received = ipd.to_iso(rec.get("received") or "")
        days = None
        if received:
            d = (date.fromisoformat(decided) - date.fromisoformat(received)).days
            days = d if 0 <= d <= ipd.MAX_PLAUSIBLE_DAYS else None
        raw_state = (rec.get("state") or "").strip().upper()
        state = raw_state if raw_state in ipd.US_STATES else ipd.STATE_NAMES.get(raw_state, "")
        attorney = clean(rec.get("attorney"), 80)
        if attorney.lower() in ("n/a", "na", "none"):
            attorney = ""
        pw_wage = ipd.annual_wage(rec.get("pw_wage") or "", rec.get("pw_unit") or "")
        # A year with no offered-wage column took the prevailing wage as its wage before the PW_ columns had their
        # own fields; it still does.
        wage = (ipd.annual_wage(rec.get("wage") or "", rec.get("wage_unit") or "") if "wage" in rec
                else pw_wage)
        rows.append({
            "caseNumber": case_no, "status": outcome, "receivedDate": received,
            "decisionDate": decided, "days": days, "fiscalYear": str(fy),
            "employerName": employer, "state": state or None,
            "jobTitle": clean(rec.get("job_title"), 80) or None,
            "socCode": (rec.get("soc_code") or "").strip()[:10] or None,
            "socTitle": clean(rec.get("soc_title"), 80) or None,
            "attorneyName": attorney, "wage": wage,
            "naics": normalize_naics(rec.get("naics")),
            "worksiteCity": clean(rec.get("worksite_city"), 60) or None,
            "layoff": ipd.yes_no(rec.get("layoff")),
            "pwNumber": clean(rec.get("pw_number"), 40) or None,
            "pwWage": float(pw_wage) if pw_wage is not None else None,
            "pwLevel": clean(rec.get("pw_level"), 20) or None,
            "pwDetermined": ipd.to_iso(rec.get("pw_determined") or "") or None,
            "pwExpires": ipd.to_iso(rec.get("pw_expires") or "") or None,
            **worker,
        })
    return {"counts": counts, "countries": countries, "rows": rows,
            "resolved": sorted(set(colmap.values())),
            "sheetRows": sheet_rows - 1, "kept": kept}


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------



def slug_maps(db) -> tuple[dict[str, str], dict[str, str]]:
    """entity_key -> slug for today's employer and law-firm pages."""
    emp: dict[str, str] = {}
    att: dict[str, str] = {}
    res = db.execute("SELECT kind, merge_key, slug FROM perm_entities "
                     "WHERE kind IN ('employer','attorney') AND merge_key IS NOT NULL "
                     "ORDER BY total DESC")
    for r in rows_of(res):
        kind, key, slug = r
        (emp if kind == "employer" else att).setdefault(key, slug)
    # An old year's spelling with the gaps elsewhere still finds today's page (Rule
    # D); busiest first, so the busiest page wins shared letters.
    return SpacedKeyMap(emp), SpacedKeyMap(att)


def fold_counts(counts: dict, emp: dict[str, str]) -> tuple[dict[tuple[str, int], list[int]], dict]:
    """Counts by entity key -> counts by page slug, and how much of the year matched."""
    out: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0, 0])
    total = matched = 0
    for (key, fy), c in counts.items():
        n = sum(c)
        total += n
        slug = emp.get(key) if key else None
        if not slug:
            continue
        matched += n
        acc = out[(slug, fy)]
        for i in range(3):
            acc[i] += c[i]
    return out, {"cases": total, "matched": matched,
                 "matchedShare": round(matched / total, 4) if total else 0.0}


def write_years(db, folded: dict[tuple[str, int], list[int]], fys: list[int],
                delete_missing: bool = False) -> int:
    """Diff against the stored rows for these years and write what moved."""
    if not fys:
        return 0
    have: dict[tuple[str, int], tuple[int, int, int]] = {}
    marks = ",".join("?" * len(fys))
    res = db.execute(f"SELECT slug, fy, certified, denied, withdrawn FROM perm_employer_years "
                     f"WHERE fy IN ({marks})", list(fys))
    for r in rows_of(res):
        s, fy, c, d, w = r
        have[(s, int(fy))] = (int(c), int(d), int(w))
    changed = [(s, fy, *c) for (s, fy), c in folded.items() if have.get((s, fy)) != tuple(c)]
    stmts = list(insert_stmts("perm_employer_years", YEAR_COLUMNS, changed))
    if delete_missing:
        gone = [k for k in have if k not in folded]
        for i in range(0, len(gone), 200):
            chunk = gone[i:i + 200]
            stmts.append(stmt("DELETE FROM perm_employer_years WHERE "
                              + " OR ".join(["(slug = ? AND fy = ?)"] * len(chunk)),
                              [v for k in chunk for v in k]))
    run_stmts(db, stmts, STMTS_PER_REQUEST)
    return len(changed)


def employer_slug_for(name: str | None, emp: dict[str, str]) -> str:
    """The employer's page slug when it has one, else its own name slugified.

    The case search finds an employer by slug prefix, so a row with no slug
    can't be found by name (an employer's older spelling, say). The fallback is
    perm_live_recent's rule. It isn't a page: the facet and group builders
    check a slug against the employer pages before they use it.
    """
    if not name:
        return ""
    return emp.get(entity_key(name)) or slugify(name)


def firm_slug_for(name: str | None, att: dict[str, str], pages: frozenset[str] | set[str],
                  withheld: Matcher | None = None) -> str:
    """The law firm's page slug when it has one, else its own name slugified, unless that is another firm's page.

    A firm with no page today got no slug until Nov 21 2026, so build_firm_ranks.py counted its older cases as naming
    no firm and it dropped out of its own rankings, and its cases never linked once it had a page. The fallback is the
    employer's rule (employer_slug_for). It isn't a page: the case page and the lists check a slug before they link it
    (src/lib/db/entityLinks.ts), and the rankings print an unlinked firm by name. `pages` is every firm page's slug, so
    a name that slugifies onto a page it doesn't belong to (a truncated long name, a "-2" page) never counts there.

    A spelling `withheld` knows (lib_withheld.Matcher: a name or slug the withheld entry carries, or its entity key)
    takes the withheld firm's page before anything else, so it's never ranked or linked under its own printed name
    and the site masks it with the page (convex/lib/withheldNames.ts).
    """
    if not name:
        return ""
    if withheld:
        held = withheld.page_for(name=name, slug=slugify(name))
        if held:
            return held
    page = att.get(entity_key(name))
    if page:
        return page
    own = slugify(name)
    return "" if own in pages else own


def row_tuple(r: dict, emp: dict[str, str], att: dict[str, str], pages: frozenset[str] | None = None,
              withheld: Matcher | None = None) -> tuple:
    e, a = r["employerName"], r["attorneyName"]
    return (r["caseNumber"], r["status"], r["receivedDate"], r["decisionDate"], r["days"],
            r["fiscalYear"], e or None, employer_slug_for(e, emp),
            r["state"], r["jobTitle"], r["socCode"], r["socTitle"], a or None,
            firm_slug_for(a, att, frozenset(dict.values(att)) if pages is None else pages, withheld),
            r["wage"], r["naics"], r["worksiteCity"],
            r.get("citizenship"), r.get("birthCountry"), r.get("visaClass"), r.get("education"),
            r.get("major"), r.get("institution"), r.get("jobEducation"), r.get("layoff"),
            r.get("pwNumber"), r.get("pwWage"), r.get("pwLevel"), r.get("pwDetermined"), r.get("pwExpires"))


def fingerprint(t: tuple) -> str:
    """The core record: whether a stored row is this case as DOL published it."""
    return canon_hash(t[1:CORE])


def extras_of(t: tuple) -> tuple[str, ...]:
    return tuple(canon(v) for v in t[CORE:])


def ensure_columns(db) -> list[str]:
    """A table made before the worker's fields existed gains them in place."""
    return add_missing_columns(db, "perm_cases_history", {c: ("REAL" if c == "pw_wage" else "TEXT") for c in EXTRA})


def stored_fingerprints(db, fy: int) -> dict[str, tuple[str, tuple[str, ...]]]:
    out: dict[str, tuple[str, tuple[str, ...]]] = {}
    after = ""
    while True:
        res = db.execute(f"SELECT {','.join(COLUMNS)} FROM perm_cases_history "
                         "WHERE case_number > ? AND fiscal_year = ? ORDER BY case_number LIMIT 20000",
                         [after, str(fy)])
        rs = rows_of(res)
        for r in rs:
            t = tuple(r)
            out[str(t[0])] = (fingerprint(t), extras_of(t))
        if len(rs) < 20000:
            return out
        after = str(rs[-1][0])


def write_cases(db, rows: list[dict], emp, att, withheld: Matcher | None = None) -> int:
    """New or changed rows whole; rows whose only change is the worker's fields
    by a narrow UPDATE."""
    by_fy: dict[int, list[tuple]] = defaultdict(list)
    pages = frozenset(dict.values(att))
    for r in rows:
        by_fy[int(r["fiscalYear"])].append(row_tuple(r, emp, att, pages, withheld))
    written = 0
    for fy, tuples in by_fy.items():
        have = stored_fingerprints(db, fy)
        whole, narrow = [], []
        for t in tuples:
            stored = have.get(str(t[0]))
            if stored is None or stored[0] != fingerprint(t):
                whole.append(t)
            elif stored[1] != extras_of(t):
                narrow.append(t)
        stmts = list(insert_stmts("perm_cases_history", COLUMNS, whole))
        for i in range(0, len(narrow), NARROW_ROWS):
            stmts.append(case_update("perm_cases_history", "case_number", EXTRA,
                                     [(t[0], *t[CORE:]) for t in narrow[i:i + NARROW_ROWS]]))
        run_stmts(db, stmts, STMTS_PER_REQUEST)
        written += len(whole) + len(narrow)
        log(f"    FY{fy}: {len(tuples):,} case rows, {len(whole):,} written whole, "
            f"{len(narrow):,} given the worker's fields only")
    return written


def write_country_years(db, countries: dict[tuple[str, int], list[int]], fys: list[int]) -> int:
    """Decisions by country of citizenship and year, national, diffed."""
    if not fys:
        return 0
    marks = ",".join("?" * len(fys))
    have = {(r[0], int(r[1])): tuple(int(x) for x in r[2:])
            for r in rows_of(db.execute(
                f"SELECT country, fy, certified, denied, withdrawn FROM perm_country_years "
                f"WHERE fy IN ({marks})", list(fys)))}
    changed = [(c, fy, *v) for (c, fy), v in countries.items() if have.get((c, fy)) != tuple(v)]
    insert_rows(db, "perm_country_years", ["country", "fy", "certified", "denied", "withdrawn"],
                changed, per_request=STMTS_PER_REQUEST)
    return len(changed)


FACETS = ("citizenship", "education", "visa_class", "institution", "major")
FACET_FLOOR = 10  # history cases an entity needs before its breakdowns are written
FACET_TOP = 6


def display(facet: str, value: str) -> str:
    """Countries print in upper case in DOL's file; the page reads them in title case."""
    if facet in ("citizenship",):
        return " ".join(w.capitalize() if w.isalpha() else w for w in value.lower().split())
    return value


def employer_page_slugs(db) -> set[str]:
    """Every slug an employer page answers to: the published entities and the
    live-only employers. A history row's fallback slug is neither."""
    return {str(r[0]) for r in rows_of(db.execute(
        "SELECT slug FROM perm_entities WHERE kind = 'employer'"))} | live_only_slugs(db)


def build_history_facets(db, occ_slug_by_code: dict[str, str]) -> int:
    """perm_history_facets: each employer's and occupation's top values per worker field.

    Grouped in SQL (one read of the table per facet), ranked here, written
    whole: the table is small and rebuilt only when the history is.
    """
    out: list[tuple] = []
    pages = employer_page_slugs(db)
    for kind, key_col in (("employer", "employer_slug"), ("occupation", "soc_code")):
        totals = {str(r[0]): int(r[1]) for r in rows_of(db.execute(
            f"SELECT {key_col}, COUNT(*) FROM perm_cases_history WHERE {key_col} IS NOT NULL "
            f"AND {key_col} != '' GROUP BY {key_col}"))}
        for facet in FACETS:
            groups: dict[str, dict[str, int]] = defaultdict(dict)
            for r in rows_of(db.execute(
                    f"SELECT {key_col}, {facet}, COUNT(*) FROM perm_cases_history "
                    f"WHERE {key_col} IS NOT NULL AND {key_col} != '' AND {facet} IS NOT NULL "
                    f"AND {facet} != '' GROUP BY {key_col}, {facet}")):
                k, v, n = str(r[0]), str(r[1]), int(r[2])
                slug = (k if k in pages else None) if kind == "employer" else occ_slug_by_code.get(k)
                if not slug or totals.get(k, 0) < FACET_FLOOR:
                    continue
                groups[slug][v] = groups[slug].get(v, 0) + n
            for slug, values in groups.items():
                ranked = sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))[:FACET_TOP]
                for pos, (v, n) in enumerate(ranked):
                    out.append((kind, slug, facet, pos, v, display(facet, v), n))
    db.execute("DELETE FROM perm_history_facets")
    insert_rows(db, "perm_history_facets", ["kind", "slug", "facet", "pos", "key", "label", "n"],
                out, per_request=STMTS_PER_REQUEST)
    log(f"  history facets: {len(out):,} rows")
    return len(out)


def build_month_days(db) -> int:
    """perm_history_month_days: the older table's decision days by filing month.

    Three slices of about ten days a month on the received_date index, never one grouping of the whole table: a
    busy month whole took 1.7 s on the live database and a ten-day slice 0.3 s (Nov 21 2026). Each case perm_cases
    also holds is left out, so the month document, which adds perm_cases' own counts, counts it once.
    """
    lo = rows_of(db.execute("SELECT MIN(received_date) FROM perm_cases_history WHERE received_date > ''"))
    hi = rows_of(db.execute("SELECT MAX(received_date) FROM perm_cases_history"))
    first, last = (lo[0][0] if lo else None), (hi[0][0] if hi else None)
    out: list[tuple] = []
    if first and last:
        for m in months_between(str(first), str(last)):
            days: dict[int, int] = defaultdict(int)
            for a, b in month_thirds(m):
                for r in rows_of(db.execute(
                        "SELECT days, COUNT(*) FROM perm_cases_history h "
                        "WHERE received_date >= ? AND received_date < ? AND days IS NOT NULL "
                        "AND NOT EXISTS (SELECT 1 FROM perm_cases p WHERE p.case_number = h.case_number) "
                        "GROUP BY days", [a, b])):
                    days[int(r[0])] += int(r[1])
            out.extend((m, d, n) for d, n in sorted(days.items()))
    db.execute(next(t for t in SCHEMA if "perm_history_month_days" in t))
    db.execute("DELETE FROM perm_history_month_days")
    insert_rows(db, "perm_history_month_days", ["m", "days", "n"], out, per_request=STMTS_PER_REQUEST)
    log(f"  history month days: {len(out):,} rows")
    return len(out)


def build_alphabet_history(db) -> int:
    """perm_history_alphabet: the older table's cases from the alphabet chart's first filing month, by month and
    employer initial (as build_alphabet.py reads it), cases perm_cases also holds left out."""
    import build_alphabet  # the chart's own first month, one rule
    since = build_alphabet.SINCE_MONTH
    hi = rows_of(db.execute("SELECT MAX(received_date) FROM perm_cases_history"))
    last = str(hi[0][0])[:7] if hi and hi[0][0] else None
    sums: dict[tuple[str, str], list] = {}
    if last and last >= since:
        for m in months_between(since, last):
            for a, b in month_thirds(m):
                for r in rows_of(db.execute(
                        "SELECT UPPER(SUBSTR(TRIM(employer_name), 1, 1)) AS letter, COUNT(*), SUM(days) "
                        "FROM perm_cases_history h WHERE received_date >= ? AND received_date < ? "
                        "AND days IS NOT NULL "
                        "AND NOT EXISTS (SELECT 1 FROM perm_cases p WHERE p.case_number = h.case_number) "
                        "GROUP BY letter", [a, b])):
                    got = sums.setdefault((m, str(r[0] or "")), [0, 0.0])
                    got[0] += int(r[1])
                    got[1] += float(r[2] or 0)
    out = [(m, letter, n, total) for (m, letter), (n, total) in sorted(sums.items())]
    db.execute(next(t for t in SCHEMA if "perm_history_alphabet" in t))
    db.execute("DELETE FROM perm_history_alphabet")
    insert_rows(db, "perm_history_alphabet", ["month", "letter", "n", "sum_days"], out, per_request=STMTS_PER_REQUEST)
    log(f"  history alphabet: {len(out):,} rows")
    return len(out)


SLICE_DAYS = 5


def day_ranges(db, column: str, days: int = SLICE_DAYS) -> list[tuple[str, str]]:
    """[first day, day after the last) `days` days at a time, from the first day of the column's first month to the
    first day of the month after its last value, oldest first: two reads of the column's own index (its first and
    last value), never a grouping of the table."""
    lo = rows_of(db.execute(f"SELECT MIN({column}) FROM perm_cases_history WHERE {column} > ''"))
    hi = rows_of(db.execute(f"SELECT MAX({column}) FROM perm_cases_history"))
    first, last = (lo[0][0] if lo else None), (hi[0][0] if hi else None)
    out: list[tuple[str, str]] = []
    if first and last:
        day = date.fromisoformat(f"{str(first)[:7]}-01")
        stop = date.fromisoformat(f"{next_month(str(last)[:7])}-01")
        while day < stop:
            nxt = min(day + timedelta(days=days), stop)
            out.append((day.isoformat(), nxt.isoformat()))
            day = nxt
    return out


# What an employer's, a law firm's and an occupation's older cases were made of: the facets
# build_entity_detail.build_facets counts over perm_cases (an employer's jobs, states, firms, cities and industries;
# a firm's clients, jobs and states; an occupation's sponsors, firms, states and cities), counted here over
# perm_cases_history. Each row carries its entity's own total and fiscal years, so a page shows the older figures
# beside the current ones with their own denominator and their own year label, in one read.
ENTITY_FACETS_TABLE = "perm_history_entity_facets"
ENTITY_FACET_FLOOR = 3  # older cases an entity needs, as build_entity_detail.FACET_FLOOR
ENTITY_FACET_TOP = 6
ENTITY_FACET_COLUMNS = ["kind", "slug", "facet", "pos", "key", "label", "code", "n", "certified", "denied",
                        "total", "fy_from", "fy_to"]
MAKEUP_COLUMNS = ["employer_name", "employer_slug", "attorney_name", "attorney_slug", "soc_code", "soc_title",
                  "state", "worksite_city", "naics", "status", "fiscal_year"]
DECISION_INDEX = "idx_pch_dec"
# Five decision days, grouped inside the slice: a raw ten-day slice returned 4,858 rows in 1.09 s on the live
# database (Nov 21 2026), and a grouped ten-day one 0.77 s. The grouping leads with employer_name, which no index
# leads with, so no index can be walked whole to save the sort: the day range on idx_pch_dec stays the plan.
# A case perm_cases also holds (decided again after September 2023) is counted there, never here.
MAKEUP_SLICE_SQL = (
    f"SELECT {', '.join(MAKEUP_COLUMNS)}, COUNT(*) AS n FROM perm_cases_history h "
    "WHERE decision_date >= ? AND decision_date < ? "
    "AND NOT EXISTS (SELECT 1 FROM perm_cases p WHERE p.case_number = h.case_number) "
    f"GROUP BY {', '.join(MAKEUP_COLUMNS)}"
)
# Names whose merge key and page are remembered between slices; the memory is emptied when it fills, so it stays
# flat however many spellings the table holds.
NAME_CACHE_MAX = 50_000
# The counts wait in a file on disk, never in memory: one employer's or firm's (value, count) pairs over sixteen
# years run to millions. /tmp on the server is memory, so /var/tmp.
SCRATCH_DIR = os.environ.get("ENTITY_FACETS_WORKDIR") or ("/var/tmp" if os.path.isdir("/var/tmp") else None)
SCRATCH_DDL = """
    CREATE TABLE counts (kind TEXT, slug TEXT, facet TEXT, grp TEXT, n INTEGER, cert INTEGER, den INTEGER,
                         PRIMARY KEY (kind, slug, facet, grp)) WITHOUT ROWID;
    CREATE TABLE votes (side TEXT, grp TEXT, spelling TEXT, n INTEGER,
                        PRIMARY KEY (side, grp, spelling)) WITHOUT ROWID;
"""
NO_FIRM = ("n/a", "na", "none")


def entity_facets_ddl(name: str) -> str:
    return f"""CREATE TABLE IF NOT EXISTS {name} (
         kind      TEXT NOT NULL,
         slug      TEXT NOT NULL,
         facet     TEXT NOT NULL,
         pos       INTEGER NOT NULL,
         key       TEXT,
         label     TEXT NOT NULL,
         code      TEXT,
         n         INTEGER NOT NULL,
         certified INTEGER NOT NULL,
         denied    INTEGER NOT NULL,
         total     INTEGER NOT NULL,
         fy_from   INTEGER NOT NULL,
         fy_to     INTEGER NOT NULL,
         PRIMARY KEY (kind, slug, facet, pos)
       )"""


class EntityPages:
    """Today's employer and firm pages, and the ways an older row reaches one.

    A row keeps the slug its load gave it, so it is checked in this order: still a page; a page merged into
    another (perm_entity_alias); else its printed name, through today's merge keys (a spelling that had no page
    when its year loaded may have one now). A row that reaches a page is shown under the page's own name and slug,
    never its filing's spelling: the site masks a name withheld at its owner's request by the page's names and
    slugs, so an older spelling of a withheld page is never printed.
    """

    def __init__(self, db) -> None:
        self.names: dict[tuple[str, str], str] = {}
        keys: dict[str, dict[str, str]] = {"employer": {}, "attorney": {}}
        # A slug window at a time: the whole table in one sorted statement (86,354 pages) took 1.10 s on the
        # server on Nov 21 2026. Busiest first afterwards, so the busiest page still wins a shared spelling.
        found: list[list] = []
        for lo, hi in SLUG_WINDOWS:
            clause, args = slug_window("slug", lo, hi)
            found.extend(rows_of(db.execute(
                "SELECT kind, slug, name, merge_key, total FROM perm_entities "
                f"WHERE kind IN ('employer','attorney') AND {clause}", args)))
        found.sort(key=lambda r: -int(r[4] or 0))
        for kind, slug, name, key, _total in found:
            self.names[(str(kind), str(slug))] = str(name or slug)
            if key:
                keys[str(kind)].setdefault(str(key), str(slug))
        self.by_name = {k: SpacedKeyMap(v) for k, v in keys.items()}
        self.pages = {
            "employer": {s for (k, s) in self.names if k == "employer"} | live_only_slugs(db),
            "attorney": {s for (k, s) in self.names if k == "attorney"},
        }
        self.alias: dict[tuple[str, str], str] = {}
        try:
            for kind, slug, target in rows_of(db.execute(
                    "SELECT kind, slug, target_slug FROM perm_entity_alias WHERE kind IN ('employer','attorney')")):
                self.alias[(str(kind), str(slug))] = str(target)
        except Exception as exc:  # noqa: BLE001 - a database before the first merge
            if "no such table" not in str(exc).lower():
                raise
        self._keys: dict[str, str] = {}
        self._hits: dict[tuple[str, str, str], str | None] = {}

    def key_of(self, name: str) -> str:
        k = self._keys.get(name)
        if k is None:
            k = entity_key(name) if name else ""
            if len(self._keys) >= NAME_CACHE_MAX:
                self._keys.clear()
            self._keys[name] = k
        return k

    def page(self, kind: str, stored: str | None, name: str | None) -> str | None:
        memo = (kind, stored or "", name or "")
        if memo in self._hits:
            return self._hits[memo]
        pages = self.pages[kind]
        hit: str | None = None
        if stored and stored in pages:
            hit = stored
        elif stored and self.alias.get((kind, stored)) in pages:
            hit = self.alias[(kind, stored)]
        elif name:
            found = self.by_name[kind].get(self.key_of(name))
            hit = found if found in pages else None
        if len(self._hits) >= NAME_CACHE_MAX:
            self._hits.clear()
        self._hits[memo] = hit
        return hit

    def label(self, kind: str, slug: str) -> str | None:
        return self.names.get((kind, slug))


def live_only_slugs(db) -> set[str]:
    try:
        return {str(r[0]) for r in rows_of(db.execute("SELECT slug FROM perm_live_only_index"))}
    except Exception as exc:  # noqa: BLE001 - a database without the live table
        if "no such table" not in str(exc).lower():
            raise
        return set()


def require_index(db, name: str) -> None:
    """The day-at-a-time reads lean on this index; without it each would scan the whole table."""
    if not rows_of(db.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?", [name])):
        raise RuntimeError(f"{name} is missing, so each slice's read would scan the whole table; "
                           "build the search indexes first (run without --no-indexes)")


def open_scratch(path) -> sqlite3.Connection:
    """The local file the counts wait in: no journal, no syncing, since it's thrown away after the build."""
    con = sqlite3.connect(str(path))
    con.execute("PRAGMA journal_mode = OFF")
    con.execute("PRAGMA synchronous = OFF")
    con.executescript(SCRATCH_DDL)
    return con


def flush_counts(scratch: sqlite3.Connection, counts: dict, votes: Counter) -> None:
    """One slice's counts added to the file's."""
    scratch.executemany(
        "INSERT INTO counts VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (kind, slug, facet, grp) DO UPDATE SET "
        "n = n + excluded.n, cert = cert + excluded.cert, den = den + excluded.den",
        [(*k, *v) for k, v in counts.items()])
    scratch.executemany(
        "INSERT INTO votes VALUES (?, ?, ?, ?) ON CONFLICT (side, grp, spelling) DO UPDATE SET n = n + excluded.n",
        [(*k, n) for k, n in votes.items()])
    scratch.commit()


class SliceCounts(dict):
    """One slice's counts: (kind, slug, facet, value) -> [cases, certified, denied]."""

    def add(self, kind: str, slug: str, facet: str, grp: str, n: int, cert: int, den: int) -> None:
        got = self.get((kind, slug, facet, grp))
        if got is None:
            self[(kind, slug, facet, grp)] = [n, cert, den]
        else:
            got[0] += n
            got[1] += cert
            got[2] += den


def party_group(pages: EntityPages, page: str | None, name: str) -> str | None:
    """A firm or an employer as a facet value: "p:<its page>", else "n:<its merge key>" for one with no page."""
    if page:
        return f"p:{page}"
    key = pages.key_of(name) if name else ""
    return f"n:{key}" if key else None


def build_entity_facets(db, scratch_dir: str | None = None) -> int:
    """perm_history_entity_facets, and the older cases' counts by worksite state in perm_docs['perm_history'].

    One pass over perm_cases_history, five decision days at a time on its decision_date index, each slice grouped
    to its distinct combinations (MAKEUP_SLICE_SQL), never one grouping of the whole table. The counts are added up
    in a file on disk and ranked from there, so memory holds one slice and the pages' totals, whatever the table
    holds. A case perm_cases also holds is counted there, never here, so the case search's state counts can add
    these to perm_cases' own. The table is built aside and swapped in whole: a page never reads it half-written.
    """
    require_index(db, DECISION_INDEX)
    pages = EntityPages(db)
    occ_slug = occupation_slugs(db)
    totals: dict[tuple[str, str], list[int]] = {}
    by_state: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    fy_lo = fy_hi = None
    slot = {"certified": 1, "denied": 2, "withdrawn": 3}
    read = 0
    with tempfile.TemporaryDirectory(dir=scratch_dir or SCRATCH_DIR, prefix="entity-facets-") as tmp:
        scratch = open_scratch(os.path.join(tmp, "counts.sqlite"))
        try:
            for lo, hi in day_ranges(db, "decision_date"):
                counts = SliceCounts()
                add = counts.add
                votes: Counter = Counter()
                for (emp_name, emp_slug, att_name, att_slug, soc, soc_title, state, city, naics, status, fy,
                     n) in rows_of(db.execute(MAKEUP_SLICE_SQL, [lo, hi])):
                    n = int(n)
                    read += n
                    st = str(status or "").lower()
                    cert, den = n * (st == "certified"), n * (st == "denied")
                    year = int(fy) if fy not in (None, "") else None
                    if year is not None:
                        fy_lo = year if fy_lo is None else min(fy_lo, year)
                        fy_hi = year if fy_hi is None else max(fy_hi, year)
                    state = str(state or "") or None
                    if state:
                        s = by_state[state]
                        s[0] += n
                        if st in slot:
                            s[slot[st]] += n
                    emp_name, att_name = str(emp_name or ""), str(att_name or "")
                    if att_name.lower() in NO_FIRM:
                        att_name = ""
                    e = pages.page("employer", str(emp_slug or "") or None, emp_name or None)
                    a = pages.page("attorney", str(att_slug or "") or None, att_name or None)
                    code = str(soc or "").strip() or None
                    o = occ_slug.get(code) if code else None
                    if code and soc_title:
                        votes[("soc", code, str(soc_title))] += n
                    ck = city_key(str(city or "") or None, state)
                    if ck:
                        votes[("city", ck, " ".join(str(city).split()))] += n
                    firm = party_group(pages, a, att_name)
                    if firm and not a:
                        votes[("attorney", firm, att_name)] += n
                    client = party_group(pages, e, emp_name)
                    if client and not e:
                        votes[("employer", client, emp_name)] += n
                    for kind, slug in (("employer", e), ("attorney", a), ("occupation", o)):
                        if not slug:
                            continue
                        t = totals.get((kind, slug))
                        if t is None:
                            totals[(kind, slug)] = [n, year or 0, year or 0]
                        else:
                            t[0] += n
                            if year is not None:
                                t[1] = year if not t[1] else min(t[1], year)
                                t[2] = max(t[2], year)
                        if state:
                            add(kind, slug, "state", state, n, cert, den)
                    for kind, slug in (("employer", e), ("attorney", a)):
                        if slug and code:
                            add(kind, slug, "occupation", code, n, cert, den)
                    if e:
                        if firm:
                            add("employer", e, "attorney", firm, n, cert, den)
                        if ck:
                            add("employer", e, "city", ck, n, cert, den)
                        if naics:
                            add("employer", e, "industry", str(naics), n, cert, den)
                    if a and client:
                        add("attorney", a, "employer", client, n, cert, den)
                    if o:
                        if client:
                            add("occupation", o, "employer", client, n, cert, den)
                        if firm:
                            add("occupation", o, "attorney", firm, n, cert, den)
                        if ck:
                            add("occupation", o, "city", ck, n, cert, den)
                flush_counts(scratch, counts, votes)
            written = write_entity_facets(db, scratch, totals, pages, occ_slug)
        finally:
            scratch.close()

    doc = read_doc(db)
    doc["byState"] = [{"state": s, "total": v[0], "certified": v[1], "denied": v[2], "withdrawn": v[3]}
                      for s, v in sorted(by_state.items(), key=lambda kv: (-kv[1][0], kv[0]))]
    doc["byStateYears"] = {"from": fy_lo, "to": fy_hi} if fy_lo is not None else None
    store_doc(db, doc)
    log(f"  history entity facets: {read:,} cases read, {written:,} rows; {len(by_state)} states counted")
    return written




ENTITY_FACET_WRITE_ROWS = 4000


def top_values(scratch: sqlite3.Connection, totals: dict):
    """(kind, slug, facet, pos, grp, n, cert, den) for each entity's top values, busiest first, at the floor or above.

    An index on the file puts every facet's values in rank order, so one walk of it yields each facet's first few and
    steps past the rest: nothing is held but the row in hand, though one big occupation's sponsors run to tens of
    thousands. Ties go to the value, so a rebuild can't reshuffle a list without its counts changing.
    """
    scratch.execute("CREATE INDEX IF NOT EXISTS counts_rank ON counts (kind, slug, facet, n DESC, grp)")
    here, pos = None, 0
    for kind, slug, facet, grp, n, cert, den in scratch.execute(
            "SELECT kind, slug, facet, grp, n, cert, den FROM counts INDEXED BY counts_rank "
            "ORDER BY kind, slug, facet, n DESC, grp"):
        if (kind, slug, facet) != here:
            here, pos = (kind, slug, facet), 0
        if pos < ENTITY_FACET_TOP and totals[(kind, slug)][0] >= ENTITY_FACET_FLOOR:
            yield kind, slug, facet, pos, grp, int(n), int(cert), int(den)
        pos += 1


def write_entity_facets(db, scratch: sqlite3.Connection, totals: dict, pages: EntityPages,
                        occ_slug: dict[str, str]) -> int:
    """Each entity's top values per facet, from the counts on disk, written aside in batches and swapped in whole.

    A firm or an employer with a page is written under the page's own slug and name; one with no page under the
    spelling its filings used most, unlinked.
    """
    staged = f"{ENTITY_FACETS_TABLE}_next"
    db.execute(f"DROP TABLE IF EXISTS {staged}")
    db.execute(entity_facets_ddl(staged))
    city_names: dict[str, str] = {}

    def top_vote(side: str, grp: str) -> str | None:
        r = scratch.execute("SELECT spelling FROM votes WHERE side = ? AND grp = ? ORDER BY n DESC, spelling LIMIT 1",
                            [side, grp]).fetchone()
        return r[0] if r else None

    def city_name(ck: str) -> str:
        if ck not in city_names:
            if len(city_names) >= NAME_CACHE_MAX:
                city_names.clear()
            spellings = Counter({sp: int(n) for sp, n in scratch.execute(
                "SELECT spelling, n FROM votes WHERE side = 'city' AND grp = ?", [ck])})
            city_names[ck] = city_labels({ck: spellings}).get(ck, ck) if spellings else ck
        return city_names[ck]

    batch: list[tuple] = []
    written = 0
    for kind, slug, facet, pos, grp, n, cert, den in top_values(scratch, totals):
        total, first, last = totals[(kind, slug)]
        key, code, label = grp, None, grp
        if facet == "occupation":
            key, code, label = occ_slug.get(grp), grp, top_vote("soc", grp) or grp
        elif facet == "city":
            label = city_name(grp)
        elif facet == "industry":
            label = industry_label(grp)
        elif facet in ("attorney", "employer"):
            if grp.startswith("p:"):
                key = grp[2:]
                label = pages.label(facet, key) or key
            else:
                key, label = None, top_vote(facet, grp) or grp[2:]
        batch.append((kind, slug, facet, pos, key, label, code, n, cert, den, total, first, last))
        if len(batch) >= ENTITY_FACET_WRITE_ROWS:
            written += insert_rows(db, staged, ENTITY_FACET_COLUMNS, batch, per_request=STMTS_PER_REQUEST)
            batch = []
    if batch:
        written += insert_rows(db, staged, ENTITY_FACET_COLUMNS, batch, per_request=STMTS_PER_REQUEST)
    db.script(["BEGIN", f"DROP TABLE IF EXISTS {ENTITY_FACETS_TABLE}",
               f"ALTER TABLE {staged} RENAME TO {ENTITY_FACETS_TABLE}", "COMMIT"])
    return written


# One slice of decision days, grouped inside the slice: what the wait trend needs from the older table.
DECIDED_DAYS_SQL = ("SELECT days, COUNT(*) FROM perm_cases_history "
                    "WHERE decision_date >= ? AND decision_date < ? AND days IS NOT NULL "
                    "AND status IN ('certified', 'denied') GROUP BY days")


def build_decided_days(db) -> int:
    """perm_history_decided_days: the older table's decision days by the month DOL decided, for the PERM wait trend
    (build_wait_trends.py), from its first older month (FY2015) to where perm_cases starts (October 2023).

    Certified and denied only, as the trend counts perm_cases' own months. Three slices of about ten decision days a
    month on idx_pch_dec, each grouped by days inside the slice, never one grouping of the table: a grouped ten-day
    decision slice measured 0.65 s on the live database (Nov 21 2026). The table changes only when a history file
    loads, so this runs then, or with --decided-days, never nightly.
    """
    import build_wait_trends as bwt  # the trend's own span, one rule
    # A load run with --no-indexes has no idx_pch_dec, and each slice would then scan the whole table.
    if not rows_of(db.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_pch_dec'")):
        log("  idx_pch_dec isn't built: the wait trend's older months wait for --decided-days")
        return 0
    hi = rows_of(db.execute("SELECT MAX(decision_date) FROM perm_cases_history"))
    last = str(hi[0][0])[:7] if hi and hi[0][0] else None
    out: list[tuple] = []
    if last:
        m, end = bwt.HISTORY_FROM[:7], min(next_month(last), bwt.FROM_DAY[:7])
        while m < end:
            days: dict[int, int] = defaultdict(int)
            for a, b in month_thirds(m):
                for r in rows_of(db.execute(DECIDED_DAYS_SQL, [a, b])):
                    days[int(r[0])] += int(r[1])
            out.extend((m, d, n) for d, n in sorted(days.items()))
            m = next_month(m)
    db.execute(next(t for t in SCHEMA if "perm_history_decided_days" in t))
    db.execute("DELETE FROM perm_history_decided_days")
    insert_rows(db, "perm_history_decided_days", ["m", "days", "n"], out, per_request=STMTS_PER_REQUEST)
    log(f"  history decided days: {len(out):,} rows")
    return len(out)


# The one pass's read: what the worksites, the wage bands and the explorer's views each need from a row.
PLACES_WAGES_SQL = ("SELECT employer_slug, state, worksite_city, status, wage, substr(soc_code, 1, 7), fiscal_year "
                    "FROM perm_cases_history WHERE decision_date >= ? AND decision_date < ?")


def fy_decision_slices(fy: int) -> list[tuple[str, str]]:
    """A fiscal year's decision days, October to September, ten days at a time: a slice on idx_pch_dec measured
    0.65 s on the live database (Nov 21 2026), where a busy month whole passes a second."""
    out, m, stop = [], f"{fy - 1}-10", f"{fy}-10"
    while m != stop:
        out.extend(month_thirds(m))
        m = next_month(m)
    return out


def held_years(db) -> list[int]:
    """The fiscal years the older table holds, from its first and last decision day (one index seek each)."""
    lo = rows_of(db.execute("SELECT MIN(decision_date) FROM perm_cases_history WHERE decision_date > ''"))
    hi = rows_of(db.execute("SELECT MAX(decision_date) FROM perm_cases_history"))
    first, last = (lo[0][0] if lo else None), (hi[0][0] if hi else None)
    if not first or not last:
        return []
    return list(range(max(FIRST_FY, int(ipd.fiscal_year(str(first)))),
                      min(LAST_FY, int(ipd.fiscal_year(str(last)))) + 1))


def size_words(n: int) -> str:
    """Bytes in words for a log line: "96.3 MB", "412 KB", "803 bytes"."""
    return f"{n / 1e6:,.1f} MB" if n >= 1e6 else f"{n / 1e3:,.0f} KB" if n >= 1e3 else f"{n:,} bytes"


def build_places_and_wages(db, *, dry_run: bool = False) -> int:
    """One pass over the older table, a fiscal year at a time in ten-day decision slices, for three readers that
    otherwise see FY2024 on only:

    perm_history_worksites   each employer's worksite states and cities, which the Wage and Hour, OSHA, SAM, PPP
                             and TAA joins test a record against (lib_dol_records);
    perm_history_wage_bands  certified and denied cases by fiscal year and fine wage band (src/lib/db/wages.ts);
    wage_views               every salary explorer selection of each older year that holds a case, under the
                             reader's keys and build_wage_views.HISTORY_PROGRAM, with the years in its doc and the
                             year picker's facets.

    The table changes only when a history file loads, so this runs then, or with --places-wages, never nightly.
    `dry_run` reads the same slices, counts what it would write and its size, and writes nothing.
    """
    import build_wage_bands as bwb
    import build_wage_views as bwv
    from build_lca_facets import min_for_median
    # A load run with --no-indexes has no idx_pch_dec, and each slice would then scan the whole table.
    if not rows_of(db.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_pch_dec'")):
        log("  idx_pch_dec isn't built: the worksites, wage bands and explorer years wait for --places-wages")
        return 0
    floor = min_for_median()
    places: set[tuple[str, str, str]] = set()
    bands: dict[tuple[str, int], list[int]] = {}
    built: list[str] = []
    checked: str | None = None
    views_written = 0
    view_bytes = 0
    strays = 0
    # Each year's views are written as soon as that year is counted (about 300,000 in all, a few hundred bytes
    # each), and before the first is written, one of them is recomputed through the site's own SQL.
    stamp = 0 if dry_run else bwv.begin_views(db)
    for fy in held_years(db):
        wages: list[tuple] = []
        for a, b in fy_decision_slices(fy):
            for slug, state, city, status, wage, soc, row_fy in rows_of(db.execute(PLACES_WAGES_SQL, [a, b])):
                st, ct = str(state or "").strip().upper(), str(city or "").strip().upper()
                if slug and (st or ct):
                    places.add((str(slug), sys.intern(st), ct))
                # The loader sets a row's fiscal year from its decision day, so a year's slices hold its rows only.
                if str(row_fy) != str(fy):
                    strays += 1
                    continue
                row = bwv.view_row("perm", wage, status, soc, state, row_fy)
                if row is None:
                    continue
                wages.append(row)
                if status in ("certified", "denied"):
                    got = bands.setdefault((str(fy), bwb.band_floor(row[0])), [0, 0])
                    got[0] += 1
                    got[1] += status == "denied"
        if not wages:
            continue
        wages.sort(key=lambda t: t[0])
        views = bwv.build("perm", wages, floor, min_rows=1, fy_only=True)
        if checked is None:
            checked = bwv.verify_history(db, str(fy), views)
        items = bwv.serialize(views)
        view_bytes += sum(len(k) + len(j) for k, _, j in items)
        if not dry_run:
            bwv.put_views(db, bwv.HISTORY_PROGRAM, items, stamp)
        views_written += len(views)
        built.append(str(fy))
        log(f"  FY{fy}: {len(wages):,} wages, {len(views):,} explorer views, {len(places):,} worksites so far")
    if strays:
        log(f"  {strays:,} rows whose fiscal year isn't their decision day's: worksites only")
    if dry_run:
        log(f"  dry run: would write {len(places):,} worksites, {len(bands):,} wage bands and {views_written:,} "
            f"explorer views ({size_words(view_bytes)} of keys and JSON), FY{built[0] if built else '-'} to "
            f"FY{built[-1] if built else '-'}; {checked or 'no view'} checked live; nothing written")
        return len(places) + len(bands) + views_written
    for ddl in SCHEMA:
        if "perm_history_worksites" in ddl or "perm_history_wage_bands" in ddl:
            db.execute(ddl)
    db.execute("DELETE FROM perm_history_worksites")
    insert_rows(db, "perm_history_worksites", ["slug", "state", "city"], sorted(places),
                per_request=STMTS_PER_REQUEST)
    db.execute("DELETE FROM perm_history_wage_bands")
    insert_rows(db, "perm_history_wage_bands", ["fy", "band", "decided", "denied"],
                [(fy, band, d, n) for (fy, band), (d, n) in sorted(bands.items())], per_request=STMTS_PER_REQUEST)
    views_written = bwv.finish_views(db, bwv.HISTORY_PROGRAM, stamp, views_written)
    write_doc(db, bwv.HISTORY_DOC, {"years": built, "views": views_written, "minCases": floor, "checked": checked})
    bwb.refresh_history_years(db)
    log(f"  history worksites {len(places):,}, wage bands {len(bands):,}, explorer views {views_written:,} "
        f"(FY{built[0] if built else '-'} to FY{built[-1] if built else '-'}; {checked or 'no view'} checked live)")
    return len(places) + len(bands) + views_written


# One pass over the older table for two small records the site reads instead of it (sweep items 20 and 21, Nov 21
# 2026): each fiscal year's cases by outcome (perm_docs[HISTORY_YEARS_DOC]: /perm-cases' total, its year list and
# its outcome counts) and each year's certified wages by occupation and state (perm_history_wage_cells: the case
# page's wage ladder for an older case). Read FIVE decision days a statement on idx_pch_dec: a ten-day slice of 11
# columns returned 4,858 rows in 1.09 s on the live database (Nov 21 2026), past the one-second rule.
HISTORY_YEARS_DOC = "perm_history_years"
# SLICE_DAYS (five decision days a statement) is the makeup build's, above.
# Below this many certified cases a wage ladder is arithmetic on a handful (MIN_WAGE_SAMPLE in caseContext.ts).
WAGE_CELL_FLOOR = 30
QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)
OUTCOMES = ("certified", "denied", "withdrawn")
SOC_GROUP = re.compile(r"^(\d{2}-\d{4})")


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def decision_slices(first: str, last: str) -> list[tuple[str, str]]:
    """Half-open slices of SLICE_DAYS decision days, [a, b), from `first` through `last`. Pure."""
    out: list[tuple[str, str]] = []
    day = date.fromisoformat(first[:10])
    end = date.fromisoformat(last[:10])
    while day <= end:
        nxt = date.fromordinal(day.toordinal() + SLICE_DAYS)
        out.append((day.isoformat(), nxt.isoformat()))
        day = nxt
    return out


def sql_round(x: float) -> float:
    """SQLite's ROUND(x): half away from zero (Python's round() goes to even)."""
    return float(math.floor(x + 0.5)) if x >= 0 else -float(math.floor(-x + 0.5))


def wage_percentiles(wages: list[float]) -> list[float]:
    """p5, p25, p50, p75 and p95 of wages sorted ascending, exactly as PERCENTILE_SELECT in src/lib/db/publicData.ts
    computes them: rank k = (n - 1) * p, interpolated between floor(k) and the next, rounded as SQLite rounds."""
    n = len(wages)
    out = []
    for p in QUANTILES:
        k = (n - 1) * p
        lo = int(k)
        hi = min(lo + 1, n - 1)
        out.append(sql_round(wages[lo] + (wages[hi] - wages[lo]) * (k - lo)))
    return out


def build_history_years_wages(db, min_cells: int = WAGE_CELL_FLOOR) -> int:
    """perm_docs[HISTORY_YEARS_DOC] and perm_history_wage_cells, from one pass over perm_cases_history.

    Every row counts, a case DOL decided again after FY2023 (and so also in perm_cases) included: /perm-cases lists
    each published decision, from both tables, and its totals count what it lists; and a decision in FY2019 is one
    of FY2019's whatever happened to the case later. The wage cells count certified cases with a positive wage and a
    SOC code, by the code's seven-character group as every reader keys a job. Returns the rows written (cells and
    years).
    """
    lo = rows_of(db.execute("SELECT MIN(decision_date) FROM perm_cases_history"))
    hi = rows_of(db.execute("SELECT MAX(decision_date) FROM perm_cases_history"))
    first, last = (lo[0][0] if lo else None), (hi[0][0] if hi else None)
    years: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])
    states: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    wages: dict[tuple[int, str, str], list[float]] = defaultdict(list)
    for a, b in decision_slices(str(first), str(last)) if first and last else []:
        for status, fy, soc, state, wage in rows_of(db.execute(
                "SELECT status, fiscal_year, soc_code, state, wage FROM perm_cases_history "
                "WHERE decision_date >= ? AND decision_date < ?", [a, b])):
            if status not in OUTCOMES or not str(fy or "").isdigit():
                continue
            year = int(fy)
            years[year][OUTCOMES.index(status)] += 1
            # A row with no worksite state counts under "", as perm_cases' coverage doc counts it.
            states[str(state or "")][OUTCOMES.index(status)] += 1
            group = SOC_GROUP.match(str(soc or "").strip())
            w = None if wage in (None, "") else float(wage)
            if status != "certified" or not group or w is None or w <= 0:
                continue
            wages[(year, group.group(1), "")].append(w)
            if state:
                wages[(year, group.group(1), str(state))].append(w)
    built = int(time.time() * 1000)
    cells = []
    for (year, soc, state), ws in wages.items():
        if len(ws) < min_cells:
            continue
        ws.sort()
        cells.append((year, soc, state, len(ws), sum(ws) / len(ws), *wage_percentiles(ws), built))
    db.execute(next(t for t in SCHEMA if "perm_history_wage_cells" in t))
    insert_rows(db, "perm_history_wage_cells",
                ["fy", "soc", "state", "n", "avg", "p5", "p25", "p50", "p75", "p95", "built_at"],
                cells, per_request=STMTS_PER_REQUEST)
    # The cells a rebuild didn't write go only after every new one is in, so the page never reads an empty table.
    db.execute("DELETE FROM perm_history_wage_cells WHERE built_at < ?", [built])
    doc = {
        "years": [{"fiscalYear": str(y), "total": sum(c), "certified": c[0], "denied": c[1], "withdrawn": c[2]}
                  for y, c in sorted(years.items(), reverse=True)],
        "byState": [{"state": s, "total": sum(c), "certified": c[0], "denied": c[1], "withdrawn": c[2]}
                    for s, c in sorted(states.items(), key=lambda kv: (-sum(kv[1]), kv[0]))],
        "from": str(first) if first else None,
        "to": str(last) if last else None,
    }
    db.execute("CREATE TABLE IF NOT EXISTS perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER)")
    write_doc(db, HISTORY_YEARS_DOC, doc)
    log(f"  history years: {len(doc['years'])}; wage cells: {len(cells):,}")
    return len(cells) + len(doc["years"])


def occupation_slugs(db) -> dict[str, str]:
    return {str(r[0]): str(r[1]) for r in rows_of(db.execute(
        "SELECT code, slug FROM perm_entities WHERE kind = 'occupation' AND code IS NOT NULL"))}


def fill_slugs(db) -> int:
    """One pass over the rows written before the fallback existed: an UPDATE of
    the slug alone, 200 rows per statement, keyed on the primary key."""
    after, n = "", 0
    while True:
        rs = rows_of(db.execute(
            "SELECT case_number, employer_name FROM perm_cases_history "
            "WHERE (employer_slug IS NULL OR employer_slug = '') AND employer_name IS NOT NULL "
            "AND employer_name != '' AND case_number > ? ORDER BY case_number LIMIT 5000", [after]))
        if not rs:
            break
        pairs = [(str(r[0]), slugify(str(r[1]))) for r in rs]
        pairs = [(c, s) for c, s in pairs if s]
        run_stmts(db, (case_update("perm_cases_history", "case_number", ["employer_slug"],
                                   pairs[i:i + 200]) for i in range(0, len(pairs), 200)), 5)
        n += len(pairs)
        after = str(rs[-1][0])
        log(f"  slugs filled: {n:,}")
    return n


def fill_firm_slugs(db, att: dict[str, str] | None = None, withheld: Matcher | None = None) -> int:
    """Every stored row's law firm on firm_slug_for's rule: a withheld firm's page for its spellings, else today's
    page, else the firm's own name's slug.

    A row's slug was set when its year loaded, from that day's firm pages, so a firm with no page then has none and a
    page made or moved since is missed. A few thousand decisions at a time on idx_pch_dec (lib_db.counted_slices,
    never the whole table: ten days of raw rows took 1.09 s on the live database, Nov 21 2026), each named row's slug
    worked out again here and written only where it moves, 200 to an UPDATE keyed on the case number, at a history
    load's gentle pace: a month's writes, then FILL_PAUSE_S idle, since back-to-back history writes once kept the
    database compacting its log until its writes stalled for 38 minutes (Oct 3 2026). Rows naming no firm (every file
    before FY2015, and an employer filing for itself) are left as they are.
    """
    if att is None:
        _, att = slug_maps(db)
    if withheld is None:
        withheld = withheld_firms(db)
    pages = frozenset(dict.values(att))
    lo = rows_of(db.execute("SELECT MIN(decision_date) FROM perm_cases_history WHERE decision_date > ''"))
    hi = rows_of(db.execute("SELECT MAX(decision_date) FROM perm_cases_history"))
    first, last = (lo[0][0] if lo else None), (hi[0][0] if hi else None)
    if not first or not last:
        return 0
    moved_total = 0
    for m in months_between(str(first), str(last)):
        moved: list[tuple[str, str]] = []
        for where, args in counted_slices(db, "perm_cases_history", "decision_date", f"{m}-01", f"{m}-01"):
            for case, name, slug in rows_of(db.execute(
                    f"SELECT case_number, attorney_name, attorney_slug FROM perm_cases_history WHERE {where} "
                    "AND attorney_name IS NOT NULL AND attorney_name <> ''", args)):
                want = firm_slug_for(str(name), att, pages, withheld)
                if want and want != (slug or ""):
                    moved.append((str(case), want))
        run_stmts(db, (case_update("perm_cases_history", "case_number", ["attorney_slug"], moved[i:i + 200])
                       for i in range(0, len(moved), 200)), 5)
        if moved and FILL_PAUSE_S:
            time.sleep(FILL_PAUSE_S)
        moved_total += len(moved)
        if m.endswith("-12"):
            log(f"  firm slugs through {m}: {moved_total:,} moved")
    return moved_total


def withheld_firms(db) -> Matcher:
    """The withheld firms, with the aliases and page-map spellings pointing at them (lib_withheld.matcher_for)."""
    return matcher_for(lambda sql, args: dicts_of(db.execute(sql, args)), "firm", log=log)


def build_search_indexes(db) -> None:
    t = time.time()
    for ddl in SEARCH_INDEXES:
        db.execute(ddl)
    log(f"  search indexes ({len(SEARCH_INDEXES)}) in {time.time() - t:,.0f}s")


def read_doc(db) -> dict:
    """perm_docs['perm_history'], or {} before the first load. A failed read throws: a doc read as empty and
    written back would lose the record of which files are loaded."""
    try:
        raw = db.scalar("SELECT json FROM perm_docs WHERE key = ?", [DOC_KEY])
    except Exception as exc:  # noqa: BLE001 - only a database without perm_docs yet means nothing loaded
        if "no such table" not in str(exc).lower():
            raise
        raw = None
    return json.loads(raw) if raw else {}


def store_doc(db, doc: dict) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS perm_docs (key TEXT PRIMARY KEY, json TEXT NOT NULL, computed_at INTEGER)")
    write_doc(db, DOC_KEY, doc)


def write_current_years(db) -> int:
    """FY2024 onward of perm_employer_years, from perm_cases.

    perm_cases already carries each case's employer slug and fiscal year, so
    this is one grouped read; the quarterly ingest runs it after each load so
    the series never stops at the history's last year.
    """
    res = db.execute("SELECT employer_slug, fiscal_year, status, COUNT(*) FROM perm_cases "
                     "WHERE employer_slug != '' GROUP BY employer_slug, fiscal_year, status")
    folded: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0, 0])
    fys: set[int] = set()
    for r in rows_of(res):
        slug, fy, status, n = r
        if not fy or status not in ("certified", "denied", "withdrawn"):
            continue
        fy = int(fy)
        fys.add(fy)
        folded[(slug, fy)][{"certified": 0, "denied": 1, "withdrawn": 2}[status]] += int(n)
    # Every year this table holds past the history's end, not just the years
    # perm_cases still has: a year whose last case left must be cleared too.
    held = {int(r[0]) for r in rows_of(db.execute(
        "SELECT DISTINCT fy FROM perm_employer_years WHERE fy > ?", [LAST_FY]))}
    fys = sorted(f for f in fys | held if f > LAST_FY)
    folded = {k: v for k, v in folded.items() if k[1] > LAST_FY}
    n = write_years(db, folded, fys, delete_missing=True)
    log(f"  current years {fys}: {len(folded):,} employer-years, {n:,} written")
    return n


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from-fy", type=int, default=FIRST_FY)
    ap.add_argument("--to-fy", type=int, default=LAST_FY)
    ap.add_argument("--local", nargs="*", help="read these workbooks instead of DOL's")
    ap.add_argument("--force", action="store_true", help="reload files already recorded")
    ap.add_argument("--dry-run", action="store_true", help="parse and report; write nothing")
    ap.add_argument("--current", action="store_true", help="only FY2024 onward, from perm_cases")
    ap.add_argument("--no-indexes", action="store_true",
                    help="skip the search indexes (the write budget's first saving)")
    ap.add_argument("--fill-slugs", action="store_true",
                    help="give every history row without an employer slug its name's slug, then stop")
    ap.add_argument("--finish-only", action="store_true",
                    help="no workbooks: current years, search indexes and facets only")
    ap.add_argument("--month-days", action="store_true",
                    help="no workbooks: only rebuild perm_history_month_days and perm_history_alphabet, then stop")
    ap.add_argument("--entity-facets", action="store_true",
                    help="no workbooks: only rebuild perm_history_entity_facets and the state counts in "
                         "perm_docs['perm_history'], then stop")
    ap.add_argument("--fill-firm-slugs", action="store_true",
                    help="no workbooks: put every row's law firm on today's page or its own name's slug, then stop")
    ap.add_argument("--places-wages", action="store_true",
                    help="no workbooks: only rebuild perm_history_worksites, perm_history_wage_bands and the salary "
                         "explorer's older years, then stop")
    ap.add_argument("--decided-days", action="store_true",
                    help="no workbooks: only rebuild perm_history_decided_days (the wait trend's FY2015 to FY2023 "
                         "months), then stop")
    ap.add_argument("--years-wages", action="store_true",
                    help="no workbooks: only rebuild perm_docs['perm_history_years'] and perm_history_wage_cells "
                         "(one pass, five decision days a statement), then stop")
    args = ap.parse_args()

    if args.entity_facets:
        db = Database()
        db.script(SCHEMA)
        n = build_entity_facets(db)
        record_run(db, "ingest_perm_history.py --entity-facets", status="ok", rows_written=n,
                   note="employer, firm and occupation makeup and state counts from perm_cases_history")
        return 0

    if args.fill_firm_slugs:
        db = Database()
        n = fill_firm_slugs(db, withheld=withheld_firms(db))
        record_run(db, "ingest_perm_history.py --fill-firm-slugs", status="ok", rows_written=n,
                   note="law-firm slugs: today's page, else the firm's own name")
        return 0

    if args.decided_days:
        db = Database()
        db.script(SCHEMA)
        n = build_decided_days(db)
        record_run(db, "ingest_perm_history.py --decided-days", status="ok" if n else "partial", rows_written=n,
                   note="decision days by decision month, FY2015 to FY2023, from perm_cases_history"
                        if n else "idx_pch_dec missing or the table empty: nothing built")
        return 0 if n else 1

    if args.years_wages:
        db = Database()
        db.script(SCHEMA)
        n = build_history_years_wages(db)
        record_run(db, "ingest_perm_history.py --years-wages", status="ok", rows_written=n,
                   note="the older table's years by outcome and its wage cells by year, occupation and state")
        return 0

    if args.month_days:
        db = Database()
        db.script(SCHEMA)
        n = build_month_days(db) + build_alphabet_history(db)
        record_run(db, "ingest_perm_history.py --month-days", status="ok", rows_written=n,
                   note="decision days by filing month and the alphabet chart's months from perm_cases_history")
        return 0

    if args.places_wages:
        db = Database()
        if args.dry_run:
            # The same reads, and counts and sizes in the log: nothing created, written or recorded.
            return 0 if build_places_and_wages(db, dry_run=True) else 1
        db.script(SCHEMA)
        n = build_places_and_wages(db)
        record_run(db, "ingest_perm_history.py --places-wages", status="ok" if n else "partial", rows_written=n,
                   note="worksites, wage bands and the salary explorer's older years from perm_cases_history"
                        if n else "idx_pch_dec missing or the table empty: nothing built")
        return 0 if n else 1

    if args.fill_slugs:
        db = Database()
        n = fill_slugs(db)
        record_run(db, "ingest_perm_history.py --fill-slugs", status="ok", rows_written=n,
                   note="employer slugs for rows no page matched")
        return 0

    if args.finish_only:
        db = Database()
        db.script(SCHEMA)
        ensure_columns(db)
        n = write_current_years(db)
        if not args.no_indexes:
            build_search_indexes(db)
        n += build_history_facets(db, occupation_slugs(db))
        n += build_month_days(db) + build_alphabet_history(db) + build_decided_days(db) + build_places_and_wages(db)
        n += build_entity_facets(db)
        n += build_history_years_wages(db)
        record_run(db, "ingest_perm_history.py --finish-only", status="ok", rows_written=n,
                   note="current years, search indexes, history facets, month days, decided days, worksites, wages, "
                        "entity facets, years and wage cells")
        return 0

    if args.current:
        db = Database()
        db.script(SCHEMA)
        n = write_current_years(db)
        record_run(db, "ingest_perm_history.py --current", status="ok", rows_written=n,
                   note="FY2024 onward of perm_employer_years from perm_cases")
        return 0

    if args.local:
        files = [(os.path.basename(p), p, ipd.file_fiscal_year(os.path.basename(p))) for p in args.local]
    else:
        html = fetch(ipd.PERFORMANCE_PAGE).decode("utf-8", "replace")
        files = history_files(html, args.from_fy, args.to_fy)
        if not files:
            raise SystemExit("FATAL: no PERM workbooks in range on DOL's performance page")
    log(f"  {len(files)} workbook(s): " + ", ".join(f"FY{fy} {n}" for n, _, fy in files))

    db = None if args.dry_run else Database()
    if db:
        db.script(SCHEMA)
        added = ensure_columns(db)
        if added:
            log(f"  added {added} to perm_cases_history")
    doc = read_doc(db) if db else {}
    loaded = doc.setdefault("files", {})
    emp, att = slug_maps(db) if db else ({}, {})
    withheld = withheld_firms(db) if db else Matcher(None, "firm")
    seen: set[str] = set()
    failures: list[str] = []
    wrote_years = wrote_cases = 0
    for i, (name, src, fy) in enumerate(files):
        if name in loaded and not args.force and not args.local:
            log(f"  FY{fy} {name}: loaded {loaded[name].get('loadedAt', '')}; skipping")
            continue
        log(f"  FY{fy} {name}")
        tmp = None
        try:
            if args.local:
                path = src
            else:
                if i and PAUSE_BETWEEN_FILES_S:
                    time.sleep(PAUSE_BETWEEN_FILES_S)
                data = fetch(src, referer=ipd.PERFORMANCE_PAGE)
                tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
                tmp.write(data)
                tmp.close()
                del data
                path = tmp.name
            got = parse_workbook(path, seen)
        except Exception as exc:  # noqa: BLE001 - one year failing must not cost the others
            log(f"    FAILED: {exc}")
            failures.append(f"{name}: {exc}")
            continue
        finally:
            if tmp is not None:
                os.unlink(tmp.name)
        folded, match = fold_counts(got["counts"], emp) if db else ({}, {"cases": got["kept"]})
        by_fy: dict[int, int] = defaultdict(int)
        for (_, y), c in got["counts"].items():
            by_fy[y] += sum(c)
        log(f"    {got['sheetRows']:,} sheet rows, {got['kept']:,} decided cases "
            f"({dict(sorted(by_fy.items()))}), {len(got['rows']):,} case rows"
            + (f", {match['matchedShare']:.1%} matched to an employer page" if db else ""))
        if not db:
            continue
        wrote_years += write_years(db, folded, sorted(by_fy))
        wrote_years += write_country_years(db, got["countries"],
                                           sorted({y for (_, y) in got["countries"]}))
        wrote_cases += write_cases(db, got["rows"], emp, att, withheld)
        loaded[name] = {"fy": fy, "cases": got["kept"], "caseRows": len(got["rows"]),
                        "matchedShare": match["matchedShare"], "resolved": got["resolved"],
                        "loadedAt": date.today().isoformat()}
        store_doc(db, doc)

    if db:
        # The years this run didn't load take today's firm pages too, so no year keeps a firm out of its rankings.
        wrote_cases += fill_firm_slugs(db, att, withheld)
        wrote_years += write_current_years(db)
        if not args.no_indexes:
            build_search_indexes(db)
        wrote_years += build_history_facets(db, occupation_slugs(db))
        wrote_years += (build_month_days(db) + build_alphabet_history(db) + build_decided_days(db)
                        + build_places_and_wages(db))
        wrote_years += build_history_years_wages(db)
        try:
            wrote_years += build_entity_facets(db)
        except Exception as exc:  # noqa: BLE001 - the loaded years stay loaded; the run ends partial
            log(f"  entity facets FAILED: {exc}")
            failures.append(f"entity facets: {exc}")
        years = sorted({v["fy"] for v in loaded.values()})
        status = "ok" if not failures else "partial"
        note = (f"FY{years[0]} to FY{years[-1]} held; " if years else "") + (
            f"failed: {'; '.join(failures)[:300]}" if failures else "all requested files loaded")
        record_run(db, "ingest_perm_history.py", status=status,
                   rows_written=wrote_years + wrote_cases, note=note)
        log(f"  wrote {wrote_years:,} employer-years and {wrote_cases:,} case rows")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

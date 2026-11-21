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
import sys
import tempfile
import time
import zipfile
from collections import defaultdict
from datetime import date
from xml.etree.ElementTree import iterparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ingest_perm_disclosure as ipd  # noqa: E402
from entity_identity import SpacedKeyMap, entity_key  # noqa: E402
from lib_naics import normalize_naics  # noqa: E402
from lib_db import (  # noqa: E402
    Database, add_missing_columns, canon, canon_hash, case_update, insert_rows, insert_stmts,
    record_run, rows_of, run_stmts, stmt, write_doc,
)
from lib_gov_data import SPREADSHEET_NS, column_index, fetch, log, read_shared_strings  # noqa: E402
from lib_slugs import slugify  # noqa: E402

FIRST_FY, LAST_FY = 2008, 2023
ROWS_FROM_FY = 2008
DOC_KEY = "perm_history"
PAUSE_BETWEEN_FILES_S = 30

# The current parser's names, plus the old forms'. Copied, never mutated: the
# quarterly parser's candidate list is its own contract.
CANDIDATES: dict[str, list[str]] = copy.deepcopy(ipd.COLUMN_CANDIDATES)
CANDIDATES["attorney"] = CANDIDATES["attorney"] + ["AGENT_FIRM_NAME"]
CANDIDATES["naics"] = CANDIDATES["naics"] + ["2007_NAICS_US_CODE", "2012_NAICS_US_CODE"]
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
         layoff        TEXT
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
        rows.append({
            "caseNumber": case_no, "status": outcome, "receivedDate": received,
            "decisionDate": decided, "days": days, "fiscalYear": str(fy),
            "employerName": employer, "state": state or None,
            "jobTitle": clean(rec.get("job_title"), 80) or None,
            "socCode": (rec.get("soc_code") or "").strip()[:10] or None,
            "socTitle": clean(rec.get("soc_title"), 80) or None,
            "attorneyName": attorney, "wage": ipd.annual_wage(rec.get("wage") or "",
                                                               rec.get("wage_unit") or ""),
            "naics": normalize_naics(rec.get("naics")),
            "worksiteCity": clean(rec.get("worksite_city"), 60) or None,
            "layoff": ipd.yes_no(rec.get("layoff")),
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


def row_tuple(r: dict, emp: dict[str, str], att: dict[str, str]) -> tuple:
    e, a = r["employerName"], r["attorneyName"]
    return (r["caseNumber"], r["status"], r["receivedDate"], r["decisionDate"], r["days"],
            r["fiscalYear"], e or None, employer_slug_for(e, emp),
            r["state"], r["jobTitle"], r["socCode"], r["socTitle"], a or None,
            att.get(entity_key(a), "") if a else "", r["wage"], r["naics"], r["worksiteCity"],
            r.get("citizenship"), r.get("birthCountry"), r.get("visaClass"), r.get("education"),
            r.get("major"), r.get("institution"), r.get("jobEducation"), r.get("layoff"))


def fingerprint(t: tuple) -> str:
    """The core record: whether a stored row is this case as DOL published it."""
    return canon_hash(t[1:CORE])


def extras_of(t: tuple) -> tuple[str, ...]:
    return tuple(canon(v) for v in t[CORE:])


def ensure_columns(db) -> list[str]:
    """A table made before the worker's fields existed gains them in place."""
    return add_missing_columns(db, "perm_cases_history", {c: "TEXT" for c in EXTRA})


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


def write_cases(db, rows: list[dict], emp, att) -> int:
    """New or changed rows whole; rows whose only change is the worker's fields
    by a narrow UPDATE."""
    by_fy: dict[int, list[tuple]] = defaultdict(list)
    for r in rows:
        by_fy[int(r["fiscalYear"])].append(row_tuple(r, emp, att))
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
    out = {str(r[0]) for r in rows_of(db.execute(
        "SELECT slug FROM perm_entities WHERE kind = 'employer'"))}
    try:
        out |= {str(r[0]) for r in rows_of(db.execute("SELECT slug FROM perm_live_only_index"))}
    except Exception:  # noqa: BLE001 - a database without the live table
        pass
    return out


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


def next_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y + (mo == 12)}-{1 if mo == 12 else mo + 1:02d}"


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
        m, stop = str(first)[:7], next_month(str(last)[:7])
        while m != stop:
            nxt = next_month(m)
            days: dict[int, int] = defaultdict(int)
            for a, b in month_slices(m):
                for r in rows_of(db.execute(
                        "SELECT days, COUNT(*) FROM perm_cases_history h "
                        "WHERE received_date >= ? AND received_date < ? AND days IS NOT NULL "
                        "AND NOT EXISTS (SELECT 1 FROM perm_cases p WHERE p.case_number = h.case_number) "
                        "GROUP BY days", [a, b])):
                    days[int(r[0])] += int(r[1])
            out.extend((m, d, n) for d, n in sorted(days.items()))
            m = nxt
    db.execute(next(t for t in SCHEMA if "perm_history_month_days" in t))
    db.execute("DELETE FROM perm_history_month_days")
    insert_rows(db, "perm_history_month_days", ["m", "days", "n"], out, per_request=STMTS_PER_REQUEST)
    log(f"  history month days: {len(out):,} rows")
    return len(out)


def month_slices(m: str) -> list[tuple[str, str]]:
    """A month's filing days in three slices of about ten days: a busy month read whole took 1.7 s."""
    nxt = next_month(m)
    return [(f"{m}-01", f"{m}-11"), (f"{m}-11", f"{m}-21"), (f"{m}-21", f"{nxt}-01")]


def build_alphabet_history(db) -> int:
    """perm_history_alphabet: the older table's cases from the alphabet chart's first filing month, by month and
    employer initial (as build_alphabet.py reads it), cases perm_cases also holds left out."""
    import build_alphabet  # the chart's own first month, one rule
    since = build_alphabet.SINCE_MONTH
    hi = rows_of(db.execute("SELECT MAX(received_date) FROM perm_cases_history"))
    last = str(hi[0][0])[:7] if hi and hi[0][0] else None
    sums: dict[tuple[str, str], list] = {}
    if last and last >= since:
        m, stop = since, next_month(last)
        while m != stop:
            for a, b in month_slices(m):
                for r in rows_of(db.execute(
                        "SELECT UPPER(SUBSTR(TRIM(employer_name), 1, 1)) AS letter, COUNT(*), SUM(days) "
                        "FROM perm_cases_history h WHERE received_date >= ? AND received_date < ? "
                        "AND days IS NOT NULL "
                        "AND NOT EXISTS (SELECT 1 FROM perm_cases p WHERE p.case_number = h.case_number) "
                        "GROUP BY letter", [a, b])):
                    got = sums.setdefault((m, str(r[0] or "")), [0, 0.0])
                    got[0] += int(r[1])
                    got[1] += float(r[2] or 0)
            m = next_month(m)
    out = [(m, letter, n, total) for (m, letter), (n, total) in sorted(sums.items())]
    db.execute(next(t for t in SCHEMA if "perm_history_alphabet" in t))
    db.execute("DELETE FROM perm_history_alphabet")
    insert_rows(db, "perm_history_alphabet", ["month", "letter", "n", "sum_days"], out, per_request=STMTS_PER_REQUEST)
    log(f"  history alphabet: {len(out):,} rows")
    return len(out)


# One pass over the older table for two small records the site reads instead of it (sweep items 20 and 21, Nov 21
# 2026): each fiscal year's cases by outcome (perm_docs[HISTORY_YEARS_DOC]: /perm-cases' total, its year list and
# its outcome counts) and each year's certified wages by occupation and state (perm_history_wage_cells: the case
# page's wage ladder for an older case). Read FIVE decision days a statement on idx_pch_dec: a ten-day slice of 11
# columns returned 4,858 rows in 1.09 s on the live database (Nov 21 2026), past the one-second rule.
HISTORY_YEARS_DOC = "perm_history_years"
SLICE_DAYS = 5
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


def build_search_indexes(db) -> None:
    t = time.time()
    for ddl in SEARCH_INDEXES:
        db.execute(ddl)
    log(f"  search indexes ({len(SEARCH_INDEXES)}) in {time.time() - t:,.0f}s")


def read_doc(db) -> dict:
    try:
        raw = db.scalar("SELECT json FROM perm_docs WHERE key = ?", [DOC_KEY])
        return json.loads(raw) if raw else {}
    except Exception:  # noqa: BLE001 - a database without perm_docs yet
        return {}


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
    ap.add_argument("--years-wages", action="store_true",
                    help="no workbooks: only rebuild perm_docs['perm_history_years'] and perm_history_wage_cells "
                         "(one pass, five decision days a statement), then stop")
    args = ap.parse_args()

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
        n += build_month_days(db) + build_alphabet_history(db)
        n += build_history_years_wages(db)
        record_run(db, "ingest_perm_history.py --finish-only", status="ok", rows_written=n,
                   note="current years, search indexes, history facets, month days, years and wage cells")
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
        wrote_cases += write_cases(db, got["rows"], emp, att)
        loaded[name] = {"fy": fy, "cases": got["kept"], "caseRows": len(got["rows"]),
                        "matchedShare": match["matchedShare"], "resolved": got["resolved"],
                        "loadedAt": date.today().isoformat()}
        store_doc(db, doc)

    if db:
        wrote_years += write_current_years(db)
        if not args.no_indexes:
            build_search_indexes(db)
        wrote_years += build_history_facets(db, occupation_slugs(db))
        wrote_years += build_month_days(db) + build_alphabet_history(db)
        wrote_years += build_history_years_wages(db)
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

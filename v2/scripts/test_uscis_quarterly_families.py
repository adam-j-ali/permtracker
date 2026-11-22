#!/usr/bin/env python3
"""Probes for the five families ingest_uscis_quarterly.py reads since Nov 21 2026, on USCIS's own files.

    python3 scripts/test_uscis_quarterly_families.py

The I-765 by eligibility category, pending I-765s by days waited, the net
backlog and frontlog, I-907 premium processing, the N-400 by field office,
and the I-485 office file's older spelling; with the listing's pages, the
crawl delay, and a run that loads some files and refuses others.

The fixtures in scripts/fixtures/uscis_real/ are USCIS's files byte for byte
(downloaded from www.uscis.gov on Nov 21 2026), so every sample value below
is USCIS's own. A probe that breaks a check changes the rows read from a
fixture, or the parsed values, never the file. The all-forms file the cross
checks need is the synthetic one in fixtures/uscis/, whose I-765 and N-400
rows are FY2026 Q3's real ones (the real workbook is 800 KB).
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ingest_uscis_quarterly as q  # noqa: E402
from test_uscis_quarterly import FakeDb  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
REAL = HERE / "fixtures" / "uscis_real"
ALL_FORMS = HERE / "fixtures" / "uscis" / "quarterly_all_forms_fy2026_q3_v2.xlsx"
# USCIS's eleven all-forms workbooks, FY2024 Q1 to FY2026 Q3 (downloaded Nov 21 2026). The workbook,
# its sheet and its shared strings are USCIS's bytes; the 5 MB stylesheet, the theme and the logo,
# which the reader never opens, are left out, and each file parses exactly as the original does.
ALL_FORMS_HISTORY = HERE / "fixtures" / "uscis_all_forms"
FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{(' - ' + detail) if detail else ''}")
    if not cond:
        FAILURES.append(name)


def refuses(name: str, fn, needle: str = "") -> None:
    try:
        fn()
        check(name, False, "it was accepted")
    except q.Refusal as exc:
        check(name, needle in str(exc), str(exc)[:110])


def listed(name: str, fy: int | None = None, quarter: int | None = None) -> q.Listed:
    ident = q.identify(name)
    assert ident, name
    kind, f, qq = ident
    return q.Listed(kind, fy or f, quarter or qq, name, str(REAL / name))


def sheets(name: str) -> list[tuple[str, list[dict[int, str]]]]:
    return q.sheets_of(listed(name), (REAL / name).read_bytes())


def parse(name: str, sh=None, *, fy: int | None = None, quarter: int | None = None) -> q.Parsed:
    item = listed(name, fy, quarter)
    if sh is None:
        return q.parse_blob(item, (REAL / name).read_bytes())
    if item.kind in q.SHEET_PARSERS:
        return q.SHEET_PARSERS[item.kind](sh, item)
    rows, _ = q.find_sheet(sh, name, "an office header", lambda r: q.norm(r.get(0)).startswith("Field Office by State"))
    return q.parse_n400_offices(rows, item) if item.kind == "n400_offices" else q.parse_i485_offices(rows, item)


def edited(name: str, fn) -> list[tuple[str, list[dict[int, str]]]]:
    """The fixture's sheets with `fn(rows)` applied to the first sheet holding data, on a copy."""
    sh = copy.deepcopy(sheets(name))
    fn(sh[0][1])
    return sh


def row_of(rows: list[dict[int, str]], first: str) -> dict[int, str]:
    return next(r for r in rows if q.norm(r.get(0)) == first)


def clone(p: q.Parsed) -> q.Parsed:
    return copy.deepcopy(p)


def all_forms_rows() -> list[dict]:
    af = q.parse_blob(q.Listed("all_forms", 2026, 3, ALL_FORMS.name, str(ALL_FORMS)), ALL_FORMS.read_bytes())
    return [{"form": r["form"], "title": r["title"], **{m: r[m] for m in q.OFFICE_MEASURES}} for r in af.rows]


# ---------------------------------------------------------------------------
# Filenames, the listing's pages, the crawl delay
# ---------------------------------------------------------------------------

def probe_filenames() -> None:
    print("\nfilenames")
    for name, want in (
        ("i765_application_for_employment_fy2025_q1.xlsx", ("i765_categories", 2025, 1)),
        ("i765_application_for_employment_fy2026_q1_v1.xlsx", ("i765_categories", 2026, 1)),
        ("I765_P_AllCat_C08_FY2023Q1.csv", ("i765_pending_days", 2023, 1)),
        ("i765_p_allcat_c08_fy2023q3.csv", ("i765_pending_days", 2023, 3)),
        ("i765_p_allcat_c08_fy2024_q1.xlsx", ("i765_pending_days", 2024, 1)),
        ("i765_p_allcat_c08_fy2025_q4_v1.xlsx", ("i765_pending_days", 2025, 4)),
        ("net_backlog_frontlog_fy2026_q3_v1.xlsx", ("net_backlog", 2026, 3)),
        ("net_backlog_frontlog_fy2024_q1.xlsx", ("net_backlog", 2024, 1)),
        ("net_backlog_fy23_q4.csv", ("net_backlog", 2023, 4)),
        ("net_frontlog_fy23_q4.csv", ("net_backlog", 2023, 4)),
        ("i907_premium_processing_fy2025_q1.xlsx", ("i907_premium", 2025, 1)),
        ("i907_premium_processing_fy2026_q3_v1.xlsx", ("i907_premium", 2026, 3)),
        ("n400_performance_data_fy2026_q3_v1.xlsx", ("n400_offices", 2026, 3)),
        ("n400_performancedata_fy2024_q1.xlsx", ("n400_offices", 2024, 1)),
        ("i485_performancedata_fy2024_q1.xlsx", ("i485_offices", 2024, 1)),
        ("i485_performance_data_fy2026_q3_v1.xlsx", ("i485_offices", 2026, 3)),
    ):
        check(f"{name} is {want}", q.identify(name) == want, str(q.identify(name)))
    for name in (
        "i765_application_for_employment_fy24.xlsx",        # yearly, no pending column
        "i-765_application_for_employment_fy23.csv",
        "i765_rad_fy03-22_annualreport_update_20241202.xlsx",
        "I765_P_AllCat_C08_FY2023Q1.pdf",
        "net_backlog_frontlog_fy23_q4.pdf",
        "i485_performancedata_fy2023_q4.csv",               # the csv history is a reader of its own, not yet built
        "I485_performancedata_fy2018_qtr1.csv",
        "I485_LRIF_performancedata_fy2024_q1.xlsx",          # a different program
        "n400_performancedata_fy2023_q4.csv",
        "N400_performancedata_fy2014qtr1.csv",
        "i765_application_for_employment_fy2026_q5.xlsx",   # there is no fifth quarter
        "Form_I-765_Application_for_Employment_Authorization_Granted_applications_for_H-4_holders.xlsx",
    ):
        check(f"{name} is not read", q.identify(name) is None, str(q.identify(name)))
    html = """
      <a href="/sites/default/files/document/data/I765_P_AllCat_C08_FY2023Q1.csv">csv</a>
      <a href="/sites/default/files/document/data/I765_P_AllCat_C08_FY2023Q1.pdf">pdf</a>
      <a href="/sites/default/files/document/data/net_backlog_fy23_q4.csv">pair</a>
      <a href="/sites/default/files/document/data/net_frontlog_fy23_q4.csv">pair</a>
      <a href="/sites/default/files/document/data/i765_application_for_employment_fy2026_q3_v1.xlsx">i765</a>
      <a href="/sites/default/files/document/data/quarterly_all_forms_fy2026_q3_v1.xlsx">all forms</a>
    """
    found = q.discover(html)
    check("discovery reads csv links too, and never a pdf",
          [f.name for f in found if f.kind == "i765_pending_days"] == ["I765_P_AllCat_C08_FY2023Q1.csv"])
    check("both csv files of the FY2023 Q4 backlog pair are listed",
          sorted(f.name for f in found if f.kind == "net_backlog") == ["net_backlog_fy23_q4.csv", "net_frontlog_fy23_q4.csv"])
    check("all_forms sorts first, so the families checked against it find its quarter held",
          found[0].kind == "all_forms", found[0].kind)


PAGER_LAST = ('<nav class="views-mini-pager"><ul><li class="pager__item pager__item--previous"><a href="/tools/'
              'reports-and-studies/immigration-and-citizenship-data?items_per_page=100&amp;page={prev}" '
              'aria-label="Previous page" rel="prev" class="link">Previous</a></li><li class="pager__item '
              'pager__item--next pager__item--disabled"><span class="next-text">Next</span></li></ul></nav>')
PAGER_NEXT = ('<nav class="views-mini-pager"><ul><li class="pager__item pager__item--next"><a href="/tools/'
              'reports-and-studies/immigration-and-citizenship-data?items_per_page=100&amp;page={next}" '
              'aria-label="Next page" rel="next" class="link"><span class="next-text">Next</span></a></li></ul></nav>')


def page_html(n: int, files: list[str], last: bool, next_to: int | None = None) -> str:
    links = "".join(f'<a href="/sites/default/files/document/data/{f}">x</a>' for f in files)
    # Every page repeats the newest files in a sidebar.
    links += '<a href="/sites/default/files/document/data/i907_premium_processing_fy2026_q3_v1.xlsx">sidebar</a>'
    pager = PAGER_LAST.format(prev=n - 1) if last else PAGER_NEXT.format(next=n + 1 if next_to is None else next_to)
    return f"<html><body>{links}{pager}</body></html>"


def probe_pages() -> None:
    print("\nthe listing's pages")
    pages = {
        0: page_html(0, ["i907_premium_processing_fy2026_q3_v1.xlsx", "n400_performance_data_fy2026_q3_v1.xlsx"], False),
        1: page_html(1, ["i907_premium_processing_fy2025_q1.xlsx", "net_backlog_fy23_q4.csv"], False),
        2: page_html(2, ["n400_performancedata_fy2024_q1.xlsx"], True),
    }
    asked: list[str] = []

    def get(url: str) -> bytes:
        asked.append(url)
        return pages[q.page_number(url)].encode()

    got = q.read_listing(get)
    names = [f.name for f in got.files]
    check("the walk follows Next to the last page and stops there",
          got.pages == 3 and not got.stopped and not got.failed and len(asked) == 3, str(asked))
    check("the first page is the listing itself and the next ones come from its own links",
          asked[0] == q.DATA_PAGE and asked[1].endswith("items_per_page=100&page=1"), asked[1])
    check("files from every page, each once although the sidebar repeats it",
          len(names) == 5 and names.count("i907_premium_processing_fy2026_q3_v1.xlsx") == 1, str(names))
    check("the listing sorts oldest first within a kind",
          [f.name for f in got.files if f.kind == "i907_premium"]
          == ["i907_premium_processing_fy2025_q1.xlsx", "i907_premium_processing_fy2026_q3_v1.xlsx"])

    capped = q.read_listing(get, cap=2)
    check("the walk stops at the cap and says so", capped.pages == 2 and "cap of 2" in capped.stopped
          and not capped.failed, capped.stopped)
    endless: list[str] = []
    forever = q.read_listing(lambda url: endless.append(url) or page_html(q.page_number(url), [], False).encode())
    check("a listing that never ends stops at 25 pages by default, saying so",
          forever.pages == 25 and len(endless) == 25 and "cap of 25" in forever.stopped, forever.stopped)

    def broken(url: str) -> bytes:
        if q.page_number(url) == 1:
            raise OSError("HTTP 503 after four attempts")
        return pages[q.page_number(url)].encode()
    half = q.read_listing(broken)
    check("a later page that can't be read keeps the first page's files and says which page failed",
          half.pages == 1 and "listing page 1 not read" in half.failed and len(half.files) == 2, half.failed)
    try:
        q.read_listing(lambda url: (_ for _ in ()).throw(OSError("refused")))
        check("a first page that can't be read fails the run", False)
    except OSError:
        check("a first page that can't be read fails the run", True)

    skipping = {0: page_html(0, ["i907_premium_processing_fy2026_q3_v1.xlsx"], False, next_to=5)}
    odd = q.read_listing(lambda url: skipping[q.page_number(url)].encode())
    check("a Next link that skips a page ends the walk red rather than guessing",
          odd.pages == 1 and "not the following page" in odd.failed, odd.failed)
    check("next_page_link reads the pager's rel=next link and unescapes it",
          q.next_page_link(PAGER_NEXT.format(next=4)) == q.HOST + "/tools/reports-and-studies/"
          "immigration-and-citizenship-data?items_per_page=100&page=4")
    check("the last page's disabled Next is no link", q.next_page_link(PAGER_LAST.format(prev=16)) is None)


def probe_pace() -> None:
    print("\nthe crawl delay")
    now = [100.0]
    slept: list[float] = []

    def sleep(s: float) -> None:
        slept.append(s)
        now[0] += s
    pace = q.Pacer(10.0, clock=lambda: now[0], sleep=sleep)
    pace.wait()
    check("the first request waits for nothing", slept == [])
    pace.wait()
    check("a request right after another waits the full ten seconds", slept == [10.0], str(slept))
    now[0] += 4
    pace.wait()
    check("a request four seconds later waits the other six", slept[-1] == 6.0, str(slept))
    now[0] += 12
    pace.wait()
    check("a request twelve seconds later waits for nothing", len(slept) == 2, str(slept))
    check("the delay is USCIS's robots.txt Crawl-delay of 10", q.USCIS_CRAWL_DELAY_S == 10 and q.USCIS_PACE.gap == 10)
    # Every request to www.uscis.gov goes through the pacer: the listing, each file, the factsheet.
    calls: list[str] = []
    real_fetch, real_pace = q.fetch, q.USCIS_PACE
    try:
        q.fetch = lambda url, referer=None: calls.append(url) or b""  # type: ignore[assignment]
        q.USCIS_PACE = q.Pacer(10.0, clock=lambda: now[0], sleep=sleep)
        before = len(slept)
        q.fetch_uscis("https://www.uscis.gov/a")
        q.fetch_uscis("https://www.uscis.gov/b")
        check("fetch_uscis paces every request it makes", len(calls) == 2 and len(slept) == before + 1)
    finally:
        q.fetch, q.USCIS_PACE = real_fetch, real_pace


# ---------------------------------------------------------------------------
# I-765 by eligibility category
# ---------------------------------------------------------------------------

FY26 = {"5": "mandatory", "6": "discretionary"}


def i765_synthetic(slack: int, hidden: tuple[str, int] | None = None) -> q.Parsed:
    """Forty-four codes of one each per cell, and a Total `slack` above them in the received columns.

    `hidden` withholds C40's initial_received as (mark, true value): the Total
    counts the true value and the row's own total shows it, as USCIS's do.
    """
    p = q.Parsed("i765_categories", 2026, 3, "synthetic.xlsx")
    codes = ["C08", "C09", "C26", "C33"] + [f"C{40 + i}" for i in range(40)]
    for code in codes:
        r = {"code": code, "description": code, "discretion": None, "withheld": {}, "suppressed": 0}
        for f in q.I765_FILINGS[:-1]:
            for m in q.OFFICE_MEASURES:
                r[f"{f}_{m}"] = 1
        for m in q.OFFICE_MEASURES:
            r[f"all_{m}"] = 4
        p.rows.append(r)
    true_initial = len(codes)
    if hidden:
        mark, value = hidden
        r = next(x for x in p.rows if x["code"] == "C40")
        r["initial_received"], r["all_received"] = None, value + 3
        r["withheld"], r["suppressed"] = {"initial_received": mark}, 1
        true_initial += value - 1
    total = {"code": "ALL", "description": "All", "discretion": None, "withheld": {}, "suppressed": 0}
    for f in q.I765_FILINGS[:-1]:
        for m in q.OFFICE_MEASURES:
            total[f"{f}_{m}"] = len(codes)
    total["initial_received"] = true_initial + slack
    for m in q.OFFICE_MEASURES:
        total[f"all_{m}"] = sum(total[f"{f}_{m}"] for f in q.I765_FILINGS[:-1])
    p.rows.append(total)
    return p


def probe_i765_categories() -> None:
    print("\nI-765 by eligibility category")
    for raw, markers, want in (
        ("A025", FY26, ("A02", "mandatory")),
        ("C086", FY26, ("C08", "discretionary")),
        ("C255", FY26, ("C25", "mandatory")),
        ("C316", FY26, ("C31", "discretionary")),
        ("C085", {"4": "mandatory", "5": "discretionary"}, ("C08", "discretionary")),
        ("C031", FY26, ("C031", None)),
        ("C173", FY26, ("C173", None)),
        ("C09P", FY26, ("C09P", None)),
        ("C03B", {}, ("C03B", None)),
        ("A03", FY26, ("A03", None)),
        ("UNKNOWN", FY26, ("UNKNOWN", None)),
    ):
        check(f"i765_code({raw!r}) -> {want}", q.i765_code(raw, markers, "t") == want, str(q.i765_code(raw, markers, "t")))
    refuses("a code ending in a digit no reference line explains is refused, never stored as a code",
            lambda: q.i765_code("C085", {}, "t"), "footnote marker")
    refuses("a label that isn't a code is refused", lambda: q.i765_code("Total Pending", FY26, "t"), "not an eligibility code")
    check("the markers are read from the file's own reference lines",
          q.i765_markers(sheets("i765_application_for_employment_fy2026_q3_v1.xlsx")[0][1]) == FY26)
    check("FY2025 Q1 glues no markers",
          q.i765_markers(sheets("i765_application_for_employment_fy2025_q1.xlsx")[0][1]) == {})

    p = parse("i765_application_for_employment_fy2026_q3_v1.xlsx")
    by = {r["code"]: r for r in p.rows}
    check("FY2026 Q3: 62 codes and the Total", len(p.rows) == 63 and "ALL" in by, str(len(p.rows)))
    c9 = by["C09"]
    check("(c)(9) received 152,290, approved 32,249, denied 35,720, pending 671,263",
          (c9["all_received"], c9["all_approved"], c9["all_denied"], c9["all_pending"]) == (152290, 32249, 35720, 671263))
    check("(c)(9) pending splits into 603,286 initial and 64,064 renewal",
          (c9["initial_pending"], c9["renewal_pending"]) == (603286, 64064))
    check("(c)(9)P 749 / 14,156 / 47 / 99",
          tuple(by["C09P"][f"all_{m}"] for m in q.OFFICE_MEASURES) == (749, 14156, 47, 99))
    check("(c)(26) H-4 19,303 / 14,315 / 761 / 48,036 and its description",
          tuple(by["C26"][f"all_{m}"] for m in q.OFFICE_MEASURES) == (19303, 14315, 761, 48036)
          and by["C26"]["description"] == "H-4 SPOUSE OF AN H1-B NONIMMIGRANT")
    check("the Total: 572,947 / 366,079 / 67,022 / 2,110,712",
          tuple(by["ALL"][f"all_{m}"] for m in q.OFFICE_MEASURES) == (572947, 366079, 67022, 2110712))
    check("glued codes are stored clean with their discretion",
          by["A02"]["discretion"] == "mandatory" and by["C08"]["discretion"] == "discretionary"
          and by["C09"]["discretion"] is None and "A025" not in by and "C086" not in by)
    check("the gap between the codes and the Total is recorded (1,410,368 against 1,410,371)",
          any(n.startswith("initial_pending: codes 3 below") for n in p.notes), str(p.notes[:3]))
    check("no cell withheld in FY2026 Q3", sum(r["suppressed"] for r in p.rows) == 0)

    old = parse("i765_application_for_employment_fy2025_q1.xlsx")
    byo = {r["code"]: r for r in old.rows}
    check("FY2025 Q1 (sheet named I765_FY5Q1) reads by its text: (c)(9) pending 153,874",
          byo["C09"]["all_pending"] == 153874)
    check("FY2025 Q1 holds the five codes FY2026 Q3 dropped",
          {"C011", "C091", "C12A", "C13", "C32"} <= set(byo) and not ({"C011", "C091", "C12A", "C13", "C32"} & set(by)))
    previous = {r["code"] for r in old.rows}
    check("codes that come and go are logged, never refused",
          q.drift_findings(previous, p) == [] and any("C091" in n for n in q.drift_notes(previous, p)))

    # Each exact check, broken on purpose.
    def bump(code: str, col: int):
        def fn(rows):
            r = row_of(rows, code)
            r[col] = str(int(r[col]) + 1)
        return fn
    refuses("a row whose filing types no longer add up to its total is refused",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
                          edited("i765_application_for_employment_fy2026_q3_v1.xlsx", bump("C09", 2))),
            "filing types add up")

    def shift(rows):
        r = row_of(rows, "C26")
        vals = [r.get(c) for c in range(2, 22)]
        for c in range(2, 22):
            r[c] = vals[c - 3] if c > 2 else "0"
    refuses("a row read one column to the right is refused",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
                          edited("i765_application_for_employment_fy2026_q3_v1.xlsx", shift)), "C26")

    def rename(rows):
        rows[4][6] = "Receipts Filed"
    refuses("a renamed column heading is refused",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
                          edited("i765_application_for_employment_fy2026_q3_v1.xlsx", rename)), "doesn't know")

    def drop_group(rows):
        del rows[3][10]
    refuses("a column group whose heading is gone is refused (its columns fall under the wrong group)",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
                          edited("i765_application_for_employment_fy2026_q3_v1.xlsx", drop_group)), "two columns")

    def word(rows):
        row_of(rows, "C26")[5] = "see note"
    refuses("a word where a count belongs is refused, never read as blank",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
                          edited("i765_application_for_employment_fy2026_q3_v1.xlsx", word)), "not a count")

    def withhold(rows):
        r = row_of(rows, "C02")      # E-1 dependents of TECRO: 4 received, all initial
        r[2], r[18] = "D", "D"
    w = parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
              edited("i765_application_for_employment_fy2026_q3_v1.xlsx", withhold))
    c02 = next(r for r in w.rows if r["code"] == "C02")
    check("a D cell is None and counted as withheld; the row still loads",
          c02["initial_received"] is None and c02["all_received"] is None and c02["suppressed"] == 2)

    def withhold_big(rows):
        r = row_of(rows, "C26")      # 6,739: no D hides that many
        r[2], r[18] = "D", "D"
    refuses("a D standing for more than 9 is refused (the codes fall too far below the Total)",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx",
                          edited("i765_application_for_employment_fy2026_q3_v1.xlsx", withhold_big)), "at most 34")
    check("strict_count: D and H withheld, N/A None, '-' zero, '1,234' a count",
          (q.strict_count("D", "t"), q.strict_count("H", "t"), q.strict_count("N/A", "t"),
           q.strict_count(" -   ", "t"), q.strict_count("1,234", "t")) == (None, None, None, 0, 1234))

    notes_first = copy.deepcopy(sheets("i765_application_for_employment_fy2026_q3_v1.xlsx"))
    notes_first.insert(0, ("Notes", [{0: "Notes"}, {0: "1 Something about the data."}]))
    check("a Notes sheet first is passed over: the sheet is found by its header",
          len(parse("i765_application_for_employment_fy2026_q3_v1.xlsx", notes_first).rows) == 63)
    refuses("a workbook without the category sheet is refused",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx", [("Notes", [{0: "Notes"}])]),
            "no sheet holds")
    refuses("a file whose printed range doesn't end its named quarter is refused",
            lambda: parse("i765_application_for_employment_fy2026_q3_v1.xlsx", fy=2026, quarter=2), "not 2026-03-31")

    # The tolerances at their edges.
    q.reconcile_i765(i765_synthetic(0))
    check("codes equal to the Total pass", True)
    q.reconcile_i765(i765_synthetic(25))
    check("codes 25 below the Total pass (the edge)", True)
    refuses("codes 26 below the Total are refused", lambda: q.reconcile_i765(i765_synthetic(26)), "at most 25")
    refuses("codes above the Total are refused", lambda: q.reconcile_i765(i765_synthetic(-1)), "more than the printed Total")
    q.reconcile_i765(i765_synthetic(25, ("D", 9)))
    check("a D cell gives 9 more room: a D of 9 with the codes 25 short passes (34 below)", True)
    refuses("a D of 9 with the codes 26 short is refused (35 below)",
            lambda: q.reconcile_i765(i765_synthetic(26, ("D", 9))), "at most 34")
    q.reconcile_i765(i765_synthetic(0, ("H", 5000)))
    check("an H cell hides a value of any size: only the floor holds", True)

    # Against the all-forms file's four I-765 rows.
    forms = all_forms_rows()
    check("FY2026 Q3 matches the all-forms file on all four measures",
          q.cross_check(p, forms) == "matches the all-forms file")
    check("no all-forms quarter held: said, not checked", "not checked" in q.cross_check(p, None))
    for code, words in (("C08", "Asylum"), ("C09P", "Adjustment Of Status"), ("C33", "DACA")):
        bad = clone(p)
        next(r for r in bad.rows if r["code"] == code)["all_pending"] += 1
        refuses(f"{code} off by one against the all-forms {words} row is refused (exact in every quarter)",
                lambda bad=bad: q.check_i765_against_all_forms(bad, forms), words)
    # The Total against the four rows: FY2025 Q2's files disagree by 2 and 5, so 25 (or 2%) is allowed, and noted.
    room = max(q.CROSS_FILE_FLOOR, round(q.CROSS_FILE_SHARE * by["ALL"]["all_denied"]))
    near = clone(p)
    next(r for r in near.rows if r["code"] == "ALL")["all_denied"] -= room
    said = q.cross_check(near, forms)
    check(f"a Total {room:,} off the four all-forms rows (the edge) loads, and the run note says so",
          said.startswith("DIFFERS") and "Total denied" in said, said[:120])
    far = clone(p)
    next(r for r in far.rows if r["code"] == "ALL")["all_denied"] -= room + 1
    refuses(f"a Total {room + 1:,} off is refused", lambda: q.check_i765_against_all_forms(far, forms), "more than")


# ---------------------------------------------------------------------------
# Pending I-765s by days waited
# ---------------------------------------------------------------------------

def probe_pending_days() -> None:
    print("\npending I-765s by days waited")
    for label, want in (("60 or fewer", (0, 60)), ("30 or fewer days", (0, 30)), ("61 - 90", (61, 90)),
                        ("122 - 179", (122, 179)), ("180 to 540 days", (180, 540)), ("541 or more days", (541, None)),
                        ("180 or more", (180, None)), ("60 Days or Fewer", (0, 60)),
                        ("Between 61 and 90 Days", (61, 90)), ("180 Days or More", (180, None))):
        check(f"bucket_range({label!r}) -> {want}", q.bucket_range(label, "t") == want, str(q.bucket_range(label, "t")))
    refuses("a range this reader doesn't know is refused", lambda: q.bucket_range("about 90", "t"), "not a range")
    refuses("a backwards range is refused", lambda: q.bucket_range("90 - 61", "t"), "not a range")

    p = parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx")
    by = {(r["filing"], r["scope"], r["days_min"]): r for r in p.rows}
    check("FY2026 Q3: seven ranges, four columns each", len(p.rows) == 28 and p.as_of == "2026-06-30")
    check("FY2026 Q3, all categories, initial: 309,864 waiting 541 days or more",
          by[("initial", "all", 541)]["count"] == 309864 and by[("initial", "all", 541)]["days_max"] is None)
    check("FY2026 Q3, all categories, initial: 628,977 waiting 180 to 540 days",
          by[("initial", "all", 180)]["count"] == 628977 and by[("initial", "all", 180)]["days_max"] == 540)
    check("(c)(8) initial 30 or fewer days: 25,162, stored with its label as printed",
          by[("initial", "c8", 0)]["count"] == 25162 and by[("initial", "c8", 0)]["bucket"] == "30 or fewer days")
    q4 = parse("i765_p_allcat_c08_fy2025_q4_v1.xlsx")
    check("FY2025 Q4: five ranges, 122 - 179 among them",
          len({r["days_min"] for r in q4.rows}) == 5 and any(r["bucket"] == "122 - 179" for r in q4.rows))
    old = parse("i765_p_allcat_c08_fy2023q4.csv")
    byo = {(r["filing"], r["scope"], r["days_min"]): r["count"] for r in old.rows}
    check("the FY2023 Q4 csv (byte-order mark, CRLF, quoted commas, 'September 30th') reads",
          old.as_of == "2023-09-30" and byo[("initial", "all", 180)] == 430463 and byo[("initial", "c8", 180)] == 964)
    check("its 91 - 121 and 121 - 179 share a day, which USCIS printed and is allowed",
          ("initial", "all", 91) in byo and ("initial", "all", 121) in byo)
    q2 = parse("I765_P_AllCat_C08_FY2023Q2.csv")
    check("FY2023 Q2 says 'As of April 1, 2023' for the quarter ending March 31, and is read as that quarter",
          q2.as_of == "2023-03-31" and len(q2.rows) == 20)
    check("its 'Between 61 and 90 Days' wording reads", any(r["days_min"] == 61 and r["days_max"] == 90 for r in q2.rows))

    def bump(rows):
        r = row_of(rows, "61 - 90 days")
        r[2] = str(int(r[2]) + 1)
    refuses("a range that no longer adds up to the Grand Total is refused",
            lambda: parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", edited("i765_p_allcat_c08_fy2026_q3_v1.xlsx", bump)),
            "Grand Total")

    def gap(rows):
        row_of(rows, "61 - 90 days")[0] = "62 - 90 days"
    refuses("a gap between ranges is refused",
            lambda: parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", edited("i765_p_allcat_c08_fy2026_q3_v1.xlsx", gap)),
            "gap or an overlap")

    def no_total(rows):
        row_of(rows, "Grand Total")[0] = "Subtotal"
    refuses("an unknown row where the Grand Total was is refused",
            lambda: parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", edited("i765_p_allcat_c08_fy2026_q3_v1.xlsx", no_total)),
            "not a range")

    def swap(rows):
        rows[4][1], rows[4][2] = rows[4][2], rows[4][1]
    swapped = parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", edited("i765_p_allcat_c08_fy2026_q3_v1.xlsx", swap))
    check("two columns that trade places are read by their headings, not their places",
          next(r["count"] for r in swapped.rows if (r["filing"], r["scope"], r["days_min"]) == ("initial", "c8", 0))
          == 84600)

    def twice(rows):
        rows[4][1] = "All Categories"
    refuses("a column heading named twice is refused",
            lambda: parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", edited("i765_p_allcat_c08_fy2026_q3_v1.xlsx", twice)),
            "two columns")
    refuses("a file without the days-pending sheet is refused",
            lambda: parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", [("Sheet1", [{0: "Nothing here"}])]), "no sheet holds")
    refuses("a file whose as-of date isn't its named quarter's end is refused",
            lambda: parse("i765_p_allcat_c08_fy2026_q3_v1.xlsx", fy=2026, quarter=2), "not 2026-03-31")


# ---------------------------------------------------------------------------
# Net backlog and frontlog
# ---------------------------------------------------------------------------

def probe_net_backlog() -> None:
    print("\nnet backlog and frontlog")
    p = parse("net_backlog_frontlog_fy2026_q3_v1.xlsx")
    by = {(r["measure"], r["form"], r["title"]): r for r in p.rows}
    val = {(r["measure"], r["form"]): r["value"] for r in p.rows}
    check("FY2026 Q3: total net backlog 7,736,000 and the frontlog 11,000",
          val[("net_backlog", "TOTAL")] == 7736000 and val[("frontlog", "ALL")] == 11000)
    check("65 forms besides the total", sum(1 for r in p.rows if r["measure"] == "net_backlog" and r["form"] != "TOTAL") == 65)
    check("I-140 132,100, the employment I-485 88,600, the I-765 adjustment of status 502,000",
          val[("net_backlog", "I-140")] == 132100
          and by[("net_backlog", "I-485", "Application to Register Permanent Residence or Adjust Status (Employment)")]["value"] == 88600
          and by[("net_backlog", "I-765", "Application for Employment Authorization (Adjustment Of Status)")]["value"] == 502000)
    forms = {r["form"] for r in p.rows}
    check("footnote glue and spare spaces come off as in the all-forms table",
          {"I-600", "I-800", "I-924", "I-589", "I-914", "I-918", "N-600", "Legalization", "Waivers", "N-400",
           "I-881", "DS-230 (IV)", "EOIR Adjustment", "I-140G"} <= forms
          and not {"I-6002", "N-400 ", "Waivers10"} & forms, str(sorted(forms))[:200])
    check("N-648's N/A is None, never zero", val[("net_backlog", "N-648")] is None)
    check("I-526 is two rows by title, beside I-526E",
          sum(1 for r in p.rows if r["form"] == "I-526") == 2 and ("net_backlog", "I-526E") in val)
    check("each form keeps its category", by[("net_backlog", "I-140", "Immigrant Petition for Alien Workers")]["category"] == "Employment-Based")
    check("the total's gap to its rounded parts is recorded", any("+500" in n for n in p.notes), str(p.notes))

    old = parse("net_backlog_fy23_q4.csv")
    vo = {(r["form"], r["title"]): r["value"] for r in old.rows}
    check("FY2023 Q4 csv: total 4,279,000 under the 'Net Backlog (rounded)1' heading",
          vo[("TOTAL", "All forms")] == 4279000 and old.as_of == "2023-09-30")
    check("its ' -   ' cells are zero and its N/A-free N-648 is zero",
          vo[("I-800", "Petition to Classify Convention Adoptee as an Immediate Relative")] == 0
          and vo[("N-648", "Medical Certification for Disability Exceptions")] == 0)
    check("the backlog csv holds no frontlog", {r["measure"] for r in old.rows} == {"net_backlog"})
    front = parse("net_frontlog_fy23_q4.csv")
    check("the frontlog csv ('As of September 30,2023', no space) holds one row of 0",
          [(r["measure"], r["form"], r["value"]) for r in front.rows] == [("frontlog", "ALL", 0)])

    # The total's tolerance at its edge: 0.5% of the total.
    total = val[("net_backlog", "TOTAL")]
    held = sum(r["value"] or 0 for r in p.rows if r["measure"] == "net_backlog" and r["form"] != "TOTAL")
    edge = int(q.BACKLOG_TOTAL_SLACK * total) // 100 * 100

    def with_gap(g: int) -> q.Parsed:
        bad = clone(p)
        next(r for r in bad.rows if r["form"] == "TOTAL")["value"] = held + g
        return bad
    q.reconcile_backlog(with_gap(edge))
    check(f"a total {edge:,} above its parts (within 0.5%) passes", True)
    refuses("a total further off than 0.5% is refused", lambda: q.reconcile_backlog(with_gap(edge + 20000)), "over 0.5%")
    refuses("so is one that far below", lambda: q.reconcile_backlog(with_gap(-edge - 20000)), "over 0.5%")

    def unrounded(rows):
        row_of(rows, "I-129F")[2] = "18201"
    refuses("a backlog figure not rounded to the hundred is refused (a column read from elsewhere)",
            lambda: parse("net_backlog_frontlog_fy2026_q3_v1.xlsx", edited("net_backlog_frontlog_fy2026_q3_v1.xlsx", unrounded)),
            "rounded to the hundred")

    def drop_row(rows):
        rows.remove(row_of(rows, "I-5895"))
    refuses("a dropped row (the I-589's 1,343,000) is refused by the total",
            lambda: parse("net_backlog_frontlog_fy2026_q3_v1.xlsx", edited("net_backlog_frontlog_fy2026_q3_v1.xlsx", drop_row)),
            "over 0.5%")
    only_backlog = [s for s in sheets("net_backlog_frontlog_fy2026_q3_v1.xlsx") if not s[0].startswith("Frontlog")]
    refuses("a workbook without its frontlog sheet is refused",
            lambda: parse("net_backlog_frontlog_fy2026_q3_v1.xlsx", only_backlog), "All Forms Frontlog")
    refuses("a workbook whose date isn't its named quarter's end is refused",
            lambda: parse("net_backlog_frontlog_fy2026_q3_v1.xlsx", fy=2026, quarter=2), "not 2026-03-31")
    previous = {"net_backlog|I-130|Petition for Alien Relative", "net_backlog|TOTAL|All forms"}
    check("rows split and added (I-130 into two) are logged, never refused",
          q.drift_findings(previous, p) == [] and any("Immediate Relative" in n for n in q.drift_notes(previous, p)))


# ---------------------------------------------------------------------------
# I-907 premium processing
# ---------------------------------------------------------------------------

def probe_i907() -> None:
    print("\nI-907 premium processing")
    p = parse("i907_premium_processing_fy2026_q3_v1.xlsx")
    by = {r["form"]: r for r in p.rows}
    check("FY2026 Q3 ('April 1, 2026 -June 30, 2026'): four forms and the Grand Total",
          set(by) == {"ALL", "I-129", "I-140", "I-539", "I-765"} and p.quarter_end == "2026-06-30")
    check("I-140 34,563: 26,268 concurrent and 8,295 upgrades",
          (by["I-140"]["total"], by["I-140"]["concurrent"], by["I-140"]["upgrade"]) == (34563, 26268, 8295))
    check("I-129 154,600, I-765 38,652, all 231,641",
          (by["I-129"]["total"], by["I-765"]["total"], by["ALL"]["total"]) == (154600, 38652, 231641))

    def bump_total(rows):
        r = row_of(rows, "I-140")
        r[4] = str(int(r[4]) + 1)
    refuses("a form whose concurrent and upgrade don't make its total is refused",
            lambda: parse("i907_premium_processing_fy2026_q3_v1.xlsx",
                          edited("i907_premium_processing_fy2026_q3_v1.xlsx", bump_total)), "concurrent")

    def bump_form(rows):
        r = row_of(rows, "I-539")
        r[2], r[4] = str(int(r[2]) + 1), str(int(r[4]) + 1)
    refuses("forms that no longer add up to the Grand Total are refused",
            lambda: parse("i907_premium_processing_fy2026_q3_v1.xlsx",
                          edited("i907_premium_processing_fy2026_q3_v1.xlsx", bump_form)), "Grand Total")

    def rename(rows):
        rows[3][3] = "Upgrades and transfers"
    refuses("a renamed heading is refused",
            lambda: parse("i907_premium_processing_fy2026_q3_v1.xlsx",
                          edited("i907_premium_processing_fy2026_q3_v1.xlsx", rename)), "expected Concurrent")
    refuses("a file whose range doesn't end its named quarter is refused",
            lambda: parse("i907_premium_processing_fy2026_q3_v1.xlsx", fy=2026, quarter=4), "not 2026-09-30")
    previous = {"ALL", "I-129", "I-140", "I-539"}
    check("a new form is logged, never refused",
          q.drift_findings(previous, p) == [] and any("I-765" in n for n in q.drift_notes(previous, p)))


# ---------------------------------------------------------------------------
# N-400 and I-485 by field office
# ---------------------------------------------------------------------------

def probe_offices() -> None:
    print("\nN-400 and I-485 by field office")
    p = parse("n400_performance_data_fy2026_q3_v1.xlsx")
    by = {r["code"]: r for r in p.rows}
    t = by["ALL"]
    check("FY2026 Q3: 93 offices and the TOTAL", len(p.rows) == 94)
    check("its start-date typo ('April 1, 2025 - June 30, 2026') is read past; the end is the quarter's",
          (p.quarter_start, p.quarter_end) == ("2025-04-01", "2026-06-30"))
    check("civilian received 140,179, approved 54,974, denied 12,591, pending 727,371",
          tuple(t[f"civ_{m}"] for m in q.OFFICE_MEASURES) == (140179, 54974, 12591, 727371))
    check("military pending 14,767; everyone pending 742,138", (t["mil_pending"], t["all_pending"]) == (14767, 742138))
    check("164 D cells, each None", sum(r["suppressed"] for r in p.rows) == 164 and by["ANC"]["civ_denied"] is None)
    check("Charleston WV (CHS) is all zeros and kept",
          all(by["CHS"][c] == 0 for c in q.N400_COLUMNS) and by["CHS"]["state"] == "West Virginia")
    check("the territories read like states, and their block heading is no state",
          (by["AGA"]["state"], by["CHA"]["state"], by["SAJ"]["state"]) == ("Guam", "U.S. Virgin Islands", "Puerto Rico")
          and not any(r["state"].startswith("Field Office") for r in p.rows))
    check("office names lose their trailing spaces", by["ANC"]["office"] == "Anchorage")
    check("every N-400 office has a page on the site", q.offices_without_a_page(p.rows) == [])
    refuses("a file whose range doesn't end its named quarter is refused",
            lambda: parse("n400_performance_data_fy2026_q3_v1.xlsx", fy=2026, quarter=2), "not 2026-03-31")

    bad = clone(p)
    bad_row = next(r for r in bad.rows if r["code"] == "MGA")
    bad_row["civ_received"] += 1
    refuses("civilian plus military no longer making a row's total is refused",
            lambda: q.reconcile_n400(bad), "MGA received")
    refuses("an office no longer adding up to the TOTAL row is refused",
            lambda: q.reconcile_offices(bad, q.N400_COLUMNS), "civ_received")
    forms = all_forms_rows()
    check("FY2026 Q3 matches the all-forms file's two N-400 rows", q.cross_check(p, forms) == "matches the all-forms file")
    # FY2024 Q3's two files disagree by up to 1.6% on every measure: 2% (at least 25) is allowed, and noted.
    room = max(q.CROSS_FILE_FLOOR, round(q.CROSS_FILE_SHARE * 727371))
    near = clone(p)
    next(r for r in near.rows if r["code"] == "ALL")["civ_pending"] += room
    said = q.cross_check(near, forms)
    check(f"a civilian pending {room:,} off the all-forms row (the edge) loads, and says so",
          said.startswith("DIFFERS") and "civ_pending" in said, said[:120])
    far = clone(p)
    next(r for r in far.rows if r["code"] == "ALL")["civ_pending"] += room + 1
    refuses(f"{room + 1:,} off is refused", lambda: q.check_n400_against_all_forms(far, forms), "more than")
    small = clone(p)
    next(r for r in small.rows if r["code"] == "ALL")["mil_denied"] += 26
    refuses("a small figure (military denied, 251) 26 off is refused: the floor is 25",
            lambda: q.check_n400_against_all_forms(small, forms), "mil_denied")

    def rename(rows):
        rows[4][6] = "Naturalization (Veterans)1"
    refuses("a renamed column group is refused",
            lambda: parse("n400_performance_data_fy2026_q3_v1.xlsx",
                          edited("n400_performance_data_fy2026_q3_v1.xlsx", rename)), "Military")
    refuses("a workbook without the office sheet is refused",
            lambda: q.parse_blob(listed("n400_performance_data_fy2026_q3_v1.xlsx"),
                                 _workbook_without_sheets()), "no sheet holds")

    i485 = parse("i485_performancedata_fy2024_q1.xlsx")
    t = next(r for r in i485.rows if r["code"] == "ALL")
    check("the I-485's older spelling, FY2024 Q1: 99 offices, 243 D cells, employment pending 193,698",
          len(i485.rows) == 100 and sum(r["suppressed"] for r in i485.rows) == 243 and t["emp_pending"] == 193698)
    check("every FY2024 Q1 I-485 office has a page on the site", q.offices_without_a_page(i485.rows) == [])

    def heading_moved(rows):
        r = next(r for r in rows if q.norm(r.get(0)).startswith("Field Office by State"))
        r[5] = "Pending at quarter end"
    refuses("an I-485 measure heading changed is refused",
            lambda: parse("i485_performancedata_fy2024_q1.xlsx", edited("i485_performancedata_fy2024_q1.xlsx", heading_moved)),
            "column 5")


def _workbook_without_sheets() -> bytes:
    """A real workbook's bytes with its worksheet removed: the zip opens, no sheet holds the table."""
    import zipfile
    src = zipfile.ZipFile(REAL / "n400_performance_data_fy2026_q3_v1.xlsx")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "xl/worksheets/sheet1.xml":
                data = re.sub(rb"<sheetData>.*</sheetData>", b"<sheetData/>", data, flags=re.S)
            z.writestr(info, data)
    return out.getvalue()


# ---------------------------------------------------------------------------
# Storage, and the whole run
# ---------------------------------------------------------------------------

def probe_store_and_run() -> None:
    print("\nstorage and the whole run")
    db = FakeDb()
    q.ensure_tables(db)
    parsed = [parse(n) for n in ("i765_application_for_employment_fy2026_q3_v1.xlsx", "i765_p_allcat_c08_fy2026_q3_v1.xlsx",
                                 "net_backlog_frontlog_fy2026_q3_v1.xlsx", "i907_premium_processing_fy2026_q3_v1.xlsx",
                                 "n400_performance_data_fy2026_q3_v1.xlsx")]
    for p in parsed:
        n = q.store(db, p)
        check(f"store {p.kind}: parsed == stored ({n})", n == len(p.rows))
    check("a reload replaces its quarter, never doubles it",
          q.store(db, parsed[0]) == 63 and db.scalar("SELECT count(*) FROM uscis_i765_categories") == 63)
    check("a stored C09 row keeps its numbers, discretion and quarter's end",
          db.scalar("SELECT all_pending FROM uscis_i765_categories WHERE code = 'C09'") == 671263
          and db.scalar("SELECT discretion FROM uscis_i765_categories WHERE code = 'A02'") == "mandatory"
          and db.scalar("SELECT quarter_end FROM uscis_i765_categories WHERE code = 'C09'") == "2026-06-30")
    check("an open-ended range stores days_max NULL",
          db.scalar("SELECT days_max FROM uscis_i765_pending_days WHERE days_min = 541 LIMIT 1") is None)
    check("N/A stores NULL in the backlog", db.scalar("SELECT value FROM uscis_net_backlog WHERE form = 'N-648'") is None)
    check("a D cell stores NULL in the N-400 table",
          db.scalar("SELECT civ_denied FROM uscis_n400_offices WHERE code = 'ANC' AND fy = 2026") is None)
    pair = [parse("net_backlog_fy23_q4.csv"), parse("net_frontlog_fy23_q4.csv")]
    for p in pair:
        q.store(db, p)
    check("the FY2023 Q4 pair: the frontlog file leaves the backlog file's rows in place",
          db.scalar("SELECT count(*) FROM uscis_net_backlog WHERE fy = 2023 AND quarter = 4 AND measure = 'net_backlog'")
          == len(pair[0].rows)
          and db.scalar("SELECT value FROM uscis_net_backlog WHERE fy = 2023 AND measure = 'frontlog'") == 0)
    check("drift reads the previous quarter's keys for the new tables",
          q.previous_keys(db, q.Parsed("i907_premium", 2026, 4, "next.xlsx")) == {"ALL", "I-129", "I-140", "I-539", "I-765"})
    n400_codes = {r["code"] for r in parsed[4].rows}
    check("drift reads the nearest LATER quarter for a history load, and none for the newest",
          q.later_keys(db, q.Parsed("n400_offices", 2024, 1, "old.xlsx")) == n400_codes
          and q.later_keys(db, parsed[4]) is None)
    # A history quarter that lost a key the next quarter held also lacks was retired by then; one that comes back is a misread.
    older = clone(parsed[4])
    older.rows = [r for r in older.rows if r["code"] != "NJC"]
    previous = n400_codes
    check("history: an office gone here and gone from the next quarter held too is a retirement, loaded",
          q.drift_findings(previous, older, later=n400_codes - {"NJC"}) == [])
    check("history: an office gone here but back in the next quarter held is refused",
          q.drift_findings(previous, older, later=n400_codes) != [])
    check("the newest quarter (nothing later held) refuses any loss, as before",
          q.drift_findings(previous, older, later=None) != [])
    lossy = FakeDb(drop_one_row=True)
    q.ensure_tables(lossy)
    refuses("store refuses when the count read back is short", lambda: q.store(lossy, parsed[3]), "REFUSING")

    # The whole run over the real files, with the all-forms quarter already held, so the cross checks run.
    db = FakeDb()
    q.ensure_tables(db)
    af = q.parse_blob(q.Listed("all_forms", 2026, 3, ALL_FORMS.name, str(ALL_FORMS)), ALL_FORMS.read_bytes())
    q.store(db, af)
    real_db = q.Database
    q.Database = lambda: db  # type: ignore[assignment]
    try:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = q.main(["--local", str(REAL), "--skip-factsheet"])
        log = out.getvalue()
        loads = q.read_loads(db)
        check("main: every real file loads and the run ends green",
              rc == 0 and set(loads) == {f.name for f in REAL.iterdir()}, log[-300:])
        check("main: the I-765 and N-400 FY2026 Q3 files were checked against the all-forms file",
              log.count("matches the all-forms file") == 2, str(log.count("matches the all-forms file")))
        check("main: the quarters with no all-forms file held say so",
              "not checked against the all-forms file (its FY2025 Q1 rows aren't held)" in log)
        fresh = {r[0]["value"]: r[1]["value"] for r in
                 db.execute("SELECT dataset, as_of FROM data_freshness")["response"]["result"]["rows"]}
        check("main: stamps the five new datasets with their newest quarter's end",
              (fresh.get("uscis-i765-categories"), fresh.get("uscis-i765-pending-days"), fresh.get("uscis-net-backlog"),
               fresh.get("uscis-i907-premium"), fresh.get("uscis-n400-offices"))
              == ("2026-06-30",) * 5, str(fresh))
        check("main: the I-485's FY2024 Q1 stamps that quarter's end on an empty table",
              fresh.get("uscis-i485-offices") == "2023-12-31", str(fresh.get("uscis-i485-offices")))
        runs = db.execute("SELECT status FROM ingest_runs ORDER BY rowid DESC LIMIT 1")["response"]["result"]["rows"]
        check("main: an ok run", runs[0][0]["value"] == "ok")
        check("main: a load day is an Eastern day", all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", v["loadedOn"]) for v in loads.values()))

        # One unreadable file among good ones: the good ones load, the bad one is named and the run ends red.
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copy(REAL / "i907_premium_processing_fy2026_q3_v1.xlsx", tmp)
            pathlib.Path(tmp, "i907_premium_processing_fy2025_q1.xlsx").write_bytes(b"<html>Page not found</html>")
            shutil.copy(REAL / "net_backlog_fy23_q4.csv", tmp)
            fresh_db = FakeDb()
            q.Database = lambda: fresh_db  # type: ignore[assignment]
            with contextlib.redirect_stdout(io.StringIO()):
                rc = q.main(["--local", tmp, "--skip-factsheet"])
            loads = q.read_loads(fresh_db)
            runs = fresh_db.execute("SELECT status, note FROM ingest_runs ORDER BY rowid DESC LIMIT 1")["response"]["result"]["rows"]
            check("main: a file that isn't a workbook is refused alone; the files after it still load",
                  rc == 1 and set(loads) == {"i907_premium_processing_fy2026_q3_v1.xlsx", "net_backlog_fy23_q4.csv"}, str(set(loads)))
            check("main: the run is recorded failed and names the refused file",
                  runs[0][0]["value"] == "failed" and "i907_premium_processing_fy2025_q1.xlsx" in runs[0][1]["value"])
            with contextlib.redirect_stdout(io.StringIO()):
                rc = q.main(["--local", tmp, "--skip-factsheet", "--dry-run"])
            check("main: a dry run with a refused file ends red too", rc == 1)
    finally:
        q.Database = real_db


def run_main(directory: pathlib.Path | str, db: FakeDb, *extra: str) -> tuple[int, str]:
    """`main --local` over a directory into `db`, with its log; a crash is the run's failure, never the probes'."""
    real_db = q.Database
    q.Database = lambda: db  # type: ignore[assignment]
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            rc = q.main(["--local", str(directory), "--skip-factsheet", *extra])
    except Exception as exc:  # noqa: BLE001 - a crash is reported as a failed check
        return -1, out.getvalue() + f"\nCRASHED: {type(exc).__name__}: {exc}"
    finally:
        q.Database = real_db
    return rc, out.getvalue()


def last_run(db: FakeDb) -> tuple[str, str]:
    rows = db.execute("SELECT status, note FROM ingest_runs ORDER BY rowid DESC LIMIT 1")["response"]["result"]["rows"]
    return (rows[0][0]["value"], rows[0][1]["value"]) if rows else ("", "")


def probe_history_drift() -> None:
    print("\nthe all-forms history, oldest first, into an empty database")
    names = sorted(f.name for f in ALL_FORMS_HISTORY.iterdir())
    check("control: the eleven real all-forms quarters are there", len(names) == 11, str(names))
    # USCIS retired rows in three of those quarters: I-924A in FY2024 Q4, the single I-130 row and the
    # I-193 in FY2025 Q1, the DS-230 and four I-131 rows in FY2026 Q1. Each is gone from the next quarter too.
    db = FakeDb()
    parses: list[str] = []
    real_parse = q.parse_blob

    def counted(item, blob):
        parses.append(item.name)
        return real_parse(item, blob)
    q.parse_blob = counted  # type: ignore[assignment]
    try:
        rc, log = run_main(ALL_FORMS_HISTORY, db)
    finally:
        q.parse_blob = real_parse  # type: ignore[assignment]
    loads = q.read_loads(db)
    check("every real all-forms quarter loads into an empty database with no refusal",
          rc == 0 and sorted(loads) == names and "REFUSED" not in log,
          f"rc {rc}; " + "; ".join(l.strip() for l in log.splitlines() if "REFUS" in l or "CRASH" in l)[:300])
    check("eleven quarters held", db.scalar("SELECT count(DISTINCT fy * 10 + quarter) FROM uscis_form_quarters") == 11)
    check("each file is read and parsed once, though the parse happens before any is stored",
          sorted(parses) == names, str(parses))
    check("the retired I-924A is named, with the quarter that witnessed it",
          re.search(r"gone from FY2025 Q1 too.*I-924A", log) is not None,
          next((l.strip() for l in log.splitlines() if "I-924A" in l), "")[:200])
    check("the run is recorded ok", last_run(db)[0] == "ok", last_run(db)[1][-200:])

    # A key that vanishes for one quarter and comes back the next is a misread, and is still refused;
    # the quarter after it, which carries the key, loads against the last one held.
    three = ["quarterly_all_forms_fy2024_q1.xlsx", "quarterly_all_forms_fy2024_q2.xlsx", "quarterly_all_forms_fy2024_q3.xlsx"]

    def misread(item, blob):
        p = real_parse(item, blob)
        if item.name == three[1]:
            p.rows = [r for r in p.rows if r["form"] != "I-129F"]
        return p
    with tempfile.TemporaryDirectory() as tmp:
        for n in three:
            shutil.copy(ALL_FORMS_HISTORY / n, tmp)
        db = FakeDb()
        q.parse_blob = misread  # type: ignore[assignment]
        try:
            rc, log = run_main(tmp, db)
        finally:
            q.parse_blob = real_parse  # type: ignore[assignment]
        loads = q.read_loads(db)
        status, note = last_run(db)
        check("a row gone in FY2024 Q2 and back in Q3 refuses Q2, naming the row",
              rc == 1 and three[1] not in loads and "keys were lost" in note
              and re.search(r"DRIFT: .*I-129F", log) is not None, note[-200:])
        check("the quarters either side of it load: the refusal doesn't cascade",
              set(loads) == {three[0], three[2]} and status == "failed", str(sorted(loads)))

    # The witness is the nearest later quarter, read ahead in this run or held.
    db = FakeDb()
    q.ensure_tables(db)
    newest = q.parse_blob(q.Listed("all_forms", 2026, 3, names[-1], ""), (ALL_FORMS_HISTORY / names[-1]).read_bytes())
    q.store(db, newest)
    q4 = q.parse_blob(q.Listed("all_forms", 2024, 4, names[3], ""), (ALL_FORMS_HISTORY / names[3]).read_bytes())
    q3 = q.Parsed("all_forms", 2024, 3, names[2])
    got = q.drift_witness(db, q3, {q4.name: q4})
    check("a quarter read ahead is the witness when it's nearer than the newest held",
          got is not None and got[0] == (2024, 4) and "I-924A|Annual Certification of Regional Center" not in got[1],
          str(got and got[0]))
    got = q.drift_witness(db, q3, {q4.name: q.Refusal("unreadable")})
    check("a file that couldn't be read ahead is no witness; the held quarter is", got is not None and got[0] == (2026, 3))
    check("the newest quarter has no witness", q.drift_witness(db, newest, {}) is None)


def probe_registry() -> None:
    print("\nfreshness and the site's dataset sentences")
    want = {"uscis-i765-categories", "uscis-i765-pending-days", "uscis-net-backlog", "uscis-i907-premium", "uscis-n400-offices"}
    check("the five datasets are stamped by the ingest", want <= {f["dataset"] for f in q.FRESHNESS.values()})
    # dataset-coverage.test.ts holds the same rule in vitest; this reads the file the same way.
    ts = (HERE.parent / "src" / "lib" / "datasetCoverage.ts").read_text()
    for d in sorted(want):
        sentence = re.search(rf'"{d}":\s*"([^"]+)"', ts)
        check(f"{d} has a sentence and a short name in datasetCoverage.ts",
              sentence is not None and len(sentence.group(1)) > 30 and sentence.group(1).rstrip().endswith(".")
              and len(re.findall(rf'"{d}":', ts)) == 2)
    cfg = json.loads((HERE.parent / "src" / "lib" / "uscisOffices.json").read_text())
    check("control: the office list the page checks read is the site's own", len(cfg) == 99)


def report() -> int:
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {FAILURES}")
        return 1
    print("all probes passed")
    return 0


def main() -> int:
    print("ingest_uscis_quarterly: the five families of Nov 21 2026")
    if not REAL.is_dir():
        check("the real fixtures exist", False)
        return report()
    probe_filenames()
    probe_pages()
    probe_pace()
    probe_i765_categories()
    probe_pending_days()
    probe_net_backlog()
    probe_i907()
    probe_offices()
    probe_store_and_run()
    probe_history_drift()
    probe_registry()
    return report()


if __name__ == "__main__":
    sys.exit(main())

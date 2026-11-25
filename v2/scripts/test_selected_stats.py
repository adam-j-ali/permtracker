#!/usr/bin/env python3
"""DOL's Selected Statistics sheets, read strictly (lib_selected_stats.py, Batch 4, Nov 25 2026).

The fixtures are the text pdfplumber takes from DOL's own PDFs, fetched from OFLC's performance page on Nov 25 2026:
PERM FY2026 Q4 and FY2024 Q4 (no Total row then), PERM FY2023 Q4 (pending split between two systems, which the reader
refuses) and the wage request sheet FY2026 Q4. Each figure below is as the sheet prints it.

    python3 scripts/test_selected_stats.py
"""
from __future__ import annotations

import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_dol_selected_stats import newest_sheet, read_on  # noqa: E402
from lib_selected_stats import SelectedStatsError, parse_perm, parse_pw  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent / "fixtures" / "dol" / "selected-stats"
fails: list[str] = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def text(name: str) -> str:
    return (HERE / f"{name}.txt").read_text()


def refused(fn, t: str, needle: str) -> bool:
    try:
        fn(t)
    except SelectedStatsError as exc:
        return needle in str(exc)
    return False


def test_perm_fy2026():
    r = parse_perm(text("PERM_Selected_Statistics_FY2026_Q4"))
    check((r["fy"], r["quarter"], r["asOf"]) == (2026, 4, "2026-09-30"), "PERM FY2026: the year, quarter and day")
    check(r["received"] == {"year": 110809, "quarters": [30757, 24604, 26872, 28576], "changePct": -6.0},
          "PERM FY2026: received 110,809 by quarter, down 6.0%")
    check(r["certified"] == {"year": 159277, "quarters": [16199, 39017, 48801, 55260]}, "PERM FY2026: certified")
    check(r["denied"]["year"] == 5615 and r["withdrawn"]["year"] == 6187, "PERM FY2026: denied 5,615, withdrawn 6,187")
    check(r["total"] == {"year": 171079, "quarters": [18112, 41851, 52285, 58831]}, "PERM FY2026: the printed total")
    check(r["remaining"] == 90121, "PERM FY2026: 90,121 applications remaining on Sep 30")


def test_perm_fy2024_without_a_total_row():
    r = parse_perm(text("PERM_Selected_Statistics_FY2024_Q4"))
    check(r["asOf"] == "2024-09-30" and r["remaining"] == 183776, "PERM FY2024: 183,776 remaining on Sep 30 2024")
    check(r["total"]["year"] == 102036 + 5031 + 7483 and r["total"].get("derived") is True,
          "PERM FY2024: no Total row, so the total is the three outcomes added, marked derived")


def test_perm_fy2023_two_systems_refused():
    check(refused(parse_perm, text("PERM_Selected_Statistics_FY2023_Q4"), "applications remaining"),
          "PERM FY2023: pending split between CMS and FLAG is refused, never half read")


def test_pw_fy2026():
    r = parse_pw(text("PW_Selected_Statistics_FY2026_Q4"))
    check((r["fy"], r["asOf"]) == (2026, "2026-09-30"), "PW FY2026: the year and day")
    check(r["receivedPerm"] == {"year": 177352, "quarters": [32020, 45417, 52994, 46921], "changePct": -1.9},
          "PW FY2026: PERM requests received 177,352")
    check(r["receivedAll"]["year"] == 208482, "PW FY2026: every program 208,482")
    check(r["determinations"]["year"] == 199406 and r["withdrawn"]["year"] == 7070, "PW FY2026: determinations and withdrawals")
    check(r["pending"] == {"year": 55470, "quarters": [52843, 42283, 54633, 55470]}, "PW FY2026: pending at each quarter's end")


def test_probes():
    t = text("PERM_Selected_Statistics_FY2026_Q4")
    check(refused(parse_perm, t.replace("Certified 159,277 16,199 39,017 48,801 55,260",
                                        "Certified 159,277 16,199 39,017 48,801 55,290"), "quarters add"),
          "probe: a quarter 30 off its year is refused")
    check(refused(parse_perm, t.replace("Data as of September 30, 2026.", "Data as of soon."), "Data as of"),
          "probe: a sheet without its date is refused")
    check(refused(parse_perm, t.replace("90,121 applications remaining as of 9/30/2026",
                                        "90,121 applications remaining as of 6/30/2026"), "dated"),
          "probe: pending dated another day than the sheet is refused")
    check(refused(parse_pw, t, "Prevailing Wage Program"), "probe: the PERM sheet read as the wage sheet is refused")
    p = text("PW_Selected_Statistics_FY2026_Q4")
    check(refused(parse_pw, p.replace("Pending 55,470 52,843 42,283 54,633 55,470", "Pending 55,470 52,843 42,283 54,633 54,470"),
                  "last quarter"), "probe: a year's pending that isn't its last quarter's is refused")


def test_newest_sheet():
    links = {name: f"https://www.dol.gov/x/{name}" for name in (
        "PERM_Selected_Statistics_FY_2020_Q4.pdf", "PERM_Selected_Statistics_FY2021.pdf",
        "PERM_Selected_Statistics_FY2025_Q4.pdf", "PERM_Selected_Statistics_FY2026_Q4.pdf",
        "PW_Selected_Statistics_FY2026_Q4.pdf", "LCA_Selected_Statistics_FY2027_Q1.pdf")}
    check(newest_sheet(links, "PERM")[0] == "PERM_Selected_Statistics_FY2026_Q4.pdf", "newest PERM sheet: FY2026 Q4")
    check(newest_sheet(links, "PW")[0] == "PW_Selected_Statistics_FY2026_Q4.pdf", "newest wage sheet, never LCA's")
    links["PERM_Selected_Statistics_FY2027_Q1.pdf"] = "https://www.dol.gov/x/next"
    check(newest_sheet(links, "PERM")[0] == "PERM_Selected_Statistics_FY2027_Q1.pdf", "a new fiscal year's Q1 is newer")
    check(newest_sheet({}, "PERM") is None, "no sheet on the page is None, never a guess")


def test_document_writes_as_json():
    import json

    # The first dry run failed here: the read day was a date object, which JSON can't write.
    check(json.loads(json.dumps({"readOn": read_on()}))["readOn"] == read_on(), "the read day is an ISO string")
    check(len(read_on()) == 10 and read_on()[4] == "-", "the read day is YYYY-MM-DD")


def main() -> int:
    for fn in (test_perm_fy2026, test_perm_fy2024_without_a_total_row, test_perm_fy2023_two_systems_refused,
               test_pw_fy2026, test_probes, test_newest_sheet, test_document_writes_as_json):
        fn()
    print(f"\n{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

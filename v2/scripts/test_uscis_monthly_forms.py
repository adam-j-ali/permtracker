#!/usr/bin/env python3
"""Probes for ingest_uscis_monthly_forms.py: file names, discovery, the report's two header spellings, every
refusal, and a whole run against real in-memory SQLite.

    python3 scripts/test_uscis_monthly_forms.py

NO NETWORK and no production database. The CSVs are built here in the shape USCIS publishes (four title rows, a
header, one row per form line, then notes and a source line), from rows read on Nov 18 2026.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ingest_uscis_monthly_forms as m  # noqa: E402
from lib_db import read_doc  # noqa: E402
from lib_sqlite_shim import SqliteTurso  # noqa: E402

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("ok   " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def refuses(name: str, fn, needle: str) -> None:
    try:
        fn()
    except m.Refusal as e:
        check(name, needle in str(e), str(e))
        return
    except SystemExit as e:
        check(name, needle in str(e), str(e))
        return
    check(name, False, "no refusal")


HEADER = '"Form Number","Description","Forms Received","Approvals","Denials","Pending","Pending Over {six} Months","Avg. Processing Time"'
SEPT = [
    ("I-130", "Petition for Alien Relative", "65,887", "28,880", "5,714", "2,512,691", "2,194,897", "17.3"),
    ("I-485", "Application to Register Permanent Residence or Adjust Status (Employment)", "17,190", "8,068", "1,497", "278,532", "155,350", "12.9"),
    ("I-485", "Application to Register Permanent Residence or Adjust Status (Family)", "40,845", "26,428", "5,903", "609,857", "450,070", "12.1"),
    ("I-765", "Application for Employment Authorization", "137,669", "132,180", "31,973", "1,896,913", "1,280,328", "6.9"),
]


def report(month_words: str, rows=SEPT, six: str = "6") -> str:
    lines = ['"Report to Congress",,,,,,,', '"Number of Service-Wide Forms",,,,,,,',
             '"By Month, Form Status, and Processing Time",,,,,,,', f'"For the Month of {month_words}",,,,,,,',
             HEADER.format(six=six)]
    lines += [",".join(f'"{c}"' for c in r) for r in rows]
    lines += ['"Notes",,,,,,,', '"6) ""Avg. Processing Time"" is the number of months it took",,,,,,,', '"Source:",,,,,,,',
              '"ELIS, CLAIMS3, queried October 2026",,,,,,,']
    return "\n".join(lines) + "\n"


def main() -> int:
    # Names: every spelling USCIS has used for this file.
    for name, want in [
        ("/sites/default/files/document/data/appropriation_requirement_september_2026_v1.csv", "2026-09"),
        ("/sites/default/files/document/data/Appropriation_Requirement_November_2022.csv", "2022-11"),
        ("/sites/default/files/document/data/AppropriationRequirementFebruary2023.csv", "2023-02"),
        ("/sites/default/files/document/data/appropriation_requirement_september%202025.csv", "2025-09"),
        ("/sites/default/files/document/data/appropriation_requirement_october_2025_v1.0.csv", "2025-10"),
    ]:
        check(f"name: {name.rsplit('/', 1)[1]} is {want}", m.month_of_name(name) == want, str(m.month_of_name(name)))
    check("name: another report is not this one", m.month_of_name("/sites/default/files/document/data/eb_inventory_october_2026_v1.xlsx") is None)

    # Discovery: links from every listing, one file a month, oldest first, other reports ignored.
    page_a = ('<a href="/sites/default/files/document/data/appropriation_requirement_september_2026_v1.csv">x</a>'
              '<a href="/sites/default/files/document/data/Appropriation_Requirement_November_2022.csv">y</a>'
              '<a href="/sites/default/files/document/data/eb_inventory_october_2026_v1.xlsx">z</a>')
    page_b = '<a href="/sites/default/files/document/data/appropriation_requirement_september_2026_v1.csv">x</a>'
    found = m.discover_files([page_a, page_b])
    check("discover: one file a month, oldest first", [mo for _, mo in found] == ["2022-11", "2026-09"], str(found))
    check("discover: full addresses on USCIS's host", found[-1][0].startswith("https://www.uscis.gov/sites/default/files/"), found[-1][0])
    refuses("discover: a listing with no report refuses", lambda: m.discover_files(["<p>nothing</p>"]), "no monthly report")

    # Parsing.
    month, rows = m.parse_report(report("September 2026"))
    check("parse: the month is the report's own", month == "2026-09", str(month))
    emp = next(r for r in rows if r["line"].endswith("(Employment)"))
    check("parse: numbers lose their commas", (emp["received"], emp["approved"], emp["denied"], emp["pending"], emp["pending_6mo"]) == (17190, 8068, 1497, 278532, 155350), str(emp))
    check("parse: the average is months, a decimal", emp["avg_months"] == 12.9, str(emp["avg_months"]))
    check("parse: notes and the source line are not rows", len(rows) == len(SEPT), str(len(rows)))
    check("parse: the I-485 basis is read from its parentheses", emp["basis"] == "Employment" and next(r for r in rows if r["form"] == "I-765")["basis"] == "", str(emp["basis"]))
    _, old = m.parse_report(report("November 2022", six="Six"))
    check("parse: the older header ('Pending Over Six Months') reads the same", old[1]["pending_6mo"] == 155350, str(old[1]))
    blank = [("I-765", "Application for Employment Authorization", "137,669", "-", "", "1,896,913", "1,280,328", "")]
    _, gaps = m.parse_report(report("September 2026", rows=blank))
    check("parse: a dash or a blank is no figure, never a zero", gaps[0]["approved"] is None and gaps[0]["denied"] is None and gaps[0]["avg_months"] is None, str(gaps[0]))
    refuses("parse: a month line missing refuses", lambda: m.parse_report(report("September 2026").replace("For the Month of", "For")), "month")
    refuses("parse: a header that moved refuses", lambda: m.parse_report(report("September 2026").replace("Denials", "Refusals")), "header")
    bad = [("I-765", "Application for Employment Authorization", "137,669", "lots", "1", "1", "1", "6.9")]
    refuses("parse: a figure that isn't a number refuses", lambda: m.parse_report(report("September 2026", rows=bad)), "not a number")
    refuses("parse: a report with no rows refuses", lambda: m.parse_report(report("September 2026", rows=[])), "no form rows")
    refuses("parse: a file whose month disagrees with its name refuses",
            lambda: m.check_month("2026-08", m.parse_report(report("September 2026"))[0]), "says")

    # The whole run, in memory.
    db = SqliteTurso()
    m.Database = lambda: db  # type: ignore[assignment]
    m.time.sleep = lambda s: None  # type: ignore[assignment]
    files = {
        "https://www.uscis.gov/sites/default/files/document/data/Appropriation_Requirement_November_2022.csv": report("November 2022", six="Six"),
        "https://www.uscis.gov/sites/default/files/document/data/appropriation_requirement_september_2026_v1.csv": report("September 2026"),
    }
    m.fetch = lambda url, **kw: (page_a.encode() if "immigration-and-citizenship-data" in url else files[url].encode())  # type: ignore[assignment]
    check("run: exits 0", m.main([]) == 0)
    n = db.scalar("SELECT count(*) FROM uscis_monthly_forms")
    check("run: every row of both months stored", int(n) == 2 * len(SEPT), str(n))
    check("run: a second run rewrites, never doubles", m.main([]) == 0 and int(db.scalar("SELECT count(*) FROM uscis_monthly_forms")) == 2 * len(SEPT))
    doc = read_doc(db, m.DOC)
    check("doc: the newest month and the months held", doc["newest"] == "2026-09" and doc["months"] == ["2022-11", "2026-09"], str(doc.get("months")))
    check("doc: the months USCIS doesn't list between them are named", "2023-03" in doc["missing"] and "2022-11" not in doc["missing"] and len(doc["missing"]) == 45, str(len(doc["missing"])))
    line = next(x for x in doc["lines"] if x["form"] == "I-485" and x["basis"] == "Employment")
    check("doc: a line carries every month's figures", [p["month"] for p in line["points"]] == ["2022-11", "2026-09"] and line["points"][-1]["denied"] == 1497, str(line["points"][-1]))
    fresh = db.scalar("SELECT as_of FROM data_freshness WHERE dataset = 'uscis-monthly-forms'")
    check("run: freshness is the newest month's last day", fresh == "2026-09-30", str(fresh))

    m.fetch = lambda url, **kw: (b"<p>nothing</p>" if "immigration-and-citizenship-data" in url else b"")  # type: ignore[assignment]
    refuses("run: a listing with nothing refuses, never reports success", lambda: m.main([]), "no monthly report")

    print(f"\n{len(FAILURES)} failure(s)" if FAILURES else "\nall passed")
    for f in FAILURES:
        print(f"  - {f}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())

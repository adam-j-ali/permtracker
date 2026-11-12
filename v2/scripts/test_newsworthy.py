#!/usr/bin/env python3
"""The newsworthy check: what counts as a move, and how each is said.

    python3 scripts/test_newsworthy.py
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import lib_newsworthy as nw  # noqa: E402

ET = ZoneInfo("America/New_York")
FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def ms(y: int, m: int, d: int, h: int = 12, mi: int = 0) -> int:
    return int(dt.datetime(y, m, d, h, mi, tzinfo=ET).timestamp() * 1000)


AC29 = {"rin": "1205-AC29", "title": "Modernizing the Labor Market Test and Improving Protections for U.S. Workers "
        "in the PERM Immigrant Visa Program (NPRM)", "agency": "DOL's Employment and Training Administration",
        "comments_close": None, "effective_on": None}


def reading(at: int, analyst: str, recon: str, pwd: str, perm_as_of: str, pwd_as_of: str) -> dict:
    return {"fetched_at": at, "snapshot": {
        "permAsOf": perm_as_of, "pwdAsOf": pwd_as_of,
        "permQueues": [{"queue": "Analyst Review", "priorityDate": analyst},
                       {"queue": "Audit Review", "priorityDate": "2025-12"},
                       {"queue": "Reconsideration Request to the CO", "priorityDate": recon}],
        "pwdQueues": [{"program": "PERM", "oewsReceiptDate": pwd, "nonOewsReceiptDate": pwd},
                      {"program": "H-1B", "oewsReceiptDate": "2026-01", "nonOewsReceiptDate": None}]}}


def weekdays(end: str, n: int, total: int) -> list[dict]:
    out, d = [], dt.date.fromisoformat(end)
    while len(out) < n:
        d -= dt.timedelta(days=1)
        if d.weekday() < 5:
            out.append({"date": d.isoformat(), "total": total})
    return out


def main() -> int:
    now = ms(2026, 10, 27, 20, 30)
    morning = ms(2026, 10, 27, 7, 0)

    # --- rules ---------------------------------------------------------------
    events = [
        {**AC29, "kind": "oira-completed", "on_date": "2026-10-23", "detail": "Consistent with Change", "seen_at": ms(2026, 10, 27, 9, 10)},
        {**AC29, "kind": "oira-received", "on_date": "2026-09-14", "detail": "Proposed Rule", "seen_at": ms(2026, 10, 27, 9, 10)},
        {**AC29, "rin": "1615-AD25", "title": "Amending the Premium Processing Timeframe", "agency": "USCIS",
         "kind": "oira-received", "on_date": "2026-10-26", "detail": "Proposed Rule", "seen_at": ms(2026, 10, 26, 17, 10)},
    ]
    items = nw.newsworthy(nw.Inputs(rule_events=events), morning, now)
    check("a step seen today and dated this week is news; one dated in September isn't, though seen today",
          [i["what"] for i in items] == [
              'OIRA finished its review of "Modernizing the Labor Market Test and Improving Protections for U.S. '
              'Workers in the PERM Immigrant Visa Program" on Oct 23, 2026. Its decision: "Consistent with Change".'],
          str([i["what"] for i in items]))
    check("a step seen before the window isn't repeated", all("Premium" not in i["what"] for i in items))
    check("each line says the source", nw.line(items[0]).endswith("Source: OIRA's review lists on reginfo.gov."))
    check("the sentence matches the site's wording for a received rule",
          nw.rule_sentence(events[2]) == 'USCIS sent "Amending the Premium Processing Timeframe" to OIRA for review on Oct 26, 2026 (proposed rule).')

    # --- DOL's months --------------------------------------------------------
    r1 = reading(ms(2026, 10, 2, 3), "2025-12", "2026-04", "2026-05", "2026-09-22", "2026-08-31")
    r2 = reading(ms(2026, 10, 27, 15), "2026-01", "2026-05", "2026-06", "2026-10-26", "2026-10-26")
    dol = nw.newsworthy(nw.Inputs(readings=[r1, r2]), morning, now)
    whats = [i["what"] for i in dol]
    check("analyst review, reconsideration and the PERM wage requests moving are each news",
          any("analyst review moved: DOL is reviewing cases filed in January 2026, up from December 2025" in w for w in whats)
          and any("reconsideration review moved" in w for w in whats)
          and any("PERM wage requests (OEWS) moved: DOL is issuing determinations on requests filed in June 2026" in w for w in whats)
          and not any("audit" in w for w in whats) and not any("H-1B" in w for w in whats), str(whats))
    check("an older reading isn't news again", nw.newsworthy(nw.Inputs(readings=[r1, r2]), ms(2026, 10, 27, 16), now) == [])
    back = reading(ms(2026, 10, 27, 15), "2025-11", "2026-04", "2026-05", "2026-10-26", "2026-08-31")
    check("a month going back is said as going back", any("went back" in i["what"] for i in
                                                         nw.newsworthy(nw.Inputs(readings=[r1, back]), morning, now)))

    # --- the bulletin --------------------------------------------------------
    b = nw.newsworthy(nw.Inputs(bulletins=[{"bulletin_month": "2026-12", "first_seen_at": ms(2026, 10, 27, 9, 12)},
                                           {"bulletin_month": "2026-11", "first_seen_at": ms(2026, 10, 9, 9, 12)}]), morning, now)
    check("a bulletin first held today is news, with the time", [i["what"] for i in b] ==
          ["The December 2026 visa bulletin is out; this site first held it at 9:12 AM EDT Oct 27."], str(b))

    # --- employers -----------------------------------------------------------
    stages = {"holdMoves": [
        {"date": "2026-10-27", "name": "Microsoft Corporation", "dir": "on", "to": "APPLICATION ON HOLD", "n": 598},
        {"date": "2026-10-27", "name": "Small Co", "dir": "on", "to": "APPLICATION ON HOLD", "n": 8},
        {"date": "2026-10-20", "name": "Old Co", "dir": "on", "to": "APPLICATION ON HOLD", "n": 400}],
        "decisionMoves": [{"date": "2026-10-27", "name": "Upshift Work LLC", "to": "CERTIFIED", "n": 61},
                          {"date": "2026-10-27", "name": "By the Sea", "to": "WITHDRAWN", "n": 19}]}
    e = [i["what"] for i in nw.newsworthy(nw.Inputs(employer_stages=stages), morning, now)]
    check("big employer moves today are news, small and old ones aren't", e == [
        "DOL put 598 of Microsoft Corporation's PERM cases on hold on Oct 27, 2026.",
        "DOL certified 61 of Upshift Work LLC's PERM cases in one day, Oct 27, 2026."], str(e))

    # The day in the words is the day DOL worked. A batch the 4 AM pass recorded on a holiday morning is the
    # evening before's work: "certified ... Nov 11" on Veterans Day 2026 was wrong by a day.
    overnight = {"holdMoves": [
        {"date": "2026-10-27", "worked": ["2026-10-26"], "name": "Microsoft Corporation", "dir": "on", "to": "APPLICATION ON HOLD", "n": 598}],
        "decisionMoves": [
            {"date": "2026-10-27", "worked": ["2026-10-26"], "name": "Upshift Work LLC", "to": "CERTIFIED", "n": 61},
            {"date": "2026-10-27", "worked": ["2026-10-26", "2026-10-27"], "name": "Two Day Co", "to": "DENIED", "n": 80}]}
    o = [i["what"] for i in nw.newsworthy(nw.Inputs(employer_stages=overnight), morning, now)]
    check("a move is worded with the day DOL worked, and a batch across two days says both", o == [
        "DOL put 598 of Microsoft Corporation's PERM cases on hold on Oct 26, 2026.",
        "DOL certified 61 of Upshift Work LLC's PERM cases in one day, Oct 26, 2026.",
        "DOL denied 80 of Two Day Co's PERM cases over Oct 26, 2026 and Oct 27, 2026."], str(o))

    # --- a decision day ------------------------------------------------------
    days = weekdays("2026-10-27", 25, 700) + [{"date": "2026-10-27", "total": 1500}]
    d = [i["what"] for i in nw.newsworthy(nw.Inputs(decision_days=days), morning, now)]
    check("a weekday at twice the typical is news", d == [
        "Our sweep recorded 1,500 PERM decisions on Oct 27, 2026, 2.1 times a typical weekday (700)."], str(d))
    days[-1] = {"date": "2026-10-27", "total": 1390}
    check("just under twice isn't", nw.newsworthy(nw.Inputs(decision_days=days), morning, now) == [])
    weekend = weekdays("2026-10-25", 25, 700) + [{"date": "2026-10-25", "total": 5000}]
    check("a weekend day is never compared with weekdays", nw.newsworthy(nw.Inputs(decision_days=weekend), ms(2026, 10, 25, 1), now) == [])
    check("too short a history says nothing", nw.typical_weekday(weekdays("2026-10-27", 5, 700), "2026-10-27") is None)

    # --- the same words as the site ------------------------------------------
    fx = json.loads((HERE / "fixtures" / "rule_step_sentences.json").read_text())
    for c in fx["cases"]:
        r = c.get("rule") or fx["rule"]
        e = {"rin": r["rin"], "title": r["title"], "agency": r["agency"], "comments_close": r["commentsClose"],
             "effective_on": r["effectiveOn"], "kind": c["event"]["kind"], "on_date": c["event"]["onDate"],
             "detail": c["event"]["detail"]}
        check(f"worded as the site words it: {c['event']['kind']} {c['event']['detail']}", nw.rule_sentence(e) == c["sentence"],
              nw.rule_sentence(e))

    # --- together ------------------------------------------------------------
    allin = nw.newsworthy(nw.Inputs(rule_events=events, readings=[r1, r2], employer_stages=stages, decision_days=days), morning, now)
    check("newest first, and every line has a date and a source",
          [i["when"] for i in allin] == sorted([i["when"] for i in allin], reverse=True)
          and all(re.search(r"\d{4}", nw.line(i)) and "Source: " in nw.line(i) for i in allin))
    check("nothing moved is an empty list", nw.newsworthy(nw.Inputs(), morning, now) == [])

    # --- documents and announcements (Oct 27 2026) ---------------------------
    seen = ms(2026, 10, 27, 9, 30)
    docs = [
        {"document_number": "2026-22001", "publication_date": "2026-10-28", "type": "Rule",
         "title": "Temporary Increase in H-2B Nonimmigrant Visas", "agencies": '["Homeland Security Department"]',
         "source": "public-inspection", "status": "public-inspection", "pi_filed": "2026-10-27", "first_seen_at": seen},
        {"document_number": "wh-2026-10-x", "publication_date": "2026-10-27", "type": "Presidential action",
         "title": "Restriction on Entry of Certain Nonimmigrant Workers", "agencies": [], "source": "white-house",
         "action": "Proclamation", "first_seen_at": seen},
        {"document_number": "uscis-old", "publication_date": "2026-03-01", "type": "USCIS announcement",
         "title": "An old release a first run loaded", "source": "uscis-news", "first_seen_at": seen},
        {"document_number": "2026-99901", "publication_date": "2026-10-27", "type": "Proposed Rule",
         "title": "A rule the rule watch follows", "source": "federal-register", "first_seen_at": seen},
        {"document_number": "oflc-early", "publication_date": "2026-10-27", "type": "OFLC announcement",
         "title": "Seen before the window", "source": "oflc", "first_seen_at": morning - 1},
    ]
    got = nw.newsworthy(nw.Inputs(documents=docs, rule_documents={"2026-99901"}), morning, now)
    words = [i["what"] for i in got]
    check("a filing for public inspection is news, with both its days",
          any("DHS filed a rule for public inspection on Oct 27, 2026, to be published Oct 28, 2026" in w for w in words), str(words))
    check("a White House action is news", any(w.startswith("The White House posted a proclamation on Oct 27, 2026") for w in words), str(words))
    check("an old document a first run loaded isn't", not any("old release" in w for w in words))
    check("a rule the rule watch already reports isn't repeated", not any("rule watch follows" in w for w in words))
    check("a document seen before the window isn't", not any("before the window" in w for w in words))
    check("each names its source", all(nw.line(i).endswith(("public inspection list.", "whitehouse.gov.")) for i in got),
          str([nw.line(i) for i in got]))

    # --- State Department news and bills in Congress ---------------------------
    st = {"document_number": "state-x", "publication_date": "2026-10-27", "type": "State Department visa news",
          "title": "Visa Bond Pilot Program Expanded", "source": "state-news", "first_seen_at": seen}
    old_bill = {"document_number": "bill-119-hr-2315", "publication_date": "2025-03-25", "type": "Bill",
                "title": "Fairness for High-Skilled Americans Act of 2025", "source": "congress",
                "action": "Passed House.", "dates": "2026-10-27", "first_seen_at": morning - 86_400_000 * 30,
                "fetched_at": seen}
    quiet_bill = dict(old_bill, document_number="bill-119-s-1233", fetched_at=morning - 1)
    backfilled = dict(old_bill, document_number="bill-119-s-2759", dates="2025-09-10", first_seen_at=seen)
    got = nw.newsworthy(nw.Inputs(documents=[st, old_bill, quiet_bill, backfilled]), morning, now)
    words = [nw.line(i) for i in got]
    check("State Department news is worded as the State Department's",
          "The State Department posted visa news on Oct 27, 2026: \"Visa Bond Pilot Program Expanded\". "
          "Source: the State Department's newsroom." in words, str(words))
    check("a bill introduced long ago is news the day it moves",
          'H.R. 2315, "Fairness for High-Skilled Americans Act of 2025", moved on Oct 27, 2026: Passed House. '
          "Source: congress.gov." in words, str(words))
    check("a bill nothing happened to in the window isn't", not any("S. 1233" in w for w in words), str(words))
    check("a backfill's old action isn't", not any("S. 2759" in w for w in words), str(words))
    court = {"document_number": "cl-1", "publication_date": "2026-10-26", "type": "Court opinion",
             "title": "E. v. U.S. Department of State", "agencies": '["District Court, District of Columbia"]',
             "source": "courtlistener", "first_seen_at": seen}
    balca = {"document_number": "balca-x", "publication_date": "2026-10-23", "type": "BALCA decision",
             "title": "Acme Farms LLC, 2026-TLC-00012", "agencies": '["Board of Alien Labor Certification Appeals"]',
             "source": "balca", "first_seen_at": seen}
    words = [nw.line(i) for i in nw.newsworthy(nw.Inputs(documents=[court, balca]), morning, now)]
    check("a court opinion names the court",
          'A federal court (District Court, District of Columbia) decided "E. v. U.S. Department of State" on Oct 26, 2026. '
          "Source: CourtListener." in words, str(words))
    check("a BALCA decision names BALCA",
          'BALCA decided "Acme Farms LLC, 2026-TLC-00012" on Oct 23, 2026. Source: OALJ\'s caselists.' in words, str(words))
    doj = {"document_number": "ier-1465571", "publication_date": "2026-10-26", "type": "Justice Department action",
           "title": "Settlement with LanceSoft, Inc.", "agencies": '["Justice Department"]',
           "source": "doj", "first_seen_at": seen}
    ocaho = {"document_number": "ocaho-2026B00044", "publication_date": "2026-10-25", "type": "Justice Department action",
             "title": "United States v. Cloudera, Inc. (OCAHO case 2026B00044)", "agencies": '["Justice Department"]',
             "source": "doj", "first_seen_at": seen}
    words = [nw.line(i) for i in nw.newsworthy(nw.Inputs(documents=[doj, ocaho]), morning, now)]
    check("a DOJ settlement names the Justice Department",
          'The Justice Department posted "Settlement with LanceSoft, Inc." on Oct 26, 2026. '
          "Source: the Justice Department's releases and IER's settlements list." in words, str(words))
    check("an OCAHO case is dated by its newest order",
          any(w.startswith('OCAHO\'s newest order in "United States v. Cloudera') for w in words), str(words))
    embassy = {"document_number": "embassy-ph-august-18-consular-operations-update", "publication_date": "2026-10-26",
               "type": "Embassy notice", "title": "Consular Operations Update", "agencies": '["U.S. Embassy in the Philippines"]',
               "source": "embassies", "first_seen_at": seen}
    words = [nw.line(i) for i in nw.newsworthy(nw.Inputs(documents=[embassy]), morning, now)]
    check("an embassy notice names its embassy",
          'The U.S. Embassy in the Philippines posted a visa notice on Oct 26, 2026: "Consular Operations Update". '
          "Source: the embassy's own Visas feed." in words, str(words))
    words = [nw.line(i) for i in nw.newsworthy(nw.Inputs(debarments=[
        {"program": "PERM", "entity": "Acme Staffing LLC", "start_date": "2026-10-20", "end_date": "2029-10-19", "first_seen_at": seen},
        {"program": "H-2A", "entity": "Old Farm", "start_date": "2024-01-01", "end_date": "2027-01-01", "first_seen_at": 0},
    ]), morning, now)]
    check("a debarment new to DOL's lists is news, with its dates",
          "DOL's PERM debarment list added Acme Staffing LLC, barred from Oct 20, 2026 to Oct 19, 2029. "
          "Source: DOL's debarment lists." in words, str(words))
    check("one held before the record began isn't", not any("Old Farm" in w for w in words), str(words))
    shared = json.loads((HERE / "fixtures" / "bill_numbers.json").read_text())["cases"]
    check("bill numbers match the site's", all(nw.bill_number(k) == v for k, v in shared.items()),
          str({k: nw.bill_number(k) for k in shared}))

    # --- a new Unified Agenda edition: one line, not one per rule -------------
    ag_seen = ms(2026, 10, 27, 9, 30)
    agenda = [{"rin": f"1615-AD{i:02d}", "kind": "agenda", "on_date": "2026-10-24", "seen_at": ag_seen,
               "title": f"Rule {i}", "agency": "USCIS",
               "detail": '{"action": "NPRM", "date": "12/00/2026", "edition": "Fall 2026", "stage": "Proposed Rule Stage"}'}
              for i in range(12)]
    old_ed = [{**agenda[0], "rin": "1205-AC29", "on_date": "2026-07-03"}]
    got = nw.newsworthy(nw.Inputs(rule_events=agenda + old_ed), morning, now)
    lines = [i["what"] for i in got]
    check("a new agenda edition is one line", len(lines) == 1, str(lines))
    check("it counts the edition's rules and names three",
          bool(lines) and lines[0].startswith("The Fall 2026 Unified Agenda, dated Oct 24, 2026, sets a timetable for 12 rules")
          and lines[0].count('"') == 6 and "and 9 more" in lines[0], str(lines))
    check("an older edition seen today isn't news", not any("1205-AC29" in w or "Jul 3" in w for w in lines), str(lines))
    check("its source is the agenda", bool(got) and got[0]["source"] == "reginfo.gov's Unified Agenda", str(got))

    # A followed rule published: the evening check names the articles whose text needs the document.
    pub = {"rin": "1205-AC29", "kind": "proposed-published", "on_date": "2026-10-27", "detail": "91 FR 70000",
           "seen_at": ms(2026, 10, 27, 12), "title": "Modernizing the Labor Market Test (NPRM)", "agency": "DOL",
           "comments_close": "2026-12-28", "effective_on": None}
    got = nw.newsworthy(nw.Inputs(rule_events=[pub], articles={"1205-AC29": ["/blog/proposed-perm-rule-rin-1205-ac29"]}), morning, now)
    check("a published rule names the article to update",
          len(got) == 1 and "update /blog/proposed-perm-rule-rin-1205-ac29" in got[0]["what"])
    review = dict(pub, kind="oira-completed", detail="Consistent with Change")
    got = nw.newsworthy(nw.Inputs(rule_events=[review], articles={"1205-AC29": ["/blog/x"]}), morning, now)
    check("a review step names no article: the status updates itself", len(got) == 1 and "update" not in got[0]["what"])
    found = nw.articles_by_rin()
    check("the real article is found by its RIN", "/blog/proposed-perm-rule-rin-1205-ac29" in found.get("1205-AC29", []))
    check("a compared rule is found too", "/blog/proposed-perm-rule-rin-1205-ac29" in found.get("1205-AC30", []))

    # A Policy Manual chapter USCIS changed: the line names the articles that cite that chapter, so the text
    # gets read against the change (the "definition of day" update sat 18 days before a guide said it, Nov 10 2026).
    pm_seen = ms(2026, 10, 27, 9, 30)
    by_link = {"document_number": "uscis-pm-2026-10-27-a", "publication_date": "2026-10-27", "type": "Policy Manual update",
               "title": "Definition of Day for Purposes of Filing Deadlines", "source": "uscis-policy-manual",
               "html_url": "https://www.uscis.gov/policy-manual/volume-1-part-b-chapter-6", "citation": "1 USCIS-PM B.6",
               "action": "Technical update", "first_seen_at": pm_seen}
    by_cite = {"document_number": "uscis-pm-2026-10-27-b", "publication_date": "2026-10-27", "type": "Policy Manual update",
               "title": "Fee Guidance for L-1 Intracompany Transferees", "source": "uscis-policy-manual",
               "html_url": "https://www.uscis.gov/sites/default/files/document/policy-manual-updates/20261027-Fees.pdf",
               "citation": "2 USCIS-PM L.7", "action": "Policy alert", "first_seen_at": pm_seen}
    uncited = dict(by_link, document_number="uscis-pm-2026-10-27-c", title="A chapter no article cites",
                   html_url="https://www.uscis.gov/policy-manual/volume-9-part-z-chapter-9", citation="9 USCIS-PM Z.9")
    cites = {"volume-1-part-b-chapter-6": ["/blog/rule-changes-since-august-2026", "/guides/eta-9089-expiration-and-i140-deadline"],
             "volume-2-part-l-chapter-7": ["/guides/l1-fees"]}
    got = nw.newsworthy(nw.Inputs(documents=[by_link, by_cite, uncited], chapter_articles=cites), morning, now)
    words = {i["what"].split(":")[0] + "|" + i["what"] for i in got}
    day_line = next((w for w in words if "Definition of Day" in w), "")
    fee_line = next((w for w in words if "Fee Guidance" in w), "")
    bare_line = next((w for w in words if "no article cites" in w), "")
    check("a changed chapter names the articles that cite it, by the chapter's address",
          "/blog/rule-changes-since-august-2026, /guides/eta-9089-expiration-and-i140-deadline" in day_line
          and "check" in day_line, day_line)
    check("a policy alert whose link is a PDF is matched by its citation", "/guides/l1-fees" in fee_line, fee_line)
    check("a chapter no article cites names none", bool(bare_line) and "/guides/" not in bare_line and "/blog/" not in bare_line, bare_line)
    check("the chapter is read from the link, then from the citation, else there is none",
          nw.chapter_of(by_link) == "volume-1-part-b-chapter-6" and nw.chapter_of(by_cite) == "volume-2-part-l-chapter-7"
          and nw.chapter_of({"html_url": "https://www.uscis.gov/newsroom/alerts/x", "citation": "7 USCIS-PM A"}) is None)
    held = nw.articles_by_chapter()
    check("the real articles are found by the chapter they link",
          "/guides/eta-9089-expiration-and-i140-deadline" in held.get("volume-6-part-e-chapter-6", [])
          and "/guides/eta-9089-expiration-and-i140-deadline" in held.get("volume-1-part-b-chapter-6", []), str(sorted(held)))

    # A Register document that touches a part of the CFR: the line names the articles that cite the part, the ones
    # that cite it most first, and counts the rest. Nothing in an article updates itself when its part is amended.
    amend = {"document_number": "2026-30001", "publication_date": "2026-10-27", "type": "Proposed Rule",
             "title": "Changes to the Labor Certification Process", "agencies": ["Employment and Training Administration"],
             "source": "federal-register", "status": "published", "first_seen_at": pm_seen}
    plain = dict(amend, document_number="2026-30002", title="A rule on parts no article cites")
    cfr_cites = {"20 CFR 656": [f"/guides/g{i}" for i in range(1, 8)], "20 CFR 655": ["/guides/h2a"]}
    parts = {"2026-30001": "20 CFR 655; 20 CFR 656", "2026-30002": "8 CFR 106", "2026-30003": "20 CFR 656"}
    got = nw.newsworthy(nw.Inputs(documents=[amend, plain], cfr_articles=cfr_cites, cfr_by_document=parts), morning, now)
    amend_line = next((i["what"] for i in got if "Labor Certification Process" in i["what"]), "")
    plain_line = next((i["what"] for i in got if "no article cites" in i["what"]), "")
    check("a document names the articles that cite each part it touches, most-citing first, and counts the rest",
          amend_line.endswith(" It touches 20 CFR part 655 (/guides/h2a); 20 CFR part 656 (/guides/g1, /guides/g2, "
                              "/guides/g3, /guides/g4, /guides/g5, and 2 more): read it and check what those articles say."),
          amend_line)
    check("a document whose parts no article cites names none", bool(plain_line) and "It touches" not in plain_line, plain_line)
    got = nw.newsworthy(nw.Inputs(documents=[amend], cfr_articles=cfr_cites), morning, now)
    check("a document the feed holds no parts for names none, and is still news",
          len(got) == 1 and "It touches" not in got[0]["what"], str(got))
    # A followed rule's own text step: its RIN's pages first, then the OTHER articles that cite the parts it touches.
    step = dict(pub, proposed_document="2026-30003", pi_document=None, final_document=None)
    got = nw.newsworthy(nw.Inputs(rule_events=[step], articles={"1205-AC29": ["/guides/g1"]}, cfr_articles=cfr_cites,
                                  cfr_by_document=parts), morning, now)
    rule_line = got[0]["what"] if got else ""
    check("a followed rule names its own page once, then the other articles citing its parts",
          "update /guides/g1:" in rule_line and rule_line.count("/guides/g1,") == 0
          and "20 CFR part 656 (/guides/g2, /guides/g3, /guides/g4, /guides/g5, /guides/g6, and 1 more)" in rule_line, rule_line)
    got = nw.newsworthy(nw.Inputs(rule_events=[dict(step, kind="oira-completed", detail="Consistent with Change")],
                                  articles={"1205-AC29": ["/guides/g1"]}, cfr_articles=cfr_cites, cfr_by_document=parts), morning, now)
    check("a step with no new text names no articles by part", len(got) == 1 and "It touches" not in got[0]["what"], str(got))
    # The Register listed part 274 for the rule that amended 8 CFR 274a.13 (2026-20955): a part matches with or
    # without its letter, and the line names it the way the articles cite it.
    ead = {"8 CFR 274a": ["/guides/ead-renewal"], "8 CFR 214": ["/guides/h1b"]}
    check("a part the Register lists without its letter still names the articles that cite it with one",
          nw.cfr_sentence(["8 CFR 274"], ead) == " It touches 8 CFR part 274a (/guides/ead-renewal): read it and check what those articles say.",
          nw.cfr_sentence(["8 CFR 274"], ead))
    check("and the other way round, each cited part once",
          nw.cfr_sentence(["8 CFR 274a", "8 CFR 274"], {"8 CFR 274": ["/guides/a"], "8 CFR 274a": ["/guides/b"]})
          == " It touches 8 CFR part 274 (/guides/a); 8 CFR part 274a (/guides/b): read it and check what those articles say.")
    check("a part is never matched by a longer number", nw.cfr_sentence(["8 CFR 27"], ead) == "" and nw.cfr_sentence(["8 CFR 2740"], ead) == "")
    check("the stored parts read back one by one",
          nw.cfr_parts_of("8 CFR 274a; 20 CFR 655; 20 CFR 656") == ["8 CFR 274a", "20 CFR 655", "20 CFR 656"]
          and nw.cfr_parts_of(None) == [] and nw.cfr_parts_of("") == [])
    held_parts = nw.articles_by_cfr_part()
    check("the real articles are found by the parts they cite, by eCFR address and in words",
          "/guides/h2a-case-status-and-timing" in held_parts.get("20 CFR 655", [])
          and "/guides/ead-renewal-no-automatic-extension" in held_parts.get("8 CFR 274a", [])
          and "/blog/h1b-sponsors-layoff-notices-october-2026" in held_parts.get("20 CFR 639", []), str(sorted(held_parts)))
    check("a release note is a dated record and is never named",
          not any(page.startswith("/changelog/") for pages in held_parts.values() for page in pages))
    import tempfile  # noqa: PLC0415
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        (root / "guides").mkdir()
        (root / "changelog").mkdir()
        (root / "guides" / "twice.mdx").write_text(
            "See [the rule](https://www.ecfr.gov/current/title-20/chapter-V/part-656/subpart-C/section-656.17) and 20 CFR 656.40, "
            "8 CFR \u00a7 274a.12(c)(9), [8 CFR 204.5](https://www.ecfr.gov/current/title-8/section-204.5) and 20 CFR part 655.")
        (root / "guides" / "once.mdx").write_text("Only 20 CFR 656.10 here, and 2026 CFRs aren't a citation.")
        (root / "changelog" / "note.mdx").write_text("20 CFR 656.17 shipped.")
        found = nw.articles_by_cfr_part(root)
    check("a part's articles are ordered by how often each cites it; sections fold into their part",
          found == {"20 CFR 656": ["/guides/twice", "/guides/once"], "8 CFR 274a": ["/guides/twice"],
                    "8 CFR 204": ["/guides/twice"], "20 CFR 655": ["/guides/twice"]}, str(found))

    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())


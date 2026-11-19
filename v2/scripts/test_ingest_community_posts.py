"""The community posts loader (scripts/ingest_community_posts.py): what it keeps, what it never keeps, what it refuses.

Every row here is made up. Run: python3 scripts/test_ingest_community_posts.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ingest_community_posts as icp  # noqa: E402
import lib_reported_cases as rc  # noqa: E402


def row(**f) -> dict:
    base = {"source_id": "c123", "kind": "comment", "subreddit": "USCIS_EB3", "created_utc": "2026-11-04T15:00:00Z",
            "author_hash": "abc123def456", "category": "EB3", "priority_date": "2023-07-10", "receipt_date": "2026-03-06",
            "transfer_to_sfv_date": "2026-09-24", "approval_date": "2026-11-03", "ead_ap_date": "2026-05-01",
            "biometrics_date": "2026-03-31", "i485j_approval_date": None, "interview": "unknown",
            "quote_short": "approved today", "notes": "a note", "permalink": "/r/x/comments/1/y/c123/",
            "confidence": "high", "sfv_basis": "explicit"}
    return {**base, **f}


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    r = icp.reddit_record(row(), salt="s")
    check(r["source"] == "reddit" and r["key"] == "c123" and r["office"] == "SFV", "a Reddit row is a San Fernando record")
    check(r["category"] == "EB-3" and r["i485_receipt"] == "2026-03-06" and r["transfer"] == "2026-09-24", "its category and days")
    check(r["i485_decided"] == "2026-11-03" and r["i485_decision"] == "approved", "an approval day is an approval")
    check(r["ead"] == "2026-05-01" and r["biometrics"] == "2026-03-31", "the work permit and biometrics")
    check(r["as_of"] == "2026-11-04", "as of the day it was posted, an Eastern day")
    check(r["person"] != "abc123def456" and len(r["person"]) == 16, "the author link is salted again")
    check(icp.reddit_record(row(), salt="s")["person"] == r["person"], "the same person gets the same link")
    check(icp.reddit_record(row(), salt="t")["person"] != r["person"], "another salt gives another link")
    text = json.dumps(r)
    for never in ("approved today", "a note", "/r/x/", "abc123def456", "USCIS_EB3"):
        check(never not in text, f"never kept: {never}")
    rc.check_record({k: v for k, v in r.items() if v is not None})
    check(True, "the record passes the merge's own check")

    check(icp.reddit_record(row(category="EB2-NIW"), salt="s")["category"] == "EB-2 NIW", "EB2-NIW is EB-2 NIW")
    check(icp.reddit_record(row(category="unknown"), salt="s")["category"] is None, "an unknown category is left blank")
    check(icp.reddit_record(row(category="family"), salt="s")["category"] == "Family", "a family case is marked as one")
    check(icp.reddit_record(row(approval_date="2026"), salt="s")["i485_decided"] is None, "a year alone is no day")
    check(icp.reddit_record(row(transfer_to_sfv_date="2026-09"), salt="s")["transfer"] == "2026-09", "a month is kept")
    check(icp.reddit_record(row(approval_date=None), salt="s")["i485_decision"] is None, "no approval day: no decision")
    check(icp.reddit_record(row(transfer_to_sfv_date="9/24/2026"), salt="s")["transfer"] is None, "a date it can't read is dropped")

    rows, counts = icp.prepare([row(), row(source_id="c124", author_hash="zzz"), row(source_id="c124")], salt="s")
    check(len(rows) == 2 and counts["repeated_ids"] == 1, f"one row per post or comment: {counts}")
    try:
        icp.prepare([row(author_hash=None)], salt="s")
        check(False, "refuses a row with no author link")
    except ValueError:
        check(True, "refuses a row with no author link")
    try:
        icp.prepare([row()], salt="")
        check(False, "refuses an empty salt")
    except ValueError:
        check(True, "refuses an empty salt")

    # A chat post's record (_record): the readers outside this repository parse each post and hand its fields here, so
    # the record's key, its office and its category are made by this one function.
    def msg(i, text, sender="s1"):
        return {"id": i, "date": "2026-11-04T15:00:00+00:00", "sender": sender, "reply_to": None, "text": text}

    day = dt.date(2026, 11, 4)
    gc = {"i485_receipt": "2025-10-14", "i485_decided": "2026-11-03", "i485_decision": "approved"}
    rec = icp._record("a-chat", msg(1, "I-485 RD 10/14/2025, GC approved 11/03/2026"), day, {"kind": "i485"}, gc)
    check(rec["source"] == "telegram" and rec["key"] == "a-chat:1" and rec["person"] == "s1"
          and rec["as_of"] == "2026-11-04", f"a chat post is keyed by its chat and id, linked by the reader's salted sender: {rec}")
    check("I-485" not in json.dumps(rec), "no text kept")
    check(icp.post_key("reddit", "USCIS_EB3", "c41") == "c41" and icp.post_key("whatsapp", "wa1", 7) == "wa1:7",
          "a Reddit item's key is its own id; any other post's is its chat and id")
    named = icp._record("USCIS_EB3", msg(51, "I-485 RD 10/14/2025, transferred to Santa Ana FO, GC approved 11/03/2026"),
                        day, {"kind": "mixed"}, gc, "reddit")
    check(named.get("office") == "SAA" and named["key"] == "51", f"a post naming its office counts there: {named}")
    perm_only = icp._record("a-chat", msg(52, "Perm certified today, my lawyer is near Tampa FO"), day, {"kind": "perm"},
                            {"perm_filed": "2025-01-02", "perm_decided": "2026-11-04", "perm_decision": "approved"})
    check("office" not in perm_only, f"a PERM post never gets an office: {perm_only}")
    kept = icp._record("an-office", msg(53, "I485 RD 10/14/2025 transferred to Tampa FO, GC approved 11/03/2026"), day,
                       {"kind": "i485", "office": "SFV"}, gc)
    check(kept.get("office") == "SFV", f"an office's own chat keeps its office: {kept}")
    marriage = icp._record("USCIS", msg(54, "Marriage based AOS. I-485 RD 10/14/2025, GC approved 11/03/2026"), day,
                           {"kind": "mixed"}, gc, "reddit")
    check(marriage.get("category") == "Family", f"a marriage case is marked Family: {marriage}")
    eb = icp._record("USCIS", msg(55, "Through PERM. After our marriage my wife joined as a derivative. I-485 RD "
                                      "10/14/2025, GC approved 11/03/2026"), day, {"kind": "mixed"}, gc, "reddit")
    check(eb.get("category") != "Family", f"an employment case that names a spouse isn't Family: {eb}")
    try:
        icp._record("a-chat", msg(56, "x"), day, {"kind": "perm"}, {"perm_decided": "11/04/2026"})
        check(False, "refuses a field the merge can't read")
    except ValueError:
        check(True, "refuses a field the merge can't read")


    # Posts typed in by hand (Facebook groups): each row keeps only the merge's own fields, so the group's name, the
    # notes and anything else typed beside them never leave the machine they were typed on.
    def hand(**f) -> dict:
        base = {"source_id": "fb-1", "author_hash": "a1b2c3", "posted": "2026-11-18",
                "group": "EB3 India green card friends", "notes": "so happy, thanks everyone", "screenshot": "IMG_2041.png",
                "category": "eb3", "office": "Queens", "chargeability": "India", "priority_date": "2023-02-14",
                "i485_receipt": "2025-10-01", "interview": "2026-11-10", "i485_decided": "2026-11-18",
                "i485_decision": "approved"}
        return {**base, **f}

    def doc(*rows, source="facebook") -> dict:
        return {"meta": {"source": source, "typed": "2026-11-20"}, "rows": list(rows)}

    got, counts = icp.prepare_hand_read(doc(hand()), salt="s")
    fb = got[0]
    check(fb["source"] == "facebook" and fb["key"] == icp.person_link("post:fb-1", "s") and fb["as_of"] == "2026-11-18",
          f"a typed row is a Facebook record, keyed by its post's salted id, as of the day it was posted: {fb}")
    check(fb["person"] == icp.person_link("a1b2c3", "s") and fb["person"] != "a1b2c3", "its author link is salted again")
    check(fb["i485_receipt"] == "2025-10-01" and fb["interview"] == "2026-11-10" and fb["i485_decided"] == "2026-11-18"
          and fb["i485_decision"] == "approved" and fb["priority_date"] == "2023-02-14" and fb["chargeability"] == "India",
          "its dates, decision and country are kept")
    check(fb["category"] == "EB-3", f"a category written as the map's key reads as the merge's: {fb.get('category')}")
    check(fb["office"] == "QNS", f"an office written by name is its code (Queens is QNS): {fb.get('office')}")
    check(set(fb) <= set(rc.FIELDS) | {"source", "key", "person", "as_of"}, f"only the merge's fields: {sorted(fb)}")
    text = json.dumps(got)
    for never in ("EB3 India green card friends", "so happy", "IMG_2041", "a1b2c3", "group", "notes", "screenshot", "fb-1"):
        check(never not in text, f"never kept from a typed row: {never}")
    check(counts["rows"] == 1 and counts["records"] == 1, f"counted: {counts}")
    check(icp.prepare_hand_read(doc(hand(office="SFV")), salt="s")[0][0]["office"] == "SFV", "an office code stays")
    check(icp.prepare_hand_read(doc(hand(category="EB-2 NIW")), salt="s")[0][0]["category"] == "EB-2 NIW",
          "a category already in the merge's words stays")
    check("office" not in icp.prepare_hand_read(doc(hand(office="")), salt="s")[0][0], "a blank office is no office")
    h1b = {"source_id": "fb-2", "author_hash": "z9", "posted": "2026-04-02", "group": "H1B lottery 2026",
           "h1b_filed": "2026-03-20", "h1b_decided": "2026-04-01", "h1b_decision": "approved", "chargeability": "India",
           "nonimmigrant_status": "F-1 STEM OPT"}
    only_h1b = icp.prepare_hand_read(doc(h1b), salt="s")[0]
    check(only_h1b and only_h1b[0]["h1b_decided"] == "2026-04-01" and only_h1b[0]["nonimmigrant_status"] == "F-1 STEM OPT"
          and "office" not in only_h1b[0] and "group" not in only_h1b[0], f"an H-1B-only row is a record: {only_h1b}")

    def refused(what: str, d: dict, salt: str = "s") -> None:
        try:
            icp.prepare_hand_read(d, salt=salt)
            check(False, f"refuses {what}")
        except ValueError as e:
            check(True, f"refuses {what} ({str(e)[:70]})")

    refused("an office it can't name", doc(hand(office="Springfield")))
    refused("a source not read by hand", doc(hand(), source="reddit"))
    refused("a file that doesn't say its source", {"rows": [hand()]})
    refused("a category it doesn't know", doc(hand(category="EB-9")))
    refused("a repeated post", doc(hand(), hand(category="EB-2")))
    refused("a row with no author link", doc(hand(author_hash="")))
    refused("a row with no post id", doc(hand(source_id=None)))
    refused("a posted day it can't read", doc(hand(posted="11/18/2026")))
    refused("a date the merge can't read", doc(hand(interview="Nov 10")))
    refused("an empty salt", doc(hand()), salt="")
    # Only words from closed lists reach the merge from a typed row, so nothing typed beside a date (a name, a phone
    # number, a firm) can reach a page; and a value the build can't read never gets as far as the build.
    def one(**f) -> dict:
        return icp.prepare_hand_read(doc(hand(**f)), salt="s")[0][0]

    check(one(chargeability="Zimbabwe")["chargeability"] == "Zimbabwe", "a country with a US visa post is kept")
    check(one(chargeability="zimbabwe")["chargeability"] == "Zimbabwe", "a country is stored in its printed form")
    check(one(chargeability="ROW")["chargeability"] == "ROW", "rest of world stays as the merge reads it")
    check(one(chargeability="Ivory Coast")["chargeability"] == "Côte d'Ivoire", "a second name is the first name")
    check(one(chargeability="China")["chargeability"] == "China", "China is China, never Hong Kong")
    check(one(nonimmigrant_status="J-2")["nonimmigrant_status"] == "J-2", "a status on the list is kept")
    check(one(nonimmigrant_status="f-1 stem opt")["nonimmigrant_status"] == "F-1 STEM OPT",
          "a status is stored in its printed form")
    check(one(visa_available=True)["visa_available"] is True, "visa availability as true or false is kept")
    check(one(center="Texas")["center"] == "TSC", "a service center written by name is its code")
    refused("a free-text priority note", doc(hand(priority_note="PD Jan 2023, thanks Ravi at the firm")))
    refused("a country with words beside it", doc(hand(chargeability="India (wife Priya from Kerala)")))
    refused("a status with words beside it", doc(hand(nonimmigrant_status="H-1B with Acme, call me 555-0100")))
    refused("a visa availability that isn't true or false", doc(hand(visa_available="yes")))
    refused("a service center it can't name", doc(hand(center="Nebraska, my lawyer said")))
    refused("a journey of offices", doc(hand(office="NBC then Springfeld")))
    refused("a journey that ends somewhere it knows", doc(hand(office="Queens -> Springfield")))
    refused("a consulate step, which the consulate pages don't credit to Facebook groups",
            doc(hand(visa_issued="2026-10-01")))
    refused("a consulate post", doc(hand(post="Mumbai, met Officer Smith")))
    check("facebook" in icp.HAND_SOURCES and "terms" in (icp.__doc__ or ""),
          "Facebook is read by hand only, and the module says why no script reads it")

    # A source loaded by hand loads only when there are posts to add, so its freshness row has no maximum age and never
    # raises a staleness alarm; the readers' sources keep theirs.
    stamped: dict[str, dict] = {}

    def stamp(_db, dataset, **kw):
        stamped[dataset] = kw

    icp.stamp_sources(None, [{"source": "facebook", "key": "1"}, {"source": "facebook", "key": "2"},
                             {"source": "telegram", "key": "c:1"}, {"source": "reddit", "key": "3"},
                             {"source": "whatsapp", "key": "wa1:x"}], stamp=stamp)
    fbs = stamped.get("community-posts-facebook", {})
    check(fbs.get("max_age_days", 0) is None and fbs.get("source") == "https://www.facebook.com/groups"
          and fbs.get("cadence") == "by hand" and "2 reports" in fbs.get("note", ""),
          f"Facebook is stamped with no maximum age: {fbs}")
    check(stamped["community-posts-telegram"]["max_age_days"] == 1 and stamped["community-posts-reddit"]["max_age_days"] == 2,
          f"the readers keep their budgets: {stamped}")
    wa = stamped.get("community-posts-whatsapp", {})
    check(wa.get("max_age_days", 0) is None and wa.get("source") == "https://www.whatsapp.com" and "whatsapp" in icp.POST_SOURCES,
          f"WhatsApp's exported chats are a posts source, stamped with no maximum age: {wa}")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

"""The community posts loader (scripts/ingest_community_posts.py): what it keeps, what it never keeps, what it refuses.

Every row here is made up. Run: python3 scripts/test_ingest_community_posts.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

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

    # Telegram: the reader's rows, one chat at a time.
    def msg(i, text, sender="s1", date="2023-10-24T16:00:00+00:00"):
        return {"id": i, "date": date, "sender": sender, "reply_to": None, "text": text}

    posts = [msg(1, "PERM certified! Filing date: 11/29/2022 Approval date: 10/24/2023"),
             msg(2, "anyone approved today?", sender="s2"),
             msg(3, "Just heard from a friend, 9/16 approved today", sender="s3")]
    perm, sfv_spec = {"kind": "perm"}, {"kind": "i485", "office": "SFV"}
    recs = icp.telegram_records("a-chat", posts, perm)[0]
    check(len(recs) == 1 and recs[0]["key"] == "a-chat:1" and recs[0]["source"] == "telegram", f"one readable post: {recs}")
    check(recs[0]["perm_filed"] == "2022-11-29" and recs[0]["perm_decided"] == "2023-10-24"
          and recs[0]["perm_decision"] == "approved", "its dates and decision")
    check(recs[0]["person"] == "s1" and recs[0]["as_of"] == "2023-10-24", "the reader's salted sender, the post's Eastern day")
    late = icp.telegram_records("a-chat", [msg(9, "Perm certified today", date="2023-10-25T02:30:00+00:00")], perm)[0]
    check(late and late[0]["perm_decided"] == "2023-10-24", f"a post at 10:30 PM Eastern is that Eastern day: {late}")
    text = json.dumps(recs)
    check("certified!" not in text and "Filing" not in text, "no text kept")
    check(icp.telegram_records("someone", posts, None) == ([], []), "a chat that isn't listed is never read")
    sfv = icp.telegram_records("an-office", [msg(5, "I485 RD: 08/14/2025 GC approved 11/03/2026",
                                                date="2026-11-04T15:00:00+00:00")], sfv_spec)[0]
    check(sfv and sfv[0]["office"] == "SFV" and sfv[0]["i485_decided"] == "2026-11-03", f"an office's own chat: {sfv}")
    with tempfile.TemporaryDirectory() as d:
        good, bad = Path(d, "good.json"), Path(d, "bad.json")
        good.write_text(json.dumps({"chats": {"a": {"kind": "perm"}, "b": {"kind": "i485", "office": "SFV"}}}))
        bad.write_text(json.dumps({"chats": {"a": {"kind": "guess"}}}))
        check(icp.read_chat_specs(good)["b"]["office"] == "SFV", "the chats file is read")
        try:
            icp.read_chat_specs(bad)
            check(False, "refuses a chat of an unknown kind")
        except ValueError:
            check(True, "refuses a chat of an unknown kind")

    # The model fills in what the parser can't read, each post asked once.
    free = msg(20, "Took 9 days. 140 filed on 12/4, approved on 12/12", sender="s9", date="2024-01-02T15:00:00+00:00")
    chat_rows = [msg(1, "PERM certified! Filing date: 11/29/2022 Approval date: 10/24/2023"), free,
                 msg(21, "thanks all", sender="s8")]
    asked = []

    def stand_in(prompt: str) -> dict:
        batch = json.loads(prompt)
        asked.extend(p["id"] for p in batch)
        return {"posts": [{"id": p["id"], "own_case": p["id"] == "a-chat:20", "category": None,
                           "steps": [{"step": "i140_filed", "date": "2023-12-04"},
                                     {"step": "i140_approved", "date": "2023-12-12"}]} for p in batch]}

    with tempfile.TemporaryDirectory() as d:
        folder, cache = Path(d, "messages"), Path(d, "model-reads.jsonl")
        folder.mkdir()
        (folder / "a-chat.jsonl").write_text("\n".join(json.dumps(r) for r in chat_rows) + "\n{\"partial")
        specs = {"a-chat": {"kind": "mixed"}}
        recs, counts = icp.prepare_telegram(folder, specs, cache, ask=True, runner=stand_in)
        check(sorted(asked) == ["a-chat:1", "a-chat:20"],
              f"the posts the parser can't read that write a date and name a step are asked, nothing else: {asked}")
        check(counts["records"] == 1 and counts["model_records"] == 1 and recs[0]["i140_decided"] == "2023-12-12",
              f"an answer for the poster's own case becomes a record, one that isn't gives nothing: {counts}")
        check(recs[0]["person"] == "s9" and recs[0]["key"] == "a-chat:20", "keyed and linked like any other post")
        check(oct(cache.stat().st_mode)[-3:] == "600", "the saved answers are readable by this account only")
        asked.clear()
        icp.prepare_telegram(folder, specs, cache, ask=True, runner=stand_in)
        check(asked == [], "a post already asked isn't asked again")
        recs2, _ = icp.prepare_telegram(folder, specs, cache, ask=False)
        check(len(recs2) == 1, "the saved answers are used without asking")

        def down(prompt: str) -> dict:
            raise RuntimeError("model unavailable")

        folder2 = Path(d, "m2")
        folder2.mkdir()
        (folder2 / "a-chat.jsonl").write_text(json.dumps(msg(30, free["text"])) + "\n")
        _, counts = icp.prepare_telegram(folder2, specs, Path(d, "c2.jsonl"), ask=True, runner=down)
        check("failure" in counts and counts["asked"] == 0, f"a model that fails is reported, never taken as empty: {counts}")

    # Reddit through the same path: a subreddit's posts keyed by Reddit's own id, the posts read by hand kept as they
    # are and never read or asked about again.
    sub = {"kind": "mixed"}
    rposts = [msg(41, "My I-485 was approved today! Filed 2026-03-06, EB-3", date="2026-11-03T15:00:00+00:00"),
              msg(42, "Green card approved today, I-485 filed 2026-02-02", date="2026-11-04T15:00:00+00:00")]
    rrecs = icp.telegram_records("USCIS_EB3", rposts, sub, source="reddit")[0]
    check(rrecs and all(r["source"] == "reddit" and r["key"] in ("41", "42") for r in rrecs),
          f"a Reddit post's key is its own id: {rrecs}")
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        (folder / "USCIS_EB3.jsonl").write_text("\n".join(json.dumps(m) for m in rposts))
        hand = [{"source": "reddit", "key": "41", "as_of": "2026-11-03", "office": "SFV", "i485_decided": "2026-11-03",
                 "i485_decision": "approved"}]
        got, counts = icp.prepare_telegram(folder, {"USCIS_EB3": sub}, source="reddit", extra=hand)
        keys = sorted(r["key"] for r in got)
        check(keys == ["41", "42"] and next(r for r in got if r["key"] == "41").get("office") == "SFV"
              and counts["by_hand"] == 1, f"a post read by hand stays as read, the rest are read: {keys} {counts}")

    # A post that names its field office counts toward that office, when it reports an I-485 step; a PERM post that
    # names one doesn't (the office has nothing to do with PERM), and an office's own chat keeps its office.
    named = icp.telegram_records("USCIS_EB3", [msg(51, "I-485 RD 10/14/2025, transferred to Santa Ana FO, GC approved "
                                                       "11/03/2026", date="2026-11-04T15:00:00+00:00")], sub,
                                 source="reddit")[0]
    check(named and named[0].get("office") == "SAA", f"a post naming its office counts there: {named}")
    perm_only = icp.telegram_records("a-chat", [msg(52, "Perm certified today, my lawyer is near Tampa FO",
                                                    date="2023-10-24T16:00:00+00:00")], perm)[0]
    check(perm_only and "office" not in perm_only[0], f"a PERM post never gets an office: {perm_only}")
    kept = icp.telegram_records("an-office", [msg(53, "I485 RD: 08/14/2025 transferred to Tampa FO, GC approved 11/03/2026",
                                                  date="2026-11-04T15:00:00+00:00")], sfv_spec)[0]
    check(kept and kept[0]["office"] == "SFV", f"an office's own chat keeps its office: {kept}")

    # A post about a marriage or family case is marked Family, so the employment-based figures can leave it out; a post
    # that also names an employment-based step keeps its own category.
    marriage = icp.telegram_records("USCIS", [msg(54, "Marriage based AOS. I-485 RD 10/14/2025, interview at Chicago FO, "
                                                     "GC approved 11/03/2026", date="2026-11-04T15:00:00+00:00")], sub,
                                    source="reddit")[0]
    check(marriage and marriage[0].get("category") == "Family", f"a marriage case is marked Family: {marriage}")
    eb = icp.telegram_records("USCIS", [msg(55, "Through PERM. After our marriage my wife joined as a derivative. "
                                               "I-485 RD 10/14/2025, GC approved 11/03/2026", date="2026-11-04T15:00:00+00:00")], sub,
                              source="reddit")[0]
    check(eb and eb[0].get("category") != "Family", f"an employment case that names a spouse isn't Family: {eb}")

    # Context: a post that gives nothing alone is read with the person's own earlier words, the post it answers and its
    # screenshot (lib_post_context), the model reading it under its own key.
    import lib_post_context as pc

    def at(minutes):
        return f"2026-11-20T15:{minutes:02d}:00+00:00"

    def tmsg(i, text, sender, minute, reply_to=None):
        return {"id": i, "date": at(minute), "sender": sender, "reply_to": reply_to, "text": text}

    thread_rows = [tmsg(1, "Got SU on EAD and AP", "mqo", 0),
                   tmsg(2, "What's your SC? NBC?", "ghost", 4, reply_to=1),
                   tmsg(3, "For EAD is NBC and for AP is TSC, both approved 11/18/2026", "mqo", 9, reply_to=2),
                   tmsg(4, "Did you get the I-485 approved on 11/18/2026?", "q", 20),
                   tmsg(5, "yes", "ans", 21, reply_to=4),
                   tmsg(6, "biometrics done", "late", 30),
                   tmsg(10, "Anyone got their I-485 approved this week?", "asker", 45),
                   tmsg(11, "mine 11/18/2026", "replier", 46, reply_to=10),
                   tmsg(12, "Congrats!!", "fan", 47, reply_to=11),
                   tmsg(7, "on 11/02/2026", "late", 41)]
    th = pc.Thread(thread_rows)
    own, answered = th.context(thread_rows[2])
    check([o["id"] for o in own] == [1] and answered["id"] == 2,
          "a reply to a question about the person's own post: their post counts as theirs, the question is context")
    check(th.context(thread_rows[6]) == ([], None), "a follow-on 11 minutes later isn't read as the same report")
    check([o["id"] for o in pc.Thread([tmsg(8, "a", "x", 0), tmsg(9, "b", "x", 9)]).context(tmsg(9, "b", "x", 9))[0]] == [8],
          "the person's previous post within 10 minutes is theirs")
    wider = pc.labelled(["Got SU on EAD and AP"], "What's your SC? NBC?", "For EAD is NBC")
    check(wider.index(pc.EARLIER) < wider.index(pc.ANSWERING) < wider.index(pc.THIS_POST), "each part labelled, in order")
    check(pc.screenshot_lines("Hello\nOn November 18, 2026, we approved your Form I-765\nRandom line\nCase Was Approved")
          == "On November 18, 2026, we approved your Form I-765\nCase Was Approved", "a screenshot keeps its date and step lines")
    check(len(pc.screenshot_lines("approved 11/18/2026\n" * 200)) <= pc.SCREENSHOT_MAX, "and no more than its cap")

    ctx_asked: list[dict] = []

    def ctx_stand_in(prompt: str) -> dict:
        batch = json.loads(prompt)
        ctx_asked.extend(batch)
        return {"posts": [{"id": p["id"], "own_case": True, "category": None,
                           "steps": [{"step": "ead_approved", "date": "2026-11-18"}]} for p in batch]}

    with tempfile.TemporaryDirectory() as d:
        folder, cache, shots = Path(d, "messages"), Path(d, "model-reads.jsonl"), Path(d, "ocr.jsonl")
        folder.mkdir()
        (folder / "eadap.jsonl").write_text("\n".join(json.dumps(r) for r in thread_rows) + "\n")
        # A photo sent with no caption: only the screenshot reader has it.
        shots.write_text(json.dumps({"chat": "eadap", "id": 50, "date": at(50), "sender": "pic", "reply_to": None,
                                     "text": "", "image_text": "Account updates\nOn November 17, 2026, we approved your "
                                                               "Form I-765, Application for Employment Authorization"}) + "\n")
        specs = {"eadap": {"kind": "i485"}}
        recs, counts = icp.prepare_telegram(folder, specs, cache, ask=True, runner=ctx_stand_in, images_path=shots)
        by_id = {p["id"]: p for p in ctx_asked}
        check("eadap:3#ctx" in by_id and pc.EARLIER in by_id["eadap:3#ctx"]["text"]
              and "Got SU on EAD and AP" in by_id["eadap:3#ctx"]["text"], f"asked with the person's own earlier post: {sorted(by_id)}")
        check("eadap:11#ctx" in by_id and pc.ANSWERING in by_id["eadap:11#ctx"]["text"]
              and "Anyone got their I-485" in by_id["eadap:11#ctx"]["text"],
              "an answer that writes its own date is asked with the question, labelled as another member's")
        check("eadap:5#ctx" not in by_id and "eadap:12#ctx" not in by_id,
              "a bare yes or a congrats carries no step or date of its own and is never asked")
        check("eadap:50#ctx" in by_id and pc.SCREENSHOT in by_id["eadap:50#ctx"]["text"],
              "a photo with no caption is a post, asked with its screenshot's text")
        check(counts["screenshots"] == 1, f"the screenshots are counted: {counts}")
        no_model = icp.telegram_records("eadap", thread_rows, {"kind": "i485"})[0]
        check(not any(r.get("person") == "ans" for r in no_model),
              "the regex parser never takes another member's date for the poster")
        check(all(not k.endswith("#ctx") for k in (r["key"] for r in recs)), "records keep the post's own key")
        ctx_asked.clear()
        icp.prepare_telegram(folder, specs, cache, ask=True, runner=ctx_stand_in, images_path=shots)
        check(ctx_asked == [], "a post read with its context is asked once")
    with tempfile.TemporaryDirectory() as d:
        folder, cache = Path(d, "messages"), Path(d, "model-reads.jsonl")
        folder.mkdir()
        (folder / "eadap.jsonl").write_text("\n".join(json.dumps(r) for r in thread_rows) + "\n")
        ctx_asked.clear()
        saved_cap = icp.CONTEXT_ASK_CAP
        icp.CONTEXT_ASK_CAP = 1
        try:
            _, capped = icp.prepare_telegram(folder, {"eadap": {"kind": "i485"}}, cache, ask=True, runner=ctx_stand_in)
        finally:
            icp.CONTEXT_ASK_CAP = saved_cap
        wider_asked = [p for p in ctx_asked if p["id"].endswith("#ctx")]
        check(len(wider_asked) == 1 and capped["context_waiting"] >= 1,
              f"no more context asks a run than the cap, newest first, the rest counted: {capped}")
        check(wider_asked and wider_asked[0]["posted"] == max(p["posted"] for p in wider_asked), "the newest goes first")

    # Posts typed in by hand from screenshots the owner shares (Facebook groups): each row keeps only the merge's own
    # fields, so the group's name, the notes and anything else typed beside them never leave the Mac.
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

    # A source loaded by hand loads only when the owner shares posts, so its freshness row has no maximum age and never
    # raises a staleness alarm; the readers' sources keep theirs.
    stamped: dict[str, dict] = {}

    def stamp(_db, dataset, **kw):
        stamped[dataset] = kw

    icp.stamp_sources(None, [{"source": "facebook", "key": "1"}, {"source": "facebook", "key": "2"},
                             {"source": "telegram", "key": "c:1"}, {"source": "reddit", "key": "3"}], stamp=stamp)
    fbs = stamped.get("community-posts-facebook", {})
    check(fbs.get("max_age_days", 0) is None and fbs.get("source") == "https://www.facebook.com/groups"
          and fbs.get("cadence") == "by hand, when the owner shares posts" and "2 reports" in fbs.get("note", ""),
          f"Facebook is stamped with no maximum age: {fbs}")
    check(stamped["community-posts-telegram"]["max_age_days"] == 1 and stamped["community-posts-reddit"]["max_age_days"] == 2,
          f"the readers keep their budgets: {stamped}")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

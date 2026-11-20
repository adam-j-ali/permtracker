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

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

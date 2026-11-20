"""Load people's own case reports from Reddit and Telegram posts into `community_post_reports`, in the merge's shape.

Two steps, so nothing but dates and categories ever leaves the machine the posts were read on:

    python3 scripts/ingest_community_posts.py prepare --reddit rows.json --out records.json      # on the owner's Mac
    python3 scripts/ingest_community_posts.py prepare --telegram messages/ --chats chats.json --out records.json
    python3 scripts/ingest_community_posts.py load records.json                                 # on the server

`prepare` reads the rows a reader collected (Reddit through Arctic Shift only; Telegram through the owner's own
signed-in reader, one messages/<chat>.jsonl per chat), keeps each post's dates and category, and links one person's
posts by a hash salted with COMMUNITY_SALT (or ~/.config/permtracker/community-salt), so no one can be traced back from
it. Text, quotes, notes, links and chat names are dropped. Telegram posts are read by scripts/lib_post_dates.py, which
takes a date only beside its label and never guesses one; the chat says what kind of post it is (--chats).
`load` replaces that source's rows, refusing a file that lost more than half of them, and
scripts/build_reported_cases.py merges them with every other source at its next run.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import lib_post_dates as post_dates
import lib_reported_cases as rc

TABLE = "community_post_reports"
KEEP_SHARE = 0.5
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH = re.compile(r"^\d{4}-\d{2}$")
CATEGORIES = {"eb1": "EB-1", "eb2": "EB-2", "eb2-niw": "EB-2 NIW", "eb3": "EB-3", "family": "Family"}
COLUMNS = ("source", "key", "person", "as_of", *rc.FIELDS)
SALT_FILE = Path.home() / ".config" / "permtracker" / "community-salt"


def _date(v) -> str | None:
    """A day or a month as the merge reads them; a year alone, or anything else, is no date."""
    v = (v or "").strip() if isinstance(v, str) else None
    return v if v and (DAY.match(v) or MONTH.match(v)) else None


def _et_day(utc: str | None) -> str | None:
    if not utc:
        return None
    from zoneinfo import ZoneInfo
    t = dt.datetime.fromisoformat(utc.replace("Z", "+00:00"))
    return t.astimezone(ZoneInfo("America/New_York")).date().isoformat()


def person_link(author_hash: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{author_hash}".encode()).hexdigest()[:16]


def reddit_record(row: dict, salt: str) -> dict:
    """One San Fernando Valley post or comment (the Nov 19 2026 Arctic Shift reader's row) as a merge record."""
    approved = _date(row.get("approval_date"))
    return {
        "source": "reddit", "key": str(row["source_id"]), "person": person_link(str(row["author_hash"]), salt),
        "as_of": _et_day(row.get("created_utc")), "office": "SFV",
        "category": CATEGORIES.get((row.get("category") or "").strip().lower()),
        "priority_date": _date(row.get("priority_date")), "i485_receipt": _date(row.get("receipt_date")),
        "biometrics": _date(row.get("biometrics_date")), "ead": _date(row.get("ead_ap_date")),
        "transfer": _date(row.get("transfer_to_sfv_date")),
        "i485_decided": approved, "i485_decision": "approved" if approved else None,
    }


# What each Telegram chat is about comes from a private file beside the messages (chats.json: {"chats": {name:
# {"kind": "perm" | "i485" | "mixed", "office": code?}}}), so a bare "filed" or "approved" is read as the right form, and
# an office's own chat names its office. A chat that isn't listed there is never read.
KINDS = ("perm", "i485", "mixed")


def read_chat_specs(path: Path) -> dict[str, dict]:
    specs = json.loads(path.read_text(encoding="utf-8"))["chats"]
    for chat, spec in specs.items():
        if spec.get("kind") not in KINDS:
            raise ValueError(f"{chat}: kind must be one of {KINDS}")
    return specs


def telegram_records(chat: str, rows: list[dict], spec: dict | None) -> list[dict]:
    """One chat's posts as merge records: only the posts lib_post_dates can read without guessing."""
    if spec is None:
        return []
    from zoneinfo import ZoneInfo
    eastern = ZoneInfo("America/New_York")
    order = post_dates.chat_order([r.get("text") or "" for r in rows])
    out = []
    for r in rows:
        posted = dt.datetime.fromisoformat(r["date"]).astimezone(eastern).date()
        fields = post_dates.read_post(r.get("text") or "", posted, spec["kind"], order)
        if not fields:
            continue
        rec = {"source": "telegram", "key": f"{chat}:{r['id']}", "as_of": posted.isoformat(), **fields}
        if r.get("sender"):
            rec["person"] = str(r["sender"])
        if spec.get("office"):
            rec["office"] = spec["office"]
        rc.check_record(rec)
        out.append(rec)
    return out


def prepare_telegram(folder: Path, specs: dict[str, dict]) -> tuple[list[dict], dict]:
    records, counts = [], {"chats": 0, "messages": 0, "records": 0, "skipped_chats": []}
    for path in sorted(folder.glob("*.jsonl")):
        chat = path.stem
        if chat not in specs:
            counts["skipped_chats"].append(chat)
            continue
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        mine = telegram_records(chat, rows, specs[chat])
        records += mine
        counts["chats"] += 1
        counts["messages"] += len(rows)
    counts["records"] = len(records)
    return records, counts


def prepare(rows: list[dict], salt: str) -> tuple[list[dict], dict]:
    if not salt:
        raise ValueError("no salt: set COMMUNITY_SALT or write one to ~/.config/permtracker/community-salt")
    out: dict[str, dict] = {}
    repeated = 0
    for r in rows:
        if not r.get("author_hash"):
            raise ValueError(f"row {r.get('source_id')!r} has no author link")
        rec = {k: v for k, v in reddit_record(r, salt).items() if v is not None}
        rc.check_record(rec)
        if rec["key"] in out:
            repeated += 1
            continue
        out[rec["key"]] = rec
    return list(out.values()), {"rows": len(rows), "records": len(out), "repeated_ids": repeated}


def read_salt() -> str:
    salt = os.environ.get("COMMUNITY_SALT", "").strip()
    if not salt and SALT_FILE.exists():
        salt = SALT_FILE.read_text().strip()
    return salt


def ensure_table(db) -> None:
    from lib_db import add_missing_columns
    cols = ", ".join(f"{c} TEXT" for c in COLUMNS if c not in ("source", "key"))
    # Table and column names are this module's constants, never input.
    db.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} (source TEXT NOT NULL, key TEXT NOT NULL, {cols}, "  # nosemgrep
               "fetched_at INTEGER NOT NULL, PRIMARY KEY (source, key))")
    add_missing_columns(db, TABLE, {c: "TEXT" for c in COLUMNS if c not in ("source", "key")})


def load(db, records: list[dict], force: bool = False) -> int:
    """Replace each source's rows with these, refusing a source that lost more than half its stored rows."""
    from lib_db import query_rows, stmt
    stamp = int(time.time() * 1000)
    for source in sorted({r["source"] for r in records}):
        mine = [r for r in records if r["source"] == source]
        stored = int(query_rows(db, f"SELECT count(*) FROM {TABLE} WHERE source = ?", [source])[0][0] or 0)  # nosemgrep
        if stored and len(mine) < stored * KEEP_SHARE and not force:
            raise RuntimeError(f"{source}: {len(mine)} records against {stored} stored, more than half gone")
        sql = f"INSERT OR REPLACE INTO {TABLE} ({', '.join(COLUMNS)}, fetched_at) VALUES ({', '.join('?' * (len(COLUMNS) + 1))})"  # nosemgrep
        reqs = [stmt(sql, [*(r.get(c) for c in COLUMNS), stamp]) for r in mine]
        reqs.append(stmt(f"DELETE FROM {TABLE} WHERE source = ? AND fetched_at < ?", [source, stamp]))  # nosemgrep
        for i in range(0, len(reqs), 200):
            db.pipeline(reqs[i:i + 200])
    return len(records)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--reddit", help="the Reddit reader's rows (JSON with a 'rows' list)")
    src.add_argument("--telegram", help="the Telegram reader's messages/ folder, one <chat>.jsonl per chat")
    p.add_argument("--chats", help="with --telegram: the private chats.json saying what each chat is about")
    p.add_argument("--out", required=True)
    l_ = sub.add_parser("load")
    l_.add_argument("records")
    l_.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.cmd == "prepare" and a.telegram:
        if not a.chats:
            ap.error("--telegram needs --chats")
        rows, counts = prepare_telegram(Path(a.telegram), read_chat_specs(Path(a.chats)))
        Path(a.out).write_text(json.dumps(rows))
        os.chmod(a.out, 0o600)
        print(f"{counts['records']:,} records from {counts['messages']:,} messages in {counts['chats']} chats in {a.out}"
              + (f"; not read (not listed): {', '.join(counts['skipped_chats'])}" if counts["skipped_chats"] else ""))
        return 0
    if a.cmd == "prepare":
        doc = json.load(open(a.reddit, encoding="utf-8"))
        rows, counts = prepare(doc["rows"] if isinstance(doc, dict) else doc, read_salt())
        Path(a.out).write_text(json.dumps(rows))
        os.chmod(a.out, 0o600)
        print(f"{counts['records']:,} records from {counts['rows']:,} rows ({counts['repeated_ids']} repeated ids) in {a.out}")
        return 0
    started = time.time()
    from lib_db import Database, record_run, stamp_freshness
    db = Database()
    records = json.load(open(a.records, encoding="utf-8"))
    for r in records:
        rc.check_record(r)
    try:
        ensure_table(db)
        n = load(db, records, force=a.force)
        sources = sorted({r["source"] for r in records})
        for s in sources:
            stamp_freshness(db, f"community-posts-{s}",
                            source={"reddit": "https://arctic-shift.photon-reddit.com", "telegram": "https://t.me"}.get(s, s),
                            cadence="by hand", note=f"{sum(r['source'] == s for r in records):,} reports", max_age_days=60)
        record_run(db, "ingest_community_posts.py", status="ok", rows_written=n,
                   note=f"{n:,} reports from {', '.join(sources)}", started_at=started)
        print(f"{n:,} reports loaded")
        return 0
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"::error::{msg}", flush=True)
        record_run(db, "ingest_community_posts.py", status="failed", rows_written=None, note=msg, started_at=started)
        return 1


if __name__ == "__main__":
    sys.exit(main())

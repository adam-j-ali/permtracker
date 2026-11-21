"""Load people's own case reports from Reddit, Telegram and Facebook posts into `community_post_reports`.

Two steps, so nothing but each case's dates and the merge's own few fields (its category, office, country and
status) ever leaves the machine the posts were read on:

    python3 scripts/ingest_community_posts.py prepare --reddit rows.json --out records.json      # on the owner's Mac
    python3 scripts/ingest_community_posts.py prepare --telegram messages/ --chats chats.json --out records.json
    python3 scripts/ingest_community_posts.py prepare --hand-read hand-read.json --out records.json
    python3 scripts/ingest_community_posts.py load records.json                                 # on the server

Three sources. `prepare` reads the rows a reader collected (Reddit through Arctic Shift only; Telegram through the
owner's own signed-in reader, one messages/<chat>.jsonl per chat), keeps each post's dates and category, and links one
person's posts by a hash salted with COMMUNITY_SALT (or ~/.config/permtracker/community-salt), so no one can be traced
back from it. Text, quotes, notes, links and chat names are dropped. Telegram posts are read by
scripts/lib_post_dates.py, which takes a date only beside its label and never guesses one; the chat says what kind of
post it is (--chats).

Facebook groups are read by hand only. No script here or anywhere else reads Facebook: Meta's terms bar automated
reading, so the owner shares screenshots of public group posts and each one is typed into a private file
(--hand-read: {"meta": {"source": "facebook"}, "rows": [{"source_id", "author_hash", "posted", and the record's own
fields, named as lib_reported_cases.FIELDS}]}). Each row keeps only those fields, salted like the rest; the group's
name, the notes and anything else typed beside them are dropped. An office is written as its code or its name, and a
name no office answers to refuses the file, as does a repeated post.

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

import lib_offices as offices
import lib_posts as posts
import lib_post_context as post_context
import lib_post_dates as post_dates
import lib_post_model as post_model
import lib_reported_cases as rc
import lib_reported_summary as summary

TABLE = "community_post_reports"
KEEP_SHARE = 0.5
# Posts asked about with their context or screenshot each run, newest first (the hourly run asks the model on the
# owner's plan): the rest wait for the next run, and the count left is printed.
CONTEXT_ASK_CAP = 400
CONTEXT_KEY = "#ctx"  # a saved model answer for a post read with its context or screenshot
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


def _rows(path: Path) -> list[dict]:
    """A chat's messages; a line the reader is still writing is skipped until next time."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


# The places posts are read from, each by its own reader on the owner's Mac. A Reddit item's id is already unique
# across Reddit, and is the key the posts read by hand on Nov 19 2026 use, so one post is never in the list twice.
POST_SOURCES = ("telegram", "reddit")


def post_key(source: str, chat: str, row_id) -> str:
    return str(row_id) if source == "reddit" else f"{chat}:{row_id}"


# A post about a marriage or family case, which the employment-based figures leave out, unless it also names an
# employment-based step (an EB case whose spouse is a derivative is still an EB case).
FAMILY_CASE = re.compile(r"\b(marriage|married to a (?:us |u\.s\. )?citizen|spouse of a (?:us |u\.s\. )?citizen|"
                         r"family[- ]based|i-?130|k-?1|ir-?1|cr-?1|fianc[eé]e?)\b", re.I)
EMPLOYMENT_CASE = re.compile(r"\b(eb-?[123]\w*|niw|perm|i-?140|employment[- ]based|labou?r cert\w*)\b", re.I)

# The steps an I-485 takes at a field office, or on its way there.
ADJUSTMENT_STEPS = frozenset({"i485_receipt", "biometrics", "transfer", "interview", "i485_decided", "ead", "ap", "card"})


def _record(chat: str, row: dict, posted: dt.date, spec: dict, fields: dict, source: str = "telegram") -> dict:
    rec = {"source": source, "key": post_key(source, chat, row["id"]), "as_of": posted.isoformat(), **fields}
    if row.get("sender"):
        rec["person"] = str(row["sender"])
    if spec.get("office"):
        rec["office"] = spec["office"]
    elif ADJUSTMENT_STEPS & fields.keys() and "office" not in fields:
        # A post in a general chat that names the one field office its case is at ("transferred to Santa Ana FO")
        # counts toward that office. Only for an I-485 step: the office has nothing to do with PERM or the I-140.
        code = offices.office_in_post(row.get("text"))
        if code:
            rec["office"] = code
    text = row.get("text") or ""
    if "category" not in rec and FAMILY_CASE.search(text) and not EMPLOYMENT_CASE.search(text):
        rec["category"] = "Family"
    rc.check_record(rec)
    return rec


def telegram_records(chat: str, rows: list[dict], spec: dict | None,
                     model_reads: dict[str, dict | None] | None = None,
                     source: str = "telegram", images: dict[tuple, str] | None = None) -> tuple[list[dict], list[dict]]:
    """One chat's (or subreddit's) posts as merge records, and the posts still worth asking the model about.

    The parser reads first (lib_post_dates). A post it can't read but that writes a date and names a step takes the
    model's saved answer when there is one (lib_post_model, checked there against the dates the post writes); without
    one, it's handed back to be asked."""
    if spec is None:
        return [], []
    from zoneinfo import ZoneInfo
    eastern = ZoneInfo("America/New_York")
    model_reads = model_reads or {}
    order = post_dates.chat_order([r.get("text") or "" for r in rows])
    thread = post_context.Thread(rows)
    out, to_ask = [], []
    for r in rows:
        if not r.get("date"):
            continue
        plain = r.get("text") or ""
        text = post_context.own_text(r, images, (chat, r["id"]))  # its words and its screenshot's useful lines
        posted = dt.datetime.fromisoformat(r["date"]).astimezone(eastern).date()
        fields = post_dates.read_post(text, posted, spec["kind"], order)
        if fields:
            out.append(_record(chat, r, posted, spec, fields, source))
            continue
        # Nothing alone: the person's own earlier words count as theirs (lib_post_context).
        own, answered = thread.context(r)
        earlier = [post_context.own_text(o, images, (chat, o["id"])) for o in own]
        if earlier:
            # Only what this post adds counts: the earlier words alone already made their own record when they could,
            # so a follow-on that only carries on talking ("Houston") is never a second copy of that report.
            fields = post_context.added(post_dates.read_post(post_context.own_words(earlier, text), posted, spec["kind"], order),
                                        post_dates.read_post(post_context.own_words(earlier, ""), posted, spec["kind"], order))
            if fields:
                out.append(_record(chat, r, posted, spec, fields, source))
                continue
        key = post_key(source, chat, r["id"])
        asked = {"id": key, "posted": posted.isoformat(), "kind": spec["kind"], "text": plain}
        extended = bool(earlier or answered or text != plain)
        if key in model_reads:
            # Saved answers pass today's checks again, so a check added later reaches them too.
            fields = post_model.recheck(model_reads[key], asked)
            if fields:
                out.append(_record(chat, r, posted, spec, fields, source))
                continue
            if not extended:
                continue
        elif not extended:
            if post_model.worth_asking(plain):
                to_ask.append(asked)
            continue
        # The model reads it again with its context, under its own key, so every saved answer stays valid.
        wider = post_context.labelled(earlier, (answered or {}).get("text"), text) if (earlier or answered) else text
        # The post itself must carry part of a report (a step or a date): a "congrats!" under someone's approval is
        # never asked about.
        if not post_model.worth_asking(wider) or not post_context.carries_report(text):
            continue
        asked = {**asked, "id": f"{key}{CONTEXT_KEY}", "text": wider}
        if asked["id"] in model_reads:
            fields = post_model.recheck(model_reads[asked["id"]], asked)
            if fields:
                out.append(_record(chat, r, posted, spec, fields, source))
        else:
            to_ask.append(asked)
    return out, to_ask


def load_model_reads(path: Path) -> dict[str, dict | None]:
    reads: dict[str, dict | None] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            reads[row["id"]] = row.get("fields")
    return reads


def prepare_telegram(folder: Path, specs: dict[str, dict], model_cache: Path | None = None, ask: bool = False,
                     runner=post_model.claude_runner, source: str = "telegram",
                     extra: list[dict] | None = None, images_path: Path | None = None) -> tuple[list[dict], dict]:
    """Every listed chat's records. With model_cache, saved model answers fill in what the parser can't read; with
    ask, the posts not yet asked are asked now and their answers saved as each batch comes back."""
    reads = load_model_reads(model_cache) if model_cache else {}
    counts = {"chats": 0, "messages": 0, "records": 0, "skipped_chats": [], "asked": 0, "to_ask": 0}
    images, photo_rows = post_context.load_images(images_path)
    counts["screenshots"] = len(images)
    chats = []
    for path in sorted(folder.glob("*.jsonl")):
        if path.stem not in specs:
            counts["skipped_chats"].append(path.stem)
            continue
        rows = _rows(path)
        have = {r["id"] for r in rows}
        # A photo sent with no caption has no saved post: its screenshot row stands for it.
        rows += [p for p in photo_rows.get(path.stem, []) if p["id"] not in have and p.get("date")]
        chats.append((path.stem, rows))
    # Posts already read by hand (`extra`) are never read again or asked about.
    done = {r["key"] for r in extra or []}
    pending = [p for chat, rows in chats for p in telegram_records(chat, rows, specs[chat], reads, source, images)[1]
               if p["id"].removesuffix(CONTEXT_KEY) not in done]
    wider = sorted((p for p in pending if p["id"].endswith(CONTEXT_KEY)), key=lambda p: p["posted"], reverse=True)
    counts["context_waiting"] = max(0, len(wider) - CONTEXT_ASK_CAP)
    pending = [p for p in pending if not p["id"].endswith(CONTEXT_KEY)] + wider[:CONTEXT_ASK_CAP]
    counts["to_ask"] = len(pending)
    failure = None
    if ask and model_cache and pending:
        stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

        def save(got: dict) -> None:
            with model_cache.open("a", encoding="utf-8") as f:
                for key, fields in got.items():
                    f.write(json.dumps({"id": key, "fields": fields, "model": post_model.MODEL, "at": stamp}) + "\n")
            os.chmod(model_cache, 0o600)

        try:
            post_model.read_posts(pending, runner=runner, workers=post_model.WORKERS, on_batch=save)
        except post_model.ModelBatchesFailed as e:
            failure = str(e)
        reads = load_model_reads(model_cache)
        counts["asked"] = sum(1 for p in pending if p["id"] in reads)
    records = list(extra or [])
    for chat, rows in chats:
        records += [r for r in telegram_records(chat, rows, specs[chat], reads, source, images)[0] if r["key"] not in done]
        counts["chats"] += 1
        counts["messages"] += len(rows)
    counts["records"] = len(records)
    counts["by_hand"] = len(extra or [])
    counts["model_records"] = sum(1 for r in records if reads.get(r["key"]) or reads.get(f"{r['key']}{CONTEXT_KEY}"))
    if failure:
        counts["failure"] = failure
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


# The sources typed in by hand from screenshots the owner shares, never read by a script (the module's docstring says
# why). Each loads only when there's something to load, so its freshness row has no maximum age (FRESHNESS below).
HAND_SOURCES = ("facebook",)
# The categories the figures read (lib_reported_summary.CATEGORY_LABELS): a typed category is one of these, or a key
# of CATEGORIES, which says it the way the readers do ("eb3").
KNOWN_CATEGORIES = frozenset(summary.CATEGORY_LABELS)


def _hand_category(v: str, key: str) -> str:
    if v in KNOWN_CATEGORIES:
        return v
    mapped = CATEGORIES.get(v.lower())
    if mapped:
        return mapped
    raise ValueError(f"post {key!r}: category {v!r} is none the merge knows "
                     f"({', '.join(sorted(KNOWN_CATEGORIES))}, or {', '.join(CATEGORIES)})")


def _hand_office(v: str, key: str) -> str:
    """A code stays, a name is its code (lib_offices), and a name no office answers to is refused, never guessed.
    A journey ("NBC then San Jose") is refused too: lib_offices reads its last leg it knows, so a misspelt last leg
    would quietly become the one before it."""
    if len([leg for leg in offices.JOURNEY.split(v) if leg.strip()]) > 1:
        raise ValueError(f"post {key!r}: {v!r} names more than one office; write the one the case is at")
    code = offices.office_code(v)
    if not code:
        raise ValueError(f"post {key!r}: no office is called {v!r}; write its code (src/lib/uscisOffices.json)")
    return code


# A typed row reaches the merge only as dates and words from these closed lists, so nothing typed beside them (a
# name, a firm, a phone number) can reach a page. The consulate steps are refused until the consulate pages name
# Facebook groups among their sources (consular-posts and consular-posts/[post] say "community sheets").
HAND_STATUSES = ("H-1B", "H-4", "L-1", "L-2", "F-1", "F-1 OPT", "F-1 STEM OPT", "J-1", "J-2", "O-1", "TN", "E-2",
                 "E-3", "H-1B1", "B-2", "Parole", "TPS", "Asylum pending", "None")
HAND_CENTERS = {"tsc": "TSC", "texas": "TSC", "texas service center": "TSC",
                "nsc": "NSC", "nebraska": "NSC", "nebraska service center": "NSC"}
HAND_REFUSED = ("priority_note", "post", "nvc_complete", "consular_scheduled", "consular_interview", "visa_issued",
                "consular_outcome")


def _hand_country(v: str, key: str) -> str:
    """Rest of world and the four countries with their own line stay as the merge reads them; any other country with a
    US visa post is its printed name (src/lib/consular/postCountries.ts); anything else is refused."""
    if v.lower() in summary.COUNTRY_LABELS:
        return v
    name = posts.known_countries().get(v.lower())
    if not name:
        raise ValueError(f"post {key!r}: {v!r} isn't a country the site lists; write just the country")
    return name


def _hand_status(v: str, key: str) -> str:
    for s in HAND_STATUSES:
        if s.lower() == v.lower():
            return s
    raise ValueError(f"post {key!r}: status {v!r} isn't one of {HAND_STATUSES}")


def hand_record(row: dict, source: str, salt: str) -> dict:
    """One post typed in by hand as a merge record: its id, its author's salted link, the day it was posted, and the
    record's own fields (lib_reported_cases.FIELDS). Every other key (the group's name, the notes, anything typed
    beside them) is dropped here, so no text leaves the Mac."""
    key = str(row.get("source_id") or "").strip()
    if not key:
        raise ValueError(f"a {source} row has no source_id")
    if not str(row.get("author_hash") or "").strip():
        raise ValueError(f"post {key!r} has no author link")
    posted = row.get("posted")
    if not (isinstance(posted, str) and DAY.match(posted)):
        raise ValueError(f"post {key!r}: posted must be YYYY-MM-DD, got {posted!r}")
    dt.date.fromisoformat(posted)  # a 31st of February raises
    # The post's own id is salted like its author, so no page's HTML carries a way back to the post.
    rec = {"source": source, "key": person_link(f"post:{key}", salt),
           "person": person_link(str(row["author_hash"]).strip(), salt), "as_of": posted}
    for f in rc.FIELDS:
        v = row.get(f)
        if isinstance(v, str):
            v = v.strip()
        if v is None or v == "":
            continue
        if f in HAND_REFUSED:
            raise ValueError(f"post {key!r}: {f} isn't taken from a post typed in by hand")
        if f == "office":
            v = _hand_office(v, key)
        elif f == "category":
            v = _hand_category(v, key)
        elif f == "chargeability":
            v = _hand_country(v, key)
        elif f == "nonimmigrant_status":
            v = _hand_status(v, key)
        elif f == "center":
            if v.lower() not in HAND_CENTERS:
                raise ValueError(f"post {key!r}: no I-140 service center is called {v!r}")
            v = HAND_CENTERS[v.lower()]
        elif f == "visa_available" and v not in (True, False):
            raise ValueError(f"post {key!r}: visa_available must be true or false, got {v!r}")
        rec[f] = v
    try:
        rc.check_record(rec)
    except ValueError as e:
        raise ValueError(f"post {key!r}: {e}") from None
    return rec


def prepare_hand_read(doc: dict, salt: str) -> tuple[list[dict], dict]:
    """Every row of a file typed in by hand, as records; the whole file is refused on one row the merge can't read."""
    source = (doc.get("meta") or {}).get("source") if isinstance(doc, dict) else None
    if source not in HAND_SOURCES:
        raise ValueError(f"meta.source must be one of {HAND_SOURCES} (sources typed in by hand), got {source!r}")
    if not salt:
        raise ValueError("no salt: set COMMUNITY_SALT or write one to ~/.config/permtracker/community-salt")
    rows = doc.get("rows") or []
    out: dict[str, dict] = {}
    left_behind = 0
    for r in rows:
        rec = hand_record(r, source, salt)
        if rec["key"] in out:
            raise ValueError(f"post {str(r.get('source_id')).strip()!r} is typed in twice")
        out[rec["key"]] = rec
        left_behind += sum(1 for k, v in r.items()
                           if k not in rc.FIELDS and k not in ("source_id", "author_hash", "posted") and v not in (None, ""))
    records = list(out.values())
    return records, {"source": source, "rows": len(rows), "records": len(records), "left_behind": left_behind,
                     "stages": stage_counts(records)}


# The form each date belongs to, for the counts prepare prints: how many records carry a step of each.
STAGES = (("H-1B", ("h1b_filed", "h1b_decided", "lca_certified")),
          ("wage and PERM", ("pwd_filed", "pwd_issued", "perm_filed", "perm_audit", "perm_decided")),
          ("I-140", ("i140_receipt", "i140_rfe_issued", "i140_rfe_answered", "i140_decided")),
          ("I-485", ("i485_receipt", "biometrics", "ead", "ap", "i485_rfe_issued", "transfer", "interview",
                     "i485_decided", "card")),
          ("consulate", ("nvc_complete", "consular_scheduled", "consular_interview", "visa_issued")))


def stage_counts(records: list[dict]) -> dict[str, int]:
    return {name: sum(1 for r in records if any(r.get(f) for f in fields)) for name, fields in STAGES}


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


# Each source's freshness row: where it's read, how often it loads, and the days after which a missing load is a stopped
# job. Telegram loads from the owner's Mac every hour, so a day without one means that job stopped, and Reddit once a
# day, so two days without one does. A source typed in by hand loads only when the owner shares posts, so it has no
# maximum age and never raises a staleness alarm (lib_db.stamp_freshness).
FRESHNESS = {
    "telegram": ("https://t.me", "hourly, from the owner's Mac", 1),
    "reddit": ("https://arctic-shift.photon-reddit.com", "daily, from the owner's Mac", 2),
    "facebook": ("https://www.facebook.com/groups", "by hand, when the owner shares posts", None),
}


def stamp_sources(db, records: list[dict], stamp) -> list[str]:
    """Stamp each loaded source's freshness row; the sources, sorted."""
    sources = sorted({r["source"] for r in records})
    for s in sources:
        where, cadence, max_age = FRESHNESS.get(s, (s, "daily, from the owner's Mac", 2))
        stamp(db, f"community-posts-{s}", source=where, cadence=cadence,
              note=f"{sum(r['source'] == s for r in records):,} reports", max_age_days=max_age)
    return sources


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--reddit", help="the Reddit reader's rows (JSON with a 'rows' list)")
    src.add_argument("--telegram", help="the Telegram reader's messages/ folder, one <chat>.jsonl per chat")
    src.add_argument("--posts", help="a post reader's messages/ folder (with --source), one <chat or subreddit>.jsonl each")
    src.add_argument("--hand-read", help="a private file of posts typed in by hand from shared screenshots (Facebook "
                     "groups): {'meta': {'source': ...}, 'rows': [...]}")
    p.add_argument("--source", choices=POST_SOURCES, default="telegram", help="with --posts: where the posts were read")
    p.add_argument("--with", dest="extra", help="with --posts: records already made for this source (the posts read by "
                   "hand), kept as they are and never read again")
    p.add_argument("--chats", help="with --telegram: the private chats.json saying what each chat is about")
    p.add_argument("--model-reads", help="with --telegram: the saved model answers (a private JSONL file)")
    p.add_argument("--ask", action="store_true", help="with --model-reads: ask the model about posts not yet asked")
    p.add_argument("--images", help="with --telegram or --posts: the screenshot reader's private JSONL (each photo's "
                                    "redacted text), read with each post")
    p.add_argument("--out", required=True)
    l_ = sub.add_parser("load")
    l_.add_argument("records")
    l_.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.cmd == "prepare" and (a.telegram or a.posts):
        if not a.chats:
            ap.error("--telegram and --posts need --chats")
        if a.ask and not a.model_reads:
            ap.error("--ask needs --model-reads")
        source = "telegram" if a.telegram else a.source
        extra = json.load(open(a.extra, encoding="utf-8")) if a.extra else None
        if extra and any(r.get("source") != source for r in extra):
            ap.error(f"--with holds records from another source than {source}")
        rows, counts = prepare_telegram(Path(a.telegram or a.posts), read_chat_specs(Path(a.chats)),
                                        Path(a.model_reads) if a.model_reads else None, ask=a.ask,
                                        source=source, extra=extra,
                                        images_path=Path(a.images) if a.images else None)
        Path(a.out).write_text(json.dumps(rows))
        os.chmod(a.out, 0o600)
        print(f"{counts['records']:,} records ({counts['model_records']:,} read by the model) from "
              f"{counts['messages']:,} messages in {counts['chats']} chats"
              + (f" and {counts['by_hand']:,} read by hand" if counts.get("by_hand") else "") + f" in {a.out}; "
              f"{counts['to_ask']:,} posts were waiting for the model, {counts['asked']:,} asked now"
              + (f"; {counts['screenshots']:,} screenshots read with their posts" if counts.get("screenshots") else "")
              + (f"; {counts['context_waiting']:,} more to read with their context in later runs"
                 if counts.get("context_waiting") else "")
              + (f"; not read (not listed): {', '.join(counts['skipped_chats'])}" if counts["skipped_chats"] else ""))
        if counts.get("failure"):
            print(f"::error::{counts['failure']}", flush=True)
            return 1
        return 0
    if a.cmd == "prepare" and a.hand_read:
        try:
            rows, counts = prepare_hand_read(json.load(open(a.hand_read, encoding="utf-8")), read_salt())
        except ValueError as e:
            # The message names the post and the value the merge can't read, never the post's own words.
            print(f"::error::{a.hand_read} refused: {e}", flush=True)
            return 1
        Path(a.out).write_text(json.dumps(rows))
        os.chmod(a.out, 0o600)
        stages = ", ".join(f"{name} {n:,}" for name, n in counts["stages"].items())
        print(f"{counts['records']:,} {counts['source']} records from {counts['rows']:,} rows typed in by hand in {a.out}; "
              f"records with each form's steps: {stages}; {counts['left_behind']:,} other values (group, notes) left behind")
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
        sources = stamp_sources(db, records, stamp=stamp_freshness)
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

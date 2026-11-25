#!/usr/bin/env python3
"""Does an AI answer that searches the web cite this site for the questions people ask? (Batch 9, Nov 25 2026)

Once a week a fixed set of questions people ask about PERM, wage requests, the visa bulletin and USCIS waits goes to
Gemini with Grounding with Google Search, and each answer's sources (groundingMetadata.groundingChunks) are read: is
permtracker.app among them, and which sites are. It stands in for AI answers in general: Google's own grounded model is
the nearest thing to an AI Overview that an API answers. perm_docs['ai_answer_checks'] holds the newest week and the
morning report prints it. No question names the site, which would lead the answer.

The key is read from the app's environment file by name and never printed. Grounded requests are free up to 500 a day
on the free tier (Google's pricing page, read Nov 25 2026); this asks ten a week. It exits 1, so the alarm emails, only
when no question got an answer.

    python3 scripts/check_ai_answers.py [--dry-run] [--keys-file PATH]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT = "check_ai_answers.py"
DOC_KEY = "ai_answer_checks"
MODEL = "gemini-2.5-flash"
SITE = "permtracker.app"
KEYS_FILE = "/srv/permtracker/app/env/production.env"
QUESTIONS = (
    "How long does PERM labor certification take right now?",
    "How do I check the status of my PERM case?",
    "How long is DOL taking to issue prevailing wage determinations?",
    "What does analyst review mean for a pending PERM application?",
    "Which companies sponsor the most green cards through PERM?",
    "Where is the EB-2 India cutoff date in the latest visa bulletin?",
    "How can I get an email when my PERM case status changes?",
    "What does a PERM case number starting with G-100 mean?",
    "Which receipt numbers is USCIS processing now for I-485 cases?",
    "How long does an I-140 take with premium processing?",
)


def _domain(text: str) -> str:
    host = urllib.parse.urlparse(text).hostname if "://" in text else text
    host = (host or "").strip().lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def sources_of(response: dict) -> list[str]:
    """The domains an answer cites, in order, once each. Google's grounding gives a redirect address and the site's
    domain as the title; where the address is the site's own, it names the site."""
    out: list[str] = []
    for cand in response.get("candidates") or []:
        for chunk in (cand.get("groundingMetadata") or {}).get("groundingChunks") or []:
            web = chunk.get("web") or {}
            uri, title = str(web.get("uri") or ""), str(web.get("title") or "")
            host = _domain(uri)
            name = host if host and "vertexaisearch" not in host else _domain(title)
            if name and "." in name and " " not in name and name not in out:
                out.append(name)
    return out


def cited(domains: list[str]) -> bool:
    return any(d == SITE or d.endswith("." + SITE) for d in domains)


def ask(question: str, key: str) -> tuple[str, dict]:
    body = json.dumps({"contents": [{"parts": [{"text": question}]}], "tools": [{"google_search": {}}]}).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        body, {"x-goog-api-key": key, "Content-Type": "application/json", "User-Agent": "permtracker-ai-answers/1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return "ok", json.load(r)
    except urllib.error.HTTPError as e:
        return f"error {e.code}", {}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return f"error {type(e).__name__}", {}


def make_doc(rows: list[dict], *, day: str, model: str) -> dict:
    answered = [r for r in rows if r["status"] == "ok"]
    return {"day": day, "model": model, "asked": len(answered), "cited": sum(1 for r in answered if r["cited"]),
            "failed": len(rows) - len(answered), "results": rows}


def all_failed(rows: list[dict]) -> bool:
    return not any(r["status"] == "ok" for r in rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="ask and print, write nothing")
    ap.add_argument("--keys-file", default=KEYS_FILE)
    args = ap.parse_args()
    started = time.time()
    from check_chat_models import read_keys  # noqa: PLC0415 - the one reader of the app's keys
    from lib_days import today_et  # noqa: PLC0415

    key = read_keys(args.keys_file).get("google", "")
    if not key:
        print("no Google key in the app's environment file")
        return _finish(None, "failed", "no Google key", started, args.dry_run)
    rows = []
    for q in QUESTIONS:
        status, resp = ask(q, key)
        domains = sources_of(resp) if status == "ok" else []
        rows.append({"q": q, "status": status, "cited": cited(domains), "sources": domains[:8]})
        time.sleep(2)
    doc = make_doc(rows, day=today_et().isoformat(), model=MODEL)
    print(f"{doc['cited']} of {doc['asked']} answers cite {SITE}" + (f"; {doc['failed']} failed" if doc["failed"] else ""))
    if all_failed(rows):
        return _finish(None, "failed", f"no question got an answer ({rows[0]['status']})", started, args.dry_run)
    return _finish(doc, "ok", f"{doc['cited']} of {doc['asked']} cite the site", started, args.dry_run)


def _finish(doc: dict | None, status: str, note: str, started: float, dry_run: bool) -> int:
    if dry_run:
        if doc:
            print(json.dumps(doc, indent=1))
        return 0 if status == "ok" else 1
    from lib_db import Database, record_run, write_doc  # noqa: PLC0415

    db = Database()
    if doc:
        write_doc(db, DOC_KEY, doc)
    record_run(db, SCRIPT, status=status, note=note, started_at=started)
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

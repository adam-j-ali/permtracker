#!/usr/bin/env python3
"""check_ai_answers.py: reading an answer's sources and whether this site is among them.

    python3 scripts/test_check_ai_answers.py   (exit 1 on any failure)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_ai_answers as ca  # noqa: E402

failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def answer(*chunks: dict) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": "An answer."}]},
                            "groundingMetadata": {"groundingChunks": list(chunks)}}]}


def test_sources() -> None:
    # Google's grounding gives each source a redirect address and the site's domain as its title.
    got = ca.sources_of(answer(
        {"web": {"uri": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", "title": "permtracker.app"}},
        {"web": {"uri": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/def", "title": "www.dol.gov"}},
        {"web": {"uri": "https://flag.dol.gov/processingtimes", "title": "Processing Times"}},
        {"web": {"uri": "https://vertexaisearch.cloud.google.com/x", "title": "dol.gov"}},
        {"retrievedContext": {"uri": "gs://nothing"}},
    ))
    check(got == ["permtracker.app", "dol.gov", "flag.dol.gov"], f"domains from titles or addresses, once each, www off ({got})")
    check(ca.cited(got), "this site among them is a citation")
    check(not ca.cited(["dol.gov", "notpermtracker.app.example.com"]), "a lookalike domain isn't this site")
    check(ca.cited(["blog.permtracker.app"]), "a subdomain of this site counts")
    check(ca.sources_of({"candidates": [{}]}) == [] and ca.sources_of({}) == [], "an answer with no sources gives none")


def test_doc() -> None:
    rows = [
        {"q": "How long does PERM take?", "status": "ok", "cited": True, "sources": ["permtracker.app", "dol.gov"]},
        {"q": "How do I check my PERM case?", "status": "ok", "cited": False, "sources": ["dol.gov"]},
        {"q": "Which block is USCIS on?", "status": "error 429", "cited": False, "sources": []},
    ]
    doc = ca.make_doc(rows, day="2026-11-30", model="gemini-2.5-flash")
    check(doc["asked"] == 2 and doc["cited"] == 1, f"answered questions counted, a failed one apart ({doc})")
    check(doc["failed"] == 1 and doc["day"] == "2026-11-30", "the failed ask and the day are kept")
    check(ca.all_failed(rows) is False and ca.all_failed([rows[2]]) is True, "the run fails only when nothing answered")


def test_questions() -> None:
    check(len(ca.QUESTIONS) >= 8 and len(set(ca.QUESTIONS)) == len(ca.QUESTIONS), "a fixed set of distinct questions")
    check(not any("permtracker" in q.lower() for q in ca.QUESTIONS), "no question names this site (that would lead the answer)")


if __name__ == "__main__":
    for t in (test_sources, test_doc, test_questions):
        t()
    print(f"{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)

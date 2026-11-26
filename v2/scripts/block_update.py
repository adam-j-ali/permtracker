#!/usr/bin/env python3
"""Every USCIS receipt block's counts by form, sent to Convex after a sample load, so the people who follow a block
hear when it moves (convex/blockAlerts.ts, POST /block-update). permtracker-uscis runs it after the load, the page
refresh and the edge purge. Counts only: no receipt number leaves the server.

    python3 scripts/block_update.py <sample-figures.json>          # send
    python3 scripts/block_update.py <sample-figures.json> --dry    # print the body, send nothing
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

BLOCK = re.compile(r"^IOE\d{5}$")
FORM = re.compile(r"^[A-Z]{1,3}-\d{1,4}[A-Z]{0,2}$")
BLOCK_NUMBERS = 100_000
EVERY = 0.9995  # the site's own rule (blockCoverage in src/lib/uscisSample.ts)


def block_body(figures: dict) -> dict:
    """The update's body: each block's checked count, whether every number is checked, and each form's counts."""
    blocks = []
    for block, entry in sorted((figures.get("by_block") or {}).items()):
        if not BLOCK.match(str(block)) or not isinstance(entry, dict):
            continue
        checked = int(entry.get("_checked") or 0)
        walked = float(entry.get("_walked_share") or 0)
        by_form = {}
        for form, row in entry.items():
            if not FORM.match(form) or not isinstance(row, dict):
                continue
            g = row.get("groups") or {}
            n = lambda k: int((g.get(k) or {}).get("count") or 0)  # noqa: E731
            by_form[form] = {"total": int(row.get("counted") or 0), "approved": n("approved"),
                             "denied": n("denied") + n("revoked"), "rfe": n("rfe"), "waiting": n("waiting")}
        if by_form:
            share = max(walked, min(1.0, checked / BLOCK_NUMBERS))
            blocks.append({"block": block, "every": share >= EVERY, "checked": checked, "byForm": by_form})
    return {"asOf": str(figures.get("as_of") or "")[:10], "blocks": blocks}


def convex_site() -> str:
    site = os.environ.get("CONVEX_SITE_URL", "").strip()
    if not site:
        site = os.environ.get("NEXT_PUBLIC_CONVEX_URL", "").strip().replace(".convex.cloud", ".convex.site")
    if not site.startswith("https://"):
        raise SystemExit("CONVEX_SITE_URL (or NEXT_PUBLIC_CONVEX_URL) is not set")
    return site.rstrip("/")


def send(body: dict) -> dict:
    secret = os.environ.get("WATCHED_CASES_SECRET", "").strip()
    if not secret and os.environ.get("WATCHED_CASES_SECRET_FILE"):
        secret = Path(os.environ["WATCHED_CASES_SECRET_FILE"]).read_text().strip()
    if not secret:
        raise SystemExit("WATCHED_CASES_SECRET is not set")
    req = urllib.request.Request(convex_site() + "/block-update", method="POST", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json",
                                          "User-Agent": "permtracker-blocks/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def main(argv: list[str]) -> int:
    if not argv or len(argv) > 2:
        print("usage: block_update.py <sample-figures.json> [--dry]")
        return 2
    with open(argv[0]) as f:
        body = block_body(json.load(f))
    if not body["asOf"]:
        print("the figures carry no as_of day; nothing sent")
        return 1
    if argv[1:] == ["--dry"]:
        print(json.dumps({"asOf": body["asOf"], "blocks": len(body["blocks"])}))
        return 0
    got = send(body)
    print(f"block update: {got.get('stored', 0)} blocks stored, {got.get('scheduled', 0)} with followers")
    return 0 if got.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

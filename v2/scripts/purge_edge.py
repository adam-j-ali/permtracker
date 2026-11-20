#!/usr/bin/env python3
"""Drop Cloudflare's copies of the pages a sweep just refreshed, so readers get the new figures at once.

The sweep runner (oracle/bin/permtracker-sweep) calls this after /api/revalidate-sweep, with that route's answer: its
`paths` are the pages it expired. nginx tags every copy Cloudflare stores with its own path (`pg:<path>`,
$pt_cache_tag in oracle/nginx/permtracker.conf), the page and its navigation data alike, so one purge by tag drops
both. A purge by address would miss the navigation data, whose `_rsc` token can't be listed. Without this, a page's
copy at the edge stays up to 10 minutes after the sweep, and an open page's redraw can fetch the old figures.

    python3 scripts/purge_edge.py <answer.json>

The token (Zone.Cache Purge on permtracker.app only) and the zone id are read from PT_PURGE_ENV, by default
/etc/permtracker/purge.env, and never printed. With no file there, it says so and changes nothing: the copies then
age out on their own. A refused purge exits 1, so the run that called it ends red.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import sys
import time
import urllib.request
from typing import Callable

# The characters a page tag may hold; nginx's $pt_cache_tag uses the same class, and Cloudflare takes printable ASCII.
TAG_PATH = re.compile(r"^/[A-Za-z0-9/_.~-]*$")
TAGS_PER_REQUEST = 100  # Cloudflare's most per purge request, on every plan
UA = "PERMTracker-edge-purge/1.0 (+https://permtracker.app)"
DEFAULT_ENV = "/etc/permtracker/purge.env"


def page_tag(path: str) -> str | None:
    """The tag nginx gives a stored copy of `path`, or None for an address it leaves untagged."""
    return f"pg:{path}" if TAG_PATH.match(path or "") else None


def paths_from_answer(text: str) -> list[str]:
    """The pages /api/revalidate-sweep expired, from its answer; none when the answer can't be read."""
    try:
        paths = json.loads(text).get("paths")
    except (json.JSONDecodeError, AttributeError):
        return []
    return [p for p in paths if isinstance(p, str)] if isinstance(paths, list) else []


def read_env(path: pathlib.Path) -> dict[str, str]:
    """KEY=VALUE lines, quotes trimmed; empty when the file isn't there or can't be read."""
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return {}
    out: dict[str, str] = {}
    for line in lines:
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


Opener = Callable[[urllib.request.Request], dict]


def _post(req: urllib.request.Request) -> dict:
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def purge(tags: list[str], token: str, zone: str, post: Opener = _post, pause: float = 10.0) -> tuple[int, int]:
    """Purge `tags` in requests of TAGS_PER_REQUEST, each tried twice. Returns (requests sent, requests refused)."""
    sent = refused = 0
    for i in range(0, len(tags), TAGS_PER_REQUEST):
        body = json.dumps({"tags": tags[i:i + TAGS_PER_REQUEST]}).encode()
        ok = False
        for attempt in range(2):
            req = urllib.request.Request(
                f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache", data=body, method="POST",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": UA})
            try:
                ok = bool(post(req).get("success"))
            except Exception:  # noqa: BLE001 - a refusal is counted and named below, never raised
                ok = False
            if ok:
                break
            if attempt == 0:
                time.sleep(pause)  # Cloudflare's free plan allows 5 purges a minute
        sent += 1
        refused += 0 if ok else 1
    return sent, refused


def main(argv: list[str], post: Opener = _post) -> int:
    if len(argv) != 1:
        print("usage: purge_edge.py <answer.json>")
        return 2
    try:
        answer = pathlib.Path(argv[0]).read_text()
    except OSError:
        answer = ""
    paths = paths_from_answer(answer)
    tags = sorted({t for p in paths if (t := page_tag(p))})
    if not tags:
        print("edge purge: no pages in the answer; nothing to purge")
        return 0
    env = read_env(pathlib.Path(os.environ.get("PT_PURGE_ENV", DEFAULT_ENV)))
    token, zone = env.get("CF_PURGE_TOKEN"), env.get("CF_ZONE_ID")
    if not token or not zone:
        print("edge purge: no Cloudflare purge token here; the copies at the edge age out within 10 minutes")
        return 0
    sent, refused = purge(tags, token, zone, post)
    print(f"edge purge: {len(tags)} pages in {sent} request(s), {refused} refused")
    return 1 if refused else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

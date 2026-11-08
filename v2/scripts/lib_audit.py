"""The key this site's own audit scripts send to skip the per-address limits.

The server's front door (scripts/oracle/nginx/permtracker.conf) exempts a
request whose `x-permtracker-audit` header matches the audit key from the
per-address rate limits, so an audit that walks hundreds of pages isn't
answered 429. The key lives in `.env.local` (mode 600) or the environment,
never in this public repo; a header that merely existed would be a bypass
for anyone. Without it the scripts still run, at the rate any client gets.
"""
from __future__ import annotations

import os
import pathlib
import threading
import time
import urllib.parse
import urllib.request

HEADER = "x-permtracker-audit"
_ENV_FILE = pathlib.Path(__file__).resolve().parent.parent / ".env.local"


def audit_key() -> str | None:
    value = os.environ.get("PERMTRACKER_AUDIT_KEY", "").strip()
    if value:
        return value
    try:
        for line in _ENV_FILE.read_text().splitlines():
            if line.startswith("PERMTRACKER_AUDIT_KEY="):
                return line.split("=", 1)[1].strip().strip('"') or None
    except OSError:
        return None
    return None


def audit_headers() -> dict[str, str]:
    """The header to add to a request, or nothing when no key is configured."""
    key = audit_key()
    return {HEADER: key} if key else {}


# Cloudflare's flood backstop (the zone's one rate-limit rule) blocks an address for 10 s once it
# sends 500 requests in 10 s, and the audit key is honoured only by nginx, behind it. The link check
# sent about 130 a second from one GitHub runner (Nov 8 2026) and 576 of its fetches came back 429.
# Requests to any host but this machine are spaced to PACE_PER_SECOND, half that limit, across
# every thread in the process.
PACE_PER_SECOND = 25
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_pace_lock = threading.Lock()
_next_slot = 0.0


def pace(url: str) -> None:
    """Wait for this request's turn when it goes to a remote site."""
    global _next_slot
    host = urllib.parse.urlsplit(url).hostname or ""
    if host in _LOCAL_HOSTS or host.endswith(".localhost"):
        return
    with _pace_lock:
        now = time.monotonic()
        slot = max(now, _next_slot)
        _next_slot = slot + 1 / PACE_PER_SECOND
    if slot > now:
        time.sleep(slot - now)


def audit_urlopen(req: urllib.request.Request, timeout: float):
    """urllib's urlopen, paced for a remote site."""
    pace(req.full_url)
    return urllib.request.urlopen(req, timeout=timeout)

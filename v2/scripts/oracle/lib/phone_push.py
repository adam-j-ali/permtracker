"""A push to the owner's phone (ntfy), sent beside a server alarm's email and never instead of it.

Every push uses one template: what happened, since when (Eastern), and what to do. It goes once when an alarm
starts and once when it clears. No push carries an IP address, an email address or a receipt-shaped number.

The topic lives in /etc/permtracker/phone.env (one line, NTFY_TOPIC=..., root 600) and never in this repository.
Installed as /usr/local/lib/permtracker/phone_push.py; the scripts fall back to this folder when run from the
repository (the tests). Tested in scripts/oracle/test_phone_push.py.
"""
from __future__ import annotations

import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PHONE_ENV = Path("/etc/permtracker/phone.env")
NTFY_URL = "https://ntfy.sh/"
ET = ZoneInfo("America/New_York")
USER_AGENT = "permtracker-alarm/1.0 (+https://permtracker.app)"
# ntfy's priorities: urgent and high ring through, default is a quiet note (a clear).
PRIORITY = {"urgent": "urgent", "high": "high", "clear": "default"}

# Simple tokens, each judged in code, so no pattern can backtrack on a long input (the defense quotes browser
# labels a stranger chose); and a cap on the text before any of it.
MAX_TEXT = 2000
_RECEIPT = re.compile(r"\b[A-Za-z]{3}\*?\d{9,}\b")
_IPV4 = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
_AT = re.compile(r"[\w.+-]+@[\w.-]+")
_HEX = re.compile(r"[0-9A-Fa-f:]{3,}")
_RANGE = re.compile(r"an address/\d{1,3}\b")  # a range's /24 goes with its address
_HEX_GROUP = re.compile(r"[0-9A-Fa-f]{1,4}")
# A systemd unit (permtracker-web@1.service) has an @ and a dot too, and is no address.
UNIT_SUFFIXES = ("service", "timer", "socket", "target", "mount", "path")


def _email(m: re.Match) -> str:
    word = m[0]
    core = word.rstrip(".")
    domain = core.split("@", 1)[1]
    top = domain.rsplit(".", 1)[-1] if "." in domain else ""
    if len(top) >= 2 and top.isalpha() and top.lower() not in UNIT_SUFFIXES:
        return "an email address" + word[len(core):]
    return word


def _ipv6(m: re.Match) -> str:
    word = addr = m[0]
    groups = addr.split(":")
    if addr.count("::") > 1 or len(groups) > 8 or ":::" in addr:
        return word
    filled = [g for g in groups if g]
    if not all(_HEX_GROUP.fullmatch(g) for g in filled):
        return word
    # Four or more groups, or a "::" shortening; a clock time (12:05:30) has three and no "::".
    if ("::" in addr and filled) or len(groups) >= 4:
        return "an address"
    return word


def scrub(text: str) -> str:
    """The text with every email address, receipt-shaped number and IP address replaced by a plain word."""
    text = str(text)[:MAX_TEXT]
    text = _AT.sub(_email, text)
    text = _RECEIPT.sub("a receipt number", text)
    text = _IPV4.sub("an address", text)
    return _RANGE.sub("an address", _HEX.sub(_ipv6, text))


def stamp(ts: float) -> str:
    """A Unix time as Eastern 12-hour time with its weekday, e.g. 'Mon Nov 23, 8:05 AM EST'."""
    return datetime.fromtimestamp(ts, ET).strftime("%a %b %-d, %-I:%M %p %Z")


def started(what: str, since: float, todo: str) -> str:
    """The push for an alarm that started: what, since when, what to do."""
    return scrub(f"{what} Since {stamp(since)}. {todo}".strip())


def cleared(what: str, since: float) -> str:
    """The push for an alarm that cleared: what is fine again, and how long it lasted from."""
    return scrub(f"{what}. It had started {stamp(since)}.")


def topic(env: Path = PHONE_ENV) -> str | None:
    try:
        m = re.search(r"^NTFY_TOPIC=[\"']?([A-Za-z0-9_-]{8,64})[\"']?\s*$", env.read_text(), re.M)
    except OSError:
        return None
    return m[1] if m else None


def push(title: str, message: str, level: str, env: Path = PHONE_ENV) -> tuple[bool, str]:
    """One push. (True, "") when ntfy took it, else (False, why) for the caller's log line."""
    t = topic(env)
    if not t:
        return False, f"no NTFY_TOPIC in {env}"
    req = urllib.request.Request(
        NTFY_URL + t, data=scrub(message).encode(), method="POST",
        headers={"Title": scrub(title), "Priority": PRIORITY.get(level, "high"),
                 "Tags": "white_check_mark" if level == "clear" else "warning", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = 200 <= r.status < 300
            return ok, "" if ok else f"ntfy answered {r.status}"
    except (urllib.error.URLError, OSError) as exc:
        return False, f"ntfy unreachable ({exc.__class__.__name__})"

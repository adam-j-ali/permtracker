#!/usr/bin/env python3
"""The site's own full audit: every page in the sitemap, read once a week on the server itself.

WHY. Ahrefs' free Site Audit reads at most 5,000 pages a crawl, and the sitemap lists about 182,700 (Nov 21 2026).
Its crawl of that night saw under 3% of the site, met the front door's limits and counted the gaps its own cap left
as problems. This reads every sitemap page through nginx on the server (127.0.0.1:8081, the same front door
cloudflared talks to, so no Cloudflare and no network), a seventh of the sitemap each night, so the whole site is
read every week with no outside limit.

FOR EACH PAGE it records the HTTP status (a redirect's target too, followed on the site only), the time to the last
byte, the HTML's size, the title and description and their lengths, the canonical, the robots rules (meta tags and
the X-Robots-Tag header), the JSON-LD blocks that don't parse or name no @type (the site's own schema tests are
TypeScript, so this parses and checks the types only), and every link to another page of the site, as a path.

EACH NIGHT, after its pages, it works out over the sitemap's pages read in the last 8 days: the pages that don't
answer 200, the orphans (no page read links to them), titles over 60 or under 20 characters, descriptions under 110
or over 160 (the owner's lines, Nov 21 2026), pages over 1.5 MB of HTML, pages that took over 2 seconds, and
noindex or canonical-elsewhere pages in the sitemap. On Sunday night, the week's last, that is the weekly report.

KEEPING OUT OF THE WAY. Two requests at a time and at most four a second, from 9:30 PM to 12:45 AM Eastern: after
the 8:10 PM sweep and before the 1 to 5 AM deploys, backups and the 4:10 AM sweep. Before each page it waits while
a deploy is under way, a DOL sweep is running or the server's load is past one and a half per CPU. A refusal (429
or 503) is asked again after the wait the server names, and a page the front door kept refusing counts as
"unread". A night that runs out of time leaves the rest to the next nights, which read any page more than a week old
after their own seventh, the oldest first.

STATE lives in the database (lib_db): `site_audit_pages` (one row per page, its latest read) and `site_audit_links`
(one row per link target, when a read page last linked to it), both created here, and perm_docs['site_audit'] (the
last night, the current counts, the weekly reports and the email's state). Rows unread for 30 days are removed.

OUTPUT. The morning report's "Site audit" section reads perm_docs['site_audit'] (daily_monitor.py). The owner gets
an email only when a weekly count rises or a new kind of problem appears, through the mail Worker (its key is the
systemd credential `owner-mail`); an email that couldn't go is kept and tried again each night.

    python3 scripts/site_audit.py                          # tonight's seventh (permtracker-site-audit.timer)
    python3 scripts/site_audit.py --report                 # the counts over the sitemap now, reading no page
    python3 scripts/site_audit.py --list orphan            # every sitemap page in one family
    python3 scripts/site_audit.py --paths /a /b --dry-run  # read a few pages, write nothing
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html as html_mod
import http.client
import json
import os
import pathlib
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import quote, unquote, urljoin, urlsplit
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

ET = ZoneInfo("America/New_York")
SCRIPT = "site_audit.py"
DOC_KEY = "site_audit"
PAGES = "site_audit_pages"
LINKS = "site_audit_links"

SITE_HOST = "permtracker.app"
SITE_HOSTS = frozenset({SITE_HOST, "www." + SITE_HOST})
BASE = "http://127.0.0.1:8081"  # nginx on the server (scripts/oracle/nginx/permtracker.conf, `listen`)
USER_AGENT = "permtracker-site-audit/1.0 (+https://permtracker.app)"  # Cloudflare refuses Python's own (the Worker)
DEPLOY_MARK = pathlib.Path("/srv/permtracker/health/deploying")  # written by permtracker-deploy while it runs
DEPLOY_MARK_MAX_S = 1200  # an older mark is a deploy that died; the watchdog reads it the same way

# The rules (the owner's lines, Nov 21 2026). Lengths are characters as a reader sees them: entities decoded and
# runs of spaces as one. 1.5 MB leaves room under the 2 MB Googlebot reads (PAGE_MAX_BYTES in audit_all_pages.py).
TITLE_MIN, TITLE_MAX = 20, 60
DESC_MIN, DESC_MAX = 110, 160
BIG_BYTES = 1_500_000
SLOW_MS = 2000

# Each kind of problem, in the order a report lists them.
FAMILIES = {
    "error": "Sitemap pages that answer an error",
    "redirect": "Sitemap pages that redirect",
    "refused": "Sitemap pages the front door kept refusing",
    "unread": "Sitemap pages not read in the last 8 days",
    "orphan": "Sitemap pages no other page links to",
    "noindex": "Sitemap pages marked noindex",
    "non_canonical": "Sitemap pages whose canonical names another page",
    "canonical_missing": "Pages with no canonical",
    "title_missing": "Pages with no title",
    "title_long": "Titles over 60 characters",
    "title_short": "Titles under 20 characters",
    "desc_missing": "Pages with no description",
    "desc_long": "Descriptions over 160 characters",
    "desc_short": "Descriptions under 110 characters",
    "big": "Pages over 1.5 MB of HTML",
    "slow": "Pages that took over 2 seconds",
    "jsonld_bad": "Pages with structured data that doesn't parse",
    "jsonld_untyped": "Pages with structured data that names no @type",
}
# Counts that move with the night's load: a rise counts only at NOISY_MIN pages and NOISY_SHARE of last week's.
NOISY = frozenset({"slow", "refused", "unread"})
NOISY_MIN = 10
NOISY_SHARE = 0.10

NIGHTS = 7
DAY_MS = 86_400_000
RESULT_DAYS = 8                      # a page's read counts in the report this long; a full pass is 7 nights
STRAGGLER_AFTER_MS = 7 * DAY_MS + 6 * 3_600_000  # older than a week and a night's window: its own night was missed
COMPLETE_SHARE = 0.95                # a week that read less of the sitemap is reported without a comparison
KEEP_DAYS = 30                       # rows unread this long are removed
WEEKS_KEPT = 8
EXAMPLES = 10

WORKERS = 2
RATE = 4.0                           # requests a second, all workers together
LOAD_FACTOR = 1.5                    # wait while the 1-minute load is past this many per CPU
CHECK_EVERY_S = 30                   # how often the busy signs are read while all is quiet
POLL_S = 60                          # and while waiting
TRIES = 3
RETRY_CODES = frozenset({0, 429, 502, 503, 504})
RETRY_WAITS_S = (10, 30)
RETRY_AFTER_MAX_S = 60
MAX_HOPS = 5
TIMEOUT_S = 60
CHECKPOINT = 200                     # pages written to the database at a time
READ_PAGE = 5000                     # rows a read asks for at a time
UNTIL = "00:45"
MAX_MINUTES = 240


# ── paths and the nightly slice ────────────────────────────────────────────

_PATH_SAFE = "/:@!$&'()*+,;=-._~"


def norm_path(href: str | None, base: str = "/") -> str | None:
    """A link, a canonical or a sitemap address as this site's path; None for anything off the site.

    One rule for every side of every comparison (a link, the sitemap, a canonical): the host is the site's, with or
    without www; the query and fragment go; the path is spelled one way (decoded, then encoded again) and has no
    trailing slash but the root's.
    """
    href = (href or "").strip()
    if not href or href.startswith("#"):
        return None
    try:
        parts = urlsplit(urljoin(f"https://{SITE_HOST}{base}", href))
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or host not in SITE_HOSTS:
        return None
    path = quote(unquote(parts.path or "/"), safe=_PATH_SAFE)
    if not path.startswith("/"):
        path = "/" + path
    return path.rstrip("/") or "/"


def slice_of(path: str) -> int:
    """The night of the week a page is read on, from its path alone, so it never moves when other pages come and go."""
    return int.from_bytes(hashlib.sha1(path.encode()).digest()[:4], "big") % NIGHTS


def night_of(day: dt.date) -> int:
    """Tonight's slice: Monday 0 to Sunday 6, so Sunday's night closes the week."""
    return day.weekday()


def plan_night(sitemap: list[str], last_read: dict[str, int], day: dt.date, now_ms: int, *,
               stragglers: bool = True) -> tuple[list[str], list[str]]:
    """Tonight's seventh in sitemap order, then the pages a missed night left behind, the never-read and oldest first."""
    k = night_of(day)
    slices = {p: slice_of(p) for p in sitemap}
    tonight = [p for p in sitemap if slices[p] == k]
    if not stragglers:
        return tonight, []
    cutoff = now_ms - STRAGGLER_AFTER_MS
    behind = [p for p in sitemap if slices[p] != k and (last_read.get(p) or 0) < cutoff]
    behind.sort(key=lambda p: last_read.get(p) or 0)
    return tonight, behind


# ── reading a page ─────────────────────────────────────────────────────────


class _Page(HTMLParser):
    """The head's title, description, canonical and robots, the JSON-LD blocks, and every <a href>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title: str | None = None
        self.description: str | None = None
        self.canonical: str | None = None
        self.robots: list[str] = []
        self.links: list[str] = []
        self.jsonld: list[str] = []
        self._title: list[str] | None = None
        self._ld: list[str] | None = None
        self._svg = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "svg":
            self._svg += 1
        elif tag == "title" and self.title is None and self._title is None and not self._svg:
            self._title = []
        elif tag == "meta":
            name = a.get("name", "").lower()
            if name == "description" and self.description is None:
                self.description = a.get("content", "")
            elif name in ("robots", "googlebot"):
                self.robots.append(a.get("content", ""))
        elif tag == "link" and "canonical" in a.get("rel", "").lower().split() and self.canonical is None:
            self.canonical = a.get("href", "")
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "script" and a.get("type", "").strip().lower() == "application/ld+json":
            self._ld = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "svg" and self._svg:
            self._svg -= 1
        elif tag == "title" and self._title is not None:
            self.title = "".join(self._title)
            self._title = None
        elif tag == "script" and self._ld is not None:
            self.jsonld.append("".join(self._ld))
            self._ld = None

    def handle_data(self, data: str) -> None:
        if self._title is not None:
            self._title.append(data)
        elif self._ld is not None:
            self._ld.append(data)


def _plain(s: str | None) -> str | None:
    return None if s is None else re.sub(r"\s+", " ", s).strip()


# Next's inline scripts (the page's data for the browser) and styles are half a page's bytes and hold nothing read
# here, so they're dropped before parsing, the JSON-LD blocks kept: 35 ms against 48 for the homepage and 71 against
# 119 for an employer page on the old Mac, with the same result (measured Nov 21 2026).
_NOISE = re.compile(r"<script\b(?![^>]*application/ld\+json)[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>",
                    re.S | re.I)


def parse_html(text: str) -> dict:
    p = _Page()
    p.feed(_NOISE.sub("", text))
    p.close()
    if p._title is not None and p.title is None:  # an unclosed <title>
        p.title = "".join(p._title)
    return {"title": _plain(p.title), "description": _plain(p.description), "canonical": p.canonical,
            "robots": "; ".join(r.strip() for r in p.robots if r.strip()), "links": p.links, "jsonld": p.jsonld}


def internal_links(hrefs: list[str], page_path: str) -> set[str]:
    """The site's own pages a page links to, as paths, itself left out."""
    out = {norm_path(h, page_path) for h in hrefs}
    out.discard(None)
    out.discard(page_path)
    return out  # type: ignore[return-value]


def jsonld_check(blocks: list[str]) -> tuple[int, int, list[str]]:
    """(blocks that don't parse, items with no @type, every @type named). An item is a top-level object, each
    object of a top-level array, or each object of an @graph."""
    bad = untyped = 0
    types: set[str] = set()
    for raw in blocks:
        try:
            data = json.loads(raw)
        except ValueError:
            bad += 1
            continue
        items = data if isinstance(data, list) else data.get("@graph") if isinstance(data, dict) and "@graph" in data else [data]
        for item in items if isinstance(items, list) else [items]:
            t = item.get("@type") if isinstance(item, dict) else None
            names = [t] if isinstance(t, str) else [x for x in t if isinstance(x, str)] if isinstance(t, list) else []
            if not names:
                untyped += 1
            types.update(names)
    return bad, untyped, sorted(types)


def noindex(robots: str | None) -> bool:
    """Whether the rules keep the page out of the index. `none` is noindex and nofollow, and the X-Robots-Tag header
    carries the same rules as the meta tag, optionally after a crawler's name
    (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag, read Nov 21 2026)."""
    words = set(re.findall(r"[a-z_-]+", (robots or "").lower()))
    return bool(words & {"noindex", "none"})


def page_record(path: str, f: dict, now_ms: int) -> dict:
    """One page's row: what the fetch saw, what its HTML says, and the problems the rules find."""
    rec = {"path": path, "slice": slice_of(path), "checkedAt": now_ms, "status": int(f.get("status") or 0),
           "finalStatus": f.get("finalStatus"), "finalPath": f.get("finalPath") or f.get("finalUrl"),
           "hops": int(f.get("hops") or 0), "ms": int(f.get("ms") or 0), "bytes": int(f.get("bytes") or 0),
           "cache": f.get("cache"), "title": None, "titleLen": None, "descLen": None, "canonical": None,
           "robots": None, "jsonldBad": 0, "jsonldUntyped": 0, "jsonldTypes": "", "linkCount": 0,
           "links": set(), "error": f.get("error"), "tries": int(f.get("tries") or 1)}
    text = f.get("html")
    if rec["status"] == 200 and text is not None:
        p = parse_html(text)
        header = (f.get("headers") or {}).get("x-robots-tag") or ""
        robots = "; ".join(x for x in (p["robots"], header.strip()) if x)
        bad, untyped, types = jsonld_check(p["jsonld"])
        links = internal_links(p["links"], path)
        canon = p["canonical"]
        rec.update(title=p["title"], titleLen=len(p["title"] or ""), descLen=len(p["description"] or ""),
                   canonical=None if canon is None else norm_path(canon, path) or canon.strip(),
                   robots=robots or None, jsonldBad=bad, jsonldUntyped=untyped, jsonldTypes=",".join(types)[:300],
                   links=links, linkCount=len(links))
    rec["problems"] = problems_of(rec)
    if not {"title_long", "title_short"} & set(rec["problems"]):
        rec["title"] = None  # kept only where it's the finding
    return rec


def problems_of(rec: dict) -> list[str]:
    s = rec["status"]
    if s == 429:
        return ["refused"]
    if 300 <= s < 400:
        return ["redirect"]
    if s != 200:
        return ["error"]
    out: set[str] = set()
    if rec["bytes"] > BIG_BYTES:
        out.add("big")
    if rec["ms"] > SLOW_MS:
        out.add("slow")
    if rec["titleLen"] is not None:  # an HTML page
        t, d = rec["titleLen"], rec["descLen"] or 0
        out.add("title_missing" if t == 0 else "title_short" if t < TITLE_MIN else "title_long" if t > TITLE_MAX else "")
        out.add("desc_missing" if d == 0 else "desc_short" if d < DESC_MIN else "desc_long" if d > DESC_MAX else "")
        if noindex(rec["robots"]):
            out.add("noindex")
        if not rec["canonical"]:
            out.add("canonical_missing")
        elif rec["canonical"] != rec["path"]:
            out.add("non_canonical")
        if rec["jsonldBad"]:
            out.add("jsonld_bad")
        if rec["jsonldUntyped"]:
            out.add("jsonld_untyped")
    return [k for k in FAMILIES if k in out]


# ── fetching through the front door ────────────────────────────────────────


class Upstream:
    """GETs to the site through one address with the site's own Host header, a kept-alive connection per thread.
    http.client sends Accept-Encoding: identity, so a body's length is the HTML's own size."""

    def __init__(self, base: str = BASE, *, host: str = SITE_HOST, headers: dict | None = None,
                 timeout: float = TIMEOUT_S) -> None:
        u = urlsplit(base)
        self.https = u.scheme == "https"
        self.netloc = u.netloc
        self.host = host
        self.headers = dict(headers or {})
        self.timeout = timeout
        self._local = threading.local()

    def _conn(self) -> http.client.HTTPConnection:
        c = getattr(self._local, "conn", None)
        if c is None:
            cls = http.client.HTTPSConnection if self.https else http.client.HTTPConnection
            c = self._local.conn = cls(self.netloc, timeout=self.timeout)
        return c

    def _drop(self) -> None:
        c = getattr(self._local, "conn", None)
        if c is not None:
            c.close()
        self._local.conn = None

    def get(self, path: str) -> dict:
        hdrs = {"Host": self.host, "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                **self.headers}
        for attempt in (1, 2):
            started = time.monotonic()
            try:
                conn = self._conn()
                conn.request("GET", path, headers=hdrs)
                resp = conn.getresponse()
                body = resp.read()
                ms = int((time.monotonic() - started) * 1000)
                if resp.will_close:
                    self._drop()
                return {"status": resp.status, "headers": {k.lower(): v for k, v in resp.getheaders()},
                        "body": body, "ms": ms, "error": None}
            except (http.client.HTTPException, OSError) as e:
                self._drop()
                # A kept-alive connection the server closed between requests: once more on a new one.
                if attempt == 1 and isinstance(e, (http.client.RemoteDisconnected, BrokenPipeError, ConnectionResetError)):
                    continue
                return {"status": 0, "headers": {}, "body": b"", "ms": int((time.monotonic() - started) * 1000),
                        "error": f"{type(e).__name__}: {e}"[:200]}
        raise AssertionError("unreachable")  # pragma: no cover


def retry_wait(header: str | None, attempt: int) -> float:
    if header and header.strip().isdigit():
        return min(int(header.strip()), RETRY_AFTER_MAX_S)
    return RETRY_WAITS_S[min(attempt - 1, len(RETRY_WAITS_S) - 1)]


def fetch_page(up: Upstream, path: str, *, sleep=time.sleep, tries: int = TRIES) -> dict:
    """The page's own answer (status and time), asked again after a refusal, then any redirect followed on the site."""
    attempt = 0
    first: dict = {}
    while attempt < tries:
        attempt += 1
        first = up.get(path)
        if first["status"] not in RETRY_CODES or attempt == tries:
            break
        sleep(retry_wait(first["headers"].get("retry-after"), attempt))
    out = {"status": first["status"], "ms": first["ms"], "tries": attempt, "error": first["error"], "hops": 0,
           "finalUrl": None}
    cur: dict | None = first
    at: str | None = path
    while cur is not None and 300 <= cur["status"] < 400 and out["hops"] < MAX_HOPS:
        loc = cur["headers"].get("location")
        if not loc:
            break
        out["hops"] += 1
        nxt = norm_path(loc, at or "/")
        if nxt is None:
            out["finalUrl"] = urljoin(f"https://{SITE_HOST}{at}", loc)
            cur, at = None, None
            break
        at, cur = nxt, up.get(nxt)
    final = cur or {"status": None, "headers": {}, "body": b""}
    headers = final["headers"]
    is_html = "html" in (headers.get("content-type") or "")
    out.update(finalStatus=final["status"], finalPath=at, bytes=len(final["body"]), headers=headers,
               cache=headers.get("x-nextjs-cache"),
               html=final["body"].decode("utf-8", errors="replace") if final["status"] == 200 and is_html else None)
    return out


# ── the crawl ──────────────────────────────────────────────────────────────


class Pacer:
    """At most `rate` requests a second across every worker."""

    def __init__(self, rate: float, clock=time.monotonic, sleep=time.sleep) -> None:
        self.gap = 1.0 / rate
        self.next = 0.0
        self.clock, self.sleep = clock, sleep
        self.lock = threading.Lock()

    def wait(self, deadline: float) -> bool:
        with self.lock:
            now = self.clock()
            slot = max(now, self.next)
            if slot >= deadline:
                return False
            self.next = slot + self.gap
        if slot > now:
            self.sleep(slot - now)
        return True


def sweep_lines_active(text: str) -> bool:
    """Whether `systemctl list-units --state=active` lists a DOL sweep."""
    return any("permtracker-sweep@" in ln and " active " in f" {ln} " for ln in text.splitlines())


def _sweeping() -> bool:
    out = subprocess.run(["systemctl", "list-units", "--state=active", "--plain", "--no-legend", "--no-pager",
                          "permtracker-sweep@*"], capture_output=True, text=True, timeout=10)
    return sweep_lines_active(out.stdout)


def _deploying() -> bool:
    try:
        return time.time() - DEPLOY_MARK.stat().st_mtime < DEPLOY_MARK_MAX_S
    except OSError:
        return False


class Quiet:
    """Waits while the server is busy: a deploy, a DOL sweep, or load past LOAD_FACTOR a CPU. A sign that can't be
    read never holds the audit up."""

    def __init__(self, *, load=lambda: os.getloadavg()[0], cpus: int | None = None, sweeping=_sweeping,
                 deploying=_deploying, clock=time.monotonic, sleep=time.sleep) -> None:
        self.load, self.cpus = load, cpus or os.cpu_count() or 2
        self.sweeping, self.deploying = sweeping, deploying
        self.clock, self.sleep = clock, sleep
        self.lock = threading.Lock()
        self.checked = -1e18
        self.pauses = 0
        self.paused_s = 0.0
        self.reasons: Counter = Counter()

    def busy(self) -> str | None:
        for sign, why in ((self.deploying, "a deploy is under way"), (self.sweeping, "a DOL sweep is running")):
            try:
                if sign():
                    return why
            except Exception:  # noqa: BLE001 - unreadable means not known to be busy
                pass
        try:
            load = float(self.load())
        except Exception:  # noqa: BLE001
            return None
        if load > self.cpus * LOAD_FACTOR:
            return f"the server's load is {load:.1f} on {self.cpus} CPUs"
        return None

    def wait(self, deadline: float) -> bool:
        """True once the server is quiet; False when the deadline came first."""
        with self.lock:  # held while waiting, so every worker waits
            if self.clock() - self.checked < CHECK_EVERY_S:
                return True
            began: float | None = None
            while True:
                why = self.busy()
                self.checked = self.clock()
                if why is None:
                    if began is not None:
                        self.paused_s += self.checked - began
                    return True
                if began is None:
                    began = self.checked
                    self.pauses += 1
                    self.reasons["deploy" if "deploy" in why else "sweep" if "sweep" in why else "load"] += 1
                    print(f"  waiting: {why}", flush=True)
                if self.checked + POLL_S >= deadline:
                    self.paused_s += self.checked - began
                    return False
                self.sleep(POLL_S)


_DONE = object()


class Halt(Exception):
    """Raised by a result's handler to end the night early; its words are the reason."""


NO_ANSWER_STOP = 20


class NoAnswer:
    """Ends the night after NO_ANSWER_STOP pages in a row got no answer at all: the front door is down (the watchdog
    repairs it), and each page would otherwise wait out its retries until the window closes."""

    def __init__(self) -> None:
        self.streak = 0

    def see(self, rec: dict) -> None:
        self.streak = self.streak + 1 if rec.get("status") == 0 else 0
        if self.streak >= NO_ANSWER_STOP:
            raise Halt(f"the front door didn't answer {self.streak} pages in a row")


def crawl(paths, fetch, *, deadline: float, workers: int = WORKERS, rate: float = RATE, quiet=None,
          on_result, clock=time.monotonic) -> dict:
    """Read `paths` with `workers` at a time, paced to `rate` a second, until they're done or the deadline. Each
    result goes to `on_result` on this thread, in the order they finish; `on_result` raising Halt ends it early."""
    it = iter(paths)
    lock = threading.Lock()
    results: queue.Queue = queue.Queue()
    pacer = Pacer(rate, clock)
    state = {"stop": None, "crashes": 0}

    def stop(why: str) -> None:
        with lock:
            state["stop"] = state["stop"] or why

    def work() -> None:
        try:
            while state["stop"] is None:
                if clock() >= deadline or (quiet is not None and not quiet.wait(deadline)) or not pacer.wait(deadline):
                    stop("deadline")
                    break
                with lock:
                    path = next(it, None)
                if path is None:
                    break
                try:
                    results.put(fetch(path))
                except Exception as e:  # noqa: BLE001 - one page's crash never ends the night
                    with lock:
                        state["crashes"] += 1
                    print(f"  {path}: the read crashed ({type(e).__name__}: {e})", flush=True)
        finally:
            results.put(_DONE)

    threads = [threading.Thread(target=work, daemon=True) for _ in range(max(1, workers))]
    for t in threads:
        t.start()
    done = read = 0
    try:
        while done < len(threads):
            item = results.get()
            if item is _DONE:
                done += 1
                continue
            read += 1
            try:
                on_result(item)
            except Halt as h:
                stop(str(h) or "halted")  # the pages already in flight still come through
    except BaseException:
        stop("error")
        raise
    return {"read": read, "stoppedBy": state["stop"] or "done", "crashes": state["crashes"]}


# ── the tables ─────────────────────────────────────────────────────────────

PAGE_COLS = ("path", "slice", "checked_at", "status", "final_status", "final_path", "hops", "ms", "bytes", "cache",
             "title", "title_len", "desc_len", "canonical", "robots", "jsonld_bad", "jsonld_untyped", "jsonld_types",
             "link_count", "problems", "error")

DDL = [
    f"""CREATE TABLE IF NOT EXISTS {PAGES} (
        path TEXT PRIMARY KEY, slice INTEGER NOT NULL, checked_at INTEGER NOT NULL,
        status INTEGER NOT NULL, final_status INTEGER, final_path TEXT, hops INTEGER NOT NULL DEFAULT 0,
        ms INTEGER, bytes INTEGER, cache TEXT, title TEXT, title_len INTEGER, desc_len INTEGER,
        canonical TEXT, robots TEXT, jsonld_bad INTEGER, jsonld_untyped INTEGER, jsonld_types TEXT,
        link_count INTEGER, problems TEXT NOT NULL DEFAULT '', error TEXT)""",
    f"CREATE INDEX IF NOT EXISTS {PAGES}_checked ON {PAGES} (checked_at)",
    f"CREATE TABLE IF NOT EXISTS {LINKS} (path TEXT PRIMARY KEY, seen_at INTEGER NOT NULL, from_path TEXT)",
    f"CREATE INDEX IF NOT EXISTS {LINKS}_seen ON {LINKS} (seen_at)",
]


def ensure_tables(db) -> None:
    db.script(DDL)


def write_batch(db, recs: list[dict], now_ms: int) -> None:
    """The pages' rows, and each link target with when it was seen and one page that links to it."""
    from lib_db import insert_stmts, run_stmts  # noqa: PLC0415

    rows = [[r["path"], r["slice"], r["checkedAt"], r["status"], r.get("finalStatus"), r.get("finalPath"),
             r.get("hops") or 0, r.get("ms"), r.get("bytes"), r.get("cache"), r.get("title"), r.get("titleLen"),
             r.get("descLen"), r.get("canonical"), r.get("robots"), r.get("jsonldBad"), r.get("jsonldUntyped"),
             r.get("jsonldTypes"), r.get("linkCount"), ",".join(r.get("problems") or []), r.get("error")]
            for r in recs]
    seen: dict[str, str] = {}
    for r in recs:
        for target in sorted(r.get("links") or ()):
            if target != r["path"]:
                seen.setdefault(target, r["path"])
    links = [[t, now_ms, src] for t, src in seen.items()]
    stmts = [*insert_stmts(PAGES, PAGE_COLS, rows, per_stmt=100), *insert_stmts(LINKS, ("path", "seen_at", "from_path"), links)]
    run_stmts(db, stmts, per_request=20)


def load_reads(db) -> dict[str, tuple[int, list[str]]]:
    """Every page's latest read: when, and its problems. Read in pages of READ_PAGE rows by path."""
    from lib_db import query_rows  # noqa: PLC0415

    out: dict[str, tuple[int, list[str]]] = {}
    after = ""
    while True:
        rows = query_rows(db, f"SELECT path, checked_at, problems FROM {PAGES} WHERE path > ? ORDER BY path LIMIT ?",
                          [after, READ_PAGE])
        for path, at, probs in rows:
            out[path] = (int(at), [x for x in (probs or "").split(",") if x])
        if len(rows) < READ_PAGE:
            return out
        after = rows[-1][0]


def load_linked(db, since_ms: int) -> set[str]:
    """Every page some read page linked to since `since_ms`."""
    from lib_db import query_rows  # noqa: PLC0415

    out: set[str] = set()
    after = ""
    while True:
        rows = query_rows(db, f"SELECT path FROM {LINKS} WHERE path > ? AND seen_at >= ? ORDER BY path LIMIT ?",
                          [after, since_ms, READ_PAGE])
        out.update(r[0] for r in rows)
        if len(rows) < READ_PAGE:
            return out
        after = rows[-1][0]


def prune(db, before_ms: int, *, step: int = 2000) -> dict[str, int]:
    """Remove rows unread (or links unseen) since `before_ms`, `step` at a time, so no one write runs long."""
    removed = {}
    for key, table, col in (("pages", PAGES, "checked_at"), ("links", LINKS, "seen_at")):
        n = 0
        while True:
            res = db.execute(f"DELETE FROM {table} WHERE rowid IN (SELECT rowid FROM {table} WHERE {col} < ? LIMIT ?)",
                             [before_ms, step])
            got = int(((res.get("response") or {}).get("result") or {}).get("affected_row_count") or 0)
            n += got
            if got < step:
                break
        removed[key] = n
    return removed


# ── the report ─────────────────────────────────────────────────────────────


def build_report(sitemap: list[str], reads: dict[str, tuple[int, list[str]]], linked: set[str], now_ms: int) -> dict:
    """Each family's count and first examples over the sitemap's pages, from reads in the last RESULT_DAYS."""
    cutoff = now_ms - RESULT_DAYS * DAY_MS
    counts: Counter = Counter()
    examples: dict[str, list[dict]] = {}
    read = 0
    for p in sitemap:
        got = reads.get(p)
        if got is None or got[0] < cutoff:
            fams = ["unread"]
        else:
            read += 1
            fams = list(got[1])
        if p not in linked:
            fams.append("orphan")
        for f in fams:
            counts[f] += 1
            ex = examples.setdefault(f, [])
            if len(ex) < EXAMPLES:
                ex.append({"path": p})
    n = len(sitemap)
    return {"at": now_ms, "sitemap": n, "read": read, "unread": n - read, "coverage": round(read / n, 4) if n else 0.0,
            "counts": {k: counts[k] for k in FAMILIES if counts[k]},
            "examples": {k: examples[k] for k in FAMILIES if counts[k]}}


def _detail(fam: str, row: dict, src: str | None) -> str | None:
    if fam in ("title_long", "title_short"):
        return f"{row['title_len']} characters"
    if fam in ("desc_long", "desc_short"):
        return f"{row['desc_len']} characters"
    if fam == "slow":
        return f"{(row['ms'] or 0) / 1000:.1f} s"
    if fam == "big":
        return f"{(row['bytes'] or 0) / 1e6:.1f} MB"
    if fam == "error":
        what = f"HTTP {row['status']}" if row["status"] else (row["error"] or "no answer")
        return what + (f", linked from {src}" if src else "")
    if fam == "redirect":
        return f"HTTP {row['status']} to {row['final_path'] or 'nowhere'}"
    if fam == "refused":
        return f"HTTP {row['status']} after {TRIES} tries"
    if fam == "non_canonical":
        return f"canonical {row['canonical']}"
    if fam == "noindex":
        return f"robots: {row['robots']}"
    if fam == "jsonld_bad":
        return f"{row['jsonld_bad']} block(s) don't parse"
    if fam == "jsonld_untyped":
        return f"{row['jsonld_untyped']} item(s) with no @type"
    return None


def add_details(db, report: dict) -> dict:
    """Each example's figure (its length, time, size or status), read from its row."""
    from lib_db import query_dicts  # noqa: PLC0415

    paths = sorted({e["path"] for ex in report.get("examples", {}).values() for e in ex})
    if not paths:
        return report
    marks = ",".join("?" * len(paths))
    rows = {r["path"]: r for r in query_dicts(db, f"SELECT * FROM {PAGES} WHERE path IN ({marks})", paths, typed=True)}
    srcs = {r["path"]: r["from_path"] for r in query_dicts(db, f"SELECT path, from_path FROM {LINKS} WHERE path IN ({marks})", paths)}
    for fam, ex in report["examples"].items():
        for e in ex:
            row = rows.get(e["path"])
            d = _detail(fam, row, srcs.get(e["path"])) if row else None
            if d:
                e["detail"] = d
    return report


def alert_rises(before: dict, now: dict) -> list[dict]:
    """What grew since the last complete week: a family new this week, or any rise (a timing or load family's only
    at NOISY_MIN pages and NOISY_SHARE of last week's)."""
    out = []
    for fam in FAMILIES:
        n, b = int(now.get(fam) or 0), int(before.get(fam) or 0)
        if n <= b:
            continue
        if b and fam in NOISY and (n - b < NOISY_MIN or n - b < b * NOISY_SHARE):
            continue
        out.append({"family": fam, "before": b, "now": n, "new": b == 0})
    return out


def _when(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, ET).strftime("%A %-I:%M %p %Z")


def examples_text(fam: str, entry: dict, k: int = 3) -> str:
    ex = (entry.get("examples") or {}).get(fam) or []
    shown = [e["path"] + (f" ({e['detail']})" if e.get("detail") else "") for e in ex[:k]]
    return f" For example {', '.join(shown)}." if shown else ""


def compose_mail(entry: dict, *, baseline: bool) -> tuple[str, str]:
    """The owner's email: what grew (or, the first time, everything found), in plain sentences."""
    week = dt.date.fromisoformat(entry["week"]).strftime("%A, %b %-d")
    read = f"It read {entry['read']:,} of the sitemap's {entry['sitemap']:,} pages through the server's own front door."
    finished = f"The last night finished {_when(entry['finishedAt'])}."
    counts = entry.get("counts") or {}
    before = entry.get("before") or {}
    every = [f"- {FAMILIES[f]}: {counts[f]:,}" + (f" (last week {int(before.get(f) or 0):,})" if before else "") + "."
             for f in FAMILIES if f in counts]
    tail = ("The morning report's site audit section carries these counts each day. To list every page in one of "
            "them, see \"The site audit\" in scripts/oracle/README.md.")
    if baseline:
        subject = "PERM Tracker site audit: the first full week"
        found = "\n".join(f"- {FAMILIES[f]}: {counts[f]:,}.{examples_text(f, entry)}" for f in FAMILIES if f in counts)
        text = (f"The site audit has read the whole sitemap for the first time, in the week of nightly reads that "
                f"ended {week}. {finished} {read}\n\n"
                + (f"What it found:\n{found}\n\n" if found else "It found nothing wrong.\n\n")
                + "From now on it emails only when one of these counts grows or a new kind of problem appears.\n\n"
                + tail)
        return subject, text
    rises = entry.get("rises") or []
    subject = f"PERM Tracker site audit: {len(rises)} problem{'s' if len(rises) != 1 else ''} grew this week"
    grew = "\n".join(
        f"- {FAMILIES[r['family']]}: {r['now']:,}, "
        + ("new this week." if r["new"] else f"up from {r['before']:,}.")
        + examples_text(r["family"], entry)
        for r in rises)
    text = (f"The site audit's week ending {week} found more than the week before. {finished} {read}\n\n"
            f"What grew:\n{grew}\n\nEvery count this week:\n" + "\n".join(every) + "\n\n" + tail)
    return subject, text


def finish_week(doc: dict | None, report: dict, week: str, now_ms: int) -> tuple[dict, dict | None]:
    """Close the week: keep its counts, compare them with the last complete week's, and say whether to mail."""
    doc = dict(doc or {})
    weeks = [w for w in (doc.get("weeks") or []) if w.get("week") != week]
    complete = report["sitemap"] > 0 and report["unread"] <= report["sitemap"] * (1 - COMPLETE_SHARE)
    prior = next((w for w in sorted(weeks, key=lambda w: w["week"], reverse=True) if w.get("complete")), None)
    rises = alert_rises(prior["counts"], report["counts"]) if complete and prior else []
    entry = {**report, "week": week, "complete": complete, "finishedAt": now_ms, "rises": rises,
             "comparedWith": prior["week"] if complete and prior else None,
             "before": prior["counts"] if complete and prior else None}
    weeks.append({"week": week, "complete": complete, "counts": report["counts"], "sitemap": report["sitemap"],
                  "read": report["read"], "unread": report["unread"]})
    doc["weeks"] = sorted(weeks, key=lambda w: w["week"])[-WEEKS_KEPT:]
    doc["latestWeek"] = entry
    mail = None
    if complete and (rises or prior is None) and (doc.get("mail") or {}).get("sentWeek") != week:
        subject, text = compose_mail(entry, baseline=prior is None)
        mail = {"week": week, "subject": subject, "text": text}
    return doc, mail


def mail_sent(doc: dict, mail: dict, now_ms: int) -> dict:
    return {**doc, "mail": {"sentWeek": mail["week"], "sentAt": now_ms, "pending": None, "lastError": None}}


def mail_failed(doc: dict, mail: dict, err: str) -> dict:
    return {**doc, "mail": {**(doc.get("mail") or {}), "pending": mail, "lastError": err}}


def pending_mail(doc: dict) -> dict | None:
    return (doc.get("mail") or {}).get("pending")


# ── the owner's email, through the mail Worker ─────────────────────────────


def _env_file(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        for ln in path.read_text().splitlines():
            if "=" in ln and not ln.lstrip().startswith("#"):
                k, v = ln.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def owner_mail_config(env, cred_dir: str | None) -> dict | None:
    """The mail Worker's address and owner key: the environment, else systemd's `owner-mail` credential (a copy of
    /etc/permtracker/owner-mail.env, which stays root's). None when neither has both."""
    url, key = env.get("OWNER_MAIL_URL"), env.get("OWNER_MAIL_KEY")
    if not (url and key) and cred_dir:
        vals = _env_file(pathlib.Path(cred_dir) / "owner-mail")
        url, key = url or vals.get("OWNER_MAIL_URL"), key or vals.get("OWNER_MAIL_KEY")
    return {"url": url, "key": key} if url and key else None


def send_owner_mail(subject: str, text: str, cfg: dict | None, timeout: float = 20) -> tuple[bool, str | None]:
    if not cfg:
        return False, "no mail Worker key (owner-mail credential)"
    req = urllib.request.Request(cfg["url"], method="POST", data=json.dumps({"subject": subject, "text": text}).encode(),
                                 headers={"x-owner-mail-key": cfg["key"], "Content-Type": "application/json",
                                          "User-Agent": USER_AGENT})
    try:
        urllib.request.urlopen(req, timeout=timeout).read()
        return True, None
    except urllib.error.HTTPError as e:
        return False, f"the Worker answered HTTP {e.code}"
    except (urllib.error.URLError, OSError) as e:
        return False, f"the Worker couldn't be reached ({type(e).__name__})"


# ── the sitemap ────────────────────────────────────────────────────────────


class SitemapUnreadable(RuntimeError):
    pass


def _locs(xml: str) -> list[str]:
    return [html_mod.unescape(m.strip()) for m in re.findall(r"<loc>(.*?)</loc>", xml, re.S)]


def read_sitemap(get_text) -> list[str]:
    """Every page the sitemap lists, as paths, in its order, each once. `get_text(path)` answers one file."""
    root = get_text("/sitemap.xml")
    locs = _locs(root)
    if "<sitemapindex" in root:
        children = [p for p in (norm_path(c) for c in locs) if p]
        locs = [loc for child in children for loc in _locs(get_text(child))]
    paths = list(dict.fromkeys(p for p in (norm_path(loc) for loc in locs) if p))
    if not paths:
        raise SitemapUnreadable("the sitemap listed no page of this site")
    return paths


def upstream_text(up: Upstream):
    def get_text(path: str) -> str:
        r = up.get(path)
        if r["status"] != 200:
            raise SitemapUnreadable(f"{path} answered HTTP {r['status']}" + (f" ({r['error']})" if r["error"] else ""))
        return r["body"].decode("utf-8", errors="replace")
    return get_text


# ── a night ────────────────────────────────────────────────────────────────


def deadline_after(now: dt.datetime, until: str, max_minutes: int) -> float:
    """Seconds from `now` to the next `until` (HH:MM Eastern), at most `max_minutes`."""
    h, m = (int(x) for x in until.split(":"))
    local = now.astimezone(ET)
    end = local.replace(hour=h, minute=m, second=0, microsecond=0)
    if end <= local:
        end = (local + dt.timedelta(days=1)).replace(hour=h, minute=m, second=0, microsecond=0)
    # Subtracted in UTC: two datetimes in one zone subtract as wall-clock times, an hour off across a DST change.
    real = end.astimezone(dt.timezone.utc) - local.astimezone(dt.timezone.utc)
    return min(real.total_seconds(), max_minutes * 60.0)


def run_night(db, up: Upstream, *, day: dt.date, seconds: float, workers: int = WORKERS, rate: float = RATE,
              quiet: Quiet | None = None, mail_cfg: dict | None = None, weekly: bool | None = None,
              limit: int | None = None, clock_ms=lambda: int(time.time() * 1000), log=print) -> dict:
    """Read tonight's pages, store them, work out the report, close the week on its last night, and say so."""
    from lib_db import read_doc, write_doc  # noqa: PLC0415

    started_ms = clock_ms()
    deadline = time.monotonic() + seconds
    ensure_tables(db)
    sitemap = read_sitemap(upstream_text(up))
    reads = load_reads(db)
    tonight, behind = plan_night(sitemap, {p: r[0] for p, r in reads.items()}, day, started_ms)
    todo = tonight + behind
    if limit is not None:
        todo = todo[:limit]
    log(f"sitemap {len(sitemap):,} pages; tonight's seventh ({night_of(day)}) {len(tonight):,}, "
        f"{len(behind):,} behind; reading up to {len(todo):,} until {_when(started_ms + int(seconds * 1000))}")

    buf: list[dict] = []
    tally: Counter = Counter()
    unanswered = NoAnswer()

    def flush() -> None:
        if buf:
            write_batch(db, buf, clock_ms())
            for r in buf:
                reads[r["path"]] = (r["checkedAt"], r["problems"])
            buf.clear()

    def fetch(path: str) -> dict:
        try:
            return page_record(path, fetch_page(up, path), clock_ms())
        except Exception as e:  # noqa: BLE001 - a page that can't be read is its own finding
            return page_record(path, {"status": 0, "error": f"{type(e).__name__}: {e}"[:200]}, clock_ms())

    def on_result(rec: dict) -> None:
        buf.append(rec)
        tally["read"] += 1
        tally.update(rec["problems"])
        if rec["status"] == 0:
            tally["no_answer"] += 1
        if len(buf) >= CHECKPOINT:
            flush()
        if tally["read"] % 1000 == 0:
            log(f"  read {tally['read']:,} of {len(todo):,}")
        unanswered.see(rec)

    stats = crawl(todo, fetch, deadline=deadline, workers=workers, rate=rate, quiet=quiet, on_result=on_result)
    flush()
    now_ms = clock_ms()
    linked = load_linked(db, now_ms - RESULT_DAYS * DAY_MS)
    report = add_details(db, build_report(sitemap, reads, linked, now_ms))
    night = {"day": day.isoformat(), "weekday": day.strftime("%A"), "slice": night_of(day), "startedAt": started_ms,
             "finishedAt": now_ms, "sitemap": len(sitemap), "planned": len(tonight), "behind": len(behind),
             "read": stats["read"], "left": len(todo) - stats["read"], "stoppedBy": stats["stoppedBy"],
             "crashes": stats["crashes"], "refused": tally["refused"], "errors": tally["error"],
             "noAnswer": tally["no_answer"], "slow": tally["slow"],
             "pauses": quiet.pauses if quiet else 0, "pausedSeconds": round(quiet.paused_s) if quiet else 0,
             "perSecond": round(stats["read"] / max(1.0, (now_ms - started_ms) / 1000), 2)}
    doc = read_doc(db, DOC_KEY) or {}
    doc.update(version=1, updatedAt=now_ms, night=night, current=report,
               rules={"titleMin": TITLE_MIN, "titleMax": TITLE_MAX, "descMin": DESC_MIN, "descMax": DESC_MAX,
                      "bigBytes": BIG_BYTES, "slowMs": SLOW_MS, "resultDays": RESULT_DAYS})
    mail = None
    if weekly if weekly is not None else night_of(day) == NIGHTS - 1:
        doc, mail = finish_week(doc, report, day.isoformat(), now_ms)
        log(f"the week closed: {'complete' if doc['latestWeek']['complete'] else 'INCOMPLETE'}, "
            f"{len(doc['latestWeek']['rises'])} grew")
    mail = mail or pending_mail(doc)
    if mail:
        ok, err = send_owner_mail(mail["subject"], mail["text"], mail_cfg)
        doc = mail_sent(doc, mail, now_ms) if ok else mail_failed(doc, mail, err or "not sent")
        log(f"the owner's email: {'sent' if ok else 'NOT sent, kept for tomorrow: ' + str(err)}")
    try:
        night["pruned"] = prune(db, now_ms - KEEP_DAYS * DAY_MS)
    except Exception as e:  # noqa: BLE001 - tomorrow prunes again
        night["pruned"] = {"error": type(e).__name__}
    write_doc(db, DOC_KEY, doc)
    return night


def note_of(night: dict) -> str:
    return (f"read {night['read']:,} of {night['planned'] + night['behind']:,} ({night['weekday']}'s seventh and "
            f"{night['behind']:,} behind), stopped: {night['stoppedBy']}; {night['refused']} refused, "
            f"{night['errors']} errors, {night['noAnswer']} unanswered")


# ── the command ────────────────────────────────────────────────────────────


def _record(status: str, note: str, started: float, rows: int | None = None) -> None:
    try:
        from lib_db import Database, record_run  # noqa: PLC0415

        record_run(Database(), SCRIPT, status=status, note=note[:500], started_at=started, rows_written=rows)
    except Exception:  # noqa: BLE001
        print("couldn't record the run", file=sys.stderr)


def _upstream(args) -> Upstream:
    from lib_audit import audit_headers  # noqa: PLC0415 - the front door's key for the site's own audits

    return Upstream(args.base, host=args.host, headers=audit_headers())


def _families_of(db, sitemap: list[str], fam: str, now_ms: int) -> list[str]:
    reads = load_reads(db)
    linked = load_linked(db, now_ms - RESULT_DAYS * DAY_MS) if fam == "orphan" else set()
    cutoff = now_ms - RESULT_DAYS * DAY_MS
    out = []
    for p in sitemap:
        got = reads.get(p)
        fresh = got is not None and got[0] >= cutoff
        if (fam == "unread" and not fresh) or (fam == "orphan" and p not in linked) or (fresh and fam in got[1]):
            out.append(p)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=BASE, help="the front door's address (default: nginx on the server)")
    ap.add_argument("--host", default=SITE_HOST, help="the Host header every request carries")
    ap.add_argument("--until", default=UNTIL, help="stop reading at this Eastern time, HH:MM (default %(default)s)")
    ap.add_argument("--max-minutes", type=int, default=MAX_MINUTES, help="and never read longer than this")
    ap.add_argument("--workers", type=int, default=WORKERS, help="requests at a time (default %(default)s)")
    ap.add_argument("--rate", type=float, default=RATE, help="requests a second, all together (default %(default)s)")
    ap.add_argument("--limit", type=int, help="read at most this many pages tonight")
    ap.add_argument("--day", help="read this day's seventh (YYYY-MM-DD; default today in Eastern time)")
    ap.add_argument("--weekly", choices=("yes", "no"), help="close the week tonight, or not (default: on Sundays)")
    ap.add_argument("--report", action="store_true", help="print the counts over the sitemap now; read no page")
    ap.add_argument("--list", metavar="FAMILY", choices=sorted(FAMILIES), help="print every sitemap page in a family")
    ap.add_argument("--paths", nargs="+", help="read only these pages and print what each says")
    ap.add_argument("--dry-run", action="store_true", help="with --paths: write nothing")
    args = ap.parse_args()
    started = time.time()
    up = _upstream(args)

    if args.paths:
        recs = []
        for raw in args.paths:
            p = norm_path(raw) or raw
            rec = page_record(p, fetch_page(up, p), int(time.time() * 1000))
            recs.append(rec)
            print(f"{p}  HTTP {rec['status']}  {rec['ms']} ms  {rec['bytes']:,} bytes  title {rec['titleLen']}  "
                  f"description {rec['descLen']}  links {rec['linkCount']}  problems: {', '.join(rec['problems']) or 'none'}")
        if not args.dry_run:
            from lib_db import Database  # noqa: PLC0415

            db = Database()
            ensure_tables(db)
            write_batch(db, recs, int(time.time() * 1000))
        return 0

    from lib_db import Database  # noqa: PLC0415

    db = Database()
    if args.report or args.list:
        ensure_tables(db)
        sitemap = read_sitemap(upstream_text(up))
        now_ms = int(time.time() * 1000)
        if args.list:
            for p in _families_of(db, sitemap, args.list, now_ms):
                print(p)
            return 0
        report = add_details(db, build_report(sitemap, load_reads(db), load_linked(db, now_ms - RESULT_DAYS * DAY_MS), now_ms))
        print(f"{report['read']:,} of {report['sitemap']:,} sitemap pages read in the last {RESULT_DAYS} days")
        for fam, n in report["counts"].items():
            print(f"  {FAMILIES[fam]}: {n:,}.{examples_text(fam, report)}")
        return 0

    now = dt.datetime.now(ET)
    day = dt.date.fromisoformat(args.day) if args.day else now.date()
    seconds = deadline_after(now, args.until, args.max_minutes)
    weekly = None if args.weekly is None else args.weekly == "yes"
    try:
        night = run_night(db, up, day=day, seconds=seconds, workers=args.workers, rate=args.rate, quiet=Quiet(),
                          mail_cfg=owner_mail_config(os.environ, os.environ.get("CREDENTIALS_DIRECTORY")),
                          weekly=weekly, limit=args.limit)
    except SitemapUnreadable as e:
        print(f"the sitemap couldn't be read: {e}", file=sys.stderr)
        _record("failed", f"the sitemap couldn't be read: {e}", started)
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"the night failed ({type(e).__name__}: {e})", file=sys.stderr)
        _record("failed", f"the night failed ({type(e).__name__})", started)
        return 1
    note = note_of(night)
    print(note)
    # A night cut short by the front door (the watchdog repairs that) or with no page answered still failed, so the
    # unit ends red and the alarm says so. Running out of the window is the plan working: the next nights catch up.
    bad = night["stoppedBy"] not in ("done", "deadline") or (night["read"] > 0 and night["noAnswer"] == night["read"])
    _record("failed" if bad else "ok", note, started, night["read"])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

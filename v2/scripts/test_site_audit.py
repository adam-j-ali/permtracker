#!/usr/bin/env python3
"""scripts/site_audit.py: the site's own full audit, a seventh of the sitemap a night.

Everything here runs against stand-ins: a fake upstream on the loopback address for the fetches and the owner
mail, real in-memory SQLite (lib_sqlite_shim) for the tables, and plain lists for the sitemap. Nothing leaves
this machine.

    python3 scripts/test_site_audit.py
    python3 -m pytest scripts/test_site_audit.py -q
"""
from __future__ import annotations

import contextlib
import datetime as dt
import http.server
import json
import pathlib
import re
import sys
import tempfile
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import site_audit as sa  # noqa: E402
from lib_sqlite_shim import SqliteTurso  # noqa: E402

DAY_MS = 86_400_000
NOW = 1_795_000_000_000  # Thursday, Nov 19 2026, in milliseconds


# ── a fake upstream on the loopback address ────────────────────────────────

PAGE = """<!doctype html><html lang="en"><head>
<title>Google LLC: PERM filings and approval rate | PERM Tracker</title>
<meta name="description" content="Every PERM case Google LLC filed with DOL since 2008: approvals, denials, wages and the jobs, from DOL&#x27;s own files, updated daily from the case status service.">
<link rel="canonical" href="https://permtracker.app/perm-employers/google-llc">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"x"},{"@type":"BreadcrumbList"}]}</script>
</head><body><svg><title>an icon</title></svg>
<a href="/">Home</a> <a href="/perm-employers">Employers</a> <a href="https://www.permtracker.app/perm-queue/">Queue</a>
<a href="https://example.com/x">Out</a> <a href="mailto:a@b.c">Mail</a> <a href="#top">Top</a>
</body></html>"""


SITEMAP = ["/ok", "/slow", "/moved", "/nope", "/hidden"]


class Fake(http.server.BaseHTTPRequestHandler):
    """Answers by path. Records every request it saw, with the Host header and the audit key."""

    seen: list[tuple[str, str]] = []
    mail: list[dict] = []
    busy_left = {"n": 1}

    def log_message(self, *a):  # quiet
        return

    def do_GET(self):  # noqa: N802
        Fake.seen.append((self.path, self.headers.get("Host", "")))
        if self.path == "/ok":
            return self._send(200, PAGE, {"x-nextjs-cache": "HIT"})
        if self.path == "/slow":
            time.sleep(0.3)
            return self._send(200, PAGE)
        if self.path == "/moved":
            return self._send(308, "", {"Location": "/ok"})
        if self.path == "/away":
            return self._send(301, "", {"Location": "https://example.com/elsewhere"})
        if self.path == "/loop":
            return self._send(302, "", {"Location": "/loop"})
        if self.path == "/busy":
            if Fake.busy_left["n"] > 0:
                Fake.busy_left["n"] -= 1
                return self._send(429, "slow down", {"Retry-After": "0"})
            return self._send(200, PAGE)
        if self.path == "/always-busy":
            return self._send(429, "slow down", {"Retry-After": "0"})
        if self.path == "/hidden":
            return self._send(200, PAGE, {"X-Robots-Tag": "googlebot: noindex"})
        if self.path == "/data.json":
            return self._send(200, '{"a": 1}', {"Content-Type": "application/json"})
        if self.path == "/sitemap.xml":
            locs = "".join(f"<url><loc>https://permtracker.app{p}</loc></url>" for p in SITEMAP)
            return self._send(200, f"<urlset>{locs}</urlset>", {"Content-Type": "application/xml"})
        return self._send(404, "<title>Not found</title>")

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        Fake.mail.append({"path": self.path, "key": self.headers.get("x-owner-mail-key"),
                          "ua": self.headers.get("User-Agent", ""), "body": json.loads(body or b"{}")})
        if self.path == "/owner":
            return self._send(200, '{"ok":true}', {"Content-Type": "application/json"})
        return self._send(500, '{"ok":false}', {"Content-Type": "application/json"})

    def _send(self, code: int, body: str, headers: dict | None = None):
        data = body.encode()
        self.send_response(code)
        hdrs = {"Content-Type": "text/html; charset=utf-8", **(headers or {})}
        for k, v in hdrs.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Upstream:
    def __enter__(self):
        Fake.seen = []
        Fake.mail = []
        Fake.busy_left = {"n": 1}
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


# ── status and timing capture ──────────────────────────────────────────────


def test_status_timing_and_size_are_captured() -> None:
    with Upstream() as base:
        up = sa.Upstream(base, host="permtracker.app", headers={"x-permtracker-audit": "k"})
        ok = sa.fetch_page(up, "/ok", sleep=lambda s: None)
        assert ok["status"] == 200 and ok["finalStatus"] == 200 and ok["finalPath"] == "/ok", ok
        assert ok["bytes"] == len(PAGE.encode()), ok["bytes"]
        assert ok["cache"] == "HIT", ok
        assert 0 <= ok["ms"] < 2000, ok["ms"]
        slow = sa.fetch_page(up, "/slow", sleep=lambda s: None)
        assert slow["ms"] >= 300, f"the time covers the whole answer ({slow['ms']} ms)"
        # Every request names the site, so nginx and the app answer for permtracker.app.
        assert all(h == "permtracker.app" for _p, h in Fake.seen), Fake.seen
        gone = sa.fetch_page(up, "/nope", sleep=lambda s: None)
        assert gone["status"] == 404 and gone["finalStatus"] == 404, gone
        data = sa.fetch_page(up, "/data.json", sleep=lambda s: None)
        assert data["status"] == 200 and data.get("html") is None, "a page that isn't HTML isn't parsed"


def test_redirects_are_recorded_and_followed_on_the_site_only() -> None:
    with Upstream() as base:
        up = sa.Upstream(base, host="permtracker.app")
        moved = sa.fetch_page(up, "/moved", sleep=lambda s: None)
        assert moved["status"] == 308 and moved["finalStatus"] == 200 and moved["finalPath"] == "/ok", moved
        assert moved["hops"] == 1 and moved.get("html"), moved
        away = sa.fetch_page(up, "/away", sleep=lambda s: None)
        assert away["status"] == 301 and away["finalPath"] is None and away["finalUrl"] == "https://example.com/elsewhere", away
        assert not any(p == "/elsewhere" for p, _h in Fake.seen), "a redirect off the site is never fetched"
        loop = sa.fetch_page(up, "/loop", sleep=lambda s: None)
        assert loop["status"] == 302 and loop["hops"] == sa.MAX_HOPS, loop


def test_a_refusal_is_asked_again_and_named_when_it_stays() -> None:
    waits: list[float] = []
    with Upstream() as base:
        up = sa.Upstream(base, host="permtracker.app")
        busy = sa.fetch_page(up, "/busy", sleep=waits.append)
        assert busy["status"] == 200 and busy["tries"] == 2, busy
        always = sa.fetch_page(up, "/always-busy", sleep=waits.append)
        assert always["status"] == 429 and always["tries"] == sa.TRIES, always
        rec = sa.page_record("/always-busy", always, NOW)
        assert rec["problems"] == ["refused"], "a page the front door kept refusing counts as unread"
    assert waits and all(w >= 0 for w in waits)


def test_a_connection_failure_is_a_status_of_zero_with_its_reason() -> None:
    up = sa.Upstream("http://127.0.0.1:9", host="permtracker.app", timeout=2)
    r = sa.fetch_page(up, "/ok", sleep=lambda s: None)
    assert r["status"] == 0 and r["error"], r
    assert sa.page_record("/ok", r, NOW)["problems"] == ["error"]


# ── link extraction and normalization ──────────────────────────────────────


def test_links_are_the_sites_own_pages_as_paths() -> None:
    p = sa.parse_html(PAGE)
    got = sa.internal_links(p["links"], "/perm-employers/google-llc")
    assert got == {"/", "/perm-employers", "/perm-queue"}, got
    assert sa.norm_path("filings?page=2#x", "/perm-employers/google-llc/") == "/perm-employers/google-llc/filings"
    assert sa.norm_path("../a", "/x/y/z") == "/x/a"
    assert sa.norm_path("/a%20b", "/") == sa.norm_path("/a b", "/") == "/a%20b", "one spelling for an encoded path"
    assert sa.norm_path("HTTPS://PermTracker.app/A/", "/") == "/A", "the host is case-blind, the path isn't"
    assert sa.norm_path("//permtracker.app/x", "/") == "/x"
    for off in ("https://example.com/", "mailto:a@b.c", "tel:123", "javascript:void(0)", "#top", "", "   "):
        assert sa.norm_path(off, "/") is None, off
    # The sitemap's own addresses go through the same rule, so a link and a sitemap entry compare.
    assert sa.norm_path("https://permtracker.app/perm-queue/") == "/perm-queue"


def test_the_head_is_read_and_an_icons_title_is_not_the_pages() -> None:
    p = sa.parse_html(PAGE)
    assert p["title"] == "Google LLC: PERM filings and approval rate | PERM Tracker", p["title"]
    assert p["description"].startswith("Every PERM case") and "DOL's own" in p["description"], "entities decoded"
    assert p["canonical"] == "https://permtracker.app/perm-employers/google-llc"
    assert p["robots"] == ""
    bad, untyped, types = sa.jsonld_check(p["jsonld"])
    assert (bad, untyped) == (0, 0) and types == ["BreadcrumbList", "Organization"], (bad, untyped, types)
    # Next can stream the head's tags after the page has begun, so an icon's <title> may come first.
    streamed = sa.parse_html('<body><svg viewBox="0 0 1 1"><title>Arrow</title><path d=""/></svg>'
                             '<title>The real title</title></body>')
    assert streamed["title"] == "The real title", streamed["title"]


def test_structured_data_that_fails_to_parse_or_names_no_type_is_counted() -> None:
    blocks = ['{"@type": "Thing"}', '{"@type": "A",}', '[{"@type": "B"}, {"name": "no type"}]',
              '{"@graph": [{"@type": "C"}, {"name": "x"}]}', '  ']
    bad, untyped, types = sa.jsonld_check(blocks)
    assert bad == 2, f"a trailing comma and an empty block fail to parse ({bad})"
    assert untyped == 2, f"an item with no @type, top level or in @graph ({untyped})"
    assert types == ["B", "C", "Thing"], types


# ── the rules: lengths, size, time, robots, canonical ─────────────────────


def rec_for(title_len: int = 40, desc_len: int = 130, **over) -> dict:
    fetched = {"status": 200, "finalStatus": 200, "finalPath": "/x", "hops": 0, "ms": 300, "bytes": 50_000,
               "cache": "MISS", "headers": {}, "tries": 1,
               "html": (f"<title>{'t' * title_len}</title><meta name=\"description\" content=\"{'d' * desc_len}\">"
                        '<link rel="canonical" href="https://permtracker.app/x">')}
    fetched.update(over)
    return sa.page_record("/x", fetched, NOW)


def test_the_length_rules() -> None:
    assert rec_for()["problems"] == []
    assert rec_for(title_len=19)["problems"] == ["title_short"]
    assert rec_for(title_len=20)["problems"] == []
    assert rec_for(title_len=60)["problems"] == []
    assert rec_for(title_len=61)["problems"] == ["title_long"]
    assert rec_for(desc_len=109)["problems"] == ["desc_short"]
    assert rec_for(desc_len=110)["problems"] == []
    assert rec_for(desc_len=160)["problems"] == []
    assert rec_for(desc_len=161)["problems"] == ["desc_long"]
    assert rec_for(title_len=0)["problems"] == ["title_missing"]
    nodesc = sa.page_record("/x", {**rec_fetch(), "html": '<title>' + "t" * 30 + '</title><link rel="canonical" href="/x">'}, NOW)
    assert nodesc["problems"] == ["desc_missing"], nodesc["problems"]
    # Entities and runs of spaces count as the reader sees them.
    spaced = sa.page_record("/x", {**rec_fetch(), "html": "<title>  A &amp;   B  " + "x" * 16 + "</title>"
                                   '<meta name="description" content="' + "d" * 120 + '"><link rel="canonical" href="/x">'}, NOW)
    assert spaced["titleLen"] == 22 and spaced["problems"] == [], spaced


def rec_fetch() -> dict:
    return {"status": 200, "finalStatus": 200, "finalPath": "/x", "hops": 0, "ms": 300, "bytes": 50_000,
            "cache": "MISS", "headers": {}, "tries": 1}


def test_size_time_robots_and_canonical_rules() -> None:
    assert rec_for(bytes=1_500_000)["problems"] == []
    assert rec_for(bytes=1_500_001)["problems"] == ["big"]
    assert rec_for(ms=2000)["problems"] == []
    assert rec_for(ms=2001)["problems"] == ["slow"]
    nx = rec_for(html='<title>' + "t" * 30 + '</title><meta name="description" content="' + "d" * 120 + '">'
                 '<meta name="robots" content="NOINDEX, follow"><link rel="canonical" href="/x">')
    assert nx["problems"] == ["noindex"], nx["problems"]
    none = rec_for(headers={"x-robots-tag": "none"})
    assert none["problems"] == ["noindex"], "'none' is noindex and nofollow (Google's robots meta tag doc)"
    other = rec_for(html='<title>' + "t" * 30 + '</title><meta name="description" content="' + "d" * 120 + '">'
                    '<link rel="canonical" href="https://permtracker.app/y">')
    assert other["problems"] == ["non_canonical"] and other["canonical"] == "/y", other
    www = rec_for(html='<title>' + "t" * 30 + '</title><meta name="description" content="' + "d" * 120 + '">'
                  '<link rel="canonical" href="https://www.permtracker.app/x/">')
    assert www["problems"] == [], "the same page under www or with a slash is the same canonical"
    nocanon = rec_for(html='<title>' + "t" * 30 + '</title><meta name="description" content="' + "d" * 120 + '">')
    assert nocanon["problems"] == ["canonical_missing"], nocanon["problems"]
    moved = sa.page_record("/x", {**rec_fetch(), "status": 301, "finalPath": "/y"}, NOW)
    assert moved["problems"] == ["redirect"] and moved["finalPath"] == "/y", moved
    for code in (404, 410, 500, 503):
        assert sa.page_record("/x", {**rec_fetch(), "status": code, "finalStatus": code}, NOW)["problems"] == ["error"]


def test_every_problem_has_a_title_and_the_titles_follow_house_style() -> None:
    keys = set(sa.FAMILIES)
    produced = {"title_short", "title_long", "title_missing", "desc_short", "desc_long", "desc_missing", "big",
                "slow", "noindex", "non_canonical", "canonical_missing", "redirect", "error", "refused",
                "jsonld_bad", "jsonld_untyped", "orphan", "unread"}
    assert produced <= keys, produced - keys
    for k, title in sa.FAMILIES.items():
        assert "\u2014" not in title and "!" not in title and title[0].isupper(), (k, title)


# ── the nightly slice ──────────────────────────────────────────────────────


def sitemap(n: int = 7000) -> list[str]:
    kinds = ["/perm-employers/", "/soc-codes/", "/perm-law-firms/", "/perm-jobs/", "/guides/"]
    return ["/", *(f"{kinds[i % len(kinds)]}name-{i}" for i in range(n))]


def test_a_slice_is_stable_and_seven_nights_cover_the_sitemap() -> None:
    paths = sitemap()
    weekly = [p for p in paths if sa.cycle_of(p) == sa.NIGHTS]
    first = {p: sa.slice_of(p) for p in paths}
    assert all(0 <= first[p] < sa.cycle_of(p) for p in paths)
    # Stable: the same path lands on the same night whatever else the sitemap holds, run after run.
    bigger = paths + [f"/perm-employers/new-{i}" for i in range(500)]
    assert all(sa.slice_of(p) == first[p] for p in paths[:500])
    assert {p: sa.slice_of(p) for p in bigger}.items() >= first.items()
    assert sa.slice_of("/") == 1, "the rule is pinned: changing it moves every page's night"
    # Seven consecutive nights, whatever day they start on, read every weekly page exactly once.
    for start in (dt.date(2026, 11, 16), dt.date(2026, 11, 19), dt.date(2027, 3, 4)):
        seen: list[str] = []
        for i in range(7):
            tonight, _ = sa.plan_night(paths, {}, start + dt.timedelta(days=i), NOW, stragglers=False)
            seen.extend(p for p in tonight if sa.cycle_of(p) == sa.NIGHTS)
        assert sorted(seen) == sorted(weekly), "every weekly page once in a week"
    # Each night is close to a seventh.
    sizes = [sum(1 for p in weekly if first[p] == k) for k in range(sa.NIGHTS)]
    assert all(abs(n - len(weekly) / 7) < len(weekly) / 7 * 0.15 for n in sizes), sizes
    # Sunday is the night that closes the week.
    assert sa.night_of(dt.date(2026, 11, 22)) == sa.NIGHTS - 1 == 6


def test_employer_pages_are_read_over_five_weeks() -> None:
    """About 535,000 employer pages of 556,000 (Nov 26 2026): a seventh of them a night was more than a night can read
    at four a second, so a week's report read a sliver. They're read over 35 nights, the rest of the site each week."""
    paths = sitemap()
    employers = [p for p in paths if p.startswith("/perm-employers/")]
    assert employers and all(sa.cycle_of(p) == sa.LONG_NIGHTS == 35 for p in employers)
    assert sa.cycle_of("/perm-employers") == sa.NIGHTS, "the list page itself stays weekly"
    for start in (dt.date(2026, 11, 23), dt.date(2026, 12, 9)):
        seen: list[str] = []
        for i in range(sa.LONG_NIGHTS):
            tonight, _ = sa.plan_night(paths, {}, start + dt.timedelta(days=i), NOW, stragglers=False)
            seen.extend(p for p in tonight if p.startswith("/perm-employers/"))
        assert sorted(seen) == sorted(employers), "every employer page once in 35 nights"
    # The long cycle closes on a Sunday, with the week.
    assert sa.night_of(dt.date(2026, 12, 27), sa.LONG_NIGHTS) == sa.LONG_NIGHTS - 1
    assert dt.date(2026, 12, 27).weekday() == 6
    # A night holds about a seventh of the weekly pages and a 35th of the employer pages.
    tonight, _ = sa.plan_night(paths, {}, dt.date(2026, 11, 25), NOW, stragglers=False)
    n_emp = sum(1 for p in tonight if p.startswith("/perm-employers/"))
    assert abs(n_emp - len(employers) / 35) < len(employers) / 35 * 0.5, n_emp
    # Rows outlive the long cycle, and a page's read counts for its whole cycle.
    assert sa.KEEP_DAYS > sa.LONG_NIGHTS + 1
    assert sa.result_days("/perm-employers/x") == sa.LONG_NIGHTS + 1 and sa.result_days("/") == sa.RESULT_DAYS


def test_pages_a_missed_night_left_behind_come_after_tonights() -> None:
    paths = [p for p in sitemap(700) if sa.cycle_of(p) == sa.NIGHTS]
    day = dt.date(2026, 11, 17)  # a Tuesday
    tonight_slice = sa.night_of(day)
    read = {}
    for p in paths:
        s = sa.slice_of(p)
        # Tonight's slice was read a week ago; Monday's was missed (8 days); the rest are fresh.
        age_days = 7 if s == tonight_slice else 8 if s == tonight_slice - 1 else 2
        read[p] = NOW - age_days * DAY_MS
    never = "/guides/brand-new"
    tonight, behind = sa.plan_night(paths + [never], read, day, NOW)
    assert set(tonight) == {p for p in paths + [never] if sa.slice_of(p) == tonight_slice}
    assert behind and behind[0] == never or sa.slice_of(never) == tonight_slice
    assert all(sa.slice_of(p) == tonight_slice - 1 for p in behind if p != never), "only the missed night's pages"
    assert not set(tonight) & set(behind)


def test_an_employer_page_is_behind_only_past_its_own_cycle() -> None:
    day = dt.date(2026, 11, 25)
    emp = [f"/perm-employers/e-{i}" for i in range(400)]
    others = [p for p in emp if sa.slice_of(p) != sa.night_of(day, sa.LONG_NIGHTS)]
    ten, forty = others[0], others[1]
    read = {p: NOW - 2 * DAY_MS for p in emp}
    read[ten] = NOW - 10 * DAY_MS
    read[forty] = NOW - 40 * DAY_MS
    _, behind = sa.plan_night(emp, read, day, NOW)
    assert forty in behind and ten not in behind, "ten days is inside its 35 nights; forty is past them"


def test_the_report_counts_an_employer_page_read_within_its_cycle() -> None:
    reads = {"/": (NOW - 20 * DAY_MS, []), "/perm-employers/acme": (NOW - 20 * DAY_MS, [])}
    r = sa.build_report(["/", "/perm-employers/acme"], reads, {"/", "/perm-employers/acme"}, NOW)
    assert r["read"] == 1 and r["counts"].get("unread") == 1, "the weekly page is stale at 20 days, the employer page isn't"


# ── the crawl: fixed concurrency, a pace, a deadline, giving way ──────────


def test_the_crawl_holds_its_concurrency_pace_and_deadline() -> None:
    live = {"now": 0, "max": 0}
    lock = threading.Lock()

    def fetch(path: str) -> dict:
        with lock:
            live["now"] += 1
            live["max"] = max(live["max"], live["now"])
        time.sleep(0.01)
        with lock:
            live["now"] -= 1
        return {"path": path}

    got: list[dict] = []
    paths = [f"/p{i}" for i in range(40)]
    t0 = time.monotonic()
    stats = sa.crawl(paths, fetch, deadline=time.monotonic() + 30, workers=2, rate=200.0, on_result=got.append)
    took = time.monotonic() - t0
    assert stats["read"] == 40 and stats["stoppedBy"] == "done" and len(got) == 40, stats
    assert live["max"] == 2, f"never more than two at once ({live['max']})"
    stats = sa.crawl(paths, fetch, deadline=time.monotonic() - 1, workers=2, rate=200.0, on_result=got.append)
    assert stats["read"] == 0 and stats["stoppedBy"] == "deadline", stats
    # Pages that answer at once still go no faster than the rate.
    t0 = time.monotonic()
    stats = sa.crawl([f"/q{i}" for i in range(21)], lambda p: {"path": p}, deadline=time.monotonic() + 30,
                     workers=2, rate=50.0, on_result=got.append)
    took = time.monotonic() - t0
    assert stats["read"] == 21 and took >= 20 / 50.0 * 0.9, f"paced at the rate ({took:.3f} s)"
    # A deadline that comes mid-night stops it there, with the rest left.
    stats = sa.crawl([f"/r{i}" for i in range(50)], lambda p: time.sleep(0.02) or {"path": p},
                     deadline=time.monotonic() + 0.15, workers=2, rate=1000.0, on_result=got.append)
    assert stats["stoppedBy"] == "deadline" and 0 < stats["read"] < 50, stats


def test_a_result_can_end_the_night_early() -> None:
    seen: list[dict] = []

    def on_result(r: dict) -> None:
        seen.append(r)
        if len(seen) == 3:
            raise sa.Halt("the front door stopped answering")

    stats = sa.crawl([f"/p{i}" for i in range(200)], lambda p: time.sleep(0.005) or {"path": p},
                     deadline=time.monotonic() + 30, workers=2, rate=1000.0, on_result=on_result)
    assert stats["stoppedBy"] == "the front door stopped answering" and stats["read"] < 10, stats


def test_twenty_unanswered_pages_in_a_row_end_the_night() -> None:
    streak = sa.NoAnswer()
    for _ in range(sa.NO_ANSWER_STOP - 1):
        streak.see({"status": 0})
    streak.see({"status": 200})
    for _ in range(sa.NO_ANSWER_STOP - 1):
        streak.see({"status": 0})
    try:
        streak.see({"status": 0})
    except sa.Halt as h:
        assert "answer" in str(h)
    else:
        raise AssertionError("the 20th unanswered page in a row ends the night")


def test_the_crawl_waits_while_the_server_is_busy() -> None:
    calls = {"n": 0}

    class Quiet:
        pauses = 0
        paused_s = 0.0

        def wait(self, deadline: float) -> bool:
            calls["n"] += 1
            return calls["n"] < 5  # busy until the deadline after four pages

    got: list[dict] = []
    stats = sa.crawl([f"/p{i}" for i in range(10)], lambda p: {"path": p}, deadline=time.monotonic() + 30,
                     workers=1, rate=1000.0, quiet=Quiet(), on_result=got.append)
    assert stats["read"] == 4 and stats["stoppedBy"] == "deadline", stats


def test_the_load_check_reads_the_signs_the_server_gives() -> None:
    q = sa.Quiet(load=lambda: 0.5, cpus=2, sweeping=lambda: False, deploying=lambda: False)
    assert q.busy() is None
    assert "load" in sa.Quiet(load=lambda: 3.5, cpus=2, sweeping=lambda: False, deploying=lambda: False).busy()
    assert "sweep" in sa.Quiet(load=lambda: 0.1, cpus=2, sweeping=lambda: True, deploying=lambda: False).busy()
    assert "deploy" in sa.Quiet(load=lambda: 0.1, cpus=2, sweeping=lambda: False, deploying=lambda: True).busy()
    # A check that can't be read never blocks the audit.
    def broken() -> bool:
        raise OSError("no systemctl")
    assert sa.Quiet(load=lambda: 0.1, cpus=2, sweeping=broken, deploying=lambda: False).busy() is None
    assert sa.sweep_lines_active("permtracker-sweep@case-status-full.service loaded active running x\n")
    assert not sa.sweep_lines_active("")
    # Nov 23 2026: a sweep's timer is always "active waiting", and the list held the timers too, so every night read
    # as a sweep running and the audit read 1 page of its plan. Only a running service is a sweep.
    assert not sa.sweep_lines_active("permtracker-sweep@case-status-full.timer loaded active waiting Run x\n")


def test_the_sweep_check_asks_systemd_for_services_only() -> None:
    import inspect

    src = inspect.getsource(sa._sweeping)
    assert '"--type=service"' in src, "the timers are listed too without it"


def test_the_wait_holds_until_the_server_is_quiet_or_the_deadline() -> None:
    t = {"now": 1000.0}
    sweeps = iter([True, True, False])
    slept: list[float] = []

    def sleep(s: float) -> None:
        slept.append(s)
        t["now"] += s

    q = sa.Quiet(load=lambda: 0.1, cpus=2, sweeping=lambda: next(sweeps), deploying=lambda: False,
                 clock=lambda: t["now"], sleep=sleep)
    assert q.wait(t["now"] + 3600) is True and slept == [sa.POLL_S, sa.POLL_S], slept
    assert q.pauses == 1 and q.paused_s == 2 * sa.POLL_S and q.reasons["sweep"] == 1, (q.pauses, q.paused_s)
    # Quiet just now: the signs aren't read again for CHECK_EVERY_S.
    assert q.wait(t["now"] + 3600) is True and len(slept) == 2
    # Busy to the end: it gives up at the deadline.
    t["now"] += sa.CHECK_EVERY_S
    q.sweeping = lambda: True
    assert q.wait(t["now"] + 3 * sa.POLL_S) is False


# ── the tables and the report: orphans, families, the window ──────────────


def db() -> SqliteTurso:
    d = SqliteTurso()
    d.execute("CREATE TABLE perm_docs (key TEXT PRIMARY KEY, json TEXT, computed_at INTEGER)")
    sa.ensure_tables(d)
    return d


def page(path: str, links: set[str], problems: list[str] | None = None, at: int = NOW, **over) -> dict:
    return {"path": path, "slice": sa.slice_of(path), "checkedAt": at, "status": 200, "finalStatus": 200,
            "finalPath": path, "hops": 0, "ms": 200, "bytes": 1000, "cache": "MISS", "title": None, "titleLen": 30,
            "descLen": 130, "canonical": path, "robots": "", "jsonldBad": 0, "jsonldUntyped": 0, "jsonldTypes": "",
            "linkCount": len(links), "links": links, "problems": problems or [], "error": None, **over}


def test_orphans_are_sitemap_pages_no_crawled_page_links_to() -> None:
    d = db()
    sa.write_batch(d, [
        page("/", {"/a", "/b"}),
        page("/a", {"/"}),
        # /b links to /c, but its read is older than the window: that link no longer counts.
        page("/b", {"/c"}, at=NOW - 10 * DAY_MS),
        page("/c", set()),
        page("/d", {"/d"}),  # a page linking only to itself is still an orphan
    ], NOW)
    # The links table keeps when each target was last seen; the old read of /b wrote its link then.
    d.execute("UPDATE site_audit_links SET seen_at = ? WHERE path = '/c'", [NOW - 10 * DAY_MS])
    reads = sa.load_reads(d)
    linked = sa.load_linked(d, NOW - sa.RESULT_DAYS * DAY_MS)
    assert "/c" not in linked and "/d" not in linked, "a link a page makes to itself links nothing"
    r = sa.build_report(["/", "/a", "/b", "/c", "/d", "/e"], reads, linked, NOW)
    assert r["counts"]["orphan"] == 3, r["counts"]  # /c (stale link), /d (self only), /e (unread and unlinked)
    assert [e["path"] for e in r["examples"]["orphan"]] == ["/c", "/d", "/e"]
    assert r["counts"]["unread"] == 2 and r["unread"] == 2, "/b is past the window and /e was never read"
    assert r["read"] == 4 and r["sitemap"] == 6


def test_the_report_counts_each_family_for_the_sitemap_only() -> None:
    d = db()
    sa.write_batch(d, [
        page("/", {"/t", "/s", "/gone", "/x"}),
        page("/t", {"/"}, ["title_long", "desc_short"], title="t" * 70, titleLen=70, descLen=80),
        page("/s", {"/"}, ["slow"], ms=3400),
        page("/gone", {"/"}, ["error"], status=404, finalStatus=404),
        page("/x", {"/"}, ["title_long"], title="y" * 65, titleLen=65),
    ], NOW)
    reads = sa.load_reads(d)
    linked = sa.load_linked(d, NOW - sa.RESULT_DAYS * DAY_MS)
    r = sa.build_report(["/", "/t", "/s", "/gone"], reads, linked, NOW)
    c = r["counts"]
    assert c == {"title_long": 1, "desc_short": 1, "slow": 1, "error": 1}, f"/x left the sitemap ({c})"
    sa.add_details(d, r)
    assert r["examples"]["title_long"][0]["detail"] == "70 characters", r["examples"]
    assert r["examples"]["slow"][0]["detail"] == "3.4 s", r["examples"]
    assert r["examples"]["error"][0]["detail"] == "HTTP 404, linked from /", r["examples"]


def test_a_batch_writes_one_row_per_page_and_link_target() -> None:
    d = db()
    sa.write_batch(d, [page("/", {"/a", "/b"}), page("/a", {"/", "/b"})], NOW)
    sa.write_batch(d, [page("/a", {"/"}, ["slow"], at=NOW + 1)], NOW + 1)
    rows = d.execute("SELECT COUNT(*) FROM site_audit_pages")["response"]["result"]["rows"]
    assert rows[0][0]["value"] == "2"
    reads = sa.load_reads(d)
    assert reads["/a"] == (NOW + 1, ["slow"]), reads["/a"]
    links = d.execute("SELECT COUNT(*) FROM site_audit_links")["response"]["result"]["rows"]
    assert links[0][0]["value"] == "3"
    # Reads go in pages of a fixed size, so a big table is never one answer.
    many = [page(f"/p{i}", set()) for i in range(sa.READ_PAGE + 5)]
    sa.write_batch(d, many, NOW)
    assert len(sa.load_reads(d)) == sa.READ_PAGE + 5 + 2


def test_old_rows_are_pruned_in_bounded_steps() -> None:
    d = db()
    sa.write_batch(d, [page(f"/old{i}", {"/gone"}, at=NOW - 50 * DAY_MS) for i in range(30)] + [page("/new", {"/"})], NOW)
    d.execute("UPDATE site_audit_links SET seen_at = ? WHERE path = '/gone'", [NOW - 50 * DAY_MS])
    removed = sa.prune(d, NOW - sa.KEEP_DAYS * DAY_MS, step=7)
    assert removed == {"pages": 30, "links": 1}, removed
    assert set(sa.load_reads(d)) == {"/new"}


# ── the rising-count rule and the weekly report ───────────────────────────


def test_the_rising_count_alert_rule() -> None:
    assert sa.alert_rises({"orphan": 10}, {"orphan": 10}) == []
    assert sa.alert_rises({"orphan": 10}, {"orphan": 9}) == []
    up = sa.alert_rises({"orphan": 10}, {"orphan": 11})
    assert up == [{"family": "orphan", "before": 10, "now": 11, "new": False}], up
    new = sa.alert_rises({"orphan": 10}, {"orphan": 10, "big": 1})
    assert new == [{"family": "big", "before": 0, "now": 1, "new": True}], "a family that wasn't there is new"
    # Timing and refusals move with the night's load: a rise counts only at 10 pages and a tenth.
    assert sa.alert_rises({"slow": 100}, {"slow": 109}) == []
    assert sa.alert_rises({"slow": 100}, {"slow": 105, "orphan": 0}) == []
    assert sa.alert_rises({"slow": 100}, {"slow": 111})[0]["family"] == "slow"
    assert sa.alert_rises({"slow": 5}, {"slow": 14}) == [], "under 10 pages is noise even at double"
    assert sa.alert_rises({}, {"slow": 1})[0]["new"] is True, "a family new this week is always said"
    assert sa.alert_rises({"orphan": 3}, {}) == []


def report(counts: dict, sitemap_n: int = 1000, unread: int = 0) -> dict:
    return {"at": NOW, "sitemap": sitemap_n, "read": sitemap_n - unread, "unread": unread,
            "coverage": (sitemap_n - unread) / sitemap_n, "counts": {**counts, **({"unread": unread} if unread else {})},
            "examples": {k: [{"path": f"/{k}-1"}] for k in counts}}


def test_the_week_mails_the_owner_only_when_something_grew() -> None:
    doc: dict = {}
    doc, mail = sa.finish_week(doc, report({"orphan": 10}), "2026-11-08", NOW)
    assert mail and "first full" in mail["subject"], "the first complete week is the baseline, mailed once"
    doc = sa.mail_sent(doc, mail, NOW)
    doc, mail = sa.finish_week(doc, report({"orphan": 10}), "2026-11-15", NOW + 7 * DAY_MS)
    assert mail is None, "nothing grew"
    doc, mail = sa.finish_week(doc, report({"orphan": 12, "big": 1}), "2026-11-22", NOW + 14 * DAY_MS)
    assert mail and "2 problems grew" in mail["subject"], mail and mail["subject"]
    assert "up from 10" in mail["text"] and "new this week" in mail["text"], mail["text"]
    doc = sa.mail_sent(doc, mail, NOW + 14 * DAY_MS)
    # The same week run again never mails twice, and still compares against the week before it.
    doc2, again = sa.finish_week(doc, report({"orphan": 12, "big": 1}), "2026-11-22", NOW + 14 * DAY_MS + 60_000)
    assert again is None and doc2["latestWeek"]["rises"], doc2["latestWeek"]
    # A week that read under 95% of the sitemap is reported without a comparison and doesn't become the baseline.
    doc, mail = sa.finish_week(doc, report({"orphan": 2}, unread=60), "2026-11-29", NOW + 21 * DAY_MS)
    assert mail is None and doc["latestWeek"]["complete"] is False
    doc, mail = sa.finish_week(doc, report({"orphan": 13, "big": 1}), "2026-12-06", NOW + 28 * DAY_MS)
    assert mail and doc["latestWeek"]["comparedWith"] == "2026-11-22", doc["latestWeek"]
    assert len(doc["weeks"]) <= sa.WEEKS_KEPT


def test_an_unsent_mail_waits_for_the_next_night() -> None:
    doc, mail = sa.finish_week({}, report({"orphan": 10}), "2026-11-08", NOW)
    doc = sa.mail_failed(doc, mail, "the Worker answered 502")
    assert doc["mail"]["pending"]["subject"] == mail["subject"]
    assert sa.pending_mail(doc) == doc["mail"]["pending"]
    doc = sa.mail_sent(doc, doc["mail"]["pending"], NOW + DAY_MS)
    assert sa.pending_mail(doc) is None and doc["mail"]["sentWeek"] == "2026-11-08"


@contextlib.contextmanager
def audit_emails():
    """Run as if the routing list sent the week's growth (audit.weekly) by email. Today's list leaves it to the
    morning report; the tests of the email itself run under this."""
    routes = json.loads((HERE / "data" / "alert_routes.json").read_text())
    for r in routes["routes"]:
        if r["id"] == "audit.weekly":
            r["channel"] = "email"
    real = sa.ROUTES
    sa.ROUTES = sa.alert_routes.Routes(routes)
    try:
        yield
    finally:
        sa.ROUTES = real


def test_the_routing_list_decides_whether_the_audit_emails() -> None:
    # The week's growth is the routing list's audit.weekly (scripts/data/alert_routes.json): left to the morning
    # report, which carries it, the audit sends nothing and marks the week done, so it doesn't wait as pending.
    doc, mail = sa.finish_week({}, report({"orphan": 10}), "2026-11-08", NOW)
    assert sa.ROUTES.ok and sa.ROUTES.channel("audit.weekly") == "report"
    left, due = sa.mail_due(doc, mail)
    assert due is None and sa.pending_mail(left) is None and left["mail"]["sentWeek"] == "2026-11-08", left
    _, again = sa.finish_week(left, report({"orphan": 10}), "2026-11-08", NOW + 60_000)
    assert again is None, "the same week is never composed again"
    with audit_emails():
        assert sa.mail_due(doc, mail) == (doc, mail), "sent by email, the audit's own email goes as before"


def test_a_sunday_under_todays_list_mails_nothing() -> None:
    from lib_db import read_doc

    d = db()
    with Upstream() as base:
        up = sa.Upstream(base, host="permtracker.app")
        before = len([m for m in Fake.mail if m["path"] == "/owner"])
        sa.run_night(d, up, day=dt.date(2026, 11, 22), seconds=30, rate=200,
                     mail_cfg={"url": f"{base}/owner", "key": "k"}, clock_ms=lambda: NOW, log=lambda *a: None)
        assert len([m for m in Fake.mail if m["path"] == "/owner"]) == before, "the morning report carries the week"
        doc = read_doc(d, sa.DOC_KEY)
        assert doc["latestWeek"]["complete"] and doc["mail"]["leftToReport"] and not doc["mail"]["pending"]


def test_the_mail_reads_like_a_person_wrote_it() -> None:
    doc, mail = sa.finish_week({}, report({"orphan": 3713, "title_long": 24}), "2026-11-22", NOW)
    text = mail["subject"] + "\n" + mail["text"]
    assert "\u2014" not in text and "!" not in text, "no em dashes, no exclamation marks"
    assert "Sunday, Nov 22" in mail["text"], mail["text"]
    assert "3,713" in mail["text"] and "/orphan-1" in mail["text"]
    assert re.search(r"\d{1,2}:\d{2} (AM|PM) E[SD]T", mail["text"]), "a time on the owner's clock"


def test_owner_mail_goes_through_the_worker_with_its_key() -> None:
    with tempfile.TemporaryDirectory() as tmp, Upstream() as base:
        cred = pathlib.Path(tmp) / "owner-mail"
        cred.write_text(f'OWNER_MAIL_URL="{base}/owner"\nOWNER_MAIL_KEY=abc123\n')
        cfg = sa.owner_mail_config({}, tmp)
        assert cfg == {"url": f"{base}/owner", "key": "abc123"}, cfg
        ok, err = sa.send_owner_mail("Subject", "Body", cfg)
        assert ok and err is None and Fake.mail[-1]["key"] == "abc123"
        assert Fake.mail[-1]["body"] == {"subject": "Subject", "text": "Body"}
        assert "permtracker" in Fake.mail[-1]["ua"], "Cloudflare refuses Python's own user agent"
        ok, err = sa.send_owner_mail("S", "B", {"url": f"{base}/broken", "key": "abc123"})
        assert not ok and "500" in err, err
    assert sa.owner_mail_config({}, None) is None
    assert sa.send_owner_mail("S", "B", None) == (False, "no mail Worker key (owner-mail credential)")
    env = {"OWNER_MAIL_URL": "https://w/owner", "OWNER_MAIL_KEY": "k"}
    assert sa.owner_mail_config(env, None) == {"url": "https://w/owner", "key": "k"}


# ── the sitemap ────────────────────────────────────────────────────────────


def test_the_sitemap_index_and_its_children_are_read_through_one_rule() -> None:
    files = {
        "/sitemap.xml": "<sitemapindex><sitemap><loc>https://permtracker.app/sitemaps/pages.xml</loc></sitemap>"
                        "<sitemap><loc>https://permtracker.app/sitemaps/employer-1.xml</loc></sitemap></sitemapindex>",
        "/sitemaps/pages.xml": "<urlset><url><loc>https://permtracker.app/</loc></url>"
                               "<url><loc>https://permtracker.app/perm-queue/</loc></url></urlset>",
        "/sitemaps/employer-1.xml": "<urlset><url><loc>https://permtracker.app/perm-employers/a&amp;b</loc></url>"
                                    "<url><loc>https://permtracker.app/</loc></url>"
                                    "<url><loc>https://elsewhere.example/x</loc></url></urlset>",
    }
    got = sa.read_sitemap(lambda path: files[path])
    assert got == ["/", "/perm-queue", "/perm-employers/a&b"], got
    try:
        sa.read_sitemap(lambda path: "<urlset></urlset>")
    except sa.SitemapUnreadable:
        pass
    else:
        raise AssertionError("an empty sitemap fails the night")


def test_the_window_closes_at_the_next_stopping_time_in_real_seconds() -> None:
    et = sa.ET
    start = dt.datetime(2026, 11, 22, 21, 30, tzinfo=et)
    assert sa.deadline_after(start, "00:45", 240) == 195 * 60
    assert sa.deadline_after(start, "00:45", 60) == 60 * 60, "never longer than the cap"
    # Across the fall-back hour (Nov 1 2026, 2 AM EDT is 1 AM EST), a stop at 3:00 is five real hours after 11 PM.
    late = dt.datetime(2026, 10, 31, 23, 0, tzinfo=et)
    assert sa.deadline_after(late, "03:00", 600) == 5 * 3600, sa.deadline_after(late, "03:00", 600)


# ── a whole night, end to end ──────────────────────────────────────────────


def test_a_night_reads_stores_reports_and_closes_the_week() -> None:
    from lib_db import read_doc

    d = db()
    sunday = dt.date(2026, 11, 22)
    clock = lambda: NOW  # noqa: E731
    with Upstream() as base, audit_emails():
        up = sa.Upstream(base, host="permtracker.app")
        cfg = {"url": f"{base}/owner", "key": "k"}
        # A Thursday: its seventh, then every never-read page; no week closes, nobody is mailed.
        night = sa.run_night(d, up, day=dt.date(2026, 11, 19), seconds=30, rate=200, mail_cfg=cfg, clock_ms=clock,
                             log=lambda *a: None)
        assert night["read"] == len(SITEMAP) and night["stoppedBy"] == "done", night
        assert night["planned"] + night["behind"] == len(SITEMAP), night
        assert night["pauseReasons"] == {}, "a night with no pause names none"
        assert not [m for m in Fake.mail if m["path"] == "/owner"], "no email on a weekday"
        doc = read_doc(d, sa.DOC_KEY)
        assert doc["night"]["weekday"] == "Thursday" and "latestWeek" not in doc, doc.keys()
        c = doc["current"]["counts"]
        assert c["error"] == 1 and c["redirect"] == 1 and c["noindex"] == 1 and c["orphan"] == 5, c
        assert c["non_canonical"] == 3, "the fake page names another page as its canonical"
        # Sunday: everything was read in the last 8 days, so the week is complete, and the first one is mailed.
        night = sa.run_night(d, up, day=sunday, seconds=30, rate=200, mail_cfg=cfg, clock_ms=lambda: NOW + 3 * DAY_MS,
                             log=lambda *a: None)
        sent = [m for m in Fake.mail if m["path"] == "/owner"]
        assert len(sent) == 1 and "first full" in sent[0]["body"]["subject"], sent
        doc = read_doc(d, sa.DOC_KEY)
        assert doc["latestWeek"]["complete"] and doc["mail"]["sentWeek"] == "2026-11-22", doc["mail"]
        # The same Sunday run again mails nothing more.
        sa.run_night(d, up, day=sunday, seconds=30, rate=200, mail_cfg=cfg, clock_ms=lambda: NOW + 3 * DAY_MS + 1,
                     log=lambda *a: None)
        assert len([m for m in Fake.mail if m["path"] == "/owner"]) == 1


def test_a_mail_the_worker_refused_is_kept_and_sent_the_next_night() -> None:
    from lib_db import read_doc

    d = db()
    with Upstream() as base, audit_emails():
        up = sa.Upstream(base, host="permtracker.app")
        sa.run_night(d, up, day=dt.date(2026, 11, 22), seconds=30, rate=200,
                     mail_cfg={"url": f"{base}/broken", "key": "k"}, clock_ms=lambda: NOW, log=lambda *a: None)
        doc = read_doc(d, sa.DOC_KEY)
        assert doc["mail"]["pending"] and "500" in doc["mail"]["lastError"], doc["mail"]
        sa.run_night(d, up, day=dt.date(2026, 11, 23), seconds=30, rate=200,
                     mail_cfg={"url": f"{base}/owner", "key": "k"}, clock_ms=lambda: NOW + DAY_MS, log=lambda *a: None)
        doc = read_doc(d, sa.DOC_KEY)
        assert doc["mail"]["pending"] is None and doc["mail"]["sentWeek"] == "2026-11-22", doc["mail"]
        assert len([m for m in Fake.mail if m["path"] == "/owner"]) == 1


# ── the server unit: the window avoids the night deploys ──────────────────


def test_the_timer_runs_in_the_evening_and_stops_before_the_deploy_window() -> None:
    systemd = HERE / "oracle" / "systemd"
    timer = (systemd / "permtracker-site-audit.timer").read_text()
    service = (systemd / "permtracker-site-audit.service").read_text()
    m = re.search(r"^OnCalendar=\*-\*-\* (\d\d):(\d\d):00 America/New_York$", timer, re.M)
    assert m, "an Eastern start time"
    start = int(m.group(1)) * 60 + int(m.group(2))
    until = re.search(r"--until (\d\d):(\d\d)", service)
    assert until, "the service names its stopping time"
    stop = int(until.group(1)) * 60 + int(until.group(2))
    # The night deploys, the backups and the 4:10 AM sweep run from 1 AM to 5 AM Eastern; the evening sweep at 8:10 PM.
    assert 21 * 60 <= start < 24 * 60 and stop <= 60, (start, stop)
    window = (stop + 24 * 60 - start)
    limit = re.search(r"^TimeoutStartSec=(\d+)h(?:(\d+)min)?$", service, re.M)
    assert limit and int(limit.group(1)) * 60 + int(limit.group(2) or 0) > window, "systemd's limit is past the window"
    assert "Persistent=false" in timer, "a missed night is caught up in the next nights' spare time"
    assert "scripts/site_audit.py" in service and "User=permtracker" in service
    assert "LoadCredential=owner-mail:/etc/permtracker/owner-mail.env" in service
    assert re.search(r"--workers 2\b", service), "two requests at a time"


def test_nothing_prints_a_secret() -> None:
    src = (HERE / "site_audit.py").read_text()
    assert "print(cfg" not in src and "print(key" not in src


TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]


def main() -> int:
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"  ok   {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {t.__name__}: {type(e).__name__}: {e}")
    print(f"{len(TESTS) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""The server's IndexNow sender: which pages it tells, how it batches, its daily cap, and that a refusal is never quiet.

    python3 scripts/test_indexnow_submit.py      (pytest reads the same test_ functions)

No network: every POST goes to a stand-in, robots.txt is a string, and the run's record is a list.
"""
from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import re
import sys
import tempfile
import urllib.error
from contextlib import redirect_stdout

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("indexnow_submit", HERE / "indexnow_submit.py")
ix = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(ix)

# The site's robots.txt as /robots.txt serves it (src/app/robots.ts), cut to the rules the tests lean on.
ROBOTS = """User-Agent: *
Allow: /
Allow: /api-terms
Disallow: /api
Disallow: /dashboard
Disallow: /settings
Disallow: /perm-case-status?
Disallow: /perm-queue/*/

User-Agent: SemrushBot
Disallow: /

Sitemap: https://permtracker.app/sitemap.xml
"""
NOON = 1_795_194_000  # Friday Nov 20 2026, 12:00 PM EST
HOUR = 3600


class IndexNow:
    """Records each POST body; answers each status in `codes` in turn (an Exception is raised), then 200."""

    def __init__(self, codes: list[object] | None = None):
        self.bodies: list[dict] = []
        self.urls: list[str] = []
        self.codes = list(codes or [])

    def __call__(self, req) -> int:
        self.bodies.append(json.loads(req.data))
        self.urls.append(req.full_url)
        code = self.codes.pop(0) if self.codes else 200
        if isinstance(code, Exception):
            raise code
        return int(code)


class Recorder:
    def __init__(self):
        self.rows: list[tuple[str, str, int, str]] = []

    def __call__(self, script: str, status: str, rows: int, note: str) -> None:
        self.rows.append((script, status, rows, note))


def run(argv: list[str], *, files: dict[str, str], robots: str | Exception = ROBOTS, now: float = NOON,
        api: IndexNow | None = None, env_text: str = "", state: dict | None = None,
        key: str | None = "0123456789abcdef0123456789abcdef") -> tuple[int, str, IndexNow, Recorder, dict]:
    """Run main() in a temp folder: `files` are written there and named in argv by their key."""
    api = api or IndexNow()
    rec = Recorder()
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        for name, text in files.items():
            (t / name).write_text(text)
        st = t / "indexnow.json"
        if state is not None:
            st.write_text(json.dumps(state))
        (t / "production.env").write_text(env_text)

        def read_robots() -> str:
            if isinstance(robots, Exception):
                raise robots
            return robots

        out = io.StringIO()
        with redirect_stdout(out):
            code = ix.main(
                [a if a not in files else str(t / a) for a in argv],
                post=api, record=rec, read_robots=read_robots, now=lambda: now, key=key,
                state_path=st, env_path=t / "production.env", pause=0)
        saved = json.loads(st.read_text()) if st.exists() else {}
    return code, out.getvalue(), api, rec, saved


def answer(paths: list[str]) -> str:
    return json.dumps({"revalidated": len(paths), "paths": paths, "board": "saved", "now": 1})


# --- the key ---------------------------------------------------------------------------------------------------

def test_the_key_is_the_one_the_site_serves():
    key = ix.find_key(HERE.parent / "public")
    assert key and re.fullmatch(r"[A-Za-z0-9-]{8,128}", key), key
    assert (HERE.parent / "public" / f"{key}.txt").read_text().strip() == key
    # The deploy's sender (indexnow.mjs) uses the same key, so Bing sees one owner.
    assert f'"{key}"' in (HERE / "indexnow.mjs").read_text()


def test_no_key_file_means_no_key():
    with tempfile.TemporaryDirectory() as tmp:
        (pathlib.Path(tmp) / "robots.txt").write_text("User-Agent: *")
        (pathlib.Path(tmp) / "abcdef123456.txt").write_text("something else")
        assert ix.find_key(pathlib.Path(tmp)) is None


# --- robots.txt --------------------------------------------------------------------------------------------------

def test_robots_reads_the_open_group_longest_rule_first():
    rules = ix.robots_rules(ROBOTS)
    assert ix.robots_allows(rules, "/")
    assert ix.robots_allows(rules, "/perm-employers/google-llc")
    assert not ix.robots_allows(rules, "/api/revalidate-sweep")
    assert not ix.robots_allows(rules, "/dashboard")
    # The longer Allow re-opens a public page under a closed prefix (robots.ts, PUBLIC_UNDER_A_DISALLOW).
    assert ix.robots_allows(rules, "/api-terms")
    # A wildcard closes the filing-day pages and leaves their month open.
    assert not ix.robots_allows(rules, "/perm-queue/2026-01/15")
    assert ix.robots_allows(rules, "/perm-queue/2026-01")
    # The group for one named crawler isn't ours to follow.
    assert ix.robots_allows(rules, "/about")


def test_robots_end_anchor_and_ties():
    rules = ix.robots_rules("User-agent: *\nDisallow: /*.json$\nDisallow: /x\nAllow: /x\n")
    assert not ix.robots_allows(rules, "/data/file.json")
    assert ix.robots_allows(rules, "/data/file.json/page")
    assert ix.robots_allows(rules, "/x"), "a tie goes to Allow, as Google and RFC 9309 read it"


# --- which pages -------------------------------------------------------------------------------------------------

def test_only_public_indexable_pages_on_the_site():
    rules = ix.robots_rules(ROBOTS)
    keep, dropped = ix.public_paths([
        "/today",
        "https://permtracker.app/faq",
        "/today",                                     # twice
        "/api/revalidate-sweep",                      # closed by robots.txt
        "/perm-case-status?case=G-100-26001-123456",  # a query
        "/guides/x#part",                             # a fragment
        "https://example.com/today",                  # another site
        "http://permtracker.app/faq",                 # not https
        "/perm-employers/../dashboard",               # a climb
        "/perm-employers/a b",                        # a space
        "relative/path",
        "",
        "/perm-employers/hidden-co",                  # a withheld name's page
        "/perm-attorneys/hidden-firm",
        "/perm-employers/google-llc",
    ], rules, withheld={"/perm-employers/hidden-co", "/perm-attorneys/hidden-firm"})
    assert keep == ["/today", "/faq", "/perm-employers/google-llc"], keep
    assert dropped["closed to crawlers by robots.txt"] == 1, dropped
    assert dropped["withheld at its owner's request"] == 2, dropped
    assert sum(dropped.values()) == 11, dropped


def test_withheld_pages_come_from_the_servers_own_lists():
    env = {"WITHHELD_EMPLOYERS": "hidden-co|Hidden Co|Employer||1|hidden-co-inc",
           "WITHHELD_FIRMS": "hidden-firm|Hidden Firm|Law firm||2"}
    assert ix.withheld_paths(env) == {"/perm-employers/hidden-co", "/perm-employers/hidden-co-inc",
                                      "/perm-attorneys/hidden-firm"}
    assert ix.withheld_paths({}) == set()


# --- batching, the cap and the gap -------------------------------------------------------------------------------

def test_batches_never_pass_the_protocols_ten_thousand():
    assert ix.BATCH <= 10_000
    urls = [f"/p/{i}" for i in range(25_000)]
    assert [len(b) for b in ix.batches(urls)] == [10_000, 10_000, 5_000]
    assert ix.batches([]) == []


def test_the_daily_cap_and_the_gap_between_sends():
    state = {"day": "2026-11-20", "sent": ix.DAILY_CAP - 3, "last": {"/a": NOON - HOUR}}
    send, gap, over = ix.choose(["/a", "/b", "/c", "/d", "/e", "/f"], state, NOON)
    assert gap == 1, "a page told an hour ago waits for the gap"
    assert send == ["/b", "/c", "/d"] and over == 2, (send, over)
    # Past the gap it goes again, and a new Eastern day starts the count over.
    send, gap, over = ix.choose(["/a"], state, NOON + ix.MIN_GAP_S)
    assert send == ["/a"] and gap == 0
    tomorrow = ix.fresh_day(state, NOON + 13 * HOUR)  # 1 AM Eastern, Nov 21
    assert tomorrow["day"] == "2026-11-21" and tomorrow["sent"] == 0


def test_the_day_is_eastern():
    # 11 PM Eastern on Nov 20 is already Nov 21 in UTC; the count belongs to Nov 20.
    assert ix.fresh_day({}, NOON + 11 * HOUR)["day"] == "2026-11-20"


# --- the run -----------------------------------------------------------------------------------------------------

def test_a_pass_sends_its_public_pages_once_in_one_post():
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/", "/today", "/api/x"])})
    assert code == 0, out
    assert len(api.bodies) == 1
    body = api.bodies[0]
    assert api.urls == ["https://api.indexnow.org/indexnow"]
    assert body["host"] == "permtracker.app"
    assert body["key"] == "0123456789abcdef0123456789abcdef"
    assert body["keyLocation"] == "https://permtracker.app/0123456789abcdef0123456789abcdef.txt"
    assert body["urlList"] == ["https://permtracker.app/", "https://permtracker.app/today"]
    assert rec.rows == [("indexnow_submit.py --answer", "ok", 2, rec.rows[0][3])], rec.rows
    assert "1 closed to crawlers" in rec.rows[0][3], rec.rows
    assert saved["sent"] == 2 and set(saved["last"]) == {"/", "/today"}
    assert "2 sent" in out


def test_the_next_pass_within_the_gap_sends_nothing_and_says_so():
    state = {"day": "2026-11-20", "sent": 2, "last": {"/": NOON - 600, "/today": NOON - 600}}
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/", "/today"])}, state=state)
    assert code == 0 and api.bodies == []
    assert rec.rows[0][1] == "ok" and "2 told within" in rec.rows[0][3], rec.rows


def test_a_paths_file_of_employer_pages():
    code, out, api, rec, saved = run(
        ["--paths", "p.txt"], files={"p.txt": "/perm-employers/google-llc\n\n/perm-employers/hidden-co\n"},
        env_text='WITHHELD_EMPLOYERS="hidden-co|Hidden Co|Employer||1"\n')
    assert api.bodies[0]["urlList"] == ["https://permtracker.app/perm-employers/google-llc"]
    assert rec.rows[0][0] == "indexnow_submit.py --paths" and rec.rows[0][1] == "ok"
    assert "hidden-co" not in out and "hidden-co" not in rec.rows[0][3], "a withheld name is never printed"


def test_a_server_error_is_tried_once_more():
    api = IndexNow([503])
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])}, api=api)
    assert code == 0 and len(api.bodies) == 2 and rec.rows[0][1] == "ok", (api.bodies, rec.rows)
    api = IndexNow([urllib.error.URLError("timed out")])
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])}, api=api)
    assert len(api.bodies) == 2 and rec.rows[0][1] == "ok"


def test_a_refusal_never_fails_the_pass_and_is_recorded():
    api = IndexNow([429, 429])
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today", "/faq"])}, api=api)
    assert code == 0, "the pass never fails over IndexNow"
    assert len(api.bodies) == 2, "one retry, no more"
    assert rec.rows[0][1] == "failed" and "HTTP 429" in rec.rows[0][3], rec.rows
    assert saved.get("sent", 0) == 0 and not saved.get("last"), "a refused page isn't counted as told"
    assert "refused" in out


def test_our_own_mistake_isnt_retried():
    for status in (400, 403, 422):
        api = IndexNow([status])
        code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])}, api=api)
        assert code == 0 and len(api.bodies) == 1, (status, api.bodies)
        assert rec.rows[0][1] == "failed" and f"HTTP {status}" in rec.rows[0][3]


def test_202_is_accepted():
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])}, api=IndexNow([202]))
    assert rec.rows[0][1] == "ok" and saved["sent"] == 1


def test_an_unreadable_robots_sends_nothing():
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])},
                                     robots=urllib.error.URLError("refused"))
    assert code == 0 and api.bodies == []
    assert rec.rows[0][1] == "failed" and "robots.txt" in rec.rows[0][3], rec.rows


def test_no_key_sends_nothing():
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])}, key=None)
    assert code == 0 and api.bodies == [] and rec.rows[0][1] == "failed" and "key" in rec.rows[0][3]


def test_an_answer_naming_no_pages_is_a_failure():
    # The sweep's route always names its pages; an answer without them means its contract moved.
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": "{}"})
    assert code == 0 and api.bodies == [] and rec.rows[0][1] == "failed", rec.rows


def test_an_empty_paths_file_is_a_quiet_night():
    code, out, api, rec, saved = run(["--paths", "p.txt"], files={"p.txt": ""})
    assert code == 0 and api.bodies == [] and rec.rows[0][1] == "ok", rec.rows


def test_a_capped_day_records_ok_and_names_the_cap():
    state = {"day": "2026-11-20", "sent": ix.DAILY_CAP, "last": {}}
    code, out, api, rec, saved = run(["--answer", "a.json"], files={"a.json": answer(["/today"])}, state=state)
    assert api.bodies == [] and rec.rows[0][1] == "ok" and "daily cap" in rec.rows[0][3], rec.rows


def test_a_broken_state_file_starts_over():
    with tempfile.TemporaryDirectory() as tmp:
        p = pathlib.Path(tmp) / "indexnow.json"
        p.write_text("{not json")
        assert ix.load_state(p, NOON) == {"day": "2026-11-20", "sent": 0, "last": {}}
        assert ix.load_state(pathlib.Path(tmp) / "missing.json", NOON)["sent"] == 0


def test_usage():
    out = io.StringIO()
    with redirect_stdout(out):
        assert ix.main([], post=IndexNow(), record=Recorder()) == 2
        assert ix.main(["--nope", "x"], post=IndexNow(), record=Recorder()) == 2


def main() -> int:
    tests = [(n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception as exc:  # noqa: BLE001 - every test reports, then the run fails
            failed += 1
            print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed} of {len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

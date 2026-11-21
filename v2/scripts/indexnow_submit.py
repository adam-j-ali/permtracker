#!/usr/bin/env python3
"""Tell IndexNow (Bing, Yandex, Seznam, Naver, Yep and the AI answers Bing's index feeds) which pages a sweep refreshed.

    python3 scripts/indexnow_submit.py --answer <answer.json>   # the pages /api/revalidate-sweep just expired
    python3 scripts/indexnow_submit.py --paths <file>           # one path per line: the employer pages whose live rows moved

The sweep runner (oracle/bin/permtracker-sweep) calls it after each pass has expired its pages and dropped Cloudflare's
copies, so a crawler sent by IndexNow reads the new figures. The deploy tells IndexNow about the pages a release
changed itself (oracle-deploy.yml, scripts/indexnow.mjs); this is the server's half, for the pages the data moved.

What it sends (IndexNow's own rules, https://www.indexnow.org/documentation and /faq, read Nov 20 2026):
- only public pages a search engine may index: plain paths on permtracker.app that robots.txt leaves open (read from
  the site itself through nginx, so robots.ts stays the one rule) and that aren't a withheld name's page (the lists in
  the server's production.env, lib_withheld.py);
- each page at most once in MIN_GAP_S, because the FAQ asks to "avoid submitting the same URL many times a day" and
  every URL sent counts toward the site's crawl quota, while the daytime pass expires the same pages every 15 minutes;
- at most DAILY_CAP URLs an Eastern day, and at most BATCH in one POST (the protocol's 10,000).

It never fails the pass: every outcome exits 0 and is written to ingest_runs (`indexnow_submit.py --answer` or
`--paths`), where scripts/check_ingest_health.py reads it each morning and turns red on a newest run that failed. A
refusal is retried once when a retry can help (no answer, 429, 5xx), never for our own mistake (400, 403, 422). The
daily cap is a budget, so a run that stops on it records `ok` and says so. Nothing here prints a slug.

State: PT_INDEXNOW_STATE (default /srv/permtracker/health/indexnow.json), the day's count and when each page was last
told. The key is public by design: it's the file at the site's root, public/<key>.txt, found there.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from typing import Callable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lib_db import et_date  # noqa: E402
from lib_withheld import BASE, parse_env  # noqa: E402
from purge_edge import paths_from_answer, read_env  # noqa: E402

HOST = "permtracker.app"
ENDPOINT = "https://api.indexnow.org/indexnow"
BATCH = 10_000  # "You can submit up to 10,000 URLs per post" (indexnow.org/documentation)
# The busiest day sends under 3,500: at most 800 employer pages from each of four case passes (MAX_CHANGED_SLUGS in
# build_entity_detail.py), and the sweep's ~33 pages a few times. The cap stops a runaway list (a bug naming every page)
# from spending the site's crawl quota.
DAILY_CAP = 10_000
MIN_GAP_S = 4 * 3600
RETRY_PAUSE_S = 10.0
UA = "PERMTracker-indexnow/1.0 (+https://permtracker.app)"
DEFAULT_STATE = "/srv/permtracker/health/indexnow.json"
# /robots.txt through the server's own front door (nginx serves it from the built file).
DEFAULT_ROBOTS = "http://127.0.0.1:8081/robots.txt"
PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"
USAGE = "usage: indexnow_submit.py --answer <answer.json> | --paths <file>"

# A key is 8 to 128 letters, digits and dashes (indexnow.org/documentation).
KEY_RE = re.compile(r"^[A-Za-z0-9-]{8,128}$")
# A plain page path: the characters a slug or a route segment holds, nothing else.
SAFE_PATH = re.compile(r"^/[A-Za-z0-9/_.~-]*$")

NOT_PLAIN = "not a plain page on this site"
CLOSED = "closed to crawlers by robots.txt"
WITHHELD = "withheld at its owner's request"
REPEATED = "repeated"

Post = Callable[[urllib.request.Request], int]
Record = Callable[[str, str, int, str], None]


def find_key(public: pathlib.Path) -> str | None:
    """The IndexNow key: the one file `<key>.txt` in public/ that holds its own name, as the protocol asks."""
    found = []
    for p in sorted(public.glob("*.txt")):
        if not KEY_RE.fullmatch(p.stem):
            continue
        try:
            if p.read_text(encoding="utf-8").strip() == p.stem:
                found.append(p.stem)
        except OSError:
            continue
    return found[0] if len(found) == 1 else None


def robots_rules(text: str) -> list[tuple[bool, str]]:
    """(allow, pattern) for the group every crawler without its own follows (`User-agent: *`)."""
    rules: list[tuple[bool, str]] = []
    agents: list[str] = []
    in_rules = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        field, sep, value = line.partition(":")
        if not sep:
            continue
        field, value = field.strip().lower(), value.strip()
        if field == "user-agent":
            if in_rules:  # a user-agent line after rules starts the next group
                agents, in_rules = [], False
            agents.append(value.lower())
        elif field in ("allow", "disallow"):
            in_rules = True
            if "*" in agents and value:
                rules.append((field == "allow", value))
    return rules


def _matches(pattern: str, path: str) -> bool:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    rx = "^" + ".*".join(re.escape(part) for part in body.split("*")) + ("$" if anchored else "")
    return re.match(rx, path) is not None


def robots_allows(rules: list[tuple[bool, str]], path: str) -> bool:
    """The longest matching rule decides, and Allow wins a tie (RFC 9309, as Google and Bing read it)."""
    best: tuple[int, bool] | None = None
    for allow, pattern in rules:
        if _matches(pattern, path):
            key = (len(pattern), allow)
            if best is None or key > best:
                best = key
    return True if best is None else best[1]


def withheld_paths(env: dict[str, str]) -> set[str]:
    """Every page address a withheld name's entries cover; they answer 404."""
    return {f"{BASE[e.kind]}/{slug}" for e in parse_env(env) for slug in e.all_slugs()}


def _plain_path(item: str) -> str | None:
    s = item.strip()
    if s == f"https://{HOST}":
        return "/"
    if s.startswith(f"https://{HOST}/"):
        s = s[len(f"https://{HOST}"):]
    if not SAFE_PATH.fullmatch(s) or "//" in s:
        return None
    if any(seg in (".", "..") for seg in s.split("/")):
        return None
    return s


def public_paths(items: list[str], rules: list[tuple[bool, str]], withheld: set[str]) -> tuple[list[str], Counter]:
    """The paths worth telling IndexNow about, in their order, and how many were left out for each reason."""
    keep: list[str] = []
    seen: set[str] = set()
    dropped: Counter = Counter()
    for item in items:
        if not item.strip():
            continue
        path = _plain_path(item)
        if path is None:
            dropped[NOT_PLAIN] += 1
        elif path in seen:
            dropped[REPEATED] += 1
        elif not robots_allows(rules, path):
            dropped[CLOSED] += 1
        elif path in withheld:
            dropped[WITHHELD] += 1
        else:
            seen.add(path)
            keep.append(path)
    return keep, dropped


def batches(paths: list[str]) -> list[list[str]]:
    return [paths[i:i + BATCH] for i in range(0, len(paths), BATCH)]


def fresh_day(state: dict, now: float) -> dict:
    """The ledger for `now`'s Eastern day: the count starts over on a new day, and pages told longer ago than the
    gap are forgotten (they're due again either way)."""
    today = et_date(int(now)) or ""
    last = state.get("last") if isinstance(state.get("last"), dict) else {}
    kept = {}
    for path, at in last.items():
        try:
            if now - float(at) < MIN_GAP_S:
                kept[str(path)] = float(at)
        except (TypeError, ValueError):
            continue
    try:
        sent = int(state.get("sent", 0)) if state.get("day") == today else 0
    except (TypeError, ValueError):
        sent = 0
    return {"day": today, "sent": sent, "last": kept}


def load_state(path: pathlib.Path, now: float) -> dict:
    """The saved ledger, or a fresh one when there's none or it can't be read."""
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        state = {}
    return fresh_day(state if isinstance(state, dict) else {}, now)


def save_state(path: pathlib.Path, state: dict) -> str:
    """Write the ledger whole or not at all; '' when saved, else why not."""
    try:
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(state, separators=(",", ":")))
        os.replace(tmp, path)
        return ""
    except OSError as exc:
        return f"the ledger couldn't be saved ({type(exc).__name__})"


def choose(paths: list[str], state: dict, now: float) -> tuple[list[str], int, int]:
    """(what to send, how many were told within the gap, how many are over the day's cap)."""
    last = state.get("last", {})
    due = [p for p in paths if now - float(last.get(p, 0)) >= MIN_GAP_S]
    room = max(0, DAILY_CAP - int(state.get("sent", 0)))
    return due[:room], len(paths) - len(due), max(0, len(due) - room)


def _post(req: urllib.request.Request) -> int:
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)


def post_batch(paths: list[str], key: str, post: Post, pause: float) -> tuple[bool, str]:
    """POST one batch, tried once more when a retry can help. (accepted, the last answer)."""
    body = json.dumps({
        "host": HOST, "key": key, "keyLocation": f"https://{HOST}/{key}.txt",
        "urlList": [f"https://{HOST}{p}" for p in paths],
    }).encode()
    why = ""
    for attempt in range(2):
        req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
            "Content-Type": "application/json; charset=utf-8", "User-Agent": UA})
        try:
            status: int | None = post(req)
        except Exception as exc:  # noqa: BLE001 - no answer is counted and named, never raised
            status, why = None, f"no answer ({type(exc).__name__})"
        # 200 received; 202 received while the key is checked (indexnow.org/documentation).
        if status in (200, 202):
            return True, f"HTTP {status}"
        if status is not None:
            why = f"HTTP {status}"
        # 400, 403 and 422 say the request, the key or a URL is wrong: the same request can only fail again.
        if attempt == 1 or (status is not None and status != 429 and status < 500):
            return False, why
        time.sleep(pause)
    return False, why


def _read_robots() -> str:
    req = urllib.request.Request(os.environ.get("PT_ROBOTS_URL", DEFAULT_ROBOTS), headers={"Host": HOST, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _record(script: str, status: str, rows: int, note: str) -> None:
    try:
        from lib_db import Database, record_run
        if not record_run(Database(), script, status=status, rows_written=rows, note=note[:500]):
            print("indexnow: the run's row didn't reach ingest_runs")
    # SystemExit too: lib_db's settings reader ends the program when DATABASE_URL isn't set.
    except (Exception, SystemExit) as exc:  # noqa: BLE001 - bookkeeping never fails the pass
        print(f"indexnow: couldn't record the run ({type(exc).__name__})")


_DEFAULT = object()


def main(argv: list[str], *, post: Post = _post, record: Record = _record,
         read_robots: Callable[[], str] = _read_robots, now: Callable[[], float] = time.time,
         key: object = _DEFAULT, state_path: pathlib.Path | None = None, env_path: pathlib.Path | None = None,
         pause: float = RETRY_PAUSE_S) -> int:
    if len(argv) != 2 or argv[0] not in ("--answer", "--paths"):
        print(USAGE)
        return 2
    mode, file = argv[0][2:], argv[1]
    script = f"indexnow_submit.py --{mode}"
    t = now()

    def done(status: str, sent: int, note: str) -> int:
        print(f"indexnow: {note}")
        record(script, status, sent, note)
        return 0

    try:
        text = pathlib.Path(file).read_text()
    except OSError:
        text = ""
    items = paths_from_answer(text) if mode == "answer" else text.splitlines()
    if not any(i.strip() for i in items):
        if mode == "answer":
            return done("failed", 0, "the sweep's answer named no pages, which it always does; nothing sent")
        return done("ok", 0, "no pages changed; nothing sent")

    k = (os.environ.get("INDEXNOW_KEY") or find_key(PUBLIC)) if key is _DEFAULT else key
    if not isinstance(k, str) or not KEY_RE.fullmatch(k):
        return done("failed", 0, "no IndexNow key file in public/; nothing sent")
    try:
        robots = read_robots()
    except Exception as exc:  # noqa: BLE001
        return done("failed", 0, f"robots.txt unreadable ({type(exc).__name__}); nothing sent")
    if "user-agent" not in robots.lower():
        return done("failed", 0, "robots.txt came back without a user-agent line; nothing sent")

    env_file = env_path or pathlib.Path(os.environ.get(
        "PT_WITHHELD_ENV", os.path.join(os.environ.get("PT_ENV_DIR", "/srv/permtracker/app/env"), "production.env")))
    keep, dropped = public_paths(items, robots_rules(robots), withheld_paths(read_env(env_file)))

    ledger = state_path or pathlib.Path(os.environ.get("PT_INDEXNOW_STATE", DEFAULT_STATE))
    state = load_state(ledger, t)
    send, gap, over = choose(keep, state, t)
    accepted, refusals, answers = 0, [], []
    for batch in batches(send):
        ok, why = post_batch(batch, k, post, pause)
        if ok:
            accepted += len(batch)
            state["sent"] += len(batch)
            state["last"].update({p: t for p in batch})
            answers.append(why)
        else:
            refusals.append(f"{len(batch):,} refused ({why})")
    unsaved = save_state(ledger, state) if send else ""

    parts = [f"{sum(1 for i in items if i.strip()):,} named", f"{accepted:,} sent" + (f" ({answers[-1]})" if answers else "")]
    if gap:
        parts.append(f"{gap:,} told within the last {MIN_GAP_S // 3600} hours")
    if over:
        parts.append(f"{over:,} over the daily cap of {DAILY_CAP:,}")
    parts += [f"{n:,} {reason}" for reason, n in dropped.items()]
    parts += refusals
    if unsaved:
        parts.append(unsaved)
    note = ", ".join(parts)
    if over and not refusals:
        note = f"stopped on the daily cap of {DAILY_CAP:,}: {note}"
    return done("failed" if refusals else "ok", accepted, note)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Heading structure across every public page, read from the SITEMAP.

Read from the sitemap rather than a hand-kept list, because a page nobody
remembered is exactly the page that breaks.

WHAT IT CHECKS, and why each one is worth a finding:

  h1 count      Exactly one. Zero leaves an extractor guessing the subject;
                several make it pick.
  duplicates    The same heading text twice on one page. Answer engines build
                "what is this about" from the outline, and a repeated H2 reads
                to a person as a navigation bug.
  level skips   h2 straight to h4. Assistive technology presents the outline as
                a tree, and a missing level is a broken branch.
  sub-pages     A parent page links each page scripts/data/child_pages.json
                says is reached from it (the unit test every-page-reachable
                holds every other page to the header, menus and footer).
  name          The H1 holds the page's one name, the breadcrumb trail's last
                item (lib/siteMap.ts). A reader who clicked "PERM backlog" in
                a menu lands on a heading that says it: one name in the header,
                menu, title, heading and search (owner's rule, Nov 24 2026).

Entity pages are sampled rather than walked: 78,600 of them share three
templates, so three of each says everything and the rest is load on the site.

    python3 scripts/audit_headings.py
    python3 scripts/audit_headings.py --base http://localhost:3100
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys
import urllib.request
from lib_audit import audit_headers, audit_urlopen  # noqa: E402
from audit_visible_text import drop_hidden, resolve_streaming  # noqa: E402

HEADERS = {
    "User-Agent": "permtracker-audit/1.0",
    # Exempts the audit from the per-address limits (lib_audit.py).
    **audit_headers(),
}

# One page is enough to judge a template, and these are the templated families.
# A family missing here is walked, every page of it, and on a fresh deploy each
# of those is a cold render; add a new [slug] family the day it ships.
TEMPLATED = ("/perm-employers/", "/perm-attorneys/", "/perm-wages/",
             "/perm-queue/", "/perm-rfi-audit/", "/blog/", "/guides/",
             "/changelog/", "/perm-cities/", "/perm-industries/", "/perm-countries/",
             "/visa-bulletin/categories/", "/embed/", "/soc-codes/")
# Families whose pages share a prefix with static pages, told apart by shape.
TEMPLATED_RE = ((re.compile(r"^/visa-bulletin/\d{4}-\d{2}$"), "/visa-bulletin/<month>"),)
SAMPLE_PER_TEMPLATE = 2

# Some repetition is the CONTENT, not a defect. A policy feed legitimately
# lists the same Federal Register notice title more than once, because DOL
# published it more than once.
ALLOW_DUPLICATES = {
    # A policy feed legitimately lists the same Federal Register notice title
    # more than once, because DOL published it more than once.
    "/policy-changes",
    # A legal policy repeats "What We Collect" / "Your Controls" under each
    # numbered vendor section, and the numbered <h2> above each disambiguates
    # it for a reader. Qualifying them ("What We Collect (PostHog)") would be
    # noise, not a fix.
    "/privacy",
    # DOL uses the same status words (BALCA affirmed, Center Director review
    # affirmed) for wage requests and for H-2A and H-2B, and each program's
    # <h2> section explains them for that program.
    "/perm-case-statuses",
}


# Pages whose heading says something other than their menu name on purpose, each with its reason. A page added here
# is a decision, never a way past the check.
NAME_NOT_IN_H1 = {
    "/for-attorneys": "the menus name the audience; the heading says what the page does for them",
    "/for-employers": "the menus name the audience; the heading says what the page does for them",
    "/perm-updates": "the heading names the day its figures are for; the header's Today's decisions leads to it",
    "/faq": "the heading spells out the abbreviation the menus use",
}


# Pages reached from their parent rather than a menu (the unit test every-page-reachable.test.ts reads the same list).
CHILD_PAGES: dict[str, str] = json.loads(
    (pathlib.Path(__file__).resolve().parent / "data" / "child_pages.json").read_text())["pages"]


def name_words(text: str) -> str:
    """A name or heading compared by its words: case, apostrophes, punctuation and a plural s set aside, so
    "Wage requests" is found in "Find a prevailing wage request"."""
    t = re.sub(r"[\u2019']", "", text.lower())
    words = re.sub(r"[^a-z0-9]+", " ", t).split()
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in words)


def trail_name(html: str) -> str | None:
    """The breadcrumb trail's last name, from the page's BreadcrumbList JSON-LD; None on a page without one."""
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>', html):
        try:
            doc = json.loads(m.group(1))
        except ValueError:
            continue
        nodes = doc if isinstance(doc, list) else doc.get("@graph", [doc]) if isinstance(doc, dict) else []
        for n in nodes:
            if isinstance(n, dict) and n.get("@type") == "BreadcrumbList":
                items = n.get("itemListElement") or []
                if len(items) >= 2 and isinstance(items[-1], dict) and items[-1].get("name"):
                    return str(items[-1]["name"])
    return None


def holds_name(h1: str, name: str) -> bool:
    return f" {name_words(name)} " in f" {name_words(h1)} "


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        return audit_urlopen(req, timeout=45).read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"  !! {url}: {e}", file=sys.stderr)
        return None


def detext(html: str) -> str:
    t = re.sub(r"<[^>]+>", " ", html)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&#x27;", "'"),
                 ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'")):
        t = t.replace(a, b)
    return " ".join(t.split())


def page_paths(base: str) -> list[str]:
    """Every static page, plus a sample of each templated family."""
    # Re-base every URL, the child sitemaps included: `.env.local` sets
    # NEXT_PUBLIC_APP_URL=http://localhost:3000, so a local server emits that
    # host in every <loc> whatever port it is actually listening on.
    def rebase(u: str) -> str:
        return base + (re.sub(r"^https?://[^/]+", "", u) or "/")

    index = fetch(f"{base}/sitemap.xml") or ""
    children = [rebase(u) for u in re.findall(r"<loc>([^<]+)</loc>", index)]
    locs: list[str] = []
    for child in children:
        xml = fetch(child)
        if xml:
            locs += re.findall(r"<loc>([^<]+)</loc>", xml)
    paths = sorted({re.sub(r"^https?://[^/]+", "", u) or "/" for u in locs})

    kept, seen = [], collections.Counter()
    for p in paths:
        fam = next((t for t in TEMPLATED if p.startswith(t)), None) or next(
            (name for rx, name in TEMPLATED_RE if rx.match(p)), None)
        if fam is None:
            kept.append(p)
            continue
        if seen[fam] < SAMPLE_PER_TEMPLATE:
            seen[fam] += 1
            kept.append(p)
    return kept


def headings(html: str) -> list[tuple[int, str]]:
    """The outline a reader gets: headings inside a hidden, inert or
    aria-hidden subtree are left out, as assistive technology leaves them out.
    A streamed page is read after React's swaps (resolve_streaming): read raw,
    a dev server's tool pages had every heading twice (60 pages on Oct 15
    2026), and a streamed case page had only its skeleton's."""
    html = resolve_streaming(html)
    body = html[html.index("<body"):] if "<body" in html else html
    for tag in ("script", "style", "svg", "noscript", "template"):
        body = re.sub(rf"<{tag}\b[^>]*>[\s\S]*?</{tag}>", " ", body, flags=re.I)
    body = drop_hidden(body)
    out = []
    for m in re.finditer(r"<h([1-6])\b[^>]*>([\s\S]*?)</h\1>", body):
        t = detext(m.group(2))
        if t:
            out.append((int(m.group(1)), t))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://permtracker.app")
    ap.add_argument("--pages", nargs="*", default=None, help="these paths only, in place of the sitemap walk")
    ap.add_argument("--also", nargs="*", default=None, help="these paths as well as the sitemap walk (a push's changed pages)")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    walk = [] if args.pages else page_paths(base)
    paths = args.pages or list(dict.fromkeys([*walk, *(args.also or [])]))
    # The floor guards the sitemap walk, not an explicit list: a walk that
    # returns three pages means the walk broke, while checking one page by
    # name on purpose is fine.
    if args.pages is None and len(walk) < 20:
        print(f"FAIL: the sitemap walk found only {len(walk)} pages. That is "
              "a defect in this script or in the sitemap, not a clean site.")
        return 2

    print(f"scanning {len(paths)} pages\n")
    findings = 0
    scanned = 0
    for p in paths:
        html = fetch(base + p)
        if html is None:
            findings += 1
            print(f"{p}\n    - UNREACHABLE")
            continue
        scanned += 1
        hs = headings(html)
        msgs = []

        h1s = [t for lvl, t in hs if lvl == 1]
        if len(h1s) != 1:
            msgs.append(f"h1 count is {len(h1s)}: {h1s[:3]}")

        if p not in ALLOW_DUPLICATES:
            counts = collections.Counter(t.lower() for _, t in hs)
            dups = sorted(t for t, n in counts.items() if n > 1)
            if dups:
                msgs.append(f"duplicate headings: {dups[:4]}")

        prev = None
        skips = []
        for lvl, t in hs:
            if prev is not None and lvl > prev + 1:
                skips.append(f"h{prev}->h{lvl} before {t[:38]!r}")
            prev = lvl
        if skips:
            msgs.append(f"level skips: {skips[:2]}")

        missing = [c for c, parent in CHILD_PAGES.items() if parent == p and f'href="{c}"' not in html]
        if missing:
            msgs.append(f"doesn't link its pages {missing} (scripts/data/child_pages.json)")

        name = trail_name(html)
        if name and len(h1s) == 1 and p not in NAME_NOT_IN_H1 and not holds_name(h1s[0], name):
            msgs.append(f"the H1 {h1s[0][:60]!r} doesn't hold the page's name {name!r} (lib/siteMap.ts)")

        if msgs:
            findings += 1
            print(p)
            for m in msgs:
                print(f"    - {m}")

    # A CONTROL, so a blind run cannot read as a clean one.
    probe = headings("<body><h1>a</h1><h2>b</h2><h2>b</h2><h4>c</h4></body>")
    assert len(probe) == 4, "the heading parser stopped seeing headings"
    crumbs = ('<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":'
              '[{"name":"Home"},{"name":"Wage requests"}]}</script>')
    assert trail_name(crumbs) == "Wage requests", "the trail reader stopped reading the page's name"
    assert holds_name("Find a prevailing wage request", "Wage requests") and not holds_name("Where it stands", "Queue backlog"), \
        "the name comparison stopped telling a match from a miss"

    print(f"\n{scanned} pages scanned, {findings} with a finding")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())

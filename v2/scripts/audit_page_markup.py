#!/usr/bin/env python3
"""Three things a crawler reads in a page's server HTML, on every static page, two of each templated family (the
sample audit_headings.py reads) and the heaviest page of each family that grows with the data (HEAVIEST):

  structured data   every JSON-LD node held to the rules in src/lib/seo/jsonLdCheck.ts, which the vitest gate runs on
                    the builders and the source: each property allowed on its type by schema.org
                    (scripts/data/schema_org_properties.json), Google's required properties on each rich type, and no
                    two full nodes on the page sharing an @id. scripts/fixtures/jsonld_cases.json holds the two
                    validators to the same answers.
  weight            the server HTML under PAGE_BUDGET. Googlebot reads only the first 2 MB of a page ("When crawling
                    for Google Search, Googlebot crawls the first 2MB of a supported file type", Google's Googlebot
                    page). /i485-by-field-office/national-benefits-center was 3.5 MB on Nov 20 2026, 1,568 table rows
                    drawn twice (the HTML and the page's data for the browser), and the morning sample never opened it.
  parameters        no link, image, script or stylesheet address in the HTML with more than three query parameters.
                    Ahrefs counted 133 (Nov 20 2026): every image Next sized carried url, w, q and the deploy's dpl,
                    and dpl changed each night, so each deploy minted a new address for every picture.

Run each morning by page_checks.py ("markup") against the live site, and by hand against a dev server:

    python3 scripts/audit_page_markup.py --base https://permtracker.app
    python3 scripts/audit_page_markup.py --base http://localhost:3000 --pages /i485-by-field-office/national-benefits-center
    python3 scripts/audit_page_markup.py --files saved.html         # a page saved to disk
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_headings import fetch, page_paths  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
VOCAB = json.loads((ROOT / "scripts" / "data" / "schema_org_properties.json").read_text())["types"]

# Under Googlebot's 2 MB with room: a page that grows with its data is caught while it still has some.
PAGE_BUDGET = 1_500_000
MAX_PARAMS = 3

# The heaviest real page of each family whose size grows with the data, by what it lists. Chosen by the family's
# biggest member (the most filings, the most cases reported, the busiest office or post), read Nov 20 2026; a page
# here that stops answering is a finding, so a renamed slug is caught the next morning.
HEAVIEST: dict[str, str] = {
    "/i485-by-field-office/national-benefits-center": "the office with the most reported I-485s (3.5 MB on Nov 20 2026)",
    "/perm-employers/amazon-com-services-llc": "the employer with the most PERM filings",
    "/perm-employers/google-llc": "a top filer with every program's rows",
    "/perm-employers/microsoft-corporation": "a top filer",
    "/perm-attorneys/fragomen-del-rey-bernsen-loewy-llp": "the law firm with the most filings",
    "/perm-wages/software-developers": "the occupation with the most filings",
    "/soc-codes/software-engineer": "the job title with the most filings",
    "/perm-countries/india": "the country of birth with the most filings",
    "/perm-cities/new-york-ny": "the worksite city with the most filings",
    "/perm-industries/541511": "the industry with the most filings",
    "/consular-posts/ciudad-juarez": "the busiest immigrant visa post",
    "/consular-posts/mumbai": "the busiest post for employment cases",
    "/h1b-employers/california": "the state with the most H-1B employers",
    "/law-firm-rankings/california": "the state with the most ranked firms",
    "/perm-rfi-audit/rfi-issued": "the review stage with the most cases",
    "/uscis-processing-times/i-485": "the form with the most posted times",
    "/perm-employers/under-review": "every employer under review",
}

APP_TYPES = {"SoftwareApplication", "WebApplication", "MobileApplication", "VideoGame"}
ARTICLE_TYPES = {"Article", "TechArticle", "NewsArticle", "BlogPosting", "ScholarlyArticle", "Report"}
SITE_ORG_ID = re.compile(r"/#organization$")


# ---------------------------------------------------------------------------
# Structured data: the rules of src/lib/seo/jsonLdCheck.ts, rule for rule
# ---------------------------------------------------------------------------

def _types(node: dict) -> list[str]:
    t = node.get("@type")
    if isinstance(t, str):
        return [t]
    return [x for x in t if isinstance(x, str)] if isinstance(t, list) else []


def _present(v) -> bool:
    return v is not None and v != "" and not (isinstance(v, list) and len(v) == 0)


def _as_list(v) -> list:
    return [] if v is None else v if isinstance(v, list) else [v]


def _label(node: dict) -> str:
    ident = node.get("@id")
    return ("/".join(_types(node)) or "node") + (f" {ident}" if isinstance(ident, str) else "")


def is_full_node(node: dict) -> bool:
    return any(k not in ("@id", "@type", "@context") for k in node)


def google_required(node: dict, parent_key: str | None) -> list[str]:
    types = _types(node)
    out: list[str] = []

    def need(key: str, why: str) -> None:
        if not _present(node.get(key)):
            out.append(f"{_label(node)}: no {key} ({why})")

    if any(t in APP_TYPES for t in types) and is_full_node(node):
        need("name", "Google's Software App feature requires it")
        offers = [o for o in _as_list(node.get("offers")) if isinstance(o, dict)]
        if not offers or any(o.get("price") in (None, "") for o in offers):
            out.append(f"{_label(node)}: no offers.price (Google's Software App feature requires it)")
        if not _present(node.get("aggregateRating")) and not _present(node.get("review")):
            out.append(f"{_label(node)}: no aggregateRating or review (Google's Software App feature requires one)")
    if "AggregateRating" in types:
        need("ratingValue", "Google's review snippet requires it")
        if not _present(node.get("ratingCount")) and not _present(node.get("reviewCount")):
            out.append(f"{_label(node)}: no ratingCount or reviewCount (Google's review snippet requires one)")
        if parent_key != "aggregateRating":
            need("itemReviewed", "a rating not nested in its item names the item")
    if "Dataset" in types:
        need("name", "Google's Dataset feature requires it")
        d = node.get("description")
        if not isinstance(d, str) or not 50 <= len(d) <= 5000:
            out.append(f"{_label(node)}: description must be 50 to 5,000 characters (Google's Dataset feature)")
    if "BreadcrumbList" in types:
        items = [i for i in _as_list(node.get("itemListElement")) if isinstance(i, dict)]
        if not items:
            out.append(f"{_label(node)}: no itemListElement (Google's breadcrumb feature requires it)")
        for i, it in enumerate(items):
            if not isinstance(it.get("position"), (int, float)) or isinstance(it.get("position"), bool):
                out.append(f"{_label(node)}: breadcrumb {i + 1} has no numeric position")
            item = it.get("item")
            if not _present(it.get("name")) and not (isinstance(item, dict) and _present(item.get("name"))):
                out.append(f"{_label(node)}: breadcrumb {i + 1} has no name")
            if i < len(items) - 1 and not _present(item):
                out.append(f"{_label(node)}: breadcrumb {i + 1} has no item (only the last may omit it)")
    if "VideoObject" in types:
        for key in ("name", "thumbnailUrl", "uploadDate"):
            need(key, "Google's video feature requires it")
    if "FAQPage" in types:
        qs = [q for q in _as_list(node.get("mainEntity")) if isinstance(q, dict)]
        if not qs:
            out.append(f"{_label(node)}: no questions in mainEntity")
        for i, q in enumerate(qs):
            a = q.get("acceptedAnswer")
            if not _present(q.get("name")) or not isinstance(a, dict) or not _present(a.get("text")):
                out.append(f"{_label(node)}: question {i + 1} lacks its name or its answer's text")
    if any(t in ARTICLE_TYPES for t in types) and is_full_node(node):
        need("headline", "recommended by Google, held here")
        need("datePublished", "recommended by Google, held here")
        authors = _as_list(node.get("author"))
        if not authors or any(not (isinstance(a, dict) and (_present(a.get("name")) or _present(a.get("@id")))) for a in authors):
            out.append(f"{_label(node)}: no author with a name (recommended by Google, held here)")
    ident = node.get("@id")
    if "Organization" in types and isinstance(ident, str) and SITE_ORG_ID.search(ident) and is_full_node(node):
        need("logo", "the site's Organization keeps its logo")
        need("url", "the site's Organization keeps its url")
    return out


def check_jsonld(blocks: list) -> list[str]:
    """Every rule over one page's JSON-LD: the parsed contents of each of its ld+json scripts."""
    problems: list[str] = []
    full_ids: dict[str, str] = {}

    def visit(value, parent_key: str | None) -> None:
        if isinstance(value, list):
            for v in value:
                visit(v, parent_key)
            return
        if not isinstance(value, dict):
            return
        types = _types(value)
        if types:
            missing = [t for t in types if t not in VOCAB]
            if missing:
                problems.append(f"{_label(value)}: {', '.join(missing)} isn't in scripts/data/schema_org_properties.json "
                                "(read it with scripts/schema_vocab.py --add)")
            else:
                allowed = set().union(*(VOCAB[t]["properties"] for t in types))
                for key in value:
                    if not key.startswith("@") and key not in allowed:
                        problems.append(f"{_label(value)}: {key} isn't a schema.org property of {' or '.join(types)}")
            problems.extend(google_required(value, parent_key))
        ident = value.get("@id")
        if isinstance(ident, str) and is_full_node(value):
            if ident in full_ids:
                problems.append(f"two full nodes share the @id {ident} ({full_ids[ident]} and {_label(value)}); make one a reference")
            else:
                full_ids[ident] = _label(value)
        for k, v in value.items():
            if k != "@context":
                visit(v, None if k == "@graph" else k)

    for block in blocks:
        visit(block, None)
    return problems


LD_RE = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)


def jsonld_blocks(page_html: str) -> list:
    """Each ld+json script's parsed contents; a block that won't parse is returned as an Exception."""
    out: list = []
    for raw in LD_RE.findall(page_html):
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError as e:
            out.append(e)
    return out


# ---------------------------------------------------------------------------
# Addresses in the HTML
# ---------------------------------------------------------------------------

ATTR_RE = re.compile(r'\s(href|src|srcset|imagesrcset)="([^"]*)"', re.I)


def addresses(page_html: str) -> list[str]:
    """Every address in an href, src or srcset of the server HTML, as a crawler reads them (scripts' text left out)."""
    body = re.sub(r"<script\b[^>]*>.*?</script>", " ", page_html, flags=re.S | re.I)
    out: list[str] = []
    for attr, value in ATTR_RE.findall(body):
        value = html_mod.unescape(value)
        if attr.lower() in ("srcset", "imagesrcset"):
            out += [part.strip().split(" ")[0] for part in value.split(",") if part.strip()]
        else:
            out.append(value)
    return out


def param_count(url: str) -> int:
    query = urlsplit(url).query
    return len(parse_qsl(query, keep_blank_values=True)) if query else 0


# ---------------------------------------------------------------------------
# One page
# ---------------------------------------------------------------------------

def audit_html(path: str, page_html: str) -> list[str]:
    out: list[str] = []
    size = len(page_html.encode("utf-8"))
    if size > PAGE_BUDGET:
        out.append(f"{path}: {size / 1e6:.2f} MB of HTML, over the {PAGE_BUDGET / 1e6:.1f} MB budget (Googlebot reads 2 MB)")
    blocks = jsonld_blocks(page_html)
    for b in blocks:
        if isinstance(b, Exception):
            out.append(f"{path}: a JSON-LD block isn't JSON ({b})")
    out += [f"{path}: {p}" for p in check_jsonld([b for b in blocks if not isinstance(b, Exception)])]
    # One line a page: a picture's srcset alone holds a dozen addresses, and the morning report keeps 12 lines.
    many = list(dict.fromkeys(u for u in addresses(page_html) if param_count(u) > MAX_PARAMS))
    if many:
        out.append(f"{path}: {len(many)} addresses with more than {MAX_PARAMS} query parameters; the first has "
                   f"{param_count(many[0])} query parameters: {many[0][:160]}")
    return out


def audit_page(path: str, page_html: str | None, heaviest: bool = False) -> list[str]:
    if page_html is None:
        return [f"{path}: didn't answer{' (a page in HEAVIEST: its slug may have changed)' if heaviest else ''}"]
    return audit_html(path, page_html)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://permtracker.app")
    ap.add_argument("--pages", nargs="*", default=None, help="these paths only, in place of the sitemap's sample")
    ap.add_argument("--also", nargs="*", default=None, help="these paths as well as the sitemap's sample (a push's changed pages)")
    ap.add_argument("--files", nargs="*", default=None, help="HTML files saved to disk, in place of fetching")
    args = ap.parse_args()

    if args.files:
        findings = [f for name in args.files for f in audit_html(name, Path(name).read_text(encoding="utf-8"))]
        targets = len(args.files)
    else:
        base = args.base.rstrip("/")
        walk = [] if args.pages is not None else page_paths(base)
        sample = args.pages if args.pages is not None else list(dict.fromkeys([*walk, *(args.also or [])]))
        # A walk that gave nothing is a broken walk, whatever --also added.
        if not sample or (args.pages is None and not walk):
            print("FATAL: no pages to read; the sitemap gave nothing", file=sys.stderr)
            return 2
        paths = list(dict.fromkeys([*sample, *([] if args.pages is not None else HEAVIEST)]))
        print(f"pages: {len(paths)} ({len(sample)} from the sample, the rest the heaviest of their families)")
        with ThreadPoolExecutor(max_workers=6) as pool:
            pages = list(pool.map(lambda p: (p, fetch(base + p)), paths))
        findings = [f for p, h in pages for f in audit_page(p, h, heaviest=p in HEAVIEST)]
        targets = len(paths)

    for f in findings:
        print(f"  {f}")
    print(f"{targets} pages read, {len(findings)} findings")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())

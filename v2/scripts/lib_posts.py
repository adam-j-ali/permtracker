"""A US embassy or consulate written any way ("Mumbai", "U.S. Consulate Ciudad Juarez, Mexico", "Ciudad Juárez"), as
the key the site's consulate pages use (`postSlug` in convex/lib/consularReport.ts), or None when it can't be told.

The known keys are the posts in src/lib/consular/postCountries.ts, the site's one list. A name that isn't one of them
gives None, never a near guess.
"""
from __future__ import annotations

import functools
import os
import re
import unicodedata

POSTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "consular", "postCountries.ts")
# Words that say "an embassy" or where it is, never which one.
NOISE = re.compile(r"\b(u s|us|united states|american|embassy|consulate|general|in|the|of|at|post)\b")
ALIASES = {"juarez": "ciudad-juarez", "cuidad juarez": "ciudad-juarez", "cdj": "ciudad-juarez",
           "ho chi minh": "ho-chi-minh-city", "hcmc": "ho-chi-minh-city", "saigon": "ho-chi-minh-city",
           "bombay": "mumbai", "madras": "chennai", "calcutta": "kolkata", "sao paulo": "sao-paulo",
           "rio": "rio-de-janeiro", "santo domingo": "santo-domingo"}


def post_slug(name: str) -> str:
    """The same slug convex/lib/consularReport.ts's postSlug makes."""
    t = unicodedata.normalize("NFKD", name or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"\s*\(.*?\)", "", t).lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


@functools.lru_cache(maxsize=1)
def known_posts() -> frozenset[str]:
    with open(POSTS_FILE, encoding="utf-8") as fh:
        text = fh.read()
    return frozenset(m.group(1) for m in re.finditer(r'^\s*"?([a-z][a-z-]+)"?:\s*"', text, re.M))


@functools.lru_cache(maxsize=1)
def known_countries() -> dict[str, str]:
    """Each country a US immigrant visa post sits in, by every name the list gives it (lower case), as its first name.
    A second name never takes a country's own name: "Hong Kong, China" leaves China as China."""
    with open(POSTS_FILE, encoding="utf-8") as fh:
        values = re.findall(r'^\s*"?[a-z][a-z-]+"?:\s*"([^"]+)"', fh.read(), re.M)
    names = [[n.strip() for n in v.split(",") if n.strip()] for v in values]
    out = {n[0].lower(): n[0] for n in names if n}
    for n in names:
        for other in n[1:]:
            out.setdefault(other.lower(), n[0])
    return out


def post_key(text: str | None) -> str | None:
    """The site's key for a post as a person wrote it, or None."""
    if not text or not text.strip():
        return None
    posts = known_posts()
    candidates = [text, *re.split(r"[,/;]| - ", text)]
    for c in candidates:
        words = post_slug(c).replace("-", " ")
        for form in (words, NOISE.sub(" ", words)):
            form = re.sub(r"\s+", " ", form).strip()
            if not form:
                continue
            if form in ALIASES and ALIASES[form] in posts:
                return ALIASES[form]
            slug = form.replace(" ", "-")
            if slug in posts:
                return slug
    return None

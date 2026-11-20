"""A USCIS office written any way people write it ("San Bernardino FO", "LA County", "SFV", "NBC", "Fairfax"), as the
site's office code (src/lib/uscisOffices.json, the one list of offices and centers), or None when it can't be told.

Community sheets name offices in free text: one sheet held 161 spellings. A name that can't be pinned to one office
gives None, never a guess: "Portland" alone (Maine or Oregon) and "Charleston" alone (South Carolina or West
Virginia) need their state.
"""
from __future__ import annotations

import functools
import json
import os
import re

OFFICES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "uscisOffices.json")

STATES = {
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california", "co": "colorado",
    "ct": "connecticut", "de": "delaware", "dc": "district of columbia", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "id": "idaho", "il": "illinois", "in": "indiana", "ia": "iowa", "ks": "kansas", "ky": "kentucky",
    "la": "louisiana", "me": "maine", "md": "maryland", "ma": "massachusetts", "mi": "michigan", "mn": "minnesota",
    "mo": "missouri", "mt": "montana", "ne": "nebraska", "nv": "nevada", "nh": "new hampshire", "nj": "new jersey",
    "nm": "new mexico", "ny": "new york", "nc": "north carolina", "oh": "ohio", "ok": "oklahoma", "or": "oregon",
    "pa": "pennsylvania", "ri": "rhode island", "sc": "south carolina", "tn": "tennessee", "tx": "texas", "ut": "utah",
    "vt": "vermont", "va": "virginia", "wa": "washington", "wv": "west virginia", "wi": "wisconsin",
}

# What people write for an office that isn't its own name. Only spellings that can mean one office.
ALIASES = {
    "sfv": "SFV", "san fernando": "SFV", "la": "LOS", "lafo": "LOS", "la fo": "LOS", "lac": "LAC", "la county": "LAC",
    "lacfo": "LAC", "sb": "SBD", "sbd": "SBD", "sj": "SNJ", "sjc": "SNJ", "sf": "SFR", "sd": "SND", "nyc": "NYC",
    "new york city": "NYC", "manhattan": "NYC", "li": "LNY", "nj central": "NJC", "njc": "NJC",
    "central new jersey": "NJC", "mt laurel": "MTL", "st paul": "SPM", "saint paul": "SPM", "st louis": "STL",
    "saint louis": "STL", "st albans": "STA", "dc": "WAS", "washington dc": "WAS", "fairfax": "WAS", "dmv": "WAS",
    "slc": "SLC", "philly": "PHI", "okc": "OKC", "kc": "KAN", "abq": "ABQ", "atl": "ATL", "sat": "SNA",
    "nbc": "NBC", "national benefit center": "NBC", "national benefits": "NBC", "tsc": "SSC", "texas service center": "SSC",
    "nsc": "NSC", "nebraska service center": "NSC", "csc": "WSC", "california service center": "WSC", "vsc": "ESC",
    "vermont service center": "ESC", "psc": "YSC", "potomac": "YSC", "potomac service center": "YSC",
    "oakland park": "OKL", "ft myers": "OFM", "fort meyers": "OFM", "west palm": "WPB", "wpb": "WPB", "honolulu": "HHW",
    "guam": "AGA", "puerto rico": "SAJ", "las vegas": "LVG", "vegas": "LVG", "minneapolis": "SPM",
    "minneapolis st paul": "SPM", "minneapolis saint paul": "SPM", "twin cities": "SPM", "ny": "NYC", "ny fo": "NYC",
    "nj central fo": "NJC",
}
# "NBC --> Columbus on 4/28", "NBC ==> LA (3/18) ==> Tampa (4/20)", "Moved to Newark, NJ": the office it's at now is
# the last one named.
JOURNEY = re.compile(r"-+>|=+>|→|>+|\bthen\b|\bnow\b", re.I)
# Words that say "office" or "where", never which office.
NOISE = re.compile(r"\b(uscis|field|office|fo|local|non|nonlocal|non-local|district|the|in|at|transferred|transfer|"
                   r"transfered|to|moved|on|per|emma|initially|confirmed|with)\b")


def _norm(text: str) -> str:
    t = (text or "").lower().replace("&", " and ")
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^a-z ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


@functools.lru_cache(maxsize=1)
def _offices() -> tuple[dict[str, list[tuple[str, str]]], set[str]]:
    with open(OFFICES_FILE) as fh:
        rows = json.load(fh)
    by_name: dict[str, list[tuple[str, str]]] = {}
    for o in rows:
        by_name.setdefault(_norm(o["name"]), []).append((o["code"], _norm(o["state"])))
    return by_name, {o["code"] for o in rows}


def office_code(text: str | None) -> str | None:
    """The office code for how a person wrote an office, or None. A journey ("NBC -> San Jose") gives where it ended."""
    legs = [leg for leg in JOURNEY.split(text or "") if leg.strip()]
    if len(legs) > 1:
        for leg in reversed(legs):
            code = _one_office(leg)
            if code:
                return code
        return None
    return _one_office(text)


def _one_office(text: str | None) -> str | None:
    raw = _norm(re.sub(r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b", " ", text or ""))
    if not raw:
        return None
    by_name, codes = _offices()
    if raw.upper() in codes and len(raw) == 3:
        return raw.upper()
    for candidate in (raw, NOISE.sub(" ", raw)):
        n = re.sub(r"\s+", " ", candidate).strip()
        if not n:
            continue
        if n in ALIASES:
            return ALIASES[n]
        if n in by_name and len(by_name[n]) == 1:
            return by_name[n][0][0]
        # "portland oregon", "charleston sc", "san jose california": a name, then its state.
        for name, places in by_name.items():
            if n.startswith(name + " "):
                rest = n[len(name):].strip()
                state = STATES.get(rest, rest)
                hits = [code for code, st in places if st == state]
                if len(hits) == 1:
                    return hits[0]
                if len(places) == 1 and rest in STATES.values() | STATES.keys():
                    return places[0][0]
    return None

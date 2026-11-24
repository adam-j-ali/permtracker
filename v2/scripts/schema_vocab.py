#!/usr/bin/env python3
"""The schema.org properties each type we emit may carry, read from schema.org's own type pages.

Writes scripts/data/schema_org_properties.json, the one list the structured-data gates read: the vitest gate
(src/lib/__tests__/structured-data-gate.test.ts) and the rendered check (scripts/audit_page_markup.py). Each
type's entry is the property table on https://schema.org/<Type>: its own properties and every supertype's, the
"Properties from X" rows. The table of properties that take the type as a value ("Instances of X may appear as a
value for...") is a different table and isn't read.

    python3 scripts/schema_vocab.py                # re-read every type already in the file
    python3 scripts/schema_vocab.py --add Review    # read one more type and add it
    python3 scripts/schema_vocab.py --from-dir d    # the same, from pages saved as d/<Type>.html

A type we start emitting needs its line here first: the gates fail a node whose type isn't in the file.
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
import urllib.request
from pathlib import Path
from lib_days import today_et  # noqa: E402 - the scripts folder is on the path

OUT = Path(__file__).resolve().parent / "data" / "schema_org_properties.json"
TYPE_PAGE = "https://schema.org/{}"


def parse_type_page(page: str) -> dict:
    """The properties in a type page's own property table, and the types they come from."""
    tables = re.findall(r'<table class="definition-table">(.*?)</table>', page, re.S)
    own = next((t for t in tables if re.search(r"<th>\s*Expected Type\s*</th>", t)), None)
    if own is None:
        return {"properties": [], "from": []}
    props = re.findall(r'<th class="prop-nam"[^>]*>\s*<code>.*?title="([A-Za-z0-9]+)"', own, re.S)
    supers = re.findall(r'<th class="supertype-name"[^>]*>\s*Properties from.*?title="([A-Za-z0-9]+)"', own, re.S)
    return {"properties": sorted(set(props)), "from": list(dict.fromkeys(supers))}


def fetch(type_name: str) -> str:
    req = urllib.request.Request(
        TYPE_PAGE.format(type_name),
        headers={"User-Agent": "permtracker-schema-vocab/1.0", "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (a fixed https host)
        return resp.read().decode("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", nargs="*", default=[], help="types to read and add")
    ap.add_argument("--from-dir", default=None, help="read <Type>.html files saved from schema.org instead of fetching")
    args = ap.parse_args()
    doc = json.loads(OUT.read_text()) if OUT.exists() else {"types": {}}
    names = sorted(set(doc["types"]) | set(args.add))
    if not names:
        print("no types to read: pass --add <Type>", file=sys.stderr)
        return 2
    for name in names:
        page = (Path(args.from_dir) / f"{name}.html").read_text(encoding="utf-8") if args.from_dir else fetch(name)
        parsed = parse_type_page(html_mod.unescape(page))
        if not parsed["properties"]:
            print(f"{name}: no property table on {TYPE_PAGE.format(name)}", file=sys.stderr)
            return 1
        doc["types"][name] = {"source": TYPE_PAGE.format(name), **parsed}
        print(f"{name}: {len(parsed['properties'])} properties, from {', '.join(parsed['from'])}")
    doc = {
        "about": "The properties schema.org allows on each type this site emits, read from each type's own page "
        "(its property table, the supertypes' rows included). Written by scripts/schema_vocab.py.",
        "read": today_et().isoformat(),
        "types": dict(sorted(doc["types"].items())),
    }
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {OUT} ({len(doc['types'])} types)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

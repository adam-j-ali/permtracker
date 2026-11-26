#!/usr/bin/env python3
"""The pages that print the USCIS sample, as purge_edge.py reads them ({"paths": [...]}), from a load's
sample-figures.json: the blocks list, and each block's page and its numbers page. permtracker-uscis runs it after a
sample load, so Cloudflare drops its copies at once instead of serving the last load's figures for up to 10 minutes.

    python3 scripts/sample_pages.py <sample-figures.json>
"""
from __future__ import annotations

import json
import re
import sys

BLOCK = re.compile(r"^[A-Z]{3}\d{5}$")


def sample_pages(figures: dict) -> list[str]:
    blocks = sorted(b for b in (figures.get("by_block") or {}) if BLOCK.match(str(b)))
    return ["/uscis-receipt-blocks"] + [p for b in blocks for p in (f"/uscis-receipt-blocks/{b}", f"/uscis-receipt-blocks/{b}/numbers")]


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: sample_pages.py <sample-figures.json>")
        return 2
    with open(argv[0]) as f:
        print(json.dumps({"paths": sample_pages(json.load(f))}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

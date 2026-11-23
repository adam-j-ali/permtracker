#!/usr/bin/env python3
"""No tracked file names the private machinery: the community-source readers, the USCIS kit and the private repos.

The repository is public; how those readers work lives on the owner's machine and the server's private git. The terms
that would give them away are a private list too (one per line, `#` for a note), so this audit reads them from
~/.config/permtracker/private-terms.txt, or the file PRIVATE_TERMS names. Where no list exists (GitHub's runners) it
says so and passes: `pnpm check` runs it on the owner's machine before every push. A term that starts or ends with a
letter or digit matches as a whole word on that side; case counts.

    python3 scripts/audit_private_terms.py
    python3 scripts/audit_private_terms.py --self-test    # a planted term must be caught
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

LIST = Path(os.environ.get("PRIVATE_TERMS") or Path.home() / ".config" / "permtracker" / "private-terms.txt")
TEXT = re.compile(r"\.(ts|tsx|mts|mjs|js|py|sh|mdx|md|json|txt|yml|yaml|html|css|conf|toml|env\.example)$|(^|/)[^./]+$")
MAX_BYTES = 2_000_000


def read_terms(path: Path) -> list[str] | None:
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return None
    return [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]


def pattern(terms: list[str]) -> re.Pattern:
    parts = []
    for t in terms:
        left = r"(?<![A-Za-z0-9_])" if re.match(r"\w", t) else ""
        right = r"(?![A-Za-z0-9_])" if re.search(r"\w$", t) else ""
        parts.append(left + re.escape(t) + right)
    return re.compile("|".join(parts))


def tracked(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [f for f in out.split("\0") if f and TEXT.search(f)]


def findings(root: Path, files: list[str], pat: re.Pattern) -> list[str]:
    found = []
    for f in files:
        p = root / f
        try:
            if p.stat().st_size > MAX_BYTES:
                continue
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for m in pat.finditer(line):
                found.append(f"{f}:{n}: {m[0]!r}")
    return found


def self_test(terms: list[str]) -> int:
    """Plant the first term in a scratch repository's file and expect exactly that finding."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        (root / "a.py").write_text(f"# reads with {terms[0]} here\nx = 1\n")
        (root / "b.py").write_text("# nothing to see\n")
        subprocess.run(["git", "add", "."], cwd=root, check=True)
        got = findings(root, tracked(root), pattern(terms))
    ok = len(got) == 1 and got[0].startswith("a.py:1:")
    print(("ok   " if ok else "FAIL ") + f"a planted term is caught ({len(got)} finding)")
    return 0 if ok else 1


def main() -> int:
    terms = read_terms(LIST)
    if not terms:
        print(f"skipped: no private term list at {LIST} on this machine (GitHub can't hold it; pnpm check runs it here)")
        return 0
    if "--self-test" in sys.argv:
        return self_test(terms)
    root = Path(__file__).resolve().parent.parent.parent
    found = findings(root, tracked(root), pattern(terms))
    for f in found:
        print(f"FAIL {f}")
    print(f"{len(tracked(root))} tracked files read, {len(terms)} private terms, {len(found)} found")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())

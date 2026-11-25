"""Every table in the two libSQL databases has a retention rule. Run: python3 scripts/test_table_retention.py

scripts/data/table_retention.json names each table's kind (record, mirror, derived, pruned, retired), the rule in
plain words and the file that keeps it. Read from the live sqlite_master on Nov 25 2026 (125 tables), and held here
against the code: a table the code creates with no entry fails, an entry whose file is gone fails, and a "pruned"
entry whose file never deletes from it fails. Plan item A23: nothing grows forever unless it's meant to.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

V2 = Path(__file__).resolve().parent.parent
REGISTRY = V2 / "scripts" / "data" / "table_retention.json"
KINDS = {"record", "mirror", "derived", "pruned", "retired"}
# Working copies a load builds and renames into place, and tables only a test makes.
TRANSIENT = re.compile(r"(_new|_old|_tmp|_stage|_staging|_swap|_build|_next)$|^(tmp|temp|scratch|test)_")
SOURCES = ("scripts", "src", "convex")
# Tables in a scratch SQLite file a load makes on its own disk, never in either database.
LOCAL_SCRATCH = {
    "counts": "ingest_perm_history.py's facet counts, in a file under /var/tmp for one load",
    "votes": "ingest_perm_history.py's spelling votes, in the same file",
}


def source_files() -> dict[Path, str]:
    out = {}
    for d in SOURCES:
        for p in (V2 / d).rglob("*"):
            if p.suffix not in {".py", ".ts", ".mts", ".mjs", ".sh"} or "node_modules" in p.parts or "_generated" in p.parts:
                continue
            if p.name.startswith("test_") or ".test." in p.name or "__tests__" in p.parts:
                continue
            out[p] = p.read_text(errors="replace")
    return out


def created_tables(files: dict[Path, str]) -> dict[str, list[str]]:
    """Table name to the files that create it: literal names, and `{CONST}` where the same file sets CONST = "name"."""
    found: dict[str, list[str]] = {}
    for p, s in files.items():
        consts = dict(re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*(?::\s*\w+\s*)?=\s*[\"']([a-z][a-z0-9_]*)[\"']", s, re.M))
        # A statement, never prose: the name is followed by its column list or AS.
        for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?[\"`]?(\{[A-Z][A-Z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)[\"`]?\s*(?:\(|AS\b)", s):
            name = m.group(1)
            if name.startswith("{"):
                name = consts.get(name.strip("{}"), "")
            if name and not TRANSIENT.search(name):
                found.setdefault(name.lower(), []).append(str(p.relative_to(V2)))
    return found


def deletes_from(text: str, table: str) -> bool:
    names = {table} | {c for c, v in re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*[\"']([a-z0-9_]+)[\"']", text, re.M) if v == table}
    return any(re.search(rf"DELETE FROM\s+[\"`]?(\{{{re.escape(n)}\}}|{re.escape(n)})(?![\w])", text) for n in names) or \
        bool(re.search(r"DELETE FROM \{table\}", text) and re.search(rf"[\"']{re.escape(table)}[\"']", text))


def main() -> int:
    fails: list[str] = []
    reg = json.loads(REGISTRY.read_text())["tables"]
    by_name = {k.split(":", 1)[1]: v for k, v in reg.items()}
    files = source_files()
    created = created_tables(files)
    if len(created) < 60:
        print(f"FAIL: only {len(created)} tables found in the code; the pattern is wrong, so this can't judge")
        return 2
    for name, where in sorted(created.items()):
        if name not in by_name and name not in LOCAL_SCRATCH:
            fails.append(f"{name} (created in {where[0]}) has no retention rule in scripts/data/table_retention.json")
    for key, e in reg.items():
        table = key.split(":", 1)[1]
        if e.get("kind") not in KINDS:
            fails.append(f"{key}: kind {e.get('kind')!r} isn't one of {sorted(KINDS)}")
        if not str(e.get("rule", "")).strip():
            fails.append(f"{key}: no rule written")
        by = e.get("by") or ""
        if e.get("kind") == "retired":
            continue
        if not by or not (V2 / by).exists():
            fails.append(f"{key}: its file {by!r} doesn't exist")
            continue
        if e["kind"] == "pruned" and not deletes_from((V2 / by).read_text(errors="replace"), table):
            fails.append(f"{key}: marked pruned, but {by} never deletes from it")
    for f in fails:
        print("FAIL", f)
    print(f"{len(reg)} tables registered, {len(created)} created in the code, {len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

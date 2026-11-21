"""schema_vocab.parse_type_page reads a type's own property table and nothing else.

A schema.org type page carries two tables of properties: the type's own (with every supertype's rows), and the
properties whose values may be the type ("Instances of X may appear as a value for..."). Reading the second as the
first would allow `acquiredFrom` on an Organization, which is the error the gate exists to catch.

    python3 scripts/test_schema_vocab.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_vocab as sv  # noqa: E402

ROW = """
        <tr><th class="prop-nam"><code>
    <a href="/{p}" class="core" title="{p}">{p}</a></code></th>
            <td class="prop-ect"><a href="/Text" class="core" title="Text">Text</a></td>
            <td class="prop-desc">About {p}.</td></tr>"""
SUPER = """
        <tr class="supertype"><th class="supertype-name" colspan="3">Properties from
    <a href="/{t}" class="core" title="{t}">{t}</a></th></tr>"""
PAGE = (
    '<div class="description">An organization.</div>'
    '<table class="definition-table"><thead><tr><th>Property</th><th>Expected Type</th><th>Description</th></tr></thead>'
    + SUPER.format(t="Organization")
    + ROW.format(p="logo")
    + ROW.format(p="publishingPrinciples")
    + SUPER.format(t="Thing")
    + ROW.format(p="name")
    + ROW.format(p="url")
    + "</table>"
    '<br/><div id="incoming">Instances of <a href="/Organization" title="Organization">Organization</a> may appear as a '
    "value for the following properties</div>"
    '<table class="definition-table"><thead><tr><th>Property</th><th>On Types</th><th>Description</th></tr></thead>'
    '<tr><th class="prop-nam"><a href="/acquiredFrom" class="core" title="acquiredFrom">acquiredFrom</a></th></tr>'
    "</table>"
)


def test_reads_the_own_table_with_its_supertypes() -> None:
    got = sv.parse_type_page(PAGE)
    assert got["properties"] == ["logo", "name", "publishingPrinciples", "url"], got
    assert got["from"] == ["Organization", "Thing"], got


def test_never_reads_the_incoming_table() -> None:
    assert "acquiredFrom" not in sv.parse_type_page(PAGE)["properties"]


def test_a_page_without_the_table_reads_as_nothing() -> None:
    assert sv.parse_type_page("<html>not a type page</html>") == {"properties": [], "from": []}


def test_the_file_the_gates_read_is_whole() -> None:
    """Every entry names its schema.org page and holds Thing's properties, which every type inherits."""
    doc = json.loads(sv.OUT.read_text())
    assert doc["types"], "no types in the vocabulary file"
    for name, entry in doc["types"].items():
        assert entry["source"] == f"https://schema.org/{name}", name
        for p in ("name", "url", "description", "sameAs"):
            assert p in entry["properties"], f"{name} lacks {p}: a partial read"


def main() -> int:
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except Exception as e:  # a crash is a failure too
                failed += 1
                print(f"FAIL {name}: {e}")
    print(f"{'ok' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

"""audit_page_markup: a page's JSON-LD, its weight and the query parameters on the addresses in its HTML.

    python3 scripts/test_audit_page_markup.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_page_markup as apm  # noqa: E402

CASES = json.loads((Path(__file__).resolve().parent / "fixtures" / "jsonld_cases.json").read_text())["cases"]


def test_the_shared_jsonld_cases() -> None:
    """The same cases the vitest gate runs on src/lib/seo/jsonLdCheck.ts, so the two can't drift."""
    assert len(CASES) > 10
    for case in CASES:
        got = apm.check_jsonld(case["blocks"])
        if not case["expect"]:
            assert got == [], f"{case['name']}: {got}"
        for piece in case["expect"]:
            assert any(piece in p for p in got), f"{case['name']}: no {piece!r} in {got}"


def page(*scripts: str, body: str = "") -> str:
    tags = "".join(f'<script type="application/ld+json">{s}</script>' for s in scripts)
    return f"<!doctype html><html><head>{tags}</head><body>{body}</body></html>"


ORG = json.dumps({"@context": "https://schema.org", "@graph": [CASES[0]["blocks"][0]["@graph"][0]]})


def test_reads_every_jsonld_block_and_its_escapes() -> None:
    # JsonLdScript writes "<" as <, which JSON reads back as "<".
    faq = '{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Is 1 \\u003c 2?","acceptedAnswer":{"@type":"Answer","text":"Yes."}}]}'
    blocks = apm.jsonld_blocks(page(ORG, faq))
    assert len(blocks) == 2
    assert blocks[1]["mainEntity"][0]["name"] == "Is 1 < 2?"
    assert apm.audit_html("/x", page(ORG, faq)) == []


def test_a_block_that_isnt_json_is_a_finding() -> None:
    got = apm.audit_html("/x", page(ORG, "{not json"))
    assert any("isn't JSON" in f for f in got), got


def test_the_site_graph_and_a_page_node_with_one_id_is_a_finding() -> None:
    dup = json.dumps({"@type": "Organization", "@id": "https://permtracker.app/#organization", "name": "B", "url": "https://permtracker.app", "logo": "x"})
    got = apm.audit_html("/x", page(ORG, dup))
    assert any("two full nodes share the @id" in f for f in got), got


def test_an_image_address_with_four_parameters_is_a_finding() -> None:
    img = (
        '<img src="/_next/image?url=%2Fa.webp&amp;w=3840&amp;q=75&amp;dpl=abc" '
        'srcset="/_next/image?url=%2Fa.webp&amp;w=256&amp;q=75&amp;dpl=abc 256w, /_next/image?url=%2Fa.webp&amp;w=384&amp;q=75&amp;dpl=abc 384w">'
    )
    got = apm.audit_html("/guides", page(ORG, body=img))
    assert any("4 query parameters" in f and "/_next/image" in f for f in got), got


def test_three_parameters_and_fewer_pass() -> None:
    ok = (
        '<img src="/_next/image?url=%2Fa.webp&amp;w=3840&amp;q=75" srcset="/_next/image?url=%2Fa.webp&amp;w=256&amp;q=75 256w">'
        '<a href="/case-search?stage=rfi&amp;from=2025-01&amp;to=2025-01">x</a><link rel="stylesheet" href="/a.css?dpl=1">'
    )
    assert apm.audit_html("/x", page(ORG, body=ok)) == []


def test_a_link_with_four_parameters_is_a_finding_and_named_once() -> None:
    body = '<a href="/x?a=1&amp;b=2&amp;c=3&amp;d=4">one</a><a href="/x?a=1&amp;b=2&amp;c=3&amp;d=4">again</a>'
    got = apm.audit_html("/x", page(ORG, body=body))
    assert len([f for f in got if "query parameters" in f]) == 1, got


def test_a_page_over_the_budget_is_a_finding() -> None:
    heavy = page(ORG, body="x" * (apm.PAGE_BUDGET + 1))
    assert any("over the" in f and "budget" in f for f in apm.audit_html("/heavy", heavy))
    light = page(ORG, body="x" * (apm.PAGE_BUDGET - 10_000))
    assert apm.audit_html("/light", light) == []


def test_the_heaviest_pages_are_real_paths_with_a_reason() -> None:
    assert len(apm.HEAVIEST) >= 10
    for path, why in apm.HEAVIEST.items():
        assert path.startswith("/") and "?" not in path and why, path
    assert "/i485-by-field-office/national-benefits-center" in apm.HEAVIEST


def test_a_heaviest_page_that_doesnt_answer_is_a_finding() -> None:
    got = apm.audit_page("/gone", None, heaviest=True)
    assert got and "didn't answer" in got[0], got


def main() -> int:
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except Exception as e:  # a crash is a failure too
                failed += 1
                print(f"FAIL {name}: {e!r}")
    print("ok" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

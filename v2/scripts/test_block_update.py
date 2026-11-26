"""The counts a USCIS sample load sends Convex for block follows: blocks and forms only, every number by the site's rule."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import block_update as bu  # noqa: E402


def g(**counts):
    return {k: {"count": v} for k, v in counts.items()}


FIGURES = {
    "as_of": "2026-11-26",
    "by_block": {
        "IOE09366": {"_checked": 100000, "_walked_share": 0.0, "_draws": 100000,
                     "I-765": {"counted": 100, "groups": g(approved=45, denied=5, revoked=1, rfe=2, waiting=40, closed=7)},
                     "bad form": {"counted": 1}},
        "IOE09373": {"_checked": 60000, "I-485": {"counted": 10, "groups": g(approved=1, waiting=9)}},
        "IOE09999": {"_checked": 5},
        "LIN09366": {"I-765": {"counted": 1}},
    },
}


def test_each_block_with_forms_and_its_counts():
    body = bu.block_body(FIGURES)
    assert body["asOf"] == "2026-11-26"
    assert [b["block"] for b in body["blocks"]] == ["IOE09366", "IOE09373"]
    first = body["blocks"][0]
    assert first["every"] is True and first["checked"] == 100000
    assert first["byForm"] == {"I-765": {"total": 100, "approved": 45, "denied": 6, "rfe": 2, "waiting": 40}}


def test_every_number_only_by_the_site_rule():
    body = bu.block_body(FIGURES)
    assert body["blocks"][1]["every"] is False
    walked = bu.block_body({"as_of": "2026-11-26", "by_block": {"IOE09358": {"_walked_share": 0.9996, "I-765": {"counted": 1, "groups": {}}}}})
    assert walked["blocks"][0]["every"] is True


def test_dry_run_sends_nothing(tmp=None):
    import json
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(FIGURES, f)
    called = []
    bu.send = lambda body: called.append(body) or {"ok": True}
    assert bu.main([f.name, "--dry"]) == 0 and called == []
    assert bu.main([f.name]) == 0 and len(called) == 1


if __name__ == "__main__":
    test_each_block_with_forms_and_its_counts()
    test_every_number_only_by_the_site_rule()
    test_dry_run_sends_nothing()
    print("ok")

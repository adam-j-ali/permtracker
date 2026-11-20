#!/usr/bin/env python3
"""The edge purge after a sweep: which tags it sends, and that a refusal is never quiet.

    python3 scripts/test_purge_edge.py

No network: every purge goes to a stand-in.
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import re
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("purge_edge", HERE / "purge_edge.py")
pe = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(pe)

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'' if cond else f': {detail}'}")
    if not cond:
        failures.append(label)


class Cloudflare:
    """Records each purge body; answers `results` in turn, then success."""

    def __init__(self, results: list[object] | None = None):
        self.bodies: list[dict] = []
        self.headers: list[dict] = []
        self.results = list(results or [])

    def __call__(self, req) -> dict:
        self.bodies.append(json.loads(req.data))
        self.headers.append(dict(req.header_items()))
        r = self.results.pop(0) if self.results else {"success": True}
        if isinstance(r, Exception):
            raise r
        return r


def run(answer: str, env_text: str | None, cf: Cloudflare) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        a = pathlib.Path(tmp) / "answer.json"
        a.write_text(answer)
        e = pathlib.Path(tmp) / "purge.env"
        if env_text is not None:
            e.write_text(env_text)
        old = os.environ.get("PT_PURGE_ENV")
        os.environ["PT_PURGE_ENV"] = str(e)
        pe.time.sleep = lambda _s: None
        import io
        import contextlib
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                code = pe.main([str(a)], post=cf)
        finally:
            if old is None:
                os.environ.pop("PT_PURGE_ENV", None)
            else:
                os.environ["PT_PURGE_ENV"] = old
        return code, buf.getvalue()


def main() -> int:
    env = 'CF_PURGE_TOKEN="tok-test"\nCF_ZONE_ID=zone-test\n'
    answer = json.dumps({"revalidated": 3, "paths": ["/", "/today", "/perm-updates"], "board": "saved"})

    cf = Cloudflare()
    code, out = run(answer, env, cf)
    check("the expired pages are purged by their tags, in one request",
          code == 0 and cf.bodies == [{"tags": ["pg:/", "pg:/perm-updates", "pg:/today"]}], f"{code} {cf.bodies}")
    check("the token goes in the header and never in what it prints",
          cf.headers and cf.headers[0].get("Authorization") == "Bearer tok-test" and "tok-test" not in out, out)

    cf = Cloudflare()
    many = json.dumps({"paths": [f"/p{i}" for i in range(150)]})
    code, _ = run(many, env, cf)
    check("more than 100 pages go in requests of 100", code == 0 and [len(b["tags"]) for b in cf.bodies] == [100, 50],
          str([len(b["tags"]) for b in cf.bodies]))

    cf = Cloudflare([{"success": False}])
    code, _ = run(answer, env, cf)
    check("a refusal is tried once more before it counts", code == 0 and len(cf.bodies) == 2, f"{code} {len(cf.bodies)}")

    cf = Cloudflare([{"success": False}, OSError("down")])
    code, out = run(answer, env, cf)
    check("a purge refused twice ends red and says so", code == 1 and "1 refused" in out, f"{code} {out}")

    cf = Cloudflare()
    code, out = run(answer, None, cf)
    check("no token file: nothing sent, the run carries on and says why", code == 0 and not cf.bodies and "no Cloudflare" in out,
          f"{code} {out}")

    cf = Cloudflare()
    code, out = run("", env, cf)
    check("an unreadable answer purges nothing", code == 0 and not cf.bodies, f"{code} {cf.bodies}")

    check("an address outside the tag's characters gets no tag (a tag must be printable ASCII)",
          pe.page_tag("/perm-employers/café") is None and pe.page_tag("/a b") is None and pe.page_tag("") is None)
    check("the home page's tag is its own", pe.page_tag("/") == "pg:/")

    # nginx tags the stored copies; the two must agree on which addresses get a tag, or a purge misses pages.
    conf = (HERE / "oracle" / "nginx" / "permtracker.conf").read_text()
    classes = set(re.findall(r"\(\?<pt_tag_\w+>(/\[[^\]]+\]\*)\)", conf))
    check("nginx's page tag takes exactly the characters this purge does",
          classes == {pe.TAG_PATH.pattern[1:-1]}, f"nginx {classes} vs {pe.TAG_PATH.pattern}")

    print(f"\n{'FAILED' if failures else 'passed'}: {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""audit_internal_links.py tells a dead page from the site refusing the crawl.

A 404 is a dead link; a 429 or 503 is the front door's rate limit, reported as refused,
and both fail the run. Checked against a small site served on this machine.

    python3 scripts/test_audit_internal_links.py
"""
from __future__ import annotations

import contextlib
import http.server
import io
import pathlib
import sys
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import audit_internal_links as ail  # noqa: E402

FAILS: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        FAILS.append(msg)


LINKS = "".join(f'<a href="/p{i}">Page {i}</a>' for i in range(25))


def site(missing: str | None, busy: str | None) -> http.server.ThreadingHTTPServer:
    """Three source pages linking 25 good pages, plus one missing and one busy page."""
    extra = "".join(f'<a href="{p}">Other page</a>' for p in (missing, busy) if p)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args) -> None:
            pass

        def do_GET(self) -> None:
            port = self.server.server_address[1]
            if self.path == "/sitemaps/pages.xml":
                body = "<urlset>" + "".join(f"<loc>http://127.0.0.1:{port}/s{i}</loc>" for i in range(3)) + "</urlset>"
            elif self.path.startswith("/s"):
                body = f"<html><title>Source</title><h1>Source</h1>{LINKS}{extra}</html>"
            elif self.path == missing:
                self.send_response(404)
                self.end_headers()
                return
            elif self.path == busy:
                self.send_response(429)
                self.end_headers()
                return
            else:
                body = f"<html><title>Page</title><h1>Page {self.path[2:]}</h1></html>"
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body.encode())

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def run(missing: str | None = None, busy: str | None = None) -> tuple[int, str]:
    srv = site(missing, busy)
    ail.REFUSED.clear()
    sys.argv = ["audit_internal_links.py", "--base", f"http://127.0.0.1:{srv.server_address[1]}"]
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            code = ail.main()
    finally:
        srv.shutdown()
    return code, out.getvalue()


code, text = run()
check(code == 0 and "control: crawled 3 pages" in text, "every link answering 200 passes")

code, text = run(missing="/gone")
check(code == 1 and "DEAD  /gone" in text, "a 404 is a dead link and fails")

code, text = run(busy="/busy")
check(code == 1 and "DEAD  /busy" not in text, "a 429 still fails the run, but isn't called dead")
check("REFUSED  1 pages answered [429]" in text and "429  /busy" in text,
      "the refusal is named as the rate limit, with the page")

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)

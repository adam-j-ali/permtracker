"""page_checks.run keeps a failing check's findings, not only its last lines.

Oct 26 2026: the phone sweep failed on two pages at 390px, and the morning
report showed its last 12 lines, every one a clean 320px page.
"""
import sys
from pathlib import Path

import page_checks as pc


def main() -> int:
    failures: list[str] = []
    lines = [f"390 /page-{i}  overflow=0px  small=0  taps=0" for i in range(5)]
    lines += ["390 /visa-bulletin  overflow=0px  small=0  taps=1", "    tap: input 23px \"\""]
    lines += [f"320 /page-{i}  overflow=0px  small=0  taps=0" for i in range(14)]
    script = "import sys\n" + "".join(f"print({ln!r})\n" for ln in lines) + "sys.exit(1)\n"
    phone = next(c for c in pc.checks("https://example.test") if c["key"] == "phone")
    r = pc.run({**phone, "cmd": [sys.executable, "-c", script]})
    if not any("taps=1" in ln for ln in r["tail"]) or not any("tap: input" in ln for ln in r["tail"]):
        failures.append(f"a failing phone sweep's report keeps the page with the finding (got {r['tail']})")
    if any("taps=0" in ln for ln in r["tail"]):
        failures.append("a failing phone sweep's report leaves out the clean pages")
    # Nov 1 2026: each line ends with the page's load time; a clean line with it is still clean.
    timed = [f"390 /page-{i}  overflow=0px  small=0  taps=0  (3.{i} s)" for i in range(4)] + ["390 /bad  overflow=12px  small=0  taps=0  (4.0 s)"]
    script_t = "import sys\n" + "".join(f"print({ln!r})\n" for ln in timed) + "sys.exit(1)\n"
    rt = pc.run({**phone, "cmd": [sys.executable, "-c", script_t]})
    if any("overflow=0px" in ln for ln in rt["tail"]) or not any("/bad" in ln for ln in rt["tail"]):
        failures.append(f"a clean line that carries its load time is left out of the report (got {rt['tail']})")
    # Nov 2 2026: each line also counts covered text; a clean line with covered=0 is still clean, and on that
    # morning's deploy the clean lines filled the report and hid the finding.
    covered = [f"390 /page-{i}  overflow=0px  small=0  taps=0  covered=0  (2.{i} s)" for i in range(4)] + ["390 /hid  overflow=0px  small=0  taps=0  covered=1  (2.9 s)"]
    script_c = "import sys\n" + "".join(f"print({ln!r})\n" for ln in covered) + "sys.exit(1)\n"
    rc = pc.run({**phone, "cmd": [sys.executable, "-c", script_c]})
    if any("covered=0" in ln for ln in rc["tail"]) or not any("/hid" in ln for ln in rc["tail"]):
        failures.append(f"a clean line that counts covered text is left out of the report (got {rc['tail']})")
    # Nov 23 2026: each line also counts what runs past the edge and the names split across lines; a clean line
    # with past=0 and split=0 is still clean, and a line with either is kept with its finding under it.
    full = [f"390 /page-{i}  overflow=0px  past=0  small=0  taps=0  covered=0  split=0  (2.{i} s)" for i in range(4)]
    full += ["390 /chip  overflow=0px  past=1  small=0  taps=0  covered=0  split=0  (2.9 s)", '    past: li. right=560 "Software"']
    full += ["320 /form  overflow=0px  past=0  small=0  taps=0  covered=0  split=1  (2.8 s)", "    split: 320: CW-1 in p.mt-1"]
    script_f = "import sys\n" + "".join(f"print({ln!r})\n" for ln in full) + "sys.exit(1)\n"
    rf = pc.run({**phone, "cmd": [sys.executable, "-c", script_f]})
    if any("/page-" in ln for ln in rf["tail"]) or not all(any(k in ln for ln in rf["tail"]) for k in ("/chip", "past: li", "/form", "split: 320")):
        failures.append(f"a line that counts past and split is clean at 0 and kept with its finding otherwise (got {rf['tail']})")
    # Nov 3 2026: a sweep that runs out of time says how far it got and its slowest loads.
    slow = [f"390 /page-{i}  overflow=0px  small=0  taps=0  covered=0  ({i}.5 s)" for i in range(8)]
    script_s = "import sys, time\n" + "".join(f"print({ln!r}, flush=True)\n" for ln in slow) + "time.sleep(30)\n"
    rs = pc.run({**phone, "cmd": [sys.executable, "-c", script_s], "limit": 3})
    if rs["exit"] != -1 or not any("reached 8 page loads" in ln for ln in rs["tail"]) or not any("/page-7" in ln for ln in rs["tail"]):
        failures.append(f"a sweep that ran out of time names how far it got and its slowest page (got {rs['tail']})")
    clean = pc.run({**phone, "cmd": [sys.executable, "-c", "import sys\nprint('320 / overflow=0px  small=0  taps=0')\nsys.exit(1)\n"]})
    if not clean["tail"]:
        failures.append("a failure with no finding lines still reports what it printed")
    # Oct 31 2026: a failed browser flow reached the report as "17 passed", the
    # line reporter's last line. Its findings are the failing test and its error.
    flows = next(c for c in pc.checks("https://example.test") if c["key"] == "flows")
    out = [
        "Running 18 tests using 1 worker",
        "  1) [chromium] \u203a tests/e2e/public-flows.spec.ts:18:1 \u203a the case lookup answers a real case number",
        "    Error: expect(locator).toBeVisible() failed",
        "    Locator: getByText('The record')",
        "  1 failed",
        "    [chromium] \u203a tests/e2e/public-flows.spec.ts:18:1 \u203a the case lookup answers a real case number",
        "  17 passed (2.1m)",
    ]
    script = "import sys\n" + "".join(f"print({ln!r})\n" for ln in out) + "sys.exit(1)\n"
    r = pc.run({**flows, "cmd": [sys.executable, "-c", script], "env": {}})
    found = r.get("findings") or []
    if not (found and "the case lookup answers" in found[0] and any(f.startswith("Error:") for f in found)):
        failures.append(f"a failing flow's report names the test and its error (got {found})")
    if any("passed" in f for f in found):
        failures.append("a failing flow's findings leave out the passing count")
    # Nov 23 2026: four pages over the size budget reached the report as the markup check's last lines, the page
    # count, never the pages. Its findings are the indented "/path: ..." lines.
    markup = next(c for c in pc.checks("https://example.test") if c["key"] == "markup")
    out = ["pages: 40 (36 from the sample, the rest the heaviest of their families)",
           "  /perm-employers: 1.91 MB of HTML, over the 1.5 MB budget (Googlebot reads 2 MB)",
           "  /h1b-employers/x: 1.62 MB of HTML, over the 1.5 MB budget (Googlebot reads 2 MB)",
           "40 pages read, 2 findings"]
    script = "import sys\n" + "".join(f"print({ln!r})\n" for ln in out) + "sys.exit(1)\n"
    found = pc.run({**markup, "cmd": [sys.executable, "-c", script]}).get("findings") or []
    if [f.split(":")[0] for f in found] != ["/perm-employers", "/h1b-employers/x"]:
        failures.append(f"a failing markup check's report names each page it found (got {found})")
    # Nov 24 2026: a push's changed pages replaced the sitemap walk of the headings, trust and markup checks, so a
    # push that changed pages read about 20 of them (headings in 1 s) while the night run read 504 and held the
    # release on a heading the push build never looked at. The changed pages are added to the walk, never in its place.
    with_extra = {c["key"]: c["cmd"] for c in pc.checks("https://example.test", ["/changed-page"])}
    for key in ("headings", "trust", "markup"):
        cmd = with_extra[key]
        if "--pages" in cmd or "--also" not in cmd or "/changed-page" not in cmd:
            failures.append(f"the {key} check adds a push's changed pages to its walk, never in its place (got {cmd[2:6]})")
    without = {c["key"]: c["cmd"] for c in pc.checks("https://example.test")}
    for key in ("headings", "trust", "markup"):
        if "--pages" in without[key] or "--also" in without[key]:
            failures.append(f"the {key} check walks the whole sitemap when nothing changed (got {without[key][2:6]})")
    # Each audit takes --also and keeps its walk: its own parser, read for the flag (the walk itself needs a site).
    for script in ("audit_headings.py", "audit_trust.py", "audit_page_markup.py"):
        src = Path(__file__).with_name(script).read_text()
        if '"--also"' not in src or "args.also" not in src:
            failures.append(f"{script} takes --also, the pages to read as well as its walk")
    import contextlib
    import io

    import audit_headings as ah
    page = "<html><body><main><h1>A page</h1><h2>One part</h2></main></body></html>"
    seen: list[str] = []
    ah.fetch = lambda url: (seen.append(url), page)[1]
    for walk, argv, want_exit, want_seen in (
        ([f"/w{i}" for i in range(25)], ["--also", "/changed"], 0, 26),
        ([], ["--also", *[f"/c{i}" for i in range(25)]], 2, 0),
    ):
        seen.clear()
        ah.page_paths = lambda base, w=walk: list(w)
        old_argv = sys.argv
        sys.argv = ["audit_headings.py", "--base", "https://example.test", *argv]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                code = ah.main()
        finally:
            sys.argv = old_argv
        if code != want_exit or len(seen) != want_seen:
            failures.append(f"audit_headings with a walk of {len(walk)} and {argv[:2]}: exit {code}, read {len(seen)} (want {want_exit}, {want_seen})")
    passing = pc.run({**flows, "cmd": [sys.executable, "-c", "print('  1) [chromium] x')"], "env": {}})
    if "findings" in passing:
        failures.append("a check that passed carries no findings")
    # Nov 24 2026: side by side against a local copy of the site only; the live site gets one check, one page at a time.
    local = {c["key"]: c["cmd"] for c in pc.checks("http://127.0.0.1:3000")}
    live = {c["key"]: c["cmd"] for c in pc.checks("https://permtracker.app")}
    if "--workers" not in local["axe"] or "--workers" not in local["phone"]:
        failures.append("against a local copy, axe and the phone sweep load several pages at once")
    if any("--workers" in cmd for cmd in live.values()):
        failures.append("against the live site, no check loads several pages at once")
    import threading
    import time as _time
    started, live_n, peak = [], [0], [0]
    lock = threading.Lock()

    def fake_run(c):
        with lock:
            started.append(c["key"]); live_n[0] += 1; peak[0] = max(peak[0], live_n[0])
        _time.sleep(0.05)
        with lock:
            live_n[0] -= 1
        return {"key": c["key"], "title": c["title"], "ok": True, "exit": 0, "seconds": 0, "tail": []}

    real_run, real_argv = pc.run, sys.argv
    pc.run = fake_run
    try:
        for base, jobs, want_peak in (("http://127.0.0.1:3000", 3, 3), ("https://permtracker.app", 3, 1)):
            started.clear(); peak[0] = 0
            sys.argv = ["page_checks.py", "--base", base, "--jobs", str(jobs), "--only", "glued,axe,phone,flows,headings"]
            pc.main()
            if peak[0] != want_peak:
                failures.append(f"{base} with --jobs {jobs}: {peak[0]} checks at once (want {want_peak})")
            if base.startswith("http://127") and started[:2] != ["axe", "phone"]:
                failures.append(f"the longest checks start first: {started}")
    finally:
        pc.run, sys.argv = real_run, real_argv

    for f in failures:
        print("FAIL", f)
    print("ALL PASS" if not failures else f"{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

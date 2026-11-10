#!/usr/bin/env python3
"""The sweep runner's jobs, in order, and the rebuild of the stored documents after a deploy.

Runs the real bin/permtracker-sweep under bash with stand-ins for everything it calls (python3, node, curl,
git, flock, timeout, nice, systemctl, date), each writing what it was asked to one log. What has to hold:

  1. A pass still runs its steps in the order it always did: the pass, the builders, the full pass's own
     steps, the filings by day, then the pages are expired. The builders are named once now, so a slip in
     that move would show here before it shows in a night's sweep.
  2. `case-status-docs`, which permtracker-deploy starts after a release goes live, rebuilds every stored
     document from the tables and asks DOL nothing: no pass, no walk, no gap sweep, no backtest.
  3. It gives way to a sweep that is about to run, because a sweep that finds the lock taken skips its run.
  4. Its unit's time limit stays under that give-way figure.
  5. A step that fails turns the run red and the pages are not expired on top of a half-built set.
  6. The deploy starts it only after the new release is live, in the background, and can't fail over it.

Run: python3 scripts/oracle/test_sweep_runner.py
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE / "bin" / "permtracker-sweep"
DEPLOY = HERE / "bin" / "permtracker-deploy"
LIMIT = HERE / "systemd" / "dropins" / "sweep-docs-limit.conf"
failures: list[str] = []

# One line per call: the program and its arguments. python3 fails when its script is named in $SWEEP_FAIL.
RECORD = r"""#!/bin/bash
echo "$(basename "$0") $*" >> "$SWEEP_LOG"
"""
FAKE_PYTHON = r"""#!/bin/bash
echo "python3 $*" >> "$SWEEP_LOG"
case "$*" in *"$SWEEP_FAIL"*) [ -n "$SWEEP_FAIL" ] && exit 1 ;; esac
case "$*" in *resume-check*) echo "nothing to resume" ;; *"-c "*) echo 0 ;; esac
exit 0
"""
# timeout <limit> cmd... and nice -n 10 cmd... run the command; the limit itself is logged, to be read back.
FAKE_TIMEOUT = r"""#!/bin/bash
echo "timeout $1" >> "$SWEEP_LOG"; shift; exec "$@"
"""
FAKE_NICE = r"""#!/bin/bash
shift 2; exec "$@"
"""
# systemctl show <timer> -p NextElapseUSecRealtime --value: the same answer for every timer, from $SWEEP_NEXT.
FAKE_SYSTEMCTL = r"""#!/bin/bash
echo "systemctl $*" >> "$SWEEP_LOG"
echo "$SWEEP_NEXT"
"""
# date +%s, date -u +%u and date -d "<when>" +%s, the last one read by the real python (BSD date has no -d).
FAKE_DATE = r"""#!/bin/bash
if [ "$1" = "-d" ]; then exec "$REAL_PYTHON" -c "import sys; print(int(sys.argv[1]))" "${2#@}"; fi
if [ "$1" = "-u" ] && [ "$2" = "+%u" ]; then echo "${SWEEP_WEEKDAY:-2}"; exit 0; fi
exec /bin/date "$@"
"""


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def run(job: str, *, next_sweep_min: int | None = 600, fail: str = "", weekday: int = 2) -> tuple[int, list[str], str]:
    """The script's exit code, the calls it made, and what it printed."""
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        (t / "bin").mkdir()
        (t / "repo" / "v2" / "scripts").mkdir(parents=True)
        (t / "env").mkdir()
        (t / "env" / "uscis.env").write_text("DATABASE_URL=http://127.0.0.1:1\n")
        (t / "env" / "production.env").write_text('REVALIDATE_SECRET="test-secret"\n')
        stand_ins = {"python3": FAKE_PYTHON, "timeout": FAKE_TIMEOUT, "nice": FAKE_NICE,
                     "systemctl": FAKE_SYSTEMCTL, "date": FAKE_DATE}
        for name in ("node", "curl", "git", "flock"):
            stand_ins[name] = RECORD
        for name, body in stand_ins.items():
            f = t / "bin" / name
            f.write_text(body)
            f.chmod(0o755)
        log = t / "calls.log"
        log.write_text("")
        now = int(subprocess.run(["/bin/date", "+%s"], capture_output=True, text=True).stdout)
        env = {
            "PATH": f"{t / 'bin'}:/usr/bin:/bin",
            "PT_REPO": str(t / "repo"), "PT_ENV_DIR": str(t / "env"),
            "SWEEP_LOG": str(log), "SWEEP_FAIL": fail, "SWEEP_WEEKDAY": str(weekday),
            # The stand-in date reads "@<epoch>"; the real one reads systemd's own wording.
            "SWEEP_NEXT": "" if next_sweep_min is None else f"@{now + next_sweep_min * 60}",
            "REAL_PYTHON": sys.executable, "HOME": tmp,
        }
        res = subprocess.run(["/bin/bash", str(SCRIPT), job], env=env, capture_output=True, text=True, timeout=120)
        return res.returncode, log.read_text().splitlines(), res.stdout + res.stderr


def scripts_run(calls: list[str]) -> list[str]:
    """The python scripts called, with their flags, in order."""
    out = []
    for c in calls:
        m = re.match(r"python3 scripts/(\S+\.py)((?: --[a-z-]+(?: \d+)?)*)", c)
        if m and m.group(1) != "record_ingest_failure.py":
            out.append((m.group(1) + m.group(2)).strip())
    return out


BUILDERS = ["build_entity_detail.py --live-recent-only", "build_employer_map.py", "build_sponsor_index.py",
            "build_lca_cities.py", "build_wage_sources.py"]
DERIVED = ["build_straggler_rates.py", "build_census_days.py", "build_wait_trends.py"]


def expired(calls: list[str]) -> list[str]:
    return [m.group(1) for c in calls if (m := re.search(r"/api/(revalidate-[a-z-]+)", c))]


def main() -> int:
    # 1. The passes keep their order.
    code, calls, out = run("case-status-pending")
    check("a pending pass runs the pass, the builders, the filings by day, in that order",
          scripts_run(calls) == ["ingest_case_status_direct.py --pending", *BUILDERS, "build_filings_by_day.py"],
          str(scripts_run(calls)))
    check("then expires the sweep's pages and ends clean",
          code == 0 and expired(calls) == ["revalidate-sweep"] and "every step finished clean" in out, f"{code} {out[-200:]}")
    code, calls, out = run("case-status-full", weekday=2)
    check("a full pass adds its own steps between the builders and the filings by day",
          scripts_run(calls) == ["ingest_case_status_direct.py --full", *BUILDERS,
                                 "sweep_serial_gaps.py --window 90 --cap 600", "sync_published_live.py --cap 400", *DERIVED,
                                 "backtest_queue.py --write", "backtest_pwd.py --write", "build_filings_by_day.py"],
          str(scripts_run(calls)))
    code, calls, out = run("case-status-full", weekday=1)
    check("and on a Monday the two weekly backtests",
          scripts_run(calls)[-3:] == ["backtest_seasonal.py --write", "backtest_bulletin.py --write", "build_filings_by_day.py"],
          str(scripts_run(calls)[-4:]))

    # 2. The rebuild after a deploy: every stored document, and nothing asked of DOL.
    code, calls, out = run("case-status-docs", next_sweep_min=400)
    ran = scripts_run(calls)
    check("the rebuild after a deploy runs the documents, the builders, the derived summaries and the filings by day",
          ran == ["ingest_case_status_direct.py --docs", *BUILDERS, *DERIVED, "build_filings_by_day.py"], str(ran))
    check("it runs no pass, no walk, no gap sweep, no published sync and no backtest",
          not any(re.search(r"--(full|pending|discover)\b|sweep_serial_gaps|sync_published_live|backtest_", r) for r in ran), str(ran))
    check("it expires the sweep's pages once everything is rebuilt, and ends clean",
          code == 0 and expired(calls) == ["revalidate-sweep"] and "every step finished clean" in out, f"{code} {out[-200:]}")
    check("it takes the case sweeps' own lock, so the two never run together",
          any(c.startswith("flock -n 9") for c in calls) and "permtracker-sweep-case.lock" in SCRIPT.read_text().replace("${job%%-*}", "case"))
    check("it reads the scripts at origin/main first, as every sweep does",
          any("fetch" in c for c in calls if c.startswith("git")) and any("reset" in c for c in calls if c.startswith("git")))

    # 3. It gives way to a sweep that is about to run.
    code, calls, out = run("case-status-docs", next_sweep_min=20)
    check("with a sweep due in 20 minutes it rebuilds nothing, says why, and isn't a failure",
          code == 0 and scripts_run(calls) == [] and expired(calls) == []
          and "a case sweep starts in" in out and "rebuilds the documents itself" in out, f"{code} {out[-300:]}")
    code, calls, out = run("case-status-docs", next_sweep_min=46)
    check("with a sweep 46 minutes off it runs", code == 0 and len(scripts_run(calls)) == 10, str(scripts_run(calls)))
    code, calls, out = run("case-status-docs", next_sweep_min=None)
    check("when no timer can be read it runs: an unreadable clock is no reason to leave old documents up",
          code == 0 and len(scripts_run(calls)) == 10, f"{code} {out[-200:]}")

    # 4. The unit's limit sits under the give-way figure, and every timer a sweep has is asked about.
    src = SCRIPT.read_text()
    give_way = int(re.search(r"^DOCS_GIVE_WAY=(\d+)$", src, re.M).group(1))
    limit = int(re.search(r"^TimeoutStartSec=(\d+)min$", LIMIT.read_text(), re.M).group(1))
    check("the unit is stopped before the give-way figure is reached", 0 < limit < give_way, f"limit {limit}, give way {give_way}")
    timers = sorted(p.name.split("@")[1].removesuffix(".timer") for p in (HERE / "systemd").glob("permtracker-sweep@case-status-*.timer"))
    asked = sorted(re.search(r"for t in ([a-z -]+); do", src).group(1).split())
    check("every case-status timer is one it checks before starting", timers == asked, f"timers {timers}, asked {asked}")

    # 5. A failure is red, and nothing is expired over a half-built set.
    code, calls, out = run("case-status-docs", next_sweep_min=400, fail="ingest_case_status_direct.py --docs")
    check("a failed rebuild ends red, records the failure, and expires nothing",
          code == 1 and expired(calls) == [] and any("record_ingest_failure.py" in c and "--docs" in c for c in calls)
          and "these steps failed" in out, f"{code} {out[-300:]}")
    check("the steps after a failed one still run", len(scripts_run(calls)) == 10, str(scripts_run(calls)))
    code, calls, out = run("case-status-docs", next_sweep_min=400, fail="build_employer_map.py")
    check("a failed builder ends red too", code == 1 and expired(calls) == [], f"{code}")

    # 6. The deploy starts it after the release is live, in the background, and never fails over it.
    d = DEPLOY.read_text()
    start = d.find("systemctl start --no-block permtracker-sweep@case-status-docs.service")
    check("the deploy starts the rebuild", start > 0)
    check("after the site answered through nginx on the new release, and before it reports the deploy",
          d.find("if ! site_ok; then") < start < d.find('log "deployed $rel"'))
    line = d[start:d.find("\n", d.find("\n", start) + 1)]
    check("in the background, with a failure logged and the deploy going on", "--no-block" in line and "|| log " in line, line)
    check("an unknown job still prints the usage and exits 2", run("nonsense")[0] == 2)
    print(f"\n{len(failures)} failed" if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

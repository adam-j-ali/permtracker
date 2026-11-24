"""The jobs that run into the evening date their work by the Eastern day, never the server's clock.

The server's clock is UTC: after 7 or 8 PM Eastern it's already tomorrow there. record_sweep dated an 8 PM sweep
"November 24" on the evening of the 23rd (Nov 23 2026). These scripts run until 7:10 PM (the wage-request daytime pass),
7:45 PM (the PERM daytime pass) or 8:10 PM (the evening pass), so none may read today's date from the server's clock.
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
EVENING_SCRIPTS = ["ingest_pwd_status_direct.py", "ingest_case_status_direct.py", "lib_db.py"]
SERVER_CLOCK = re.compile(r"date\.today\(\)|time\.localtime\(|time\.strftime\(\"%Y-%m-%d\"\)")


def offenders(text: str) -> list[int]:
    return [i for i, line in enumerate(text.splitlines(), 1)
            if SERVER_CLOCK.search(line) and not line.lstrip().startswith("#")]


def main() -> int:
    bad = []
    for name in EVENING_SCRIPTS:
        for n in offenders((HERE / name).read_text()):
            bad.append(f"{name}:{n}")
    # The gate catches what it says it catches.
    probe = 'today = datetime.date.today()\nstamp = time.strftime("%Y-%m-%d")\n# date.today() in a comment is fine\n'
    if offenders(probe) != [1, 2]:
        print("FAIL the probe: the pattern missed a server-clock date or flagged a comment")
        return 1
    if bad:
        print("FAIL server-clock dates in evening jobs (use et_today(), et_date() or datetime.now(ET)):", ", ".join(bad))
        return 1
    print("ok: the evening jobs date their work by the Eastern day")
    return 0


if __name__ == "__main__":
    sys.exit(main())

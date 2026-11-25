"""Every data script dates its work by the Eastern day, never the machine's clock.

The server's clock is UTC: after 7 or 8 PM Eastern it's already tomorrow there. record_sweep dated an 8 PM sweep
"November 24" on the evening of the 23rd (Nov 23 2026). The gate first held the three evening jobs; on Nov 24 every
script moved to lib_days.today_et() (52 uses in 32 scripts), and the gate now reads them all. A UTC instant written as one
(time.gmtime() with a Z) is an instant, never a day, and passes.
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SERVER_CLOCK = re.compile(r"date\.today\(\)|time\.localtime\(|time\.strftime\(\"%Y-%m-%d\"\)|datetime\.now\(\)\.date\(\)")


def scripts() -> list[pathlib.Path]:
    """Every data script, server script and test. Tests joined Nov 24 2026: test_warn_states compared the code's Eastern
    day with the machine's, and failed every evening on GitHub's UTC clock. A test that pins a day writes the date out;
    only this file, whose probe holds the patterns on purpose, is left out."""
    found = [p for p in sorted(HERE.glob("*.py")) if p.name != "test_eastern_dates.py"]
    found += [p for p in sorted((HERE / "oracle").rglob("*.py"))]
    return found


def offenders(text: str) -> list[int]:
    return [i for i, line in enumerate(text.splitlines(), 1)
            if SERVER_CLOCK.search(line) and not line.lstrip().startswith("#")]


def main() -> int:
    bad = []
    every = scripts()
    for path in every:
        for n in offenders(path.read_text()):
            bad.append(f"{path.relative_to(HERE)}:{n}")
    if len(every) < 100:
        print(f"FAIL the gate read only {len(every)} scripts; it should read every one")
        return 1
    # The gate catches what it says it catches.
    probe = ('today = datetime.date.today()\nstamp = time.strftime("%Y-%m-%d")\n# date.today() in a comment is fine\n'
             'built = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())\nday = datetime.now().date()\n')
    if offenders(probe) != [1, 2, 5]:
        print("FAIL the probe: the pattern missed a server-clock date or flagged a comment")
        return 1
    if bad:
        print("FAIL server-clock dates (use lib_days.today_et(), lib_db.et_date() or datetime.now(ET)):", ", ".join(bad))
        return 1
    print(f"ok: all {len(every)} scripts date their work by the Eastern day")
    return 0


if __name__ == "__main__":
    sys.exit(main())

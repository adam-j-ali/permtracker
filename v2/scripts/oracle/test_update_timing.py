#!/usr/bin/env python3
"""The nightly upgrade is done before the reboot it may ask for.

Nov 13 2026: the server rebooted at 06:30 UTC for the updates of the night before, then that night's upgrade ran at
06:44 and 06:59 (Ubuntu spreads it over an hour from 06:00). It restarted the site's services three more times and
queued another reboot for the night after. The drop-in holds the upgrade to the minutes after 06:00, and this test
holds the two settings together: the upgrade's last possible start, plus room to finish, is before the reboot.

Run: python3 scripts/oracle/test_update_timing.py
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
DROPIN = HERE / "systemd" / "dropins" / "apt-upgrade-before-reboot.conf"
REBOOT = HERE / "conf" / "apt-reboot-permtracker.conf"
# Ubuntu's own apt-daily-upgrade.timer: OnCalendar=*-*-* 6:00.
UPGRADE_STARTS_MIN = 6 * 60
# The longest an upgrade took that night was 12 seconds; ten minutes is room for a kernel.
ROOM_TO_FINISH_MIN = 10
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f" ({detail})"))
    if not ok:
        failures.append(name)


def delay_minutes(text: str) -> int | None:
    """The drop-in's RandomizedDelaySec in minutes, None when it isn't a plain number of minutes."""
    m = re.search(r"^RandomizedDelaySec=(\d+)m(?:in)?$", text, re.M)
    return int(m.group(1)) if m else None


def reboot_minutes(text: str) -> int | None:
    """The configured reboot time as minutes past midnight, comment lines left out."""
    live = "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("//"))
    m = re.search(r'Automatic-Reboot-Time "(\d\d):(\d\d)"', live)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def main() -> int:
    drop, reboot = DROPIN.read_text(), REBOOT.read_text()
    delay, at = delay_minutes(drop), reboot_minutes(reboot)
    check("the drop-in sets the upgrade's random delay in minutes", delay is not None, drop)
    check("the reboot has a set time", at is not None, reboot)
    check("automatic reboots are on", 'Automatic-Reboot "true"' in reboot)
    if delay is not None and at is not None:
        latest = UPGRADE_STARTS_MIN + delay
        check("the upgrade's last possible start leaves it time to finish before the reboot",
              latest + ROOM_TO_FINISH_MIN <= at, f"starts by {latest // 60:02d}:{latest % 60:02d}, reboot at {at // 60:02d}:{at % 60:02d}")
    check("the drop-in changes the timer section and nothing else", "[Timer]" in drop and "OnCalendar" not in drop.split("[Timer]")[1])
    # The probes: an hour's delay (Ubuntu's own) and a missing time must both be caught by the readers above.
    check("an hour's delay would fail the rule", UPGRADE_STARTS_MIN + (delay_minutes("RandomizedDelaySec=60m") or 0) + ROOM_TO_FINISH_MIN > (at or 0))
    check("a reboot time inside a comment isn't read as the setting", reboot_minutes('// Automatic-Reboot-Time "06:30"') is None)
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

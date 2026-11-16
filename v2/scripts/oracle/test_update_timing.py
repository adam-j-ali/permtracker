#!/usr/bin/env python3
"""Updates install every night; the server restarts for them once a week, at a minute that cuts nothing in half.

Nov 13 2026: the server rebooted at 06:30 UTC for the updates of the night before, then that night's upgrade ran at
06:44 and 06:59 (Ubuntu spreads it over an hour from 06:00). It restarted the site's services three more times and
queued another reboot for the night after. The drop-in holds the upgrade to the minutes after 06:00.

Nov 15 2026: those nightly reboots held every server error Cloudflare logged in three days (1:30 AM on Nov 13 and
Nov 14), and one of them landed on Googlebot and failed Search Console's server-error validation. So unattended-upgrades
no longer reboots by itself, and permtracker-weekly-reboot.timer restarts the server on Sundays only, when an update
asks for it. This test holds the settings together: the upgrade has finished before the restart in winter, the
restart and its longest wait end before the 2 AM night release, and the script restarts only when it should.

Run: python3 scripts/oracle/test_update_timing.py
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
DROPIN = HERE / "systemd" / "dropins" / "apt-upgrade-before-reboot.conf"
APT_CONF = HERE / "conf" / "apt-reboot-permtracker.conf"
TIMER = HERE / "systemd" / "permtracker-weekly-reboot.timer"
SERVICE = HERE / "systemd" / "permtracker-weekly-reboot.service"
SCRIPT = HERE / "bin" / "permtracker-weekly-reboot"
RELEASE_TIMER = HERE / "systemd" / "permtracker-cron@dispatch-night-deploy.timer"
# Ubuntu's own apt-daily-upgrade.timer: OnCalendar=*-*-* 6:00, in the server's UTC.
UPGRADE_STARTS_UTC_MIN = 6 * 60
# The longest an upgrade took on Nov 13 was 12 seconds; ten minutes is room for a kernel.
ROOM_TO_FINISH_MIN = 10
# Eastern standard time is UTC minus five hours: the season in which the restart comes after the upgrade.
EST_OFFSET_MIN = 5 * 60
# The restart, after its longest wait, still ends this long before the night release starts.
RELEASE_MARGIN_MIN = 10
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f" ({detail})"))
    if not ok:
        failures.append(name)


def live(text: str, comment: str) -> str:
    """The text with its comment lines left out."""
    return "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith(comment))


def delay_minutes(text: str) -> int | None:
    """The drop-in's RandomizedDelaySec in minutes, None when it isn't a plain number of minutes."""
    m = re.search(r"^RandomizedDelaySec=(\d+)m(?:in)?$", text, re.M)
    return int(m.group(1)) if m else None


def apt_reboots_itself(text: str) -> bool | None:
    """Whether unattended-upgrades reboots by itself, read from the live lines only; None when it isn't set."""
    found = re.findall(r'Automatic-Reboot "(true|false)"', live(text, "//"))
    return None if not found else found[-1] == "true"


def sunday_minutes(text: str) -> int | None:
    """The timer's one Sunday time in Eastern, as minutes past midnight; None for any other shape."""
    lines = re.findall(r"^OnCalendar=.*$", live(text, "#"), re.M)
    if len(lines) != 1:
        return None
    m = re.fullmatch(r"OnCalendar=Sun \*-\*-\* (\d\d):(\d\d):00 America/New_York", lines[0])
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def daily_minutes(text: str) -> int | None:
    """A daily Eastern OnCalendar time as minutes past midnight."""
    m = re.search(r"^OnCalendar=\*-\*-\* (\d\d):(\d\d):00 America/New_York$", text, re.M)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def max_wait(text: str) -> int | None:
    m = re.search(r"^MAX_WAIT_MIN=(\d+)$", text, re.M)
    return int(m.group(1)) if m else None


def fmt(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def main() -> int:
    drop, apt, timer, service, script = (p.read_text() for p in (DROPIN, APT_CONF, TIMER, SERVICE, SCRIPT))
    delay, at, release, wait = delay_minutes(drop), sunday_minutes(timer), daily_minutes(RELEASE_TIMER.read_text()), max_wait(script)

    check("the drop-in sets the upgrade's random delay in minutes", delay is not None, drop)
    check("the drop-in changes the timer section and nothing else", "[Timer]" in drop and "OnCalendar" not in drop.split("[Timer]")[1])
    check("unattended-upgrades never reboots by itself", apt_reboots_itself(apt) is False, apt)
    check("the weekly restart has one Sunday time in Eastern", at is not None, timer)
    check("the night release has a daily Eastern time", release is not None)
    check("the script names its longest wait", wait is not None)
    if delay is not None and at is not None:
        latest = UPGRADE_STARTS_UTC_MIN + delay
        check("in winter the night's upgrade has time to finish before the restart",
              latest + ROOM_TO_FINISH_MIN <= at + EST_OFFSET_MIN,
              f"upgrade starts by {fmt(latest)} UTC, restart at {fmt(at + EST_OFFSET_MIN)} UTC")
    if at is not None and release is not None and wait is not None:
        check("the restart, after its longest wait, ends before the night release",
              at + wait + RELEASE_MARGIN_MIN <= release, f"restart {fmt(at)} + {wait} min, release {fmt(release)} ET")
    check("a missed Sunday is never made up at boot", re.search(r"^Persistent=false$", timer, re.M) is not None)
    check("the service runs the script", "ExecStart=/usr/local/bin/permtracker-weekly-reboot" in service)
    check("the script restarts only when an update asks", 'if [ ! -f /var/run/reboot-required ]; then' in script)
    for unit in ("apt-daily-upgrade.service", "permtracker-db-refresh.service"):
        check(f"the script waits while {unit} runs", unit in script)
    check("the script waits while a release runs", "/srv/permtracker/health/deploying" in script)

    # The probes: each shape the rules exist for must be caught by the readers above.
    check("probe: a live reboot setting after a commented one is read as on",
          apt_reboots_itself('// Unattended-Upgrade::Automatic-Reboot "false";\nUnattended-Upgrade::Automatic-Reboot "true";') is True)
    check("probe: a setting only inside a comment isn't read", apt_reboots_itself('// Unattended-Upgrade::Automatic-Reboot "false";') is None)
    check("probe: an every-day restart isn't read as Sunday", sunday_minutes("OnCalendar=*-*-* 01:30:00 America/New_York") is None)
    check("probe: a restart in UTC isn't read as Eastern", sunday_minutes("OnCalendar=Sun *-*-* 06:30:00 UTC") is None)
    check("probe: a 1:55 AM restart would fail the release rule",
          (sunday_minutes("OnCalendar=Sun *-*-* 01:55:00 America/New_York") or 0) + (wait or 0) + RELEASE_MARGIN_MIN > (release or 0))
    check("probe: an hour's delay would fail the winter rule",
          UPGRADE_STARTS_UTC_MIN + (delay_minutes("RandomizedDelaySec=60m") or 0) + ROOM_TO_FINISH_MIN > (at or 0) + EST_OFFSET_MIN)
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""The health sampler copies the alarm's last day of starts into the server's report, so the morning report can list
what the routing list kept out of the email (bin/permtracker-health, alarm_events).

* a day of starts is copied, each with its kind; older ones aren't;
* no memory file yet is a quiet day; an unreadable one is None, never a quiet day;
* a malformed entry is skipped, never a crash.

Run: python3 scripts/oracle/test_health_alarm_events.py
"""
import importlib.machinery
import importlib.util
import json
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("pt_health_events", str(HERE / "bin" / "permtracker-health"))
spec = importlib.util.spec_from_loader("pt_health_events", loader)
health = importlib.util.module_from_spec(spec)
loader.exec_module(health)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


NOW = 1_796_043_600.0
with tempfile.TemporaryDirectory() as d:
    path = pathlib.Path(d) / "alarm.json"
    check("no memory file yet: nothing to list", health.alarm_events(path, NOW) == [])
    path.write_text("{not json")
    check("an unreadable memory: None, never a quiet day", health.alarm_events(path, NOW) is None)
    path.write_text(json.dumps({"alarms": {}, "events": [
        {"at": NOW - 3600, "key": "unit:permtracker-cron@x", "route": "alarm.job-once", "reason": "x failed",
         "run": "111", "over": NOW - 1800},
        {"at": NOW - 25 * 3600, "key": "disk", "route": "alarm.disk", "reason": "old"},
        {"at": "soon", "key": "bad"},
        "junk",
    ]}))
    got = health.alarm_events(path, NOW)
    check("a day of starts, with their kinds and when they ended; older and malformed ones left out",
          got == [{"at": NOW - 3600, "key": "unit:permtracker-cron@x", "route": "alarm.job-once",
                   "reason": "x failed", "over": NOW - 1800}], str(got))

print(f"\n{len(failures)} failed")
sys.exit(1 if failures else 0)

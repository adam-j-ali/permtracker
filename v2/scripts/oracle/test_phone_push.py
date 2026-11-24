#!/usr/bin/env python3
"""Server alarms reach the owner's phone by one rule set, beside the email and never instead of it.

* a push carries no IP address, email address or receipt-shaped number, and keeps unit names and clock times;
* each push says what happened, since when (Eastern, 12-hour) and what to do;
* a service systemd stopped restarting pushes as urgent, every other alarm as high;
* a timed job pushes only once two of its runs in a row have failed; a failure the next run fixes never pushes;
* an alarm pushes once when it starts and once when it clears, never a reminder, and an alarm never pushed never
  pushes a clear;
* a push that fails stays due, never stops the email, and the next email says pushes are failing;
* at most 12 pushes an Eastern day, urgent ones excepted.

Run: python3 scripts/oracle/test_phone_push.py
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))
import phone_push  # noqa: E402

loader = importlib.machinery.SourceFileLoader("alarm", str(HERE / "bin" / "permtracker-alarm"))
spec = importlib.util.spec_from_loader("alarm", loader)
assert spec
alarm = importlib.util.module_from_spec(spec)
loader.exec_module(alarm)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


# --- what a push may carry, and how it reads (the cases Convex's watch is held to as well) ----------------------
CASES = json.loads((HERE.parent / "fixtures" / "phone_push_cases.json").read_text())
for given, want in CASES["scrub"]:
    check(f"scrub: {given!r}", phone_push.scrub(given) == want, phone_push.scrub(given))
for c in CASES["started"]:
    got_ = phone_push.started(c["what"], c["since"], c["todo"])
    check(f"started: {c['what'][:30]!r} (what, since when in Eastern 12-hour time, what to do)", got_ == c["out"], got_)
for c in CASES["cleared"]:
    got_ = phone_push.cleared(c["what"], c["since"])
    check(f"cleared: {c['what']!r}", got_ == c["out"], got_)
since = 1796043600.0  # Mon Nov 30 2026, 8:00 AM EST
with tempfile.TemporaryDirectory() as d:
    env = pathlib.Path(d) / "phone.env"
    check("no file, no topic, and no push", phone_push.push("t", "m", "high", env)[0] is False)
    env.write_text("# the owner's phone\nNTFY_TOPIC=abc_DEF-123456\n")
    check("the topic is read from its own line", phone_push.topic(env) == "abc_DEF-123456")
    env.write_text("NTFY_TOPIC=short\n")
    check("a topic too short to be private is refused", phone_push.topic(env) is None)

# --- the levels -------------------------------------------------------------------------------------------------
web = "permtracker-web@1.service"
job = "permtracker-cron@flag-notice.service"
info = {web: {"state": "failed", "type": "notify", "start": "10"},
        job: {"state": "failed", "type": "oneshot", "start": "100"}}
runs1 = alarm.job_runs(None, info)
check("a job's first failed run counts one", runs1.get(job, {}).get("fails") == 1, str(runs1))
check("a service isn't counted by runs", web not in runs1)
check("the same failed run, seen again, still counts one", alarm.job_runs(runs1, info)[job]["fails"] == 1)
running = alarm.job_runs(runs1, {job: {"state": "activating", "type": "oneshot", "start": "100"}})
check("a job running now keeps its count", running.get(job, {}).get("fails") == 1)
runs2 = alarm.job_runs(running, {job: {"state": "failed", "type": "oneshot", "start": "200"}})
check("its next run failing too counts two", runs2[job]["fails"] == 2, str(runs2))
fine = alarm.job_runs(runs2, {job: {"state": "inactive", "result": "success", "type": "oneshot", "start": "300"}})
check("a run that ends well starts the count again", job not in fine)
again = alarm.job_runs(fine, {job: {"state": "failed", "type": "oneshot", "start": "400"}})
check("so failed, fine, failed counts one, never two", again[job]["fails"] == 1)

check("a service systemd stopped restarting is urgent", alarm.push_level("unit:permtracker-web@1", info, runs1) == "urgent")
check("a job's single failure doesn't push", alarm.push_level("unit:permtracker-cron@flag-notice", info, runs1) is None)
check("two failed runs in a row push as high", alarm.push_level("unit:permtracker-cron@flag-notice", info, runs2) == "high")
for key in ("disk", "disk-crit", "memory", "sampler", "page-cache", "backup", "journal"):
    check(f"{key} pushes as high", alarm.push_level(key, info, runs1) == "high")
    check(f"{key} has its own what-to-do", key in alarm.TODO)
check("a unit's what-to-do names the unit", "permtracker-web@1" in alarm.todo_of("unit:permtracker-web@1"))

# --- once on start, once on clear, kept until sent -----------------------------------------------------------------
alarm.DRY_RUN = False
got: list[tuple[str, str, str]] = []
def ok_pusher(title, message, level):
    got.append((title, message, level))
    return True, ""
now = since
state = {"alarms": {"disk": {"since": since, "mailed": since, "reason": "20 GB free"}}}
on = {"disk": "20 GB free"}
state, done = alarm.send_pushes(state, on, {"disk": "high"}, now, pusher=ok_pusher)
check("a new alarm pushes once", len(got) == 1 and got[0][2] == "high" and done == ["disk start"], str(got))
check("its push names the alarm, the time and what to do",
      "The disk is filling: 20 GB free." in got[0][1] and "Mon Nov 30, 8:00 AM EST" in got[0][1]
      and "runbook" in got[0][1], got[0][1])
state, _ = alarm.send_pushes(state, on, {"disk": "high"}, now + 7 * 3600, pusher=ok_pusher)
check("still on 7 hours later: no reminder push", len(got) == 1)
state, _ = alarm.send_pushes(state, {}, {}, now + 8 * 3600, pusher=ok_pusher)
check("cleared: one push at default priority", len(got) == 2 and got[1][2] == "clear" and "room" not in got[1][0]
      and "no longer on course to fill" in got[1][1], str(got[-1]))
state, _ = alarm.send_pushes(state, {}, {}, now + 9 * 3600, pusher=ok_pusher)
check("and nothing after", len(got) == 2)

got.clear()
state = {"alarms": {"unit:permtracker-cron@flag-notice": {"since": since, "reason": "x failed"}}}
on = {"unit:permtracker-cron@flag-notice": "x failed"}
state, _ = alarm.send_pushes(state, on, {"unit:permtracker-cron@flag-notice": None}, now, pusher=ok_pusher)
state, _ = alarm.send_pushes(state, {}, {}, now + 3600, pusher=ok_pusher)
check("a job that failed once and recovered pushes nothing, not even a clear", got == [], str(got))

got.clear()
def down_pusher(title, message, level):
    return False, "ntfy unreachable (URLError)"
state = {"alarms": {"memory": {"since": since, "reason": "300 MB available"}}}
state, done = alarm.send_pushes(state, {"memory": "300 MB available"}, {"memory": "high"}, now, pusher=down_pusher)
check("a failed push isn't marked sent", "memory" not in state.get("phone", {}) and done == [])
check("and the state says since when pushes fail, and why",
      state.get("push_failing", {}).get("since") == now and "unreachable" in state["push_failing"]["why"])
state, done = alarm.send_pushes(state, {"memory": "300 MB available"}, {"memory": "high"}, now + 300, pusher=ok_pusher)
check("the next run sends it, and the failure note clears", done == ["memory start"] and not state.get("push_failing"))

got.clear()
state = {"alarms": {}, "pushes": {alarm.email_day(now): alarm.PUSHES_PER_DAY}}
on = {"journal": "x", "unit:permtracker-web@1": "y failed"}
state, done = alarm.send_pushes(state, on, {"journal": "high", "unit:permtracker-web@1": "urgent"}, now,
                                pusher=ok_pusher)
check("over the day's cap, only the urgent push goes", done == ["unit:permtracker-web@1 start"], str(done))
check("the capped one stays due", "journal" not in state["phone"])

# --- in a run: the email first, the push beside it, and a failing push in the next email -------------------------
d = tempfile.mkdtemp()
alarm.RUN = pathlib.Path(d)
alarm.STATE = alarm.RUN / "alarm.json"
alarm.heal = lambda on: []
emails: list[tuple[str, str]] = []
alarm.send = lambda subject, text: emails.append((subject, text)) or True
pushes: list[tuple] = []
alarm.phone_push.push = lambda title, message, level: pushes.append((title, level)) or (False, "ntfy answered 500")
def snap(**kw):
    base = {"swap_pages": None, "disk_free_gb": 100.0, "mem_available_mb": 4000, "swap_used_mb": 0,
            "failed_units": [], "stopped_units": [], "unit_info": {}, "sampler_age_s": 60, "prune_age_s": 60,
            "uncounted": [], "cache_headroom_gb": None, "backup_age_s": 3600, "journal_age_s": 60}
    return {**base, **kw}
alarm.snapshot = lambda now: snap(failed_units=[web], unit_info={web: {"state": "failed", "type": "notify"}})
code = alarm.main()
check("a push that fails leaves the email and the exit code alone", code == 0 and len(emails) == 1 and len(pushes) == 1)
check("the push for a stopped web copy is urgent", pushes[0][1] == "urgent", str(pushes))
saved = json.loads(alarm.STATE.read_text())
check("the failing push is remembered", bool(saved.get("push_failing")))
alarm.snapshot = lambda now: snap(failed_units=[web], unit_info={web: {"state": "failed", "type": "notify"}},
                                  disk_free_gb=5.0)
alarm.main()
check("the next email says pushes are failing", len(emails) == 2 and "Pushes to your phone have failed since" in emails[1][1],
      emails[-1][1][-300:] if emails else "")

# --- the defense: its pushes count against its own cap, and a failed one isn't counted --------------------------
dloader = importlib.machinery.SourceFileLoader("defend", str(HERE / "bin" / "permtracker-defend"))
dspec = importlib.util.spec_from_loader("defend", dloader)
assert dspec
defend = importlib.util.module_from_spec(dspec)
dloader.exec_module(defend)
dpushed: list[tuple[str, str]] = []
defend.phone_push.push = lambda title, message, level: dpushed.append((title, level)) or (True, "")
dstate: dict = {}
for _ in range(defend.PUSHES_PER_DAY + 2):
    defend.phone(dstate, "PERM Tracker: automatic defense on", "m", "high")
check("the defense pushes at most its daily cap", len(dpushed) == defend.PUSHES_PER_DAY, str(len(dpushed)))
defend.phone_push.push = lambda title, message, level: (False, "ntfy answered 500")
dstate2: dict = {}
defend.phone(dstate2, "t", "m", "high")
check("a push the defense couldn't send isn't counted", not any(dstate2.get("pushes", {}).values()))
src = (HERE / "bin" / "permtracker-defend").read_text()
# Told once an episode when the routing list sends its kind by phone (Nov 23 2026): its first action, a rule or Under
# Attack Mode, and its summary at the end. test_defend.py runs the episode under both channels.
check("the defense pushes only beside an email, from its two tell functions",
      src.count("phone(state,") == 2 and src.count("email(state, cfg,") == 2
      and src.count("tell_start(state, cfg,") == 2 and src.count("tell_end(state, cfg,") == 1)
check("only the defense switching off is a clear", src.count('"clear")') == 1)

print(f"\n{len(failures)} failed")
sys.exit(1 if failures else 0)

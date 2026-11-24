#!/usr/bin/env python3
"""The routing list (scripts/data/alert_routes.json) and the programs that raise alerts agree.

* the list is sound: one row per kind, each with a channel, a place it runs, what it is and how often it repeats,
  and a level and reminder hours exactly when it goes by phone;
* every alert kind a program names is in the list (a sender can't raise a kind the list doesn't route);
* every kind in the list is raised somewhere in the files of the place it runs (no row without a sender);
* every email to the owner from Convex names its kind: each sendOwnerMail kind is a mail.* row, and every
  sendAdminNotificationEmail call passes a route;
* a kind that names a morning report section names one that exists.

Run: python3 scripts/test_alert_routes.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE / "oracle" / "lib"))
import alert_routes  # noqa: E402

LIST = HERE / "data" / "alert_routes.json"

# Where each place's kinds are raised: the files read for route ids. A new place needs its files named here.
FILES: dict[str, list[str]] = {
    "alarm": ["scripts/oracle/bin/permtracker-alarm"],
    "defense": ["scripts/oracle/bin/permtracker-defend"],
    "watch": ["convex/serverWatch.ts", "convex/lib/serverWatch.ts"],
    "errors": ["convex/systemErrors.ts", "convex/lib/errorRecording.ts"],
    "notices": [],      # every Convex file that calls sendAdminNotificationEmail (found below)
    "mail": [],         # every sendOwnerMail kind (found below)
    "worker": [],       # the mail Worker reads no list: its rows are held to the code by ANCHORS
    "report": ["scripts/daily_monitor.py", "convex/lib/dailyReportCompose.ts", "convex/dailyReport.ts"],
    "ingest": ["scripts/check_ingest_health.py"],
    "audit": ["scripts/site_audit.py"],
}
# A kind whose program can't read the list (deployed apart from it), held to the code that raises it.
ANCHORS = {"mail.support-inbox": ("workers/mail/worker.mjs", "async function forwardToOwner(")}

FAMILIES = ("alarm", "defense", "watch", "errors", "report", "ingest", "audit", "notice", "mail")
ID = re.compile(r"(?<=[\"'])((?:%s)\.[a-z0-9]+(?:-[a-z0-9]+)*)(?=[\"'])" % "|".join(FAMILIES))
# A file name or a domain shaped like a kind ("alarm.json", "mail.com") is neither.
NOT_A_KIND = {"json", "ts", "tsx", "js", "mjs", "py", "md", "txt", "log", "xml", "html", "csv", "com", "ru", "org",
              "net", "io", "app"}
OWNER_MAIL = re.compile(r"sendOwnerMail\(\s*ctx\s*,\s*\"([^\"]+)\"")
CARRIERS = {"notification:sendAdminNotificationEmail"}   # carries the notices, each naming its own route
NOTIFY = "internal.notificationActions.sendAdminNotificationEmail"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def kinds_in(text: str) -> set[str]:
    return {k for k in ID.findall(text) if k.rsplit(".", 1)[1] not in NOT_A_KIND}


def call_args(text: str, at: int) -> str:
    """The argument text of the call around position `at` (from the "(" before it to its matching ")")."""
    start = text.rfind("(", 0, at)
    depth = 0
    for i in range(start, len(text)):
        depth += {"(": 1, ")": -1}.get(text[i], 0)
        if depth == 0:
            return text[start:i + 1]
    return text[start:]


def convex_sources() -> dict[str, str]:
    out = {}
    for p in sorted((ROOT / "convex").rglob("*.ts")):
        rel = p.relative_to(ROOT).as_posix()
        if "/_generated/" in rel or "/__tests__/" in rel or rel.endswith(".test.ts"):
            continue
        out[rel] = p.read_text()
    return out


def gate(doc: dict, sources: dict[str, str], convex: dict[str, str]) -> list[str]:
    """Every disagreement between the list and the code, in plain words. Pure, so the probes below can feed it a
    broken list or a broken sender."""
    bad = list(alert_routes.problems(doc))
    listed = {r["id"]: r for r in doc.get("routes", []) if isinstance(r, dict) and "id" in r}
    if sorted(doc.get("runs", {})) != sorted(FILES):
        bad.append(f"the places under runs ({sorted(doc.get('runs', {}))}) aren't the gate's ({sorted(FILES)})")
    # The notices: every call passes a route, and its literal kinds count as raised by the notices.
    notices: dict[str, str] = {}
    for rel, text in convex.items():
        for m in re.finditer(re.escape(NOTIFY), text):
            args = call_args(text, m.start())
            if not re.search(r"\broute\b", args):
                bad.append(f"{rel} calls sendAdminNotificationEmail without a route")
            notices[rel] = text
    found_by = {place: {} for place in FILES}
    for place, files in FILES.items():
        for rel in files:
            found_by[place][rel] = kinds_in(sources[rel])
    found_by["notices"] = {rel: kinds_in(text) for rel, text in notices.items()}
    # A sender raising an unlisted kind: any kind named in any sender, or anywhere in Convex.
    everywhere = {rel: kinds_in(text) for rel, text in {**sources, **convex}.items()}
    for rel, kinds in everywhere.items():
        for k in sorted(kinds - set(listed)):
            bad.append(f"{rel} raises {k}, which the routing list doesn't name")
    # The mail to the owner: each sendOwnerMail kind is a mail.* row.
    owner_kinds = {f"mail.{k}" for text in convex.values() for k in OWNER_MAIL.findall(text) if k not in CARRIERS}
    for k in sorted(owner_kinds - set(listed)):
        bad.append(f"Convex sends the owner mail of kind {k[5:]!r}, which the routing list doesn't name ({k})")
    # A row with no sender.
    for rid, r in listed.items():
        place = r.get("runs")
        if rid in ANCHORS:
            rel, anchor = ANCHORS[rid]
            if anchor not in sources.get(rel, ""):
                bad.append(f"{rid} is held to {anchor!r} in {rel}, which isn't there")
            continue
        if rid.startswith("mail."):
            if rid not in owner_kinds:
                bad.append(f"{rid} is listed, but no sendOwnerMail call sends kind {rid[5:]!r}")
            continue
        if not any(rid in kinds for kinds in found_by.get(place, {}).values()):
            bad.append(f"{rid} is listed under {place!r}, but none of that place's files raises it")
    # A report section named by a row exists in the report.
    sections = set(re.findall(r"section\(\s*\"([a-z]+)\"", sources["scripts/daily_monitor.py"]))
    sections |= set(re.findall(r"guarded\(\s*\"([a-z]+)\"", sources["scripts/daily_monitor.py"]))
    sections |= set(re.findall(r"key:\s*\"([a-z]+)\"", sources["convex/lib/dailyReportCompose.ts"]))
    for rid, r in listed.items():
        if r.get("section") and r["section"] not in sections:
            bad.append(f"{rid} names the report section {r['section']!r}, which the report doesn't have")
    return bad


def main() -> int:
    doc = json.loads(LIST.read_text())
    rels = {rel for files in FILES.values() for rel in files} | {rel for rel, _ in ANCHORS.values()}
    sources = {rel: (ROOT / rel).read_text() for rel in sorted(rels)}
    convex = convex_sources()

    found = gate(doc, sources, convex)
    check("the routing list and every sender agree", found == [], "\n    " + "\n    ".join(found))
    check("the server's loader reads the list as sound", alert_routes.load(LIST).ok)

    # Probes: each rule fails on a broken input shaped like the case it guards.
    probe = json.loads(json.dumps(doc))
    probe["routes"] = [r for r in probe["routes"] if r["id"] != "alarm.memory"]
    check("probe: a sender raising a kind the list dropped fails",
          any("raises alarm.memory" in b for b in gate(probe, sources, convex)))
    probe = json.loads(json.dumps(doc))
    probe["routes"].append({**probe["routes"][0], "id": "watch.ghost"})
    check("probe: a listed kind nobody raises fails",
          any("watch.ghost is listed" in b for b in gate(probe, sources, convex)))
    probe = json.loads(json.dumps(doc))
    probe["routes"][0] = {**probe["routes"][0], "channel": "pager"}
    check("probe: an unknown channel fails", any("channel 'pager'" in b for b in gate(probe, sources, convex)))
    probe = json.loads(json.dumps(doc))
    probe["routes"][0] = {k: v for k, v in probe["routes"][0].items() if k != "level"}
    check("probe: a phone kind with no level fails", any("needs a level" in b for b in gate(probe, sources, convex)))
    broken = dict(convex)
    broken["convex/probe.ts"] = f"await ctx.scheduler.runAfter(0, {NOTIFY}, {{ subject, body }});"
    check("probe: a notice without a route fails",
          any("probe.ts calls sendAdminNotificationEmail without a route" in b for b in gate(doc, sources, broken)))
    broken["convex/probe.ts"] = 'await sendOwnerMail(ctx, "brand-new", getResend(), {});'
    check("probe: owner mail of an unlisted kind fails",
          any("'brand-new'" in b for b in gate(doc, sources, broken)))
    broken["convex/probe.ts"] = 'const route = "errors.surprise";'
    check("probe: a Convex file naming an unlisted kind fails",
          any("raises errors.surprise" in b for b in gate(doc, sources, broken)))
    probe = json.loads(json.dumps(doc))
    probe["routes"][0] = {**probe["routes"][0], "section": "nowhere"}
    check("probe: a row naming a report section that doesn't exist fails",
          any("'nowhere'" in b for b in gate(probe, sources, convex)))
    check("control: a file name shaped like a kind isn't one", kinds_in('STATE = RUN / "alarm.json"') == set())

    print(f"\n{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

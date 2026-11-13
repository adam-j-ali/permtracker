#!/usr/bin/env python3
"""The page-cache cap sees every folder Next renders pages into.

bin/permtracker-prune removes rendered pages above a disk budget. Next 16.3
moved those pages from .next/server/app into .next/server/route-cache, and the
cap, reading only the first folder, reported "0 pages" while the second grew:
on Oct 10 2026 the 145 GB disk filled to 100% and the database stopped writing.

* a page under server/route-cache/<KIND>/<hash>/$/ counts, with its .segments;
* a page under server/app still counts;
* an old release's budget of 0 removes both, .html first.

Run: python3 scripts/oracle/test_prune.py
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("prune", str(HERE / "bin" / "permtracker-prune"))
spec = importlib.util.spec_from_loader("prune", loader)
assert spec
prune = importlib.util.module_from_spec(spec)
loader.exec_module(prune)
# Every file this test writes is "after the deploy": the real margin counts
# pages written within two minutes of server.js as the build's own.
prune.MARGIN_S = -10

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def page(stem: pathlib.Path, size: int = 1000) -> None:
    stem.parent.mkdir(parents=True, exist_ok=True)
    for ext in (".html", ".rsc", ".meta"):
        (stem.parent / (stem.name + ext)).write_bytes(b"x" * size)
    seg = stem.parent / (stem.name + ".segments")
    seg.mkdir()
    (seg / "_index.segment.rsc").write_bytes(b"x" * size)


with tempfile.TemporaryDirectory() as tmp:
    rel = pathlib.Path(tmp) / "abc-1"
    (rel / ".next" / "server").mkdir(parents=True)
    (rel / "server.js").write_text("")
    page(rel / ".next/server/app/perm-queue")
    page(rel / ".next/server/route-cache/APP_PAGE/195f96ac/$/calculators")

    found = sorted(stem for _u, _s, stem in prune.groups(str(rel)))
    check("a route-cache page counts", any("route-cache" in s for s in found), str(found))
    check("a server/app page still counts", any("/server/app/" in s for s in found), str(found))
    sizes = [s for _u, s, _st in prune.groups(str(rel))]
    check("a page's size includes its segments", sizes == [4000, 4000], str(sizes))

    check("the tree size counts every file under .next/server",
          prune.tree_size(str(rel / ".next" / "server")) == 8000, str(prune.tree_size(str(rel / ".next" / "server"))))
    freed = [prune.remove(stem) for _u, _s, stem in prune.groups(str(rel))]
    left = [p for p in rel.rglob("*") if p.is_file() and p.name != "server.js"]
    check("removing frees both folders", left == [], str(left))
    check("remove reports the bytes it actually freed", freed == [4000, 4000], str(freed))
    check("a page that's already gone frees nothing", prune.remove(str(rel / ".next/server/app/perm-queue")) == 0)

# The whole run: roles from the slots, least recently used out first, the
# budget per role, the report on disk.
import json as _json, os as _os, time as _time
with tempfile.TemporaryDirectory() as tmp:
    app = pathlib.Path(tmp) / "app"
    for rel in ("a", "a.w2", "b", "c"):
        r = app / "releases" / rel
        (r / ".next" / "server").mkdir(parents=True)
        (r / "server.js").write_text("")
        for i in range(5):
            stem = r / f".next/server/route-cache/APP_PAGE/h{i}/$/p{i}"
            page(stem)
            t = _time.time() - 1000 + i * 100       # p4 newest
            for ext in (".html", ".meta"):
                _os.utime(str(stem) + ext, (t, t))
    (app / "slots").mkdir()
    for slot, rel in (("blue", "a"), ("blue2", "a.w2"), ("green", "b")):
        (app / "slots" / slot).symlink_to(app / "releases" / rel)
    (app / "active").write_text("blue")
    saved = (prune.APP, prune.HEALTH, prune.BUDGET, prune.TIGHT, prune.FREE_FLOOR, prune.disk_free)
    try:
        prune.APP, prune.HEALTH = str(app), str(pathlib.Path(tmp) / "prune.json")
        prune.BUDGET = {"live": 12_000, "standby": 4_000, "old": 0}   # 3 pages, 1 page, none
        prune.FREE_FLOOR = 0
        prune.disk_free = lambda: 1000 * prune.GB     # a roomy disk, so the budgets stay as set
        prune.main()
        report = {r["release"]: r for r in _json.loads(pathlib.Path(prune.HEALTH).read_text())["releases"]}
        check("both live folders keep their 3 newest pages", report["a"]["pages"] == 3 and report["a.w2"]["pages"] == 3,
              str({k: v["pages"] for k, v in report.items()}))
        check("the standby slot keeps 1, an old release none", report["b"]["pages"] == 1 and report["c"]["pages"] == 0,
              str({k: v["pages"] for k, v in report.items()}))
        check("roles come from the slots", (report["a"]["role"], report["b"]["role"], report["c"]["role"]) == ("live", "standby", "old"))
        kept = sorted(pp.name for pp in (app / "releases" / "a").rglob("*.meta"))
        check("the least recently used went first", kept == ["p2.meta", "p3.meta", "p4.meta"], str(kept))
        check("the report records what Next really holds beside what was counted",
              all("serverGB" in r for r in report.values()))
    finally:
        prune.APP, prune.HEALTH, prune.BUDGET, prune.TIGHT, prune.FREE_FLOOR, prune.disk_free = saved

# The budgets fit the disk (Nov 5 2026): every cache at its budget leaves KEEP_FREE free.
G = prune.GB
b, f = prune.fit(prune.BUDGET, 100 * G, 10 * G, 2, 2)
check("with room to spare the budgets stay as set", b == prune.BUDGET and not f, str(b))
# Nov 5 2026 on the server: 63 GB free, the caches holding 27.7 GB, two live and two standby folders.
b, f = prune.fit(prune.BUDGET, 63 * G, int(27.7 * G), 2, 2)
at_cap = 63 * G + int(27.7 * G) - (b["live"] * 2 + b["standby"] * 2)
check("a disk that has grown shrinks the live budget", f and b["live"] < prune.BUDGET["live"], str(b))
check("every cache at its fitted budget leaves 30 GB free", abs(at_cap - prune.KEEP_FREE) < G, f"{at_cap / G:.1f} GB")
check("the standby keeps its budget while the live one can still shrink", b["standby"] == prune.BUDGET["standby"])
b, f = prune.fit(prune.BUDGET, 35 * G, 5 * G, 2, 2)
check("a disk with little room drops the standby first", b["standby"] == 0 and b["live"] >= prune.TIGHT["live"], str(b))
b, f = prune.fit(prune.BUDGET, 25 * G, 0, 2, 2)
check("the live budget never goes under the tight one", b["live"] == prune.TIGHT["live"], str(b))

# The whole run with a crowded disk records the fitted budget, which the alarm reads.
with tempfile.TemporaryDirectory() as tmp:
    app = pathlib.Path(tmp) / "app"
    for rel in ("a", "a.w2"):
        r = app / "releases" / rel
        (r / ".next" / "server").mkdir(parents=True)
        (r / "server.js").write_text("")
        for i in range(5):
            page(r / f".next/server/route-cache/APP_PAGE/h{i}/$/p{i}")
    (app / "slots").mkdir()
    for slot, rel in (("blue", "a"), ("blue2", "a.w2")):
        (app / "slots" / slot).symlink_to(app / "releases" / rel)
    (app / "active").write_text("blue")
    saved = (prune.APP, prune.HEALTH, prune.BUDGET, prune.TIGHT, prune.FREE_FLOOR, prune.KEEP_FREE, prune.disk_free)
    try:
        prune.APP, prune.HEALTH = str(app), str(pathlib.Path(tmp) / "prune.json")
        prune.BUDGET = {"live": 20_000, "standby": 4_000, "old": 0}
        prune.TIGHT = {"live": 4_000, "standby": 0, "old": 0}
        prune.FREE_FLOOR, prune.KEEP_FREE = 0, 30_000
        prune.disk_free = lambda: 18_000          # with 40,000 cached: room 28,000, 14,000 a folder
        prune.main()
        rep = _json.loads(pathlib.Path(prune.HEALTH).read_text())
        by = {r["release"]: r for r in rep["releases"]}
        check("the run fits the budgets and says so", rep["fitted"] is True and rep["keepFreeGB"] == 0, str(rep))
        check("each live folder keeps what the fitted budget allows (3 of 5 pages)",
              by["a"]["pages"] == 3 and by["a.w2"]["pages"] == 3, str({k: v["pages"] for k, v in by.items()}))
    finally:
        (prune.APP, prune.HEALTH, prune.BUDGET, prune.TIGHT, prune.FREE_FLOOR, prune.KEEP_FREE, prune.disk_free) = saved

# A deploy makes room first, and fast (Nov 13 2026). The caches at their budgets leave about KEEP_FREE free and a
# release needs about 5 GB more for a few minutes; one took the disk under the alarm's line that night. The first
# answer, fitting every budget to a wider line, walked every page of the live caches and took 13 minutes at midday,
# past the deploy's 5-minute limit. `--standby-only` drops the pages of the folders that aren't live, the slot the
# release is about to replace among them, and never opens a live folder.
with tempfile.TemporaryDirectory() as tmp:
    app = pathlib.Path(tmp) / "app"
    for rel in ("live", "live.w2", "idle", "idle.w2", "older"):
        r = app / "releases" / rel
        (r / ".next" / "server").mkdir(parents=True)
        (r / "server.js").write_text("")
        for i in range(5):
            page(r / f".next/server/route-cache/APP_PAGE/h{i}/$/p{i}")
    (app / "slots").mkdir()
    for slot, rel in (("blue", "live"), ("blue2", "live.w2"), ("green", "idle"), ("green2", "idle.w2")):
        (app / "slots" / slot).symlink_to(app / "releases" / rel)
    (app / "active").write_text("blue")
    health = pathlib.Path(tmp) / "prune.json"
    health.write_text('{"at": 1, "kept": "the last full run"}')
    walked: list[str] = []
    real_groups = prune.groups
    saved = (prune.APP, prune.HEALTH, prune.groups, sys.argv)
    try:
        prune.APP, prune.HEALTH = str(app), str(health)
        prune.groups = lambda rel: (walked.append(pathlib.Path(rel).name), real_groups(rel))[1]
        sys.argv = ["permtracker-prune", "--standby-only"]
        rc = prune.main()
        left = {rel: len(list(real_groups(str(app / "releases" / rel)))) for rel in ("live", "live.w2", "idle", "idle.w2", "older")}
        check("a standby-only run ends well", rc == 0, str(rc))
        check("it drops every page of the idle slot's two folders and of an older release",
              left["idle"] == 0 and left["idle.w2"] == 0 and left["older"] == 0, str(left))
        check("it leaves the live folders' pages alone", left["live"] == 5 and left["live.w2"] == 5, str(left))
        check("it never walks a live folder, which is what took 13 minutes",
              "live" not in walked and "live.w2" not in walked, str(walked))
        check("it leaves the last full run's report as it was (the alarm reads its headroom from that)",
              health.read_text() == '{"at": 1, "kept": "the last full run"}', health.read_text()[:80])
        # The probe: the same tree through an ordinary run walks the live folders.
        walked.clear()
        sys.argv = ["permtracker-prune", "--dry-run"]
        saved_dry, prune.DRY_RUN = prune.DRY_RUN, True
        prune.main()
        prune.DRY_RUN = saved_dry
        check("PROBE: an ordinary run does walk the live folders", "live" in walked and "live.w2" in walked, str(walked))
    finally:
        prune.APP, prune.HEALTH, prune.groups, sys.argv = saved

# The numbers hold together: with every cache at its budget KEEP_FREE is free, the idle slot's pages add their
# budget back, and a release's own use (5.3 GB measured Nov 13 2026, 10 allowed here) still leaves the disk above
# the alarm's line.
import re as _re
_low = int(_re.search(r"^DISK_LOW_GB = (\d+)$", (HERE / "bin" / "permtracker-alarm").read_text(), _re.M).group(1))
_after = (prune.KEEP_FREE + prune.BUDGET["standby"] * prune.COPIES) / prune.GB
check("the idle slot's pages give back more than a release takes", prune.BUDGET["standby"] * prune.COPIES >= 5.3 * prune.GB)
check("and a release's own 10 GB still leaves the disk above the alarm's line", _after - 10 >= _low, f"{_after:.0f} - 10 against {_low}")

# Every slot runs two copies, each in its own folder with the slot's role, so
# a folder's budget is half the slot's: two live folders must fit 60 GB.
check("the live slot's two folders share 60 GB", prune.BUDGET["live"] * 2 == 60 * prune.GB,
      str(prune.BUDGET["live"] / prune.GB))
check("the standby slot's two folders share 6 GB", prune.BUDGET["standby"] * 2 == 6 * prune.GB)

sys.exit(1 if failures else 0)

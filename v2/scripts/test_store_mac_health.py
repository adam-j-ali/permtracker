"""store_mac_health.clean keeps only the fields the morning report reads, each bounded.

The owner's Mac checks its own jobs every two hours and sends the result to the server over ssh; the morning report
reads it from perm_docs['mac_health']. Whatever the Mac sends, the stored document holds a known shape and size.
"""
import sys

import store_mac_health as smh


def check(ok: bool, msg: str, failures: list[str]) -> None:
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


def main() -> int:
    failures: list[str] = []
    raw = {
        "at": "2026-11-24T01:05:44.840502-05:00", "ok": False, "free_gb": 7.04,
        "problems": ["A job: not answering (TimeoutError)"],
        "notes": ["1 ask behind their date: G3 (Sweep the public repo, 11-23)"],
        "jobs": {"Asks": {"total": 96, "counts": {"done": 22, "open": 64, "held": 8, "dropped": 2},
                          "behind": ["G3"], "unreadable": [], "error": None},
                 "A job": {"last": "x", "detail": "kept on the Mac"}},
        "bytes": 123, "logs_trimmed": [], "notified": {"x": 1},
    }
    doc = smh.clean(raw)
    check(set(doc) == {"at", "ok", "problems", "notes", "freeGb", "asks"}, f"only the report's fields are kept ({sorted(doc)})", failures)
    check(doc["at"] == raw["at"] and doc["ok"] is False and doc["freeGb"] == 7.0, "the time, the verdict and the free space", failures)
    check(doc["problems"] == raw["problems"] and doc["notes"] == raw["notes"], "problems and notes as sent", failures)
    check(doc["asks"] == {"total": 96, "open": 64, "behind": ["G3"], "unreadable": 0, "error": None},
          f"the asks as counts and the ids behind their date ({doc['asks']})", failures)
    check("jobs" not in doc and "notified" not in doc, "each job's detail stays on the Mac", failures)

    many = smh.clean({**raw, "problems": [f"p{i} " + "x" * 900 for i in range(40)], "notes": ["n"] * 40,
                      "jobs": {"Asks": {**raw["jobs"]["Asks"], "behind": [f"A{i}" for i in range(200)]}}})
    check(len(many["problems"]) == smh.MAX_LINES and len(many["notes"]) == smh.MAX_LINES, "lines are capped in number", failures)
    check(all(len(p) <= smh.MAX_CHARS for p in many["problems"]), "and in length", failures)
    check(len(many["asks"]["behind"]) == smh.MAX_IDS, "the ids behind their date are capped", failures)

    bad = smh.clean({"at": 5, "ok": "yes", "free_gb": "lots", "problems": "one string", "notes": [1, None, "kept"],
                     "jobs": {"Asks": "unreadable"}})
    check(bad["at"] is None and bad["ok"] is False and bad["freeGb"] is None, "a wrong type reads as missing, never as ok", failures)
    check(bad["problems"] == [] and bad["notes"] == ["kept"], "only strings are lines", failures)
    check(bad["asks"] is None, "asks that aren't a record read as missing", failures)

    for junk in (None, [], "text", 3):
        try:
            smh.clean(junk)  # type: ignore[arg-type]
            check(False, f"{junk!r} is refused", failures)
        except ValueError:
            check(True, f"{junk!r} is refused", failures)

    print("ALL PASS" if not failures else f"{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

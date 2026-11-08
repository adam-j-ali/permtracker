#!/usr/bin/env python3
"""lib_audit.pace keeps the audits under Cloudflare's flood limit on the live site, and leaves local runs alone.

    python3 scripts/test_lib_audit.py
"""
from __future__ import annotations

import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import lib_audit  # noqa: E402

FAILS: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        FAILS.append(msg)


def timed(urls: list[str], threads: int = 1) -> float:
    lib_audit._next_slot = 0.0
    start = time.monotonic()
    if threads == 1:
        for u in urls:
            lib_audit.pace(u)
    else:
        workers = [threading.Thread(target=lib_audit.pace, args=(u,)) for u in urls]
        for w in workers:
            w.start()
        for w in workers:
            w.join()
    return time.monotonic() - start


rate = lib_audit.PACE_PER_SECOND
check(rate * 10 <= 250, f"{rate} a second is at most half of Cloudflare's 500 in 10 seconds")

n = 11
spent = timed([f"https://permtracker.app/p{i}" for i in range(n)])
check(spent >= (n - 1) / rate * 0.95, f"{n} requests to the live site take at least {(n - 1) / rate:.2f} s ({spent:.2f} s)")

spent = timed([f"https://permtracker.app/t{i}" for i in range(n)], threads=8)
check(spent >= (n - 1) / rate * 0.95, f"eight threads share one pace ({spent:.2f} s)")

spent = timed([f"http://127.0.0.1:3000/p{i}" for i in range(50)] + [f"http://localhost:3000/p{i}" for i in range(50)])
check(spent < 0.05, f"a local build is never paced ({spent:.3f} s for 100)")

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)

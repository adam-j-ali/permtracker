#!/usr/bin/env python3
"""The health check's record of the R2 bucket's size by day (bin/permtracker-health, bucket_history), which the
morning report turns into the day the bucket is on course to pass the free 10 GB.
Run: python3 scripts/oracle/test_health_bucket.py"""
import importlib.machinery
import importlib.util
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader("pt_health", str(HERE / "bin" / "permtracker-health"))
spec = importlib.util.spec_from_loader("pt_health", loader)
health = importlib.util.module_from_spec(spec)
loader.exec_module(health)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


print("the R2 bucket's size by day:")
with tempfile.TemporaryDirectory() as d:
    path = pathlib.Path(d) / "offsite_sizes.json"
    # Arrange: a fresh file, then three days, the last read twice
    first = health.bucket_history(path, "2026-11-20", 8_000_000_000)
    check("the first reading starts the record", first == [{"day": "2026-11-20", "bytes": 8_000_000_000}], str(first))
    health.bucket_history(path, "2026-11-21", 8_270_000_000)
    health.bucket_history(path, "2026-11-22", 8_500_000_000)
    # Act
    got = health.bucket_history(path, "2026-11-22", 8_540_000_000)
    # Assert
    check("one reading a day, the newest of the day kept",
          [r["day"] for r in got] == ["2026-11-20", "2026-11-21", "2026-11-22"] and got[-1]["bytes"] == 8_540_000_000,
          str(got))
    for i in range(30):
        health.bucket_history(path, f"2026-12-{i + 1:02d}", 9_000_000_000 + i)
    kept = health.bucket_history(path, "2026-12-31", 9_100_000_000)
    check("the record keeps the last 14 days", len(kept) == 14 and kept[-1]["day"] == "2026-12-31", str(len(kept)))
    path.write_text("not json")
    check("an unreadable record starts again rather than failing the health check",
          health.bucket_history(path, "2027-01-01", 1) == [{"day": "2027-01-01", "bytes": 1}])
    check("no size read means no record", health.bucket_history(path, "2027-01-02", None) == [], "")

print("PASS" if not failures else f"{len(failures)} FAILED")
sys.exit(1 if failures else 0)

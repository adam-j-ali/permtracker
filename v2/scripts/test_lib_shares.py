"""The data scripts' denial rate: the same division the site prints (convex/lib/approval.ts), to two decimals."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_shares import denial_rate_pct  # noqa: E402


def test_divides_by_decisions_to_two_decimals() -> None:
    assert denial_rate_pct(10, 910) == 1.1
    assert denial_rate_pct(1, 3) == 33.33
    assert denial_rate_pct(0, 5) == 0.0


def test_no_rate_when_nothing_was_decided() -> None:
    assert denial_rate_pct(0, 0) is None
    assert denial_rate_pct(3, -1) is None


def test_rounds_as_the_scripts_did_by_hand() -> None:
    # 7 of 1,234 is 0.567%; 123 of 456,789 is 0.0269%; one of one is all of it.
    for denied, decided, pct in [(7, 1234, 0.57), (1, 1, 100.0), (999, 1000, 99.9), (123, 456789, 0.03)]:
        assert denial_rate_pct(denied, decided) == pct


def main() -> int:
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except Exception as e:  # a crash is a failure too
                failed += 1
                print(f"FAIL {name}: {e!r}")
    print("ok" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

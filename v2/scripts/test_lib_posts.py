"""The consulate reader (scripts/lib_posts.py): a post written any way, as the site's key or none.

Run: python3 scripts/test_lib_posts.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib_posts import known_posts, post_key, post_slug  # noqa: E402


def main() -> int:
    failures = 0

    def check(got, want, what: str) -> None:
        nonlocal failures
        ok = got == want
        print(("  ok   " if ok else "  FAIL ") + f"{what}: {got!r}" + ("" if ok else f" (want {want!r})"))
        failures += not ok

    check(len(known_posts()) >= 140, True, "the site's list of posts is read")
    check(post_slug("Ciudad Juárez (Mexico)"), "ciudad-juarez", "the same slug the site makes")
    for text, want in (("Mumbai", "mumbai"), ("U.S. Consulate Mumbai, India", "mumbai"), ("Ciudad Juarez", "ciudad-juarez"),
                       ("Cuidad Juarez", "ciudad-juarez"), ("Ciudad Juárez", "ciudad-juarez"), ("London", "london"),
                       ("US Embassy Abu Dhabi", "abu-dhabi"), ("Ho Chi Minh City", "ho-chi-minh-city"),
                       ("Bombay", "mumbai")):
        check(post_key(text), want, text)
    for text in ("", None, "Undisclosed", "India", "N/A", "Atlantis"):
        check(post_key(text), None, f"can't be told: {text!r}")
    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

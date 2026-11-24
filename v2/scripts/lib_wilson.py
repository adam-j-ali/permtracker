"""The one Wilson score interval for a share, for the data scripts.

The Python half of convex/lib/wilson.ts: the same z, the same arithmetic in the same order, the same answers. Both are
held to scripts/data/wilson_cases.json (test_lib_wilson.py here, convex/lib/wilson.test.ts there), and a copy kept
outside this repository can test against that file too.

Wilson rather than the textbook plus-or-minus: shares near zero with small counts are where the plain interval goes
below zero. Wilson stays inside 0 to 100.
"""
from __future__ import annotations

import math

# The 95% two-sided z. Every interval on the site is made with this one.
Z_95 = 1.96


def wilson_interval(k: float, n: float) -> tuple[float, float] | None:
    """The 95% Wilson interval on k of n, in percent, as (low, high). k and n may be weighted counts.

    None when there's nothing to bound: n zero or less, k below zero or above n, or either not a finite number.
    """
    if not (math.isfinite(k) and math.isfinite(n)) or n <= 0 or k < 0 or k > n:
        return None
    z = Z_95
    p = k / n
    denom = 1 + (z * z) / n
    centre = (p + (z * z) / (2 * n)) / denom
    half = (z * math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
    # Each bound is held to its side of the share: rounding alone left 100 of 100's upper bound at 99.99999999999999.
    return (max(0.0, min(p * 100, (centre - half) * 100)), min(100.0, max(p * 100, (centre + half) * 100)))

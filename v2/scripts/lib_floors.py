"""The floors and the margin rule for new figures, for the data scripts.

The Python half of src/lib/floors.ts: both read scripts/data/floors.json and are held to
scripts/data/floor_cases.json. A floor that guards a figure readers already see keeps its own value where it is,
because raising one would hide that figure.
"""
from __future__ import annotations

import json
import math
import pathlib

from lib_wilson import wilson_interval

_TABLE = json.loads((pathlib.Path(__file__).resolve().parent / "data" / "floors.json").read_text())
FLOORS: dict = _TABLE["floors"]


def meets_floor(family: str, n: float) -> bool:
    """Whether n cases (a weighted count is fine) are enough for a figure of this family."""
    return math.isfinite(n) and n >= FLOORS[family]["min"]


def too_few_words(family: str, n: float, unit: str) -> str:
    """What a page shows instead of a figure below its floor. unit names what was counted: "I-140 receipts"."""
    have = math.floor(n) if math.isfinite(n) and n > 0 else 0
    return (FLOORS[family]["words"].replace("{unit}", unit, 1)
            .replace("{n}", f"{have:,}", 1).replace("{min}", f"{FLOORS[family]['min']:,}", 1))


def margin_points(k: float, n: float) -> float | None:
    """The margin on k of n, in percentage points, rounded up to a tenth; None when there's nothing to bound."""
    ci = wilson_interval(k, n)
    if ci is None:
        return None
    pct = (k / n) * 100
    return math.ceil(max(pct - ci[0], ci[1] - pct) * 10 - 1e-9) / 10


def margin_words(points: float) -> str:
    """A margin in words: "give or take 2.2 points"."""
    return _TABLE["margin"]["words"].replace("{points}", f"{points:g}", 1)


def sample_share(k: float, n: float, unit: str) -> dict:
    """A share from a sample with its 95% range and margin, or the words a page shows instead below the share floor."""
    ci = wilson_interval(k, n) if meets_floor("share", n) else None
    margin = margin_points(k, n) if ci else None
    if ci is None or margin is None:
        return {"shown": False, "words": too_few_words("share", n, unit)}
    return {"shown": True, "pct": (k / n) * 100, "lo": ci[0], "hi": ci[1], "margin": margin}

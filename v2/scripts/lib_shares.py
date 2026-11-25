"""The approval and denial rate over decisions, one rule for the data scripts (D4, Nov 25 2026).

The site's copy is convex/lib/approval.ts. Over DECISIONS: denied / (certified + denied); a withdrawal is on neither
side. A page's floor (how many decisions it needs before printing a rate) stays with the page.
"""

from __future__ import annotations


def denial_rate_pct(denied: int, decided: int) -> float | None:
    """denied / decided as a percent to two decimals, decided being certified plus denied; None when nothing was decided."""
    if not decided or decided <= 0:
        return None
    return round(denied / decided * 100, 2)

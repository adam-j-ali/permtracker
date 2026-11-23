/**
 * The one Wilson score interval for a share, used by every page, component and Convex function.
 *
 * Pure: no React, no Convex and no "use client", so a server component, a client chart and a Convex function can all
 * import it. A copy kept in a "use client" file is a client reference on the server, which once made every wage band
 * read "withheld" with no error, so nothing keeps its own copy any more. The Python half is scripts/lib_wilson.py, and
 * both are held to scripts/data/wilson_cases.json.
 *
 * Wilson rather than the textbook plus-or-minus: the shares here sit near zero with small counts, where the plain
 * interval goes below zero and says a three-case record is known to be spotless. Wilson stays inside 0 to 100.
 */

/** The 95% two-sided z. Every interval on the site is made with this one. */
export const Z_95 = 1.96;

export interface Interval {
  /** Lower bound, in percent. */
  lo: number;
  /** Upper bound, in percent. */
  hi: number;
}

/**
 * The 95% Wilson interval on `k` of `n`, in percent. `k` and `n` may be weighted counts, so fractions are fine.
 * Null when there's nothing to bound: `n` zero or less, `k` below zero or above `n`, or either not a finite number.
 */
export function wilsonInterval(k: number, n: number): Interval | null {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0 || k > n) return null;
  const z = Z_95;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  // Each bound is held to its side of the share: rounding alone left 100 of 100's upper bound at 99.99999999999999.
  return {
    lo: Math.max(0, Math.min(p * 100, (centre - half) * 100)),
    hi: Math.min(100, Math.max(p * 100, (centre + half) * 100)),
  };
}

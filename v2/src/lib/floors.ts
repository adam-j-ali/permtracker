/**
 * The floors and the margin rule for new figures: the USCIS receipt sample's, and any figure added after Nov 23 2026.
 *
 * The numbers and the words a page shows instead live once, in scripts/data/floors.json, which the data scripts read
 * too (scripts/lib_floors.py); both halves are held to scripts/data/floor_cases.json. A floor that guards a figure
 * readers already see keeps its own value where it is, because raising one would hide that figure.
 *
 * Every measured share prints its margin: the wider side of its 95% Wilson interval (convex/lib/wilson.ts), in
 * percentage points, rounded up to a tenth so it's never smaller than the truth.
 */
import table from "../../scripts/data/floors.json";
import { wilsonInterval } from "@convex/lib/wilson";
import { formatInt } from "@/lib/format";

export const FLOORS = table.floors;
export type FloorFamily = keyof typeof FLOORS;

/** Whether `n` cases are enough for a figure of this family. `n` may be a weighted count. */
export function meetsFloor(family: FloorFamily, n: number): boolean {
  return Number.isFinite(n) && n >= FLOORS[family].min;
}

/** What a page shows instead of a figure below its floor. `unit` names what was counted: "I-140 receipts". */
export function tooFewWords(family: FloorFamily, n: number, unit: string): string {
  const have = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return FLOORS[family].words
    .replace("{unit}", unit)
    .replace("{n}", formatInt(have))
    .replace("{min}", formatInt(FLOORS[family].min));
}

/** The margin on `k` of `n`, in percentage points, rounded up to a tenth; null when there's nothing to bound. */
export function marginPoints(k: number, n: number): number | null {
  const ci = wilsonInterval(k, n);
  if (!ci) return null;
  const pct = (k / n) * 100;
  return Math.ceil(Math.max(pct - ci.lo, ci.hi - pct) * 10 - 1e-9) / 10;
}

/** A margin in words: "give or take 2.2 points". */
export function marginWords(points: number): string {
  return table.margin.words.replace("{points}", String(points));
}

export type SampleShare =
  | { shown: true; pct: number; lo: number; hi: number; margin: number }
  | { shown: false; words: string };

/**
 * A share from a sample, with its 95% range and its margin, or the words a page shows instead when fewer than the
 * share floor were checked. `k` and `n` may be weighted counts.
 */
export function sampleShare(k: number, n: number, unit: string): SampleShare {
  const ci = meetsFloor("share", n) ? wilsonInterval(k, n) : null;
  const margin = ci ? marginPoints(k, n) : null;
  if (!ci || margin === null) return { shown: false, words: tooFewWords("share", n, unit) };
  return { shown: true, pct: (k / n) * 100, lo: ci.lo, hi: ci.hi, margin };
}

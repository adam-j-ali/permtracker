/**
 * The rules behind an entity page's state map (`EntityStateMap`): which states it draws, whether it may be drawn
 * at all, and the four steps its counts are shaded in. Pure, so the server builds the map's rows and the tests pin
 * the rules.
 */
import { formatInt } from "@/lib/format";
import type { FacetRow } from "@/lib/db/entityDetail";

/** One state on the map. `href` and `linkText` lead on from it; `extra` is one more line for its readout. */
export interface MapState {
  /** DOL's two-letter code: a state, DC or a territory. */
  state: string;
  n: number;
  certified: number;
  denied: number;
  href?: string;
  linkText?: string;
  extra?: string;
}

/** One span of years the map can show, with its own total for the shares. */
export interface MapEra {
  id: string;
  /** "since FY2024", "in FY2008 to FY2023": read after a count. */
  label: string;
  /** The span as a choice: "Since FY2024", "FY2008 to FY2023". */
  choice: string;
  total: number;
  states: MapState[];
}

/** A facet's state rows as map rows: real two-letter codes with filings, as numbers, busiest first. */
export function mapStates(rows: readonly FacetRow[]): MapState[] {
  return rows
    .filter((r): r is FacetRow & { key: string } => typeof r.key === "string" && /^[A-Z]{2}$/.test(r.key))
    .map((r) => ({ state: r.key, n: Number(r.n) || 0, certified: Number(r.certified) || 0, denied: Number(r.denied) || 0 }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.state.localeCompare(b.state));
}

/**
 * Whether a page draws its state map: two or more states, AND a facet the nightly build has marked as holding
 * every state. Until that build has run, a facet holds the busiest six, and a map would show the rest as zeros.
 * One state is already answered by the header's main worksite.
 */
export function canDrawStateMap(states: readonly MapState[], complete: boolean): boolean {
  return complete && states.length >= 2;
}

/**
 * The lowest count in steps 1, 2 and 3 (step 0 starts at 1): thirds of thirds of the busiest state's count, so a
 * long tail spreads over the scale and one state with most of the filings doesn't wash the rest out. Kept whole
 * and distinct when the counts are small.
 */
export function stepBreaks(max: number): [number, number, number] {
  const b1 = Math.max(2, Math.ceil(max / 27));
  const b2 = Math.max(b1 + 1, Math.ceil(max / 9));
  const b3 = Math.max(b2 + 1, Math.ceil(max / 3));
  return [b1, b2, b3];
}

/** The step, 0 to 3, a count is shaded in. */
export function stepOf(n: number, breaks: readonly number[]): number {
  return breaks.filter((b) => n >= b).length;
}

/** The legend: each step that a count up to `max` can reach, with the counts it holds. */
export function legendSteps(max: number): { step: number; text: string }[] {
  const [b1, b2, b3] = stepBreaks(max);
  const spans: [number, number][] = [[1, b1 - 1], [b1, b2 - 1], [b2, b3 - 1], [b3, max]];
  return spans
    .map(([lo, hi], step) => ({ step, lo, hi: Math.min(hi, max) }))
    .filter((s) => s.lo <= s.hi)
    .map(({ step, lo, hi }) => ({ step, text: lo === hi ? formatInt(lo) : `${formatInt(lo)} to ${formatInt(hi)}` }));
}

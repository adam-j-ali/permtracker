/**
 * The law firm rankings as the pages read them: which fiscal year to show, how a
 * firm's row reads, and which places have a ranking. Plain module: the pages and
 * the tests read it. The builder is `scripts/build_firm_ranks.py`, the reader
 * `src/lib/db/firmRanks.ts`. Statistics only, firms only: a firm's volume,
 * outcomes and pace, never a grade.
 */

import { approvedShareOfDecisions } from "@convex/lib/approval";
import { formatInt } from "@/lib/format";
import { US_STATE_NAMES } from "@/lib/usStateNames";

export type FirmProgram = "perm" | "lca";

export interface FirmRankRow {
  slug: string;
  linked: boolean;
  name: string;
  rank: number;
  prevRank: number | null;
  filings: number;
  certified: number;
  denied: number;
  withdrawn: number;
  positions: number;
  employers: number;
  medianDays: number | null;
}

export interface FirmPlaceTotals {
  filings: number;
  firms: number;
  top10: number;
  unnamed: number;
}

export interface FirmRanksSummary {
  programs: Record<FirmProgram, { years: Record<string, { through: string | null; places: Record<string, FirmPlaceTotals> }> }>;
}

export const NATION = "US";

/** The newest fiscal year whose decisions run to its last day (Sep 30), else the newest held. */
export function shownYear(summary: FirmRanksSummary, program: FirmProgram): number | null {
  const years = Object.entries(summary.programs[program]?.years ?? {})
    .map(([fy, y]) => ({ fy: Number(fy), through: y.through }))
    .filter((y) => Number.isFinite(y.fy))
    .sort((a, b) => b.fy - a.fy);
  if (years.length === 0) return null;
  // A year is finished once a decision dated in its last week is held (DOL's files run to Sep 30).
  const done = years.find((y) => y.through !== null && y.through >= `${y.fy}-09-24`);
  return (done ?? years[0]!).fy;
}

/**
 * The first fiscal year a program ranks any firm in, or null. What the page says its rankings reach back to: a year
 * whose file names no firm (PERM's before FY2015, the H-1B files' before FY2019) ranks nobody and isn't claimed,
 * even when the builder wrote it a place with its unnamed filings and no firms.
 */
export function firstRankedYear(summary: FirmRanksSummary, program: FirmProgram): number | null {
  const years = Object.entries(summary.programs[program]?.years ?? {})
    .filter(([, y]) => Object.values(y.places ?? {}).some((p) => (p?.firms ?? 0) > 0))
    .map(([fy]) => Number(fy))
    .filter((fy) => Number.isFinite(fy));
  return years.length ? Math.min(...years) : null;
}

/** The places with a ranking in a program-year, the country first, then states by name order of their codes. */
export function rankedPlaces(summary: FirmRanksSummary, program: FirmProgram, fy: number): string[] {
  const places = Object.keys(summary.programs[program]?.years?.[String(fy)]?.places ?? {});
  return places.sort((a, b) => (a === NATION ? -1 : b === NATION ? 1 : a.localeCompare(b)));
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/**
 * Where a firm stood the year before, among every firm with filings there that
 * year (so it can be past 100): "1st the year before", "no filings the year before".
 */
export function lastYearWords(prev: number | null): string {
  return prev === null ? "no filings the year before" : `${ordinal(prev)} the year before`;
}

/** The share of decided cases certified, or null with none decided. Withdrawals aren't decisions on the merits. */
export function certifiedShare(r: Pick<FirmRankRow, "certified" | "denied">): number | null {
  return approvedShareOfDecisions(r.certified, r.denied);
}

/** Rows drawn as bars; the rest of the 100 fold into a table. */
export const BARS_SHOWN = 25;

interface ProgramLead {
  fy: number | null;
  top: Pick<FirmRankRow, "name" | "filings"> | null;
}

/**
 * The rankings page's answer line, under its title: the busiest firm for each program in the place shown, with its
 * count. One firm leading both is named once; each program names its own year where the two differ. Null with no
 * ranking held for either.
 */
export function firmRanksAnswer(state: string, perm: ProgramLead, lca: ProgramLead): string | null {
  const where = state === NATION ? "across the country" : `for jobs in ${US_STATE_NAMES[state] ?? state}`;
  const p = perm.fy !== null && perm.top ? { fy: perm.fy, ...perm.top } : null;
  const l = lca.fy !== null && lca.top ? { fy: lca.fy, ...lca.top } : null;
  const n = (x: number) => formatInt(x);
  if (p && l && p.name === l.name && p.fy === l.fy) {
    return `In FY${p.fy}, ${p.name} filed the most PERM cases ${where} (${n(p.filings)}), and the most certified H-1B LCAs (${n(l.filings)}).`;
  }
  const parts: string[] = [];
  if (p) parts.push(`In FY${p.fy}, ${p.name} filed the most PERM cases ${where} (${n(p.filings)}).`);
  if (l) {
    const lead = p && p.fy === l.fy ? "" : `In FY${l.fy}, `;
    const tail = p ? "" : ` ${where}`;
    parts.push(`${lead}${l.name} filed the most certified H-1B LCAs${tail} (${n(l.filings)}).`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** The newest decision day either program's shown year holds: the page's date. */
export function firmRanksAsOf(summary: FirmRanksSummary | null | undefined): string | null {
  if (!summary) return null;
  let newest: string | null = null;
  for (const program of ["perm", "lca"] as const) {
    const fy = shownYear(summary, program);
    const through = fy === null ? null : (summary.programs[program]?.years?.[String(fy)]?.through ?? null);
    if (through && (!newest || through > newest)) newest = through;
  }
  return newest;
}

/** Every state with a ranking in either program's shown year (a page exists for each), by code. */
export function rankedStates(summary: FirmRanksSummary): string[] {
  const out = new Set<string>();
  for (const program of ["perm", "lca"] as const) {
    const fy = shownYear(summary, program);
    if (fy === null) continue;
    for (const p of rankedPlaces(summary, program, fy)) if (p !== NATION) out.add(p);
  }
  return [...out].sort();
}

/**
 * How a place's filings split: the ten busiest firms, every other firm, and
 * those naming no firm (the employer filed it). The parts add to every filing.
 */
export function filingSplit(t: FirmPlaceTotals): { top10: number; others: number; unnamed: number; all: number } {
  return { top10: t.top10, others: t.filings - t.top10, unnamed: t.unnamed, all: t.filings + t.unnamed };
}

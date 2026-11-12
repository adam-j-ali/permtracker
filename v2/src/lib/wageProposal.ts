/**
 * DOL's proposal to raise the four prevailing wage levels, read against the levels DOL publishes today.
 *
 * THE PROPOSAL (91 FR 15454, Mar 27 2026, RIN 1205-AC30; the final rule went to the White House for review on Nov 6
 * 2026 and its numbers aren't public): each level moves up the OEWS pay distribution.
 *
 *   Level I    about the 17th percentile  ->  the 34th
 *   Level II   about the 34th             ->  the 52nd
 *   Level III  about the 50th             ->  the 70th
 *   Level IV   about the 67th             ->  the 88th
 *
 * WHAT CAN BE SAID FROM TODAY'S FOUR FIGURES, AND NO MORE.
 * - The proposed Level I (34th) sits about where today's Level II does, so today's Level II is "about" the new I.
 * - The proposed II (52nd) is just above today's III (50th), and the proposed III (70th) just above today's IV
 *   (67th): each is "above" that figure, by an amount today's tables don't give.
 * - The proposed IV (88th) is above anything DOL publishes: it stays unknown.
 *
 * "ABOUT", NEVER "IS". Today's II and III aren't measured percentiles: DOL sets I and IV from the survey and spaces
 * II and III evenly between them (every row of its table shows it). So the new I is near today's II, not equal to
 * it. Nothing here is a wage anyone must pay: the levels in force are today's until a final rule takes effect.
 */

export type LevelName = "I" | "II" | "III" | "IV";

export interface LevelWage {
  level: LevelName;
  hourly: number;
  yearly: number;
}

/** The percentile each level stands for, today (approximately) and under the proposal. */
export const LEVEL_PERCENTILES: Readonly<Record<LevelName, { today: number; proposed: number }>> = {
  I: { today: 17, proposed: 34 },
  II: { today: 34, proposed: 52 },
  III: { today: 50, proposed: 70 },
  IV: { today: 67, proposed: 88 },
};

/** Where the proposal and its status are read from, for the page's own source line. */
export const WAGE_PROPOSAL = {
  rin: "1205-AC30",
  citation: "91 FR 15454",
  proposedOn: "2026-03-27",
  url: "https://www.federalregister.gov/documents/2026/03/27/2026-06017/improving-wage-protections-for-the-temporary-and-permanent-employment-of-certain-foreign-nationals",
} as const;

export interface ProposedFloor {
  level: LevelName;
  today: LevelWage;
  /**
   * What today's figures say about the level under the proposal: "about" a figure, "above" one, or nothing
   * ("unknown": the 88th percentile isn't published).
   */
  proposed: { kind: "about" | "above"; yearly: number; hourly: number; like: LevelName } | { kind: "unknown" };
  /** Whole percent from today's figure to the proposed one. A floor for "above". Null when unknown. */
  risePct: number | null;
}

const NEXT: Readonly<Record<LevelName, LevelName | null>> = { I: "II", II: "III", III: "IV", IV: null };

/**
 * Each level's floor today and what today's figures say it would be under the proposal. Null unless all four
 * levels are there with a positive wage and in rising order: a table missing a level can't be read across.
 */
export function proposedFloors(levels: readonly LevelWage[]): ProposedFloor[] | null {
  const by = new Map(levels.map((l) => [l.level, l]));
  const order: LevelName[] = ["I", "II", "III", "IV"];
  const four = order.map((n) => by.get(n));
  if (four.some((l) => !l || !(l.yearly > 0) || !(l.hourly > 0))) return null;
  const rows = four as LevelWage[];
  for (let i = 1; i < rows.length; i++) if (rows[i]!.yearly < rows[i - 1]!.yearly) return null;
  return rows.map((today) => {
    const like = NEXT[today.level];
    const next = like ? by.get(like)! : null;
    if (!like || !next) return { level: today.level, today, proposed: { kind: "unknown" as const }, risePct: null };
    return {
      level: today.level,
      today,
      proposed: { kind: today.level === "I" ? ("about" as const) : ("above" as const), yearly: next.yearly, hourly: next.hourly, like },
      risePct: Math.round(((next.yearly - today.yearly) / today.yearly) * 100),
    };
  });
}

/**
 * A program's DOL disclosure files can sit in two tables: the newer files, and the older ones in a table of their
 * own (the LCA's FY2008 to FY2019, `lca_cases_history`). Each table's load writes its own summary document; a page
 * that counts the program reads both as one, or it prints a third of the record (Nov 20 2026: the homepage said
 * 3,754,961 LCAs while the older files held 5,839,865 more).
 */
export interface DisclosureSummary {
  rows: number;
  earliestReceived: string | null;
  latestDecision: string | null;
  files: Record<string, number>;
  computedAt: number;
}

const earlier = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** Both tables' summaries as one: rows summed, the widest dates, every file; either alone when the other is missing. */
export function mergeDisclosureSummaries<T extends DisclosureSummary>(newer: T | null, older: T | null): T | null {
  if (!newer) return older;
  if (!older) return newer;
  return {
    ...newer,
    rows: newer.rows + older.rows,
    earliestReceived: earlier(newer.earliestReceived, older.earliestReceived),
    latestDecision: later(newer.latestDecision, older.latestDecision),
    files: { ...older.files, ...newer.files },
    computedAt: Math.max(newer.computedAt, older.computedAt),
  };
}

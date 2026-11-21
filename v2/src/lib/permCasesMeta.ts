/**
 * /perm-cases' coverage figures with DOL's FY2008 to FY2023 decisions added.
 *
 * The list there reads both PERM tables (src/lib/db/cases.ts), so every count beside it (the headline total, the
 * fiscal-year list, the outcome counts and the state counts) adds the older table's, from the record the history
 * load writes (perm_docs['perm_history_years'], scripts/ingest_perm_history.py), never a count over that table.
 * Plain module: the page merges, the browser reads the result, and the test needs no database.
 */

export type Outcome = "certified" | "denied" | "withdrawn";

export interface OutcomeCounts {
  total: number;
  certified: number;
  denied: number;
  withdrawn: number;
}

export interface PermCasesMeta {
  sourceFiles: string[];
  totalCases: number;
  firstDecisionDate: string;
  lastDecisionDate: string;
  firstReceivedDate: string;
  lastReceivedDate: string;
  byStatus: { status: Outcome; count: number }[];
  byFiscalYear: ({ fiscalYear: string } & OutcomeCounts)[];
  byState: ({ state: string } & OutcomeCounts)[];
  computedAt: number;
}

/** The older table's record: each fiscal year's and each worksite state's decisions by outcome, and its first day. */
export interface OlderYears {
  years: ({ fiscalYear: string } & OutcomeCounts)[];
  byState: ({ state: string } & OutcomeCounts)[];
  from: string | null;
}

export type MergedPermCasesMeta<M extends PermCasesMeta = PermCasesMeta> = M & {
  /** False until the older table's record is built: the counts are then the current files' alone. */
  olderYearsCounted: boolean;
};

function add(a: OutcomeCounts, b: OutcomeCounts): OutcomeCounts {
  return {
    total: a.total + b.total,
    certified: a.certified + b.certified,
    denied: a.denied + b.denied,
    withdrawn: a.withdrawn + b.withdrawn,
  };
}

/** Rows keyed by `key`, the two lists' counts added where both hold one. */
function sumBy<K extends string, R extends Record<K, string> & OutcomeCounts>(key: K, a: readonly R[], b: readonly R[]): R[] {
  const by = new Map<string, R>();
  for (const r of [...a, ...b]) {
    const have = by.get(r[key]);
    by.set(r[key], have ? ({ ...have, ...add(have, r) } as R) : { ...r });
  }
  return [...by.values()];
}

export function mergeOlderYears<M extends PermCasesMeta>(meta: M, older: OlderYears | null): MergedPermCasesMeta<M> {
  if (!older) return { ...meta, olderYearsCounted: false };
  const extra = older.years.reduce(
    (acc, y) => add(acc, y),
    { total: 0, certified: 0, denied: 0, withdrawn: 0 },
  );
  return {
    ...meta,
    totalCases: meta.totalCases + extra.total,
    firstDecisionDate: older.from && older.from < meta.firstDecisionDate ? older.from : meta.firstDecisionDate,
    byStatus: meta.byStatus.map((s) => ({ status: s.status, count: s.count + extra[s.status] })),
    // Newest year first, as the current files' list is.
    byFiscalYear: sumBy("fiscalYear", meta.byFiscalYear, older.years).sort((x, y) => Number(y.fiscalYear) - Number(x.fiscalYear)),
    byState: sumBy("state", meta.byState, older.byState).sort(
      (x, y) => y.total - x.total || (x.state < y.state ? -1 : x.state > y.state ? 1 : 0),
    ),
    olderYearsCounted: true,
  };
}

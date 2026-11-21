/**
 * What one employer's H-1B LCAs say about the jobs behind them: the pure half.
 *
 * DOL's LCA disclosure file carries four things per filing that a count of
 * filings hides (record layout, LCA_Record_Layout_FY2026_Q3):
 *
 * - **Who the positions are for** (Form ETA-9035 Section B, Items 7a to 7f):
 *   how many of the requested workers start new employment, continue with the
 *   same employer, or move here from another employer. Positions on a
 *   certified LCA, not people hired: an LCA is certified before any petition,
 *   and many are never used.
 * - **The wage level** (Section F.a Item 13a), filled only when the employer
 *   set the wage from the OES survey itself, so its blank share is part of the
 *   answer and is always printed beside it.
 * - **Two declarations** (Section H.a Items 1 and 2): whether the employer is
 *   H-1B-dependent and whether it has been found a willful violator. Both are
 *   the employer's own answer on the form, newest filing first.
 * - **The visa** each LCA supports: H-1B, E-3 (Australia) or H-1B1 (Chile,
 *   Singapore), as DOL spells them.
 *
 * Nothing here is estimated. A figure the file did not carry stays null and
 * the panel says so rather than printing a zero.
 */

export type LcaKindKey =
  | "newEmployment"
  | "changeEmployer"
  | "continuedEmployment"
  | "changePreviousEmployment"
  | "newConcurrentEmployment"
  | "amendedPetition";

export interface LcaKind {
  key: LcaKindKey;
  /** The form's item, so a reader can find it on the ETA-9035. */
  item: string;
  label: string;
  /** DOL's own description, shortened only where it repeats itself. */
  meaning: string;
}

/**
 * The six boxes of Section B Item 7, in the form's order except that the two
 * a reader compares ("new hires vs transfers") come first.
 */
export const LCA_KINDS: readonly LcaKind[] = [
  { key: "newEmployment", item: "7a", label: "New employment", meaning: "Starting with a new employer." },
  {
    key: "changeEmployer",
    item: "7e",
    label: "Change of employer",
    meaning: "Moving here from another employer, keeping the visa classification already held.",
  },
  { key: "continuedEmployment", item: "7b", label: "Continuing", meaning: "Staying with the same employer." },
  {
    key: "changePreviousEmployment",
    item: "7c",
    label: "Change in previous employment",
    meaning: "Same employer, no material change to the job duties.",
  },
  {
    key: "newConcurrentEmployment",
    item: "7d",
    label: "Concurrent employment",
    meaning: "Adding this employer while keeping another.",
  },
  {
    key: "amendedPetition",
    item: "7f",
    label: "Amended petition",
    meaning: "Same employer, with a material change to the job duties.",
  },
];

export const WAGE_LEVELS = ["I", "II", "III", "IV"] as const;
export type WageLevel = (typeof WAGE_LEVELS)[number];

/** DOL's spellings in the VISA_CLASS column, and how the page names them. */
export const LCA_VISAS: readonly { key: "h1b" | "e3" | "h1b1Chile" | "h1b1Singapore"; dol: string; label: string }[] = [
  { key: "h1b", dol: "H-1B", label: "H-1B" },
  { key: "e3", dol: "E-3 Australian", label: "E-3 (Australia)" },
  { key: "h1b1Chile", dol: "H-1B1 Chile", label: "H-1B1 (Chile)" },
  { key: "h1b1Singapore", dol: "H-1B1 Singapore", label: "H-1B1 (Singapore)" },
];

/** One aggregate row, as the read layer's SQL names it. libSQL may return numbers as strings. */
export interface LcaProfileRow {
  filings: number | string | null;
  detail_rows: number | string | null;
  positions: number | string | null;
  new_employment: number | string | null;
  change_employer: number | string | null;
  continued_employment: number | string | null;
  change_previous_employment: number | string | null;
  new_concurrent_employment: number | string | null;
  amended_petition: number | string | null;
  level_1: number | string | null;
  level_2: number | string | null;
  level_3: number | string | null;
  level_4: number | string | null;
  level_blank: number | string | null;
  dependent_rows: number | string | null;
  dependent_yes: number | string | null;
  violator_rows: number | string | null;
  violator_yes: number | string | null;
  visa_h1b: number | string | null;
  visa_e3: number | string | null;
  visa_h1b1_chile: number | string | null;
  visa_h1b1_singapore: number | string | null;
  /** The first fiscal year among the employer's LCAs. */
  fy_from?: number | string | null;
}

/**
 * The same figures over DOL's FY2008 to FY2019 files, counted at their load (scripts/lca_history_totals.py). Those
 * files print the worker breakdown and the OES level in some years only, so the level comes with its own
 * denominator: `level_rows`, the certified LCAs in the years that name a level at all. (`level_blank` is the newer
 * files' own count, among the rows the detail backfill reached.)
 */
export type LcaOlderRow = Partial<Omit<LcaProfileRow, "level_blank">> & {
  level_rows?: number | string | null;
  certified?: number | string | null;
};

/** A figure both rows carry: every column but the newer files' own `level_blank`. */
type SharedColumn = Exclude<keyof LcaProfileRow, "level_blank">;

/** The newest filing that answered Section H, if any did. */
export interface LcaNewestRow {
  h1b_dependent: number | string | null;
  willful_violator: number | string | null;
  filed: string | null;
}

export interface LcaProfile {
  /** Every LCA held for the employer, any status. */
  filings: number;
  /** Certified LCAs that carry the Section B breakdown. Zero until the backfill reaches them. */
  detailRows: number;
  /** Worker positions requested on those LCAs (Item 7). */
  positions: number;
  kinds: { kind: LcaKind; n: number }[];
  levels: { level: WageLevel; n: number }[];
  /** Certified LCAs with the breakdown but no OES level: the wage came from another source. */
  levelBlank: number;
  /** Certified LCAs a level could be read on: the newer files' breakdown rows, the older files' rows in years that name a level. */
  levelRows: number;
  /** The first fiscal year the figures reach, or null when no read named one. */
  fyFrom: number | null;
  /** Of `filings`, the LCAs from DOL's FY2008 to FY2019 files. */
  olderFilings: number;
  dependent: { yes: number; of: number };
  violator: { yes: number; of: number };
  /** The newest filing's two answers, or null when no filing answered. */
  newest: { dependent: boolean | null; violator: boolean | null; filed: string | null } | null;
  visas: { key: string; label: string; n: number }[];
  /** Filings under a visa class this module doesn't name (kept so the visa line still adds up). */
  otherVisa: number;
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function flag(v: number | string | null | undefined): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return n === 1 ? true : n === 0 ? false : null;
}

const KIND_COLUMN: Record<LcaKindKey, SharedColumn> = {
  newEmployment: "new_employment",
  changeEmployer: "change_employer",
  continuedEmployment: "continued_employment",
  changePreviousEmployment: "change_previous_employment",
  newConcurrentEmployment: "new_concurrent_employment",
  amendedPetition: "amended_petition",
};

const LEVEL_COLUMN: Record<WageLevel, SharedColumn> = {
  I: "level_1",
  II: "level_2",
  III: "level_3",
  IV: "level_4",
};

const VISA_COLUMN: Record<(typeof LCA_VISAS)[number]["key"], SharedColumn> = {
  h1b: "visa_h1b",
  e3: "visa_e3",
  h1b1Chile: "visa_h1b1_chile",
  h1b1Singapore: "visa_h1b1_singapore",
};

/** A fiscal year, or null for none. */
function fy(v: number | string | null | undefined): number | null {
  const n = num(v);
  return n > 0 ? n : null;
}

/**
 * Turn the read layer's rows into the panel's figures: the newer files' aggregate, the newest filing that answered
 * Section H, and DOL's older files' aggregate when they hold any. Null when the employer has no LCA at all.
 */
export function shapeLcaProfile(
  row: LcaProfileRow | null,
  newest: LcaNewestRow | null,
  older: LcaOlderRow | null = null,
): LcaProfile | null {
  const both = (col: SharedColumn) => num(row?.[col]) + num(older?.[col]);
  const filings = both("filings");
  if (filings === 0) return null;
  const visas = LCA_VISAS.map((v) => ({ key: v.key, label: v.label, n: both(VISA_COLUMN[v.key]) }));
  const named = visas.reduce((s, v) => s + v.n, 0);
  const n = newest
    ? { dependent: flag(newest.h1b_dependent), violator: flag(newest.willful_violator), filed: newest.filed ?? null }
    : null;
  const levels = WAGE_LEVELS.map((level) => ({ level, n: both(LEVEL_COLUMN[level]) }));
  // The older files' blank level: their certified LCAs in the years that name one, less the ones that did.
  const olderLevelRows = num(older?.level_rows);
  const olderNamed = WAGE_LEVELS.reduce((s, level) => s + num(older?.[LEVEL_COLUMN[level]]), 0);
  const years = [fy(row?.fy_from), fy(older?.fy_from)].filter((y): y is number => y !== null);
  return {
    filings,
    detailRows: both("detail_rows"),
    positions: both("positions"),
    kinds: LCA_KINDS.map((kind) => ({ kind, n: both(KIND_COLUMN[kind.key]) })),
    levels,
    levelBlank: num(row?.level_blank) + Math.max(0, olderLevelRows - olderNamed),
    levelRows: num(row?.detail_rows) + olderLevelRows,
    fyFrom: years.length ? Math.min(...years) : null,
    olderFilings: num(older?.filings),
    dependent: { yes: both("dependent_yes"), of: both("dependent_rows") },
    violator: { yes: both("violator_yes"), of: both("violator_rows") },
    newest: n && (n.dependent !== null || n.violator !== null) ? n : null,
    visas,
    otherVisa: Math.max(0, filings - named),
  };
}

/** Whether the panel has anything to say beyond "they file H-1B LCAs", which the page already shows. */
export function hasLcaDetail(p: LcaProfile | null): p is LcaProfile {
  if (!p) return false;
  const nonH1b = p.visas.some((v) => v.key !== "h1b" && v.n > 0) || p.otherVisa > 0;
  return p.detailRows > 0 || p.levelRows > 0 || p.dependent.of > 0 || p.violator.of > 0 || nonH1b;
}

/** A whole-number percent, or null when there's nothing to divide by. Never rounds a nonzero share to 0. */
export function percent(n: number, of: number): number | null {
  if (of <= 0) return null;
  const p = (n / of) * 100;
  if (n > 0 && p < 1) return 1;
  return Math.round(p);
}

/** The new-vs-transfer sentence, or null when neither box was ticked. */
export function newVersusTransfer(p: LcaProfile): { newN: number; transferN: number } | null {
  const newN = p.kinds.find((k) => k.kind.key === "newEmployment")?.n ?? 0;
  const transferN = p.kinds.find((k) => k.kind.key === "changeEmployer")?.n ?? 0;
  return newN + transferN > 0 ? { newN, transferN } : null;
}

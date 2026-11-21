/**
 * The case-level browser's read path, backed by the public-data database.
 *
 * Nothing here can identify a person: DOL's disclosure files carry attorney and
 * point-of-contact emails, phones and street addresses, and the ingest reads
 * none of those columns, so every field below is an organisation, a date, a
 * job, or a wage.
 *
 * ## What changed with the move, and what deliberately did not
 *
 * The Convex version's whole shape was dictated by a 4,096-document read
 * ceiling PER FUNCTION EXECUTION, which made an unindexed predicate not slow
 * but fatal. SQLite has no such ceiling, but the discipline is kept anyway:
 * the filter is still a discriminated union that can only express
 * combinations a real index serves, because an unindexed predicate over
 * 373,939 rows is still a full scan someone unauthenticated can ask for.
 *
 * `planCaseSql` below turns each slice into a WHERE clause plus the SQLite
 * index expected to serve it:
 *
 * | slice      | no status              | with a status                  | SQLite index          |
 * |------------|------------------------|--------------------------------|-----------------------|
 * | all        | `by_decision`          | `by_status_decision`           | `idx_pc_decision` / `idx_pc_status_dec` |
 * | state      | `by_state_decision`    | `by_state_status_decision`     | `idx_pc_state_dec` / `idx_pc_state_st_dec` |
 * | occupation | `by_soc_decision`      | `by_soc_status_decision`       | `idx_pc_socg_dec` / `idx_pc_socg_st_dec` |
 * | employer   | `by_employer_decision` | `by_employer_status_decision`  | `idx_pc_emp_dec` / `idx_pc_emp_st_dec` |
 * | law firm   | `by_attorney_decision` | `by_attorney_status_decision`  | `idx_pc_att_dec` / `idx_pc_att_st_dec` |
 *
 * Every one of those indexes ends in `decision_date`, so the decision-date
 * range and the ordering come free on all ten.
 *
 * ERRORS ARE NOT SWALLOWED. See publicData.ts: a `.catch(() => [])` turned a
 * disabled backend into an HTTP 200 carrying an empty state, which is
 * indistinguishable from a genuinely empty table and passed every status
 * check. These throw.
 */
import "server-only";
import { socGroupClause } from "@/lib/socCode";

import { slugify } from "@/lib/entitySlug";

import { CURRENT_FIRST_FY } from "@/lib/permEras";
import type { OlderYears, OutcomeCounts } from "@/lib/permCasesMeta";

import { getCasesMeta } from "./publicData";
import { one, rows, rowsPaged } from "./client";
import { beforeFirstLoad } from "./firstLoad";
import { MONTH_OR_DAY_RE, boundEnd, boundStart } from "@convex/lib/months";
import { LIKE_ESCAPE, likeContains } from "./like";

/**
 * DOL's FY2008 to FY2023 decisions (scripts/ingest_perm_history.py). Every decision `perm_cases` holds is October
 * 2023 or later and every one here is before it, so in decision order one table follows the other.
 */
const HISTORY = "perm_cases_history";
/** The first decision day `perm_cases` holds; the older table's last is the day before. */
const CURRENT_FROM = `${CURRENT_FIRST_FY - 1}-10-01`;
const HISTORY_LAST = `${CURRENT_FIRST_FY - 1}-09-30`;

export type DisclosureOutcome = "certified" | "denied" | "withdrawn";

const STATUSES: readonly DisclosureOutcome[] = ["certified", "denied", "withdrawn"];

export function isDisclosureOutcome(v: string): v is DisclosureOutcome {
  return (STATUSES as readonly string[]).includes(v);
}

/** The row as the site reads it. Mirrors Convex's `caseRowValidator` exactly. */
export interface PermCaseRow {
  caseNumber: string;
  status: DisclosureOutcome;
  receivedDate: string;
  decisionDate: string;
  days: number;
  employerName: string;
  employerSlug: string;
  state: string;
  jobTitle: string;
  socCode: string;
  socTitle: string;
  attorneyName: string;
  attorneySlug: string;
  wage: number | null;
}

/**
 * The row as SQLite hands it back.
 *
 * Every text column is nullable in the DDL and several genuinely are:
 * measured on the live table, `attorney_name` is NULL on 38,644 of 373,939
 * rows and `wage` on 777. Convex's validator declared those fields as plain
 * strings, so the mapper below collapses an absent name to "" and keeps only
 * `wage` nullable - which is what every caller already renders.
 */
export interface CaseDbRow {
  case_number: string;
  status: string;
  received_date: string | null;
  decision_date: string | null;
  days: number | null;
  employer_name: string | null;
  employer_slug: string | null;
  state: string | null;
  job_title: string | null;
  soc_code: string | null;
  soc_title: string | null;
  attorney_name: string | null;
  attorney_slug: string | null;
  wage: number | null;
}

export const CASE_COLS =
  "case_number, status, received_date, decision_date, days, employer_name, " +
  "employer_slug, state, job_title, soc_code, soc_title, attorney_name, " +
  "attorney_slug, wage";

export function toCaseRow(r: CaseDbRow): PermCaseRow {
  // A status outside the three is corrupt data, not a rendering problem. The
  // Convex validator would have refused the row at read time; throwing keeps
  // that guarantee rather than quietly widening the union at the call site.
  if (!isDisclosureOutcome(r.status)) {
    throw new Error(`perm_cases.${r.case_number} has status "${r.status}"`);
  }
  return {
    caseNumber: r.case_number,
    status: r.status,
    receivedDate: r.received_date ?? "",
    decisionDate: r.decision_date ?? "",
    days: r.days ?? 0,
    employerName: r.employer_name ?? "",
    employerSlug: r.employer_slug ?? "",
    state: r.state ?? "",
    jobTitle: r.job_title ?? "",
    socCode: r.soc_code ?? "",
    socTitle: r.soc_title ?? "",
    attorneyName: r.attorney_name ?? "",
    attorneySlug: r.attorney_slug ?? "",
    wage: r.wage ?? null,
  };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface StatusFacet {
  status: DisclosureOutcome;
  count: number;
}
export interface FiscalYearFacet {
  fiscalYear: string;
  total: number;
  certified: number;
  denied: number;
  withdrawn: number;
}
export interface StateFacet {
  state: string;
  total: number;
  certified: number;
  denied: number;
  withdrawn: number;
}

/**
 * What the browser covers, and the exact counts behind its filters.
 *
 * TYPED OUT RATHER THAN INFERRED. `getCasesMeta` parses JSON, and a generic
 * defaulting to `Record<string, unknown>` collapses every field to `{}` -
 * which typechecks at the call site and then renders blank.
 *
 * The counts are read here rather than computed, and that is the point: the
 * ingest counted them over exactly the rows it emitted, so a facet total and
 * the rows the browser pages through cannot disagree. Counting a filtered set
 * would mean reading it.
 */
export interface CasesMeta {
  sourceFiles: string[];
  totalCases: number;
  firstDecisionDate: string;
  lastDecisionDate: string;
  firstReceivedDate: string;
  lastReceivedDate: string;
  byStatus: StatusFacet[];
  byFiscalYear: FiscalYearFacet[];
  byState: StateFacet[];
  /** Epoch millis, added by the doc reader from the row's own column. */
  computedAt: number;
}

export function getMeta(): Promise<CasesMeta | null> {
  return getCasesMeta<CasesMeta>();
}

/**
 * The older table's record: each fiscal year's and each worksite state's decisions by outcome, written by the history
 * load (perm_docs['perm_history_years'], scripts/ingest_perm_history.py). One point read, never a count over the
 * table. Null until it's built; a failed read throws, so the page keeps its last good render.
 */
export async function getOlderYears(): Promise<OlderYears | null> {
  const r = await one<{ json: string }>("SELECT json FROM perm_docs WHERE key = 'perm_history_years'");
  if (!r) return null;
  let doc: { years?: unknown; byState?: unknown; from?: unknown };
  try {
    doc = JSON.parse(String(r.json)) as typeof doc;
  } catch {
    return null;
  }
  const counts = (e: Record<string, unknown>): OutcomeCounts | null => {
    const [total, certified, denied, withdrawn] = [e.total, e.certified, e.denied, e.withdrawn].map(Number);
    return [total, certified, denied, withdrawn].every((n) => Number.isInteger(n) && n! >= 0)
      ? { total: total!, certified: certified!, denied: denied!, withdrawn: withdrawn! }
      : null;
  };
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const years = list(doc.years).flatMap((e) => {
    const c = counts(e);
    return c && typeof e.fiscalYear === "string" && /^\d{4}$/.test(e.fiscalYear) ? [{ fiscalYear: e.fiscalYear, ...c }] : [];
  });
  const byState = list(doc.byState).flatMap((e) => {
    const c = counts(e);
    return c && typeof e.state === "string" ? [{ state: e.state, ...c }] : [];
  });
  return { years, byState, from: typeof doc.from === "string" ? doc.from : null };
}

// ---------------------------------------------------------------------------
// The query planner
// ---------------------------------------------------------------------------

/** Which dimension the caller is slicing by. Exactly one, never two. */
export type CaseSlice =
  | { kind: "all" }
  | { kind: "state"; state: string }
  | { kind: "occupation"; socCode: string }
  | { kind: "employer"; employerSlug: string }
  | { kind: "attorney"; attorneySlug: string };

export interface CaseFilter {
  slice: CaseSlice;
  status?: DisclosureOutcome;
  /** Inclusive lower bound on `decision_date`, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive upper bound on `decision_date`, `YYYY-MM-DD`. */
  to?: string;
}

/**
 * The ten indexes a browse query is allowed to lean on.
 *
 * SQLite serves any PREFIX of a composite index, so `(state, status,
 * decision_date)` also answers "by state" - which is why the table carries
 * ten and not more. Naming the expected index here is documentation the
 * planner can be checked against with EXPLAIN QUERY PLAN; SQLite chooses for
 * itself and is not told.
 */
export const BROWSE_INDEXES = [
  "idx_pc_decision",
  "idx_pc_status_dec",
  "idx_pc_state_dec",
  "idx_pc_state_st_dec",
  "idx_pc_socg_dec",
  "idx_pc_socg_st_dec",
  "idx_pc_emp_dec",
  "idx_pc_emp_st_dec",
  "idx_pc_att_dec",
  "idx_pc_att_st_dec",
] as const;

export type BrowseIndex = (typeof BROWSE_INDEXES)[number];

export interface CaseSqlPlan {
  /** The index expected to serve this shape. */
  index: BrowseIndex;
  /** Everything after WHERE, already parameterised. Never empty. */
  where: string;
  args: (string | number)[];
}

/**
 * Turn a filter into a WHERE clause. Total by construction: every `CaseSlice`
 * crossed with status-present and status-absent has a branch, and the switch
 * is exhaustive over the union.
 */
export function planCaseSql(filter: CaseFilter): CaseSqlPlan {
  const { status, from, to } = filter;
  const conds: string[] = [];
  const args: (string | number)[] = [];

  let index: BrowseIndex;
  switch (filter.slice.kind) {
    case "all":
      index = status === undefined ? "idx_pc_decision" : "idx_pc_status_dec";
      break;
    case "state":
      index = status === undefined ? "idx_pc_state_dec" : "idx_pc_state_st_dec";
      conds.push("state = ?");
      args.push(filter.slice.state);
      break;
    case "occupation":
      // One job, both spellings DOL prints, on the indexed group (src/lib/socCode.ts).
      index = status === undefined ? "idx_pc_socg_dec" : "idx_pc_socg_st_dec";
      {
        const job = socGroupClause(filter.slice.socCode);
        conds.push(job.sql);
        args.push(...job.args);
      }
      break;
    case "employer":
      index = status === undefined ? "idx_pc_emp_dec" : "idx_pc_emp_st_dec";
      conds.push("employer_slug = ?");
      args.push(filter.slice.employerSlug);
      break;
    case "attorney":
      index = status === undefined ? "idx_pc_att_dec" : "idx_pc_att_st_dec";
      conds.push("attorney_slug = ?");
      args.push(filter.slice.attorneySlug);
      break;
  }

  if (status !== undefined) {
    conds.push("status = ?");
    args.push(status);
  }
  if (from !== undefined) {
    conds.push("decision_date >= ?");
    args.push(from);
  }
  if (to !== undefined) {
    conds.push("decision_date <= ?");
    args.push(to);
  }

  // "1" rather than an empty string so every caller can write `WHERE ${where}`
  // without a conditional, and so a bug that drops a condition is visible as
  // a literal rather than as valid SQL that scans the table.
  return { index, where: conds.length > 0 ? conds.join(" AND ") : "1", args };
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/**
 * The largest page the server will hand out.
 *
 * Doubles as the whole-slice threshold: a caller that asks for this many and
 * gets `isDone: true` holds the complete slice and may sort and page it
 * locally, which is the only condition under which the browser's sortable
 * column headers are a true statement about the slice.
 */
export const MAX_PAGE_ITEMS = 500;
export const DEFAULT_PAGE_ITEMS = 50;

/**
 * How deep an offset the server will honour.
 *
 * Offset paging costs one index step per row skipped, so this is a real
 * bound and not a formality: measured on the live table, offset 100,000 is
 * 324 ms against 78 ms at offset 5,000. 400,000 sits just past the 373,939
 * rows in the window, so it stops a hostile caller asking for offset 10^9
 * without cutting the browser off from the end of its own table.
 */
const MAX_OFFSET = 400_000;

/** Clamp a caller-supplied page size into the range the indexes can serve. */
export function clampPageItems(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_ITEMS;
  return Math.min(MAX_PAGE_ITEMS, Math.max(1, Math.floor(requested)));
}

/**
 * How deep the list pages into the older table. A skip there walks the slice's index, and opens each row it passes
 * once an outcome is asked with another filter (the older table has no index pairing them), so it stops where that
 * would pass a second. The oldest decisions are still one choice away: the oldest-first order starts there.
 */
export const MAX_HISTORY_OFFSET = 10_000;

/** The two tables the list reads, by the letter a cursor names them with. */
type ListTable = "c" | "h";
const LIST_TABLE: Record<ListTable, string> = { c: "perm_cases", h: HISTORY };

/**
 * A cursor is a table and a row offset in it: `c:150` (the current files) or `h:0` (the older ones).
 *
 * Convex handed out opaque cursors; this hands out a table letter and a decimal
 * offset, which is still opaque to the browser (it only ever pushes what it was
 * given onto a stack). A bare number is a cursor from before the older table
 * joined the list, an offset in the current one. Anything unparseable is
 * treated as the start rather than as an error: a stale cursor from a previous
 * ingest should reset the view, not break the page.
 *
 * Stability: `ORDER BY decision_date` alone has many ties, but SQLite's
 * b-tree index keys are (decision_date, rowid), so a scan of one index is a
 * deterministic total order and LIMIT/OFFSET over it cannot repeat or skip a
 * row within one state of the database.
 */
function parseCursor(cursor: string | null | undefined): { table: ListTable; offset: number } | null {
  if (typeof cursor !== "string") return null;
  const m = /^(?:(c|h):)?(\d{1,9})$/.exec(cursor);
  if (!m) return null;
  return { table: (m[1] as ListTable | undefined) ?? "c", offset: Math.min(MAX_OFFSET, Number(m[2])) };
}

/**
 * The tables a decided range can match, in the order the list reads them: the current files first when the newest
 * decisions come first, the older ones first otherwise. A range wholly on one side of October 2023 reads one table.
 */
function listTables(filter: CaseFilter, order: "newest" | "oldest"): ListTable[] {
  const current = filter.to === undefined || filter.to >= CURRENT_FROM;
  const history = filter.from === undefined || filter.from <= HISTORY_LAST;
  const seq: ListTable[] = order === "oldest" ? ["h", "c"] : ["c", "h"];
  return seq.filter((t) => (t === "c" ? current : history));
}

export interface ListCasesArgs {
  filter: CaseFilter;
  order?: "newest" | "oldest";
  cursor?: string | null;
  numItems?: number;
}

/** Mirrors Convex's pagination result, in the three fields the browser reads. */
export interface CasePage {
  page: PermCaseRow[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * A page of cases, ordered by decision date.
 *
 * `newest` is the default because the newest determinations are what someone
 * waiting actually wants to see.
 *
 * `isDone` comes from asking for one row more than the caller wanted, so it
 * costs one row rather than a COUNT over the whole slice.
 */
export async function listCases(args: ListCasesArgs): Promise<CasePage> {
  const plan = planCaseSql(args.filter);
  const take = clampPageItems(args.numItems);
  const order = args.order === "oldest" ? "oldest" : "newest";
  const direction = order === "oldest" ? "ASC" : "DESC";
  const tables = listTables(args.filter, order);
  if (tables.length === 0) return { page: [], isDone: true, continueCursor: "c:0" };
  const at = parseCursor(args.cursor);
  let i = at ? tables.indexOf(at.table) : 0;
  let offset = at && i >= 0 ? at.offset : 0;
  if (i < 0) i = 0;
  const here = tables[i]!;
  if (here === "h" && offset >= MAX_HISTORY_OFFSET) return { page: [], isDone: true, continueCursor: `h:${offset}` };

  // Counted on the rows read, not the rows kept: a row withheld from the
  // answer (src/lib/privacy/withheld.ts) must neither end the paging early nor
  // shift the next page back over rows already shown. The older table is read
  // unpinned: its indexes may be dropped to save writes, and the slice's own
  // equality leads its index there as it does here.
  const read = (table: ListTable, n: number, from: number) => {
    const q = rowsPaged<CaseDbRow>(
      `SELECT ${CASE_COLS} FROM ${LIST_TABLE[table]} WHERE ${plan.where} ` +
        `ORDER BY decision_date ${direction} LIMIT ? OFFSET ?`,
      [...plan.args, n + 1, from],
      n,
    );
    // An older table not made yet holds nothing; any other failure throws.
    return table === "h" ? q.catch(beforeFirstLoad({ page: [] as CaseDbRow[], more: false, consumed: 0 })) : q;
  };

  const found = await read(here, take, offset);
  const page = found.page.map(toCaseRow);
  offset += found.consumed;
  if (found.more) {
    return { page, isDone: here === "h" && offset >= MAX_HISTORY_OFFSET, continueCursor: `${here}:${offset}` };
  }
  // This table is done: the rest of the page comes from the next one, from its start. With the page already full,
  // the read asks for one row, only to say whether there's a next page.
  const next = tables[i + 1];
  if (!next) return { page, isDone: true, continueCursor: `${here}:${offset}` };
  const rest = await read(next, take - page.length, 0);
  return {
    page: [...page, ...rest.page.map(toCaseRow)],
    isDone: !rest.more,
    continueCursor: `${next}:${rest.consumed}`,
  };
}

// ---------------------------------------------------------------------------
// The two lookups that are not the browse table
// ---------------------------------------------------------------------------

/** DOL's longest printed case number is 18 characters (`G-100-25273-349207`). */
const MAX_CASE_NUMBER_INPUT = 32;

/**
 * Tidy a pasted case number.
 *
 * The length cap runs FIRST, before anything that walks the string, because
 * this is reachable unauthenticated. Returns "" for anything that cannot be a
 * case number, and the caller treats that as a miss rather than querying.
 */
export function normalizeCaseNumber(raw: string): string {
  if (raw.length > MAX_CASE_NUMBER_INPUT) return "";
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * One case by its number.
 *
 * A miss is `null`, and `null` means "not in this window" - emphatically not
 * "no such case". DOL's disclosure files carry decided cases only, so every
 * pending case in the country misses here. The page has to say that, or the
 * most common lookup on the site reads as bad news about someone's petition.
 */
export async function lookupByCaseNumber(caseNumber: string): Promise<PermCaseRow | null> {
  const needle = normalizeCaseNumber(caseNumber);
  if (needle === "") return null;
  // The current files first, then DOL's FY2008 to FY2023 decisions: two primary-key reads at most.
  const row =
    (await one<CaseDbRow>(`SELECT ${CASE_COLS} FROM perm_cases WHERE case_number = ?`, [needle])) ??
    (await one<CaseDbRow>(`SELECT ${CASE_COLS} FROM ${HISTORY} WHERE case_number = ?`, [needle]).catch(
      beforeFirstLoad(null),
    ));
  return row ? toCaseRow(row) : null;
}

/** The most matches a name search will return. */
export const MAX_SEARCH_RESULTS = 100;

export interface SearchCasesArgs {
  field: "employer" | "attorney";
  text: string;
  status?: DisclosureOutcome;
  state?: string;
  limit?: number;
  /** Case-insensitive "contains" on the job title. `%` and `_` are literal. */
  title?: string;
  /** Filing month, `YYYY-MM`, inclusive. */
  from?: string;
  /** Filing month, `YYYY-MM`, inclusive. */
  to?: string;
}

/**
 * The two narrowing filters an applicant actually has: the job title on the
 * posting and roughly when the lawyer filed. Together with the employer they
 * are what finds one case among Amazon's thousands, which is the question
 * "how do I find my PERM case number" is really asking.
 *
 * Both filters run AFTER the indexed employer range narrows the rows, so
 * they cost a scan of one employer's cases in one window, not of the table.
 * The title uses LIKE with the wildcards escaped, because a stranger types
 * it; the months are a half-open range so December does not swallow 1 Jan.
 */
export const MAX_TITLE_FILTER = 80;

/** Extra WHERE clauses for title and month filters, over the named date column. */
export function narrowingClauses(
  dateColumn: string,
  args: { title?: string; from?: string; to?: string },
): { conds: string[]; params: string[] } {
  const conds: string[] = [];
  const params: string[] = [];
  const title = (args.title ?? "").trim();
  if (title) {
    if (title.length > MAX_TITLE_FILTER) throw new Error("title filter too long");
    conds.push(`job_title LIKE ? ${LIKE_ESCAPE}`);
    params.push(likeContains(title));
  }
  // A bound is a month or one day; either way the range is half-open, so `from` and `to` on the same day is that day.
  if (args.from) {
    if (!MONTH_OR_DAY_RE.test(args.from)) throw new Error(`not a month or a day: ${args.from}`);
    conds.push(`${dateColumn} >= ?`);
    params.push(boundStart(args.from));
  }
  if (args.to) {
    if (!MONTH_OR_DAY_RE.test(args.to)) throw new Error(`not a month or a day: ${args.to}`);
    conds.push(`${dateColumn} < ?`);
    params.push(boundEnd(args.to));
  }
  return { conds, params };
}

/**
 * Find cases by employer or law-firm name.
 *
 * THIS IS A PREFIX SEARCH, NOT FULL TEXT, AND THERE IS NO RELEVANCE ORDER.
 * `perm_cases` has no FTS table - the migration drops `perm_cases_fts` and
 * never builds it - so the Convex search index is gone and nothing here
 * ranks. Results come back newest first, and typing a word from the middle of
 * a name finds nothing: "fragomen" reaches FRAGOMEN, DEL REY, BERNSEN &
 * LOEWY, LLP and "del rey" does not. The page must say so.
 *
 * The match runs on the indexed SLUG column as a half-open range rather than
 * on the name with LIKE, and that is a measured decision rather than a
 * stylistic one. SQLite's LIKE is case-insensitive by default while the
 * columns collate BINARY, so `name LIKE 'micro%'` cannot use an index at all:
 * on the live table a needle that matches nothing took 506 ms because it
 * scanned all 373,939 rows, and `%contains%` took 801 ms. The same search as
 * a slug range is index-served and returned in 39 ms. On an endpoint a
 * stranger can call, that difference is the whole argument.
 *
 * `slugify` is the same function the ingest slugged these columns with, so
 * the prefix a visitor types and the prefix stored here are computed one way.
 */
/**
 * A case from the LIVE feed, newer than the last disclosure file.
 *
 * Thin on purpose: DOL's live endpoint returns employer, job title and
 * status - no firm, no wage, no state. Rows come from `perm_live_recent`,
 * the small daily-rebuilt remainder table, so this search costs an indexed
 * prefix range over one quarter of filings rather than a scan of the
 * 414k-row corpus.
 */
export interface LiveCaseRow {
  caseNumber: string;
  filingDate: string | null;
  status: string | null;
  isFinal: boolean;
  employerName: string | null;
  /**
   * The employer's slug, so a live row can link to its employer page.
   *
   * `perm_live_recent` has carried this since it was built - it is the leading
   * column of the index this read is pinned to - and it was dropped here, so
   * live PERM rows rendered without a link while live wage-request and LCA
   * rows, whose tables also carry it, rendered with one.
   */
  employerSlug: string | null;
  jobTitle: string | null;
}

export interface LiveDbRow {
  case_number: string;
  filing_date: string | null;
  status: string | null;
  is_final: number;
  employer_name: string | null;
  employer_slug: string | null;
  job_title: string | null;
}

export const toLiveRow = (r: LiveDbRow): LiveCaseRow => ({
  caseNumber: r.case_number,
  filingDate: r.filing_date,
  status: r.status,
  isFinal: Boolean(r.is_final),
  employerName: r.employer_name,
  employerSlug: r.employer_slug,
  jobTitle: r.job_title,
});

/**
 * Employer search over the live remainder: the same slug-prefix needle the
 * disclosure search uses, against `perm_live_recent`. Only employers - the
 * live feed simply has no firm names (DOL reveals the firm at publication),
 * which the UI says in words rather than returning a silently empty list.
 */
/**
 * The live half returns up to 200 rows, not 25. Twenty-five newest filings is
 * a few days of Amazon, and the case someone is looking for was filed in May.
 * With the title and month filters the row count is usually small anyway;
 * without them, 200 is the whole live set for all but the largest filers.
 */
export const LIVE_SEARCH_MAX = 200;

export async function searchLiveCases(
  text: string,
  opts: { limit?: number; title?: string; from?: string; to?: string } = {},
): Promise<LiveCaseRow[]> {
  if (text.length > 120) return [];
  const needle = slugify(text.trim());
  if (needle.length < 2) return [];
  const upper =
    needle.slice(0, -1) + String.fromCharCode(needle.charCodeAt(needle.length - 1) + 1);
  const take = Math.min(Math.max(1, Math.floor(opts.limit ?? LIVE_SEARCH_MAX)), LIVE_SEARCH_MAX);
  const narrow = narrowingClauses("filing_date", opts);
  const conds = ["employer_slug >= ?", "employer_slug < ?", ...narrow.conds];
  // INDEXED BY: a `from`/`to` month narrowing otherwise moved the plan onto
  // `perm_live_recent_filed (filing_date>? AND filing_date<?)`, which reads
  // every filing in that window across every employer in the country and
  // then discards all but one company's. Measured.
  const found = await rows<LiveDbRow>(
    `SELECT case_number, filing_date, status, is_final, employer_name, employer_slug, job_title
       FROM perm_live_recent INDEXED BY perm_live_recent_emp
      WHERE ${conds.join(" AND ")}
      ORDER BY filing_date DESC, case_number DESC LIMIT ?`,
    [needle, upper, ...narrow.params, take],
  );
  return found.map(toLiveRow);
}

/**
 * One case from the live corpus, by exact number. A point read on the
 * primary key; used when the disclosure lookup misses so the case search
 * can hand the visitor to the live status page instead of shrugging.
 */
export async function lookupLiveByCaseNumber(
  caseNumber: string,
): Promise<LiveCaseRow | null> {
  const cn = normalizeCaseNumber(caseNumber);
  if (!cn) return null;
  const r = await one<LiveDbRow>(
    `SELECT case_number, filing_date, current_status AS status, is_final,
            employer_name, job_title
       FROM perm_case_status WHERE case_number = ?`,
    [cn],
  );
  return r ? toLiveRow(r) : null;
}

/**
 * The newest live filings for one employer page, by its canonical slug.
 *
 * The ceiling is 100 rather than the 25 this shipped with. A published
 * employer's page uses this for a BAND of eight under its statistics; an
 * employer with no published record at all has no statistics, so the case
 * list is the whole page and 8 would be a page that hides most of itself.
 * Still capped, because 5 live-only employers hold over 100 cases each and an
 * unbounded list is an unbounded RSC payload. Index-served either way:
 * `SEARCH perm_live_recent USING INDEX perm_live_recent_emp (employer_slug=?)`.
 */
export async function recentLiveByEmployer(
  slug: string,
  limit = 8,
): Promise<LiveCaseRow[]> {
  if (!slug || slug.length > 80) return [];
  const found = await rows<LiveDbRow>(
    `SELECT case_number, filing_date, status, is_final, employer_name, employer_slug, job_title
       FROM perm_live_recent WHERE employer_slug = ?
      ORDER BY filing_date DESC LIMIT ?`,
    [slug, Math.min(Math.max(1, Math.floor(limit)), 100)],
  );
  return found.map(toLiveRow);
}

export async function searchCases(args: SearchCasesArgs): Promise<PermCaseRow[]> {
  // Guards in cost order. The length cap is first because everything after it
  // walks the string, and `text` arrives from a stranger.
  if (args.text.length > 120) return [];
  const needle = slugify(args.text.trim());
  if (needle.length < 2) return [];

  const take = Math.min(Math.max(1, Math.floor(args.limit ?? 50)), MAX_SEARCH_RESULTS);
  const column = args.field === "employer" ? "employer_slug" : "attorney_slug";
  // The two-column form, not the three-column one: the lead is a RANGE, so
  // the status column after it can never be seeked and the narrower index is
  // the cheaper walk.
  const leadIndex = args.field === "employer" ? "idx_pc_emp_dec" : "idx_pc_att_dec";

  // The successor of a prefix, for a half-open range. Incrementing the last
  // character is correct whatever that character is: the comparison decides
  // at that position, so `needle + anything` sorts below it.
  const upper =
    needle.slice(0, -1) + String.fromCharCode(needle.charCodeAt(needle.length - 1) + 1);

  const conds = [`${column} >= ?`, `${column} < ?`];
  const sqlArgs: (string | number)[] = [needle, upper];
  if (args.status !== undefined) {
    conds.push("status = ?");
    sqlArgs.push(args.status);
  }
  if (args.state !== undefined && args.state !== "") {
    conds.push("state = ?");
    sqlArgs.push(args.state);
  }
  const narrow = narrowingClauses("received_date", args);
  conds.push(...narrow.conds);
  sqlArgs.push(...narrow.params);

  // INDEXED BY, AND IT IS LOAD-BEARING. Measured against production: with
  // the status filter present and no hint, SQLite chose
  // `SEARCH perm_cases USING INDEX idx_pc_status_dec (status=?)` - it read
  // every certified case in the corpus and threw away the ones belonging to
  // other employers. `state = ?` stole it the same way (`idx_pc_state_dec`),
  // and so did `fiscal_year` (`idx_pc_fy_wage`). This database carries no
  // planner statistics to say that one employer is a few thousand rows and
  // one status is a quarter of a million, so SQLite prefers an
  // equality over a range and is wrong here every time. Naming the index
  // pins the read to this employer, and it fails loudly if the index is ever
  // dropped rather than silently degrading to a scan.
  // THE ORDER IS TOTAL, which `ORDER BY decision_date DESC` alone is not.
  // Measured while pinning the index above: the two plans returned the same 50
  // decision dates in the same sequence and a different pair of case numbers in
  // the last two slots, because the cut fell inside a tie group at 2025-08-04.
  // A search that quietly returns different rows for the same query is the
  // kind of thing nobody reports and nobody can reproduce.
  const found = await rows<CaseDbRow>(
    `SELECT ${CASE_COLS} FROM perm_cases INDEXED BY ${leadIndex} ` +
      `WHERE ${conds.join(" AND ")} ORDER BY decision_date DESC, case_number DESC LIMIT ?`,
    [...sqlArgs, take],
  );
  const current = found.map(toCaseRow);
  // Every current decision is newer than every older one, so the older table can only add to a short answer.
  if (current.length >= take) return current;
  const seen = new Set(current.map((r) => r.caseNumber));
  const older = await searchHistory(column, needle, upper, conds.slice(2), sqlArgs.slice(2), take);
  return [...current, ...older.filter((r) => !seen.has(r.caseNumber))].slice(0, take);
}

/**
 * How many of a name's newest older-table cases a filter is tested against: the same window, for the same reason,
 * as the case search's (SLICE_CAP in caseSearchReads.ts, where a big sponsor's newest 2,000 read in 8 ms).
 */
const HISTORY_NAME_WINDOW = 5000;

/**
 * A name's newest decisions in the older table, in two passes, as the case search reads a name: the rows' ids off
 * the (slug, decision day) index alone, newest first, then those rows by id with the other filters. One pass would
 * open every row the name ever filed to sort them, which is what took an employer prefix to 137 s on the LCA table
 * (readEmployerSlice in caseSearchReads.ts has the measurement). Unpinned: the older table's indexes may be dropped
 * to save writes, and a missing table holds nothing.
 */
async function searchHistory(
  column: "employer_slug" | "attorney_slug",
  lo: string,
  hi: string,
  restConds: string[],
  restArgs: (string | number)[],
  take: number,
): Promise<PermCaseRow[]> {
  const ids = await rows<{ rowid: number }>(
    `SELECT rowid FROM ${HISTORY} WHERE ${column} >= ? AND ${column} < ? ORDER BY decision_date DESC LIMIT ?`,
    [lo, hi, restConds.length ? HISTORY_NAME_WINDOW : take],
  ).catch(beforeFirstLoad([] as { rowid: number }[]));
  if (ids.length === 0) return [];
  const found = await rows<CaseDbRow>(
    `SELECT ${CASE_COLS} FROM ${HISTORY} NOT INDEXED WHERE rowid IN (${ids.map(() => "?").join(", ")})` +
      (restConds.length ? ` AND ${restConds.join(" AND ")}` : "") +
      " ORDER BY decision_date DESC, case_number DESC LIMIT ?",
    [...ids.map((r) => r.rowid), ...restArgs, take],
  );
  return found.map(toCaseRow);
}

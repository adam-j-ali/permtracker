import "server-only";

import type { FoundCase } from "@/lib/caseFinder";
import type { FilingProgram } from "@/lib/filingsByDay";
import { wageRequestNumber } from "@/lib/caseLinks";
import { formatWage, looksYearly, LOOKS_YEARLY_SHORT } from "@/lib/wageFormat";

import { rows } from "./client";
import { keepLinkableSlugs } from "./entityLinks";
import { LIKE_ESCAPE, likeContains } from "./like";

/**
 * The cases filed in a window of days, narrowed in the database by what a person typed: the read behind the
 * finder (src/lib/caseFinder.ts), which then matches each row exactly. The same two halves as a day's list
 * (./filingDay.ts): DOL's live record, pending and decided alike, and the published files for the decided cases
 * the live record doesn't hold. A case is listed once.
 *
 * WHAT THE DATABASE NARROWS BY, AND WHAT IT LEAVES TO THE CALLER.
 *   - A job title: every typed word must be in the title (`LIKE`, wildcards escaped). Exact, so nothing is left.
 *   - An employer: only the start of the name's first word, anywhere in the printed name with its punctuation
 *     and spaces taken out. That is wider than the finder's rule on purpose. The rule itself reads the site's
 *     employer key, which SQL can't compute, so it runs on the rows this returns.
 *   - A law firm: every typed word in the firm's printed name. DOL names a firm only in its files, so a firm
 *     search reads the files alone and the answer holds decided cases only.
 * Every name comes back through `rows()`, so one withheld at its owner's request is already its label here.
 * The caller matches on what it's given, which is how a withheld name can't be found by typing it.
 *
 * A failed read throws. The caller decides what a failure means; it is never "no cases".
 */

export interface WindowNarrow {
  /** From `employerStem`: lower-case letters and digits, or empty. */
  employerStem: string;
  titleWords: readonly string[];
  firmWords: readonly string[];
}

/** Rows one half of one program may return. Reached, the answer says it may be missing cases. */
export const WINDOW_READ_MAX = 3000;

type Row = {
  case_number: string;
  status: string | null;
  employer_name: string | null;
  employer_slug: string | null;
  job_title: string | null;
  is_final: number | null;
  filed_on: string | null;
  file_date: string | null;
  decided: string | null;
  state: string | null;
  wage: number | null;
  wage_unit: string | null;
  wage_request?: string | null;
  attorney_name?: string | null;
  /** 1 for a row read from a file with no live row beside it. */
  file_only?: number | null;
};

const dayOf = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);
const statusWord = (s: string | null) => String(s ?? "").trim().toUpperCase() || "UNKNOWN";

function wageText(wage: number | null, unit: string | null): string | null {
  const w = wage === null || wage === undefined ? null : Number(wage);
  const text = formatWage(w, unit);
  if (!text) return null;
  return looksYearly(w, unit) ? `${text} (${LOOKS_YEARLY_SHORT})` : text;
}

function toCase(r: Row): FoundCase {
  const filedOn = dayOf(r.filed_on) ?? "";
  const fileDate = dayOf(r.file_date);
  const fileOnly = Number(r.file_only) === 1;
  return {
    caseNumber: String(r.case_number),
    status: statusWord(r.status),
    employer: String(r.employer_name ?? "").trim(),
    employerSlug: r.employer_slug ? String(r.employer_slug) : null,
    jobTitle: String(r.job_title ?? "").trim(),
    final: fileOnly || Number(r.is_final) === 1,
    source: fileOnly ? "file" : fileDate ? "both" : "live",
    fileDate: !fileOnly && fileDate && fileDate !== filedOn ? fileDate : null,
    decided: dayOf(r.decided),
    state: r.state ? String(r.state).trim().toUpperCase() : null,
    wage: wageText(r.wage, r.wage_unit),
    wageRequest: wageRequestNumber(r.wage_request),
    filedOn,
    firm: r.attorney_name ? String(r.attorney_name).trim() || null : null,
  };
}

/** A printed name with its spaces and common punctuation taken out, lower case, in SQL. */
const squeezed = (col: string) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${col}), ' ', ''), '.', ''), ',', ''), '&', ''), '-', ''), '''', ''), '/', '')`;

/** The conditions a narrowing adds, over the named columns, with their arguments in order. */
function narrowing(n: WindowNarrow, cols: { employer: string; title: string; firm?: string }): { sql: string; args: string[] } {
  const conds: string[] = [];
  const args: string[] = [];
  if (n.employerStem) {
    conds.push(`${squeezed(cols.employer)} LIKE ? ${LIKE_ESCAPE}`);
    args.push(likeContains(n.employerStem));
  }
  for (const w of n.titleWords) {
    conds.push(`${cols.title} LIKE ? ${LIKE_ESCAPE}`);
    args.push(likeContains(w));
  }
  if (cols.firm) {
    for (const w of n.firmWords) {
      conds.push(`${cols.firm} LIKE ? ${LIKE_ESCAPE}`);
      args.push(likeContains(w));
    }
  }
  return { sql: conds.map((c) => ` AND ${c}`).join(""), args };
}

async function permWindow(from: string, to: string, n: WindowNarrow): Promise<Row[]> {
  const byFirm = n.firmWords.length > 0;
  const file = narrowing(n, { employer: "p.employer_name", title: "p.job_title", firm: "p.attorney_name" });
  const fileCols =
    "p.case_number, p.employer_name, p.employer_slug, p.job_title, p.received_date AS filed_on, p.decision_date AS decided, " +
    "p.state AS state, p.wage AS wage, 'Year' AS wage_unit, p.attorney_name AS attorney_name";
  if (byFirm) {
    // A firm is in the files alone. A file row's status is DOL's decision; the live row beside it says the same.
    const [files, history] = await Promise.all([
      rows<Row>(
        `SELECT ${fileCols}, p.status AS status, 1 AS is_final, p.pwd_number AS wage_request, 1 AS file_only
           FROM perm_cases p WHERE p.received_date BETWEEN ? AND ?${file.sql}
          ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
        [from, to, ...file.args, WINDOW_READ_MAX],
      ),
      rows<Row>(
        `SELECT ${fileCols}, p.status AS status, 1 AS is_final, 1 AS file_only
           FROM perm_cases_history p WHERE p.received_date BETWEEN ? AND ?${file.sql}
            AND NOT EXISTS (SELECT 1 FROM perm_cases x WHERE x.case_number = p.case_number)
          ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
        [from, to, ...file.args, WINDOW_READ_MAX],
      ),
    ]);
    return [...files, ...history];
  }
  const live = narrowing(n, { employer: "s.employer_name", title: "s.job_title" });
  const notLive = "NOT EXISTS (SELECT 1 FROM perm_case_status s WHERE s.case_number = p.case_number)";
  const [liveRows, files, history] = await Promise.all([
    // `is_final IN (0, 1)` lets the read seek the (is_final, filing_date) index, as a day's list does.
    rows<Row>(
      `SELECT s.case_number, s.current_status AS status, s.employer_name, s.job_title, s.is_final, s.filing_date AS filed_on,
              COALESCE(lr.employer_slug, pc.employer_slug, h.employer_slug) AS employer_slug,
              COALESCE(pc.received_date, h.received_date) AS file_date,
              COALESCE(pc.decision_date, h.decision_date) AS decided,
              COALESCE(pc.state, h.state) AS state, COALESCE(pc.wage, h.wage) AS wage, 'Year' AS wage_unit,
              pc.pwd_number AS wage_request, COALESCE(pc.attorney_name, h.attorney_name) AS attorney_name
         FROM perm_case_status s
         LEFT JOIN perm_live_recent lr ON lr.case_number = s.case_number
         LEFT JOIN perm_cases pc ON pc.case_number = s.case_number
         LEFT JOIN perm_cases_history h ON h.case_number = s.case_number AND pc.case_number IS NULL
        WHERE s.is_final IN (0, 1) AND s.filing_date BETWEEN ? AND ?${live.sql}
        ORDER BY s.filing_date DESC, s.case_number LIMIT ?`,
      [from, to, ...live.args, WINDOW_READ_MAX],
    ),
    rows<Row>(
      `SELECT ${fileCols}, p.status AS status, 1 AS is_final, p.pwd_number AS wage_request, 1 AS file_only
         FROM perm_cases p WHERE p.received_date BETWEEN ? AND ? AND ${notLive}${file.sql}
        ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
      [from, to, ...file.args, WINDOW_READ_MAX],
    ),
    rows<Row>(
      `SELECT ${fileCols}, p.status AS status, 1 AS is_final, 1 AS file_only
         FROM perm_cases_history p WHERE p.received_date BETWEEN ? AND ? AND ${notLive}${file.sql}
          AND NOT EXISTS (SELECT 1 FROM perm_cases x WHERE x.case_number = p.case_number)
        ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
      [from, to, ...file.args, WINDOW_READ_MAX],
    ),
  ]);
  return [...liveRows, ...files, ...history];
}

const FLAG_FILE_COLS =
  "p.case_number, p.employer_name, p.employer_slug, p.job_title, p.received_date AS filed_on, p.decision_date AS decided, " +
  "p.case_status AS status, p.worksite_state AS state, p.wage AS wage, p.wage_unit AS wage_unit, p.pw_case AS wage_request, " +
  "p.attorney_name AS attorney_name, 1 AS is_final, 1 AS file_only";

/** Wage requests and the seasonal programs: one live table and one published file, both on the main database. */
async function flagWindow(from: string, to: string, n: WindowNarrow, liveTable: string, fileTable: string): Promise<Row[]> {
  const byFirm = n.firmWords.length > 0;
  const file = narrowing(n, { employer: "p.employer_name", title: "p.job_title", firm: "p.attorney_name" });
  if (byFirm) {
    return rows<Row>(
      `SELECT ${FLAG_FILE_COLS} FROM ${fileTable} p WHERE p.received_date BETWEEN ? AND ?${file.sql}
        ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
      [from, to, ...file.args, WINDOW_READ_MAX],
    );
  }
  const live = narrowing(n, { employer: "s.employer_name", title: "s.job_title" });
  const [liveRows, fileRows] = await Promise.all([
    rows<Row>(
      `SELECT s.case_number, s.current_status AS status, s.employer_name, s.employer_slug, s.job_title, s.is_final,
              s.filing_date AS filed_on, p.received_date AS file_date, p.decision_date AS decided,
              p.worksite_state AS state, p.wage AS wage, p.wage_unit AS wage_unit, p.pw_case AS wage_request,
              p.attorney_name AS attorney_name
         FROM ${liveTable} s LEFT JOIN ${fileTable} p ON p.case_number = s.case_number
        WHERE s.filing_date BETWEEN ? AND ?${live.sql}
        ORDER BY s.filing_date DESC, s.case_number LIMIT ?`,
      [from, to, ...live.args, WINDOW_READ_MAX],
    ),
    rows<Row>(
      `SELECT ${FLAG_FILE_COLS} FROM ${fileTable} p
        WHERE p.received_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM ${liveTable} s WHERE s.case_number = p.case_number)${file.sql}
        ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
      [from, to, ...file.args, WINDOW_READ_MAX],
    ),
  ]);
  return [...liveRows, ...fileRows];
}

/**
 * H-1B LCAs: the live table is on the main database and the file's rows on the LCA one, so the two are read apart
 * and joined here, as a day's list does. A live case takes its file's details by case number.
 */
async function lcaWindow(from: string, to: string, n: WindowNarrow): Promise<Row[]> {
  const byFirm = n.firmWords.length > 0;
  const file = narrowing(n, { employer: "p.employer_name", title: "p.job_title", firm: "p.attorney_name" });
  const fileRows = await rows<Row>(
    `SELECT ${FLAG_FILE_COLS} FROM lca_cases p WHERE p.received_date BETWEEN ? AND ?${file.sql}
      ORDER BY p.received_date DESC, p.case_number LIMIT ?`,
    [from, to, ...file.args, WINDOW_READ_MAX],
  );
  if (byFirm) return fileRows;
  const live = narrowing(n, { employer: "s.employer_name", title: "s.job_title" });
  const liveRows = await rows<Row>(
    `SELECT s.case_number, s.current_status AS status, s.employer_name, s.employer_slug, s.job_title, s.is_final,
            s.filing_date AS filed_on
       FROM lca_case_status s
      WHERE s.filing_date BETWEEN ? AND ?${live.sql}
      ORDER BY s.filing_date DESC, s.case_number LIMIT ?`,
    [from, to, ...live.args, WINDOW_READ_MAX],
  );
  const byNumber = new Map(fileRows.map((r) => [String(r.case_number), r]));
  // A live case whose file row the window's read didn't carry (the file dates it outside the window, or the read
  // stopped at its cap): its details are asked for by number.
  const missing = liveRows.map((r) => String(r.case_number)).filter((c) => !byNumber.has(c));
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500);
    const got = await rows<Row>(
      `SELECT ${FLAG_FILE_COLS} FROM lca_cases p WHERE p.case_number IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of got) byNumber.set(String(r.case_number), r);
  }
  const liveNumbers = new Set(liveRows.map((r) => String(r.case_number)));
  const merged: Row[] = liveRows.map((r) => {
    const f = byNumber.get(String(r.case_number));
    return {
      ...r,
      file_date: f?.filed_on ?? null,
      decided: f?.decided ?? null,
      state: f?.state ?? null,
      wage: f?.wage ?? null,
      wage_unit: f?.wage_unit ?? null,
      wage_request: f?.wage_request ?? null,
      attorney_name: f?.attorney_name ?? null,
    };
  });
  return [...merged, ...fileRows.filter((r) => !liveNumbers.has(String(r.case_number)))];
}

/**
 * One program's filings in a window of days, narrowed as far as the database can, each slug pointed at its page
 * or cleared. `capped` says a half stopped at WINDOW_READ_MAX, so a case can be missing. A failed read throws.
 */
export async function getFiledInWindow(
  program: FilingProgram,
  from: string,
  to: string,
  narrow: WindowNarrow,
): Promise<{ cases: FoundCase[]; capped: boolean }> {
  const got =
    program === "perm" ? await permWindow(from, to, narrow)
    : program === "pwd" ? await flagWindow(from, to, narrow, "pwd_case_status", "pwd_cases")
    : program === "seasonal" ? await flagWindow(from, to, narrow, "seasonal_case_status", "seasonal_cases")
    : await lcaWindow(from, to, narrow);
  // One row a case: the live row first, so a case two reads both carried keeps its live status.
  const seen = new Set<string>();
  const once = got.filter((r) => (seen.has(String(r.case_number)) ? false : (seen.add(String(r.case_number)), true)));
  const cases = await keepLinkableSlugs(once.map(toCase).filter((c) => c.filedOn !== ""));
  // A half that returned its limit may hold more than it gave.
  return { cases, capped: got.length >= WINDOW_READ_MAX };
}

/** Printed names one read may return: a month of the busiest program names about 20,000 employers. */
const NAMES_MAX = 40000;

/**
 * The employers that filed in a window, each printed name with its cases: what the finder ranks for close
 * spellings when a typed name fits none. A case in the live record and in a file is counted once where one
 * database holds both. H-1B LCAs are held on two, so a name there takes the larger of its two counts.
 */
export async function getWindowEmployers(program: FilingProgram, from: string, to: string): Promise<{ employer: string; cases: number }[]> {
  type NameRow = { employer_name: string | null; n: number | null };
  const tally = new Map<string, number>();
  const add = (list: NameRow[], merge: (had: number, n: number) => number) => {
    for (const r of list) {
      const name = String(r.employer_name ?? "").trim();
      if (name) tally.set(name, merge(tally.get(name) ?? 0, Number(r.n) || 0));
    }
  };
  const sum = (had: number, n: number) => had + n;
  if (program === "lca") {
    const [live, file] = await Promise.all([
      rows<NameRow>(
        `SELECT s.employer_name, COUNT(*) AS n FROM lca_case_status s WHERE s.filing_date BETWEEN ? AND ? GROUP BY s.employer_name LIMIT ?`,
        [from, to, NAMES_MAX],
      ),
      rows<NameRow>(
        `SELECT p.employer_name, COUNT(*) AS n FROM lca_cases p WHERE p.received_date BETWEEN ? AND ? GROUP BY p.employer_name LIMIT ?`,
        [from, to, NAMES_MAX],
      ),
    ]);
    add(live, sum);
    add(file, Math.max);
    return [...tally].map(([employer, cases]) => ({ employer, cases }));
  }
  if (program === "perm") {
    const notLive = "NOT EXISTS (SELECT 1 FROM perm_case_status s WHERE s.case_number = p.case_number)";
    const [live, files, history] = await Promise.all([
      rows<NameRow>(
        `SELECT s.employer_name, COUNT(*) AS n FROM perm_case_status s
          WHERE s.is_final IN (0, 1) AND s.filing_date BETWEEN ? AND ? GROUP BY s.employer_name LIMIT ?`,
        [from, to, NAMES_MAX],
      ),
      rows<NameRow>(
        `SELECT p.employer_name, COUNT(*) AS n FROM perm_cases p WHERE p.received_date BETWEEN ? AND ? AND ${notLive}
          GROUP BY p.employer_name LIMIT ?`,
        [from, to, NAMES_MAX],
      ),
      rows<NameRow>(
        `SELECT p.employer_name, COUNT(*) AS n FROM perm_cases_history p WHERE p.received_date BETWEEN ? AND ? AND ${notLive}
            AND NOT EXISTS (SELECT 1 FROM perm_cases x WHERE x.case_number = p.case_number)
          GROUP BY p.employer_name LIMIT ?`,
        [from, to, NAMES_MAX],
      ),
    ]);
    for (const list of [live, files, history]) add(list, sum);
    return [...tally].map(([employer, cases]) => ({ employer, cases }));
  }
  const [liveTable, fileTable] = program === "pwd" ? ["pwd_case_status", "pwd_cases"] : ["seasonal_case_status", "seasonal_cases"];
  const [live, file] = await Promise.all([
    rows<NameRow>(
      `SELECT s.employer_name, COUNT(*) AS n FROM ${liveTable} s WHERE s.filing_date BETWEEN ? AND ? GROUP BY s.employer_name LIMIT ?`,
      [from, to, NAMES_MAX],
    ),
    rows<NameRow>(
      `SELECT p.employer_name, COUNT(*) AS n FROM ${fileTable} p
        WHERE p.received_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM ${liveTable} s WHERE s.case_number = p.case_number)
        GROUP BY p.employer_name LIMIT ?`,
      [from, to, NAMES_MAX],
    ),
  ]);
  add(live, sum);
  add(file, sum);
  return [...tally].map(([employer, cases]) => ({ employer, cases }));
}

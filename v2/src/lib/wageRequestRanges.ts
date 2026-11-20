/**
 * Whose wage request a P- number is. DOL's prevailing wage file (`pwd_cases`) holds every determination it decided,
 * and the number's prefix says which program asked: P-100 (a PERM job) and P-200 to P-203 (an H-1B, H-1B1 or E-3
 * job) are the ETA-9141 wage requests the wage request pages describe; P-400 (H-2B) and P-500 (CW-1) belong to the
 * seasonal programs, whose live rows are in `seasonal_case_status`, never `pwd_case_status`.
 *
 * Every P- number below "P-400-" is the first kind and every one from it on is the second, so one comparison on the
 * primary key splits the file, with no lookup. Read through these two helpers everywhere: a wage request reader that
 * skipped the split listed a decided H-2B request as a wage request while its live row listed it as seasonal, the
 * same case twice (87,836 H-2B and 6,710 CW-1 decided rows on Nov 20 2026). `scripts/lib_flag_serials.py` holds the
 * same boundary for the builders, and a test pins the two together.
 */
export const SEASONAL_WAGE_REQUEST_FROM = "P-400-";

/** SQL keeping a read of `pwd_cases` to the wage request program's own numbers. `alias` ends in a dot, or is empty. */
export function pwdOwnSql(alias = ""): string {
  return `${alias}case_number < '${SEASONAL_WAGE_REQUEST_FROM}'`;
}

/** SQL keeping a read of `pwd_cases` to the seasonal programs' wage requests (H-2B and CW-1). */
export function seasonalWageRequestSql(alias = ""): string {
  return `${alias}case_number >= '${SEASONAL_WAGE_REQUEST_FROM}'`;
}

/** True for an H-2B or CW-1 wage request number. */
export function isSeasonalWageRequest(caseNumber: string): boolean {
  return /^P-/.test(caseNumber) && caseNumber >= SEASONAL_WAGE_REQUEST_FROM;
}

/** One of a program's published files, and the SQL that keeps a read to the rows that are that program's own. */
export interface ProgramFile {
  table: string;
  own: ((alias?: string) => string) | null;
}

/**
 * Each FLAG program's published files, in the order a case is looked for: the wage request program reads DOL's
 * prevailing wage file less its H-2B and CW-1 requests; the seasonal programs read their applications' file, then
 * those requests from the prevailing wage file.
 */
export const PROGRAM_FILES: Record<"pwd" | "seasonal", readonly ProgramFile[]> = {
  pwd: [{ table: "pwd_cases", own: pwdOwnSql }],
  seasonal: [
    { table: "seasonal_cases", own: null },
    { table: "pwd_cases", own: seasonalWageRequestSql },
  ],
};

/** The LEFT JOINs that bring a live row (alias `s`) its file columns, from whichever file holds the case: f0, f1... */
export function liveFileJoins(files: readonly ProgramFile[]): string {
  return files
    .map((f, i) => `LEFT JOIN ${f.table} f${i} ON f${i}.case_number = s.case_number${f.own ? ` AND ${f.own(`f${i}.`)}` : ""}`)
    .join(" ");
}

/** A joined file column, from whichever of the files has the case. */
export function liveFileCol(files: readonly ProgramFile[], col: string): string {
  return files.length === 1 ? `f0.${col}` : `COALESCE(${files.map((_, i) => `f${i}.${col}`).join(", ")})`;
}

/** The conditions a file-only read adds: the file's own rows, never one an earlier file of the program holds. */
export function fileOnlyWhere(files: readonly ProgramFile[], i: number): string {
  const f = files[i]!;
  return (
    (f.own ? ` AND ${f.own("p.")}` : "") +
    files
      .slice(0, i)
      .map((e) => ` AND NOT EXISTS (SELECT 1 FROM ${e.table} x WHERE x.case_number = p.case_number)`)
      .join("")
  );
}

/**
 * SQL keeping a read of `seasonal_case_status` to applications and job orders (C-500, H-300, H-400, JO-A-300), whose
 * numbers all sort below the wage requests'. For a count beside `seasonal_cases`, which holds applications only.
 */
export function seasonalApplicationSql(alias = ""): string {
  return `${alias}case_number < '${SEASONAL_WAGE_REQUEST_FROM}'`;
}

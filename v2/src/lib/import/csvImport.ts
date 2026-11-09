/**
 * Spreadsheet import: a sheet saved as CSV from Excel, Numbers or Google Sheets, or this app's own CSV export.
 *
 * The rows become the same objects the JSON import reads, so every rule after this one (required fields,
 * statuses, dates, duplicates, the I-140 deadline fill) applies unchanged. This file reads the CSV, matches each
 * column to a case field by its header, and turns each cell's text into that field's type. Anything it can't
 * place is reported, never dropped quietly.
 */

/** A header reduced to letters and digits, so "PWD filed", "pwd_filed" and "PWD Filed:" read the same. */
function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Every column this app's own CSV export writes, by its own name, plus the names people give them in a sheet. */
const ALIASES: Record<string, readonly string[]> = {
  employerName: ["employer", "employername", "company", "sponsor", "petitioner"],
  beneficiaryIdentifier: ["beneficiary", "beneficiaryname", "beneficiaryidentifier", "foreignworker", "worker", "employee", "candidate", "alien"],
  positionTitle: ["position", "positiontitle", "jobtitle", "title", "job", "role"],
  socCode: ["soc", "soccode", "occupationcode", "onet"],
  socTitle: ["soctitle", "occupation", "occupationtitle"],
  caseStatus: ["status", "casestatus", "stage"],
  progressStatus: ["progress", "progressstatus"],
  caseNumber: ["casenumber", "case"],
  internalCaseNumber: ["internalcasenumber", "internalnumber", "matter", "matternumber", "fileno", "filenumber", "reference"],
  pwdCaseNumber: ["pwdcasenumber", "pwdnumber", "pwcasenumber"],
  eta9089CaseNumber: ["eta9089casenumber", "permcasenumber", "9089casenumber"],
  i140ReceiptNumber: ["i140receiptnumber", "receiptnumber"],
  pwdFilingDate: ["pwdfilingdate", "pwdfiled", "pwdfiledon", "pwdsubmitted", "pwrequestfiled", "pwdrequestdate"],
  pwdDeterminationDate: ["pwddeterminationdate", "pwddetermination", "pwddetermined", "pwdissued", "pwdreceived"],
  pwdExpirationDate: ["pwdexpirationdate", "pwdexpiration", "pwdexpires", "pwdvalidthrough", "pwdexpiry"],
  pwdWageAmount: ["pwdwageamount", "pwdwage", "wage", "prevailingwage", "offeredwage"],
  pwdWageLevel: ["pwdwagelevel", "wagelevel", "level"],
  jobOrderStartDate: ["joborderstartdate", "joborderstart", "swastart", "joborderplaced"],
  jobOrderEndDate: ["joborderenddate", "joborderend", "swaend"],
  jobOrderState: ["joborderstate", "swastate", "state"],
  sundayAdFirstDate: ["sundayadfirstdate", "firstsundayad", "sundayad1", "firstad"],
  sundayAdSecondDate: ["sundayadseconddate", "secondsundayad", "sundayad2", "secondad"],
  sundayAdNewspaper: ["sundayadnewspaper", "newspaper"],
  noticeOfFilingStartDate: ["noticeoffilingstartdate", "noticeoffilingstart", "nofstart", "noticestart", "noticeposted"],
  noticeOfFilingEndDate: ["noticeoffilingenddate", "noticeoffilingend", "nofend", "noticeend", "noticeremoved"],
  additionalRecruitmentStartDate: ["additionalrecruitmentstartdate", "additionalrecruitmentstart"],
  additionalRecruitmentEndDate: ["additionalrecruitmentenddate", "additionalrecruitmentend"],
  recruitmentApplicantsCount: ["recruitmentapplicantscount", "applicants", "applicantscount"],
  isProfessionalOccupation: ["isprofessionaloccupation", "professional", "professionaloccupation"],
  eta9089FilingDate: ["eta9089filingdate", "eta9089filed", "permfiled", "permfilingdate", "9089filed", "filed"],
  eta9089AuditDate: ["eta9089auditdate", "audit", "auditdate", "audited"],
  eta9089CertificationDate: ["eta9089certificationdate", "certified", "certificationdate", "permcertified"],
  eta9089ExpirationDate: ["eta9089expirationdate", "eta9089expiration", "9089expiration", "certificationexpires"],
  eta9089DenialDate: ["eta9089denialdate", "denied", "denialdate", "permdenied"],
  eta9089ReconsiderationDate: ["eta9089reconsiderationdate", "reconsiderationdate", "reconsiderationrequested"],
  eta9089ReconsiderationDeniedDate: ["eta9089reconsiderationdenieddate", "reconsiderationdenied"],
  eta9089BalcaRequestDate: ["eta9089balcarequestdate", "balcarequestdate", "balcarequested"],
  i140FilingDate: ["i140filingdate", "i140filed"],
  i140ReceiptDate: ["i140receiptdate", "i140receipt", "i140received"],
  i140ApprovalDate: ["i140approvaldate", "i140approved"],
  i140DenialDate: ["i140denialdate", "i140denied"],
  i140Category: ["i140category", "category", "preferencecategory"],
  i140PremiumProcessing: ["i140premiumprocessing", "premiumprocessing", "premium"],
  i140ServiceCenter: ["i140servicecenter", "servicecenter"],
  priorityLevel: ["prioritylevel", "priority"],
  isFavorite: ["isfavorite", "favorite"],
  isPinned: ["ispinned", "pinned"],
  calendarSyncEnabled: ["calendarsyncenabled", "calendarsync"],
  showOnTimeline: ["showontimeline", "timeline"],
  closureReason: ["closurereason", "closedreason"],
  closedAt: ["closedat", "closed", "closeddate"],
  notes: ["notes", "note", "comments"],
};

/** Export columns that are the system's own bookkeeping: read, then set aside without a word. */
const IGNORED = new Set(["id", "createdat", "updatedat", "userid"]);

const FIELD_BY_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(ALIASES).flatMap(([field, keys]) => [[headerKey(field), field] as const, ...keys.map((k) => [k, field] as const)]),
);

const NUMBER_FIELDS = new Set(["pwdWageAmount", "recruitmentApplicantsCount"]);
const BOOLEAN_FIELDS = new Set(["isProfessionalOccupation", "isFavorite", "isPinned", "calendarSyncEnabled", "showOnTimeline", "i140PremiumProcessing"]);
export const CSV_DATE_FIELDS = new Set([
  "pwdFilingDate", "pwdDeterminationDate", "pwdExpirationDate", "jobOrderStartDate", "jobOrderEndDate",
  "sundayAdFirstDate", "sundayAdSecondDate", "noticeOfFilingStartDate", "noticeOfFilingEndDate",
  "additionalRecruitmentStartDate", "additionalRecruitmentEndDate", "eta9089FilingDate", "eta9089AuditDate",
  "eta9089CertificationDate", "eta9089ExpirationDate", "eta9089DenialDate", "eta9089ReconsiderationDate",
  "eta9089ReconsiderationDeniedDate", "eta9089BalcaRequestDate", "i140FilingDate", "i140ReceiptDate",
  "i140ApprovalDate", "i140DenialDate", "closedAt",
]);

/** The case field a column header names, or undefined. */
export function fieldForHeader(header: string): string | undefined {
  return FIELD_BY_KEY.get(headerKey(header));
}

/**
 * RFC 4180 CSV: quoted fields may hold commas, line breaks and doubled quotes. A byte order mark and
 * Windows line ends are read too. Lines with nothing in them are skipped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fullYear(y: number): number {
  return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y;
}

/**
 * A spreadsheet's date as YYYY-MM-DD, read from the text alone so the reader's time zone can't move it a day:
 * 2026-03-05, 2026/3/5, 3/5/2026 and 3/5/26 (month first, as US sheets write it, unless the first number can't be
 * a month), March 5, 2026, 5 Mar 2026, 5-Mar-26, and Excel's day numbers (46086 is March 5, 2026).
 */
export function csvDate(value: string): string | undefined {
  const s = value.trim();
  // No date is longer than this, and the cap comes before any pattern reads the cell.
  if (!s || s.length > 40) return undefined;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    return a > 12 ? iso(y, b, a) : iso(y, a, b);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mo < 0 ? undefined : iso(Number(m[3]), mo + 1, Number(m[2]));
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return mo < 0 ? undefined : iso(fullYear(Number(m[3])), mo + 1, Number(m[1]));
  }
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n >= 20000 && n <= 80000) {
      // Excel's 1900 system counts from December 30, 1899 (its leap-year bug included).
      const t = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000);
      return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
  }
  return undefined;
}

function csvBoolean(value: string): boolean | undefined {
  const s = value.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x", "✓", "✔"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return undefined;
}

function csvNumber(value: string): number | undefined {
  const s = value.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}

export interface CsvNote {
  /** The case's place among the cases read (0 is the first), or -1 for a note about the whole file. */
  row: number;
  column: string;
  message: string;
  employerName?: string;
}

export interface CsvCases {
  /** One object per row, with the case field names the JSON import reads. */
  cases: Record<string, unknown>[];
  /** Header, then the field it fills, for the columns that matched. */
  matched: Array<{ column: string; field: string }>;
  notes: CsvNote[];
}

/** A CSV's rows as case objects, with a note for every column or cell that couldn't be used as it stood. */
export function csvToCases(text: string): CsvCases {
  const out: CsvCases = { cases: [], matched: [], notes: [] };
  const [header, ...rows] = parseCsv(text);
  if (!header) return out;

  const fields: Array<string | undefined> = [];
  const taken = new Set<string>();
  header.forEach((raw) => {
    const column = raw.trim();
    const field = fieldForHeader(column);
    if (IGNORED.has(headerKey(column))) {
      fields.push(undefined);
    } else if (!field) {
      fields.push(undefined);
      if (column) out.notes.push({ row: -1, column, message: `The column "${column}" doesn't match a case field, so it was left out` });
    } else if (taken.has(field)) {
      fields.push(undefined);
      out.notes.push({ row: -1, column, message: `The column "${column}" fills the same field as an earlier column, so only the first was read` });
    } else {
      taken.add(field);
      fields.push(field);
      out.matched.push({ column, field });
    }
  });

  rows.forEach((cells, r) => {
    const sheetRow = r + 2;
    const c: Record<string, unknown> = {};
    const rowNotes: Array<Omit<CsvNote, "row" | "employerName">> = [];
    cells.forEach((rawCell, i) => {
      const field = fields[i];
      const cell = rawCell.trim();
      if (!field || cell === "") return;
      const column = header[i]!.trim();
      if (CSV_DATE_FIELDS.has(field)) {
        const d = csvDate(cell);
        // An unreadable date stays as typed: the import's own date check names it and leaves the field empty.
        c[field] = d || cell;
      } else if (NUMBER_FIELDS.has(field)) {
        const n = csvNumber(cell);
        if (n === undefined) rowNotes.push({ column, message: `"${cell}" isn't a number, so ${column} was left empty` });
        else c[field] = n;
      } else if (BOOLEAN_FIELDS.has(field)) {
        const b = csvBoolean(cell);
        if (b === undefined) rowNotes.push({ column, message: `"${cell}" isn't yes or no, so ${column} was left empty` });
        else c[field] = b;
      } else if (field === "notes") {
        c.notes = [{ id: `imported-note-${sheetRow}`, content: cell, createdAt: Date.now(), status: "pending" }];
      } else {
        c[field] = cell;
      }
    });
    if (Object.keys(c).length === 0) return;
    const row = out.cases.push(c) - 1;
    const employerName = typeof c.employerName === "string" ? c.employerName : undefined;
    for (const n of rowNotes) out.notes.push({ ...n, row, employerName });
  });
  return out;
}

/** A file to read as CSV: its name says so, or its text doesn't start the way JSON does. */
export function looksLikeCsv(name: string, text: string): boolean {
  if (/\.csv$/i.test(name)) return true;
  if (/\.json$/i.test(name)) return false;
  const start = text.replace(/^﻿/, "").trimStart()[0];
  return start !== "{" && start !== "[" && /,/.test(text.split(/\r?\n/, 1)[0] ?? "");
}

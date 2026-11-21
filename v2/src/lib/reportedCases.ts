/**
 * The cases people reported themselves, from every source this site reads, merged so each person is one case
 * (scripts/build_reported_cases.py and scripts/lib_reported_cases.py, table `reported_cases`), and the figures drawn
 * from them.
 *
 * A case names every source that holds it: a community sheet, Reddit, Telegram, Facebook (posts typed in by hand from
 * screenshots shared with us), VisaStats' tracker, or a timeline shared on this site. Two records become one case only when they agree on three dates and contradict on nothing; a
 * case that only might repeat another says so (`maybeRepeats`), and one that adds nothing to its repeat never reaches
 * a page. Usernames, names and receipt numbers never reach this site. Everything but a reviewed timeline is unchecked,
 * so a page says where each case came from.
 */
import { sheetFor, SHEETS } from "./communitySheets";

import { MS_PER_DAY } from "@/lib/time";

/** The places reported cases come from, said once (./reportedPlaces.ts): "cases people reported in ${REPORTED_PLACES}". */
export { REPORTED_COMMUNITY_PLACES, REPORTED_PLACES } from "./reportedPlaces";

export interface ReportedCase {
  id: string;
  /** The sources that hold the case, a community sheet first. */
  sources: string[];
  category: string | null;
  chargeability: string | null;
  priorityDate: string | null;
  /** A priority date given in words ("Current"). */
  priorityNote: string | null;
  receiptDate: string | null;
  biometricsDate: string | null;
  transferDate: string | null;
  approvalDate: string | null;
  cardDate: string | null;
  /** Whether a visa number was available, as the source says; null when it doesn't. */
  visaAvailable: boolean | null;
  /** The status held while waiting (H-1B, F-1 STEM OPT). */
  status: string | null;
  asOf: string | null;
  /** How many cases from other sources this one might be: two dates agree, too few to call them one person. */
  maybeRepeats: number;
}

const NAMES: Record<string, string> = {
  reddit: "Reddit",
  telegram: "Telegram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  visastats: "VisaStats",
  timeline: "a timeline shared here",
  "consular-report": "a consulate report shared here",
};

const isSheet = (key: string) => SHEETS.some((s) => s.key === key);

export function sourceName(key: string): string {
  const sheet = sheetFor(key);
  return sheet ? `the ${sheet.name} sheet` : (NAMES[key] ?? key);
}

const SHORT: Record<string, string> = { timeline: "Shared here", "consular-report": "Shared here" };

/** A table cell's name for a source: the sheet's own name, or the place ("Reddit"). */
export function shortSourceName(key: string): string {
  return sheetFor(key)?.name ?? SHORT[key] ?? NAMES[key] ?? key;
}

/** "the San Fernando Filers sheet, Reddit and Telegram". */
export function reportedIn(sources: readonly string[]): string {
  const names = sources.map(sourceName);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Every source the cases came from, each once, the sheets first and then in the order they appear. */
export function sourcesIn(rows: readonly ReportedCase[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const s of r.sources) seen.add(s);
  return [...seen].sort((a, b) => Number(isSheet(b)) - Number(isSheet(a)));
}

type Row = Record<string, string | number | null>;
const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const list = (v: unknown): string[] => {
  try {
    const parsed: unknown = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

/** A `reported_cases` row as a case. libSQL hands integers back as strings, so "0" is read as false here. */
export function fromRow(r: Row): ReportedCase {
  const sources = list(r.source_names).sort((a, b) => Number(isSheet(b)) - Number(isSheet(a)));
  const avail = text(r.visa_available);
  return {
    id: String(r.case_id),
    sources,
    category: text(r.category),
    chargeability: text(r.chargeability),
    priorityDate: text(r.priority_date),
    priorityNote: text(r.priority_note),
    receiptDate: text(r.i485_receipt),
    biometricsDate: text(r.biometrics),
    transferDate: text(r.transfer),
    approvalDate: r.i485_decision === "approved" ? text(r.i485_decided) : null,
    cardDate: text(r.card),
    visaAvailable: avail === null ? null : Number(avail) === 1,
    status: text(r.nonimmigrant_status),
    asOf: text(r.as_of),
    // A link to a row of a source this case already holds is a spouse or a batch-mate, never a repeat to flag.
    maybeRepeats: list(r.possible_dupes).filter((id) => !sources.includes(id.split(":")[0]!)).length,
  };
}

export interface TransferCohort {
  transferDate: string;
  cases: number;
  approved: number;
  /** The median days from the move to the approval, from MEDIAN_FROM approvals that came after the move. */
  medianDays: number | null;
  /** Still waiting with a visa number available: the ones people worry about. */
  waitingAvailable: number;
}

/** A median from fewer approvals than this reads as one person's case, so none is given. */
export const MEDIAN_FROM = 3;

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS_PER_DAY);

function median(xs: number[]): number | null {
  if (xs.length < MEDIAN_FROM) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Every transfer day the cases name, newest first. A case without a transfer day isn't in any. */
export function transferCohorts(rows: readonly ReportedCase[]): TransferCohort[] {
  const by = new Map<string, ReportedCase[]>();
  for (const r of rows) {
    if (!r.transferDate) continue;
    const group = by.get(r.transferDate) ?? [];
    group.push(r);
    by.set(r.transferDate, group);
  }
  return [...by.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([transferDate, group]) => {
      const approved = group.filter((r) => r.approvalDate);
      const after = approved.filter((r) => r.approvalDate! >= transferDate).map((r) => days(transferDate, r.approvalDate!));
      return {
        transferDate,
        cases: group.length,
        approved: approved.length,
        medianDays: median(after),
        waitingAvailable: group.filter((r) => !r.approvalDate && r.visaAvailable === true).length,
      };
    });
}

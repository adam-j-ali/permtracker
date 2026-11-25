/**
 * Consulate reports: what happened at a US consulate's visa interview (or drop box appointment), as the
 * person waiting reports it. The rules live here, pure, so the Convex functions, the HTTP layer, the form on
 * each consulate's page and the figures above it read one definition (the same arrangement as
 * `communityTimeline.ts`).
 *
 * WHY. State publishes two things about a post: its monthly scheduling table (the month of documentarily
 * complete cases NVC is scheduling) and its immigrant visa issuances, months late. Neither says what
 * happened at an interview last week, so these figures come from the people who went. They're
 * self-reported, and every surface says so: they're never State's data and never blended into State's.
 *
 * WHAT A REPORT HOLDS (owner, Nov 5 2026): the fields a nonimmigrant stamping tracker collects (the visa, an
 * interview or a drop box, approved at the window, a 221(g) and its slip colour, asked to email documents,
 * the passport back), so this site's own reports can stand in for that tracker's, plus the green card
 * fields (NVC's complete month, the interview letter, the visa issued).
 *
 * NO FREE TEXT, NO NAME, NO CASE NUMBER, on purpose. Every field is a date, a month or a choice from a fixed
 * list, so nothing a stranger types can reach a public page, and a report can't be traced to a case. A
 * tracker's notes box is the one field deliberately left out.
 *
 * THE FLOOR. A figure prints only over at least MIN_REPORTS reports (the timelines' floor of three). Below
 * it, a cell is one or two people's outcomes, readable by anyone who knows they reported.
 */

import { MIN_CASE_REPORTERS } from "./communityTimeline";
import { monthDay } from "./months";
import { MS_PER_DAY } from "./time";

/**
 * The kind of visa. Every kind, because everyone goes through the same posts and one person's report tells
 * every applicant there whether the post is moving (owner, Nov 5 2026); employment and the work visas come
 * first, which is the order every list and breakdown uses.
 *
 * `group` decides which questions apply: NVC's month to an immigrant visa (and the K-1, which NVC also
 * handles), the drop box, the 221(g) slip and the emailed documents to a nonimmigrant visa. "Another visa"
 * can be either, so both kinds of question are open to it. `section` is the form's grouping.
 */
export const REPORT_CATEGORIES = [
  { id: "employment", label: "Employment green card", group: "immigrant", section: "work" },
  { id: "h1b", label: "H-1B", group: "nonimmigrant", section: "work" },
  { id: "h4", label: "H-4", group: "nonimmigrant", section: "work" },
  { id: "l1", label: "L-1", group: "nonimmigrant", section: "work" },
  { id: "l2", label: "L-2", group: "nonimmigrant", section: "work" },
  { id: "family", label: "Family preference", group: "immigrant", section: "family" },
  { id: "immediate", label: "Immediate relative", group: "immigrant", section: "family" },
  { id: "k1", label: "K-1 fiancé(e)", group: "immigrant", section: "family" },
  { id: "f1", label: "F-1 student", group: "nonimmigrant", section: "study" },
  { id: "b1b2", label: "B-1/B-2 visitor", group: "nonimmigrant", section: "study" },
  { id: "other", label: "Another visa", group: "either", section: "other" },
] as const;

/** The form's groups of visas, in order. */
export const REPORT_SECTIONS = [
  { id: "work", label: "Work visas and employment green cards" },
  { id: "family", label: "Family and fiancé(e)" },
  { id: "study", label: "Study and visit" },
  { id: "other", label: "Anything else" },
] as const;
export type ReportCategoryId = (typeof REPORT_CATEGORIES)[number]["id"];

/** NVC's month applies: an immigrant visa, a K-1, or another visa. */
export function takesNvc(category: string | null | undefined): boolean {
  const c = REPORT_CATEGORIES.find((x) => x.id === category);
  return c !== undefined && c.group !== "nonimmigrant";
}
/** The drop box, the 221(g) slip and the emailed documents apply: a nonimmigrant visa, or another visa. */
export function takesNonimmigrant(category: string | null | undefined): boolean {
  const c = REPORT_CATEGORIES.find((x) => x.id === category);
  return c !== undefined && c.group !== "immigrant";
}

/**
 * What happened. A 221(g) stays a 221(g) once cleared: the day it cleared is `resolvedOn`, so the share
 * that ended in 221(g) still counts it.
 */
export const REPORT_OUTCOMES = [
  { id: "waiting", label: "No result yet" },
  { id: "approved", label: "Approved, visa not printed yet" },
  { id: "issued", label: "Visa issued" },
  { id: "passport-returned", label: "Passport back with the visa" },
  { id: "221g", label: "221(g), more processing" },
  { id: "refused", label: "Refused" },
  { id: "cancelled", label: "Interview cancelled" },
  { id: "rescheduled", label: "Interview rescheduled" },
] as const;
export type ReportOutcomeId = (typeof REPORT_OUTCOMES)[number]["id"];

export const REFUSAL_GROUNDS = [
  { id: "214b", label: "214(b)" },
  { id: "public-charge", label: "Public charge" },
  { id: "other", label: "Another ground" },
] as const;
export type RefusalGroundId = (typeof REFUSAL_GROUNDS)[number]["id"];

export const REPORT_MODES = [
  { id: "interview", label: "Interview" },
  { id: "dropbox", label: "Drop box, no interview" },
] as const;
export type ReportModeId = (typeof REPORT_MODES)[number]["id"];

/**
 * The exact category within a kind of visa, as State's visa bulletin and scheduling tool name it (owner, Nov
 * 5 2026): State schedules interviews category by category, so "Family preference" alone can't say whether
 * F2A is moving at a post. Optional, and only for the three kinds that have one.
 */
export const REPORT_LINES = [
  { id: "eb1", label: "EB-1", category: "employment" },
  { id: "eb2", label: "EB-2", category: "employment" },
  { id: "eb3", label: "EB-3", category: "employment" },
  { id: "ew", label: "EB-3 other workers", category: "employment" },
  { id: "eb4", label: "EB-4", category: "employment" },
  { id: "eb5", label: "EB-5", category: "employment" },
  { id: "f1", label: "F1", category: "family" },
  { id: "f2a", label: "F2A", category: "family" },
  { id: "f2b", label: "F2B", category: "family" },
  { id: "f3", label: "F3", category: "family" },
  { id: "f4", label: "F4", category: "family" },
  { id: "ir1", label: "Spouse (IR-1 or CR-1)", category: "immediate" },
  { id: "ir2", label: "Child (IR-2 or CR-2)", category: "immediate" },
  { id: "ir3", label: "Adopted child (IR-3, IR-4)", category: "immediate" },
  { id: "ir5", label: "Parent (IR-5)", category: "immediate" },
] as const;
export type ReportLineId = (typeof REPORT_LINES)[number]["id"];

/** The exact categories a kind of visa offers; empty when it has none. */
export function linesFor(category: string | null | undefined): readonly (typeof REPORT_LINES)[number][] {
  return REPORT_LINES.filter((l) => l.category === category);
}

/** Why the 221(g), as the officer put it; for any kind of visa. Public charge is the question people ask most. */
export const HOLD_REASONS = [
  { id: "documents", label: "Asked for documents" },
  { id: "admin", label: "Administrative processing" },
  { id: "public-charge", label: "Public charge or I-864" },
  { id: "not-told", label: "Not told why" },
] as const;
export type HoldReasonId = (typeof HOLD_REASONS)[number]["id"];

/** Who cancelled or moved the interview. */
export const CANCELLED_BY = [
  { id: "consulate", label: "The consulate" },
  { id: "me", label: "I did" },
] as const;
export type CancelledById = (typeof CANCELLED_BY)[number]["id"];

/** Outcomes where the interview didn't take place as booked: who cancelled or moved it applies. */
export const MOVED_OUTCOMES: ReadonlySet<string> = new Set(["cancelled", "rescheduled"]);

/** The colour of the 221(g) slip the officer handed back. */
export const SLIP_COLORS = [
  { id: "white", label: "White" },
  { id: "yellow", label: "Yellow" },
  { id: "pink", label: "Pink" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "unsure", label: "Not sure" },
] as const;
export type SlipColorId = (typeof SLIP_COLORS)[number]["id"];

export const YES_NO_UNSURE = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "Not sure" },
] as const;
export type YesNoUnsureId = (typeof YES_NO_UNSURE)[number]["id"];

/** A consulate page's address segment, the shape `postSlug` makes. */
export const POST_SLUG = /^[a-z0-9-]{2,60}$/;

// A consulate's page name and address segment, from State's names for it: one rule for the site's pages
// (src/lib/consular/scheduling.ts re-exports both) and for the report route's check that a report names a
// consulate the site lists (convex/http.ts, /consular-report/save).

/** A post's page address: State's name, plain. */
export function postSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*\(.*?\)/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** State's issuance tables call some posts by another name than the one people use. */
const DISPLAY: Record<string, string> = { "ait taipei": "Taipei" };

/**
 * A post's name for the page: State's issuance spelling when the post issues visas (it's the
 * tidier one: "Rio de Janeiro", "Port-au-Prince"), else the scheduling table's, without its
 * parenthetical ("Mumbai (Bombay)").
 */
export function postName(key: string, issuanceLabel: string | null | undefined, toolName: string | null | undefined): string {
  if (DISPLAY[key]) return DISPLAY[key];
  if (issuanceLabel) return issuanceLabel;
  return (toolName ?? key).replace(/\s*\(.*?\)/g, "").trim();
}

/**
 * Every figure prints only over at least this many reports: the timelines' floor. The figures themselves are the
 * server's summary (scripts/lib_reported_summary.py report_view, REPORT_FLOOR), which holds them to this number;
 * the pages' words name it from here (consular-report-view.test.ts keeps the two equal).
 */
export const MIN_REPORTS = MIN_CASE_REPORTERS;

/** The label every figure built from these reports carries. */
export const SELF_REPORTED = "Visitors' own reports, unchecked";

/** Weeks of interviews the chart draws, the newest holding today (the summary's REPORT_WEEKS). */
export const REPORT_WEEKS = 12;

/** The earliest date or month a report may carry. */
const FLOOR = "2020-01-01";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

/** What the form sends; every field optional, the server says what's missing. */
export interface ReportInput {
  post?: string | null;
  category?: string | null;
  mode?: string | null;
  nvcCompleteMonth?: string | null;
  scheduledOn?: string | null;
  interviewOn?: string | null;
  outcome?: string | null;
  refusalGround?: string | null;
  approvedOn?: string | null;
  resolvedOn?: string | null;
  slipColor?: string | null;
  askedToEmailDocs?: string | null;
  line?: string | null;
  holdReason?: string | null;
  cancelledBy?: string | null;
}

/** A checked report: the post, the category and the outcome always, the rest when given. */
export interface ReportFields {
  post: string;
  category: ReportCategoryId;
  outcome: ReportOutcomeId;
  mode?: ReportModeId;
  nvcCompleteMonth?: string;
  scheduledOn?: string;
  interviewOn?: string;
  refusalGround?: RefusalGroundId;
  approvedOn?: string;
  resolvedOn?: string;
  slipColor?: SlipColorId;
  askedToEmailDocs?: YesNoUnsureId;
  line?: ReportLineId;
  holdReason?: HoldReasonId;
  cancelledBy?: CancelledById;
}

/** The fields a save writes beyond the post, each one written so an edit can clear it. */
export const REPORT_FIELD_KEYS = [
  "category",
  "outcome",
  "mode",
  "nvcCompleteMonth",
  "scheduledOn",
  "interviewOn",
  "refusalGround",
  "approvedOn",
  "resolvedOn",
  "slipColor",
  "askedToEmailDocs",
  "line",
  "holdReason",
  "cancelledBy",
] as const;

export type ReportProblem =
  | "post"
  | "category"
  | "outcome"
  | "choice"
  | "date"
  | "no-dates"
  | "refusal-ground"
  | "approved"
  | "resolved"
  | "nvc"
  | "nonimmigrant"
  | "221g-detail"
  | "line"
  | "hold-reason"
  | "cancelled-by"
  | "order";

export type ReportCheck = { ok: true; value: ReportFields } | { ok: false; code: ReportProblem; message: string };

/** "YYYY-MM-DD", UTC. */
export function isoToday(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** An ISO day moved by whole days. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The latest day a report may carry: tomorrow in UTC. Most people reporting are abroad, and in Manila or
 * Auckland it's already tomorrow for hours of every UTC day, so "not in the future" has to allow one day.
 */
export function latestAllowedDay(today: string = isoToday()): string {
  return addDays(today, 1);
}

const blank = (raw: unknown) => raw === undefined || raw === null || raw === "";

function pick<T extends { id: string }>(list: readonly T[], raw: unknown): T["id"] | undefined | null {
  if (blank(raw)) return undefined;
  if (typeof raw !== "string" || raw.length > 24) return null;
  const hit = list.find((x) => x.id === raw);
  return hit ? hit.id : null;
}

function day(raw: unknown, latest: string): string | undefined | null {
  if (blank(raw)) return undefined;
  if (typeof raw !== "string" || !ISO_DAY.test(raw)) return null;
  // Date.parse rolls "2026-02-30" into March, so the day must print back as itself.
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== raw) return null;
  return raw < FLOOR || raw > latest ? null : raw;
}

function month(raw: unknown, latest: string): string | undefined | null {
  if (blank(raw)) return undefined;
  if (typeof raw !== "string" || !ISO_MONTH.test(raw)) return null;
  const m = Number(raw.slice(5, 7));
  if (m < 1 || m > 12) return null;
  return raw < FLOOR.slice(0, 7) || raw > latest.slice(0, 7) ? null : raw;
}

const DATE_MESSAGE = "Enter each date from 2020 on, and only dates that have happened.";

/** Outcomes that carry an approval day. */
export const APPROVED_OUTCOMES: ReadonlySet<string> = new Set(["approved", "issued", "passport-returned"]);
/** Outcomes that carry the day the visa was issued, the passport came back, or the 221(g) cleared. */
export const RESOLVED_OUTCOMES: ReadonlySet<string> = new Set(["issued", "passport-returned", "221g"]);

/**
 * Check a report field by field. The post, the category and the outcome are required, and at least one
 * date: a report with no date says nothing about when. A question that doesn't apply is refused rather than
 * quietly dropped (NVC's month on an H-1B, a slip colour without a 221(g)), because the figures would print
 * it as fact. Order is checked where it can't be otherwise: the letter before the interview, NVC's month
 * before both, then the approval, then the visa or the cleared 221(g).
 */
export function validateReport(input: ReportInput, today: string = isoToday()): ReportCheck {
  const latest = latestAllowedDay(today);
  const post = typeof input.post === "string" ? input.post : "";
  if (!POST_SLUG.test(post)) return { ok: false, code: "post", message: "That isn't a consulate this site lists." };

  const category = pick(REPORT_CATEGORIES, input.category);
  if (category === undefined) return { ok: false, code: "category", message: "Choose the kind of visa." };
  if (category === null) return { ok: false, code: "choice", message: "That kind of visa isn't one this form records." };
  const outcome = pick(REPORT_OUTCOMES, input.outcome);
  if (outcome === undefined) return { ok: false, code: "outcome", message: "Choose what happened, or No result yet." };
  if (outcome === null) return { ok: false, code: "choice", message: "That outcome isn't one this form records." };
  const choices = {
    mode: pick(REPORT_MODES, input.mode),
    refusalGround: pick(REFUSAL_GROUNDS, input.refusalGround),
    slipColor: pick(SLIP_COLORS, input.slipColor),
    askedToEmailDocs: pick(YES_NO_UNSURE, input.askedToEmailDocs),
    line: pick(REPORT_LINES, input.line),
    holdReason: pick(HOLD_REASONS, input.holdReason),
    cancelledBy: pick(CANCELLED_BY, input.cancelledBy),
  };
  if (Object.values(choices).some((x) => x === null)) {
    return { ok: false, code: "choice", message: "One of the answers isn't one this form records." };
  }
  const { mode, refusalGround, slipColor, askedToEmailDocs, line, holdReason, cancelledBy } = choices;

  const nvcCompleteMonth = month(input.nvcCompleteMonth, latest);
  const scheduledOn = day(input.scheduledOn, latest);
  const interviewOn = day(input.interviewOn, latest);
  const approvedOn = day(input.approvedOn, latest);
  const resolvedOn = day(input.resolvedOn, latest);
  if ([nvcCompleteMonth, scheduledOn, interviewOn, approvedOn, resolvedOn].some((x) => x === null)) {
    return { ok: false, code: "date", message: DATE_MESSAGE };
  }
  if (!nvcCompleteMonth && !scheduledOn && !interviewOn) {
    return {
      ok: false,
      code: "no-dates",
      message: "Add at least one date: when NVC said the case was complete, the appointment letter, or the interview.",
    };
  }

  if (nvcCompleteMonth && !takesNvc(category)) {
    return { ok: false, code: "nvc", message: "NVC's month goes with an immigrant visa or a K-1." };
  }
  if ((mode || slipColor || askedToEmailDocs) && !takesNonimmigrant(category)) {
    return { ok: false, code: "nonimmigrant", message: "The drop box and the 221(g) slip go with a nonimmigrant visa." };
  }
  if ((slipColor || askedToEmailDocs) && outcome !== "221g") {
    return { ok: false, code: "221g-detail", message: "The slip colour and the emailed documents go with a 221(g)." };
  }
  if (line && !linesFor(category).some((l) => l.id === line)) {
    return { ok: false, code: "line", message: "That category doesn't go with that kind of visa." };
  }
  if (holdReason && outcome !== "221g") {
    return { ok: false, code: "hold-reason", message: "The reason for a 221(g) goes with a 221(g) only." };
  }
  if (cancelledBy && !MOVED_OUTCOMES.has(outcome)) {
    return { ok: false, code: "cancelled-by", message: "Who cancelled it goes with a cancelled or moved interview." };
  }
  if (refusalGround && outcome !== "refused") {
    return { ok: false, code: "refusal-ground", message: "A refusal ground goes with a refusal only." };
  }
  if (approvedOn && !APPROVED_OUTCOMES.has(outcome)) {
    return { ok: false, code: "approved", message: "The approval day goes with an approved or issued visa." };
  }
  if (resolvedOn && !RESOLVED_OUTCOMES.has(outcome)) {
    return {
      ok: false,
      code: "resolved",
      message: "The day a visa was issued goes with an issued visa, a passport back, or a cleared 221(g).",
    };
  }

  // Each step no earlier than the one before it.
  const steps: [string | undefined, string][] = [
    [scheduledOn ?? undefined, "the letter"],
    [interviewOn ?? undefined, "the interview"],
    [approvedOn ?? undefined, "the approval"],
    [resolvedOn ?? undefined, "the visa or the cleared 221(g)"],
  ];
  let last: [string, string] | null = null;
  for (const [d, what] of steps) {
    if (d === undefined) continue;
    if (last && d < last[0]) {
      return { ok: false, code: "order", message: `${capital(what)} is dated before ${last[1]}.` };
    }
    last = [d, what];
  }
  const firstDay = scheduledOn ?? interviewOn;
  if (nvcCompleteMonth && firstDay && firstDay.slice(0, 7) < nvcCompleteMonth) {
    return { ok: false, code: "order", message: "The letter or the interview is dated before NVC said the case was complete." };
  }

  const value: ReportFields = { post, category, outcome };
  if (mode) value.mode = mode;
  if (nvcCompleteMonth) value.nvcCompleteMonth = nvcCompleteMonth;
  if (scheduledOn) value.scheduledOn = scheduledOn;
  if (interviewOn) value.interviewOn = interviewOn;
  if (refusalGround) value.refusalGround = refusalGround;
  if (approvedOn) value.approvedOn = approvedOn;
  if (resolvedOn) value.resolvedOn = resolvedOn;
  if (slipColor) value.slipColor = slipColor;
  if (askedToEmailDocs) value.askedToEmailDocs = askedToEmailDocs;
  if (line) value.line = line;
  if (holdReason) value.holdReason = holdReason;
  if (cancelledBy) value.cancelledBy = cancelledBy;
  return { ok: true, value };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Labels for a stored id, for the admin list. */
export const CATEGORY_LABEL: Record<ReportCategoryId, string> = Object.fromEntries(
  REPORT_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<ReportCategoryId, string>;
export const OUTCOME_LABEL: Record<ReportOutcomeId, string> = Object.fromEntries(
  REPORT_OUTCOMES.map((o) => [o.id, o.label]),
) as Record<ReportOutcomeId, string>;

/** "ciudad-juarez" to "Ciudad Juarez", for the owner's email; the consulate's page carries State's own name. */
export function postWords(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** What the owner's daily email reads from each report saved or edited that day. */
export interface ReportChange {
  post: string;
  category: string;
  outcome: string;
  refusalGround: string | null;
  interviewOn: string | null;
  line: string | null;
  holdReason: string | null;
  cancelledBy: string | null;
  createdAt: number;
  updatedAt: number;
  hidden: boolean;
}

/** The most lines one email lists; the rest are counted and left to the admin page. */
export const OWNER_LIST_MAX = 40;

/**
 * The owner's once-a-day email about consulate reports (the owner's call, Nov 5 2026: one email a day, and
 * reports post at once and are taken down after, never held for approval). One line per report saved or
 * edited after `since`, newest first, each with its consulate's page. Null on a day with none, so a quiet
 * day sends nothing. `total` is how many changed when the caller read more than it lists; `more` says the
 * read itself stopped short.
 */
export function ownerDigest(
  rows: readonly ReportChange[],
  since: number,
  siteUrl: string,
  more = false,
): { subject: string; text: string } | null {
  if (rows.length === 0) return null;
  const added = rows.filter((r) => r.createdAt > since).length;
  const edited = rows.length - added;
  const atLeast = more ? "at least " : "";
  const counts = [added ? `${atLeast}${added} new` : "", edited ? `${edited} edited` : ""].filter(Boolean).join(", ");
  const lines = rows.slice(0, OWNER_LIST_MAX).map((r) => {
    const label = CATEGORY_LABEL[r.category as ReportCategoryId] ?? r.category;
    const outcome = OUTCOME_LABEL[r.outcome as ReportOutcomeId] ?? r.outcome;
    const line = r.line ? REPORT_LINES.find((l) => l.id === r.line)?.label : undefined;
    const detail =
      (r.refusalGround ? REFUSAL_GROUNDS.find((g) => g.id === r.refusalGround)?.label : undefined) ??
      (r.holdReason ? HOLD_REASONS.find((g) => g.id === r.holdReason)?.label : undefined) ??
      (r.cancelledBy ? CANCELLED_BY.find((g) => g.id === r.cancelledBy)?.label : undefined);
    const day = monthDay(r.interviewOn);
    const parts = [`${postWords(r.post)}, ${label}${line ? `, ${line}` : ""}: ${outcome}${detail ? ` (${detail})` : ""}`];
    if (day) parts.push(`appointment ${day}`);
    parts.push(r.createdAt > since ? "new" : "edited");
    if (r.hidden) parts.push("hidden");
    return `- ${parts.join(". ")}. ${siteUrl}/consular-posts/${r.post}#reports`;
  });
  const left = rows.length - lines.length;
  const text = [
    `Consulate reports saved or changed in the last day: ${counts}.`,
    "",
    ...lines,
    ...(left > 0 ? ["", `${left} more on the admin page.`] : []),
    "",
    `A consulate's figures show only once ${MIN_REPORTS} people have reported there.`,
    `Hide or delete a report on the admin page: ${siteUrl}/admin#reviews`,
    "",
    "You get this at most once a day, and only on a day with reports.",
  ].join("\n");
  const n = rows.length;
  return { subject: `Consulate reports today: ${more ? "at least " : ""}${n} ${n === 1 ? "report" : "reports"}`, text };
}

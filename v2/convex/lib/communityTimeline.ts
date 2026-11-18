/**
 * Community timelines: what happened to a case after PERM, as the person
 * waiting reports it. The rules live here, pure, so the Convex functions, the
 * HTTP layer, the case-page form and the public board read one definition.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT. The PERM half (filed, certified) is read
 * from DOL's own record by case number and is never typed by the reporter.
 * Everything after it (I-140, I-485, work permit, travel document, interview,
 * the green card) has no public per-case source at all, so it is self-reported
 * and every surface says so. Nothing here is blended into an estimate.
 *
 * NO FREE TEXT, on purpose. Every field is a date or a choice from a fixed
 * list, so a public board built from these rows cannot carry a name, a slur,
 * an advertisement or a phone number, and needs no moderation queue to stay
 * that way. The RFE reason is a list for the same reason.
 *
 * PRIVACY. The public board never shows a case number, an employer, or an
 * exact PERM date. It shows the filing MONTH and durations in days, which is
 * what the board is for, and which cannot be turned back into a case without
 * other information.
 *
 * REVIEWED BEFORE IT SHOWS. A timeline waits for the owner (`status`), and
 * every public figure, list and count reads approved rows only (`isShown`).
 * Its author sees it at once, marked as waiting.
 */

import { USCIS_OFFICES, isCenter } from "../../src/lib/uscisOffices";
import { MS_PER_DAY } from "./time";

/** `perm` is false for a category that has no labor certification, so no PERM case number. */
export const CATEGORIES = [
  { id: "eb1", label: "EB-1", perm: false },
  { id: "eb2", label: "EB-2", perm: true },
  { id: "eb2-niw", label: "EB-2 with a national interest waiver", perm: false },
  { id: "eb3", label: "EB-3 professional or skilled", perm: true },
  { id: "eb3-other", label: "EB-3 other workers", perm: true },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** Whether a category goes through PERM, so a timeline in it can carry a PERM case number. */
export const isPermCategory = (id: string): boolean => CATEGORIES.some((c) => c.id === id && c.perm);

/** The USCIS offices a timeline can name, by USCIS's own three-letter code (src/lib/uscisOffices.json). */
const OFFICE_CHOICES: readonly { id: string }[] = USCIS_OFFICES.map((o) => ({ id: o.code }));

/**
 * The six service centers that can hold an I-485, by USCIS's own code, read from the same office list (a center has
 * no state). The receipt's first letters name the one that took it in (src/lib/uscis/receipt.ts).
 */
export const I485_CENTERS: readonly { id: string; label: string }[] = USCIS_OFFICES.filter(isCenter).map((o) => ({ id: o.code, label: o.name }));

/** Chargeability as the visa bulletin splits it. */
export const COUNTRIES = [
  { id: "row", label: "Rest of world" },
  { id: "india", label: "India" },
  { id: "china", label: "China (mainland born)" },
  { id: "mexico", label: "Mexico" },
  { id: "philippines", label: "Philippines" },
] as const;
export type CountryId = (typeof COUNTRIES)[number]["id"];

export const ROUTES = [
  { id: "adjustment", label: "Adjusting status in the US (I-485)" },
  { id: "consular", label: "Consular processing abroad" },
] as const;
export type RouteId = (typeof ROUTES)[number]["id"];

/** Whose case the timeline follows: the person the I-140 is for, or a spouse or child filing with them. */
export const APPLICANTS = [
  { id: "principal", label: "The main applicant" },
  { id: "dependent", label: "A spouse or child (a dependent)" },
] as const;
export type ApplicantId = (typeof APPLICANTS)[number]["id"];

export const I140_CENTERS = [
  { id: "nebraska", label: "Nebraska Service Center" },
  { id: "texas", label: "Texas Service Center" },
  { id: "other", label: "Another office" },
] as const;
export type I140CenterId = (typeof I140_CENTERS)[number]["id"];

/**
 * The self-reported dates, in the order a case meets them. `route` decides
 * which apply: the work permit, travel document and I-485 belong to an
 * adjustment; a consular case goes from the I-140 to an interview abroad.
 */
export const DATE_FIELDS = [
  { id: "i140FiledOn", label: "I-140 filed", short: "I-140 filed", routes: ["adjustment", "consular"] },
  { id: "i140ApprovedOn", label: "I-140 approved", short: "I-140 approved", routes: ["adjustment", "consular"] },
  { id: "i485FiledOn", label: "I-485 filed", short: "I-485 filed", routes: ["adjustment"] },
  { id: "biometricsOn", label: "Biometrics appointment", short: "Biometrics", routes: ["adjustment"] },
  { id: "eadOn", label: "Work permit (EAD) approved", short: "EAD", routes: ["adjustment"] },
  { id: "apOn", label: "Travel document (advance parole) approved", short: "Advance parole", routes: ["adjustment"] },
  { id: "i485jApprovedOn", label: "Supplement J (I-485J) approved", short: "I-485J", routes: ["adjustment"] },
  { id: "interviewOn", label: "Interview", short: "Interview", routes: ["adjustment", "consular"] },
  { id: "greenCardOn", label: "Green card approved, or immigrant visa issued", short: "Green card", routes: ["adjustment", "consular"] },
] as const;
export type DateFieldId = (typeof DATE_FIELDS)[number]["id"];

/**
 * Dates that refine a step without being a step of their own, kept apart from DATE_FIELDS so the board draws the
 * same marks: the day premium was requested when it came after filing, the move to a field office, the card in
 * the mail.
 */
export const DETAIL_DATES = [
  { id: "premiumOn", label: "Premium processing requested, if it was after filing", routes: ["adjustment", "consular"] },
  { id: "officeMovedOn", label: "Case moved to a field office", routes: ["adjustment"] },
  { id: "cardArrivedOn", label: "Green card arrived in the mail", routes: ["adjustment"] },
] as const;
export type DetailDateId = (typeof DETAIL_DATES)[number]["id"];

/** How the interview went, beside its date: a waived one has no date. */
export const INTERVIEW_OUTCOMES = [
  { id: "held", label: "Held" },
  { id: "waived", label: "Waived: approved without one" },
] as const;
export type InterviewOutcomeId = (typeof INTERVIEW_OUTCOMES)[number]["id"];

/** What a person did to move a case along, each with its day. */
export const CONTACT_KINDS = [
  { id: "service-request", label: "A service request (a case outside normal processing time)", short: "service request" },
  { id: "emma", label: "A chat with Emma or a live agent", short: "Emma or live-agent chat" },
  { id: "call", label: "A call to the USCIS Contact Center", short: "Contact Center call" },
  { id: "congressional", label: "A congressional inquiry", short: "congressional inquiry" },
  { id: "ombudsman", label: "A request to the CIS Ombudsman", short: "Ombudsman request" },
  { id: "expedite", label: "An expedite request", short: "expedite request" },
] as const;
export type ContactKindId = (typeof CONTACT_KINDS)[number]["id"];
/** The most contacts one timeline keeps. */
export const MAX_CONTACTS = 8;
export interface Contact {
  on: string;
  kind: ContactKindId;
}

export const RFE_FORMS = [
  { id: "i140", label: "I-140" },
  { id: "i485", label: "I-485" },
] as const;
export type RfeFormId = (typeof RFE_FORMS)[number]["id"];

export const RFE_REASONS = [
  { id: "ability-to-pay", label: "The employer's ability to pay the wage" },
  { id: "experience", label: "Experience letters or qualifications" },
  { id: "education", label: "A degree or its evaluation" },
  { id: "job-offer", label: "The job offer or the employer relationship" },
  { id: "perm-docs", label: "PERM documents missing or inconsistent" },
  { id: "medical", label: "The medical exam (I-693)" },
  { id: "supplement-j", label: "Supplement J or confirming the job" },
  { id: "status", label: "Immigration status history" },
  { id: "civil-docs", label: "Birth certificate or other civil documents" },
  { id: "other", label: "Something else" },
] as const;
export type RfeReasonId = (typeof RFE_REASONS)[number]["id"];

export const RFE_OUTCOMES = [
  { id: "pending", label: "Still waiting" },
  { id: "approved", label: "Approved after the response" },
  { id: "denied", label: "Denied" },
] as const;
export type RfeOutcomeId = (typeof RFE_OUTCOMES)[number]["id"];

/** One RFE: the form it was on, what it asked, its dates and how it ended. */
export interface RfeEntry {
  form: RfeFormId;
  reason?: RfeReasonId;
  issuedOn?: string;
  respondedOn?: string;
  outcome?: RfeOutcomeId;
}
/** RFEs a timeline keeps beyond its first (an RFE on the I-140 and another on the I-485, say). */
export const MAX_MORE_RFES = 3;

/** The forms an update in a person's USCIS account can sit on. */
export const EVENT_FORMS = [
  { id: "i140", label: "I-140" },
  { id: "i485", label: "I-485" },
  { id: "i765", label: "I-765 (work permit)" },
  { id: "i131", label: "I-131 (travel document)" },
  { id: "i485j", label: "I-485 Supplement J" },
] as const;
export type EventFormId = (typeof EVENT_FORMS)[number]["id"];
/** The forms that belong to an adjustment in the US, so never to a consular timeline. */
const ADJUSTMENT_FORMS: readonly EventFormId[] = ["i485", "i765", "i131", "i485j"];

/**
 * The account codes the form offers, the most-named first (filers' posts, counted Nov 11 2026). The option is the
 * code alone, exactly as the account shows it: what each one is known or reported to mean lives in the guide, never
 * in the form, because USCIS publishes no meanings. Anything else is typed under "Other".
 */
export const ACCOUNT_CODES = [
  "FTA0", "FTA1", "H008", "IAF", "FJ", "HA", "IKA", "LDA", "IMAG", "SA", "IK", "IK1", "IP", "BB", "IEA", "MBC",
] as const;
/** A code typed under "Other": 2 to 6 letters and digits, starting with a letter. Too short to carry a receipt or a phone number. */
export const TYPED_CODE = /^[A-Z][A-Z0-9]{1,5}$/;
/** The most account updates one timeline keeps. */
export const MAX_ACCOUNT_EVENTS = 30;

/** One update in a person's USCIS account: the day, the form it landed on, and the code it showed, each if known. */
export interface AccountEvent {
  on: string;
  form?: EventFormId;
  code?: string;
}

/** A code the form lists, as opposed to one somebody typed. Worked out each time, never stored. */
export const isListedCode = (code: string): boolean => (ACCOUNT_CODES as readonly string[]).includes(code);

/** The typed (unlisted) codes on a timeline, each once, sorted. */
export function typedCodes(events: readonly AccountEvent[] | undefined): string[] {
  return [...new Set((events ?? []).map((e) => e.code).filter((c): c is string => typeof c === "string" && !isListedCode(c)))].sort();
}

/** The board lists rows once this many people have shared theirs publicly (owner, Nov 11 2026; it was 25). */
export const BOARD_OPENS_AT = 10;
/** One USCIS office's own list opens once this many people there have shared theirs (owner, Nov 11 2026). */
export const OFFICE_LIST_OPENS_AT = 3;
/** A median is printed only over at least this many timelines. */
export const METRIC_MIN_N = 5;

/**
 * A case's counts show only once this many people have added dates for it. One case is one person's
 * filing, so below it the counts are that person's own progress (an I-140 approved, an I-485 filed),
 * which USCIS doesn't publish, readable by anyone who knows the case number (audit, Nov 4 2026).
 * The consulate reports (convex/lib/consularReport.ts) hold every figure to the same floor.
 */
export const MIN_CASE_REPORTERS = 3;

/** PERM numbers only: the FLAG form and the older A- form. */
export const PERM_CASE = /^(G-\d{3}-\d{5}-\d{6}|A-\d{5}-\d{5})$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The earliest date any field may carry; PERM case numbers start in 2005. */
const FLOOR = "2005-01-01";

export interface TimelineInput {
  category?: string | null;
  country?: string | null;
  route?: string | null;
  /** Whose case it is: the main applicant or a spouse or child (APPLICANTS). */
  applicant?: string | null;
  premium?: boolean | null;
  i140Center?: string | null;
  /** The USCIS office holding the I-485, by USCIS's three-letter code. */
  fieldOffice?: string | null;
  /** The service center that took the I-485 in, by USCIS's code (I485_CENTERS). */
  i485Center?: string | null;
  i140FiledOn?: string | null;
  i140ApprovedOn?: string | null;
  i485FiledOn?: string | null;
  biometricsOn?: string | null;
  eadOn?: string | null;
  apOn?: string | null;
  i485jApprovedOn?: string | null;
  interviewOn?: string | null;
  greenCardOn?: string | null;
  premiumOn?: string | null;
  officeMovedOn?: string | null;
  cardArrivedOn?: string | null;
  /** Whether the interview was held or waived (INTERVIEW_OUTCOMES). */
  interview?: string | null;
  /** What the person did to move the case, as the form sends it. */
  contacts?: readonly { on?: string | null; kind?: string | null }[] | null;
  /** Updates in the person's USCIS account, as the form sends them. */
  accountEvents?: readonly { on?: string | null; form?: string | null; code?: string | null }[] | null;
  rfeForm?: string | null;
  rfeReason?: string | null;
  rfeIssuedOn?: string | null;
  rfeRespondedOn?: string | null;
  rfeOutcome?: string | null;
  /** RFEs after the first, as the form sends them. */
  moreRfes?: readonly { form?: string | null; reason?: string | null; issuedOn?: string | null; respondedOn?: string | null; outcome?: string | null }[] | null;
  public?: boolean | null;
}

/** The validated shape, every field present and either a value or undefined. */
export interface TimelineFields {
  category?: CategoryId;
  country?: CountryId;
  route?: RouteId;
  applicant?: ApplicantId;
  premium?: boolean;
  i140Center?: I140CenterId;
  fieldOffice?: string;
  i485Center?: string;
  i140FiledOn?: string;
  i140ApprovedOn?: string;
  i485FiledOn?: string;
  biometricsOn?: string;
  eadOn?: string;
  apOn?: string;
  i485jApprovedOn?: string;
  interviewOn?: string;
  greenCardOn?: string;
  premiumOn?: string;
  officeMovedOn?: string;
  cardArrivedOn?: string;
  interview?: InterviewOutcomeId;
  /** Sorted by day, exact repeats dropped. */
  contacts?: Contact[];
  /** Sorted by day, exact repeats dropped. */
  accountEvents?: AccountEvent[];
  rfeForm?: RfeFormId;
  rfeReason?: RfeReasonId;
  rfeIssuedOn?: string;
  rfeRespondedOn?: string;
  rfeOutcome?: RfeOutcomeId;
  /** RFEs after the first, sorted by date. */
  moreRfes?: RfeEntry[];
  public: boolean;
}

/**
 * Every field a timeline takes from its author as a short string, in one list: the save writes them, the HTTP layer
 * narrows them, an edit reads them back. `premium` (yes or no) and `accountEvents` (a list) travel beside them.
 */
export const TIMELINE_TEXT_FIELDS = [
  "category", "country", "route", "applicant", "i140Center", "fieldOffice", "i485Center",
  ...DATE_FIELDS.map((f) => f.id),
  ...DETAIL_DATES.map((f) => f.id),
  "interview",
  "rfeForm", "rfeReason", "rfeIssuedOn", "rfeRespondedOn", "rfeOutcome",
] as const satisfies readonly (keyof TimelineFields & keyof TimelineInput)[];

/** The choice fields, each checked against its own list. */
export type TimelineChoiceField =
  | "category"
  | "country"
  | "route"
  | "applicant"
  | "interview"
  | "i140Center"
  | "fieldOffice"
  | "i485Center"
  | "rfeForm"
  | "rfeReason"
  | "rfeOutcome";

/**
 * Why a timeline was refused, beside the English `message`, so a page in another language can word the same
 * refusal without reading the English back.
 */
export type TimelineProblem =
  | { code: "choice"; field: TimelineChoiceField }
  | { code: "date" }
  | { code: "no-dates" }
  | { code: "i140-order" }
  | { code: "green-card-order" }
  | { code: "rfe-order" }
  | { code: "rfe-form" }
  | { code: "office-consular" }
  | { code: "adjustment-only"; field: DateFieldId | DetailDateId }
  | { code: "premium-order" }
  | { code: "card-order" }
  | { code: "office-order" }
  | { code: "interview-waived-date" }
  | { code: "contact-date" }
  | { code: "contact-kind" }
  | { code: "contact-many" }
  | { code: "rfe-many" }
  | { code: "account-date" }
  | { code: "account-form" }
  | { code: "account-code" }
  | { code: "account-many" }
  | { code: "account-consular" };

export type ValidationResult =
  | { ok: true; value: TimelineFields }
  | ({ ok: false; message: string } & TimelineProblem);

function pick<T extends { id: string }>(list: readonly T[], raw: unknown): T["id"] | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.length > 24) return null;
  const hit = list.find((x) => x.id === raw);
  return hit ? hit.id : null;
}

function isoOrUndefined(raw: unknown, today: string): string | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.length !== 10 || !ISO.test(raw)) return null;
  if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return null;
  if (raw < FLOOR || raw > today) return null;
  return raw;
}

/** "YYYY-MM-DD", UTC, for comparisons against today. */
export function isoToday(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Check a submission field by field. Every field is optional; a timeline with
 * no date at all is still refused, because there is nothing to record.
 *
 * Order is checked where it is unambiguous (an approval cannot precede its own
 * filing, an I-485 or interview cannot precede the I-140 filing, a response
 * cannot precede the RFE). Anything subtler (an EAD before the I-485 receipt
 * notice arrived, say) is left alone: a person's own dates are theirs.
 */
export function validateTimeline(input: TimelineInput, today: string = isoToday()): ValidationResult {
  const out: TimelineFields = { public: input.public === true };

  const choices: [TimelineChoiceField, readonly { id: string }[], unknown, string][] = [
    ["category", CATEGORIES, input.category, "category"],
    ["country", COUNTRIES, input.country, "country"],
    ["route", ROUTES, input.route, "route"],
    ["applicant", APPLICANTS, input.applicant, "applicant"],
    ["interview", INTERVIEW_OUTCOMES, input.interview, "interview answer"],
    ["i140Center", I140_CENTERS, input.i140Center, "I-140 office"],
    ["fieldOffice", OFFICE_CHOICES, input.fieldOffice, "USCIS office"],
    ["i485Center", I485_CENTERS, input.i485Center, "service center"],
    ["rfeForm", RFE_FORMS, input.rfeForm, "RFE form"],
    ["rfeReason", RFE_REASONS, input.rfeReason, "RFE reason"],
    ["rfeOutcome", RFE_OUTCOMES, input.rfeOutcome, "RFE outcome"],
  ];
  for (const [key, list, raw, name] of choices) {
    const v = pick(list, raw);
    if (v === null) return { ok: false, code: "choice", field: key, message: `That ${name} isn't one this form records.` };
    if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v;
  }
  if (input.premium === true || input.premium === false) out.premium = input.premium;

  const dates: [keyof TimelineFields, unknown][] = [
    ...DATE_FIELDS.map((f) => [f.id, input[f.id]] as [keyof TimelineFields, unknown]),
    ...DETAIL_DATES.map((f) => [f.id, input[f.id]] as [keyof TimelineFields, unknown]),
    ["rfeIssuedOn", input.rfeIssuedOn],
    ["rfeRespondedOn", input.rfeRespondedOn],
  ];
  for (const [key, raw] of dates) {
    const v = isoOrUndefined(raw, today);
    if (v === null) return { ok: false, code: "date", message: "Enter each date as YYYY-MM-DD, from 2005 on and not in the future." };
    if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v;
  }

  const events = readEvents(input.accountEvents, today);
  if (!events.ok) return events;
  if (events.value) out.accountEvents = events.value;

  const contacts = readContacts(input.contacts, today);
  if (!contacts.ok) return contacts;
  if (contacts.value) out.contacts = contacts.value;

  const more = readMoreRfes(input.moreRfes, today);
  if (!more.ok) return more;
  if (more.value) {
    // With no first RFE, the earliest of the rest becomes it, so every reader finds the first in its own fields.
    const list = [...more.value];
    if (out.rfeForm === undefined) {
      const head = list.shift()!;
      out.rfeForm = head.form;
      if (head.reason) out.rfeReason = head.reason;
      if (head.issuedOn) out.rfeIssuedOn = head.issuedOn;
      if (head.respondedOn) out.rfeRespondedOn = head.respondedOn;
      if (head.outcome) out.rfeOutcome = head.outcome;
    }
    if (list.length > 0) out.moreRfes = list;
  }

  const any = DATE_FIELDS.some((f) => out[f.id] !== undefined);
  if (!any) return { ok: false, code: "no-dates", message: "Add at least one date after PERM to record a timeline." };

  const before = (a?: string, b?: string) => a !== undefined && b !== undefined && b < a;
  if (before(out.i140FiledOn, out.i140ApprovedOn)) {
    return { ok: false, code: "i140-order", message: "The I-140 approval is dated before its filing." };
  }
  if (before(out.i485FiledOn, out.greenCardOn) && out.route !== "consular") {
    return { ok: false, code: "green-card-order", message: "The green card is dated before the I-485 filing." };
  }
  // An I-485 filed before the I-140 is NOT checked: concurrent filing puts
  // them in on the same day, and a refiled or upgraded I-140 can carry a
  // later date than the I-485 it supports. A person's own dates are theirs.
  if (before(out.i140FiledOn, out.premiumOn)) {
    return { ok: false, code: "premium-order", message: "Premium processing is dated before the I-140 filing." };
  }
  if (before(out.greenCardOn, out.cardArrivedOn)) {
    return { ok: false, code: "card-order", message: "The card arrived before its approval date." };
  }
  if (before(out.i485FiledOn, out.officeMovedOn)) {
    return { ok: false, code: "office-order", message: "The move to a field office is dated before the I-485 filing." };
  }
  if (out.interview === "waived" && out.interviewOn !== undefined) {
    return { ok: false, code: "interview-waived-date", message: "A waived interview has no date. Remove the date, or say it was held." };
  }
  if (before(out.rfeIssuedOn, out.rfeRespondedOn)) {
    return { ok: false, code: "rfe-order", message: "The RFE response is dated before the RFE." };
  }
  const rfeAny = out.rfeForm || out.rfeReason || out.rfeIssuedOn || out.rfeRespondedOn || out.rfeOutcome;
  if (rfeAny && !out.rfeForm) {
    return { ok: false, code: "rfe-form", message: "Say which form the RFE was on." };
  }
  if (out.route === "consular") {
    if (out.fieldOffice !== undefined || out.i485Center !== undefined) {
      return {
        ok: false,
        code: "office-consular",
        message: "A USCIS office applies to an adjustment in the US. A consular case has none.",
      };
    }
    if (out.accountEvents?.some((e) => e.form !== undefined && ADJUSTMENT_FORMS.includes(e.form))) {
      return {
        ok: false,
        code: "account-consular",
        message: "An account update on the I-485, a work permit or a travel document belongs to an adjustment in the US, not consular processing.",
      };
    }
    // An adjustment-only date on a consular timeline is a contradiction the
    // board would print as fact. Refuse it rather than silently dropping it.
    for (const f of [...DATE_FIELDS, ...DETAIL_DATES]) {
      if (out[f.id] !== undefined && !(f.routes as readonly string[]).includes("consular")) {
        return {
          ok: false,
          code: "adjustment-only",
          field: f.id,
          message: `${f.label} applies to an adjustment in the US, not consular processing.`,
        };
      }
    }
  }
  return { ok: true, value: out };
}

/**
 * The account updates as sent: each needs a day; a form and a code are optional. A typed code is upper-cased, and one
 * that matches a listed code is the listed code. Sorted by day, then form, then code; an exact repeat is dropped.
 */
function readEvents(
  raw: TimelineInput["accountEvents"],
  today: string,
): { ok: true; value: AccountEvent[] | undefined } | ({ ok: false; message: string } & TimelineProblem) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, code: "account-date", message: "Enter each account date as YYYY-MM-DD, from 2005 on and not in the future." };
  if (raw.length > MAX_ACCOUNT_EVENTS) {
    return { ok: false, code: "account-many", message: `That's more than ${MAX_ACCOUNT_EVENTS} account updates. Keep the ${MAX_ACCOUNT_EVENTS} that matter most to you.` };
  }
  const seen = new Map<string, AccountEvent>();
  for (const e of raw) {
    const on = isoOrUndefined(e?.on, today);
    if (on === undefined || on === null) {
      return { ok: false, code: "account-date", message: "Enter each account date as YYYY-MM-DD, from 2005 on and not in the future." };
    }
    const form = pick(EVENT_FORMS, e?.form);
    if (form === null) return { ok: false, code: "account-form", message: "That form isn't one this form records." };
    const typed = typeof e?.code === "string" ? e.code.trim().toUpperCase() : e?.code;
    let code: string | undefined;
    if (typed !== undefined && typed !== null && typed !== "") {
      if (typeof typed !== "string" || !TYPED_CODE.test(typed)) {
        return { ok: false, code: "account-code", message: "A typed code is 2 to 6 letters and digits and starts with a letter, like FTA0." };
      }
      code = typed;
    }
    const event: AccountEvent = { on, ...(form !== undefined ? { form } : {}), ...(code !== undefined ? { code } : {}) };
    seen.set(`${on}|${form ?? ""}|${code ?? ""}`, event);
  }
  const value = [...seen.values()].sort(
    (a, b) => a.on.localeCompare(b.on) || (a.form ?? "").localeCompare(b.form ?? "") || (a.code ?? "").localeCompare(b.code ?? ""),
  );
  return { ok: true, value: value.length > 0 ? value : undefined };
}

/** The RFEs after the first, as sent: each needs its form; its reason, outcome and dates are checked like the first's. */
function readMoreRfes(
  raw: TimelineInput["moreRfes"],
  today: string,
): { ok: true; value: RfeEntry[] | undefined } | ({ ok: false; message: string } & TimelineProblem) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, code: "rfe-form", message: "Say which form each RFE was on." };
  if (raw.length > MAX_MORE_RFES) {
    return { ok: false, code: "rfe-many", message: `A timeline keeps ${MAX_MORE_RFES + 1} RFEs at most. Keep the ones that matter most to you.` };
  }
  const out: RfeEntry[] = [];
  for (const e of raw) {
    const form = pick(RFE_FORMS, e?.form);
    if (form === undefined || form === null) return { ok: false, code: "rfe-form", message: "Say which form each RFE was on." };
    const reason = pick(RFE_REASONS, e?.reason);
    if (reason === null) return { ok: false, code: "choice", field: "rfeReason", message: "That RFE reason isn't one this form records." };
    const outcome = pick(RFE_OUTCOMES, e?.outcome);
    if (outcome === null) return { ok: false, code: "choice", field: "rfeOutcome", message: "That RFE outcome isn't one this form records." };
    const issuedOn = isoOrUndefined(e?.issuedOn, today);
    const respondedOn = isoOrUndefined(e?.respondedOn, today);
    if (issuedOn === null || respondedOn === null) return { ok: false, code: "date", message: "Enter each date as YYYY-MM-DD, from 2005 on and not in the future." };
    if (issuedOn && respondedOn && respondedOn < issuedOn) return { ok: false, code: "rfe-order", message: "The RFE response is dated before the RFE." };
    out.push({ form, ...(reason ? { reason } : {}), ...(issuedOn ? { issuedOn } : {}), ...(respondedOn ? { respondedOn } : {}), ...(outcome ? { outcome } : {}) });
  }
  out.sort((a, b) => (a.issuedOn ?? "").localeCompare(b.issuedOn ?? ""));
  return { ok: true, value: out.length > 0 ? out : undefined };
}

/** Every RFE a timeline reports: the first, kept in its own fields, then the rest. */
export function rfesOf(r: Pick<TimelineFields, "rfeForm" | "rfeReason" | "rfeIssuedOn" | "rfeRespondedOn" | "rfeOutcome" | "moreRfes">): RfeEntry[] {
  const first: RfeEntry[] = r.rfeForm
    ? [{ form: r.rfeForm, reason: r.rfeReason, issuedOn: r.rfeIssuedOn, respondedOn: r.rfeRespondedOn, outcome: r.rfeOutcome }]
    : [];
  return [...first, ...(r.moreRfes ?? [])];
}

/** What the person did, as sent: each needs a day and a kind from CONTACT_KINDS. Sorted by day; an exact repeat is dropped. */
function readContacts(
  raw: TimelineInput["contacts"],
  today: string,
): { ok: true; value: Contact[] | undefined } | ({ ok: false; message: string } & TimelineProblem) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const bad = { ok: false as const, code: "contact-date" as const, message: "Enter each date you contacted someone as YYYY-MM-DD, from 2005 on and not in the future." };
  if (!Array.isArray(raw)) return bad;
  if (raw.length > MAX_CONTACTS) {
    return { ok: false, code: "contact-many", message: `That's more than ${MAX_CONTACTS} contacts. Keep the ${MAX_CONTACTS} that matter most to you.` };
  }
  const seen = new Map<string, Contact>();
  for (const c of raw) {
    const on = isoOrUndefined(c?.on, today);
    if (on === undefined || on === null) return bad;
    const kind = pick(CONTACT_KINDS, c?.kind);
    if (kind === undefined || kind === null) return { ok: false, code: "contact-kind", message: "Pick what you did from the list." };
    seen.set(`${on}|${kind}`, { on, kind });
  }
  const value = [...seen.values()].sort((a, b) => a.on.localeCompare(b.on) || a.kind.localeCompare(b.kind));
  return { ok: true, value: value.length > 0 ? value : undefined };
}

/** Whole days from `a` to `b`, both ISO; null when either is missing. */
export function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / MS_PER_DAY);
}

/** The stored row, as the board sees it: the verified PERM half plus the fields. */
export interface TimelineRecord extends TimelineFields {
  /** DOL's filing date for the case, when found. Never typed by the reporter. */
  permFiledOn?: string;
  /** DOL's certification date, when found. */
  permCertifiedOn?: string;
  /** Where the certification date came from. */
  permCertifiedSource?: "disclosure" | "observed";
  /** The owner's decision. A row from before reviews existed has none until the backfill marks it approved. */
  status?: TimelineStatus;
  hiddenAt?: number;
  updatedAt: number;
}

export const TIMELINE_STATUSES = ["pending", "approved", "declined"] as const;
export type TimelineStatus = (typeof TIMELINE_STATUSES)[number];

/** Why the owner kept a timeline off the site. A fixed list: a timeline has no words, so neither does this. */
export const DECLINE_REASONS = [
  { id: "implausible", label: "Dates that can't be right" },
  { id: "duplicate", label: "A second copy of one timeline" },
  { id: "spam", label: "A test, or spam" },
] as const;
export type DeclineReasonId = (typeof DECLINE_REASONS)[number]["id"];

/**
 * Whether a row may reach any public surface: approved by the owner and not hidden. The one test every
 * public read applies, so a waiting or declined timeline can't count toward a figure by mistake.
 */
export function isShown(r: { status?: TimelineStatus; hiddenAt?: number }): boolean {
  return r.status === "approved" && r.hiddenAt === undefined;
}

/**
 * A stage the board measures: from one milestone to the next. `from` may be
 * the verified PERM certification. Premium is split out where it decides the
 * answer (the I-140), because a median across premium and regular filings is
 * a number that describes nobody.
 */
export const METRICS = [
  { id: "perm", label: "PERM filed to certified", from: "permFiledOn", to: "permCertifiedOn", verified: true },
  { id: "cert-to-i140", label: "PERM certified to I-140 filed", from: "permCertifiedOn", to: "i140FiledOn", verified: false },
  { id: "i140-premium", label: "I-140 to approved, premium", from: "i140FiledOn", fromFirst: "premiumOn", to: "i140ApprovedOn", premium: true, verified: false },
  { id: "i140-regular", label: "I-140 filed to approved, regular", from: "i140FiledOn", to: "i140ApprovedOn", premium: false, verified: false },
  { id: "i485-bio", label: "I-485 filed to biometrics", from: "i485FiledOn", to: "biometricsOn", verified: false },
  { id: "i485-ead", label: "I-485 filed to work permit", from: "i485FiledOn", to: "eadOn", verified: false },
  { id: "i485-office", label: "I-485 filed to the move to a field office", from: "i485FiledOn", to: "officeMovedOn", verified: false },
  { id: "i485-interview", label: "I-485 filed to interview", from: "i485FiledOn", to: "interviewOn", verified: false },
  { id: "i485-gc", label: "I-485 filed to green card", from: "i485FiledOn", to: "greenCardOn", verified: false },
  { id: "gc-card", label: "Green card approved to the card in the mail", from: "greenCardOn", to: "cardArrivedOn", verified: false },
  // One value per RFE (rfesOf). The decision after an RFE is the I-140's approval or the green card, by its form.
  { id: "rfe-answer", label: "RFE issued to answered", from: "rfeIssuedOn", to: "rfeRespondedOn", perRfe: "answer", verified: false },
  { id: "rfe-decision", label: "RFE answered to approved", from: "rfeRespondedOn", to: "i140ApprovedOn", perRfe: "decision", verified: false },
] as const;
export type MetricId = (typeof METRICS)[number]["id"];

/** The stages one USCIS office's page measures: everything counted from the I-485 filing. */
export const OFFICE_METRIC_IDS: readonly MetricId[] = ["i485-bio", "i485-ead", "i485-office", "i485-interview", "i485-gc"];

export interface MetricResult {
  id: MetricId;
  label: string;
  verified: boolean;
  n: number;
  /** Null below METRIC_MIN_N: too few to print a median. */
  median: number | null;
  p25: number | null;
  p75: number | null;
}

/** Nearest-rank percentile over a sorted list; the lists here are small. */
function nearestRank(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i] as number;
}

/**
 * Medians per stage. A negative duration (a date typed in the wrong box, or a
 * PERM certification after the reporter's own I-140 date, which cannot
 * happen) is dropped rather than averaged in, and the count says what was used.
 */
export function computeMetrics(records: readonly TimelineRecord[]): MetricResult[] {
  const live = records.filter((r) => r.hiddenAt === undefined);
  return METRICS.map((m) => {
    const vals: number[] = [];
    for (const r of live) {
      if ("premium" in m && r.premium !== m.premium) continue;
      const at = r as unknown as Record<string, string | undefined>;
      // Premium requested after filing starts its own clock; asked at filing, the filing is the start.
      const from = "fromFirst" in m && at[m.fromFirst] && at[m.fromFirst]! > (at[m.from] ?? "") ? at[m.fromFirst] : at[m.from];
      if ("perRfe" in m) {
        for (const e of rfesOf(r)) {
          const end = m.perRfe === "answer" ? e.respondedOn : e.form === "i140" ? r.i140ApprovedOn : r.greenCardOn;
          const d = daysBetween(m.perRfe === "answer" ? e.issuedOn : e.respondedOn, end);
          if (d !== null && d >= 0 && d <= 3650) vals.push(d);
        }
        continue;
      }
      const d = daysBetween(from, at[m.to]);
      if (d !== null && d >= 0 && d <= 3650) vals.push(d);
    }
    vals.sort((a, b) => a - b);
    const enough = vals.length >= METRIC_MIN_N;
    return {
      id: m.id,
      label: m.label,
      verified: m.verified,
      n: vals.length,
      median: enough ? nearestRank(vals, 0.5) : null,
      p25: enough ? nearestRank(vals, 0.25) : null,
      p75: enough ? nearestRank(vals, 0.75) : null,
    };
  });
}

export interface RfeSummary {
  total: number;
  byForm: { id: RfeFormId; label: string; count: number }[];
  byReason: { id: RfeReasonId; label: string; count: number }[];
  byOutcome: { id: RfeOutcomeId; label: string; count: number }[];
}

export function summarizeRfes(records: readonly TimelineRecord[]): RfeSummary {
  const rfes = records.filter((r) => r.hiddenAt === undefined).flatMap((r) => rfesOf(r));
  const count = <T extends { id: string; label: string }>(list: readonly T[], key: keyof RfeEntry) =>
    list
      .map((x) => ({ id: x.id as T["id"], label: x.label, count: rfes.filter((e) => e[key] === x.id).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
  return {
    total: rfes.length,
    byForm: count(RFE_FORMS, "form"),
    byReason: count(RFE_REASONS, "reason"),
    byOutcome: count(RFE_OUTCOMES, "outcome"),
  };
}

/** A row's account updates for the public: how many, each code once, and the newest as days from the row's start. */
export interface UpdatesSummary {
  count: number;
  codes: string[];
  /** Days from the row's own start (the PERM filing on the board, the I-485 filing on an office's list); null without one. */
  lastDay: number | null;
}

function updatesOf(r: TimelineRecord, origin: string | null): UpdatesSummary | null {
  const events = r.accountEvents ?? [];
  const last = events[events.length - 1];
  if (!last) return null;
  const codes = [...new Set(events.map((e) => e.code).filter((c): c is string => typeof c === "string"))];
  const day = origin ? daysBetween(origin, last.on) : null;
  return { count: events.length, codes, lastDay: day !== null && day >= 0 ? day : null };
}

/**
 * How many shown timelines report each account code, the most reported first. A code is printed once METRIC_MIN_N
 * timelines report it, typed codes too, so one person's code is never a line of its own.
 */
export function tallyCodes(records: readonly TimelineRecord[]): { code: string; timelines: number; listed: boolean }[] {
  const by = new Map<string, number>();
  for (const r of records) {
    if (r.hiddenAt !== undefined) continue;
    for (const c of new Set((r.accountEvents ?? []).map((e) => e.code).filter((x): x is string => typeof x === "string"))) {
      by.set(c, (by.get(c) ?? 0) + 1);
    }
  }
  return [...by.entries()]
    .filter(([, n]) => n >= METRIC_MIN_N)
    .map(([code, timelines]) => ({ code, timelines, listed: isListedCode(code) }))
    .sort((a, b) => b.timelines - a.timelines || a.code.localeCompare(b.code));
}

/** A timeline updated this recently still counts as waiting; one quiet longer isn't known to be. */
export const STILL_WAITING_DAYS = 60;

export interface ThirdFta0 {
  /** Shown timelines whose I-485 shows a third FTA0. */
  reported: number;
  /** Of those, with a green card dated on or after it, and the median days from the third FTA0 to the card. */
  withCard: number;
  medianToCard: number | null;
  /** Of those, with no green card and updated within STILL_WAITING_DAYS, and the median days waited since. */
  waiting: number;
  medianWaiting: number | null;
}

/**
 * "A third FTA0 means approval is close" is the group's most repeated reading, and the only count online holds
 * approved cases alone. This counts both halves from shown timelines: who got a card after it, and who is still
 * waiting. A median prints from METRIC_MIN_N timelines; the counts always print. What people saw, never a forecast.
 */
export function thirdFta0(records: readonly TimelineRecord[], today: string = isoToday()): ThirdFta0 {
  const toCard: number[] = [];
  const waited: number[] = [];
  let reported = 0;
  for (const r of records) {
    if (r.hiddenAt !== undefined) continue;
    const third = (r.accountEvents ?? []).filter((e) => e.form === "i485" && e.code === "FTA0").map((e) => e.on).sort()[2];
    if (!third) continue;
    reported += 1;
    const card = daysBetween(third, r.greenCardOn);
    if (card !== null && card >= 0) {
      toCard.push(card);
      continue;
    }
    const quiet = daysBetween(new Date(r.updatedAt).toISOString().slice(0, 10), today);
    const since = daysBetween(third, today);
    if (!r.greenCardOn && quiet !== null && quiet <= STILL_WAITING_DAYS && since !== null && since >= 0) waited.push(since);
  }
  const median = (xs: number[]) => (xs.length >= METRIC_MIN_N ? nearestRank([...xs].sort((a, b) => a - b), 0.5) : null);
  return { reported, withCard: toCard.length, medianToCard: median(toCard), waiting: waited.length, medianWaiting: median(waited) };
}

export interface ContactsSummary {
  count: number;
  /** Each kind once, in the order the person first did it. */
  kinds: ContactKindId[];
}

/** A row's contacts as a count and their kinds, never their days. */
export function contactsOf(r: TimelineRecord): ContactsSummary | null {
  const list = r.contacts ?? [];
  if (list.length === 0) return null;
  return { count: list.length, kinds: [...new Set(list.map((c) => c.kind))] };
}

export interface ContactOutcome {
  kind: ContactKindId;
  label: string;
  /** Timelines reporting at least one contact of this kind. */
  reported: number;
  /** Of those, how many have a green card dated after the first such contact. */
  withCard: number;
  /** Days from the first contact of the kind to the card, at METRIC_MIN_N cards or more; null below. */
  medianToCard: number | null;
  /** Still waiting, edited within STILL_WAITING_DAYS, with no card. */
  waiting: number;
}

/** After each kind of contact: how many got a green card and how soon. A person's own effort, never a promise of what it does. */
export function contactOutcomes(records: readonly TimelineRecord[], today: string = isoToday()): ContactOutcome[] {
  return CONTACT_KINDS.map((k) => {
    const toCard: number[] = [];
    let reported = 0;
    let waiting = 0;
    for (const r of records) {
      if (r.hiddenAt !== undefined) continue;
      const first = (r.contacts ?? []).filter((c) => c.kind === k.id).map((c) => c.on).sort()[0];
      if (!first) continue;
      reported += 1;
      const card = daysBetween(first, r.greenCardOn);
      if (card !== null && card >= 0) {
        toCard.push(card);
        continue;
      }
      const quiet = daysBetween(new Date(r.updatedAt).toISOString().slice(0, 10), today);
      if (!r.greenCardOn && quiet !== null && quiet <= STILL_WAITING_DAYS) waiting += 1;
    }
    const median = toCard.length >= METRIC_MIN_N ? nearestRank([...toCard].sort((a, b) => a - b), 0.5) : null;
    return { kind: k.id, label: k.short, reported, withCard: toCard.length, medianToCard: median, waiting };
  });
}

/** Of the green cards whose timeline says how the interview went (an answer or a date), how many were waived. */
export function interviewShare(records: readonly TimelineRecord[]): { answered: number; waived: number } {
  const told = records.filter((r) => r.hiddenAt === undefined && r.greenCardOn && (r.interview !== undefined || r.interviewOn !== undefined));
  return { answered: told.length, waived: told.filter((r) => r.interview === "waived").length };
}

/** One row of the public board: no case number, no employer, no exact PERM date. */
export interface BoardRow {
  /** "YYYY-MM": the PERM filing month, the priority-date month. */
  filedMonth: string | null;
  category: CategoryId | null;
  country: CountryId | null;
  route: RouteId | null;
  /** Whose case: the main applicant or a dependent; null when not given. */
  applicant: ApplicantId | null;
  /** Held or waived; null when not given. */
  interview: InterviewOutcomeId | null;
  /** How many times the person contacted someone, and the kinds in order; never the days. Null when none. */
  contacts: ContactsSummary | null;
  premium: boolean | null;
  /** Days from PERM filing to each stop, in DATE_FIELDS order; null when not reported. */
  stops: { id: DateFieldId | "permCertifiedOn"; day: number | null; month: string | null }[];
  /** True when the PERM half was found in DOL's record. */
  permVerified: boolean;
  /** The first RFE; `rfes` holds every one. */
  rfe: { form: RfeFormId; reason: RfeReasonId | null; outcome: RfeOutcomeId | null } | null;
  rfes: { form: RfeFormId; reason: RfeReasonId | null; outcome: RfeOutcomeId | null }[];
  /** The USCIS office's code, only when that office's own list is open; null otherwise. */
  office: string | null;
  /** The service center's code, only when enough shared timelines name it; null otherwise. */
  center: string | null;
  updates: UpdatesSummary | null;
  updatedMonth: string;
}

/** `showOffice`, `showCenter`: the caller has checked that enough shared timelines name this row's office or center. */
export function toBoardRow(r: TimelineRecord, showOffice = false, showCenter = false): BoardRow {
  const origin = r.permFiledOn ?? null;
  const stop = (id: DateFieldId | "permCertifiedOn") => {
    const iso = (r as unknown as Record<string, string | undefined>)[id];
    return { id, day: origin && iso ? daysBetween(origin, iso) : null, month: iso ? iso.slice(0, 7) : null };
  };
  return {
    filedMonth: origin ? origin.slice(0, 7) : null,
    category: r.category ?? null,
    country: r.country ?? null,
    route: r.route ?? null,
    applicant: r.applicant ?? null,
    interview: r.interview ?? null,
    contacts: contactsOf(r),
    premium: r.premium ?? null,
    stops: [stop("permCertifiedOn"), ...DATE_FIELDS.map((f) => stop(f.id))],
    permVerified: Boolean(r.permFiledOn && r.permCertifiedOn),
    rfe: rfesOf(r).map((e) => ({ form: e.form, reason: e.reason ?? null, outcome: e.outcome ?? null }))[0] ?? null,
    rfes: rfesOf(r).map((e) => ({ form: e.form, reason: e.reason ?? null, outcome: e.outcome ?? null })),
    office: showOffice ? (r.fieldOffice ?? null) : null,
    center: showCenter ? (r.i485Center ?? null) : null,
    updates: updatesOf(r, origin),
    updatedMonth: new Date(r.updatedAt).toISOString().slice(0, 7),
  };
}

/** The approvals a week's count looks for, each a date a timeline carries. */
export const RECENT_STEPS = [
  { id: "eadOn", label: "Work permits (EAD)" },
  { id: "apOn", label: "Travel documents (advance parole)" },
  { id: "greenCardOn", label: "Green cards" },
  { id: "i140ApprovedOn", label: "I-140 approvals" },
] as const satisfies readonly { id: DateFieldId; label: string }[];
/** The days a week's count covers, today included. */
export const RECENT_DAYS = 7;
/**
 * A week's count prints once this many timelines report the step. Below it the count would say that one or two
 * people had an approval that week, close to reading their own dates, which the board never prints.
 */
export const RECENT_MIN = 3;

export interface RecentApprovals {
  /** "YYYY-MM-DD", the window's first day and its last (today), both counted. */
  from: string;
  through: string;
  /** In RECENT_STEPS order; `count` is null below RECENT_MIN (none, one or two). */
  steps: { id: (typeof RECENT_STEPS)[number]["id"]; label: string; count: number | null }[];
}

/** The approvals timelines report on a day in the last RECENT_DAYS days, `today` (an Eastern "YYYY-MM-DD") included. */
export function recentApprovals(records: readonly TimelineRecord[], today: string): RecentApprovals {
  if (!ISO.test(today) || Number.isNaN(Date.parse(`${today}T00:00:00Z`))) throw new Error(`Not a day: ${today}`);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (RECENT_DAYS - 1) * MS_PER_DAY).toISOString().slice(0, 10);
  return {
    from,
    through: today,
    steps: RECENT_STEPS.map((s) => {
      const n = records.filter((r) => {
        const on = r[s.id];
        return on !== undefined && on >= from && on <= today;
      }).length;
      return { id: s.id, label: s.label, count: n >= RECENT_MIN ? n : null };
    }),
  };
}

/** The steps an office's list draws, each counted in days from the I-485 filing. */
export const OFFICE_STOPS = ["biometricsOn", "eadOn", "apOn", "i485jApprovedOn", "interviewOn", "greenCardOn"] as const;
export type OfficeStopId = (typeof OFFICE_STOPS)[number];

/** One row of a USCIS office's list: no case number, no employer, no exact date. */
export interface OfficeRow {
  /** "YYYY-MM": the month the I-485 was filed; null when the person didn't give it. */
  filedMonth: string | null;
  category: CategoryId | null;
  country: CountryId | null;
  applicant: ApplicantId | null;
  interview: InterviewOutcomeId | null;
  contacts: ContactsSummary | null;
  /** Days from the I-485 filing to each step, in OFFICE_STOPS order; null when not reported or not countable. */
  stops: { id: OfficeStopId; day: number | null; month: string | null }[];
  /** An RFE on the I-485, and how it ended; null when none was reported. */
  rfe: { outcome: RfeOutcomeId | null } | null;
  updates: UpdatesSummary | null;
  updatedMonth: string;
}

export function toOfficeRow(r: TimelineRecord): OfficeRow {
  const origin = r.i485FiledOn ?? null;
  return {
    filedMonth: origin ? origin.slice(0, 7) : null,
    category: r.category ?? null,
    country: r.country ?? null,
    applicant: r.applicant ?? null,
    interview: r.interview ?? null,
    contacts: contactsOf(r),
    stops: OFFICE_STOPS.map((id) => {
      const iso = r[id];
      const day = origin && iso ? daysBetween(origin, iso) : null;
      return { id, day: day !== null && day >= 0 ? day : null, month: iso ? iso.slice(0, 7) : null };
    }),
    rfe: ((e) => (e ? { outcome: e.outcome ?? null } : null))(rfesOf(r).find((e) => e.form === "i485")),
    updates: updatesOf(r, origin),
    updatedMonth: new Date(r.updatedAt).toISOString().slice(0, 7),
  };
}

/**
 * What the owner should look at before approving: plain sentences for the dates that sit oddly together.
 * A hint, never a refusal: a person's own dates are theirs, and the form already refuses the impossible ones.
 */
export function reviewFlags(r: TimelineRecord & { caseNumber?: string; permCheckedAt?: number }): string[] {
  const flags: string[] = [];
  const gap = (a?: string, b?: string) => daysBetween(a, b);
  const gc = gap(r.i485FiledOn, r.greenCardOn);
  if (gc !== null && gc < 30 && r.route !== "consular") flags.push(`The green card is dated ${gc} days after the I-485 filing.`);
  const certToI140 = gap(r.permCertifiedOn, r.i140FiledOn);
  if (certToI140 !== null && certToI140 < 0) flags.push("The I-140 is dated before DOL certified the PERM.");
  const bio = gap(r.i485FiledOn, r.biometricsOn);
  if (bio !== null && bio < 0) flags.push("Biometrics is dated before the I-485 filing.");
  if (r.caseNumber && r.permCheckedAt !== undefined && !r.permFiledOn) flags.push("DOL's record has no case with this number.");
  const typed = DATE_FIELDS.map((f) => r[f.id]).filter((x): x is string => typeof x === "string");
  if (typed.length >= 3 && new Set(typed).size === 1) flags.push("Every date is the same day.");
  for (const code of typedCodes(r.accountEvents)) flags.push(`A typed code: ${code}.`);
  const events = r.accountEvents ?? [];
  if (r.i485FiledOn && events.some((e) => e.form === "i485" && e.on < r.i485FiledOn!)) {
    flags.push("An account update on the I-485 is dated before the I-485 filing.");
  }
  const perDay = new Map<string, number>();
  for (const e of events) perDay.set(e.on, (perDay.get(e.on) ?? 0) + 1);
  if ([...perDay.values()].some((n) => n > 10)) flags.push("More than 10 account updates on one day.");
  return flags;
}

/**
 * Add what another source read (the account reader) to a form the person may already have filled. Their own answers
 * stay: a field is filled only where it's empty. Account updates are added, exact repeats dropped, and only the
 * newest MAX_ACCOUNT_EVENTS kept, so the form never refuses what it was handed.
 */
export function mergeIntoTimeline(form: TimelineInput, add: TimelineInput): TimelineInput {
  const out: TimelineInput = { ...form };
  for (const [k, v] of Object.entries(add) as [keyof TimelineInput, unknown][]) {
    if (k === "accountEvents" || v === undefined || v === null || v === "") continue;
    const have = out[k];
    if (have === undefined || have === null || have === "") (out as Record<string, unknown>)[k] = v;
  }
  const key = (e: { on?: string | null; form?: string | null; code?: string | null }) =>
    `${e.on ?? ""}|${e.form ?? ""}|${(e.code ?? "").trim().toUpperCase()}`;
  const events = new Map<string, NonNullable<TimelineInput["accountEvents"]>[number]>();
  // The person's own copy of an update wins over the one handed in.
  for (const e of [...(form.accountEvents ?? []), ...(add.accountEvents ?? [])]) if (!events.has(key(e))) events.set(key(e), e);
  const merged = [...events.values()].sort((a, b) => (a.on ?? "").localeCompare(b.on ?? "")).slice(-MAX_ACCOUNT_EVENTS);
  if (merged.length > 0) out.accountEvents = merged;
  return out;
}

/**
 * The line beside a form: how many have shared, and how many more open the list it joins. `list` names that list
 * ("this office's list", "the board's list").
 */
export function shareProgress(shared: number, opensAt: number, list: string): string {
  const people = `${shared} ${shared === 1 ? "person has" : "people have"} shared so far.`;
  if (shared >= opensAt) return people;
  const more = opensAt - shared;
  return `${people} ${more} more ${more === 1 ? "opens" : "open"} ${list}.`;
}

/**
 * What a person filling the form might add, said under it. Hints, never refusals: every field stays optional, and a
 * save goes through without any of them.
 */
export function formHints(f: TimelineInput): string[] {
  const hints: string[] = [];
  const adjustment = f.route !== "consular";
  if (adjustment && f.i485FiledOn && !f.fieldOffice) hints.push("The office handling your I-485 puts your dates on that office's page.");
  if (adjustment && f.i485FiledOn && !f.i485Center) {
    hints.push("The first three letters of your I-485 receipt name the service center that took it in.");
  }
  const events = f.accountEvents ?? [];
  if (events.some((e) => e?.code && !e.form)) hints.push("Saying which form each account update was on makes the counts clearer.");
  if (adjustment && f.i485FiledOn && events.length === 0) {
    hints.push("Updates in your USCIS account, the dates and codes it showed, help others read their own.");
  }
  return hints;
}

/** How many self-reported dates two timelines share: the same step on the same day. Two or more is worth a look. */
export function sharedDates(a: TimelineRecord, b: TimelineRecord): number {
  return DATE_FIELDS.filter((f) => a[f.id] !== undefined && a[f.id] === b[f.id]).length;
}

/** The stages the case page draws, in order, with whether anyone reported each. */
export const CASE_STOPS = [
  { id: "permFiledOn", label: "PERM filed", verified: true },
  { id: "permCertifiedOn", label: "PERM certified", verified: true },
  ...DATE_FIELDS.map((f) => ({ id: f.id, label: f.short, verified: false })),
] as const;

/**
 * Who is waiting where: each timeline placed at the step it has reached, by
 * category and country. Counts only, from every visible timeline (the same
 * rows the medians use). A cell under WAITING_MIN_CELL is withheld, and the
 * whole view stays shut until BOARD_OPENS_AT timelines exist, because a count
 * of one in "EB-3 other workers, Philippines" is a person.
 */
export const WAITING_STAGES = [
  { id: "perm", label: "PERM pending" },
  { id: "certified", label: "PERM certified, I-140 not filed" },
  { id: "i140", label: "I-140 pending" },
  { id: "approved", label: "I-140 approved, waiting on the bulletin" },
  { id: "i485", label: "I-485 pending" },
  { id: "done", label: "Green card received" },
] as const;
export type WaitingStageId = (typeof WAITING_STAGES)[number]["id"];
export const WAITING_MIN_CELL = 5;

/** The furthest step a timeline reports. */
export function waitingStage(r: TimelineRecord): WaitingStageId {
  if (r.greenCardOn) return "done";
  // Biometrics, a work permit and a travel document each follow an I-485, so any of them places the case there.
  if (r.i485FiledOn || r.biometricsOn || r.eadOn || r.apOn) return "i485";
  // An interview in the US is the I-485's; abroad it follows the approved I-140.
  if (r.interviewOn) return r.route === "consular" ? "approved" : "i485";
  if (r.i140ApprovedOn) return "approved";
  if (r.i140FiledOn) return "i140";
  if (r.permCertifiedOn) return "certified";
  return "perm";
}

export interface WaitingLine {
  category: string;
  country: string;
  /** Per stage, in WAITING_STAGES order; null where the count is under WAITING_MIN_CELL. */
  counts: (number | null)[];
  total: number;
}

export interface WaitingView {
  open: boolean;
  /** Every visible timeline, placed. */
  byStage: { id: WaitingStageId; label: string; count: number }[];
  /** Category and country lines holding at least WAITING_MIN_CELL timelines, busiest first. */
  lines: WaitingLine[];
  /** Timelines on lines too small to show, or with no category or country given. */
  unlisted: number;
}

export function whoIsWaiting(records: readonly TimelineRecord[]): WaitingView {
  const live = records.filter((r) => r.hiddenAt === undefined);
  const open = live.length >= BOARD_OPENS_AT;
  const stageIndex = new Map(WAITING_STAGES.map((s, i) => [s.id, i] as const));
  const byStage = WAITING_STAGES.map((s) => ({ id: s.id, label: s.label, count: 0 }));
  const lines = new Map<string, { category: string; country: string; counts: number[] }>();
  let unlisted = 0;
  for (const r of live) {
    const i = stageIndex.get(waitingStage(r)) ?? 0;
    byStage[i]!.count += 1;
    const cat = CATEGORIES.find((c) => c.id === r.category)?.label;
    const ctry = COUNTRIES.find((c) => c.id === r.country)?.label;
    if (!cat || !ctry) {
      unlisted += 1;
      continue;
    }
    const key = `${cat}|${ctry}`;
    const line = lines.get(key) ?? { category: cat, country: ctry, counts: WAITING_STAGES.map(() => 0) };
    line.counts[i]! += 1;
    lines.set(key, line);
  }
  const shown: WaitingLine[] = [];
  for (const l of lines.values()) {
    const total = l.counts.reduce((a, b) => a + b, 0);
    if (total < WAITING_MIN_CELL) {
      unlisted += total;
      continue;
    }
    shown.push({ ...l, total, counts: l.counts.map((c) => (c >= WAITING_MIN_CELL ? c : c === 0 ? 0 : null)) });
  }
  shown.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category) || a.country.localeCompare(b.country));
  return open
    ? { open, byStage, lines: shown, unlisted }
    : { open, byStage: byStage.map((s) => ({ ...s, count: 0 })), lines: [], unlisted: 0 };
}

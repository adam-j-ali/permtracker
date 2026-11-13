/**
 * When a USCIS case may be asked about, from USCIS's own posted cutoff: the pure half of the case inquiry tool.
 *
 * USCIS takes questions about a late case only once it has waited longer than the time USCIS took to finish 93% of
 * similar cases. Its processing-times page posts, for each form, category and office, the receipt date before which
 * a case is past that point ("Case Inquiry Date = [time to complete 93% of adjudicated cases] – [today's date –
 * receipt date]"; egov.uscis.gov/processing-times/more-info, as archived Feb 1 2025). The site stores that date as
 * `requestDate` with each posting (scripts/ingest_uscis_posted_times.py). A form USCIS posts no time for may be
 * asked about after six months (USCIS's processing-times FAQ).
 */

import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

export type InquiryAnswer =
  /** The receipt date is before USCIS's cutoff: the case is outside normal processing. */
  | { kind: "now"; cutoff: string }
  /** On the cutoff day itself: USCIS's own tool decides, so say so. */
  | { kind: "edge"; cutoff: string }
  /** Not yet: from about this day, if USCIS's time holds. */
  | { kind: "later"; cutoff: string; from: string; days: number }
  /** USCIS posted no time for this one: six months from receipt is its default. */
  | { kind: "default"; from: string; now: boolean };

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * The answer for one receipt date, against a posting's cutoff (null when USCIS posted none) and the posting's date.
 * Dates are ISO calendar days; nothing here reads a clock or a time zone.
 */
export function inquiryAnswer(receipt: string, cutoff: string | null, published: string, today: string): InquiryAnswer {
  if (!cutoff) {
    const from = iso(addMonths(parseISO(receipt), 6));
    return { kind: "default", from, now: from <= today };
  }
  if (receipt < cutoff) return { kind: "now", cutoff };
  if (receipt === cutoff) return { kind: "edge", cutoff };
  // USCIS's 93% time is the gap between its posting day and the cutoff it posted. A case reaches it that many days
  // after its own receipt, if the time doesn't change before then.
  const ninetyThird = differenceInCalendarDays(parseISO(published), parseISO(cutoff));
  const from = iso(addDays(parseISO(receipt), ninetyThird));
  return { kind: "later", cutoff, from, days: Math.max(0, differenceInCalendarDays(parseISO(from), parseISO(today))) };
}

/** A count of months as USCIS prints them (9.5) added to a day: the whole months by the calendar, the rest as days of an average month. */
function plusMonths(day: string, months: number): string {
  const whole = Math.floor(months);
  return iso(addDays(addMonths(parseISO(day), whole), Math.round((months - whole) * 30.4375)));
}

export interface CaseMarks {
  /** Half of cases like this one were decided by this day (USCIS's quarterly median), when USCIS publishes one. */
  half: string | null;
  /** Eight in ten were decided by this day: USCIS's posted processing time. */
  eightInTen: string | null;
}

/**
 * The two days USCIS's own figures put on a case's calendar, counted from its receipt date: the day half of
 * such cases were done by (the quarterly median) and the day eight in ten were (the posted time). Both describe
 * cases USCIS finished recently, so they say how long those took and promise nothing about this one.
 */
export function caseMarks(receipt: string, medianMonths: number | null, postedMonths: number | null): CaseMarks {
  const half = medianMonths !== null && medianMonths > 0 ? plusMonths(receipt, medianMonths) : null;
  const eightInTen = postedMonths !== null && postedMonths > 0 ? plusMonths(receipt, postedMonths) : null;
  // Half can't be done after eight in ten. When USCIS's two figures put them that way round they don't
  // describe the same cases (another quarter, or a wider group), and the posted time, which is this
  // category's own and newer, is the one that stands.
  return { half: half !== null && eightInTen !== null && half > eightInTen ? null : half, eightInTen };
}

/**
 * Whether the quarterly line `medianLineFor` names counts every category of the form together. The I-140's
 * does: one median for extraordinary ability, advanced degree, skilled, unskilled and the rest, whose posted
 * times run from 3 to 9 months. Such a median is said of the form and never dated on one case's calendar.
 */
export function medianCoversWholeForm(form: string): boolean {
  return form === "I-140";
}

/**
 * Which line of USCIS's quarterly report a posted form and category belongs to, as words its title holds, or
 * null where no single line is the same population. USCIS's two publications cut the forms differently: the
 * posted times by category and office, the quarterly medians by form and a broad basis. Only the pairs that are
 * the same people are matched, so a median is never borrowed from a different kind of case.
 */
export function medianLineFor(form: string, subtype: string): string | null {
  const code = subtype.split("-").slice(1).join("-");
  switch (form) {
    case "I-485":
      return subtype === "131A" ? "(Employment)" : subtype === "131A-FAM" ? "(Family)" : subtype === "131B" ? "(Asylum)" : subtype === "131C" ? "(Refugee)" : null;
    case "I-140":
      return "Immigrant Petition for Alien Workers";
    case "I-765":
      return code === "C9" ? "(Adjustment Of Status)" : null;
    case "N-400":
      return subtype === "160A" ? "Application for Naturalization" : null;
    case "I-130":
      return code === "IR" ? "(Immediate Relative)" : null;
    default:
      return null;
  }
}

/**
 * The median the quarterly report prints for a line named by `medianLineFor`, from that form's rows: the one
 * row whose title is the line or ends with it. No row, a row with no median, or two rows that both fit, and
 * there's no median to show: guessing between two populations would print one group's time under another's name.
 */
export function pickMedian(rows: readonly { title: string; medianMonths: number | null }[], line: string | null): number | null {
  if (!line) return null;
  const fits = rows.filter((r) => r.title === line || (line.startsWith("(") && r.title.endsWith(` ${line}`)));
  const only = fits.length === 1 ? fits[0]! : null;
  return only && only.medianMonths !== null && only.medianMonths > 0 ? only.medianMonths : null;
}

/** The Ombudsman's clocks for a delayed case, from its own page (dhs.gov/case-assistance, updated 04/13/2026). */
export const OMBUDSMAN = {
  /** "you must have contacted USCIS in the last 90 days" */
  contactWithinDays: 90,
  /** "and given the agency at least 60 days to try to resolve your problem" */
  waitAtLeastDays: 60,
  /** "We cannot help if it has been fewer than 45 calendar days since your congressional representative made an inquiry" */
  afterCongressDays: 45,
} as const;

/** The day the Ombudsman can take a delayed case, given the day the person asked USCIS (and Congress, if they did). */
export function ombudsmanFrom(askedUscis: string, askedCongress: string | null): string {
  const a = addDays(parseISO(askedUscis), OMBUDSMAN.waitAtLeastDays);
  const b = askedCongress ? addDays(parseISO(askedCongress), OMBUDSMAN.afterCongressDays) : a;
  return iso(a > b ? a : b);
}

export interface NoteFacts {
  name: string;
  receiptNumber: string;
  form: string;
  filedOn: string;
  office: string;
  cutoff: string | null;
  published: string;
  askedUscis: string;
  reference: string;
  extra: string;
}

/**
 * A short note to a congressional office's caseworker, from what the person typed. It asks for help and states the
 * facts; it never asks for a Social Security number, and it says the office's signed privacy release still comes
 * first, because USCIS answers an office only with one (USCIS Policy Manual, vol. 1, pt. A, ch. 7).
 */
export function congressNote(f: NoteFacts): string {
  const lines = [
    "Hello,",
    "",
    `I'm a constituent asking for help with a USCIS case that's taking longer than normal. ${f.name ? `My name is ${f.name.trim()}.` : ""}`.trim(),
    "",
    `Form: ${f.form}`,
    `Receipt number: ${f.receiptNumber || "(add yours)"}`,
    `Filed: ${f.filedOn || "(add the date)"}`,
    `Office handling it: ${f.office}`,
  ];
  if (f.cutoff) {
    lines.push(`USCIS's processing-times page, as posted ${f.published}, takes inquiries for cases received before ${f.cutoff}, and this case is past that point.`);
  }
  if (f.askedUscis) {
    lines.push(`I asked USCIS about it on ${f.askedUscis}${f.reference ? ` (reference ${f.reference})` : ""} and haven't had a resolution.`);
  }
  if (f.extra.trim()) lines.push("", f.extra.trim());
  lines.push(
    "",
    "Could your office make an inquiry with USCIS? I'll sign your privacy release form, and I can send the receipt notice.",
    "",
    "Thank you,",
    f.name.trim() || "(your name)",
  );
  return lines.join("\n");
}

/**
 * USCIS's printed time ("9.5 Months") as it reads inside a sentence: the unit in lower case, the figure untouched.
 */
export function postedInSentence(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  return t ? t.replace(/\b(Day|Week|Month|Year)(s?)\b/g, (unit) => unit.toLowerCase()) : null;
}

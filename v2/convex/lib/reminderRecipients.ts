/**
 * The rules for a case's second reminder recipient that need no database (convex/reminderRecipients.ts holds the
 * table's functions): the address as it's stored, who the invitation says asked, which of the day's reminders the
 * second person gets, the subject of their email and the signed links in it.
 *
 * @module
 */
import { getDeadlineUrgency, formatDeadlineType } from "./digestHelpers";
import { deadlineDigestWords } from "./deadlineDigestWords";
import { isPlausibleEmail } from "./emailShape";
import { SITE_URL } from "./links";
import { remindsAbout, type UserNotificationPrefs } from "./notificationHelpers";
import type { TokenPurpose } from "./unsubscribeToken";
import { MS_PER_DAY } from "./time";

/** The longest address SMTP allows. */
export const RECIPIENT_EMAIL_MAX = 254;

/** Days an invitation waits for its click before it's deleted. */
export const INVITE_DAYS = 30;
export const INVITE_MS = INVITE_DAYS * MS_PER_DAY;

/** Who the invitation says asked, when the account has no name it can show. */
export const SOMEONE = "a PERM Tracker user";

/** A name longer than this is cut, so the invitation's first line stays one line. */
const NAME_MAX = 60;

/**
 * The address as it's stored, trimmed and lowercased, or null when it isn't one. The length is checked on the raw
 * input first: `v.string()` takes about a megabyte, and the shape test must never run on that (convex/lib/emailShape.ts).
 */
export function normaliseRecipientEmail(raw: string): string | null {
  if (raw.length > RECIPIENT_EMAIL_MAX + 64) return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > RECIPIENT_EMAIL_MAX) return null;
  return isPlausibleEmail(email) ? email : null;
}

/**
 * Anything a reader might follow: a scheme, a www., an address (an @) or a bare domain, a dot then two letters or more
 * that end the word ("irs-refund.example/claim", "irs.gov.", "IRS.GOV") or a punycode one. A dot before a space or a
 * single letter ("St. Jude", "U.S. Steel") is no domain. A false alarm only hides a name, so the rule leans wide.
 */
const LOOKS_LIKE_A_LINK = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|@|\.(?:[a-z]{2,}|xn--[a-z0-9-]+)(?![a-z0-9-]))/i;

/** Whether text typed by an account reads like a link or an address (LOOKS_LIKE_A_LINK). */
export function looksLikeALink(text: string): boolean {
  return LOOKS_LIKE_A_LINK.test(text);
}

/**
 * Who the invitation says asked: the account's display name (Settings' full name, else the sign-in name), or "a PERM
 * Tracker user". A name that reads like a link or an address is never shown, so nobody can put one in an email to a
 * stranger under our name.
 */
export function inviterName(fullName: string | undefined, accountName: string | undefined): string {
  for (const raw of [fullName, accountName]) {
    const name = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (looksLikeALink(name)) return SOMEONE;
    return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
  }
  return SOMEONE;
}

/** A sentence's first word, capitalised: "a PERM Tracker user" opens a sentence as "A PERM Tracker user". */
export function sentenceStart(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

/** The invitation's subject: who asked, and nothing of the case a stranger's inbox would show. */
export function reminderInviteSubject(inviter: string): string {
  return `${sentenceStart(inviter)} asked us to send you deadline reminders for a PERM case`;
}

/** One reminder from the day's run, as much of it as the second person's email needs. */
export interface CopyInput {
  caseId: string;
  deadlineType: string;
  deadlineDate: string;
  daysUntilDeadline: number;
  /** The case owner's notification settings. */
  userPrefs: UserNotificationPrefs;
}

/** One row of the second person's email. */
export interface CopyItem {
  /** The deadline's name, as the dashboard shows it. */
  deadlineType: string;
  /** ISO date (YYYY-MM-DD). */
  deadlineDate: string;
  daysUntil: number;
  urgency: "overdue" | "urgent" | "upcoming" | "later";
}

/**
 * The day's reminders the second people get, by case, most urgent first. Each follows the owner's own switch for
 * its kind of deadline (Settings, "Which deadlines to remind you about"); a case with none left is left out.
 */
export function copiesByCase(reminders: readonly CopyInput[]): Map<string, CopyItem[]> {
  const out = new Map<string, CopyItem[]>();
  for (const r of reminders) {
    if (!remindsAbout(r.deadlineType, r.userPrefs)) continue;
    const items = out.get(r.caseId) ?? [];
    items.push({
      deadlineType: formatDeadlineType(r.deadlineType),
      deadlineDate: r.deadlineDate,
      daysUntil: r.daysUntilDeadline,
      urgency: getDeadlineUrgency(r.daysUntilDeadline),
    });
    out.set(r.caseId, items);
  }
  for (const items of out.values()) {
    items.sort((a, b) => a.daysUntil - b.daysUntil || a.deadlineDate.localeCompare(b.deadlineDate));
  }
  return out;
}

/** A part of the subject, cut to fit. */
function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The case as the emails name it: the job title at the employer. */
export function caseLine(jobTitle: string, employerName: string): string {
  return `${clip(jobTitle, 55)} at ${clip(employerName, 55)}`;
}

/** What the invitation calls the case when it can't name it. */
export const A_PERM_CASE = "a PERM case";

/**
 * The case as the invitation and its Confirm page name it, to an address that hasn't said yes: the case line, or "a
 * PERM case" when the job title or the employer, as typed, reads like a link or an address (the rule inviterName
 * uses). Both are checked whole, before any clipping, so nobody can put a link in an email to a stranger under our
 * name. The reminders a confirmed person gets keep the case line.
 */
export function inviteCaseLine(jobTitle: string, employerName: string): string {
  return looksLikeALink(jobTitle) || looksLikeALink(employerName) ? A_PERM_CASE : caseLine(jobTitle, employerName);
}

/** The second person's subject: the owner's digest subject, then the case it's about. */
export function reminderCopySubject(total: number, overdue: number, jobTitle: string, employerName: string): string {
  return `${deadlineDigestWords(total, overdue).subject}: ${caseLine(jobTitle, employerName)}`;
}

/**
 * The ref every email to a recipient row carries into the retry queue (convex/lib/email.ts, sendOrQueue), so every
 * path that ends the row drops what's still waiting for it (dropReminderRetries in convex/lib/alertOutboxStore.ts).
 */
export function reminderRef(recipientId: string): string {
  return `reminder:${recipientId}`;
}

/** The confirm link's purpose: one recipient row, so a link for one invitation can't confirm another. */
export function reminderConfirmPurpose(recipientId: string): TokenPurpose {
  return `reminder-confirm:${recipientId}`;
}

/** The stop link's purpose: one recipient row, so a link for one case can't stop another. */
export function reminderStopPurpose(recipientId: string): TokenPurpose {
  return `reminder-stop:${recipientId}`;
}

/** The paths of the confirm and stop pages (convex/http.ts), under the alert links nginx already relays. */
export const REMINDER_CONFIRM_PATH = "/case-alert/reminders/confirm";
export const REMINDER_STOP_PATH = "/case-alert/reminders/stop";

function linkFor(path: string, token: string, recipientId: string): string {
  return `${SITE_URL}${path}?token=${encodeURIComponent(token)}&r=${encodeURIComponent(recipientId)}`;
}

/** The invitation's Confirm link: a page with a button, since opening a link never confirms. */
export function confirmUrl(token: string, recipientId: string): string {
  return linkFor(REMINDER_CONFIRM_PATH, token, recipientId);
}

/** The one-click stop link, in each reminder and its List-Unsubscribe header. */
export function stopUrl(token: string, recipientId: string): string {
  return linkFor(REMINDER_STOP_PATH, token, recipientId);
}

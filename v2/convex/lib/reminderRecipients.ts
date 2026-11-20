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
import { emailsDeadlineReminder, type UserNotificationPrefs } from "./notificationHelpers";
import { keyedHash, type TokenPurpose } from "./unsubscribeToken";
import { MS_PER_DAY } from "./time";

/** The longest address SMTP allows. */
export const RECIPIENT_EMAIL_MAX = 254;

/** Days an invitation waits for its click before it's deleted. */
export const INVITE_DAYS = 30;
export const INVITE_MS = INVITE_DAYS * MS_PER_DAY;

/**
 * Invitations one account may send one address, in all: a lapsed or removed invitation counts, so the form can't be
 * used to keep mailing someone who never said yes.
 */
export const REMINDER_INVITES_PER_ADDRESS = 2;

/** Gmail's two domains, one inbox: googlemail.com is read as gmail.com. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address reaches, so the refusal list and the invitation count can't be walked around by another
 * spelling of it: trimmed and lowercased, a "+tag" dropped from the local part on every domain, and on Gmail the
 * local part's dots dropped and googlemail.com read as gmail.com. A local part that would be left empty is kept as
 * it was. Only the keys use it: mail still goes to the address as typed.
 */
export function canonicalAddress(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.replace(/\./g, "") || local;
  }
  return `${local}@${domain}`;
}

/**
 * The address as the refusal list (reminderRefusals) and the invitation count (reminderInviteCounts) keep it: an
 * HMAC of its inbox (canonicalAddress) under UNSUBSCRIBE_SECRET, so a row can be found again by any spelling of the
 * address but the address can't be read back from it. The signed message starts `reminder-address-key:`, which is no
 * token's purpose, so a row is never a link's signature.
 */
export async function reminderAddressKey(email: string, secret: string): Promise<string> {
  return await keyedHash(`reminder-address-key:${canonicalAddress(email)}`, secret);
}

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
 * Anything a reader might follow: a scheme's "://", a www., an address (an @) or a bare domain, a dot then two letters or more
 * that end the word ("irs-refund.example/claim", "irs.gov.", "IRS.GOV", "irs.gоv" with a Cyrillic о) or a punycode one,
 * and any letter outside plain ASCII next to a dot ("пример.рф", "irs.сom"). A dot before a space or a single letter
 * ("St. Jude", "U.S. Steel") is no domain. A false alarm only hides a name, so the rule leans wide. Every part runs
 * in time linear in the text: a scheme is found by its "://" alone, since a letter run before it would be rescanned
 * from each of its letters.
 */
const LOOKS_LIKE_A_LINK =
  /(?::\/\/|www\.|@|\.(?:\p{L}{2,}|xn--[a-z0-9-]+)(?![\p{L}\p{N}-])|[^\P{L}\x00-\x7F]\.|\.[^\P{L}\x00-\x7F])/iu;

/** A phone number: seven digits or more, with only spaces, dots, dashes or parentheses between them. */
const LOOKS_LIKE_A_PHONE = /(?:\p{Nd}[\s.()\p{Pd}]*){7,}/u;

/** Characters a mail app shows as a full stop that NFKC leaves alone or turns into another of them: 。．｡․﹒ */
const DOT_LIKE = /[。．｡․﹒]/g;

/**
 * The text as a reader sees it, for the tests above: invisible format characters (zero-width spaces and joiners, the
 * soft hyphen, \p{Cf}) taken out, look-alike forms folded to plain ones (NFKC: "ｃｏｍ" is "com", "＠" is "@") and
 * every dot-like character read as a dot.
 */
function asSeen(text: string): string {
  return text.replace(/\p{Cf}/gu, "").normalize("NFKC").replace(DOT_LIKE, ".");
}

/** Whether text typed by an account reads like a link, an address or a phone number, however it's dressed up. */
export function looksLikeALink(text: string): boolean {
  const seen = asSeen(text);
  return LOOKS_LIKE_A_LINK.test(seen) || LOOKS_LIKE_A_PHONE.test(seen);
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
 * The day's reminders the second people get, by case, most urgent first. Each follows the owner's own email switches
 * as the owner's own email does (emailsDeadlineReminder): the master email switch, "Deadline reminders" and the switch
 * for its kind of deadline. Owner's email off, the second person's off too; a case with none left is left out.
 */
export function copiesByCase(reminders: readonly CopyInput[]): Map<string, CopyItem[]> {
  const out = new Map<string, CopyItem[]>();
  for (const r of reminders) {
    if (!emailsDeadlineReminder(r.deadlineType, r.userPrefs)) continue;
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
 * The case as everything sent to the second person names it (the invitation, its Confirm page, and each reminder's
 * subject and body): the case line, or "a PERM case" when the job title or the employer, as typed, reads like a link,
 * an address or a phone number (looksLikeALink, the rule inviterName uses). Both are checked whole, before any
 * clipping, and on every send, so an owner who renames the case after the person confirmed can't put a link in an
 * email under our name either.
 */
export function safeCaseLine(jobTitle: string, employerName: string): string {
  return looksLikeALink(jobTitle) || looksLikeALink(employerName) ? A_PERM_CASE : caseLine(jobTitle, employerName);
}

/** The second person's subject: the owner's digest subject, then the case it's about (safeCaseLine). */
export function reminderCopySubject(total: number, overdue: number, jobTitle: string, employerName: string): string {
  return `${deadlineDigestWords(total, overdue).subject}: ${safeCaseLine(jobTitle, employerName)}`;
}

/** The kinds the invitation and a day's reminders are sent and queued for a retry as (convex/lib/email.ts). */
export const REMINDER_INVITE_KIND = "reminder-invite";
export const REMINDER_COPY_KIND = "reminder-copy";

/** What every recipient row's ref starts with (reminderRef). */
export const REMINDER_REF_PREFIX = "reminder:";

/**
 * The ref every email to a recipient row carries into the retry queue (convex/lib/email.ts, sendOrQueue), so every
 * path that ends the row drops what's still waiting for it (dropReminderRetries in convex/lib/alertOutboxStore.ts),
 * and the retry worker checks the row again before it sends (reminderRetryStillWanted in
 * convex/lib/reminderRecipientStore.ts).
 */
export function reminderRef(recipientId: string): string {
  return `${REMINDER_REF_PREFIX}${recipientId}`;
}

/** The confirm link's purpose: one recipient row, so a link for one invitation can't confirm another. */
export function reminderConfirmPurpose(recipientId: string): TokenPurpose {
  return `reminder-confirm:${recipientId}`;
}

/** The stop link's purpose: one recipient row, so a link for one case can't stop another. */
export function reminderStopPurpose(recipientId: string): TokenPurpose {
  return `reminder-stop:${recipientId}`;
}

/**
 * The invitation's "Don't invite me again" link's purpose, its own: neither a confirm nor a stop link declines, and it
 * confirms or stops nothing. Scoped to the row it was mailed for, and it still refuses the address once that row is
 * gone.
 */
export function reminderDeclinePurpose(recipientId: string): TokenPurpose {
  return `reminder-decline:${recipientId}`;
}

/** The paths of the confirm and stop pages (convex/http.ts), under the alert links nginx already relays. */
export const REMINDER_CONFIRM_PATH = "/case-alert/reminders/confirm";
export const REMINDER_STOP_PATH = "/case-alert/reminders/stop";
export const REMINDER_DECLINE_PATH = "/case-alert/reminders/decline";

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

/** The invitation's "Don't invite me again" link, and its List-Unsubscribe header: a page with a button. */
export function declineUrl(token: string, recipientId: string): string {
  return linkFor(REMINDER_DECLINE_PATH, token, recipientId);
}

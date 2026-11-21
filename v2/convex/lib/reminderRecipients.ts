/**
 * The rules for a case's second reminder recipient that need no database (convex/reminderRecipients.ts holds the
 * table's functions): the address as it's stored, who the invitation says asked, which of the day's reminders the
 * second person gets, the subject of their email and the signed links in it.
 *
 * @module
 */
import { getDeadlineUrgency, formatDeadlineType } from "./digestHelpers";
import { deadlineDigestWords } from "./deadlineDigestWords";
import { canonicalAddress } from "./canonicalAddress";
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
 * The characters a name or a case's words may hold to be put in an email to someone who never asked for our mail:
 * ASCII letters and digits, the space, & , ' . - ( ), and the Latin letters of Latin-1 and Latin Extended-A, named
 * as ranges (a script property would take in look-alikes such as U+A78F, a Latin letter that is a dot). This matches
 * any other character.
 */
const NOT_PLAIN = /[^A-Za-z0-9 &,'.()\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F-]/;

/** The letters NOT_PLAIN allows, as a character class's inside. */
const LATIN_LETTERS = "A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F";

/** A dot directly followed by two letters, the start of a domain ("irs-refund.com", ".NET"); "St. Jude" and "U.S." have none. */
const DOT_THEN_LETTERS = new RegExp(`\\.[${LATIN_LETTERS}]{2}`);

/**
 * A domain spelled apart: a dot, then spaces or a bracket ("irs-refund. com", "irs-refund(.)com", "irs-refund.(com)"),
 * then a common top-level domain as a whole word. "co" is left out, so "Smith Ltd. Co" shows, and a word that only
 * starts like one ("Co. Comedy") isn't one. The spaces and the one bracket can each be matched one way only, so it's
 * linear in the text.
 */
const SPACED_DOMAIN = new RegExp(
  `\\. *(?:[()] *)?(?:com|net|org|gov|edu|io|info|biz|app|us)(?![${LATIN_LETTERS}])`,
  "i",
);

/**
 * A numeric web address (IPv4): four numbers of one to three digits joined by dots ("5.9.12.34"). Bounded
 * quantifiers, so each place in the text is tried in constant time.
 */
const NUMERIC_ADDRESS = /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/;

/** Digits in one text that make a phone number, however they're spaced or split. */
const PHONE_DIGITS = 7;

/**
 * The characters a phone number's digits can be typed as: 0 to 9, and the letters that pass for a 0 or a 1 (O o Ø ø
 * and the accented Os of Latin-1 and Latin Extended-A, I l and their accented forms, the dotless i and the l with a
 * stroke). NFKC leaves these letters as they are, so they're read on the folded text; the two it splits, Ŀ and ŀ, carry
 * a middle dot that NOT_PLAIN refuses first.
 */
const DIGIT_LIKE_CHARS =
  "0-9" +
  "OoØø\u00D2-\u00D6\u00F2-\u00F6\u014C-\u0151" + // Ò-Ö ò-ö Ō-ő
  "Il\u00CC-\u00CF\u00EC-\u00EF\u0128-\u0131\u0139-\u0142"; // Ì-Ï ì-ï Ĩ-ı Ĺ-ł

/**
 * One run of what could be a phone number: those characters, joined by a space or the punctuation NOT_PLAIN allows
 * between words. One character class and a plus, so a match runs in time linear in the text.
 */
const NUMBER_RUN = new RegExp(`[${DIGIT_LIKE_CHARS} ().,'&-]+`, "g");
const DIGIT_LIKE = new RegExp(`[${DIGIT_LIKE_CHARS}]`, "g");
const REAL_DIGIT = /[0-9]/;

/**
 * Whether text an account typed may be shown, as it is, to someone who never asked for our mail: the one rule for the
 * inviter's name and the case's words (inviterName, safeCaseLine). It's an allow-list, so a character nobody thought
 * of fails too. Every character must be one of NOT_PLAIN's, both as typed (accents composed, NFC) and folded (NFKC):
 * folding turns a hair space into a space and a fullwidth letter into a plain one, which the email would still show as
 * typed, and it splits a letter such as U+0140 into an l and a middle dot. Then, on the folded text: no dot directly
 * followed by two letters (DOT_THEN_LETTERS), no domain spelled apart after its dot (SPACED_DOMAIN), no numeric web
 * address (NUMERIC_ADDRESS), fewer than seven digits in all (PHONE_DIGITS), and fewer than seven digits and letters
 * that pass for digits in any run that holds a real digit (NUMBER_RUN: "8ØØ 555 Ø1ØØ" is a phone number, "Apollo 11
 * Labs" isn't). A false alarm only hides a name. Every step runs in time linear in the text.
 */
export function isPlainText(text: string): boolean {
  const folded = text.normalize("NFKC");
  if (NOT_PLAIN.test(text.normalize("NFC")) || NOT_PLAIN.test(folded)) return false;
  if (DOT_THEN_LETTERS.test(folded) || SPACED_DOMAIN.test(folded) || NUMERIC_ADDRESS.test(folded)) return false;
  let digits = 0;
  for (let i = 0; i < folded.length; i++) {
    const c = folded.charCodeAt(i);
    if (c >= 48 && c <= 57 && ++digits >= PHONE_DIGITS) return false;
  }
  for (const [run] of folded.matchAll(NUMBER_RUN)) {
    if (REAL_DIGIT.test(run) && (run.match(DIGIT_LIKE)?.length ?? 0) >= PHONE_DIGITS) return false;
  }
  return true;
}

/**
 * Text as an email shows it: accents composed (NFC), and runs of ASCII whitespace (a tab, a line break) read as one
 * space. Any other space, a hair space or a no-break space, is kept, so isPlainText refuses it.
 */
function oneLine(text: string): string {
  return text.normalize("NFC").replace(/[\t\n\v\f\r ]+/g, " ").trim();
}

/**
 * Text an account typed as an email to someone else shows it (oneLine), cut to `max` characters with an ellipsis,
 * or null when the whole text, or the part shown before the ellipsis, fails isPlainText.
 */
function shownPlain(text: string, max: number): string | null {
  const whole = oneLine(text);
  if (!isPlainText(whole)) return null;
  if (whole.length <= max) return whole;
  const part = whole.slice(0, max - 1).trimEnd();
  return isPlainText(part) ? `${part}…` : null;
}

/**
 * Who the invitation says asked: the account's display name (Settings' full name, else the sign-in name), cut to
 * NAME_MAX, or "a PERM Tracker user". A name that fails isPlainText, whole or as cut, is never shown, so nobody can put
 * a link, an address or a phone number in an email to a stranger under our name.
 */
export function inviterName(fullName: string | undefined, accountName: string | undefined): string {
  for (const raw of [fullName, accountName]) {
    if (!raw || !oneLine(raw)) continue;
    return shownPlain(raw, NAME_MAX) ?? SOMEONE;
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

/** The longest job title or employer the emails show; a longer one is cut, with an ellipsis. */
const CASE_PART_MAX = 55;

/** What the invitation calls the case when it can't name it. */
export const A_PERM_CASE = "a PERM case";

/**
 * The case as everything sent to the second person names it (the invitation, its Confirm page, and each reminder's
 * subject and body): the job title at the employer, each cut to CASE_PART_MAX, or "a PERM case" when either one, whole
 * or as cut, fails isPlainText (the rule inviterName uses). It's checked on every send, so an owner who renames the
 * case after the person confirmed can't put a link in an email under our name either.
 */
export function safeCaseLine(jobTitle: string, employerName: string): string {
  const title = shownPlain(jobTitle, CASE_PART_MAX);
  const employer = shownPlain(employerName, CASE_PART_MAX);
  return title === null || employer === null ? A_PERM_CASE : `${title} at ${employer}`;
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

/**
 * The stop link's purpose: one recipient row, so a link for one case can't stop another, and the account that added
 * it, so a link pressed after the owner removed the row still refuses the address for that account.
 */
export function reminderStopPurpose(recipientId: string, userId: string): TokenPurpose {
  return `reminder-stop:${recipientId}:${userId}`;
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

/** The one-click stop link, in each reminder and its List-Unsubscribe header: the row and the account it's signed for. */
export function stopUrl(token: string, recipientId: string, userId: string): string {
  return `${linkFor(REMINDER_STOP_PATH, token, recipientId)}&u=${encodeURIComponent(userId)}`;
}

/** The invitation's "Don't invite me again" link, and its List-Unsubscribe header: a page with a button. */
export function declineUrl(token: string, recipientId: string): string {
  return linkFor(REMINDER_DECLINE_PATH, token, recipientId);
}

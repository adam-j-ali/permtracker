import { monthLabel } from "./newsletterCompose";
import { checkedLabel } from "./time";

/**
 * Every kind of email PERM Tracker sends to someone who asked for it.
 *
 * Three surfaces describe this mail: the public page at /email-preferences,
 * the page an emailed preferences link opens (served by convex/http.ts) and
 * Settings > Notifications. They read their names and one-line descriptions
 * from here, so a kind can't be called one thing on one page and something
 * else on another. The two weekly emails are the reason this exists: they
 * were both called a "weekly digest" for a while, one about the reader's own
 * caseload and one about the federal record.
 *
 * Transactional mail (sign-in codes, confirmations, password resets, account
 * deletion) isn't listed. It's sent because the person just asked for it, and
 * there's nothing to turn off.
 *
 * The ids of the subscriber kinds are also the `kind` values in emailed links
 * (`/prefs/unsubscribe?kind=...`), so they can never be renamed: those links
 * are already in people's inboxes.
 */

/** Kinds anyone can subscribe to, no account needed. Ids are in emailed links. */
export const SUBSCRIBER_KINDS = ["case", "uscis", "block", "queue", "bulletin", "employer", "newsletter", "news"] as const;

/** Kinds that come with a PERM Tracker account, controlled in Settings. */
export const ACCOUNT_KINDS = ["reminders", "updates", "digest"] as const;

/** What a preferences link can turn off: every subscriber kind plus the weekly case summary. */
export const PREFS_KINDS = [...SUBSCRIBER_KINDS, "digest"] as const;

export type SubscriberKind = (typeof SUBSCRIBER_KINDS)[number];
export type PrefsKind = (typeof PREFS_KINDS)[number];
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export type MailKindId = SubscriberKind | AccountKind;

export interface MailKind {
  /** The kind's name, as a heading. */
  name: string;
  /** One of it, as a row label ("Case status alert"). */
  one: string;
  /** What arrives, in one line. */
  what: string;
  /** How often, in a few words. */
  when: string;
  /** Where it's turned on. Every account kind is turned on in Settings. */
  start: { label: string; href: string };
}

/** Where the account kinds are switched on and off. */
export const NOTIFICATION_SETTINGS_PATH = "/settings?tab=notifications";

/** Where the subscriber kinds are listed and the preferences link is requested. */
export const EMAIL_PREFERENCES_PATH = "/email-preferences";

const SETTINGS = { label: "Notification settings", href: NOTIFICATION_SETTINGS_PATH } as const;

/** Alert forms carry the two opt-in boxes for the weekly digest and product news. */
const ANY_ALERT_FORM = { label: "A box on any alert form", href: "/perm-case-status" } as const;

export const MAIL_KINDS: Record<MailKindId, MailKind> = {
  case: {
    name: "Case status alerts",
    one: "Case status alert",
    what: "When DOL changes the status of a case you watch, and for a year after it's decided, in case of an appeal or a reversal.",
    when: "When it changes",
    start: { label: "Check a case", href: "/perm-case-status" },
  },
  uscis: {
    name: "USCIS receipt alerts",
    one: "USCIS receipt alert",
    what: "When USCIS changes the status of a receipt you watch. A beta: we check every 4 hours and after USCIS's overnight updates.",
    when: "When it changes",
    start: { label: "Check a receipt", href: "/uscis-case-status" },
  },
  block: {
    name: "Receipt block alerts",
    one: "Receipt block you follow",
    what: "When every number in a USCIS receipt block you follow is checked, when its share approved passes a quarter, a half and three quarters, and a summary each Monday.",
    when: "When it moves, and Mondays",
    start: { label: "Any receipt block's page", href: "/uscis-receipt-blocks" },
  },
  queue: {
    name: "Queue alerts",
    one: "Queue alert",
    what: "One email the day DOL's queue reaches your filing month.",
    when: "Once",
    start: { label: "Processing times", href: "/perm-processing-times" },
  },
  bulletin: {
    name: "Visa bulletin alerts",
    one: "Visa bulletin alert",
    what: "When the cutoff date you watch moves in a new bulletin.",
    when: "When it moves",
    start: { label: "Priority date calculator", href: "/tools/priority-date-calculator" },
  },
  employer: {
    name: "Employer alerts",
    one: "Employer you follow",
    what: "When an employer's PERM cases change status: every case, or only the days DOL moves them as a group.",
    when: "When it happens",
    start: { label: "Any employer's page", href: "/perm-employers" },
  },
  newsletter: {
    name: "Weekly digest",
    one: "Weekly digest",
    what: "DOL's queue, visa bulletin moves, USCIS times and new rules, in one email.",
    when: "Tuesdays",
    start: { label: "Sign up for the digest", href: "/perm-case-alerts#digest" },
  },
  news: {
    name: "Product news",
    one: "Product news",
    what: "Occasional notes about new data and tools.",
    when: "Now and then",
    start: ANY_ALERT_FORM,
  },
  reminders: {
    name: "Deadline reminders",
    one: "Deadline reminders",
    what: "Your cases' deadlines before they're due, gathered into one email a day.",
    when: "Before a deadline",
    start: SETTINGS,
  },
  updates: {
    name: "Case updates",
    one: "Case updates",
    what: "When a case in your account changes status or gets an RFI or RFE.",
    when: "When it changes",
    start: SETTINGS,
  },
  digest: {
    name: "Weekly case summary",
    one: "Weekly case summary",
    what: "Your whole caseload: what's overdue, what's due this week and what changed.",
    when: "Mondays",
    start: SETTINGS,
  },
};

/**
 * The house rules every subscriber kind follows, said once. The site page
 * draws them as its three rules; the emailed page repeats the last.
 */
export const MAIL_RULES = [
  { title: "You confirm first", body: "Nothing is sent until you click the link in a confirmation email." },
  { title: "Case changes come at once", body: "Other alerts from the same day arrive together, in one email." },
  { title: "Off in one click", body: "Every email links here, and turning things off never needs a password." },
] as const;

/**
 * Which DOL queue a queue alert measures its month against. "perm" is the
 * analyst-review queue; the two prevailing-wage queues are DOL's OEWS and
 * non-OEWS receipt-date frontiers from the same snapshot.
 */
export type DolQueue = "perm" | "pwd-oews" | "pwd-nonoews";

/** One queue in words, for subjects, bodies and the preferences page alike. */
export function queueLabel(queue: DolQueue): string {
  switch (queue) {
    case "perm":
      return "PERM analyst-review queue";
    case "pwd-oews":
      return "prevailing-wage queue (OEWS)";
    case "pwd-nonoews":
      return "prevailing-wage queue (non-OEWS)";
  }
}

/** "EB2 India", "EB3 all countries": one visa bulletin series in words. */
export function seriesLabel(category: string, country: string): string {
  const countryLabel =
    country === "worldwide" ? "all countries" : country.charAt(0).toUpperCase() + country.slice(1);
  return `${category} ${countryLabel}`;
}

// ============================================================================
// One address's subscriptions, as rows
// ============================================================================

/** What `emailPrefs.stateForEmail` returns, as far as a list of rows needs it. */
export interface SubscriptionState {
  email: string;
  queueAlerts: { id: string; filingMonth: string; queue: string; active: boolean; notified: boolean }[];
  caseAlerts: { id: string; caseNumber: string; active: boolean }[];
  /** USCIS receipts watched (the tracking beta), with what the checker last read. */
  uscisAlerts: {
    id: string;
    receipt: string;
    active: boolean;
    status: string | null;
    checkedAt: number | null;
    notFound: boolean;
  }[];
  bulletinAlerts: { id: string; category: string; country: string; active: boolean }[];
  employerAlerts: { id: string; employerName: string; active: boolean; scope?: "group" | "each" }[];
  /** USCIS receipt blocks followed; absent from callers built before block follows. */
  blockAlerts?: { id: string; block: string; form?: string; active: boolean }[];
  news: boolean;
  newsletter: boolean;
  /** Null when no account exists for the address. */
  weeklyDigest: boolean | null;
}

export interface SubscriptionRow {
  kind: PrefsKind;
  /** The alert row's id; absent for the address-wide kinds. */
  id?: string;
  /** What this one is: a case number, a queue and month, an employer. Plain text. */
  detail: string;
  /** True when `detail` is a case number, shown in a fixed-width face. */
  isCaseNumber?: boolean;
  /** A second line in plain text: for a USCIS receipt, what the checker last read and when. */
  note?: string;
}

/**
 * What a watched receipt's row says under it: USCIS's newest status and when it was checked, or that it hasn't
 * been yet. Always the time of the check, so a checker that has stopped reads as an old time, never as "no change".
 */
export function uscisCheckedNote(a: { status: string | null; checkedAt: number | null; notFound: boolean }): string {
  if (a.checkedAt === null) return "Not checked yet.";
  const when = checkedLabel(a.checkedAt);
  if (a.notFound) return `USCIS showed no case under it when we checked, at ${when}.`;
  return a.status ? `USCIS showed “${a.status}” when we checked, at ${when}.` : `Last checked at ${when}.`;
}

/**
 * The live subscriptions for one address, grouped the way every surface
 * shows them: alerts, then the digest and news, then the account's weekly
 * case summary. Turned-off, unconfirmed and closed rows are left out.
 */
export function subscriptionRows(state: SubscriptionState): {
  alerts: SubscriptionRow[];
  digests: SubscriptionRow[];
  account: SubscriptionRow[];
} {
  const alerts: SubscriptionRow[] = [
    ...state.caseAlerts
      .filter((a) => a.active)
      .map((a) => ({ kind: "case" as const, id: a.id, detail: a.caseNumber, isCaseNumber: true })),
    ...state.uscisAlerts
      .filter((a) => a.active)
      .map((a) => ({ kind: "uscis" as const, id: a.id, detail: a.receipt, isCaseNumber: true, note: uscisCheckedNote(a) })),
    ...state.queueAlerts
      .filter((a) => a.active)
      .map((a) => ({
        kind: "queue" as const,
        id: a.id,
        detail: `${queueLabel(a.queue as DolQueue)}, ${monthLabel(a.filingMonth)} filings${a.notified ? " (already sent)" : ""}`,
      })),
    ...state.bulletinAlerts
      .filter((a) => a.active)
      .map((a) => ({ kind: "bulletin" as const, id: a.id, detail: seriesLabel(a.category, a.country) })),
    ...state.employerAlerts
      .filter((a) => a.active)
      .map((a) => ({
        kind: "employer" as const,
        id: a.id,
        detail: a.scope === "each" ? `${a.employerName}, every case` : `${a.employerName}, group moves`,
      })),
    ...(state.blockAlerts ?? [])
      .filter((a) => a.active)
      .map((a) => ({ kind: "block" as const, id: a.id, detail: `${a.block}, ${a.form ? `${a.form} cases` : "every form"}` })),
  ];
  const digests: SubscriptionRow[] = [];
  if (state.newsletter) digests.push({ kind: "newsletter", detail: `${MAIL_KINDS.newsletter.when}: ${MAIL_KINDS.newsletter.what}` });
  if (state.news) digests.push({ kind: "news", detail: MAIL_KINDS.news.what });
  const account: SubscriptionRow[] =
    state.weeklyDigest === true ? [{ kind: "digest", detail: `${MAIL_KINDS.digest.when}: ${MAIL_KINDS.digest.what}` }] : [];
  return { alerts, digests, account };
}

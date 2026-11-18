/**
 * Active consent to a policy change: the one home of its versions and rules.
 *
 * USCIS's Developer Portal affidavit checklist asks for active consent "when changes are made to privacy policies
 * and terms of service". The Privacy Policy (section 19) and the Terms promise it: a change that affects how
 * information already given is used doesn't apply to that person until they accept it, at sign-in with an account,
 * through an emailed link for alerts without one.
 *
 * Zero friction until a real change: everyone holds the baseline, and an absent acceptance means the baseline, so
 * nobody sees anything until POLICY_CONSENT_VERSION moves past it. Move it ONLY for a change that affects how
 * information already given is used (a new use, a new recipient), never for wording, a new section or a new kind
 * of information collected from then on. Versions are ISO days, so they compare as strings.
 */
import { MS_PER_HOUR } from "./time";

/** The version every account and subscriber holds without doing anything: the policy as of Nov 18 2026. */
export const POLICY_BASELINE_VERSION = "2026-11-18";

/** The newest version that needs active consent. Equal to the baseline until a change affects information given. */
export const POLICY_CONSENT_VERSION = "2026-11-18";

/**
 * What each version above the baseline changes, in one plain sentence. The banner, the accept page and the change
 * email all print it, so a person accepts something they were told. A test fails any version above the baseline
 * that has none. The baseline needs none: nobody is asked to accept it.
 */
export const POLICY_CHANGE_SUMMARIES: Readonly<Record<string, string>> = {};

const VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A version as the routes take it: an ISO day, nothing longer. */
export function isPolicyVersion(v: unknown): v is string {
  return typeof v === "string" && v.length === 10 && VERSION_SHAPE.test(v);
}

/** Whether someone who last accepted `accepted` (absent: the baseline) must accept `current` before it applies. */
export function needsConsent(accepted: string | null | undefined, current: string = POLICY_CONSENT_VERSION): boolean {
  return (accepted ?? POLICY_BASELINE_VERSION) < current;
}

/**
 * The token purpose for one version's accept link. The version is inside the signed message, so a link mailed
 * for one version never accepts another.
 */
export function policyAcceptPurpose(version: string): `policy-accept:${string}` {
  return `policy-accept:${version}`;
}

/** Accept requests from one caller: enough for a household sharing an address, not a script's burst. */
export const POLICY_ACCEPT_IP_LIMIT = { limit: 20, windowMs: MS_PER_HOUR };

/**
 * The lists whose confirmed, live subscribers get a change email when they hold no account: the four alert kinds
 * and the weekly digest signed up for on its own (`newsletterSubscribers`), each with the ref prefix its rows carry
 * in queued mail, so an opt-out drops a queued copy (convex/lib/alertOutboxStore.ts).
 */
export const NOTICE_TABLES = ["caseStatusAlerts", "dolQueueAlerts", "bulletinAlerts", "employerAlerts", "newsletterSubscribers"] as const;
export type NoticeTable = (typeof NOTICE_TABLES)[number];
export const NOTICE_REF: Readonly<Record<NoticeTable, string>> = {
  caseStatusAlerts: "case",
  dolQueueAlerts: "queue",
  bulletinAlerts: "bulletin",
  employerAlerts: "employer",
  newsletterSubscribers: "digest",
};

/**
 * A row still in use: not unsubscribed, and for the kinds that finish, not finished (a queue alert sent its one
 * email, a case alert's case closed). An address whose only rows are finished has nothing running to consent for.
 */
export function liveRow(table: NoticeTable, row: { unsubscribedAt?: number; notifiedAt?: number; caseClosedAt?: number }): boolean {
  if (row.unsubscribedAt !== undefined) return false;
  if (table === "dolQueueAlerts") return row.notifiedAt === undefined;
  if (table === "caseStatusAlerts") return row.caseClosedAt === undefined;
  return true;
}

/** Rows read per sweep step: small enough for one mutation, many steps a minute. */
export const NOTICE_PAGE = 50;

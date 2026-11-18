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

/** The alert tables whose confirmed, live subscribers get a change email when they hold no account. */
export const NOTICE_TABLES = ["caseStatusAlerts", "dolQueueAlerts", "bulletinAlerts", "employerAlerts"] as const;
export type NoticeTable = (typeof NOTICE_TABLES)[number];

/** Rows read per sweep step: small enough for one mutation, many steps a minute. */
export const NOTICE_PAGE = 50;

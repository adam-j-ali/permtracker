/**
 * The USCIS receipt tracking beta's rules, pure (convex/uscisAlerts.ts runs them).
 *
 * Two parties meet here. A person signs up a receipt by email; the private checker, which asks USCIS about every
 * watched receipt, reads the list and posts back what USCIS said. The checker's two routes in convex/http.ts are
 * the contract below, and nothing about who watches a receipt ever crosses it: the list is receipt numbers, the
 * results come back by receipt number, and the answer is a count.
 *
 *   GET  /uscis-watched           -> 200 {"receipts": ["IOE...", ...], "capped": boolean}
 *   POST /uscis-watched/results   {"results": [{"receipt", "status", "group", "form", "checkedAt"}]} -> 200 {"recorded": n}
 *
 * Both take `Authorization: Bearer <WATCHED_CASES_SECRET>`, the secret and the check the /watched-cases routes use.
 */
import { v, type Infer } from "convex/values";

import { normaliseReceipt } from "../../src/lib/uscis/receipt";
import { SITE_URL } from "./links";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "./time";

/** Receipts the beta watches at most, in all; the list the checker reads stops here. */
export const WATCHED_RECEIPTS_CAP = 2_000;
/** Receipts one address may watch: a household's filings and some, never a firm's caseload. */
export const MAX_RECEIPTS_PER_ADDRESS = 25;
/** Results one POST may carry. */
export const RESULTS_PER_CALL_MAX = 500;
/** A results body longer than this is refused before it's parsed. 500 results run to about 100 KB. */
export const RESULTS_BODY_MAX_CHARS = 400_000;
/** A sign-up nobody confirmed is deleted after this many days. */
export const UNCONFIRMED_WATCH_DAYS = 30;
/** How long a receipt is watched after a final status with nothing new, as DOL's case alerts are. */
export const WATCH_AFTER_FINAL_MS = 365 * MS_PER_DAY;
/**
 * The wait between a results post and its emails. The checker posts a full run in several calls of up to 500, a
 * few minutes apart, so two receipts of one address that moved in the same run go in one email.
 */
export const SEND_SETTLE_MS = 5 * MS_PER_MINUTE;
/**
 * Least time between two emails about one receipt: a valve against a status flapping between checks, never a
 * throttle on real news (the checker looks every 4 hours). A held email goes on the next retry run.
 */
export const RECEIPT_ALERT_COOLDOWN_MS = MS_PER_HOUR;

/** USCIS's status groups as the checker reads them. "none" is USCIS having no case under the number. */
export const uscisGroupValidator = v.union(
  v.literal("approved"),
  v.literal("denied"),
  v.literal("withdrawn"),
  v.literal("closed"),
  v.literal("revoked"),
  v.literal("rfe"),
  v.literal("waiting"),
  v.literal("rejected"),
  v.literal("decided"),
  v.literal("other"),
  v.literal("none"),
);
export type UscisGroup = Infer<typeof uscisGroupValidator>;
export const USCIS_GROUPS = uscisGroupValidator.members.map((m) => m.value) as readonly UscisGroup[];

/** Groups that end a filing. A year after one with nothing new, the watch ends. */
const FINAL_GROUPS: ReadonlySet<string> = new Set(["approved", "denied", "withdrawn", "closed", "revoked", "rejected", "decided"]);

export function isFinalGroup(group: string | undefined): boolean {
  return group !== undefined && FINAL_GROUPS.has(group);
}

/** The groups a reader would call good news, for an email's colour. Words carry the meaning. */
export function groupTone(group: string | undefined): "good" | "bad" | "neutral" {
  if (group === "approved") return "good";
  if (group === "denied" || group === "revoked" || group === "rejected" || group === "rfe") return "bad";
  return "neutral";
}

/**
 * A receipt that can be watched: three letters and ten digits, upper-cased, spaces and dashes dropped. A masked
 * receipt (USCIS's `IOE*123456789`) reads as a receipt on the lookup page but can't be checked, so it isn't one here.
 */
export function watchableReceipt(input: string): string | null {
  // Length first, the cheap guard: a pasted page never reaches the pattern.
  if (input.length > 40) return null;
  const receipt = normaliseReceipt(input);
  return receipt && /^[A-Z]{3}\d{10}$/.test(receipt) ? receipt : null;
}

/** The receipt on the lookup page. */
export function receiptPageUrl(receipt: string): string {
  return `${SITE_URL}/uscis-case-status?receipt=${encodeURIComponent(receipt)}`;
}

/**
 * The receipt's block on the receipt-blocks pages: an online (IOE) number's block of 100,000, or the index for a
 * paper number, whose blocks the pages don't draw.
 */
export function receiptBlockUrl(receipt: string): string {
  return /^IOE\d{10}$/.test(receipt)
    ? `${SITE_URL}/uscis-receipt-blocks/${receipt.slice(0, 8)}`
    : `${SITE_URL}/uscis-receipt-blocks`;
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header || header.length > 600) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

/** One result as the checker sends it, checked. */
export interface UscisResult {
  receipt: string;
  status: string;
  group: UscisGroup;
  form: string | null;
  /** `checkedAt` as milliseconds. */
  checkedAt: number;
}

const STATUS_MAX = 200;
const FORM_MAX = 12;
const CHECKED_AT_MAX = 40;
/** An ISO time names its day and minute, then seconds if it likes, then its offset; Date.parse reads the rest. */
const ISO_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_BODY = /^[\dT:.+Z-]+$/;
const FORM_SHAPE = /^[A-Z]{1,2}-\d{1,4}[A-Z]{0,3}$/;
// Control characters, which no status title carries and an HTML page or an email header mustn't receive.
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A checkedAt this far ahead of our clock is refused: the checker's clock is wrong, and its newest would win forever. */
const FUTURE_SLACK_MS = 10 * MS_PER_MINUTE;
/** Nothing the beta holds was checked before it existed. */
const EARLIEST_CHECK = Date.UTC(2026, 0, 1);

/**
 * Read a results body, every field checked with its length cap first. One bad result refuses the whole post,
 * named by its place and field, so the checker's fault shows instead of a silent gap.
 */
export function parseResults(
  body: unknown,
  now: number,
): { ok: true; results: UscisResult[] } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, message: "The body must be an object." };
  const list = (body as Record<string, unknown>).results;
  if (!Array.isArray(list)) return { ok: false, message: "results must be an array." };
  if (list.length > RESULTS_PER_CALL_MAX) {
    return { ok: false, message: `At most ${RESULTS_PER_CALL_MAX} results a call; this one carried ${list.length}.` };
  }
  const out: UscisResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const at = `results[${i}]`;
    const item = list[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) return { ok: false, message: `${at} must be an object.` };
    const r = item as Record<string, unknown>;

    if (typeof r.receipt !== "string" || r.receipt.length > 20) return { ok: false, message: `${at}.receipt must be a receipt number.` };
    const receipt = r.receipt.trim().toUpperCase();
    if (!/^[A-Z]{3}\d{10}$/.test(receipt)) return { ok: false, message: `${at}.receipt must be three letters and ten digits.` };

    if (typeof r.group !== "string" || r.group.length > 16 || !(USCIS_GROUPS as readonly string[]).includes(r.group)) {
      return { ok: false, message: `${at}.group must be one of ${USCIS_GROUPS.join(", ")}.` };
    }
    const group = r.group as UscisGroup;

    if (typeof r.status !== "string" || r.status.length > STATUS_MAX) {
      return { ok: false, message: `${at}.status must be text of at most ${STATUS_MAX} characters.` };
    }
    const status = r.status.trim().replace(/\s+/g, " ");
    if (CONTROL.test(r.status.replace(/[\t\n\r]/g, " "))) return { ok: false, message: `${at}.status carries a control character.` };
    // A found case always has a title; only "none" (USCIS has no case under the number) may come without one.
    if (status.length === 0 && group !== "none") return { ok: false, message: `${at}.status is empty.` };

    let form: string | null = null;
    if (r.form !== null && r.form !== undefined) {
      if (typeof r.form !== "string" || r.form.length > FORM_MAX) return { ok: false, message: `${at}.form must be a form name or null.` };
      const f = r.form.trim().toUpperCase();
      if (f.length > 0) {
        if (!FORM_SHAPE.test(f)) return { ok: false, message: `${at}.form must look like I-485.` };
        form = f;
      }
    }

    if (
      typeof r.checkedAt !== "string" ||
      r.checkedAt.length > CHECKED_AT_MAX ||
      !ISO_BODY.test(r.checkedAt) ||
      !ISO_START.test(r.checkedAt) ||
      !ISO_ZONE.test(r.checkedAt)
    ) {
      return { ok: false, message: `${at}.checkedAt must be an ISO time with its offset.` };
    }
    const checkedAt = Date.parse(r.checkedAt);
    if (!Number.isFinite(checkedAt) || checkedAt < EARLIEST_CHECK) return { ok: false, message: `${at}.checkedAt isn't a real time.` };
    if (checkedAt > now + FUTURE_SLACK_MS) return { ok: false, message: `${at}.checkedAt is in the future.` };

    out.push({ receipt, status, group, form, checkedAt });
  }
  return { ok: true, results: out };
}

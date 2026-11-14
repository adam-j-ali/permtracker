/**
 * Every error code the API sends, in one list.
 *
 * The API reads it for each refusal's title, the OpenAPI document publishes
 * it, and the developer page prints it with an anchor per code, which is where
 * a problem document's `type` link lands. A test fails when the code names a
 * code this list doesn't, so a new refusal can't ship undocumented.
 *
 * Pure: no server-only import.
 */

export interface ApiErrorDoc {
  code: string;
  status: 400 | 401 | 403 | 404 | 429 | 500 | 503;
  /** The kind of problem in a few words: a problem document's `title`. */
  title: string;
  /** What it means and what to do. */
  meaning: string;
  /** Whether a call that ends this way counts against the plan's allowance. */
  counted: boolean;
}

export const API_ERRORS: readonly ApiErrorDoc[] = [
  { code: "bad_request", status: 400, title: "The request isn't valid", meaning: "A parameter is missing, malformed or out of range. The message says which one and what it takes.", counted: false },
  { code: "refused", status: 400, title: "The change was refused", meaning: "A webhook or watch couldn't be added or removed as asked. The message says why.", counted: false },
  { code: "missing_key", status: 401, title: "No API key", meaning: "The endpoint needs a key. Make one free in Settings, under API keys, and send it as Authorization: Bearer <key>.", counted: false },
  { code: "invalid_key", status: 401, title: "The key isn't recognised", meaning: "The key is malformed or isn't one of ours. Keys start with pt_live_ or pt_test_ and are 46 characters long.", counted: false },
  { code: "revoked_key", status: 401, title: "The key was revoked", meaning: "The key was revoked or replaced. Make a new one in Settings.", counted: false },
  { code: "expired_key", status: 401, title: "The key has expired", meaning: "The key passed the expiry date it was made with. Make a new one in Settings.", counted: false },
  { code: "missing_scope", status: 403, title: "The key lacks a scope", meaning: "The key can read public records, and this call needs more: export, live_lookup or webhooks. Make a key with that scope.", counted: false },
  { code: "plan_feature", status: 403, title: "Not on this plan", meaning: "The plan doesn't include the feature, or has reached how many of something it may hold.", counted: false },
  { code: "sandbox_key", status: 403, title: "Not with a sandbox key", meaning: "A pt_test_ key answers sample data and can't change anything. Use a live key.", counted: false },
  { code: "not_found", status: 404, title: "No such record", meaning: "We hold no record for what was asked. The message often names a page that can help.", counted: true },
  { code: "rate_limited", status: 429, title: "Too many calls this minute", meaning: "The plan's calls a minute are used. Retry-After says how many seconds until the minute turns.", counted: false },
  { code: "daily_limit", status: 429, title: "The day's calls are used", meaning: "The plan's calls for today are used. They reset at midnight UTC.", counted: false },
  { code: "monthly_limit", status: 429, title: "The month's calls are used", meaning: "The plan's calls for this month are used. They reset on the first of the month, UTC.", counted: false },
  { code: "busy", status: 429, title: "Many callers at once", meaning: "The shared pool for calls without a key is full for this minute. Try again shortly, or use a key for your own limit.", counted: false },
  { code: "live_daily_limit", status: 429, title: "The day's live lookups are used", meaning: "The account's live DOL lookups for today are used. Without live=1 the API still answers from our records.", counted: false },
  { code: "live_api_limit", status: 429, title: "The API's live lookups are used", meaning: "Every account together has used the API's live DOL lookups for today, so DOL never sees a spike from us.", counted: false },
  { code: "live_site_limit", status: 429, title: "The site's live lookups are used", meaning: "The whole site's live DOL lookups for today are used, and we hold no record of the case yet.", counted: false },
  { code: "export_daily_limit", status: 429, title: "The day's export rows are used", meaning: "The account has exported its rows for today. They reset at midnight UTC.", counted: false },
  { code: "internal_error", status: 500, title: "Something went wrong on our side", meaning: "Our failure, not the request's. Nothing was counted. Try again shortly.", counted: false },
  { code: "unavailable", status: 503, title: "Not available right now", meaning: "A part the call needs can't be reached. Try again in a minute.", counted: false },
  { code: "key_check_failed", status: 503, title: "The key couldn't be checked", meaning: "We couldn't check the key just now, so nothing was answered. Try again in a minute.", counted: false },
  { code: "dol_unavailable", status: 503, title: "DOL didn't answer", meaning: "A live lookup asked DOL and got no answer in time, and we hold no record of the case yet.", counted: false },
  { code: "live_unavailable", status: 503, title: "The live lookup couldn't run", meaning: "We couldn't count this live lookup, so DOL wasn't asked. Try again in a minute.", counted: false },
  { code: "record_failed", status: 503, title: "The case couldn't be recorded", meaning: "DOL answered a live lookup, and we couldn't record the case. Try again in a minute.", counted: false },
  { code: "export_unavailable", status: 503, title: "The export couldn't be counted", meaning: "We couldn't count today's export rows, so nothing was exported or counted. Try again in a minute.", counted: false },
  { code: "not_loaded", status: 503, title: "The data isn't loaded yet", meaning: "A table the call reads isn't loaded. Try again later.", counted: false },
];

const BY_CODE = new Map(API_ERRORS.map((e) => [e.code, e]));

const STATUS_TITLES: Record<number, string> = {
  400: "The request isn't valid",
  401: "The key was refused",
  403: "Not allowed",
  404: "No such record",
  429: "A limit was reached",
  500: "Something went wrong on our side",
  503: "Not available right now",
};

/** A problem document's title for a code: the catalogue's, or the status's own when the code is new. */
export function errorTitle(code: string, status: number): string {
  return BY_CODE.get(code)?.title ?? STATUS_TITLES[status] ?? "The request failed";
}

/** The anchor on the developer page that explains a code. A problem document's `type` ends with it. */
export function errorAnchor(code: string): string {
  return `error-${code.replace(/_/g, "-")}`;
}

/** The codes that can answer with a given status, for the OpenAPI document. */
export function errorsWithStatus(status: number): readonly ApiErrorDoc[] {
  return API_ERRORS.filter((e) => e.status === status);
}

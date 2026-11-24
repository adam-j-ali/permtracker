import type { getClient } from "@sentry/nextjs";

import { redactDeep, redactEmails } from "@convex/lib/redactEmails";
import { redactShareKey } from "@/lib/analyticsRedact";

/**
 * No email address, and no share link's key (scrubShareKeys, below), leaves the browser for Sentry.
 *
 * Email addresses (Nov 4 2026): the backend already replaces each with a short
 * label (convex/lib/sentry.ts), and the browser had still sent the signed-in person's address and name as the
 * Sentry user, plus any address inside a message. The user keeps its id only, and every address in the
 * event's message, exception values, breadcrumbs, request address and extra data becomes the same label
 * (`email#` and six hex digits), so one person's errors still group together.
 */
interface EventLike {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  request?: { url?: string };
  extra?: Record<string, unknown>;
  user?: Record<string, unknown>;
}

export async function redactBrowserEvent<E extends EventLike>(event: E): Promise<E> {
  if (event.user) event.user = event.user.id !== undefined ? { id: event.user.id } : {};
  if (typeof event.message === "string") event.message = await redactEmails(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = await redactEmails(ex.value);
  }
  for (const b of event.breadcrumbs ?? []) {
    if (typeof b.message === "string") b.message = await redactEmails(b.message);
    if (b.data) b.data = (await redactDeep(b.data)) as Record<string, unknown>;
  }
  if (event.request?.url) event.request.url = await redactEmails(event.request.url);
  if (event.extra) event.extra = (await redactDeep(event.extra)) as Record<string, unknown>;
  return scrubShareKeys(event);
}

/** How deep an event is walked. Sentry normalises events to a few levels, so nothing it sends is deeper. */
const SCRUB_DEPTH = 16;

/**
 * No recruitment record's share key reaches Sentry (Nov 20 2026). The page at /share/recruitment/<key> opens to
 * anyone holding the key, and the Privacy Policy says we keep only a one-way hash of it, but an error, a trace or a
 * log line names the page by its address: the request URL, onRequestError's `extra.path` (src/instrumentation.ts), a
 * navigation breadcrumb, a span's name or `url.full`. Every string in the event, at any depth, has the key replaced by
 * "redacted" (redactShareKey), and the path before it stays, so the page is still recognisable. In place, and
 * returned, for beforeSend, beforeSendSpan, beforeSendLog and whole envelopes alike; an object seen twice is walked
 * once.
 */
export function scrubShareKeys<E>(event: E): E {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return redactShareKey(value);
    if (!value || typeof value !== "object" || depth > SCRUB_DEPTH || seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const next = walk(value[i], depth + 1);
        if (next !== value[i]) value[i] = next;
      }
    } else {
      const bag = value as Record<string, unknown>;
      for (const k of Object.keys(bag)) {
        const next = walk(bag[k], depth + 1);
        if (next !== bag[k]) bag[k] = next;
      }
    }
    return value;
  };
  return walk(event, 0) as E;
}

/**
 * Every envelope a Sentry client sends is scrubbed of share keys just before it goes, as the last step. beforeSend,
 * beforeSendSpan and beforeSendLog see each item first, but Sentry writes two things into a span envelope after
 * beforeSendSpan has run: each span's `sentry.segment.name`, refreshed to the page span's later name, and the
 * envelope's trace header (`trace.transaction`), read from the live page span. Call once after each Sentry.init.
 */
export function scrubShareKeysOnSend(client: ReturnType<typeof getClient>): void {
  client?.on("beforeEnvelope", (envelope) => {
    scrubShareKeys(envelope);
  });
}

/**
 * One way out for every alert email, so a person hears from us at most once a day.
 *
 * Each alert kind (case status, queue
 * month, visa bulletin, employer follow) still decides WHAT to say and builds
 * its own complete email; this decides WHEN it leaves.
 *
 * - An address that follows exactly one thing, has not been sent an alert
 *   today (Eastern), and has nothing waiting gets the email now. That is
 *   almost everyone, and for them nothing changes.
 * - Anyone else's email waits in `alertOutbox`. `alertOutbox.sendBundles`
 *   runs half an hour after each sweep and sends each waiting address ONE
 *   email: the stored email itself when one item waits, one "Your PERM
 *   Tracker updates" email when several do. An address already mailed today
 *   waits for tomorrow's first run.
 *
 * - EXCEPT a case-status change (kind "case"), which always goes now (owner's
 *   call, Oct 7 2026): it is the news someone signed up to hear first, and
 *   holding it for a bundle could cost them most of a day. Anything older
 *   about the same case still waiting is dropped, so no bundle repeats it.
 *   Queue, bulletin and employer news still follow the rule above.
 *
 * A queued item counts as delivered for the producer's own change detector,
 * so the producer never re-queues it; the outbox owns retries from then on.
 * A failed direct send returns `failed` and the producer does NOT advance,
 * exactly as before, so the next sweep tries again.
 *
 * Budgets are unchanged: every item still claims its unit from its own
 * kind's global budget before it is built, and a bundle of several items
 * sends one email against several claimed units, which only ever errs low.
 */

import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { FROM_EMAIL, getResend, sendOrQueue } from "./email";
import { easternDay } from "./time";

export type AlertKind = "case" | "queue" | "bulletin" | "employer" | "match";
/** `<kind>:<row id>`: the subscription an alert is about, its kind first. */
export type AlertRef = `${AlertKind}:${string}`;

/** Kinds that never wait for a bundle. */
export const IMMEDIATE_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>(["case"]);

/**
 * How long a sweep's claim on a send holds. A sweep writes its claim in a mutation BEFORE it calls deliverAlert
 * and records the alert AFTER, so a second run (or a retry) skips a row whose send may already have gone out; a
 * failed delivery clears the claim. A claim older than this is a run that died: `deliveredSince` says whether its
 * email went (the row is then recorded as told) or not (the row is free again). The same 15 minutes as case
 * alerts' ALERT_SEND_CLAIM_MS (convex/caseAlerts.ts).
 */
export const SEND_CLAIM_MS = 15 * 60 * 1000;

/** True while a claim stamped at `at` still holds. */
export function claimHolds(at: number | undefined, now: number): boolean {
  return at !== undefined && now - at < SEND_CLAIM_MS;
}

/**
 * Whether the outbox holds an alert for `ref` sent or queued at or after `since`: a lapsed claim's stamp. Then the
 * run that left the claim got its email out (or into the day's bundle) and died before recording it, so a sweep
 * that finds the lapsed claim records the row as told instead of sending again. Without such a row the run died
 * before its send, and the row is sent as before. Two indexed reads, the newest row of each status.
 */
export async function deliveredSince(ctx: Pick<MutationCtx, "db">, ref: string, since: number): Promise<boolean> {
  for (const status of ["sent", "queued"] as const) {
    const newest = await ctx.db
      .query("alertOutbox")
      .withIndex("by_ref_status", (q) => q.eq("ref", ref).eq("status", status))
      .order("desc")
      .first();
    if (newest && newest.createdAt >= since) return true;
  }
  return false;
}

/**
 * Kinds where two waiting items for one row are different news, so a newer one
 * doesn't replace the older: an employer's moves, and the PERMs found for a
 * wage request on different days.
 */
export const ACCUMULATING_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>(["employer", "match"]);

export interface AlertSummary {
  /** What it is about: "G-100-26125-868956", "Adobe Inc.", "EB2 India". */
  title: string;
  /** What happened, in one line. */
  line: string;
  /** Where to look. Absolute. */
  url: string;
  tone?: "good" | "bad" | "neutral";
}

export interface AlertItem {
  email: string;
  kind: AlertKind;
  /** `<kind>:<row id>`, so an opt-out drops anything still waiting for it. */
  ref: AlertRef;
  subject: string;
  html?: string;
  text: string;
  /** The kind's own one-click opt-out, for the `List-Unsubscribe` header. */
  listUnsubscribe: string;
  summary: AlertSummary;
}

export type DeliveryResult =
  | { status: "sent" }
  | { status: "queued" }
  | { status: "failed"; error: string };

/** RFC 8058 one-click headers for a single opt-out URL. */
export function oneClickHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function deliverAlert(ctx: ActionCtx, item: AlertItem): Promise<DeliveryResult> {
  const now = Date.now();
  const day = easternDay(now);
  const state = await ctx.runQuery(internal.alertOutbox.deliveryState, {
    email: item.email,
    day,
  });

  if (!state.sendNow && !IMMEDIATE_KINDS.has(item.kind)) {
    await ctx.runMutation(internal.alertOutbox.enqueue, {
      email: item.email,
      kind: item.kind,
      ref: item.ref,
      subject: item.subject,
      html: item.html,
      text: item.text,
      listUnsubscribe: item.listUnsubscribe,
      summary: item.summary,
    });
    return { status: "queued" };
  }

  const result = await sendOrQueue(ctx, "alert", getResend(), {
    from: FROM_EMAIL,
    to: item.email,
    subject: item.subject,
    html: item.html,
    text: item.text,
    headers: oneClickHeaders(item.listUnsubscribe),
  }, { refs: [item.ref] });
  if (result.error) {
    return { status: "failed", error: `${result.error.name}: ${result.error.message}` };
  }
  await ctx.runMutation(internal.alertOutbox.recordDirect, {
    email: item.email,
    kind: item.kind,
    ref: item.ref,
    subject: item.subject,
    summary: item.summary,
    day,
  });
  return { status: "sent" };
}

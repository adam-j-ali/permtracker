/**
 * Retention for the backend's operational logs.
 *
 * These tables have no other cleanup: systemErrors, marketingEvents,
 * apiUsage, emailDays and chatConfirmations. It also deletes browser notifications
 * stopped STOPPED_PUSH_DAYS ago. They're records of what the machinery did, not anyone's data,
 * and none is read past a few
 * weeks: the admin panel shows recent errors, the morning report reads one
 * day of usage. So each keeps a margin well past its readers and the rest goes,
 * in batches so a backlog can never make one run too big.
 *
 * The run also starts `toolCache.cleanExpired` (chat tool results expire by
 * their own TTL rather than by age, so that cleanup lives with the cache) and
 * `inboundFilter.pruneHeld` (mail the spam filter held, 30 days after it was held).
 *
 * Not here, on purpose: `auditLogs` (kept indefinitely by the retention
 * policy, docs/compliance/DATA_RETENTION.md, and removed with an account),
 * people's own content (cases, notes, messages sent to us), and the tables
 * that already have their own cleanup (notifications, conversations, rate
 * limits, the alert outbox, daily reports, budget refusals).
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { MS_PER_DAY } from "./lib/time";

/** Days each table keeps. Read by the tests and the retention doc. */
export const RETENTION_DAYS = {
  systemErrors: 180,
  marketingEvents: 365,
  apiUsage: 90,
  /** One row per UTC day of email counts (convex/emailLedger.ts); a year and a bit of history. */
  emailDays: 400,
  /** The chat's confirmation cards (convex/chatConfirmations.ts); each expires after a day. */
  chatConfirmations: 30,
} as const;

/** Rows one run deletes per table; a longer backlog reschedules itself. */
const BATCH = 500;

/**
 * A case-alert sign-up nobody confirmed in this many days is dropped. Such
 * rows hold an address that never said yes, are never mailed, and sit at the
 * front of the sweep's index (never checked), so every 5-minute sweep re-read
 * them. The confirmation link in the email stops working after this.
 */
export const UNCONFIRMED_CASE_ALERT_DAYS = 30;

/**
 * A browser notification someone stopped (or that ended: the case reached a final status, the browser
 * revoked it) is deleted this many days after it stopped (owner, Nov 5 2026). Until then the row stays,
 * marked stopped and never used; a browser that comes back gets a fresh row either way.
 */
export const STOPPED_PUSH_DAYS = 90;

/** Rows a run reads from each of the queue, bulletin and employer sign-up tables. */
const OTHER_ALERTS_LOOK = 2_000;

export const pruneOperationalLogs = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({
    systemErrors: v.number(),
    marketingEvents: v.number(),
    apiUsage: v.number(),
    emailDays: v.number(),
    chatConfirmations: v.number(),
    unconfirmedCaseAlerts: v.number(),
    unconfirmedOtherAlerts: v.number(),
    stoppedPush: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const out = {
      systemErrors: 0,
      marketingEvents: 0,
      apiUsage: 0,
      emailDays: 0,
      chatConfirmations: 0,
      unconfirmedCaseAlerts: 0,
      unconfirmedOtherAlerts: 0,
      stoppedPush: 0,
    };
    let more = false;
    for (const table of Object.keys(RETENTION_DAYS) as (keyof typeof RETENTION_DAYS)[]) {
      const cutoff = now - RETENTION_DAYS[table] * MS_PER_DAY;
      const old = await ctx.db
        .query(table)
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(BATCH + 1);
      for (const row of old.slice(0, BATCH)) await ctx.db.delete(row._id);
      out[table] = Math.min(old.length, BATCH);
      if (old.length > BATCH) more = true;
    }
    // Never-checked live rows lead the sweep's index; the unconfirmed ones
    // among them past the horizon go. Equal index keys come in creation order,
    // so the first row inside the horizon ends the read: every row after it is
    // younger. A run reschedules only when it deleted something, so rows it
    // can't delete (confirmed, waiting for their first check) never spin it.
    const staleBefore = now - UNCONFIRMED_CASE_ALERT_DAYS * MS_PER_DAY;
    let looked = 0;
    for await (const row of ctx.db
      .query("caseStatusAlerts")
      .withIndex("by_alert_sweep", (q) =>
        q.eq("unsubscribedAt", undefined).eq("caseClosedAt", undefined).eq("lastCheckedAt", undefined),
      )) {
      if (row._creationTime >= staleBefore) break;
      if (++looked > BATCH * 4) {
        if (out.unconfirmedCaseAlerts > 0) more = true;
        break;
      }
      if (row.confirmedAt !== undefined) continue;
      await ctx.db.delete(row._id);
      if (++out.unconfirmedCaseAlerts >= BATCH) {
        more = true;
        break;
      }
    }
    // The queue, bulletin, employer, product-news and weekly-digest sign-ups nobody confirmed go on the same
    // horizon (they had been kept for good). Read through an index that leads with confirmedAt, so only unconfirmed
    // rows past the horizon are read: confirmed rows, never deleted, can't fill the read. An unconfirmed row
    // someone stopped is kept. A run reads at most OTHER_ALERTS_LOOK a table; whatever it deleted is gone,
    // so the next day's run reads past it.
    const sources = [
      ctx.db
        .query("dolQueueAlerts")
        .withIndex("by_confirmed_created", (q) => q.eq("confirmedAt", undefined).lt("createdAt", staleBefore)),
      ctx.db
        .query("employerAlerts")
        .withIndex("by_confirmed_created", (q) => q.eq("confirmedAt", undefined).lt("createdAt", staleBefore)),
      ctx.db
        .query("bulletinAlerts")
        .withIndex("by_confirmed_created", (q) => q.eq("confirmedAt", undefined).lt("createdAt", staleBefore)),
      // The product-news and weekly-digest lists are sign-ups too, staged by a checkbox and confirmed by a
      // click (convex/lib/newsConsent.ts). They had no clean-up at all.
      ctx.db
        .query("newsSubscribers")
        .withIndex("by_confirmed_created", (q) => q.eq("confirmedAt", undefined).lt("createdAt", staleBefore)),
      ctx.db
        .query("newsletterSubscribers")
        .withIndex("by_confirmed_created", (q) => q.eq("confirmedAt", undefined).lt("createdAt", staleBefore)),
    ];
    for (const source of sources) {
      let seen = 0;
      for await (const row of source) {
        if (++seen > OTHER_ALERTS_LOOK) break;
        if (row.confirmedAt !== undefined || row.unsubscribedAt !== undefined) continue;
        await ctx.db.delete(row._id);
        out.unconfirmedOtherAlerts++;
      }
    }
    // Stopped browser notifications, STOPPED_PUSH_DAYS after they stopped. An open row's closedAt is
    // undefined, which sorts before every number, so the range reads stopped rows only.
    const stoppedBefore = now - STOPPED_PUSH_DAYS * MS_PER_DAY;
    for (const table of ["caseStatusPushAlerts", "bulletinPushAlerts"] as const) {
      const old = await ctx.db
        .query(table)
        .withIndex("by_closed", (q) => q.gte("closedAt", 0).lt("closedAt", stoppedBefore))
        .take(BATCH + 1);
      for (const row of old.slice(0, BATCH)) await ctx.db.delete(row._id);
      out.stoppedPush += Math.min(old.length, BATCH);
      if (old.length > BATCH) more = true;
    }
    // Guarded on progress, so an empty table can never spin a timer.
    if (more) await ctx.scheduler.runAfter(0, internal.retention.pruneOperationalLogs, { now });
    // Once per daily run: the last run of the chain is the one with no backlog left.
    else {
      await ctx.scheduler.runAfter(0, internal.toolCache.cleanExpired, {});
      // Mail the spam filter held, 30 days after it was held (convex/inboundFilter.ts).
      await ctx.scheduler.runAfter(0, internal.inboundFilter.pruneHeld, {});
    }
    return out;
  },
});

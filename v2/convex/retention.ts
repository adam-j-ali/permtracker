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
 * their own TTL rather than by age, so that cleanup lives with the cache),
 * `inboundFilter.pruneHeld` (mail the spam filter held, 30 days after it was held),
 * `eraseDeletedCaseCopies` (a deleted case's copy in the change log,
 * DELETED_CASE_DAYS after the deletion, with the rest of that case's change history)
 * `reminderRecipients.expireInvites` (an invitation to a case's deadline
 * reminders nobody confirmed, 30 days after it was sent) and
 * `uscisAlerts.expireUnconfirmed` (a USCIS receipt watch nobody confirmed, 30 days on).
 *
 * Not here, on purpose: the rest of `auditLogs` (kept indefinitely by the retention
 * policy, docs/compliance/DATA_RETENTION.md, and removed with an account),
 * people's own content (cases, notes, messages sent to us), and the tables
 * that already have their own cleanup (notifications, conversations, rate
 * limits, the alert outbox, daily reports, budget refusals).
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { DELETED_CASE_DAYS } from "./lib/deletedCases";
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
      ctx.db
        .query("blockAlerts")
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
      // Deleted cases' copies, once they can't be restored (convex/lib/deletedCases.ts).
      await ctx.scheduler.runAfter(0, internal.retention.eraseDeletedCaseCopies, { now });
      // Invitations to a case's deadline reminders nobody confirmed, 30 days on (convex/reminderRecipients.ts).
      await ctx.scheduler.runAfter(0, internal.reminderRecipients.expireInvites, { now });
      // USCIS receipt watches nobody confirmed, 30 days on (convex/uscisAlerts.ts).
      await ctx.scheduler.runAfter(0, internal.uscisAlerts.expireUnconfirmed, { now });
    }
    return out;
  },
});

/** Change-log rows one erasure run deletes or empties; a longer backlog reschedules itself. */
export const ERASE_BATCH = 500;
/** Deletions one erasure run reads. Each holds a whole case, so the read stays small. */
const ERASE_COPIES_READ = 100;

/**
 * DELETED_CASE_DAYS after a case was deleted, the change log's copy of it is erased: the case can't be restored
 * from Settings any more, so nothing of it is kept. The case's other change-log rows (its creation and every edit,
 * which hold its values too) are deleted, and the deletion's own row loses the copy and keeps who deleted which case
 * and when, with `erasedAt`. The index leads with whether a copy is still held, so an erased deletion is never read
 * again. A run that erased something and had more to do starts the next; one that erased nothing never does.
 */
export const eraseDeletedCaseCopies = internalMutation({
  args: { now: v.number() },
  returns: v.object({ copies: v.number(), history: v.number() }),
  handler: async (ctx, args) => {
    const cutoff = args.now - DELETED_CASE_DAYS * MS_PER_DAY;
    const out = { copies: 0, history: 0 };
    let more = false;
    const deletions = await ctx.db
      .query("auditLogs")
      .withIndex("by_table_action_erased_and_timestamp", (q) =>
        q.eq("tableName", "cases").eq("action", "delete").eq("erasedAt", undefined).lt("timestamp", cutoff),
      )
      .take(ERASE_COPIES_READ + 1);
    if (deletions.length > ERASE_COPIES_READ) more = true;
    deletions: for (const deletion of deletions.slice(0, ERASE_COPIES_READ)) {
      for await (const row of ctx.db
        .query("auditLogs")
        .withIndex("by_document_id", (q) => q.eq("documentId", deletion.documentId))) {
        if (row._id === deletion._id || row.tableName !== "cases") continue;
        if (out.history + out.copies >= ERASE_BATCH) {
          more = true;
          break deletions;
        }
        await ctx.db.delete(row._id);
        out.history++;
      }
      // Patching a field to undefined deletes it: the copy goes, the row's who and when stay.
      await ctx.db.patch(deletion._id, { changes: undefined, erasedAt: args.now });
      out.copies++;
    }
    if (more && out.history + out.copies > 0) {
      await ctx.scheduler.runAfter(0, internal.retention.eraseDeletedCaseCopies, args);
    }
    return out;
  },
});

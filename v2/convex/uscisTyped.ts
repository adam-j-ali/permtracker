import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { checkRateLimit, recordRateLimitAttempt } from "./lib/rateLimit";
import { easternDay, MS_PER_DAY, MS_PER_HOUR } from "./lib/time";
import { watchableReceipt } from "./lib/uscisWatch";

/**
 * Receipt numbers typed into the USCIS lookup, for the sample to check (the Privacy Policy, "Our sample of USCIS
 * cases": a typed number joins the numbers the sample checks each week, with the numbers around it, counted apart
 * from the random draw). The page sends a number once it reads as a receipt; the kit pulls new ones every 15 minutes
 * (beta_sync.py) and reads them on USCIS's public page. Nothing else is kept: no email, no address, no account.
 *
 * Guards, cheapest first: the shape (three letters, ten digits) in the route; then a per-address limit, then one
 * global budget of new numbers a day, charged before the row is written, so a refusal leaves no trace. A number
 * already held only moves its last-typed time. A row goes 12 months after its last typing (pruneTyped).
 */

/** New numbers a day, all callers together: far above real demand, small enough that a flood can't fill the kit's day. */
export const TYPED_DAILY_MAX = 3000;
/** New numbers an hour from one address. */
export const TYPED_PER_ADDRESS_HOUR = 60;
export const TYPED_KEEP_MS = 365 * MS_PER_DAY;

export const record = internalMutation({
  args: { receipt: v.string(), ip: v.optional(v.string()) },
  returns: v.union(
    v.object({ ok: v.literal(true), new: v.boolean() }),
    v.object({ ok: v.literal(false), why: v.union(v.literal("shape"), v.literal("busy"), v.literal("full")) }),
  ),
  handler: async (ctx, { receipt, ip }) => {
    const r = watchableReceipt(receipt.slice(0, 40));
    if (!r) return { ok: false as const, why: "shape" as const };
    const now = Date.now();
    const held = await ctx.db
      .query("uscisTypedReceipts")
      .withIndex("by_receipt", (q) => q.eq("receipt", r))
      .unique();
    if (held) {
      await ctx.db.patch(held._id, { lastAt: now, times: held.times + 1 });
      return { ok: true as const, new: false };
    }
    if (ip) {
      const limit = await checkRateLimit(ctx, ip, "uscis_typed", { limit: TYPED_PER_ADDRESS_HOUR, windowMs: MS_PER_HOUR });
      if (!limit.allowed) return { ok: false as const, why: "busy" as const };
    }
    const day = easternDay(now);
    const count = await ctx.db
      .query("uscisTypedDays")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    if ((count?.n ?? 0) >= TYPED_DAILY_MAX) return { ok: false as const, why: "full" as const };
    // The budget first, then the row.
    if (count) await ctx.db.patch(count._id, { n: count.n + 1 });
    else await ctx.db.insert("uscisTypedDays", { day, n: 1 });
    if (ip) await recordRateLimitAttempt(ctx, ip, "uscis_typed");
    await ctx.db.insert("uscisTypedReceipts", { receipt: r, firstAt: now, lastAt: now, times: 1 });
    return { ok: true as const, new: true };
  },
});

/** The numbers first typed after `after` (ms), oldest first, for the kit: at most `limit`, with the cursor to ask from next. */
export const typedSince = internalQuery({
  args: { after: v.number(), limit: v.number() },
  returns: v.object({ receipts: v.array(v.string()), next: v.number() }),
  handler: async (ctx, { after, limit }) => {
    const take = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = await ctx.db
      .query("uscisTypedReceipts")
      .withIndex("by_firstAt", (q) => q.gt("firstAt", after))
      .take(take);
    return { receipts: rows.map((x) => x.receipt), next: rows.length ? rows[rows.length - 1]!.firstAt : after };
  },
});

/** Daily: rows last typed over 12 months ago go, and day counters older than a week; a batch a run, rescheduled by the cron. */
export const pruneTyped = internalMutation({
  args: {},
  returns: v.object({ gone: v.number() }),
  handler: async (ctx) => {
    const cut = Date.now() - TYPED_KEEP_MS;
    let gone = 0;
    for await (const row of ctx.db.query("uscisTypedReceipts").withIndex("by_lastAt", (q) => q.lt("lastAt", cut))) {
      await ctx.db.delete(row._id);
      if (++gone >= 500) break;
    }
    const oldDay = easternDay(Date.now() - 7 * MS_PER_DAY);
    for await (const d of ctx.db.query("uscisTypedDays").withIndex("by_day", (q) => q.lt("day", oldDay))) {
      await ctx.db.delete(d._id);
    }
    return { gone };
  },
});

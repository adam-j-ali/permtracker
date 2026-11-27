/**
 * "Ask us to check this block": a USCIS receipt block's page, while its numbers aren't all checked, lets a visitor ask
 * for the whole block to be checked. Each ask is a vote on the block's one row. The checker pulls the open rows
 * (GET /block-requests, behind its secret) and walks them most votes first, a day waiting counting as one more vote,
 * ties by the first vote, and a block it has started always finishing first. It sends back its line
 * (POST /block-queue-state), so a block's page can say where that block stands and about when it's done.
 *
 * Nothing about the visitor is kept with a vote. The IP address only meets the rate limits (kept in the rate-limit
 * records, deleted within a day), as the Privacy Policy says: one vote per connection per block a day, a few blocks
 * per connection a day, and a site-wide hourly cap, the one limit rotation can't get around.
 *
 * @module
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { BLOCK_RE } from "./lib/blockUpdate";
import { checkRateLimit, recordRateLimitAttempt } from "./lib/rateLimit";
import { connectionThrottleReply, siteThrottleReply } from "./lib/throttleReply";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "./lib/time";
import type { BlockQueueState } from "./lib/blockQueue";

export const BLOCKS_PER_IP_PER_DAY = 10;
export const VOTES_PER_HOUR = 300;
/** The checker reports every 10 minutes: a line older than this means it isn't running right now. */
export const LINE_STALE_MS = 30 * MS_PER_MINUTE;
/** A block checked in full can be asked for again once its pass is this old (Nov 26 2026, "Check again"). */
export const AGAIN_AFTER_MS = 7 * MS_PER_DAY;
const BLOCK_NUMBERS = 100_000;

const voteReply = v.object({
  ok: v.boolean(),
  message: v.string(),
  votes: v.optional(v.number()),
  already: v.optional(v.boolean()),
  done: v.optional(v.boolean()),
  throttled: v.optional(v.boolean()),
});

export const vote = internalMutation({
  args: { block: v.string(), ip: v.optional(v.string()) },
  returns: voteReply,
  handler: async (ctx, args) => {
    if (!BLOCK_RE.test(args.block)) return { ok: false as const, message: "That isn't a receipt block." };
    const row = await ctx.db
      .query("blockRequests")
      .withIndex("by_block", (q) => q.eq("block", args.block))
      .unique();
    const again = !!row?.doneAt && Date.now() - row.doneAt >= AGAIN_AFTER_MS;
    if (row?.doneAt && !again) {
      return {
        ok: false as const,
        done: true,
        message: "Every number in this block was checked in the last week. You can ask again a week after that check.",
      };
    }
    const ip = args.ip?.trim();
    const known = ip && ip !== "unknown" ? ip : null;
    if (known) {
      const again = await checkRateLimit(ctx, known, `block_request:${args.block}`, { limit: 1, windowMs: MS_PER_DAY });
      if (!again.allowed) {
        return { ok: true as const, already: true, votes: row?.votes ?? 0, message: "You've already asked for this block today." };
      }
      const perIp = await checkRateLimit(ctx, known, "block_request_ip", { limit: BLOCKS_PER_IP_PER_DAY, windowMs: MS_PER_DAY });
      if (!perIp.allowed) return { ok: false as const, throttled: true, message: connectionThrottleReply(perIp.resetInMs) };
    }
    const all = await checkRateLimit(ctx, "all", "block_request_all", { limit: VOTES_PER_HOUR, windowMs: MS_PER_HOUR });
    if (!all.allowed) return { ok: false as const, throttled: true, message: siteThrottleReply(all.resetInMs, "block requests") };

    // The limits are charged before the vote counts (a refusal leaves no vote behind).
    await recordRateLimitAttempt(ctx, "all", "block_request_all");
    if (known) {
      await recordRateLimitAttempt(ctx, known, `block_request:${args.block}`);
      await recordRateLimitAttempt(ctx, known, "block_request_ip");
    }
    const now = Date.now();
    if (row && again) {
      // A new pass: the old request's votes were for the old pass.
      await ctx.db.replace(row._id, { block: args.block, votes: 1, firstAt: now, lastAt: now });
      return { ok: true as const, votes: 1, message: "Asked. The checker picks it up within 10 minutes." };
    }
    if (row) {
      await ctx.db.patch(row._id, { votes: row.votes + 1, lastAt: now });
      return { ok: true as const, votes: row.votes + 1, message: "Asked. The checker picks it up within 10 minutes." };
    }
    await ctx.db.insert("blockRequests", { block: args.block, votes: 1, firstAt: now, lastAt: now });
    return { ok: true as const, votes: 1, message: "Asked. The checker picks it up within 10 minutes." };
  },
});

/** The open requests, for the checker's pull (one row per block, so a few hundred at most). */
export const openRequests = internalQuery({
  args: {},
  returns: v.array(v.object({ block: v.string(), votes: v.number(), firstAt: v.number() })),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("blockRequests")
      .withIndex("by_done", (q) => q.eq("doneAt", undefined))
      .take(1000);
    return rows.map((r) => ({ block: r.block, votes: r.votes, firstAt: r.firstAt }));
  },
});

/** The checker's line, kept as one row; a block it walked closes that block's request. */
export const recordQueue = internalMutation({
  args: {
    at: v.number(),
    running: v.boolean(),
    perMinute: v.optional(v.number()),
    items: v.array(
      v.object({ block: v.string(), position: v.number(), status: v.union(v.literal("walking"), v.literal("waiting")), handed: v.number(), votes: v.number() }),
    ),
    walked: v.array(v.object({ block: v.string(), at: v.number() })),
  },
  returns: v.object({ line: v.number(), closed: v.number() }),
  handler: async (ctx, args) => {
    const line = await ctx.db
      .query("blockQueue")
      .withIndex("by_key", (q) => q.eq("key", "line"))
      .unique();
    const doc = { key: "line", at: args.at, running: args.running, perMinute: args.perMinute, items: args.items, walked: args.walked };
    if (line) await ctx.db.replace(line._id, doc);
    else await ctx.db.insert("blockQueue", doc);
    let closed = 0;
    for (const w of args.walked) {
      const row = await ctx.db
        .query("blockRequests")
        .withIndex("by_block", (q) => q.eq("block", w.block))
        .unique();
      if (row && !row.doneAt && row.firstAt <= w.at) {
        await ctx.db.patch(row._id, { doneAt: w.at });
        closed += 1;
      }
    }
    return { line: args.items.length, closed };
  },
});

export type BlockStanding = {
  block: string;
  votes: number;
  /** The checker handed out every number of the block (its page updates after the next load). */
  doneAt: number | null;
  /** Asked, but not in the checker's line yet (it pulls every 10 minutes). */
  joining: boolean;
  position: number | null;
  status: "walking" | "waiting" | null;
  /** Share of the block's numbers handed out, 0 to 1. */
  handed: number;
  inLine: number;
  running: boolean;
  /** Minutes until the block's numbers are all handed out, at the checker's measured pace; null while it's stopped. */
  etaMinutes: number | null;
  lineAt: number | null;
};

/** Where one block stands, for its page. Pure, so the arithmetic is tested on its own. */
export function standingFor(
  block: string,
  row: { votes: number; doneAt?: number } | null,
  line: BlockQueueState | null,
  now: number,
): BlockStanding {
  const items = line?.items ?? [];
  const idx = items.findIndex((i) => i.block === block);
  const item = idx >= 0 ? items[idx] : undefined;
  const walked = line?.walked.find((w) => w.block === block);
  const running = !!line && line.running && now - line.at <= LINE_STALE_MS;
  let etaMinutes: number | null = null;
  if (item && running && line?.perMinute && line.perMinute > 0) {
    const left = items.slice(0, idx + 1).reduce((s, i) => s + Math.max(0, BLOCK_NUMBERS - i.handed), 0);
    etaMinutes = Math.max(1, Math.round(left / line.perMinute));
  }
  const doneAt = row?.doneAt ?? walked?.at ?? null;
  return {
    block,
    votes: row?.votes ?? item?.votes ?? 0,
    doneAt,
    joining: !!row && !row.doneAt && !item && !walked,
    position: item?.position ?? null,
    status: item?.status ?? null,
    handed: item ? Math.min(1, item.handed / BLOCK_NUMBERS) : doneAt ? 1 : 0,
    inLine: items.length,
    running,
    etaMinutes,
    lineAt: line?.at ?? null,
  };
}

const nullable = <T extends ReturnType<typeof v.number>>(x: T) => v.union(x, v.null());

export const standing = internalQuery({
  args: { block: v.string() },
  returns: v.object({
    block: v.string(),
    votes: v.number(),
    doneAt: nullable(v.number()),
    joining: v.boolean(),
    position: nullable(v.number()),
    status: v.union(v.literal("walking"), v.literal("waiting"), v.null()),
    handed: v.number(),
    inLine: v.number(),
    running: v.boolean(),
    etaMinutes: nullable(v.number()),
    lineAt: nullable(v.number()),
  }),
  handler: async (ctx, args): Promise<BlockStanding> => {
    const row = await ctx.db
      .query("blockRequests")
      .withIndex("by_block", (q) => q.eq("block", args.block))
      .unique();
    const line = await ctx.db
      .query("blockQueue")
      .withIndex("by_key", (q) => q.eq("key", "line"))
      .unique();
    return standingFor(args.block, row, line, Date.now());
  },
});

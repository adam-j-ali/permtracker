/**
 * The database half of the password-reset counts: add one, read the week, and count from an action. The names, the
 * report's verdict and the wrapper that watches each reset are in convex/lib/resetOutcomes.ts.
 */
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { RESET_OUTCOMES, RESET_WINDOW_DAYS, type ResetCounts, type ResetOutcome } from "./resetOutcomes";
import { MS_PER_DAY, easternDay } from "./time";

/** Add one to today's count of `kind`. */
export async function bumpOutcome(ctx: MutationCtx, kind: ResetOutcome, now = Date.now()): Promise<void> {
  const day = easternDay(now);
  const row = await ctx.db
    .query("authOutcomes")
    .withIndex("by_day_kind", (q) => q.eq("day", day).eq("kind", kind))
    .unique();
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("authOutcomes", { day, kind, count: 1 });
}

/** The window's totals: at most three rows a day, read by the day index. */
export async function readResetCounts(ctx: QueryCtx, now = Date.now()): Promise<ResetCounts> {
  const from = easternDay(now - (RESET_WINDOW_DAYS - 1) * MS_PER_DAY);
  const rows = await ctx.db
    .query("authOutcomes")
    .withIndex("by_day_kind", (q) => q.gte("day", from))
    .take(RESET_WINDOW_DAYS * RESET_OUTCOMES.length * 2);
  const total = (kind: ResetOutcome) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0);
  return { days: RESET_WINDOW_DAYS, sent: total("resetSent"), completed: total("resetCompleted"), failed: total("resetFailed") };
}

/**
 * Count an outcome from an action (the sign-in action's ctx, or the code sender's). Best effort: the count is a
 * monitor, never a gate, so a failed count is logged and the reset goes on.
 */
export async function noteResetOutcome(ctx: unknown, kind: ResetOutcome): Promise<void> {
  const host = ctx as
    | { runMutation?: (ref: typeof internal.authOutcomes.note, args: { kind: ResetOutcome }) => Promise<unknown> }
    | undefined;
  if (typeof host?.runMutation !== "function") return;
  try {
    await host.runMutation(internal.authOutcomes.note, { kind });
  } catch (error) {
    console.error(`[authOutcomes] ${kind} was not counted`, error);
  }
}

/**
 * The mutation behind the password-reset counts (convex/lib/authOutcomes.ts, convex/lib/resetOutcomes.ts). Internal: it is called by the
 * sign-in action and the reset code's sender, never by a browser.
 *
 * @module convex/authOutcomes
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { bumpOutcome } from "./lib/authOutcomes";

export const note = internalMutation({
  args: { kind: v.union(v.literal("resetSent"), v.literal("resetCompleted"), v.literal("resetFailed")) },
  returns: v.null(),
  handler: async (ctx, { kind }) => {
    await bumpOutcome(ctx, kind);
    return null;
  },
});

/**
 * Stores a pass issued by convex/turnstile.ts, and uses one up. Kept apart from that file
 * because it runs in Node ("use node"), and a mutation can't.
 *
 * @module convex/turnstilePasses
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { consumePass, issuePass } from "./lib/turnstilePass";

export const issue = internalMutation({
  args: { hash: v.string() },
  returns: v.null(),
  handler: async (ctx, { hash }) => {
    await issuePass(ctx, hash, Date.now());
    return null;
  },
});

/** Use up a pass for a code-sending sign-in flow (guardCodeFlows in convex/auth.ts). */
export const consume = internalMutation({
  args: { pass: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { pass }) => consumePass(ctx, pass, Date.now()),
});

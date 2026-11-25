/**
 * A visa bulletin alert from a saved case.
 *
 * The case's preference category and chargeability name its bulletin line (convex/lib/perm/greenCard.ts), and the
 * alert is the subscription the public bulletin form makes (convex/bulletinAlerts.ts): the same table, the same
 * monthly sweep, the same email with its one-click way out. Nothing here sends mail of its own.
 *
 * The alert goes to the account's own address and nowhere else. When sign-in already proved that address (a code
 * for a password account, Google for a Google one) the row is confirmed here, the way caseAlerts.watchMyCase
 * confirms a signed-in person's own case; an address never verified takes the ordinary double opt-in through
 * bulletinAlerts.subscribe, email and all.
 *
 * One alert per line per address: two cases on the same line share it, so each shows the line's alert, and
 * turning it off on one turns the line off.
 */

import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserId, getCurrentUserIdOrNull, isEmailVerified } from "./lib/auth";
import { bulletinCategoryOf, bulletinCountryOf, chargeabilityOf } from "./lib/perm/greenCard";
import { recordConsentAtConfirm } from "./lib/policyConsentStore";
import { dropQueued } from "./lib/alertOutboxStore";
import { isPlausibleEmail } from "./lib/emailShape";
import { rateLimiter } from "./rateLimitConfig";

const lineValidator = v.union(
  v.object({
    category: v.union(...(["EB1", "EB2", "EB3", "EW3", "EB4", "EB5"] as const).map((c) => v.literal(c))),
    country: v.union(...(["worldwide", "china", "india", "mexico", "philippines"] as const).map((c) => v.literal(c))),
  }),
  v.null(),
);

/** Off, on, or waiting for the confirmation an unverified address was sent. */
const stateValidator = v.union(v.literal("off"), v.literal("on"), v.literal("pending"));
type AlertState = "off" | "on" | "pending";

/** The bulletin line a case is in, or null until it has a category and a country. */
function lineOfCase(c: Doc<"cases">) {
  const category = bulletinCategoryOf(c);
  const country = bulletinCountryOf(chargeabilityOf(c));
  return category && country ? { category, country } : null;
}

/** The account's own address as the alert table keys it, or null when it has none fit to send to. */
async function accountEmail(ctx: QueryCtx, userId: Id<"users">): Promise<string | null> {
  const user = await ctx.db.get(userId);
  const email = user?.email?.trim().toLowerCase();
  return user && !user.deletedAt && email && isPlausibleEmail(email) ? email : null;
}

function stateOf(row: Doc<"bulletinAlerts"> | null): AlertState {
  if (!row) return "off";
  if (row.confirmedAt !== undefined && row.unsubscribedAt === undefined) return "on";
  if (row.pendingSeries !== undefined) return "pending";
  return "off";
}

async function rowFor(ctx: QueryCtx, email: string, line: { category: string; country: string }) {
  return await ctx.db
    .query("bulletinAlerts")
    .withIndex("by_email_series", (q) => q.eq("email", email).eq("category", line.category).eq("country", line.country))
    .first();
}

/** The case's line and whether its alert is on, for the case page. Null for a case this account can't see. */
export const get = query({
  args: { caseId: v.id("cases") },
  returns: v.union(v.object({ line: lineValidator, state: stateValidator }), v.null()),
  handler: async (ctx, args) => {
    const userId = await getCurrentUserIdOrNull(ctx);
    if (userId === null) return null;
    const c = await ctx.db.get(args.caseId);
    if (!c || c.userId !== userId || c.deletedAt !== undefined) return null;
    const line = lineOfCase(c);
    if (!line) return { line: null, state: "off" as const };
    const email = await accountEmail(ctx, userId);
    const state = email ? stateOf(await rowFor(ctx, email, line)) : "off";
    return { line, state };
  },
});

/** Turn the alert for the case's line on or off. */
export const set = mutation({
  args: { caseId: v.id("cases"), enabled: v.boolean() },
  returns: v.object({ state: stateValidator, message: v.string() }),
  handler: async (ctx, args): Promise<{ state: AlertState; message: string }> => {
    const userId = await getCurrentUserId(ctx);
    const c = await ctx.db.get(args.caseId);
    if (!c || c.userId !== userId || c.deletedAt !== undefined) {
      throw new ConvexError("That case wasn't found.");
    }
    await rateLimiter.limit(ctx, "caseUpdate", { key: userId, throws: true });

    const line = lineOfCase(c);
    if (!line) {
      throw new ConvexError("Add the preference category and the country of birth to name the case's bulletin line first.");
    }
    const email = await accountEmail(ctx, userId);
    if (!email) throw new ConvexError("Your account has no email address we can send alerts to.");

    const existing = await rowFor(ctx, email, line);
    const now = Date.now();

    if (!args.enabled) {
      if (existing && (existing.unsubscribedAt === undefined || existing.pendingSeries !== undefined)) {
        // The same opt-out the email's own link makes (bulletinAlerts.unsubscribeByToken).
        await ctx.db.patch(existing._id, { unsubscribedAt: now, pendingSeries: undefined });
        await dropQueued(ctx, email, "bulletin");
      }
      return { state: "off", message: "The alert for this line is off." };
    }

    if (!(await isEmailVerified(ctx, userId))) {
      const sent: { ok: boolean; message: string } = await ctx.runMutation(internal.bulletinAlerts.subscribe, {
        email,
        category: line.category,
        country: line.country,
        source: "case",
      });
      return { state: sent.ok ? "pending" : "off", message: sent.message };
    }

    if (existing) {
      // The account's own signed-in request, so it may put an address back on a line it left: a fresh act by the
      // inbox's owner, which a replayed token never is. A line coming back starts over, so its first alert is the
      // next movement, not everything since the opt-out.
      const rearmed = existing.unsubscribedAt !== undefined;
      await ctx.db.patch(existing._id, {
        confirmedAt: existing.confirmedAt ?? now,
        pendingSeries: undefined,
        unsubscribedAt: undefined,
        ...(rearmed ? { lastSeenCutoff: undefined, lastSeenBulletin: undefined, source: "case" } : {}),
      });
    } else {
      await ctx.db.insert("bulletinAlerts", {
        email,
        category: line.category,
        country: line.country,
        createdAt: now,
        source: "case",
        confirmedAt: now,
      });
    }
    await recordConsentAtConfirm(ctx, email);
    return { state: "on", message: `We'll email ${email} when this line moves in a new bulletin.` };
  },
});

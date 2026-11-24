/**
 * System Errors
 *
 * Records backend errors for admin visibility and the owner's alerts.
 * Frontend errors go to Sentry; this table is for Convex-side errors
 * that need admin attention (failed crons, webhook errors, etc.).
 *
 * Where each goes is the routing list's (scripts/data/alert_routes.json): an
 * operation's first error in the hour is errors.once (the morning report counts
 * it), a database timeout or busy answer alone is errors.blip (the admin page),
 * and the same operation failing again within the hour is errors.repeat (email
 * and the owner's phone, once a day for each operation).
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
// Single-sourced from lib/errorRecording (a dependency-light helper) so schema +
// mutation + the ErrorSource TS type all share one closed-set definition without
// importing a Convex function module into broad consumers.
import { errorRoute, errorSourceValidator } from "./lib/errorRecording";
import { channelOf, isSentNow, levelOf } from "./lib/alertRoutes";
import { pushPhone, started } from "./lib/phonePush";
import { MS_PER_DAY, MS_PER_HOUR, emailStamp } from "./lib/time";
import { checkAndRecordRateLimit } from "./lib/rateLimit";

/** Admin emails about unresolved errors, at most, per rolling hour. */
const ERROR_EMAILS_PER_HOUR = 5;
/** The last hour's newest errors read to find the same operation's earlier failure. */
const REPEAT_SCAN = 100;

/**
 * Record a system error (server-side only).
 */
export const record = internalMutation({
  args: {
    source: errorSourceValidator,
    operation: v.string(),
    message: v.string(),
    stack: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    resourceId: v.optional(v.string()),
    extra: v.optional(v.string()),
  },
  returns: v.id("systemErrors"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const oneHourAgo = now - MS_PER_HOUR;
    // The same operation's earlier failure within the hour, newest first: what makes this one a repeat.
    const lastHour = await ctx.db
      .query("systemErrors")
      .withIndex("by_resolved", (q) => q.eq("resolved", false).gte("createdAt", oneHourAgo))
      .order("desc")
      .take(REPEAT_SCAN);
    const earlier = lastHour.find((e) => e.operation === args.operation);
    const route = errorRoute(args.message, earlier !== undefined);
    const errorId = await ctx.db.insert("systemErrors", {
      ...args,
      resolved: false,
      createdAt: now,
      route,
    });

    // ADMIN_ERROR_EMAILS=off silences the email on a deployment that is not
    // the live one: the DEVELOPMENT deployment runs the same crons against a
    // retired database, and its "[System Error]" emails look exactly like the
    // live site failing. The row is still recorded either way, and
    // every email now names the deployment it came from.
    if (!isSentNow(route) || process.env.ADMIN_ERROR_EMAILS === "off") return errorId;

    // At most ERROR_EMAILS_PER_HOUR an hour. The compound-index range on
    // (resolved, createdAt) reads one past that, so the read set stays small
    // and OCC storms can't start under a high error rate.
    const recentErrors = await ctx.db
      .query("systemErrors")
      .withIndex("by_resolved", (q) => q.eq("resolved", false).gte("createdAt", oneHourAgo))
      .take(ERROR_EMAILS_PER_HOUR + 1);
    if (recentErrors.length > ERROR_EMAILS_PER_HOUR) return errorId;
    // Once a day for each operation: a cron failing every 15 minutes is one email, not 96.
    const claim = await checkAndRecordRateLimit(ctx, "all", `alarm:${route}:${args.operation}`, {
      limit: 1,
      windowMs: MS_PER_DAY,
    });
    if (!claim.allowed) return errorId;

    const deployment = (process.env.CONVEX_CLOUD_URL ?? "").replace(/^https?:\/\//, "").replace(/\.convex\.cloud.*$/, "");
    await ctx.scheduler.runAfter(0, internal.notificationActions.sendAdminNotificationEmail, {
      subject: `[System Error] ${args.operation}`,
      body:
        `At: ${emailStamp(now)}\nSource: ${args.source}\nOperation: ${args.operation}` +
        `${deployment ? `\nDeployment: ${deployment}` : ""}\n\n${args.message}` +
        `${args.resourceId ? `\n\nResource: ${args.resourceId}` : ""}` +
        (route === "errors.repeat"
          ? "\n\nThis operation failed again within the hour. One failure alone waits for the morning report. " +
            "This email comes once a day for each operation, and the admin page lists every recorded error."
          : ""),
      route,
    });
    const level = levelOf(route);
    if (channelOf(route) === "phone" && level) {
      await ctx.scheduler.runAfter(0, internal.systemErrors.push, {
        title: `PERM Tracker: ${args.operation} keeps failing`,
        message: started(
          `${args.operation} failed again within the hour: ${args.message.slice(0, 200)}`,
          earlier?.createdAt ?? now,
          "Read the email; the admin page lists the recorded errors.",
        ),
        level,
      });
    }
    return errorId;
  },
});

/** The phone push beside a repeat's email; one that fails is logged, since the email has the same news. */
export const push = internalAction({
  args: { title: v.string(), message: v.string(), level: v.union(v.literal("urgent"), v.literal("high")) },
  returns: v.null(),
  handler: async (_ctx, { title, message, level }) => {
    const sent = await pushPhone(title, message, level, process.env.NTFY_TOPIC);
    if (!sent.ok) console.error(`[systemErrors] push not sent: ${sent.why}`);
    return null;
  },
});

/**
 * True at most once a day per `key`: for a stop that repeats every run (a cap reached, a key not set), so the
 * owner hears of it once a day instead of every run, and never not at all.
 */
export const claimDailyAlarm = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }) =>
    (await checkAndRecordRateLimit(ctx, "all", `alarm:${key}`, { limit: 1, windowMs: MS_PER_DAY })).allowed,
});

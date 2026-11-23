/**
 * Every 15 minutes, from outside the server: is it still reporting, does its
 * database answer, and is its disk nearly full? Emails the owner when the
 * answer changes (start, every 6 hours while it lasts, recovery); the database
 * not answering mails only on the second check in a row. The rules and the
 * reason this lives off the server: convex/lib/serverWatch.ts.
 *
 * Runs only where SERVER_WATCH=on (production). The development deployment's
 * database is the retired Turso copy, whose health report is weeks old, so it
 * would alarm forever.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { cleared, pushPhone, started } from "./lib/phonePush";
import { one } from "./lib/publicMirror";
import { type HealthRow, judge, pushFor, step } from "./lib/serverWatch";

const KEY = "server";

export const check = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.SERVER_WATCH !== "on") return null;
    const now = Date.now();
    let row: HealthRow | null = null;
    let readError: string | undefined;
    try {
      row = (await one("SELECT computed_at, json FROM perm_docs WHERE key = 'server_health'")) as HealthRow | null;
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e);
    }
    const reason = judge(row, now, readError);
    const mail = await ctx.runMutation(internal.serverWatch.record, { reason, now });
    if (mail) {
      const subject = mail.kind === "clear"
        ? "PERM Tracker server: reporting again"
        : `PERM Tracker server: ${mail.kind === "still" ? "still needs a look" : "needs a look"}`;
      const when = new Date(now).toLocaleString("en-US", {
        timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      });
      const body = mail.kind === "clear"
        ? `As of ${when}, the server's health report is fresh again and its disk has room. It had been: ${mail.reason}.`
        : `As of ${when}, ${mail.reason}.\n\nThis check runs on Convex, outside the server, every 15 minutes, so it works when the server itself can't report. The server's own alarm (permtracker-alarm) covers the disk, memory and failed jobs from inside. It emails again every 6 hours while this lasts, and once when it clears.`;
      await ctx.scheduler.runAfter(0, internal.notificationActions.sendAdminNotificationEmail, { subject, body });
      // The phone, after the email: a push that fails is logged, and the email has the same news.
      const push = pushFor(mail);
      if (push) {
        const message = push.level === "clear"
          ? cleared("The server is reporting again and its disk has room", mail.since)
          : started(`${mail.reason.charAt(0).toUpperCase()}${mail.reason.slice(1)}.`, mail.since, push.todo);
        const sent = await pushPhone(push.title, message, push.level, process.env.NTFY_TOPIC);
        if (!sent.ok) console.error(`[serverWatch] push not sent: ${sent.why}`);
      }
    }
    return null;
  },
});

export const record = internalMutation({
  args: { reason: v.union(v.string(), v.null()), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("start"), v.literal("still"), v.literal("clear")),
      reason: v.string(),
      since: v.number(),
    }),
  ),
  handler: async (ctx, { reason, now }) => {
    const row = await ctx.db.query("serverWatch").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    const prev = row
      ? { down: row.down, since: row.since, mailedAt: row.mailedAt, reason: row.reason, pendingSince: row.pendingSince,
          pendingReason: row.pendingReason, blips: row.blips }
      : null;
    const { next, mail } = step(prev, reason, now);
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("serverWatch", { key: KEY, ...next });
    return mail;
  },
});

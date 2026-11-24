/**
 * Each alert kind's latest state where it's already recorded, for the admin page's list of where every alert goes
 * (src/components/admin/AlertRoutesPanel.tsx, the routing list in scripts/data/alert_routes.json): the outside
 * watch's row, the newest recorded error of each kind, and the newest morning report's sections. The server's own
 * alarms and the defense are read through the report's server section.
 */
import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireAdmin } from "./lib/admin";
import { readReport } from "./lib/dailyReportCompose";

/** The newest recorded errors read to find each kind's latest. */
const ERRORS_READ = 200;

export const latest = query({
  args: {},
  returns: v.object({
    watch: v.union(
      v.null(),
      v.object({ down: v.boolean(), since: v.number(), reason: v.string(), blips: v.array(v.number()) }),
    ),
    errors: v.array(v.object({ route: v.string(), at: v.number(), operation: v.string() })),
    report: v.union(
      v.null(),
      v.object({
        day: v.string(),
        sections: v.array(v.object({ key: v.string(), status: v.string(), summary: v.string() })),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const row = await ctx.db.query("serverWatch").withIndex("by_key", (q) => q.eq("key", "server")).unique();
    const newest = new Map<string, { route: string; at: number; operation: string }>();
    for (const e of await ctx.db.query("systemErrors").withIndex("by_created_at").order("desc").take(ERRORS_READ)) {
      if (e.route && !newest.has(e.route)) newest.set(e.route, { route: e.route, at: e.createdAt, operation: e.operation });
    }
    const last = await ctx.db.query("dailyReports").withIndex("by_day").order("desc").first();
    const report = last ? readReport(last.report) : null;
    return {
      // The single database misses are kept a day by the watch itself (BLIP_KEEP_MS).
      watch: row ? { down: row.down, since: row.since, reason: row.reason, blips: row.blips ?? [] } : null,
      errors: [...newest.values()],
      report: report
        ? { day: report.day, sections: report.sections.map((s) => ({ key: s.key, status: s.status, summary: s.summary })) }
        : null,
    };
  },
});

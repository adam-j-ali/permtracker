import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getAdminEmail } from "./lib/admin";
import { extractUserIdFromAction } from "./lib/auth";
import { rows as mirrorRows } from "./lib/publicMirror";

/**
 * Our figures scored against DOL's own (figure_scores, written by scripts/score_official_figures.py after DOL's
 * Selected Statistics are read), for the admin's Scorecard tab only. An action because the scores sit in the
 * public-data database; the admin check mirrors adminScorecard.get. Returns the rows as a JSON string, or null before
 * the first scores exist (the table is made by the first run).
 */
export const get = action({
  args: {},
  returns: v.union(v.null(), v.object({ json: v.string() })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized: Not authenticated");
    const userId = extractUserIdFromAction(identity.subject);
    const user = await ctx.runQuery(internal.admin.getUserEmail, { userId });
    if (!user || user.email !== getAdminEmail()) {
      throw new Error("Unauthorized: Admin access required");
    }
    try {
      const got = await mirrorRows(
        `SELECT figure, scope, as_of, unit, ours, theirs, tolerance, gap, gap_pct, within, ours_source, theirs_source,
                theirs_read_on, note FROM figure_scores ORDER BY as_of DESC, figure, scope LIMIT 200`,
      );
      return { json: JSON.stringify(got) };
    } catch (error) {
      // Before the scorer's first run there's no table: say so in the panel, never as an error.
      if (String(error instanceof Error ? error.message : error).includes("no such table")) return null;
      throw error;
    }
  },
});

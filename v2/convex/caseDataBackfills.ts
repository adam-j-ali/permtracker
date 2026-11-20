/**
 * One-time data changes of Nov 20 2026, a bounded page at a time and safe to run twice. Each returns what it read and
 * changed and the cursor for the next page; `dryRun` counts without writing.
 *
 *   npx convex run caseDataBackfills:timelineSwitches '{"dryRun":true}' --prod
 *   npx convex run caseDataBackfills:timelineSwitches '{"cursor":"<the cursor printed>"}' --prod   (until done)
 *   npx convex run caseDataBackfills:clearTimelineLists '{}' --prod   (once the switches are done)
 *   npx convex run caseDataBackfills:dolCaseNumbers '{"dryRun":true}' --prod   (and again with "blank":true)
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { dolCaseNumberOnCreate } from "./lib/dolCaseNumber";
import { migratedTimelineSwitch } from "./lib/timelineShow";

/** Cases per page: a case can run to a 50,000-character job description, so pages stay small. */
const PAGE = 50;

const pageArgs = { cursor: v.optional(v.union(v.string(), v.null())), dryRun: v.optional(v.boolean()) };
const pageResult = v.object({ read: v.number(), changed: v.number(), cursor: v.string(), done: v.boolean() });

/**
 * Each case's timeline switch set from the list the menu and the picker used to keep, so every case stays on the
 * timeline where it was shown before (convex/lib/timelineShow.ts, `migratedTimelineSwitch`). Run it over every page
 * before `clearTimelineLists`: it reads the lists.
 */
export const timelineSwitches = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const page = await ctx.db.query("cases").paginate({ numItems: PAGE, cursor: args.cursor ?? null });
    const lists = new Map<string, readonly string[] | undefined>();
    let changed = 0;
    for (const c of page.page) {
      if (c.deletedAt !== undefined) continue;
      const owner = c.userId as unknown as string;
      if (!lists.has(owner)) {
        const prefs = await ctx.db
          .query("timelinePreferences")
          .withIndex("by_user_id", (q) => q.eq("userId", c.userId))
          .first();
        lists.set(owner, prefs?.selectedCaseIds as readonly string[] | undefined);
      }
      const next = migratedTimelineSwitch(c, lists.get(owner));
      if (next === c.showOnTimeline) continue;
      changed += 1;
      if (!args.dryRun) await ctx.db.patch(c._id, { showOnTimeline: next });
    }
    return { read: page.page.length, changed, cursor: page.continueCursor, done: page.isDone };
  },
});

/** The retired lists removed from the timeline's settings, once `timelineSwitches` has carried every one. */
export const clearTimelineLists = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const page = await ctx.db.query("timelinePreferences").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let changed = 0;
    for (const p of page.page) {
      if (p.selectedCaseIds === undefined) continue;
      changed += 1;
      if (!args.dryRun) await ctx.db.patch(p._id, { selectedCaseIds: undefined });
    }
    return { read: page.page.length, changed, cursor: page.continueCursor, done: page.isDone };
  },
});

/**
 * A DOL number typed only in a step's box carried into the case's DOL number, as saving the case now does
 * (convex/lib/dolCaseNumber.ts), so the watch follows it. Reads only live cases with no DOL number: missing, or with
 * `blank` a blank one, since an emptied box can be stored either way. Run it both ways.
 */
export const dolCaseNumbers = internalMutation({
  args: { ...pageArgs, blank: v.optional(v.boolean()) },
  returns: pageResult,
  handler: async (ctx, args) => {
    const empty = args.blank === true ? "" : undefined;
    const page = await ctx.db
      .query("cases")
      .withIndex("by_deletedAt_caseNumber", (q) => q.eq("deletedAt", undefined).eq("caseNumber", empty))
      .paginate({ numItems: PAGE, cursor: args.cursor ?? null });
    let changed = 0;
    for (const c of page.page) {
      const carried = dolCaseNumberOnCreate(c);
      if (!carried) continue;
      changed += 1;
      if (!args.dryRun) await ctx.db.patch(c._id, { caseNumber: carried });
    }
    return { read: page.page.length, changed, cursor: page.continueCursor, done: page.isDone };
  },
});

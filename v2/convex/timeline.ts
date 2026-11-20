/**
 * Timeline Queries and Mutations
 *
 * Provides functions for the case timeline visualization feature:
 * 1. getPreferences - Get user's timeline preferences (or defaults)
 * 2. updatePreferences - Save the range, and set which cases the timeline shows
 * 3. addCaseToTimeline - Put one case on the timeline
 * 4. removeCaseFromTimeline - Take one case off it
 *
 * Which cases show is each case's own switch (convex/lib/timelineShow.ts).
 * 5. getCasesForTimeline - Get cases with all timeline-relevant data
 */

import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserId, getCurrentUserIdOrNull } from "./lib/auth";
import { readUserCases } from "./lib/userCases";
import { caseDeadlineDates, type CaseDeadlineDates } from "./lib/caseDates";
import { onTimeline, timelineSwitchFor } from "./lib/timelineShow";

/**
 * Timeline time range type
 */
type TimeRange = 3 | 6 | 12 | 24;

/**
 * Default timeline preferences
 */
const DEFAULT_TIME_RANGE: TimeRange = 12;

/**
 * Get user's timeline preferences (or defaults)
 * Returns default values if no preferences are saved
 */
export const getPreferences = query({
  args: {},
  handler: async (ctx) => {
    // Use null-safe auth check for graceful sign-out handling
    const userId = await getCurrentUserIdOrNull(ctx);
    if (userId === null) {
      return {
        selectedCaseIds: null,
        timeRange: DEFAULT_TIME_RANGE,
      };
    }

    // Query for existing preferences
    const preferences = await ctx.db
      .query("timelinePreferences")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .first();

    if (!preferences) {
      // Return defaults if no preferences saved
      return {
        selectedCaseIds: null,
        timeRange: DEFAULT_TIME_RANGE,
      };
    }

    return {
      // Retired: which cases show is each case's own switch now (convex/lib/timelineShow.ts). Kept in the answer
      // for a page built before Nov 20 2026, which reads null as "every open case".
      selectedCaseIds: null,
      timeRange: preferences.timeRange,
    };
  },
});

/**
 * Patch one case's timeline switch when it changes what the timeline shows. Patching to undefined deletes the field,
 * which is what an unset switch is. A view choice, so the case's own "updated" time stays as it was.
 */
async function setCaseOnTimeline(ctx: MutationCtx, c: Doc<"cases">, show: boolean): Promise<void> {
  if (onTimeline(c) === show) return;
  await ctx.db.patch(c._id, { showOnTimeline: timelineSwitchFor(c, show) });
}

/** The signed-in person's live case by id, or a "Case not found" error. */
async function ownCase(ctx: MutationCtx, userId: Id<"users">, caseId: Id<"cases">): Promise<Doc<"cases">> {
  const caseDoc = await ctx.db.get(caseId);
  if (!caseDoc || caseDoc.userId !== userId || caseDoc.deletedAt !== undefined) {
    throw new Error("Case not found");
  }
  return caseDoc;
}

/**
 * Save the timeline's range, and which cases it shows.
 *
 * `selectedCaseIds` sets each case's own switch (convex/lib/timelineShow.ts): the cases listed are on the timeline and
 * every other case is off it, an empty list included. `null` puts every case back to following its status (on while
 * open). The list itself is no longer stored.
 */
export const updatePreferences = mutation({
  args: {
    selectedCaseIds: v.optional(v.union(v.null(), v.array(v.id("cases")))),
    timeRange: v.optional(v.union(v.literal(3), v.literal(6), v.literal(12), v.literal(24))),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const now = Date.now();

    if (args.selectedCaseIds !== undefined) {
      const { cases } = await readUserCases(ctx, userId);
      const shown = args.selectedCaseIds === null ? null : new Set<string>(args.selectedCaseIds);
      for (const c of cases) {
        if (shown === null) {
          if (c.showOnTimeline !== undefined) await ctx.db.patch(c._id, { showOnTimeline: undefined });
        } else {
          await setCaseOnTimeline(ctx, c, shown.has(c._id));
        }
      }
    }

    const existingPreferences = await ctx.db
      .query("timelinePreferences")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .first();

    if (existingPreferences) {
      await ctx.db.patch(existingPreferences._id, {
        updatedAt: now,
        ...(args.timeRange !== undefined ? { timeRange: args.timeRange } : {}),
        // A list saved before the switch became the one store is retired once the cases carry it.
        ...(args.selectedCaseIds !== undefined ? { selectedCaseIds: undefined } : {}),
      });
      return existingPreferences._id;
    }
    return await ctx.db.insert("timelinePreferences", {
      userId: userId,
      timeRange: args.timeRange ?? DEFAULT_TIME_RANGE,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Put one case on the timeline (the case page's menu). */
export const addCaseToTimeline = mutation({
  args: {
    caseId: v.id("cases"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    await setCaseOnTimeline(ctx, await ownCase(ctx, userId, args.caseId), true);
    return null;
  },
});

/** Take one case off the timeline (the case page's menu). */
export const removeCaseFromTimeline = mutation({
  args: {
    caseId: v.id("cases"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    await setCaseOnTimeline(ctx, await ownCase(ctx, userId, args.caseId), false);
    return null;
  },
});

/**
 * RFI/RFE entry type for timeline data
 */
interface TimelineRfiRfeEntry {
  id: string;
  title?: string;
  description?: string;
  notes?: string;
  receivedDate: string;
  responseDueDate: string;
  responseSubmittedDate?: string;
  createdAt: number;
}

/**
 * Timeline case data type
 */
interface TimelineCaseData extends CaseDeadlineDates {
  id: Id<"cases">;
  employerName: string;
  positionTitle: string;
  caseStatus: "pwd" | "recruitment" | "eta9089" | "i140" | "closed";
  progressStatus: "working" | "waiting_intake" | "filed" | "approved" | "under_review" | "rfi_rfe";
  // RFI/RFE entries
  rfiEntries: TimelineRfiRfeEntry[];
  rfeEntries: TimelineRfiRfeEntry[];
}

/**
 * Get cases with all timeline-relevant data
 * The cases whose own switch puts them on the timeline
 */
export const getCasesForTimeline = query({
  args: {
    timeRange: v.optional(v.union(v.literal(3), v.literal(6), v.literal(12), v.literal(24))),
  },
  handler: async (ctx, _args): Promise<TimelineCaseData[]> => {
    // Use null-safe auth check for graceful sign-out handling
    const userId = await getCurrentUserIdOrNull(ctx);
    if (userId === null) {
      return [];
    }

    // Live cases, newest first (convex/lib/userCases.ts)
    const { cases: allCases } = await readUserCases(ctx, userId);

    // Each case's own switch, unset meaning on while open (convex/lib/timelineShow.ts)
    const filteredCases = allCases.filter((c) => onTimeline(c));

    // Map to timeline data format
    return filteredCases.map((caseDoc) => ({
      id: caseDoc._id,
      employerName: caseDoc.employerName,
      positionTitle: caseDoc.positionTitle,
      caseStatus: caseDoc.caseStatus,
      progressStatus: caseDoc.progressStatus,
      ...caseDeadlineDates(caseDoc),
      // RFI/RFE entries - default to empty arrays
      rfiEntries: (caseDoc.rfiEntries ?? []) as TimelineRfiRfeEntry[],
      rfeEntries: (caseDoc.rfeEntries ?? []) as TimelineRfiRfeEntry[],
    }));
  },
});

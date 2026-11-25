import { v } from "convex/values";

import { internalQuery } from "./_generated/server";

/**
 * Milestones people reported for a case after DOL: the I-140 and the I-485.
 *
 * USCIS publishes nothing per case, so once a PERM is certified the public
 * record stops. These reports were the first per-case trace of what came
 * next; community timelines (convex/communityTimelines.ts) replaced them, and
 * this table is closed: nothing adds a row any more, and its rows still count
 * toward a case's stops there and read back here. They are labelled as
 * unverified user reports everywhere they render, and nothing here is ever
 * blended into an estimate.
 */

export const MILESTONE_KINDS = ["i140-filed", "i140-approved", "i485-filed", "i485-approved"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_LABEL: Record<MilestoneKind, string> = {
  "i140-filed": "I-140 filed",
  "i140-approved": "I-140 approved",
  "i485-filed": "I-485 filed",
  "i485-approved": "I-485 approved",
};

/** PERM numbers only: the FLAG form and the older A- form. */
const PERM_CASE = /^(G-\d{3}-\d{5}-\d{6}|A-\d{5}-\d{5})$/;

const summaryResult = v.object({
  caseNumber: v.string(),
  reports: v.number(),
  reporters: v.number(),
  kinds: v.array(
    v.object({
      kind: v.string(),
      label: v.string(),
      count: v.number(),
      /** The latest event date anyone gave for this kind. */
      latest: v.union(v.string(), v.null()),
    }),
  ),
});

/** Reads at most 500 rows for one case; a case with more has a problem this page is not the place to solve. */
const READ_CAP = 500;

export const summary = internalQuery({
  args: { caseNumber: v.string() },
  returns: summaryResult,
  handler: async (ctx, a) => {
    const caseNumber = a.caseNumber.trim().toUpperCase();
    const rows = PERM_CASE.test(caseNumber)
      ? await ctx.db
          .query("caseMilestones")
          .withIndex("by_case", (q) => q.eq("caseNumber", caseNumber))
          .take(READ_CAP)
      : [];
    const reporters = new Set(rows.map((r) => r.ipHash)).size;
    const kinds = MILESTONE_KINDS.map((kind) => {
      const of = rows.filter((r) => r.kind === kind);
      const latest = of.reduce<string | null>((m, r) => (m === null || r.eventDate > m ? r.eventDate : m), null);
      return { kind, label: MILESTONE_LABEL[kind], count: of.length, latest };
    });
    return { caseNumber, reports: rows.length, reporters, kinds };
  },
});

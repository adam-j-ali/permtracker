import { ConvexError, v } from "convex/values";

import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUserId, verifyOwnership } from "./lib/auth";
import { isISODateString } from "./lib/perm/types";
import {
  APPLICANT_REASON_MAX,
  APPLICANT_REF_MAX,
  APPLICANTS_PER_CASE_MAX,
} from "./lib/perm/recruitment/applicantReport";
import { recruitmentStep } from "./lib/perm/recruitment/steps";

/**
 * A case's applicant log (20 CFR 656.17(g)): what the recruitment report counts, entered one applicant at a time.
 * The form asks for a reference the account chooses, never a name or contact details, and people write every reason;
 * nothing here screens or ranks an applicant. Every read and write checks that the case is the caller's own.
 */

export const outcomeV = v.union(
  v.literal("pending"),
  v.literal("not_qualified"),
  v.literal("no_response"),
  v.literal("declined"),
  v.literal("not_available"),
  v.literal("withdrew"),
  v.literal("hired"),
  v.literal("other"),
);
export const contactV = v.union(v.literal("email"), v.literal("phone"), v.literal("letter"), v.literal("in_person"), v.literal("other"));

const fields = {
  ref: v.string(),
  appliedOn: v.optional(v.string()),
  source: v.optional(v.string()),
  contactedOn: v.optional(v.string()),
  contactMethod: v.optional(contactV),
  outcome: outcomeV,
  reason: v.optional(v.string()),
};

const applicantV = v.object({
  _id: v.id("recruitmentApplicants"),
  _creationTime: v.number(),
  userId: v.id("users"),
  caseId: v.id("cases"),
  ...fields,
  createdAt: v.number(),
  updatedAt: v.number(),
});

type Fields = {
  ref: string;
  appliedOn?: string;
  source?: string;
  contactedOn?: string;
  contactMethod?: "email" | "phone" | "letter" | "in_person" | "other";
  outcome: "pending" | "not_qualified" | "no_response" | "declined" | "not_available" | "withdrew" | "hired" | "other";
  reason?: string;
};

/** The entry as it's stored: trimmed, within its limits, its dates real, its step one the rule names. */
function clean(f: Fields): Fields {
  const ref = f.ref.trim();
  if (!ref) throw new ConvexError("Give the applicant a reference, such as Applicant 1.");
  if (ref.length > APPLICANT_REF_MAX) throw new ConvexError(`Keep the reference under ${APPLICANT_REF_MAX} characters.`);
  for (const [label, d] of [["applied", f.appliedOn], ["contacted", f.contactedOn]] as const) {
    if (d !== undefined && d !== "" && !isISODateString(d)) throw new ConvexError(`The ${label} date isn't a date.`);
  }
  if (f.source !== undefined && f.source !== "" && !recruitmentStep(f.source)) throw new ConvexError("That isn't a recruitment step.");
  const reason = f.reason?.trim();
  if (reason && reason.length > APPLICANT_REASON_MAX) throw new ConvexError(`Keep the reason under ${APPLICANT_REASON_MAX} characters.`);
  return {
    ref,
    outcome: f.outcome,
    ...(f.appliedOn ? { appliedOn: f.appliedOn } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.contactedOn ? { contactedOn: f.contactedOn } : {}),
    ...(f.contactMethod ? { contactMethod: f.contactMethod } : {}),
    ...(reason ? { reason } : {}),
  };
}

async function ownCase(ctx: MutationCtx, caseId: Id<"cases">) {
  const userId = await getCurrentUserId(ctx);
  const caseDoc = await ctx.db.get(caseId);
  await verifyOwnership(ctx, caseDoc, "case");
  if (!caseDoc || caseDoc.deletedAt !== undefined) throw new ConvexError("Case not found");
  return userId;
}

/** A case's applicants, in the order they were added. */
export const listForCase = query({
  args: { caseId: v.id("cases") },
  returns: v.array(applicantV),
  handler: async (ctx, args) => {
    await getCurrentUserId(ctx);
    const caseDoc = await ctx.db.get(args.caseId);
    await verifyOwnership(ctx, caseDoc, "case");
    return await ctx.db
      .query("recruitmentApplicants")
      .withIndex("by_caseId", (q) => q.eq("caseId", args.caseId))
      .take(APPLICANTS_PER_CASE_MAX);
  },
});

export const add = mutation({
  args: { caseId: v.id("cases"), ...fields },
  returns: v.id("recruitmentApplicants"),
  handler: async (ctx, { caseId, ...f }) => {
    const userId = await ownCase(ctx, caseId);
    const held = await ctx.db
      .query("recruitmentApplicants")
      .withIndex("by_caseId", (q) => q.eq("caseId", caseId))
      .take(APPLICANTS_PER_CASE_MAX);
    if (held.length >= APPLICANTS_PER_CASE_MAX) throw new ConvexError(`A case's log holds ${APPLICANTS_PER_CASE_MAX} applicants.`);
    const now = Date.now();
    return await ctx.db.insert("recruitmentApplicants", { userId, caseId, ...clean(f), createdAt: now, updatedAt: now });
  },
});

export const update = mutation({
  args: { id: v.id("recruitmentApplicants"), ...fields },
  returns: v.null(),
  handler: async (ctx, { id, ...f }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new ConvexError("That applicant isn't in the log.");
    await ownCase(ctx, row.caseId);
    // A replace, so a field the form cleared is gone rather than kept.
    await ctx.db.replace(id, { userId: row.userId, caseId: row.caseId, ...clean(f), createdAt: row.createdAt, updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("recruitmentApplicants") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ownCase(ctx, row.caseId);
    await ctx.db.delete(id);
    return null;
  },
});

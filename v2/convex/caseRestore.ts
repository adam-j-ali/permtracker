/**
 * Bringing back a case its owner deleted, from the change log's copy of it.
 *
 * Deleting a case erases it (cases.remove, cases.bulkRemove), but logDelete first keeps every field of the old
 * document in its deletion's auditLogs row. That copy is kept DELETED_CASE_DAYS (30) and then erased by the
 * retention run (retention.eraseDeletedCaseCopies; convex/lib/deletedCases.ts), so everything here works inside
 * those 30 days only.
 *
 * - `listRecentlyDeleted` and `restoreDeleted`: the owner's own, in Settings (Support, "Recently deleted"). A restore
 *   stores the copy again as a new case by create's rules (cases.insertCaseByCreateRules) and marks the copy
 *   restored, so it can't come back twice. Its uploaded files and its recruitment log were erased with it, and the
 *   change log never keeps the employer's FEIN, so those don't come back.
 * - `fromDeletedCopy`: a support tool, run by hand. When an owner deleted a case by mistake and entered it again
 *   by hand, it copies the fields they lost onto the new case.
 *
 * fromDeletedCopy only FILLS: a field is written when the new case holds nothing there (or
 * the field's default), never over what the owner has entered since. It reads
 * one audit row and one case, checks both belong to the same account, and
 * recalculates the derived dates and the calendar the way cases.update does.
 *
 * Support tool, run by hand, dry run first:
 *   npx convex run caseRestore:fromDeletedCopy '{"auditLogId":"...","targetCaseId":"...","fields":[...],"dryRun":true}' --prod
 *
 * Oct 12 2026: a user deleted a case after the chat said an update had saved
 * when it hadn't, and lost its recruitment record and wage.
 */
import { ConvexError, v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { calculateDerivedDates } from "./lib/derivedCalculations";
import { logUpdate } from "./lib/audit";
import { getCurrentUserId, getCurrentUserIdOrNull } from "./lib/auth";
import { scheduleCalendarSync } from "./lib/calendarSyncHelpers";
import { DELETED_CASE_DAYS, deletedCaseLabel, readDeletedCopy, restoreBy } from "./lib/deletedCases";
import { MS_PER_DAY } from "./lib/time";
import { rateLimiter } from "./rateLimitConfig";
import { CASE_CREATE_FIELDS, insertCaseByCreateRules, planCaseCreate, type CaseCreateArgs } from "./cases";

/** The most deletions Settings lists, newest first. Each row holds a whole case, so a list stays small. */
export const RECENTLY_DELETED_MAX = 100;

const NOT_YOURS = "That deleted case isn't in your account.";
const RESTORED_ALREADY = "That case was restored already. You'll find it in your cases.";
const TOO_LATE = `That case was deleted more than ${DELETED_CASE_DAYS} days ago, so it can't be restored.`;

/**
 * The account's case deletions inside the window, newest first, that haven't been restored. The index leaves restored
 * ones out, so restoring one brings the next older one into a full list.
 */
export const listRecentlyDeleted = query({
  args: { now: v.number() },
  returns: v.object({
    cases: v.array(
      v.object({
        auditLogId: v.id("auditLogs"),
        employerName: v.string(),
        positionTitle: v.string(),
        beneficiaryIdentifier: v.union(v.string(), v.null()),
        deletedAt: v.number(),
        restoreBy: v.number(),
      }),
    ),
    /** More deletions than the list holds. */
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await getCurrentUserIdOrNull(ctx);
    if (!userId) return { cases: [], more: false };
    const since = args.now - DELETED_CASE_DAYS * MS_PER_DAY;
    const cases: {
      auditLogId: Id<"auditLogs">;
      employerName: string;
      positionTitle: string;
      beneficiaryIdentifier: string | null;
      deletedAt: number;
      restoreBy: number;
    }[] = [];
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_user_table_action_restored_and_timestamp", (q) =>
        q
          .eq("userId", userId)
          .eq("tableName", "cases")
          .eq("action", "delete")
          .eq("restoredAt", undefined)
          .gte("timestamp", since),
      )
      .order("desc")
      .take(RECENTLY_DELETED_MAX + 1);
    const more = rows.length > RECENTLY_DELETED_MAX;
    for (const row of rows.slice(0, RECENTLY_DELETED_MAX)) {
      if (row.erasedAt !== undefined) continue;
      const copy = readDeletedCopy(row);
      if (copy.userId !== userId) continue;
      cases.push({
        auditLogId: row._id,
        ...deletedCaseLabel(copy),
        deletedAt: row.timestamp,
        restoreBy: restoreBy(row.timestamp),
      });
    }
    return { cases, more };
  },
});

/** Never copied from a deleted case: create's rules work these out again from its own fields. */
const WORKED_OUT_AGAIN = new Set([
  "recruitmentStartDate",
  "recruitmentEndDate",
  "filingWindowOpens",
  "filingWindowCloses",
  "recruitmentWindowCloses",
  "eta9089ExpirationDate",
  "caseNumber",
  "caseStatus",
  "progressStatus",
]);

/**
 * Never brought back: the files were erased with the case (the copy still lists them), the change log keeps no FEIN,
 * the account is the one restoring, and the row's own times are new.
 */
const NOT_BROUGHT_BACK = new Set(["documents", "employerFein", "userId", "updatedAt", "deletedAt"]);

const CASE_FIELDS = new Set(Object.keys(schema.tables.cases.validator.fields));
const CREATE_FIELDS = new Set(CASE_CREATE_FIELDS);

/**
 * What create's rules are given for a deleted case's copy, and what the new case keeps of it as it was. Every stored
 * field comes back but the ones create works out again and the ones that can't. A closed case keeps its stage, and
 * when and why it closed: create would work the stage out from the dates, and the deadline check would close it again.
 * A link to another case or to a template that's gone is left out.
 */
async function restoreInput(
  ctx: MutationCtx,
  userId: Id<"users">,
  copy: Record<string, unknown>,
): Promise<{ args: CaseCreateArgs; keep: Partial<WithoutSystemFields<Doc<"cases">>> }> {
  const args: Record<string, unknown> = {};
  const keep: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(copy)) {
    if (value === undefined || value === null || NOT_BROUGHT_BACK.has(field) || !CASE_FIELDS.has(field)) continue;
    if (CREATE_FIELDS.has(field)) args[field] = value;
    if (!WORKED_OUT_AGAIN.has(field)) keep[field] = value;
  }
  if (copy.caseStatus === "closed") {
    keep.caseStatus = copy.caseStatus;
    keep.progressStatus = copy.progressStatus;
  }

  const duplicateOf = typeof copy.duplicateOf === "string" ? ctx.db.normalizeId("cases", copy.duplicateOf) : null;
  const original = duplicateOf ? await ctx.db.get(duplicateOf) : null;
  if (!original || original.userId !== userId) {
    for (const field of ["duplicateOf", "markedAsDuplicateAt"]) {
      delete args[field];
      delete keep[field];
    }
  }
  const templateId =
    typeof copy.jobDescriptionTemplateId === "string"
      ? ctx.db.normalizeId("jobDescriptionTemplates", copy.jobDescriptionTemplateId)
      : null;
  const template = templateId ? await ctx.db.get(templateId) : null;
  if (!template || template.userId !== userId) {
    delete args.jobDescriptionTemplateId;
    delete keep.jobDescriptionTemplateId;
  }
  return {
    args: args as CaseCreateArgs,
    keep: keep as Partial<WithoutSystemFields<Doc<"cases">>>,
  };
}

/**
 * Restores one of the account's deleted cases, inside the window and once: stores its copy again as a new case by
 * create's rules (its dates, deadlines, DOL number, timeline switch and calendar), marks the copy restored, and
 * returns the new case's id.
 */
export const restoreDeleted = mutation({
  args: { auditLogId: v.id("auditLogs") },
  returns: v.id("cases"),
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    await rateLimiter.limit(ctx, "caseCreate", { key: userId, throws: true });

    const row = await ctx.db.get(args.auditLogId);
    if (!row || row.tableName !== "cases" || row.action !== "delete" || row.userId !== userId) {
      throw new ConvexError(NOT_YOURS);
    }
    if (row.restoredAt !== undefined) throw new ConvexError(RESTORED_ALREADY);
    const now = Date.now();
    if (row.erasedAt !== undefined || now > restoreBy(row.timestamp)) throw new ConvexError(TOO_LATE);
    const copy = readDeletedCopy(row);
    if (copy.userId !== userId) throw new ConvexError(NOT_YOURS);

    const { args: caseArgs, keep } = await restoreInput(ctx, userId, copy);
    // Never refused on validation: the case was saved as it is, and a rule that changed since is for its next edit.
    const plan = planCaseCreate(caseArgs);
    const caseId = await insertCaseByCreateRules(ctx, userId, caseArgs, plan, "caseRestore.restoreDeleted", keep);
    await ctx.db.patch(row._id, { restoredAt: now, restoredCaseId: caseId });
    return caseId;
  },
});

/** Fields this tool may write: the owner's own entries, never status, ids or derived dates. */
export const RESTORABLE_FIELDS = [
  "additionalRecruitmentMethods",
  "additionalRecruitmentEndDate",
  "sundayAdFirstDate",
  "sundayAdSecondDate",
  "sundayAdNewspaper",
  "jobOrderStartDate",
  "jobOrderEndDate",
  "jobOrderState",
  "noticeOfFilingStartDate",
  "noticeOfFilingEndDate",
  "pwdFilingDate",
  "pwdDeterminationDate",
  "pwdExpirationDate",
  "pwdCaseNumber",
  "pwdWageAmount",
  "pwdWageLevel",
  "recruitmentApplicantsCount",
  "recruitmentNotes",
  "isProfessionalOccupation",
  "isPinned",
  "socCode",
  "socTitle",
  "jobDescription",
  "tags",
] as const;

type Restorable = (typeof RESTORABLE_FIELDS)[number];

/** Holds nothing the owner entered: empty, or the value a new case starts with. */
export function isUnset(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === false || value === 0) return true;
  return Array.isArray(value) && value.length === 0;
}

export const fromDeletedCopy = internalMutation({
  args: {
    auditLogId: v.id("auditLogs"),
    targetCaseId: v.id("cases"),
    fields: v.array(v.string()),
    dryRun: v.boolean(),
  },
  returns: v.object({
    applied: v.boolean(),
    writes: v.any(),
    keptBecauseAlreadySet: v.array(v.string()),
    notInDeletedCopy: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.auditLogId);
    if (!row || row.action !== "delete" || row.tableName !== "cases") {
      throw new Error("That audit row isn't a deleted case.");
    }
    const target = await ctx.db.get(args.targetCaseId);
    if (!target || target.deletedAt !== undefined) throw new Error("The target case doesn't exist.");
    if (!row.userId || row.userId !== target.userId) {
      throw new Error("The deleted case and the target case belong to different accounts.");
    }

    const unknown = args.fields.filter((f) => !(RESTORABLE_FIELDS as readonly string[]).includes(f));
    if (unknown.length > 0) throw new Error(`Not restorable: ${unknown.join(", ")}`);

    const old = new Map<string, unknown>();
    for (const c of row.changes ?? []) {
      if (c.oldValue === undefined) continue;
      try {
        old.set(c.field, JSON.parse(c.oldValue));
      } catch {
        old.set(c.field, c.oldValue);
      }
    }

    const writes: Partial<Record<Restorable, unknown>> = {};
    const kept: string[] = [];
    const absent: string[] = [];
    for (const field of args.fields as Restorable[]) {
      const was = old.get(field);
      if (isUnset(was)) {
        absent.push(field);
        continue;
      }
      if (!isUnset((target as Record<string, unknown>)[field])) {
        kept.push(field);
        continue;
      }
      writes[field] = was;
    }

    const plan = { writes, keptBecauseAlreadySet: kept, notInDeletedCopy: absent };
    if (args.dryRun || Object.keys(writes).length === 0) return { applied: false, ...plan };

    const merged = { ...target, ...writes } as Doc<"cases">;
    const derived = calculateDerivedDates({
      sundayAdFirstDate: merged.sundayAdFirstDate,
      sundayAdSecondDate: merged.sundayAdSecondDate,
      jobOrderStartDate: merged.jobOrderStartDate,
      jobOrderEndDate: merged.jobOrderEndDate,
      noticeOfFilingStartDate: merged.noticeOfFilingStartDate,
      noticeOfFilingEndDate: merged.noticeOfFilingEndDate,
      additionalRecruitmentEndDate: merged.additionalRecruitmentEndDate,
      additionalRecruitmentMethods: merged.additionalRecruitmentMethods,
      additionalRecruitmentStartDate: merged.additionalRecruitmentStartDate,
      pwdExpirationDate: merged.pwdExpirationDate,
      pwdDeterminationDate: merged.pwdDeterminationDate,
      isProfessionalOccupation: merged.isProfessionalOccupation,
    });

    await ctx.db.patch(args.targetCaseId, {
      ...(writes as Partial<Doc<"cases">>),
      recruitmentStartDate: derived.recruitmentStartDate ?? undefined,
      recruitmentEndDate: derived.recruitmentEndDate ?? undefined,
      filingWindowOpens: derived.filingWindowOpens ?? undefined,
      filingWindowCloses: derived.filingWindowCloses ?? undefined,
      recruitmentWindowCloses: derived.recruitmentWindowCloses ?? undefined,
      updatedAt: Date.now(),
    });
    const after = await ctx.db.get(args.targetCaseId);
    // Logged under the case's own account: auditLogs.userId must name a user, and
    // this runs on the owner's behalf with no signed-in identity.
    await logUpdate(
      ctx,
      "cases",
      args.targetCaseId,
      target as Record<string, unknown>,
      after as Record<string, unknown>,
      undefined,
      target.userId,
    );
    if (after?.calendarSyncEnabled !== false) {
      await scheduleCalendarSync(ctx, target.userId, args.targetCaseId);
    }
    return { applied: true, ...plan };
  },
});

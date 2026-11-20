/**
 * A case's applicant log: only the case's own account reads or writes it, an edit replaces the entry (a cleared field
 * is gone), each entry is checked, and the log goes when its case does (the Privacy Policy's Case Data list).
 */
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createAuthenticatedContext, createTestContext } from "../../test-utils/convex";
import { purgeAllUserData } from "../lib/deletion";

const caseRow = (userId: Id<"users">) => ({
  userId,
  employerName: "ACME Robotics",
  positionTitle: "Engineer",
  caseStatus: "pwd" as const,
  progressStatus: "working" as const,
  rfiEntries: [],
  rfeEntries: [],
  notes: [],
  isProfessionalOccupation: true,
  isFavorite: false,
  priorityLevel: "normal" as const,
  tags: [],
  calendarSyncEnabled: false,
  documents: [],
  recruitmentApplicantsCount: 0,
  additionalRecruitmentMethods: [],
  createdAt: 1,
  updatedAt: 1,
});

async function setup() {
  const t = createTestContext();
  const owner = await createAuthenticatedContext(t, "Owner");
  const other = await createAuthenticatedContext(t, "Other");
  const caseId = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
  return { t, owner, other, caseId };
}

describe("the applicant log", () => {
  it("adds, lists, edits and removes the owner's applicants", async () => {
    const { owner, caseId } = await setup();
    const id = await owner.mutation(api.recruitmentApplicants.add, {
      caseId,
      ref: "  Applicant 1 ",
      appliedOn: "2026-01-12",
      source: "sunday_ad_1",
      contactedOn: "2026-01-14",
      contactMethod: "email",
      outcome: "not_qualified",
      reason: "No bachelor's degree, which the job requires.",
    });
    let list = await owner.query(api.recruitmentApplicants.listForCase, { caseId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: "Applicant 1", source: "sunday_ad_1", outcome: "not_qualified" });

    // An edit replaces the entry, so a field the form cleared is gone.
    await owner.mutation(api.recruitmentApplicants.update, { id, ref: "Applicant 1", outcome: "pending" });
    list = await owner.query(api.recruitmentApplicants.listForCase, { caseId });
    expect(list[0]!.reason).toBeUndefined();
    expect(list[0]!.contactedOn).toBeUndefined();

    await owner.mutation(api.recruitmentApplicants.remove, { id });
    expect(await owner.query(api.recruitmentApplicants.listForCase, { caseId })).toHaveLength(0);
  });

  it("never lets another account read or write a case's log", async () => {
    const { owner, other, caseId } = await setup();
    const id = await owner.mutation(api.recruitmentApplicants.add, { caseId, ref: "A1", outcome: "pending" });
    await expect(other.query(api.recruitmentApplicants.listForCase, { caseId })).rejects.toThrow();
    await expect(other.mutation(api.recruitmentApplicants.add, { caseId, ref: "X", outcome: "pending" })).rejects.toThrow();
    await expect(other.mutation(api.recruitmentApplicants.update, { id, ref: "X", outcome: "hired" })).rejects.toThrow();
    await expect(other.mutation(api.recruitmentApplicants.remove, { id })).rejects.toThrow();
    expect(await owner.query(api.recruitmentApplicants.listForCase, { caseId })).toHaveLength(1);
  });

  it("refuses an empty reference, a date that isn't one and a step no rule names", async () => {
    const { owner, caseId } = await setup();
    await expect(owner.mutation(api.recruitmentApplicants.add, { caseId, ref: "  ", outcome: "pending" })).rejects.toThrow(/reference/);
    await expect(
      owner.mutation(api.recruitmentApplicants.add, { caseId, ref: "A", appliedOn: "Jan 12", outcome: "pending" }),
    ).rejects.toThrow(/date/);
    await expect(owner.mutation(api.recruitmentApplicants.add, { caseId, ref: "A", source: "billboard", outcome: "pending" })).rejects.toThrow(
      /step/,
    );
  });

  it("goes when its case is deleted, and when the account is", async () => {
    const { t, owner, caseId } = await setup();
    await owner.mutation(api.recruitmentApplicants.add, { caseId, ref: "A1", outcome: "pending" });
    await owner.mutation(api.cases.remove, { id: caseId });
    expect(await t.run((ctx) => ctx.db.query("recruitmentApplicants").collect())).toHaveLength(0);

    const second = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
    await owner.mutation(api.recruitmentApplicants.add, { caseId: second, ref: "A2", outcome: "hired" });
    await t.run((ctx) => purgeAllUserData(ctx, owner.userId));
    expect(await t.run((ctx) => ctx.db.query("recruitmentApplicants").collect())).toHaveLength(0);
  });
});

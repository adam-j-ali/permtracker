/**
 * A deleted case can be restored for DELETED_CASE_DAYS from Settings: the change log's copy of it is listed for its
 * owner and stored again as a new case by create's rules. Its documents and recruitment log are erased when it's
 * deleted and the change log never keeps the employer's FEIN, so those don't come back. Each copy restores once.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createAuthenticatedContext,
  createTestContext,
  finishScheduledFunctions,
  setupSchedulerTests,
} from "../../test-utils/convex";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { buildDefaultProfile } from "../lib/userDefaults";
import { DELETED_CASE_DAYS } from "../lib/deletedCases";

const DAY = 86_400_000;

type T = ReturnType<typeof createTestContext>;
type Owner = Awaited<ReturnType<typeof createAuthenticatedContext>>;

async function makeCase(t: T, owner: Owner, fields: Record<string, unknown> = {}): Promise<Id<"cases">> {
  const id = await owner.mutation(api.cases.create, {
    employerName: "Acme Corp",
    beneficiaryIdentifier: "J.D.",
    positionTitle: "DevOps Engineer",
    calendarSyncEnabled: false,
    ...fields,
  } as never);
  await finishScheduledFunctions(t);
  return id;
}

async function deletionRow(t: T, caseId: Id<"cases">): Promise<Doc<"auditLogs">> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_document_id", (q) => q.eq("documentId", caseId))
      .collect();
    return rows.find((r) => r.action === "delete")!;
  });
}

describe("recently deleted cases", () => {
  setupSchedulerTests();

  it("lists the account's own deletions from the last 30 days, newest first, by what a person recognises", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const stranger = await createAuthenticatedContext(t, "Stranger");
    const first = await makeCase(t, owner, { employerName: "First Co", beneficiaryIdentifier: "" });
    const second = await makeCase(t, owner, { employerName: "Second Co", positionTitle: "Analyst" });
    const theirs = await makeCase(t, stranger, { employerName: "Their Co" });

    await owner.mutation(api.cases.remove, { id: first });
    vi.advanceTimersByTime(60_000);
    await owner.mutation(api.cases.bulkRemove, { ids: [second] });
    await stranger.mutation(api.cases.remove, { id: theirs });
    await finishScheduledFunctions(t);

    const now = Date.now();
    const listed = await owner.query(api.caseRestore.listRecentlyDeleted, { now });
    expect(listed.more).toBe(false);
    expect(listed.cases.map((c) => c.employerName)).toEqual(["Second Co", "First Co"]);
    const [newest, older] = listed.cases;
    expect(newest).toMatchObject({ positionTitle: "Analyst", beneficiaryIdentifier: "J.D." });
    expect(older!.beneficiaryIdentifier).toBeNull();
    expect(newest!.restoreBy).toBe(newest!.deletedAt + DELETED_CASE_DAYS * DAY);
    expect(newest!.auditLogId).toBe((await deletionRow(t, second))._id);

    // Past the window, a deletion isn't offered.
    const later = await owner.query(api.caseRestore.listRecentlyDeleted, { now: now + (DELETED_CASE_DAYS + 1) * DAY });
    expect(later.cases).toEqual([]);
    // Signed out, nothing.
    expect((await t.query(api.caseRestore.listRecentlyDeleted, { now })).cases).toEqual([]);
  });

  it("holds the newest 100, and a restore brings the next older one into the list", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const { RECENTLY_DELETED_MAX } = await import("../caseRestore");
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      const out: Id<"auditLogs">[] = [];
      for (let i = 0; i <= RECENTLY_DELETED_MAX; i++) {
        out.push(
          await ctx.db.insert("auditLogs", {
            userId: owner.userId, tableName: "cases", documentId: `c${i}`, action: "delete", timestamp: now - (i + 1) * 60_000,
            changes: [
              { field: "userId", oldValue: JSON.stringify(owner.userId) },
              { field: "employerName", oldValue: JSON.stringify(`Employer ${i}`) },
            ],
          }),
        );
      }
      return out;
    });
    const full = await owner.query(api.caseRestore.listRecentlyDeleted, { now });
    expect(full.cases).toHaveLength(RECENTLY_DELETED_MAX);
    expect(full.more).toBe(true);
    expect(full.cases[full.cases.length - 1]!.employerName).toBe(`Employer ${RECENTLY_DELETED_MAX - 1}`);
    await t.run((ctx) => ctx.db.patch(ids[0]!, { restoredAt: now }));
    const after = await owner.query(api.caseRestore.listRecentlyDeleted, { now });
    expect(after.cases).toHaveLength(RECENTLY_DELETED_MAX);
    expect(after.more).toBe(false);
    expect(after.cases[after.cases.length - 1]!.employerName).toBe(`Employer ${RECENTLY_DELETED_MAX}`);
  });

  it("brings the case back as it was, by create's rules, except its documents, recruitment log and FEIN", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const id = await makeCase(t, owner, {
      caseNumber: "",
      eta9089CaseNumber: "G-100-25324-425560",
      isProfessionalOccupation: true,
      pwdFilingDate: "2026-01-05",
      pwdDeterminationDate: "2026-02-10",
      pwdExpirationDate: "2026-06-30",
      pwdWageAmount: 137000,
      pwdWageLevel: "Level IV",
      jobOrderStartDate: "2026-03-01",
      jobOrderEndDate: "2026-03-31",
      sundayAdFirstDate: "2026-03-01",
      sundayAdSecondDate: "2026-03-08",
      noticeOfFilingStartDate: "2026-03-02",
      noticeOfFilingEndDate: "2026-03-16",
      additionalRecruitmentMethods: [
        { method: "employer_website", date: "", description: "", startDate: "2026-03-01", endDate: "2026-03-31" },
        { method: "job_website_ad", date: "", description: "", startDate: "2026-03-02", endDate: "2026-03-30" },
        { method: "local_newspaper", date: "2026-03-05", description: "THE DAILY HERALD" },
      ],
      recruitmentNotes: "Two applicants, neither qualified",
      recruitmentApplicantsCount: 2,
      tags: ["priority"],
      isFavorite: true,
      isPinned: true,
      priorityLevel: "high",
      showOnTimeline: false,
      notes: [{ id: "n1", content: "Call the employer", createdAt: 1, status: "pending" }],
      rfiEntries: [{ id: "r1", receivedDate: "2026-04-01", responseDueDate: "2026-05-01", createdAt: 2 }],
      jobDescription: "Runs the build system.",
      internalCaseNumber: "ACME-7",
    });
    // What only the server or the sweep writes, and what can't come back.
    await t.run(async (ctx) => {
      await ctx.db.patch(id, {
        liveStatus: "Analyst Review",
        liveStatusSeenAt: 123,
        watchEnabled: false,
        employerFein: "enc:secret",
        calendarEventIds: { pwd_expiration: "evt-1", recruitment_window_closes: "evt-2" },
        documents: [{ id: "d1", name: "ad.pdf", url: "https://x", mimeType: "application/pdf", size: 10, uploadedAt: 3 }],
      });
      await ctx.db.insert("recruitmentApplicants", {
        userId: owner.userId, caseId: id, ref: "A1", outcome: "not_qualified", createdAt: 4, updatedAt: 4,
      });
    });
    const before = (await t.run((ctx) => ctx.db.get(id)))!;

    await owner.mutation(api.cases.remove, { id });
    await finishScheduledFunctions(t);
    vi.advanceTimersByTime(5 * DAY);
    const row = await deletionRow(t, id);
    const restoredId = await owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: row._id });
    await finishScheduledFunctions(t);

    const after = (await t.run((ctx) => ctx.db.get(restoredId)))!;
    expect(restoredId).not.toBe(id);
    const strip = (d: Doc<"cases">) => {
      const { _id, _creationTime, updatedAt, documents, employerFein, ...rest } = d;
      void _id; void _creationTime; void updatedAt; void documents; void employerFein;
      return rest;
    };
    expect(strip(after)).toEqual(strip(before));
    expect(after.documents).toEqual([]);
    expect(after.employerFein).toBeUndefined();
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    // The derived dates and the DOL number are create's, worked out again from the dates.
    expect(after.filingWindowOpens).toBe(before.filingWindowOpens);
    expect(after.caseNumber).toBe("G-100-25324-425560");
    // The recruitment log went with the deletion and doesn't come back.
    const applicants = await t.run((ctx) =>
      ctx.db.query("recruitmentApplicants").withIndex("by_caseId", (q) => q.eq("caseId", restoredId)).collect(),
    );
    expect(applicants).toEqual([]);
    // The restore is in the change log as the new case's creation.
    const created = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").withIndex("by_document_id", (q) => q.eq("documentId", restoredId)).collect()).map(
        (r) => r.action,
      ),
    );
    expect(created).toEqual(["create"]);
  });

  it("keeps a closed case closed, with when and why it closed", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const id = await makeCase(t, owner, { pwdFilingDate: "2025-01-05", pwdDeterminationDate: "2025-02-10", pwdExpirationDate: "2025-06-30" });
    // Closed the way the deadline check closes a case: no override flag.
    await t.run((ctx) => ctx.db.patch(id, { caseStatus: "closed", closureReason: "pwd_expired", closedAt: 999 }));
    await owner.mutation(api.cases.remove, { id });
    const restoredId = await owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: (await deletionRow(t, id))._id });
    const after = (await t.run((ctx) => ctx.db.get(restoredId)))!;
    expect(after).toMatchObject({ caseStatus: "closed", closureReason: "pwd_expired", closedAt: 999 });
  });

  it("puts a restored case on the calendar again when its sync is on", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", { ...buildDefaultProfile(owner.userId), googleCalendarConnected: true, calendarSyncEnabled: true }),
    );
    const id = await makeCase(t, owner, { calendarSyncEnabled: false });
    await t.run((ctx) => ctx.db.patch(id, { calendarSyncEnabled: true }));
    await owner.mutation(api.cases.remove, { id });
    const restoredId = await owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: (await deletionRow(t, id))._id });
    const syncs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes("syncCaseCalendarEvents")),
    );
    expect(syncs.map((j) => (j.args[0] as { caseId: string }).caseId)).toEqual([restoredId]);
  });

  it("restores a copy once: it leaves the list and a second try is refused", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const id = await makeCase(t, owner);
    await owner.mutation(api.cases.remove, { id });
    const row = await deletionRow(t, id);
    const restoredId = await owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: row._id });
    expect((await owner.query(api.caseRestore.listRecentlyDeleted, { now: Date.now() })).cases).toEqual([]);
    const marked = await t.run((ctx) => ctx.db.get(row._id));
    expect(marked).toMatchObject({ restoredCaseId: restoredId });
    expect(marked!.restoredAt).toBeTypeOf("number");
    await expect(owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: row._id })).rejects.toThrow(/restored already/);
  });

  it("refuses another account's copy, a row that isn't a case's deletion, and a copy past 30 days", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const stranger = await createAuthenticatedContext(t, "Stranger");
    const id = await makeCase(t, owner);
    const kept = await makeCase(t, owner, { employerName: "Kept Co" });
    await owner.mutation(api.cases.remove, { id });
    const row = await deletionRow(t, id);

    await expect(stranger.mutation(api.caseRestore.restoreDeleted, { auditLogId: row._id })).rejects.toThrow(/isn't in your account/);
    await expect(t.mutation(api.caseRestore.restoreDeleted, { auditLogId: row._id })).rejects.toThrow();
    const createRow = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").withIndex("by_document_id", (q) => q.eq("documentId", kept)).collect())[0]!._id,
    );
    await expect(owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: createRow })).rejects.toThrow(/isn't in your account/);

    vi.setSystemTime(row.timestamp + (DELETED_CASE_DAYS * DAY) + 1);
    await expect(owner.mutation(api.caseRestore.restoreDeleted, { auditLogId: row._id })).rejects.toThrow(/more than 30 days/);
  });
});

/**
 * A case's recruitment record shared with the client by link: only the case's own account makes, reads or turns off
 * its link, the link is stored only as a hash, the public read gives the record and nothing else from the case, a
 * link that's off or unknown gives nothing, and the link goes when its case or the account does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createAuthenticatedContext, createTestContext } from "../../test-utils/convex";
import { purgeAllUserData } from "../lib/deletion";
import { hashShareToken } from "../lib/shareToken";

const caseRow = (userId: Id<"users">) => ({
  userId,
  caseNumber: "G-100-26001-123456",
  internalCaseNumber: "FIRM-REF-PRIVATE",
  employerName: "ACME Robotics",
  employerFein: "12-3456789",
  beneficiaryIdentifier: "BENEFICIARY-PRIVATE",
  positionTitle: "Robotics Engineer",
  caseStatus: "recruitment" as const,
  progressStatus: "working" as const,
  pwdWageAmount: 123456,
  pwdCaseNumber: "P-100-25001-654321",
  jobOrderStartDate: "2026-01-05",
  jobOrderEndDate: "2026-02-04",
  sundayAdFirstDate: "2026-01-11",
  sundayAdSecondDate: "2026-01-18",
  sundayAdNewspaper: "NEWSPAPER-PRIVATE",
  noticeOfFilingStartDate: "2026-01-06",
  noticeOfFilingEndDate: "2026-01-20",
  filingWindowOpens: "2026-03-08",
  filingWindowCloses: "2026-07-04",
  rfiEntries: [],
  rfeEntries: [],
  notes: [{ id: "n1", content: "NOTE-PRIVATE", createdAt: 1, status: "pending" as const }],
  recruitmentNotes: "RECRUITMENT-NOTES-PRIVATE",
  isProfessionalOccupation: true,
  isFavorite: false,
  priorityLevel: "normal" as const,
  tags: ["TAG-PRIVATE"],
  calendarSyncEnabled: false,
  documents: [{ id: "d1", name: "DOCUMENT-PRIVATE.pdf", url: "https://x.test/DOCUMENT-PRIVATE", mimeType: "application/pdf", size: 1, uploadedAt: 1 }],
  recruitmentApplicantsCount: 0,
  additionalRecruitmentMethods: [{ method: "employer_website", date: "", description: "OUTLET-PRIVATE", startDate: "2026-01-07", endDate: "2026-02-06" }],
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

type Made = { ok: true; url: string; createdAt: number } | { ok: false; message: string };

function tokenOf(made: Made): string {
  if (!made.ok) throw new Error(made.message);
  return made.url.split("/").pop()!;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sharing a case's recruitment record", () => {
  it("makes a link once, keeps only its hash, and says the case has one", async () => {
    const { t, owner, caseId } = await setup();
    expect(await owner.query(api.recruitmentShares.forCase, { caseId })).toBeNull();

    const made = await owner.action(api.recruitmentShares.create, { caseId });
    if (!made.ok) throw new Error(made.message);
    expect(made.url).toMatch(/^https:\/\/permtracker\.app\/share\/recruitment\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(made);

    const rows = await t.run((ctx) => ctx.db.query("recruitmentShares").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(await hashShareToken(token));
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);

    const live = await owner.query(api.recruitmentShares.forCase, { caseId });
    expect(live).toEqual({ createdAt: made.createdAt, lastViewedOn: null });
    expect(JSON.stringify(live)).not.toContain(token);
  });

  it("gives anyone with the link the record, and nothing else from the case", async () => {
    const { t, owner, caseId } = await setup();
    await owner.mutation(api.recruitmentApplicants.add, {
      caseId,
      ref: "Applicant 1",
      appliedOn: "2026-01-12",
      source: "sunday_ad_1",
      contactedOn: "2026-01-14",
      contactMethod: "email",
      outcome: "not_qualified",
      reason: "No bachelor's degree, which the job requires.",
    });
    await owner.mutation(api.recruitmentApplicants.add, { caseId, ref: "Applicant 2", outcome: "hired", reason: "HIRED-NOTE-PRIVATE" });
    const token = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));

    // No identity: the client has no account.
    const record = await t.query(api.recruitmentShares.recordByToken, { token });
    expect(record).not.toBeNull();
    expect(record!.employerName).toBe("ACME Robotics");
    expect(record!.positionTitle).toBe("Robotics Engineer");
    expect(record!.filingWindow).toEqual({ opens: "2026-03-08", closes: "2026-07-04" });
    expect(record!.steps.map((s) => s.key)).toEqual(["job_order", "sunday_ad_1", "sunday_ad_2", "notice_of_filing", "employer_website"]);
    expect(record!.applicants).toEqual([
      { ref: "Applicant 1", appliedOn: "2026-01-12", contactedOn: "2026-01-14", contactMethod: "email", outcome: "not_qualified", reason: "No bachelor's degree, which the job requires." },
      { ref: "Applicant 2", appliedOn: null, contactedOn: null, contactMethod: null, outcome: "hired", reason: null },
    ]);
    const text = JSON.stringify(record);
    expect(text).not.toMatch(/PRIVATE|123456|12-3456789|G-100-|P-100-|_id|userId|caseId/);
    expect(Object.keys(record!).sort()).toEqual(["applicants", "employerName", "filingWindow", "positionTitle", "steps"]);
  });

  it("gives nothing for a link that's made up, malformed, off, or whose case or account is gone", async () => {
    const { t, owner, caseId } = await setup();
    const read = (token: string) => t.query(api.recruitmentShares.recordByToken, { token });
    expect(await read("A".repeat(43))).toBeNull();
    expect(await read("short")).toBeNull();
    expect(await read("x".repeat(100_000))).toBeNull();
    expect(await read("A".repeat(42) + "=")).toBeNull();

    const token = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    expect(await read(token)).not.toBeNull();
    expect(await owner.mutation(api.recruitmentShares.turnOff, { caseId })).toEqual({ turnedOff: true });
    expect(await read(token)).toBeNull();
    expect(await owner.query(api.recruitmentShares.forCase, { caseId })).toBeNull();

    const second = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    // A deleted account's links stop at once, before the purge reaches them.
    await t.run((ctx) => ctx.db.patch(owner.userId, { deletedAt: Date.now() }));
    expect(await read(second)).toBeNull();
  });

  it("holds one live link per case: a second waits until the first is off, and the old one is cleared", async () => {
    const { t, owner, caseId } = await setup();
    const first = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    const again = await owner.action(api.recruitmentShares.create, { caseId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/already has a link/);

    await owner.mutation(api.recruitmentShares.turnOff, { caseId });
    expect(await owner.mutation(api.recruitmentShares.turnOff, { caseId })).toEqual({ turnedOff: false });
    const second = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    expect(second).not.toBe(first);
    const rows = await t.run((ctx) => ctx.db.query("recruitmentShares").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(await hashShareToken(second));
  });

  it("never lets another account, or no account, make, read or turn off a case's link", async () => {
    const { t, owner, other, caseId } = await setup();
    const refused = await other.action(api.recruitmentShares.create, { caseId });
    expect(refused.ok).toBe(false);
    const signedOut = await t.action(api.recruitmentShares.create, { caseId });
    expect(signedOut.ok).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("recruitmentShares").collect())).toHaveLength(0);

    const token = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    expect(await other.query(api.recruitmentShares.forCase, { caseId })).toBeNull();
    await expect(other.mutation(api.recruitmentShares.turnOff, { caseId })).rejects.toThrow();
    await expect(t.mutation(api.recruitmentShares.turnOff, { caseId })).rejects.toThrow();
    expect(await t.query(api.recruitmentShares.recordByToken, { token })).not.toBeNull();
  });

  it("notes the Eastern day the link was last opened, once a day, and nothing for a link that's off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 11:30 PM Eastern on Nov 20 is already Nov 21 in UTC.
    vi.setSystemTime(new Date("2026-11-21T04:30:00Z"));
    const { t, owner, caseId } = await setup();
    const token = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    await t.mutation(api.recruitmentShares.recordView, { token });
    expect(await owner.query(api.recruitmentShares.forCase, { caseId })).toMatchObject({ lastViewedOn: "2026-11-20" });

    vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
    await t.mutation(api.recruitmentShares.recordView, { token });
    expect(await owner.query(api.recruitmentShares.forCase, { caseId })).toMatchObject({ lastViewedOn: "2026-11-22" });

    // A made-up link writes nothing and throws nothing.
    await t.mutation(api.recruitmentShares.recordView, { token: "B".repeat(43) });
    await owner.mutation(api.recruitmentShares.turnOff, { caseId });
    vi.setSystemTime(new Date("2026-11-23T15:00:00Z"));
    await t.mutation(api.recruitmentShares.recordView, { token });
    const [row] = await t.run((ctx) => ctx.db.query("recruitmentShares").collect());
    expect(row!.lastViewedOn).toBe("2026-11-22");
  });

  it("goes when its case is deleted, and when the account is", async () => {
    const { t, owner, caseId } = await setup();
    const token = tokenOf(await owner.action(api.recruitmentShares.create, { caseId }));
    await owner.mutation(api.cases.remove, { id: caseId });
    expect(await t.run((ctx) => ctx.db.query("recruitmentShares").collect())).toHaveLength(0);
    expect(await t.query(api.recruitmentShares.recordByToken, { token })).toBeNull();

    const second = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
    await owner.action(api.recruitmentShares.create, { caseId: second });
    await t.run((ctx) => purgeAllUserData(ctx, owner.userId));
    expect(await t.run((ctx) => ctx.db.query("recruitmentShares").collect())).toHaveLength(0);
  });
});

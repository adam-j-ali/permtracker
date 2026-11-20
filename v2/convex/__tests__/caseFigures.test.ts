/**
 * The cases counted in the public figures (convex/caseFigures.ts, through GET /reported-export): only accounts that
 * switched it on in Settings, only their real cases (no sample, deleted or duplicate case), and only dates and the
 * I-140's kind, never a name, employer, job, case number or note.
 *
 * @module
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../test-utils/convex";
import { buildDefaultProfile } from "../lib/userDefaults";

const SECRET = "test-watched-secret-0123456789";

/** The minimal valid case (the cases table's whole shape), with the dates a test sets. */
const caseRow = (userId: Id<"users">, over: Record<string, unknown> = {}) => ({
  userId,
  employerName: "ACME Robotics",
  positionTitle: "Engineer",
  caseNumber: "G-100-26100-111111",
  caseStatus: "i140" as const,
  progressStatus: "working" as const,
  rfiEntries: [],
  rfeEntries: [],
  notes: [],
  isProfessionalOccupation: false,
  isFavorite: false,
  priorityLevel: "normal" as const,
  tags: [],
  calendarSyncEnabled: true,
  documents: [],
  recruitmentApplicantsCount: 0,
  additionalRecruitmentMethods: [],
  createdAt: 1,
  updatedAt: 1795118400000,
  pwdFilingDate: "2025-01-10",
  pwdDeterminationDate: "2025-07-01",
  eta9089FilingDate: "2025-10-01",
  eta9089CertificationDate: "2026-06-15",
  i140FilingDate: "2026-07-01",
  i140Category: "EB-3" as const,
  i140PremiumProcessing: true,
  ...over,
});

describe("cases counted in the public figures", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("hands over an opted-in account's real cases, dates only, and nothing from anyone else", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    const t = createTestContext();
    const [inId, outId] = await t.run(async (ctx) => {
      const a = await ctx.db.insert("users", { email: "in@example.com" });
      const b = await ctx.db.insert("users", { email: "out@example.com" });
      await ctx.db.insert("userProfiles", { ...buildDefaultProfile(a), countCaseDates: true, countCaseDatesAt: 1 });
      await ctx.db.insert("userProfiles", buildDefaultProfile(b));
      const real = await ctx.db.insert("cases", caseRow(a, { notes: [] }));
      await ctx.db.insert("cases", caseRow(a, { isSample: true }));
      await ctx.db.insert("cases", caseRow(a, { deletedAt: 5 }));
      await ctx.db.insert("cases", caseRow(a, { duplicateOf: real }));
      await ctx.db.insert("cases", caseRow(b));
      return [a, b];
    });
    const res = await t.fetch("/reported-export", { headers: { "x-watched-secret": SECRET } });
    const body = (await res.json()) as { cases: Record<string, unknown>[] };
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toMatchObject({ pwdFilingDate: "2025-01-10", eta9089CertificationDate: "2026-06-15", i140Category: "EB-3", i140PremiumProcessing: true });
    const text = JSON.stringify(body.cases);
    for (const never of ["ACME Robotics", "Engineer", "G-100-26100-111111", "in@example.com", String(inId), String(outId), "employerName", "positionTitle", "caseNumber", "userId"]) {
      expect(text).not.toContain(never);
    }
  });

  it("is off until the account switches it on, and the switch turns it off again", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    const t = createTestContext();
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { email: "me@example.com" });
      await ctx.db.insert("userProfiles", buildDefaultProfile(id));
      await ctx.db.insert("cases", caseRow(id));
      return id;
    });
    const me = t.withIdentity({ subject: userId, email: "me@example.com" });
    const count = async () =>
      ((await (await t.fetch("/reported-export", { headers: { "x-watched-secret": SECRET } })).json()) as { cases: unknown[] }).cases.length;
    expect(await count()).toBe(0);
    await me.mutation(api.users.setCountCaseDates, { on: true });
    expect(await count()).toBe(1);
    await me.mutation(api.users.setCountCaseDates, { on: false });
    expect(await count()).toBe(0);
  });
});

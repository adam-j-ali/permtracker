import { describe, expect, it, vi } from "vitest";
import { createTestContext } from "../../test-utils/convex";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { sendOrQueue } from "../lib/email";
import type { Resend } from "resend";

/**
 * What one signed-in account can do to shared resources at will (the Nov 9 2026 security audit): a test email spends
 * the daily allowance case alerts use, and an upload link is a write to file storage whether or not it's saved.
 */

async function verifiedUser(t: ReturnType<typeof createTestContext>, email: string): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("authAccounts", { userId, provider: "password", providerAccountId: email, emailVerified: email });
    return userId;
  });
}

describe("test emails", () => {
  it("stop after three in an hour for one account", async () => {
    vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
    const t = createTestContext();
    // One of the site's own test addresses: nothing is delivered, so only the limit decides.
    const email = "limit-check@permtracker.app";
    const userId = await verifiedUser(t, email);
    const as = t.withIdentity({ subject: userId });
    for (let i = 0; i < 3; i++) {
      await expect(as.action(api.notificationActions.sendTestEmail, { email })).resolves.toEqual({ success: true });
    }
    await expect(as.action(api.notificationActions.sendTestEmail, { email })).rejects.toThrow(/RateLimited|rate limit/i);
    vi.unstubAllEnvs();
  });
});

describe("sendOrQueue with noQueue", () => {
  const ctxAtCeiling = () => ({
    runQuery: vi.fn(async () => 999),
    runMutation: vi.fn(async () => ({ ok: true })),
  });
  const params = { from: "notifications@permtracker.app", to: ["someone@gmail.com"], subject: "s", html: "<p>h</p>" };

  it("refuses at the day's ceiling and keeps no place in the retry queue", async () => {
    const ctx = ctxAtCeiling();
    const out = await sendOrQueue(ctx as never, "notification:sendTestEmail", {} as Resend, params, { noQueue: true });
    expect(out.error?.name).toBe("daily_ceiling");
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("still queues mail that keeps its value, the control", async () => {
    const ctx = ctxAtCeiling();
    const out = await sendOrQueue(ctx as never, "caseAlert:status", {} as Resend, params);
    expect(out).toEqual({ queued: true });
    expect(ctx.runMutation).toHaveBeenCalledWith(internal.emailLedger.enqueueRetry, expect.objectContaining({ quota: true }));
  });
});

describe("document upload links", () => {
  it("stop after twenty at once for one account", async () => {
    const t = createTestContext();
    const userId = await verifiedUser(t, "uploader@example.com");
    const now = Date.now();
    const caseId = await t.run(async (ctx) =>
      ctx.db.insert("cases", {
        userId,
        employerName: "Upload Co",
        positionTitle: "Engineer",
        beneficiaryIdentifier: "Ben",
        caseStatus: "pwd",
        progressStatus: "working",
        rfiEntries: [],
        rfeEntries: [],
        notes: [],
        isProfessionalOccupation: false,
        isFavorite: false,
        priorityLevel: "normal",
        tags: [],
        calendarSyncEnabled: false,
        documents: [],
        recruitmentApplicantsCount: 0,
        additionalRecruitmentMethods: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
    const as = t.withIdentity({ subject: userId });
    const args = { caseId, fileName: "letter.pdf", contentType: "application/pdf", fileSize: 1000 };
    for (let i = 0; i < 20; i++) {
      await expect(as.mutation(api.documents.generateUploadUrl, args)).resolves.toEqual(expect.any(String));
    }
    await expect(as.mutation(api.documents.generateUploadUrl, args)).rejects.toThrow(/RateLimited|rate limit/i);
  });
});

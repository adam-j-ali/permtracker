import { describe, it, expect } from "vitest";
import {
  createTestContext,
  createAuthenticatedContext,
} from "../../test-utils/convex";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Create a verified user + profile in a given re-engagement state.
 * lastActiveDaysAgo / nudgedDaysAgo are relative to now (undefined = unset).
 */
async function makeUser(
  t: ReturnType<typeof createTestContext>,
  name: string,
  opts: {
    emailWeeklyDigest: boolean;
    lastActiveDaysAgo?: number;
    nudgedDaysAgo?: number;
    suppressed?: boolean;
    /** The master email switch in Settings. On unless said. */
    emailOn?: boolean;
    /** Live cases of the account's own. One unless said. */
    liveCases?: number;
  }
) {
  const authT = await createAuthenticatedContext(t, name);
  const userId = await authT.run(
    async (ctx) => (await ctx.auth.getUserIdentity())!.subject as Id<"users">
  );
  const email = `${name.toLowerCase().replace(/\s/g, ".")}@example.com`;
  const now = Date.now();

  const profileId = await authT.run(async (ctx) => {
    await ctx.db.patch(userId, { email });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
      emailVerified: email,
    });
    return await ctx.db.insert("userProfiles", {
      userId,
      userType: "individual",
      emailNotificationsEnabled: opts.emailOn ?? true,
      smsNotificationsEnabled: false,
      pushNotificationsEnabled: false,
      urgentDeadlineDays: 7,
      reminderDaysBefore: [1, 3, 7, 14, 30],
      emailDeadlineReminders: true,
      emailStatusUpdates: false,
      emailRfeAlerts: true,
      emailWeeklyDigest: opts.emailWeeklyDigest,
      quietHoursEnabled: false,
      timezone: "America/New_York",
      calendarSyncEnabled: false,
      calendarSyncPwd: false,
      calendarSyncEta9089: false,
      calendarSyncI140: false,
      calendarSyncRfe: false,
      calendarSyncRfi: false,
      calendarSyncRecruitment: false,
      calendarSyncFilingWindow: false,
      googleCalendarConnected: false,
      gmailConnected: false,
      casesSortBy: "updatedAt",
      casesSortOrder: "desc",
      casesPerPage: 12,
      dismissedDeadlines: [],
      darkModeEnabled: false,
      autoDeadlineEnforcementEnabled: false,
      lastActiveAt:
        opts.lastActiveDaysAgo !== undefined
          ? now - opts.lastActiveDaysAgo * DAY
          : undefined,
      reengagementNudgeSentAt:
        opts.nudgedDaysAgo !== undefined ? now - opts.nudgedDaysAgo * DAY : undefined,
      weeklyDigestSuppressedAt: opts.suppressed ? now : undefined,
      createdAt: now - 300 * DAY, // old account so createdAt fallback is inactive
      updatedAt: now,
    });
  });

  for (let i = 0; i < (opts.liveCases ?? 1); i++) await addCase(t, userId);
  return { userId, authT, profileId, email };
}

/** One case on an account: live unless the overrides say closed, deleted or the sample. */
async function addCase(
  t: ReturnType<typeof createTestContext>,
  userId: Id<"users">,
  overrides: { caseStatus?: "pwd" | "closed"; isSample?: boolean; deletedAt?: number } = {},
) {
  const now = Date.now();
  await t.run(async (ctx) =>
    ctx.db.insert("cases", {
      userId,
      employerName: "ACME Robotics",
      positionTitle: "Engineer",
      caseStatus: "pwd",
      progressStatus: "working",
      rfiEntries: [],
      rfeEntries: [],
      notes: [],
      isProfessionalOccupation: false,
      isFavorite: false,
      priorityLevel: "normal",
      tags: [],
      calendarSyncEnabled: true,
      documents: [],
      recruitmentApplicantsCount: 0,
      additionalRecruitmentMethods: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    }),
  );
}

async function getProfile(authT: Awaited<ReturnType<typeof makeUser>>["authT"], profileId: Id<"userProfiles">) {
  return await authT.run(async (ctx) => ctx.db.get(profileId));
}

describe("runReengagementCheck", () => {
  it("nudges an inactive user with the weekly digest on (first time)", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Inactive Ann", {
      emailWeeklyDigest: true,
      lastActiveDaysAgo: 90,
    });

    const result = await t.action(internal.reengagement.runReengagementCheck, {});

    expect(result.nudged).toBe(1);
    expect(result.suppressed).toBe(0);
    const profile = await getProfile(u.authT, u.profileId);
    expect(profile?.reengagementNudgeSentAt).toBeTypeOf("number");
    // Still on — only nudged, not yet paused.
    expect(profile?.emailWeeklyDigest).toBe(true);
    expect(profile?.weeklyDigestSuppressedAt).toBeUndefined();
  });

  it("pauses the weekly digest when a nudge goes unanswered past the grace period", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Ghost Gary", {
      emailWeeklyDigest: true,
      lastActiveDaysAgo: 90,
      nudgedDaysAgo: 20, // > 14-day grace, and no activity since
    });

    const result = await t.action(internal.reengagement.runReengagementCheck, {});

    expect(result.suppressed).toBe(1);
    expect(result.nudged).toBe(0);
    const profile = await getProfile(u.authT, u.profileId);
    expect(profile?.emailWeeklyDigest).toBe(false);
    expect(profile?.weeklyDigestSuppressedAt).toBeTypeOf("number");
  });

  it("does NOT touch an active user", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Active Amy", {
      emailWeeklyDigest: true,
      lastActiveDaysAgo: 2,
    });

    const result = await t.action(internal.reengagement.runReengagementCheck, {});

    expect(result.nudged).toBe(0);
    expect(result.suppressed).toBe(0);
    const profile = await getProfile(u.authT, u.profileId);
    expect(profile?.reengagementNudgeSentAt).toBeUndefined();
  });

  // The email says "your cases are still being tracked" and warns the weekly summary will
  // pause. It's false for an account with no case of its own, and unwanted by one that
  // switched email off.
  it("doesn't nudge an account that switched email notifications off", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Quiet Quinn", { emailWeeklyDigest: true, lastActiveDaysAgo: 90, emailOn: false });
    const result = await t.action(internal.reengagement.runReengagementCheck, {});
    expect(result.nudged).toBe(0);
    expect((await getProfile(u.authT, u.profileId))?.reengagementNudgeSentAt).toBeUndefined();
  });

  it("doesn't nudge an account with no live case of its own: none, the sample, a closed one, a deleted one", async () => {
    const t = createTestContext();
    const none = await makeUser(t, "Empty Eve", { emailWeeklyDigest: true, lastActiveDaysAgo: 90, liveCases: 0 });
    const others = await makeUser(t, "Sample Sam", { emailWeeklyDigest: true, lastActiveDaysAgo: 90, liveCases: 0 });
    await addCase(t, others.userId, { isSample: true });
    await addCase(t, others.userId, { caseStatus: "closed" });
    await addCase(t, others.userId, { deletedAt: Date.now() });
    const result = await t.action(internal.reengagement.runReengagementCheck, {});
    expect(result.nudged).toBe(0);
    for (const u of [none, others]) {
      expect((await getProfile(u.authT, u.profileId))?.reengagementNudgeSentAt).toBeUndefined();
    }
  });

  it("tells the email how many live cases the account has", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Busy Bea", { emailWeeklyDigest: true, lastActiveDaysAgo: 90, liveCases: 2 });
    await addCase(t, u.userId, { caseStatus: "closed" });
    await addCase(t, u.userId, { isSample: true });
    await t.action(internal.reengagement.runReengagementCheck, {});
    const sends = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes("sendReengagementNudge")),
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]!.args).toEqual([{ to: u.email, userName: "Busy Bea", activeCaseCount: 2 }]);
  });

  it("ignores users who don't have the weekly digest on", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Optout Otto", {
      emailWeeklyDigest: false,
      lastActiveDaysAgo: 90,
    });

    const result = await t.action(internal.reengagement.runReengagementCheck, {});

    expect(result.nudged).toBe(0);
    const profile = await getProfile(u.authT, u.profileId);
    expect(profile?.reengagementNudgeSentAt).toBeUndefined();
  });

  it("does not pause again if already suppressed", async () => {
    const t = createTestContext();
    await makeUser(t, "Already Al", {
      emailWeeklyDigest: false, // already paused → not a candidate
      lastActiveDaysAgo: 90,
      nudgedDaysAgo: 30,
      suppressed: true,
    });

    const result = await t.action(internal.reengagement.runReengagementCheck, {});

    expect(result.nudged).toBe(0);
    expect(result.suppressed).toBe(0);
  });
});

describe("reengagement state mutations + loop-closers", () => {
  it("reactivateWeeklyDigest re-enables the digest and clears both markers", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Paused Pam", {
      emailWeeklyDigest: false,
      nudgedDaysAgo: 30,
      suppressed: true,
    });
    await u.authT.mutation(api.reengagement.reactivateWeeklyDigest, {});
    const p = await getProfile(u.authT, u.profileId);
    expect(p?.emailWeeklyDigest).toBe(true);
    expect(p?.weeklyDigestSuppressedAt).toBeUndefined();
    expect(p?.reengagementNudgeSentAt).toBeUndefined();
  });

  it("dismissReengagementBanner clears the pause marker but leaves the digest OFF", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Dismiss Dan", {
      emailWeeklyDigest: false,
      suppressed: true,
    });
    await u.authT.mutation(api.reengagement.dismissReengagementBanner, {});
    const p = await getProfile(u.authT, u.profileId);
    expect(p?.weeklyDigestSuppressedAt).toBeUndefined();
    expect(p?.emailWeeklyDigest).toBe(false); // stays off — they chose to keep it off
  });

  it("getReengagementBannerState mirrors the paused marker", async () => {
    const t = createTestContext();
    const paused = await makeUser(t, "Banner Bob", { emailWeeklyDigest: false, suppressed: true });
    expect(
      (await paused.authT.query(api.reengagement.getReengagementBannerState, {})).weeklyDigestPaused
    ).toBe(true);
    const active = await makeUser(t, "Active Ada", { emailWeeklyDigest: true, lastActiveDaysAgo: 1 });
    expect(
      (await active.authT.query(api.reengagement.getReengagementBannerState, {})).weeklyDigestPaused
    ).toBe(false);
  });

  it("unsubscribeWeeklyByEmail turns the digest off + clears the auto-pause marker, idempotently (fix A)", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Unsub Uma", {
      emailWeeklyDigest: false, // already auto-paused, then they deliberately unsubscribe
      suppressed: true,
    });
    const res = await t.mutation(internal.notifications.unsubscribeWeeklyByEmail, { email: u.email });
    expect(res.ok).toBe(true);
    const p = await getProfile(u.authT, u.profileId);
    expect(p?.emailWeeklyDigest).toBe(false);
    expect(p?.weeklyDigestSuppressedAt).toBeUndefined(); // banner won't re-prompt/re-subscribe
    // idempotent + unknown-email no-op
    expect(
      (await t.mutation(internal.notifications.unsubscribeWeeklyByEmail, { email: u.email })).ok
    ).toBe(true);
    expect(
      (await t.mutation(internal.notifications.unsubscribeWeeklyByEmail, { email: "nobody@nowhere.test" })).ok
    ).toBe(false);
  });

  it("re-enabling the digest from Settings clears BOTH re-engagement markers (fix B)", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Settings Sue", {
      emailWeeklyDigest: false,
      nudgedDaysAgo: 30,
      suppressed: true,
    });
    await u.authT.mutation(api.users.updateUserProfile, { emailWeeklyDigest: true });
    const p = await getProfile(u.authT, u.profileId);
    expect(p?.emailWeeklyDigest).toBe(true);
    expect(p?.weeklyDigestSuppressedAt).toBeUndefined();
    expect(p?.reengagementNudgeSentAt).toBeUndefined();
  });

  it("recordMyLogin resets the nudge marker so the cycle can restart", async () => {
    const t = createTestContext();
    const u = await makeUser(t, "Login Lou", {
      emailWeeklyDigest: true,
      lastActiveDaysAgo: 90,
      nudgedDaysAgo: 5,
    });
    await u.authT.mutation(api.users.recordMyLogin, {});
    const p = await getProfile(u.authT, u.profileId);
    expect(p?.reengagementNudgeSentAt).toBeUndefined();
  });
});

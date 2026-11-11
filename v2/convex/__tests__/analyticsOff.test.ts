import { describe, it, expect } from "vitest";
import {
  createTestContext,
  createAuthenticatedContext,
  setupSchedulerTests,
  finishScheduledFunctions,
} from "../../test-utils/convex";
import { api } from "../_generated/api";

// Usage analytics switched off in Settings: saved on the account, read by the
// same check that silences staff browsers (users.isPostHogExcluded).

describe("usage analytics switch", () => {
  setupSchedulerTests();

  it("an account starts with analytics on", async () => {
    const t = createTestContext();
    const authT = await createAuthenticatedContext(t, "Test User");
    await authT.mutation(api.users.ensureUserProfile, {});
    await finishScheduledFunctions(t);
    expect(await authT.query(api.users.isPostHogExcluded, {})).toBe(false);
  });

  it("switching off is saved and excludes the account; switching on reverses it", async () => {
    const t = createTestContext();
    const authT = await createAuthenticatedContext(t, "Test User");
    await authT.mutation(api.users.ensureUserProfile, {});
    await finishScheduledFunctions(t);

    await authT.mutation(api.users.setAnalyticsOff, { off: true });
    expect((await authT.query(api.users.currentUserProfile, {}))?.analyticsOff).toBe(true);
    expect(await authT.query(api.users.isPostHogExcluded, {})).toBe(true);

    await authT.mutation(api.users.setAnalyticsOff, { off: false });
    expect(await authT.query(api.users.isPostHogExcluded, {})).toBe(false);
  });

  it("works for an account whose profile doesn't exist yet", async () => {
    const t = createTestContext();
    const authT = await createAuthenticatedContext(t, "Test User");
    await authT.mutation(api.users.setAnalyticsOff, { off: true });
    await finishScheduledFunctions(t);
    expect(await authT.query(api.users.isPostHogExcluded, {})).toBe(true);
  });

  it("one account's choice doesn't reach another", async () => {
    const t = createTestContext();
    const a = await createAuthenticatedContext(t, "User A");
    const b = await createAuthenticatedContext(t, "User B");
    await a.mutation(api.users.setAnalyticsOff, { off: true });
    await finishScheduledFunctions(t);
    expect(await b.query(api.users.isPostHogExcluded, {})).toBe(false);
  });

  it("a signed-out caller can't change it", async () => {
    const t = createTestContext();
    await expect(t.mutation(api.users.setAnalyticsOff, { off: true })).rejects.toThrow();
  });
});

// The one event the server files by itself, at an account's first verified sign-in. The
// Privacy Policy says the switch follows the account and that a browser's privacy signal
// switches analytics off; the browser's own events obey both, and so must this one.
describe("the server's own sign-up event", () => {
  setupSchedulerTests();

  type T = ReturnType<typeof createTestContext>;
  const signUpEvents = (t: T) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes("captureServerEvent")),
    );

  it("is sent once for an account with analytics on", async () => {
    const t = createTestContext();
    const authT = await createAuthenticatedContext(t, "Test User");
    await authT.mutation(api.users.ensureUserProfile, {});
    await finishScheduledFunctions(t);
    await authT.mutation(api.users.recordMyLogin, {});
    await authT.mutation(api.users.recordMyLogin, { analyticsOff: false });
    expect(await signUpEvents(t)).toHaveLength(1);
  });

  it("isn't sent for an account that switched analytics off", async () => {
    const t = createTestContext();
    const authT = await createAuthenticatedContext(t, "Test User");
    await authT.mutation(api.users.setAnalyticsOff, { off: true });
    await finishScheduledFunctions(t);
    await authT.mutation(api.users.recordMyLogin, {});
    expect(await signUpEvents(t)).toEqual([]);
  });

  it("isn't sent when the browser says analytics is off there: its own switch, or its privacy signal", async () => {
    const t = createTestContext();
    const authT = await createAuthenticatedContext(t, "Test User");
    await authT.mutation(api.users.ensureUserProfile, {});
    await finishScheduledFunctions(t);
    await authT.mutation(api.users.recordMyLogin, { analyticsOff: true });
    expect(await signUpEvents(t)).toEqual([]);
    // And a later sign-in from another browser doesn't send it late: the account is past its first.
    await authT.mutation(api.users.recordMyLogin, {});
    expect(await signUpEvents(t)).toEqual([]);
  });
});

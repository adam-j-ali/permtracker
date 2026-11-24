import { describe, it, expect } from "vitest";
import {
  createTestContext,
  createAuthenticatedContext,
  setupSchedulerTests,
} from "../../test-utils/convex";
import { internal } from "../_generated/api";
import { isTransientDbError } from "../lib/errorRecording";

// ADMIN_EMAIL is read from process.env at module load time.
// Set it before importing admin.ts so requireAdmin() passes in tests.
const TEST_ADMIN_EMAIL = "admin@test.com";
process.env.ADMIN_EMAIL = TEST_ADMIN_EMAIL;

describe("systemErrors", () => {
  setupSchedulerTests();

  describe("record", () => {
    it("inserts error into systemErrors table", async () => {
      const t = createTestContext();

      await t.run(async (ctx) => {
        await ctx.db.insert("systemErrors", {
          source: "mutation",
          operation: "cases.create",
          message: "Test error",
          resolved: false,
          createdAt: Date.now(),
        });

        const errors = await ctx.db.query("systemErrors").collect();
        expect(errors).toHaveLength(1);
        expect(errors[0].source).toBe("mutation");
        expect(errors[0].operation).toBe("cases.create");
        expect(errors[0].message).toBe("Test error");
        expect(errors[0].resolved).toBe(false);
      });
    });

    it("stores optional fields (stack, userId, resourceId, extra)", async () => {
      const t = createTestContext();
      const { userId } = await createAuthenticatedContext(t, "Test User");

      await t.run(async (ctx) => {
        await ctx.db.insert("systemErrors", {
          source: "action",
          operation: "push.send",
          message: "Push failed",
          stack: "Error: Push failed\n    at send (push.ts:42)",
          userId,
          resourceId: "case_abc123",
          extra: '{"retryCount":3}',
          resolved: false,
          createdAt: Date.now(),
        });

        const errors = await ctx.db.query("systemErrors").collect();
        expect(errors).toHaveLength(1);
        expect(errors[0].stack).toContain("push.ts:42");
        expect(errors[0].userId).toBe(userId);
        expect(errors[0].resourceId).toBe("case_abc123");
        expect(errors[0].extra).toBe('{"retryCount":3}');
      });
    });

    it("records without optional fields", async () => {
      const t = createTestContext();

      await t.run(async (ctx) => {
        const id = await ctx.db.insert("systemErrors", {
          source: "cron",
          operation: "dailyCleanup",
          message: "Cleanup failed",
          resolved: false,
          createdAt: Date.now(),
        });

        const error = await ctx.db.get(id);
        expect(error).toBeDefined();
        expect(error!.stack).toBeUndefined();
        expect(error!.userId).toBeUndefined();
        expect(error!.resourceId).toBeUndefined();
        expect(error!.extra).toBeUndefined();
      });
    });
  });

  describe("rate limiting", () => {
    it("records errors even when rate limit exceeded", async () => {
      const t = createTestContext();

      // Insert 10 unresolved errors to exceed the 5-per-hour rate limit
      await t.run(async (ctx) => {
        for (let i = 0; i < 10; i++) {
          await ctx.db.insert("systemErrors", {
            source: "mutation",
            operation: `op-${i}`,
            message: `Error ${i}`,
            resolved: false,
            createdAt: Date.now(),
          });
        }

        const errors = await ctx.db.query("systemErrors").collect();
        expect(errors).toHaveLength(10);
      });
    });
  });
});

/*
 * Where an error goes is the routing list's (scripts/data/alert_routes.json): an operation's first failure in the
 * hour waits for the morning report (errors.once), a database timeout or busy answer alone stays on the admin page
 * (errors.blip; Nov 2026: a server blip mailed "[System Error]" for something the next run never saw), and the same
 * operation failing again within the hour is emailed and pushed to the phone (errors.repeat), once a day each.
 */
describe("systemErrors.record: where each error goes", () => {
  setupSchedulerTests();

  /** The phone push this module schedules beside a repeat's email. */
  const PUSH = /systemErrors[^]*push$/;
  async function scheduled(t: ReturnType<typeof createTestContext>, name: string | RegExp) {
    return t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      return jobs.filter((j) => (typeof name === "string" ? j.name.includes(name) : name.test(j.name)));
    });
  }
  const routes = (t: ReturnType<typeof createTestContext>) =>
    t.run(async (ctx) => (await ctx.db.query("systemErrors").collect()).map((e) => e.route));
  const boom = { source: "cron" as const, operation: "x.y", message: "boom" };

  it("keeps an operation's first failure for the morning report: recorded, never emailed", async () => {
    // Arrange
    const t = createTestContext();
    // Act
    await t.mutation(internal.systemErrors.record, boom);
    // Assert
    expect(await scheduled(t, "sendAdminNotificationEmail")).toHaveLength(0);
    expect(await routes(t)).toEqual(["errors.once"]);
  });

  it("emails and pushes the same operation's second failure within the hour, saying when in Eastern time", async () => {
    // Arrange
    const t = createTestContext();
    // Act
    await t.mutation(internal.systemErrors.record, boom);
    await t.mutation(internal.systemErrors.record, boom);
    // Assert
    const mails = await scheduled(t, "sendAdminNotificationEmail");
    expect(mails).toHaveLength(1);
    const args = mails[0]?.args[0] as { body?: string; route?: string };
    expect(args.route).toBe("errors.repeat");
    expect(String(args.body)).toMatch(/^At: \w+ \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M ET$/m);
    expect(String(args.body)).toMatch(/failed again within the hour/);
    const pushes = await scheduled(t, PUSH);
    expect(pushes).toHaveLength(1);
    expect((pushes[0]?.args[0] as { level?: string }).level).toBe("high");
    expect(await routes(t)).toEqual(["errors.once", "errors.repeat"]);
  });

  it("tells each operation's repeats once a day, however often it fails", async () => {
    const t = createTestContext();
    for (let i = 0; i < 4; i++) await t.mutation(internal.systemErrors.record, boom);
    expect(await scheduled(t, "sendAdminNotificationEmail")).toHaveLength(1);
    expect(await scheduled(t, PUSH)).toHaveLength(1);
  });

  it("holds a single transient database error, and mails the same operation's second within the hour", async () => {
    // Arrange
    const t = createTestContext();
    const blip = { source: "cron" as const, operation: "pwdSweep.run", message: "libsql HTTP 502 Bad Gateway" };
    // Act
    await t.mutation(internal.systemErrors.record, blip);
    const afterOne = await scheduled(t, "sendAdminNotificationEmail");
    await t.mutation(internal.systemErrors.record, { ...blip, operation: "caseSweep.run" });
    const afterOther = await scheduled(t, "sendAdminNotificationEmail");
    await t.mutation(internal.systemErrors.record, blip);
    // Assert
    expect(afterOne, "one transient error is recorded, not mailed").toHaveLength(0);
    expect(afterOther, "another operation's is its own first").toHaveLength(0);
    expect(await scheduled(t, "sendAdminNotificationEmail")).toHaveLength(1);
    expect(await routes(t)).toEqual(["errors.blip", "errors.blip", "errors.repeat"]);
  });

  it("knows a transient database error from the rest", () => {
    for (const m of [
      "libsql HTTP 502 Bad Gateway",
      "libsql HTTP 503 Service Unavailable",
      "SERVER_ERROR: Server returned HTTP status 504",
      "turso query deadline (90000ms, attempt 2): SELECT 1",
      "The operation was aborted due to timeout",
      "TimeoutError: signal timed out",
      "connect ETIMEDOUT 1.2.3.4:443",
    ]) {
      expect(isTransientDbError(m), m).toBe(true);
    }
    for (const m of ["libsql HTTP 400 Bad Request", "libsql error: no such column: x", "boom", "Resend 422"]) {
      expect(isTransientDbError(m), m).toBe(false);
    }
  });

  it("records but neither emails nor pushes when ADMIN_ERROR_EMAILS is off (a non-live deployment)", async () => {
    process.env.ADMIN_ERROR_EMAILS = "off";
    try {
      const t = createTestContext();
      await t.mutation(internal.systemErrors.record, boom);
      await t.mutation(internal.systemErrors.record, boom);
      expect(await scheduled(t, "sendAdminNotificationEmail")).toHaveLength(0);
      expect(await scheduled(t, PUSH)).toHaveLength(0);
      expect(await t.run((ctx) => ctx.db.query("systemErrors").collect())).toHaveLength(2);
    } finally {
      delete process.env.ADMIN_ERROR_EMAILS;
    }
  });
});

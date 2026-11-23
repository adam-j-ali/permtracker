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

describe("systemErrors.record admin email", () => {
  setupSchedulerTests();

  async function scheduledEmails(t: ReturnType<typeof createTestContext>) {
    return t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      return jobs.filter((j) => j.name.includes("sendAdminNotificationEmail"));
    });
  }

  it("emails the admin by default", async () => {
    const t = createTestContext();
    await t.mutation(internal.systemErrors.record, { source: "cron", operation: "x.y", message: "boom" });
    expect(await scheduledEmails(t)).toHaveLength(1);
  });

  it("says when it happened, in Eastern time", async () => {
    const t = createTestContext();
    await t.mutation(internal.systemErrors.record, { source: "cron", operation: "x.y", message: "boom" });
    const [job] = await scheduledEmails(t);
    expect(String((job?.args[0] as { body?: string })?.body)).toMatch(/^At: \w+ \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M ET$/m);
  });

  /*
   * Nov 2026: a database blip on the server mailed "[System Error]" for something the next run never saw. A
   * transient database error (libsql answering 5xx, a timeout) mails only when the same operation fails twice
   * within an hour; it's always recorded.
   */
  it("holds a single transient database error, and mails the same operation's second within the hour", async () => {
    // Arrange
    const t = createTestContext();
    const blip = { source: "cron" as const, operation: "pwdSweep.run", message: "libsql HTTP 502 Bad Gateway" };
    // Act
    await t.mutation(internal.systemErrors.record, blip);
    const afterOne = await scheduledEmails(t);
    await t.mutation(internal.systemErrors.record, { ...blip, operation: "caseSweep.run" });
    const afterOther = await scheduledEmails(t);
    await t.mutation(internal.systemErrors.record, blip);
    // Assert
    expect(afterOne, "one transient error is recorded, not mailed").toHaveLength(0);
    expect(afterOther, "another operation's is its own first").toHaveLength(0);
    const mails = await scheduledEmails(t);
    expect(mails).toHaveLength(1);
    expect(String((mails[0]?.args[0] as { body?: string })?.body)).toMatch(/second time within an hour/);
    expect(await t.run((ctx) => ctx.db.query("systemErrors").collect())).toHaveLength(3);
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

  it("records but does not email when ADMIN_ERROR_EMAILS is off (a non-live deployment)", async () => {
    process.env.ADMIN_ERROR_EMAILS = "off";
    try {
      const t = createTestContext();
      await t.mutation(internal.systemErrors.record, { source: "cron", operation: "x.y", message: "boom" });
      expect(await scheduledEmails(t)).toHaveLength(0);
      const rows = await t.run((ctx) => ctx.db.query("systemErrors").collect());
      expect(rows).toHaveLength(1);
    } finally {
      delete process.env.ADMIN_ERROR_EMAILS;
    }
  });
});

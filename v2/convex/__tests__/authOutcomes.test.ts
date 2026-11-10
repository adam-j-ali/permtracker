/**
 * The password-reset counts behind the morning report's line: one row per Eastern day per kind, read over a week,
 * pruned with the alert outbox, and fed by the live password provider. The verdict and the wrapper are tested pure
 * in convex/lib/__tests__/resetOutcomes.test.ts.
 */
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { internal } from "../_generated/api";
import { passwordProvider } from "../auth";
import { noteResetOutcome, readResetCounts } from "../lib/authOutcomes";
import { MS_PER_DAY, easternDay } from "../lib/time";

describe("the password-reset counts", () => {
  it("keeps one row per day per kind, however many are counted", async () => {
    const t = createTestContext();
    for (const kind of ["resetSent", "resetSent", "resetSent", "resetCompleted", "resetFailed", "resetFailed"] as const) {
      await t.mutation(internal.authOutcomes.note, { kind });
    }
    const rows = await t.run((ctx) => ctx.db.query("authOutcomes").collect());
    expect(rows.map((r) => [r.day, r.kind, r.count]).sort()).toEqual([
      [easternDay(Date.now()), "resetCompleted", 1],
      [easternDay(Date.now()), "resetFailed", 2],
      [easternDay(Date.now()), "resetSent", 3],
    ]);
    expect(await t.run((ctx) => readResetCounts(ctx))).toEqual({ days: 7, sent: 3, completed: 1, failed: 2 });
  });

  it("reads the last seven Eastern days and nothing older", async () => {
    const t = createTestContext();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("authOutcomes", { day: easternDay(now - 6 * MS_PER_DAY), kind: "resetSent", count: 4 });
      await ctx.db.insert("authOutcomes", { day: easternDay(now - 7 * MS_PER_DAY), kind: "resetSent", count: 100 });
      await ctx.db.insert("authOutcomes", { day: easternDay(now - 7 * MS_PER_DAY), kind: "resetCompleted", count: 100 });
      await ctx.db.insert("authOutcomes", { day: easternDay(now), kind: "resetCompleted", count: 2 });
    });
    expect(await t.run((ctx) => readResetCounts(ctx, now))).toEqual({ days: 7, sent: 4, completed: 2, failed: 0 });
  });

  it("is forgotten after a month, by the outbox's daily prune", async () => {
    const t = createTestContext();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("authOutcomes", { day: easternDay(now - 45 * MS_PER_DAY), kind: "resetSent", count: 9 });
      await ctx.db.insert("authOutcomes", { day: easternDay(now - 2 * MS_PER_DAY), kind: "resetSent", count: 1 });
    });
    await t.mutation(internal.alertOutbox.prune, {});
    const left = await t.run((ctx) => ctx.db.query("authOutcomes").collect());
    expect(left.map((r) => r.count)).toEqual([1]);
  });

  it("reaches the morning report's facts as counts", async () => {
    const t = createTestContext();
    await t.mutation(internal.authOutcomes.note, { kind: "resetSent" });
    await t.mutation(internal.authOutcomes.note, { kind: "resetCompleted" });
    const f = await t.query(internal.dailyReport.facts, {});
    expect(f.resets).toEqual({ days: 7, sent: 1, completed: 1, failed: 0 });
  });

  it("is best effort from an action: a failed count is logged and nothing is thrown", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      noteResetOutcome({ runMutation: async () => Promise.reject(new Error("write refused")) }, "resetSent"),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    await expect(noteResetOutcome(undefined, "resetSent")).resolves.toBeUndefined();
    await expect(noteResetOutcome({}, "resetSent")).resolves.toBeUndefined();
    logged.mockRestore();
  });

  it("is fed by the live password provider: a reset the library refuses is counted, and still refused", async () => {
    const t = createTestContext();
    // Every call the library makes fails here except the count, as a reset for an address with no account does.
    const ctx = {
      runMutation: (ref: unknown, args: Record<string, unknown>) => {
        if (getFunctionName(ref as typeof internal.authOutcomes.note) === "authOutcomes:note") {
          return t.mutation(internal.authOutcomes.note, args as { kind: "resetFailed" });
        }
        return Promise.reject(new Error("no such account"));
      },
      runQuery: () => Promise.reject(new Error("no such account")),
      runAction: () => Promise.reject(new Error("no such account")),
    } as unknown as Parameters<NonNullable<typeof passwordProvider.authorize>>[1];
    // The authorize convexAuth() runs: `options` merged over the provider, as provider_utils.js does.
    const live = { ...passwordProvider, ...passwordProvider.options };
    await expect(
      live.authorize({ flow: "reset-verification", email: "nobody@example.com", code: "ABCDEF123456", newPassword: "a-Long-enough-pass1" }, ctx),
    ).rejects.toThrow();
    expect(await t.run((c) => readResetCounts(c))).toEqual({ days: 7, sent: 0, completed: 0, failed: 1 });
  });
});

/**
 * Typed receipt numbers for the sample (convex/uscisTyped.ts), through the routes a page and the kit touch: the shape
 * check, a repeat that only moves the last-typed time, the per-address limit, the day's global budget charged before
 * the write, the kit's pull behind its secret, and the 12-month cleanup.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackedTestContext as createTestContext } from "../../test-utils/convexSettle";
import { internal } from "../_generated/api";
import { easternDay } from "../lib/time";
import { TYPED_DAILY_MAX, TYPED_KEEP_MS, TYPED_PER_ADDRESS_HOUR } from "../uscisTyped";

const CHECKER = "checker-secret-0123456789abcdef";

beforeEach(() => {
  vi.stubEnv("WATCHED_CASES_SECRET", CHECKER);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type T = ReturnType<typeof createTestContext>;
const send = (t: T, body: unknown, ip = "203.0.113.7") =>
  t.fetch("/uscis-typed", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const rowsOf = (t: T) => t.run(async (ctx) => await ctx.db.query("uscisTypedReceipts").collect());
const pull = (t: T, after = 0, secret = CHECKER) =>
  t.fetch(`/uscis-typed?after=${after}&limit=500`, { headers: { Authorization: `Bearer ${secret}` } });

describe("typed receipt numbers", () => {
  it("keeps a real receipt number once, and a repeat only moves its last-typed time", async () => {
    const t = createTestContext();
    expect((await send(t, { receipt: "ioe0000000045" })).status).toBe(200);
    expect((await send(t, { receipt: "IOE0000000045" })).status).toBe(200);
    const rows = await rowsOf(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ receipt: "IOE0000000045", times: 2 });
  });

  it("refuses what isn't a receipt number, and keeps nothing", async () => {
    const t = createTestContext();
    for (const body of [{ receipt: "IOE000000004" }, { receipt: 12 }, {}, "not json", "x".repeat(300)]) {
      expect((await send(t, body)).status, JSON.stringify(body).slice(0, 30)).toBeGreaterThanOrEqual(400);
    }
    expect(await rowsOf(t)).toHaveLength(0);
  });

  it("refuses an address past its hourly limit, with no trace", async () => {
    const t = createTestContext();
    for (let i = 0; i < TYPED_PER_ADDRESS_HOUR; i++) {
      expect((await send(t, { receipt: `IOE00000000${String(i).padStart(2, "0")}` })).status).toBe(200);
    }
    expect((await send(t, { receipt: "IOE0000000099" })).status).toBe(429);
    expect((await send(t, { receipt: "IOE0000000099" }, "198.51.100.9")).status).toBe(200);
    expect(await rowsOf(t)).toHaveLength(TYPED_PER_ADDRESS_HOUR + 1);
  });

  it("refuses a new number once the day's budget is spent, and still moves a held one", async () => {
    const t = createTestContext();
    await send(t, { receipt: "IOE0000000001" });
    await t.run(async (ctx) => {
      const d = await ctx.db.query("uscisTypedDays").withIndex("by_day", (q) => q.eq("day", easternDay(Date.now()))).unique();
      await ctx.db.patch(d!._id, { n: TYPED_DAILY_MAX });
    });
    expect((await send(t, { receipt: "IOE0000000002" })).status).toBe(429);
    expect((await send(t, { receipt: "IOE0000000001" })).status).toBe(200);
    expect((await rowsOf(t)).map((r) => r.receipt)).toEqual(["IOE0000000001"]);
  });

  it("gives the kit new numbers oldest first, from its cursor, behind its secret", async () => {
    const t = createTestContext();
    expect((await pull(t, 0, "wrong")).status).toBe(401);
    await send(t, { receipt: "IOE0000000001" });
    await new Promise((r) => setTimeout(r, 5));
    await send(t, { receipt: "IOE0000000002" });
    const first = (await (await pull(t)).json()) as { receipts: string[]; next: number };
    expect(first.receipts).toEqual(["IOE0000000001", "IOE0000000002"]);
    const again = (await (await pull(t, first.next)).json()) as { receipts: string[] };
    expect(again.receipts).toEqual([]);
  });

  it("forgets a number 12 months after it was last typed", async () => {
    const t = createTestContext();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("uscisTypedReceipts", { receipt: "IOE0000000001", firstAt: now - TYPED_KEEP_MS - 5, lastAt: now - TYPED_KEEP_MS - 5, times: 1 });
      await ctx.db.insert("uscisTypedReceipts", { receipt: "IOE0000000002", firstAt: now - TYPED_KEEP_MS - 5, lastAt: now, times: 3 });
    });
    const got = await t.mutation(internal.uscisTyped.pruneTyped, {});
    expect(got.gone).toBe(1);
    expect((await rowsOf(t)).map((r) => r.receipt)).toEqual(["IOE0000000002"]);
  });
});

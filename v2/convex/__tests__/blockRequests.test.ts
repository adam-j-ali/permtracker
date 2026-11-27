/**
 * "Ask us to check this block": one vote per connection per block a day, a few blocks per connection a day, the
 * checker's pull and its line behind its secret, where a block stands (its place, its time, paused when the checker's
 * line is old), and a walked block closing its request.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleScheduled, trackedTestContext as createTestContext } from "../../test-utils/convexSettle";
import { internal } from "../_generated/api";
import { BLOCKS_PER_IP_PER_DAY, LINE_STALE_MS, standingFor } from "../blockRequests";
import { parseBlockQueue } from "../lib/blockQueue";

const SERVER = "test-server-secret";
const NOW = 1_795_800_000_000;

type T = ReturnType<typeof createTestContext>;

beforeEach(() => {
  vi.stubEnv("WATCHED_CASES_SECRET", SERVER);
});
afterEach(async () => {
  await settleScheduled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ask = (t: T, block: string, ip = "203.0.113.7") => t.mutation(internal.blockRequests.vote, { block, ip });

async function line(t: T, body: unknown, secret: string | null = SERVER) {
  return await t.fetch("/block-queue-state", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
}

const item = (block: string, position: number, handed = 0, votes = 0, status: "walking" | "waiting" = "waiting") => ({
  block,
  position,
  status,
  handed,
  votes,
});

describe("voting for a block", () => {
  it("counts one vote per connection per block a day, and another connection's vote", async () => {
    const t = createTestContext();
    expect((await ask(t, "IOE09360")).votes).toBe(1);
    const again = await ask(t, "IOE09360");
    expect(again.ok && again.already).toBe(true);
    expect(again.votes).toBe(1);
    expect((await ask(t, "IOE09360", "198.51.100.4")).votes).toBe(2);
  });

  it("stops one connection after a day's worth of blocks, without counting the refused vote", async () => {
    const t = createTestContext();
    for (let i = 0; i < BLOCKS_PER_IP_PER_DAY; i++) expect((await ask(t, `IOE0930${i}`)).ok).toBe(true);
    const over = await ask(t, "IOE09350");
    expect(over.ok).toBe(false);
    expect(over.throttled).toBe(true);
    const row = await t.run((ctx) => ctx.db.query("blockRequests").withIndex("by_block", (q) => q.eq("block", "IOE09350")).unique());
    expect(row).toBeNull();
  });

  it("refuses what isn't a block, at the route and below it", async () => {
    const t = createTestContext();
    expect((await ask(t, "IOE9360")).ok).toBe(false);
    const res = await t.fetch("/block-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block: "LIN12" }) });
    expect(res.status).toBe(400);
    const get = await t.fetch("/block-queue?block=nope");
    expect(get.status).toBe(400);
    const ok = await t.fetch("/block-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block: "ioe09361" }) });
    expect(ok.status).toBe(200);
  });
});

describe("the checker's side", () => {
  it("keeps the pull and the line behind the checker's secret", async () => {
    const t = createTestContext();
    expect((await t.fetch("/block-requests")).status).toBe(401);
    expect((await line(t, { at: NOW, running: true, items: [], walked: [] }, null)).status).toBe(401);
    await ask(t, "IOE09360");
    const pulled = await t.fetch("/block-requests", { headers: { Authorization: `Bearer ${SERVER}` } });
    const body = (await pulled.json()) as { requests: { block: string; votes: number }[] };
    expect(body.requests.map((r) => [r.block, r.votes])).toEqual([["IOE09360", 1]]);
    expect((await line(t, { at: NOW, running: "yes", items: [], walked: [] })).status).toBe(400);
  });

  it("says where a block stands from the checker's line, and closes it once walked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = createTestContext();
    await ask(t, "IOE09361");
    const ok = await line(t, {
      at: NOW,
      running: true,
      perMinute: 2000,
      items: [item("IOE09360", 1, 60_000, 0, "walking"), item("IOE09361", 2, 0, 1)],
      walked: [],
    });
    expect(ok.status).toBe(200);
    const s = await t.query(internal.blockRequests.standing, { block: "IOE09361" });
    // 40,000 left in the block ahead plus its own 100,000, at 2,000 a minute.
    expect([s.position, s.status, s.votes, s.etaMinutes, s.running, s.joining]).toEqual([2, "waiting", 1, 70, true, false]);

    await line(t, { at: NOW + 60_000, running: true, perMinute: 2000, items: [], walked: [{ block: "IOE09361", at: NOW + 50_000 }] });
    const done = await t.query(internal.blockRequests.standing, { block: "IOE09361" });
    expect(done.doneAt).toBe(NOW + 50_000);
    const late = await ask(t, "IOE09361", "198.51.100.9");
    expect(late.ok).toBe(false);
    expect(late.done).toBe(true);
    const open = await t.query(internal.blockRequests.openRequests, {});
    expect(open).toEqual([]);

    // A week after the pass, asking again opens a new request.
    vi.setSystemTime(NOW + 50_000 + 7 * 86_400_000);
    const again = await ask(t, "IOE09361", "198.51.100.10");
    expect([again.ok, again.votes]).toEqual([true, 1]);
    expect((await t.query(internal.blockRequests.openRequests, {})).map((r) => r.block)).toEqual(["IOE09361"]);
  });
});

describe("standingFor", () => {
  const state = (at: number, running = true) => ({
    at,
    running,
    perMinute: 1000,
    items: [item("IOE09370", 1, 50_000, 3, "walking" as const)],
    walked: [],
  });

  it("gives no time while the checker's line is old or it says it's stopped", () => {
    expect(standingFor("IOE09370", null, state(NOW), NOW).etaMinutes).toBe(50);
    expect(standingFor("IOE09370", null, state(NOW - LINE_STALE_MS - 1), NOW).etaMinutes).toBeNull();
    expect(standingFor("IOE09370", null, state(NOW, false), NOW).running).toBe(false);
  });

  it("calls a request the checker hasn't pulled yet joining", () => {
    const s = standingFor("IOE09371", { votes: 2 }, state(NOW), NOW);
    expect([s.joining, s.position, s.votes, s.inLine]).toEqual([true, null, 2, 1]);
  });
});

describe("parseBlockQueue", () => {
  it("refuses the whole line for one misshapen part", () => {
    const good = { at: NOW, running: true, perMinute: 10, items: [item("IOE09360", 1)], walked: [] };
    expect(parseBlockQueue(good)?.items).toHaveLength(1);
    expect(parseBlockQueue({ ...good, items: [{ ...item("IOE09360", 1), handed: 100_001 }] })).toBeNull();
    expect(parseBlockQueue({ ...good, items: [item("LIN09360", 1)] })).toBeNull();
    expect(parseBlockQueue({ ...good, walked: [{ block: "IOE09360", at: 5 }] })).toBeNull();
    expect(parseBlockQueue({ ...good, perMinute: -1 })).toBeNull();
    expect(parseBlockQueue({ ...good, items: Array.from({ length: 401 }, (_, i) => item("IOE09360", 1 + (i % 400))) })).toBeNull();
  });
});

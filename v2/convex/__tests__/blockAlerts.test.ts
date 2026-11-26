/**
 * Following a USCIS receipt block: double opt-in, news told once, nothing the page already showed told as news,
 * the server's update behind its secret, the stop links, and the next steps never pointing back to PERM.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Tracked, so each test's own scheduled work is settled before the next test starts (test-utils/convexSettle.ts).
import { finishScheduledNow, settleScheduled, trackedTestContext as createTestContext } from "../../test-utils/convexSettle";
import { internal } from "../_generated/api";
import { makeUnsubscribeToken } from "../lib/unsubscribeToken";
import { blockNews, dueKeys, earnedKeys, nextSteps } from "../blockAlerts";
import { parseBlockUpdate } from "../lib/blockUpdate";

const SECRET = "test-unsubscribe-secret";
const SERVER = "test-server-secret";
const originalFetch = global.fetch;

type T = ReturnType<typeof createTestContext>;

const counts = (total: number, approved: number, denied = 0, rfe = 0) => ({ total, approved, denied, rfe, waiting: total - approved - denied - rfe });

function stub(): { sends: { to: string; subject: string; text: string }[] } {
  const sends: { to: string; subject: string; text: string }[] = [];
  global.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    sends.push({ to: String(body.to ?? ""), subject: String(body.subject ?? ""), text: String(body.text ?? "") });
    return new Response(JSON.stringify({ id: "stub" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { sends };
}

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("WATCHED_CASES_SECRET", SERVER);
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("BLOCKED_EMAILS", "");
  // The paid plan: a block's news goes at once, as an employer's does.
  vi.stubEnv("EMAIL_DAILY_LIMIT", "1600");
});
afterEach(async () => {
  await settleScheduled();
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

async function follow(t: T, email: string, block = "IOE09366", extra: Record<string, unknown> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("blockAlerts", { email, block, form: "I-765", createdAt: Date.now(), confirmedAt: Date.now(), ...extra }),
  );
}

async function update(t: T, blocks: unknown[], secret: string | null = SERVER) {
  return await t.fetch("/block-update", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ asOf: "2026-11-26", blocks }),
  });
}

describe("what counts as news", () => {
  const snap = { every: true, byForm: { "I-765": counts(1000, 520), "I-485": counts(800, 100) } };

  it("names each milestone the followed form has passed, and the block's last number", () => {
    expect(dueKeys(snap, "I-765", [], null)).toEqual(["every", "m25:I-765", "m50:I-765"]);
    expect(dueKeys(snap, "I-485", [], null)).toEqual(["every"]);
  });

  it("tells each piece once", () => {
    expect(dueKeys(snap, "I-765", ["every", "m25:I-765", "m50:I-765"], null)).toEqual([]);
  });

  it("marks what the page already showed as told at the confirming click", () => {
    const told = earnedKeys(snap, "I-765");
    expect(dueKeys(snap, "I-765", told, null)).toEqual([]);
    expect(earnedKeys(null, "I-765")).toEqual([]);
  });

  it("sums a week only against the Monday's own baseline", () => {
    const week = { ...snap, summaryOf: "2026-11-30", summaryFrom: "2026-11-23", summaryByForm: { "I-765": counts(1000, 400) } };
    expect(dueKeys(week, "I-765", ["every", "m25:I-765", "m50:I-765"], "2026-11-30")).toEqual(["week:2026-11-30"]);
    expect(dueKeys(week, "I-765", ["every", "m25:I-765", "m50:I-765"], "2026-12-07")).toEqual([]);
    const news = blockNews("IOE09366", "I-765", ["week:2026-11-30"], week);
    expect(news.subject).toBe("IOE09366 this week: 120 more approved");
    const missed = blockNews("IOE09366", "I-765", ["week:2026-11-30"], { ...week, summaryFrom: "2026-11-16" });
    expect(missed.subject).toBe("IOE09366 since November 16, 2026: 120 more approved");
  });

  it("leads with the biggest news, and the highest milestone", () => {
    expect(blockNews("IOE09366", "I-765", ["m25:I-765", "m50:I-765"], snap).subject).toBe("IOE09366 passed 50% approved");
    expect(blockNews("IOE09366", "I-765", ["every", "m50:I-765"], snap).subject).toBe("IOE09366: every number checked");
  });

  it("points someone whose case is at USCIS to their own case, never back to PERM", () => {
    for (const form of ["I-765", "I-485", undefined]) {
      const hrefs = nextSteps(form).map((s) => s.href);
      expect(hrefs.some((h) => /perm/i.test(new URL(h).pathname))).toBe(false);
      expect(hrefs[0]).toMatch(/\/uscis-case-status$/);
    }
  });
});

describe("the server's update body", () => {
  it("is refused whole when anything in it is misshapen", () => {
    const good = { block: "IOE09366", every: false, checked: 5, byForm: { "I-765": counts(5, 1) } };
    expect(parseBlockUpdate({ asOf: "2026-11-26", blocks: [good] })).not.toBeNull();
    expect(parseBlockUpdate({ asOf: "2026-11-26", blocks: [{ ...good, block: "LIN09366" }] })).toBeNull();
    expect(parseBlockUpdate({ asOf: "2026-11-26", blocks: [{ ...good, byForm: { "<b>": counts(5, 1) } }] })).toBeNull();
    expect(parseBlockUpdate({ asOf: "2026-11-26", blocks: [{ ...good, byForm: { "I-765": { ...counts(5, 1), total: -1 } } }] })).toBeNull();
    expect(parseBlockUpdate({ asOf: "yesterday", blocks: [] })).toBeNull();
  });
});

describe("signing up", () => {
  it("refuses what isn't a block, and stages a real one unconfirmed with one email", async () => {
    const t = createTestContext();
    const { sends } = stub();
    const bad = await t.fetch("/block-alert/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", block: "<script>" }),
    });
    expect(bad.status).toBe(400);
    const ok = await t.fetch("/block-alert/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "A@Example.com", block: "ioe09366", form: "I-765" }),
    });
    expect(ok.status).toBe(200);
    await finishScheduledNow(t);
    const rows = await t.run(async (ctx) => ctx.db.query("blockAlerts").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "a@example.com", pendingBlock: "IOE09366", pendingForm: "I-765" });
    expect(rows[0]!.confirmedAt).toBeUndefined();
    expect(sends.filter((s) => s.subject.startsWith("Confirm:"))).toHaveLength(1);
  });

  it("goes live only on the confirm page's POST, and a GET changes nothing", async () => {
    const t = createTestContext();
    stub();
    await t.run(async (ctx) =>
      ctx.db.insert("blockAlerts", { email: "b@example.com", block: "IOE09366", pendingBlock: "IOE09366", pendingForm: "I-765", createdAt: Date.now() }),
    );
    const token = await makeUnsubscribeToken("b@example.com", SECRET, "block-confirm");
    const get = await t.fetch(`/block-alert/confirm?token=${encodeURIComponent(token)}`);
    expect(get.status).toBe(200);
    expect((await t.run(async (ctx) => ctx.db.query("blockAlerts").first()))!.confirmedAt).toBeUndefined();
    const post = await t.fetch(`/block-alert/confirm?token=${encodeURIComponent(token)}`, { method: "POST" });
    expect(await post.text()).toContain("You follow IOE09366");
    const row = (await t.run(async (ctx) => ctx.db.query("blockAlerts").first()))!;
    expect(row.confirmedAt).toBeDefined();
    expect(row.pendingBlock).toBeUndefined();
  });
});

describe("the server's update", () => {
  it("is refused without the server's secret", async () => {
    const t = createTestContext();
    stub();
    expect((await update(t, [], null)).status).toBe(401);
    expect((await update(t, [], "wrong")).status).toBe(401);
  });

  it("tells a follower each piece of news once, and only what they follow", async () => {
    const t = createTestContext();
    const { sends } = stub();
    await follow(t, "c@example.com");
    await follow(t, "d@example.com", "IOE09373");
    const first = await update(t, [{ block: "IOE09366", every: true, checked: 100000, byForm: { "I-765": counts(20000, 9000) } }]);
    expect(first.status).toBe(200);
    await finishScheduledNow(t);
    const told = sends.filter((s) => !s.subject.startsWith("Confirm:"));
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ to: "c@example.com", subject: "IOE09366: every number checked" });
    expect(told[0]!.text).toContain("/uscis-case-status");
    expect(told[0]!.text).not.toMatch(/app\/perm-/);

    await update(t, [{ block: "IOE09366", every: true, checked: 100000, byForm: { "I-765": counts(20000, 9100) } }]);
    await finishScheduledNow(t);
    expect(sends.filter((s) => !s.subject.startsWith("Confirm:"))).toHaveLength(1);
  });

  it("sends nothing to a follow someone stopped", async () => {
    const t = createTestContext();
    const { sends } = stub();
    await follow(t, "e@example.com");
    const token = await makeUnsubscribeToken("e@example.com", SECRET, "block-unsubscribe");
    const get = await t.fetch(`/block-alert/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(get.status).toBe(200);
    await t.fetch(`/block-alert/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
    await update(t, [{ block: "IOE09366", every: true, checked: 100000, byForm: { "I-765": counts(20000, 9000) } }]);
    await finishScheduledNow(t);
    expect(sends.filter((s) => !s.subject.startsWith("Confirm:"))).toHaveLength(0);
  });
});

describe("the Monday summary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts from the Monday before, however many loads came between", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Set before the test database exists: set after it, the first load read the real date.
    vi.setSystemTime(new Date("2026-11-23T13:00:00Z"));
    const t = createTestContext();
    const { sends } = stub();
    await follow(t, "g@example.com", "IOE09366", { toldKeys: ["every", "m25:I-765", "m50:I-765"] });
    const load = async (iso: string, approved: number) => {
      vi.setSystemTime(new Date(iso));
      await update(t, [{ block: "IOE09366", every: true, checked: 100000, byForm: { "I-765": counts(20000, approved) } }]);
      await finishScheduledNow(t);
    };
    await load("2026-11-23T14:00:00Z", 10000); // Monday Nov 23: the week's starting point
    await load("2026-11-27T14:00:00Z", 10500); // Friday
    await load("2026-11-29T23:00:00Z", 10900); // Sunday evening
    await load("2026-11-30T14:00:00Z", 11000); // Monday Nov 30: the summary
    await load("2026-11-30T20:00:00Z", 11100); // a second Monday load sends nothing more
    const told = sends.filter((s) => !s.subject.startsWith("Confirm:"));
    expect(told).toHaveLength(1);
    expect(told[0]!.subject).toBe("IOE09366 this week: 1,000 more approved");
  });
});

describe("the preferences page", () => {
  it("lists a block follow and turns it off by its own row", async () => {
    const t = createTestContext();
    stub();
    const id = await follow(t, "f@example.com");
    const token = await makeUnsubscribeToken("f@example.com", SECRET, "prefs");
    const state = await t.mutation(internal.emailPrefs.stateByToken, { token });
    expect(state?.blockAlerts).toEqual([{ id, block: "IOE09366", form: "I-765", confirmed: true, active: true }]);
    const after = await t.mutation(internal.emailPrefs.disableByToken, { token, kind: "block", id });
    expect(after?.blockAlerts[0]?.active).toBe(false);
  });
});

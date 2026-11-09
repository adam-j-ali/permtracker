import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two browser-push sweeps' quiet stops: a push that went is never sent again because the record after it
 * failed, and a deployment without its push keys tells the owner, once a day. Mocked at web-push and the mirror.
 */

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ setVapidDetails: vi.fn(), sendNotification }));
const one = vi.fn();
const query = vi.fn();
vi.mock("../lib/publicMirror", () => ({ one, query, rows: vi.fn(), placeholders: (n: number) => (n > 0 ? new Array(n).fill("?").join(",") : null) }));

const { createTestContext } = await import("../../test-utils/convex");
const { internal } = await import("../_generated/api");

type T = ReturnType<typeof createTestContext>;
const SUB = JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/1", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } });
const CASE = "G-100-26100-111111";

const recorded = (t: T) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes("systemErrors")));

/** Make one internal mutation throw while `run` runs, as a transient failure would. */
async function failing<R>(mod: Record<string, unknown>, name: string, run: () => Promise<R>): Promise<R> {
  const fn = mod[name] as { _handler: (...a: unknown[]) => unknown };
  const real = fn._handler;
  fn._handler = async () => {
    throw new Error("stubbed record failure");
  };
  try {
    return await run();
  } finally {
    fn._handler = real;
  }
}

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
  one.mockReset();
  one.mockResolvedValue({ bulletin_month: "2026-11", final_action: JSON.stringify({ EB2: { india: "01MAR13" } }) });
  query.mockReset();
  query.mockResolvedValue([[{ case_number: CASE, current_status: "CERTIFIED", is_final: 0 }]]);
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const bulletinRow = (t: T) =>
  t.run(async (ctx) =>
    ctx.db.insert("bulletinPushAlerts", {
      category: "EB2",
      country: "india",
      subscription: SUB,
      endpointHash: "0".repeat(64),
      lastSeenBulletin: "2026-10",
      lastSeenCutoff: "01JAN13",
      createdAt: Date.now(),
      failures: 0,
    }),
  );

const caseRow = (t: T) =>
  t.run(async (ctx) =>
    ctx.db.insert("caseStatusPushAlerts", {
      caseNumber: CASE,
      subscription: SUB,
      endpointHash: "0".repeat(64),
      lastSeenStatus: "ANALYST REVIEW",
      createdAt: Date.now(),
      failures: 0,
    }),
  );

describe("the bulletin push sweep", () => {
  it("doesn't push again when the push went but recording it failed", async () => {
    const t = createTestContext();
    const id = await bulletinRow(t);
    const mod = (await import("../bulletinPushAlerts")) as unknown as Record<string, unknown>;
    const res = await failing(mod, "delivered", () => t.action(internal.bulletinPushAlertsSweep.sweep, {}));
    expect(res.sent).toBe(1);
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.lastSeenBulletin, "the claim stays: the push went").toBe("2026-11");
    await t.action(internal.bulletinPushAlertsSweep.sweep, {});
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("tells the owner once a day when the push keys aren't set", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const t = createTestContext();
    await bulletinRow(t);
    await t.action(internal.bulletinPushAlertsSweep.sweep, {});
    await t.action(internal.bulletinPushAlertsSweep.sweep, {});
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await recorded(t)).toHaveLength(1);
  });
});

describe("the case push sweep", () => {
  it("doesn't push again when the push went but recording it failed", async () => {
    const t = createTestContext();
    const id = await caseRow(t);
    const mod = (await import("../casePushAlerts")) as unknown as Record<string, unknown>;
    const res = await failing(mod, "markSeen", () => t.action(internal.casePushAlertsSweep.sweep, {}));
    expect(res.sent).toBe(1);
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.lastSeenStatus, "the claim stays: the push went").toBe("CERTIFIED");
    await t.action(internal.casePushAlertsSweep.sweep, {});
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("tells the owner once a day when the push keys aren't set", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const t = createTestContext();
    await caseRow(t);
    await t.action(internal.casePushAlertsSweep.sweep, {});
    await t.action(internal.casePushAlertsSweep.sweep, {});
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await recorded(t)).toHaveLength(1);
  });
});

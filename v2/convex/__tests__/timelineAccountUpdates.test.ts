import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settleScheduled, trackedTestContext as createTestContext } from "../../test-utils/convexSettle";
import { api, internal } from "../_generated/api";
import { MAX_ACCOUNT_EVENTS, MAX_CONTACTS, METRIC_MIN_N, OFFICE_LIST_OPENS_AT } from "../lib/communityTimeline";

/**
 * A timeline's account updates (a day, a form, a code from the list or typed), its service center and its Supplement
 * J date: saved and read back, a typed code put in front of the owner before it shows, a code's count printed once
 * enough timelines report it, and the HTTP layer narrowing what a stranger sends.
 */

type T = ReturnType<typeof createTestContext>;

const ADMIN = "admin@updates-test.com";
const HFD = "HAR";
const key = (i: number) => i.toString(16).padStart(64, "0");
const ip = (i: number) => (i + 8192).toString(16).padStart(64, "0");
const originalFetch = global.fetch;

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAIL", ADMIN);
  vi.stubEnv("DATABASE_URL", "https://example.turso.io");
  vi.stubEnv("DATABASE_AUTH_TOKEN", "stub-token");
  global.fetch = (async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterEach(async () => {
  // Saving and approving schedule the owner's notice: let it finish under this file's fetch stub (convexSettle.ts).
  await settleScheduled();
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

async function adminAuth(t: T) {
  const id = await t.run(async (ctx) => ctx.db.insert("users", { email: ADMIN }));
  return t.withIdentity({ subject: id, email: ADMIN });
}
const rows = (t: T) => t.run((ctx) => ctx.db.query("communityTimelines").take(1000));

const timeline = (i: number, over: Record<string, unknown> = {}) => ({
  editKeyHash: key(i),
  ipHash: ip(i),
  input: {
    fieldOffice: HFD,
    i485Center: "NBC",
    category: "eb2",
    i485FiledOn: "2025-05-01",
    biometricsOn: `2025-06-${String(10 + (i % 15)).padStart(2, "0")}`,
    public: true,
    accountEvents: [{ on: "2025-09-02", form: "i485", code: "FTA0" }],
    ...over,
  },
});

async function saveApproved(t: T, n: number, over: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) {
    const r = await t.mutation(internal.communityTimelines.save, timeline(i, over));
    expect(r.ok, r.message).toBe(true);
  }
  const admin = await adminAuth(t);
  for (const r of await rows(t)) await admin.mutation(api.communityTimelines.approve, { id: r._id });
  return admin;
}

describe("a timeline's account updates", () => {
  it("are saved sorted with their center and Supplement J date, and read back by the key", async () => {
    const t = createTestContext();
    const r = await t.mutation(
      internal.communityTimelines.save,
      timeline(0, {
        i485jApprovedOn: "2025-10-01",
        accountEvents: [
          { on: "2025-09-02", form: "i485", code: "fta0" },
          { on: "2025-07-15", form: "i765", code: null },
        ],
      }),
    );
    expect(r.ok, r.message).toBe(true);
    const [row] = await rows(t);
    expect(row).toMatchObject({ i485Center: "NBC", i485jApprovedOn: "2025-10-01" });
    expect(row!.accountEvents).toEqual([
      { on: "2025-07-15", form: "i765" },
      { on: "2025-09-02", form: "i485", code: "FTA0" },
    ]);
    const mine = await t.query(internal.communityTimelines.mine, { editKeyHash: key(0) });
    expect(mine?.input).toMatchObject({ i485Center: "NBC", i485jApprovedOn: "2025-10-01" });
    expect(mine?.input.accountEvents).toHaveLength(2);
  });

  it("clear when an edit leaves them out", async () => {
    const t = createTestContext();
    await t.mutation(internal.communityTimelines.save, timeline(0));
    await t.mutation(internal.communityTimelines.save, timeline(0, { accountEvents: null, i485Center: null }));
    const [row] = await rows(t);
    expect("accountEvents" in row!).toBe(false);
    expect("i485Center" in row!).toBe(false);
  });
});

describe("a typed code waits for the owner", () => {
  it("an edit to an approved timeline that brings a new typed code takes it off the site until the owner looks", async () => {
    const t = createTestContext();
    const admin = await saveApproved(t, 1);
    const r = await t.mutation(
      internal.communityTimelines.save,
      timeline(0, { accountEvents: [{ on: "2025-09-02", form: "i485", code: "FTA0" }, { on: "2025-10-02", code: "XQ7" }] }),
    );
    expect(r).toMatchObject({ ok: true, status: "pending" });
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "pending" });
    expect(row!.editedAt).toBeUndefined();
    const list = await admin.query(api.communityTimelines.listForAdmin, {});
    expect(list.waiting).toHaveLength(1);
    expect(list.waiting[0]!.flags).toContain("A typed code: XQ7.");
    expect(list.waiting[0]!.updates).toContainEqual({ on: "2025-10-02", form: null, code: "XQ7", typed: true });
    expect(list.waiting[0]!.center).toBe("National Benefits Center");
  });

  it("an edit that adds only a listed code, or keeps a typed code already approved, stays up", async () => {
    const t = createTestContext();
    await saveApproved(t, 1, { accountEvents: [{ on: "2025-10-02", code: "XQ7" }] });
    const listed = await t.mutation(
      internal.communityTimelines.save,
      timeline(0, { accountEvents: [{ on: "2025-10-02", code: "XQ7" }, { on: "2025-11-02", form: "i485", code: "FTA0" }] }),
    );
    expect(listed).toMatchObject({ ok: true, status: "approved" });
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "approved" });
    expect(row!.editedAt).toBeTypeOf("number");
  });

  it("the owner sees a near-duplicate among the timelines waiting", async () => {
    const t = createTestContext();
    await t.mutation(internal.communityTimelines.save, timeline(0));
    await t.mutation(internal.communityTimelines.save, { ...timeline(15), ipHash: ip(0) });
    const admin = await adminAuth(t);
    const { waiting } = await admin.query(api.communityTimelines.listForAdmin, {});
    expect(waiting).toHaveLength(2);
    for (const w of waiting) expect(w.flags).toContain("Another timeline from the same connection shares 2 of its dates.");
  });
});

describe("what the public sees", () => {
  it("a code's count once enough timelines report it, and a center named on rows once enough name it", async () => {
    const t = createTestContext();
    await saveApproved(t, Math.max(METRIC_MIN_N, OFFICE_LIST_OPENS_AT, 10));
    const board = await t.query(api.communityTimelines.board, {});
    expect(board.codes).toEqual([{ code: "FTA0", timelines: board.total, listed: true }]);
    expect(board.rows[0]).toMatchObject({ center: "NBC", updates: { count: 1, codes: ["FTA0"] } });
    expect(JSON.stringify(board.rows)).not.toContain("2025-09-02");
    // One FTA0 each, so no third: the count is there and empty.
    expect(board.thirdFta0).toEqual({ reported: 0, withCard: 0, medianToCard: null, waiting: 0, medianWaiting: null });
    const office = await t.query(api.communityTimelines.office, { office: HFD });
    expect(office.codes[0]).toMatchObject({ code: "FTA0" });
    expect(office.rows[0]!.updates).toEqual({ count: 1, codes: ["FTA0"], lastDay: 124 });
  });

  it("no code below the floor, and no center on a row below its floor", async () => {
    const t = createTestContext();
    await saveApproved(t, 2);
    const board = await t.query(api.communityTimelines.board, {});
    expect(board.codes).toEqual([]);
  });
});

// Each request through the test harness's HTTP router takes a few seconds, so these carry a longer limit.
describe("the HTTP layer", () => {
  const post = (t: T, body: unknown) =>
    t.fetch("/timeline/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("saves account updates and refuses a shape that isn't a list of short strings", { timeout: 45_000 }, async () => {
    const t = createTestContext();
    const k = "d".repeat(64);
    const ok = await post(t, { key: k, i485FiledOn: "2025-05-01", i485Center: "NBC", accountEvents: [{ on: "2025-06-01", form: "i485", code: "IAF" }] });
    expect(ok.status).toBe(200);
    const [row] = await rows(t);
    expect(row!.accountEvents).toEqual([{ on: "2025-06-01", form: "i485", code: "IAF" }]);
    expect((await post(t, { key: k, i485FiledOn: "2025-05-01", accountEvents: "FTA0" })).status).toBe(400);
    expect((await post(t, { key: k, i485FiledOn: "2025-05-01", accountEvents: [{ on: 20250601 }] })).status).toBe(400);
    expect((await post(t, { key: k, i485FiledOn: "2025-05-01", accountEvents: [{ on: "2025-06-01", code: "X".repeat(40) }] })).status).toBe(400);
    expect((await post(t, { key: k, i485FiledOn: "2025-05-01", contacts: "congressional" })).status).toBe(400);
    expect((await post(t, { key: k, i485FiledOn: "2025-05-01", contacts: [{ on: "2025-06-01", kind: "x".repeat(40) }] })).status).toBe(400);
  });

  it("takes the most updates a timeline keeps inside the body limit, and says so in words one past it", { timeout: 45_000 }, async () => {
    const t = createTestContext();
    const full = Array.from({ length: MAX_ACCOUNT_EVENTS }, (_, i) => ({
      on: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      form: "i485j",
      code: `QZ${String(i).padStart(4, "0")}`,
    }));
    const base = {
      key: "e".repeat(64),
      category: "eb3-other",
      country: "philippines",
      route: "adjustment",
      fieldOffice: HFD,
      i485Center: "NBC",
      i140FiledOn: "2024-01-02",
      i140ApprovedOn: "2024-02-02",
      i485FiledOn: "2024-03-02",
      biometricsOn: "2024-04-02",
      eadOn: "2024-05-02",
      apOn: "2024-05-03",
      i485jApprovedOn: "2024-06-02",
      interviewOn: "2024-07-02",
      greenCardOn: "2026-01-02",
      rfeForm: "i485",
      rfeReason: "supplement-j",
      rfeIssuedOn: "2024-08-02",
      rfeRespondedOn: "2024-09-02",
      rfeOutcome: "approved",
      public: true,
      premium: true,
      applicant: "dependent",
      premiumOn: "2024-01-20",
      officeMovedOn: "2024-08-02",
      cardArrivedOn: "2026-01-20",
      interview: "held",
      contacts: Array.from({ length: MAX_CONTACTS }, (_, i) => ({ on: `2025-0${(i % 9) + 1}-15`, kind: "service-request" })),
    };
    const ok = await post(t, { ...base, accountEvents: full });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const over = await post(t, { ...base, accountEvents: [...full, { on: "2025-12-30", code: "ZZ9" }] });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { message: string }).message).toContain(`more than ${MAX_ACCOUNT_EVENTS} account updates`);
  });
});

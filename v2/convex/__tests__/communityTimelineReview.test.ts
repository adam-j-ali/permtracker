import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { api, internal } from "../_generated/api";
import { SAVED_WAITING } from "../communityTimelines";
import { BOARD_OPENS_AT, OFFICE_LIST_OPENS_AT } from "../lib/communityTimeline";

/**
 * Timelines wait for the owner: a new one reaches no page, count or median
 * until it's approved; its author still reads it back; the owner is told once
 * a day; each decision refreshes the pages that show it. And a timeline needs
 * no PERM case number, names a USCIS office from the fixed list, and an
 * office's own list opens at three shared.
 */

type T = ReturnType<typeof createTestContext>;

const ADMIN = "admin@timelines-test.com";
const CASE = "G-100-25324-425560";
const HFD = "HAR"; // Hartford, in src/lib/uscisOffices.json
const key = (i: number) => i.toString(16).padStart(64, "0");
const ip = (i: number) => (i + 4096).toString(16).padStart(64, "0");
const originalFetch = global.fetch;

let posted: { url: string; body: string }[] = [];

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAIL", ADMIN);
  vi.stubEnv("DATABASE_URL", "https://example.turso.io");
  vi.stubEnv("DATABASE_AUTH_TOKEN", "stub-token");
  posted = [];
  global.fetch = (async (url: unknown, init?: { body?: string }) => {
    posted.push({ url: String(url), body: init?.body ?? "" });
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function adminAuth(t: T) {
  const id = await t.run(async (ctx) => ctx.db.insert("users", { email: ADMIN }));
  return t.withIdentity({ subject: id, email: ADMIN });
}

const rows = (t: T) => t.run((ctx) => ctx.db.query("communityTimelines").take(1000));

/** A timeline with no case number at Hartford, shared on the board unless told otherwise. */
const bare = (i: number, over: Record<string, unknown> = {}) => ({
  editKeyHash: key(i),
  ipHash: ip(i),
  input: { fieldOffice: HFD, category: "eb2-niw", i485FiledOn: "2025-05-01", biometricsOn: "2025-06-10", public: true, ...over },
});

async function saveMany(t: T, n: number, over: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) {
    const r = await t.mutation(internal.communityTimelines.save, bare(i, over));
    expect(r.ok, r.message).toBe(true);
  }
}

async function approveAll(t: T) {
  const admin = await adminAuth(t);
  for (const r of await rows(t)) await admin.mutation(api.communityTimelines.approve, { id: r._id });
}

describe("a timeline with no PERM case number", () => {
  it("is saved by its key alone, read back by that key and by nobody else's", async () => {
    const t = createTestContext();
    const r = await t.mutation(internal.communityTimelines.save, bare(1));
    expect(r).toMatchObject({ ok: true, status: "pending", message: SAVED_WAITING });
    const [row] = await rows(t);
    expect(row).toMatchObject({ fieldOffice: HFD, biometricsOn: "2025-06-10", status: "pending" });
    expect("caseNumber" in row!).toBe(false);
    const mine = await t.query(internal.communityTimelines.mine, { editKeyHash: key(1) });
    expect(mine).toMatchObject({ caseNumber: null, status: "pending", input: { fieldOffice: HFD, biometricsOn: "2025-06-10" } });
    expect(await t.query(internal.communityTimelines.mine, { editKeyHash: key(2) })).toBeNull();
  });

  it("caps them at three from one address BEFORE charging any limit", async () => {
    const t = createTestContext();
    for (let i = 0; i < 3; i++) expect((await t.mutation(internal.communityTimelines.save, { ...bare(i), ipHash: ip(0) })).ok).toBe(true);
    const before = await t.run((ctx) => ctx.db.query("rateLimits").take(1000));
    const fourth = await t.mutation(internal.communityTimelines.save, { ...bare(9), ipHash: ip(0) });
    expect(fourth).toMatchObject({ ok: false, throttled: true });
    const after = await t.run((ctx) => ctx.db.query("rateLimits").take(1000));
    expect(after.length).toBe(before.length);
    expect(await rows(t)).toHaveLength(3);
  });

  it.each([
    ["an office that isn't in USCIS's list", { fieldOffice: "ZZZ" }],
    ["an office on a consular case", { route: "consular", i485FiledOn: null, biometricsOn: null, interviewOn: "2026-01-05" }],
  ])("refuses %s and writes nothing", async (_, over) => {
    const t = createTestContext();
    const r = await t.mutation(internal.communityTimelines.save, bare(1, over));
    expect(r.ok).toBe(false);
    expect(await rows(t)).toHaveLength(0);
  });

  it("refuses a category with no PERM beside a PERM case number", async () => {
    const t = createTestContext();
    const r = await t.mutation(internal.communityTimelines.save, { ...bare(1), caseNumber: CASE });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no PERM case/);
    expect(await rows(t)).toHaveLength(0);
  });

  it("one key is one row: adding a case number later moves the row and asks DOL for that case", async () => {
    const t = createTestContext();
    await t.mutation(internal.communityTimelines.save, bare(1, { category: "eb2" }));
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("communityTimelines").take(1);
      await ctx.db.patch(row!._id, { permFiledOn: "2020-01-01", permCheckedAt: 5 });
    });
    const r = await t.mutation(internal.communityTimelines.save, { ...bare(1, { category: "eb2" }), caseNumber: CASE });
    expect(r.ok).toBe(true);
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ caseNumber: CASE });
    // Another case's PERM dates never stay on the row.
    expect(all[0]!.permFiledOn).toBeUndefined();
    // A case's page reads it back for that case, and not for another.
    expect(await t.query(internal.communityTimelines.mine, { caseNumber: CASE, editKeyHash: key(1) })).not.toBeNull();
    expect(await t.query(internal.communityTimelines.mine, { caseNumber: "G-100-25324-999999", editKeyHash: key(1) })).toBeNull();
  });
});

describe("nothing shows until the owner approves", () => {
  it("a waiting timeline is in no count, median, list or case summary; approving puts it in all of them", async () => {
    const t = createTestContext();
    await saveMany(t, BOARD_OPENS_AT);
    const before = await t.query(api.communityTimelines.board, {});
    expect(before).toMatchObject({ total: 0, shared: 0, open: false, rows: [], offices: [] });
    expect(before.metrics.every((m) => m.n === 0)).toBe(true);
    const officeBefore = await t.query(api.communityTimelines.office, { office: HFD });
    expect(officeBefore).toMatchObject({ total: 0, shared: 0, open: false, rows: [] });

    await approveAll(t);
    const after = await t.query(api.communityTimelines.board, {});
    expect(after).toMatchObject({ total: BOARD_OPENS_AT, shared: BOARD_OPENS_AT, open: true });
    expect(after.rows).toHaveLength(BOARD_OPENS_AT);
    expect(after.metrics.find((m) => m.id === "i485-bio")).toMatchObject({ n: BOARD_OPENS_AT, median: 40 });
    expect(after.offices).toEqual([{ code: HFD, shared: BOARD_OPENS_AT }]);
    expect(after.rows.every((r) => r.office === HFD)).toBe(true);
  });

  it("a case's counts leave out a timeline that waits", async () => {
    const t = createTestContext();
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.communityTimelines.save, { ...bare(i, { category: "eb2" }), caseNumber: CASE });
    }
    expect(await t.query(internal.communityTimelines.caseSummary, { caseNumber: CASE })).toMatchObject({ withheld: true, timelines: 0 });
    await approveAll(t);
    expect(await t.query(internal.communityTimelines.caseSummary, { caseNumber: CASE })).toMatchObject({ withheld: false, timelines: 3 });
  });

  it("a declined timeline shows nowhere, keeps its reason, and its author still reads it", async () => {
    const t = createTestContext();
    await saveMany(t, OFFICE_LIST_OPENS_AT);
    await approveAll(t);
    const admin = await adminAuth(t);
    const [first] = await rows(t);
    await admin.mutation(api.communityTimelines.decline, { id: first!._id, reason: "implausible" });
    const office = await t.query(api.communityTimelines.office, { office: HFD });
    expect(office).toMatchObject({ total: OFFICE_LIST_OPENS_AT - 1, open: false, rows: [] });
    const mine = await t.query(internal.communityTimelines.mine, { editKeyHash: first!.editKeyHash });
    expect(mine?.status).toBe("declined");
    expect((await rows(t)).find((r) => r._id === first!._id)).toMatchObject({ status: "declined", declineReason: "implausible" });
  });

  it("a timeline saved before reviews existed counts as approved, and the backfill writes that once", async () => {
    const t = createTestContext();
    await t.run((ctx) =>
      ctx.db.insert("communityTimelines", { caseNumber: CASE, editKeyHash: key(1), ipHash: ip(1), public: true, i140FiledOn: "2026-05-01", createdAt: 1, updatedAt: 1 }),
    );
    expect((await t.query(api.communityTimelines.board, {})).total).toBe(1);
    expect(await t.mutation(internal.communityTimelines.backfillStatus, {})).toBe(1);
    expect(await t.mutation(internal.communityTimelines.backfillStatus, {})).toBe(0);
    expect((await rows(t))[0]).toMatchObject({ status: "approved" });
    expect((await t.query(api.communityTimelines.board, {})).total).toBe(1);
  });
});

describe("an edit after the owner's decision", () => {
  it("to an approved timeline stays up and is put in front of the owner", async () => {
    const t = createTestContext();
    await saveMany(t, 1);
    await approveAll(t);
    const r = await t.mutation(internal.communityTimelines.save, bare(0, { interviewOn: "2026-02-03" }));
    expect(r).toMatchObject({ ok: true, status: "approved" });
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "approved", interviewOn: "2026-02-03" });
    expect(row!.editedAt).toBeTypeOf("number");
    const admin = await adminAuth(t);
    const list = await admin.query(api.communityTimelines.listForAdmin, {});
    expect(list.edited).toHaveLength(1);
    expect(list.waiting).toHaveLength(0);
    await admin.mutation(api.communityTimelines.keepEdit, { id: row!._id });
    expect((await admin.query(api.communityTimelines.listForAdmin, {})).edited).toHaveLength(0);
  });

  it("to a declined timeline sends it back to wait", async () => {
    const t = createTestContext();
    await saveMany(t, 1);
    const admin = await adminAuth(t);
    const [row] = await rows(t);
    await admin.mutation(api.communityTimelines.decline, { id: row!._id, reason: "implausible" });
    const r = await t.mutation(internal.communityTimelines.save, bare(0, { biometricsOn: "2025-06-20" }));
    expect(r).toMatchObject({ ok: true, status: "pending" });
    const [again] = await rows(t);
    expect(again).toMatchObject({ status: "pending" });
    expect(again!.declineReason).toBeUndefined();
    expect(again!.reviewedAt).toBeUndefined();
  });
});

describe("one USCIS office's list", () => {
  it("opens at three shared timelines and carries nothing that names a person or a case", async () => {
    const t = createTestContext();
    for (let i = 0; i < OFFICE_LIST_OPENS_AT; i++) {
      await t.mutation(internal.communityTimelines.save, { ...bare(i, { category: "eb2" }), caseNumber: `G-100-25324-${300000 + i}` });
    }
    await approveAll(t);
    const two = await rows(t);
    await t.run((ctx) => ctx.db.patch(two[0]!._id, { public: false }));
    expect(await t.query(api.communityTimelines.office, { office: HFD })).toMatchObject({ total: 3, shared: 2, open: false, rows: [] });
    await t.run((ctx) => ctx.db.patch(two[0]!._id, { public: true }));
    const o = await t.query(api.communityTimelines.office, { office: HFD });
    expect(o).toMatchObject({ total: 3, shared: 3, open: true, opensAt: OFFICE_LIST_OPENS_AT });
    expect(o.rows).toHaveLength(3);
    expect(o.rows[0]).toMatchObject({ filedMonth: "2025-05", category: "eb2" });
    expect(o.rows[0]!.stops.find((s) => s.id === "biometricsOn")).toMatchObject({ day: 40, month: "2025-06" });
    const text = JSON.stringify(o);
    expect(text).not.toMatch(/G-100-25324/);
    for (const r of two) {
      expect(text).not.toContain(r.editKeyHash);
      expect(text).not.toContain(r.ipHash);
    }
    expect(text).not.toContain("2025-05-01");
  });

  it("reads empty for an office this site has no page for", async () => {
    const t = createTestContext();
    expect(await t.query(api.communityTimelines.office, { office: "ZZZ" })).toMatchObject({ total: 0, open: false, rows: [] });
    expect(await t.query(api.communityTimelines.office, { office: "x".repeat(500) })).toMatchObject({ total: 0, open: false });
  });

  it("the board names an office on a row only when that office's own list is open", async () => {
    const t = createTestContext();
    await saveMany(t, BOARD_OPENS_AT - 1);
    await t.mutation(internal.communityTimelines.save, bare(50, { fieldOffice: "BOS" }));
    await approveAll(t);
    const b = await t.query(api.communityTimelines.board, {});
    expect(b.open).toBe(true);
    expect(b.offices).toEqual([{ code: HFD, shared: BOARD_OPENS_AT - 1 }]);
    expect(b.rows.filter((r) => r.office === HFD)).toHaveLength(BOARD_OPENS_AT - 1);
    expect(b.rows.filter((r) => r.office === null)).toHaveLength(1);
    expect(JSON.stringify(b)).not.toContain("BOS");
  });
});

describe("the owner's side", () => {
  it("only an admin can list, approve, decline, hide or delete", async () => {
    const t = createTestContext();
    await saveMany(t, 1);
    const [row] = await rows(t);
    const stranger = t.withIdentity({ subject: await t.run((ctx) => ctx.db.insert("users", { email: "someone@example.com" })), email: "someone@example.com" });
    for (const who of [t, stranger]) {
      await expect(who.query(api.communityTimelines.listForAdmin, {})).rejects.toThrow();
      await expect(who.mutation(api.communityTimelines.approve, { id: row!._id })).rejects.toThrow();
      await expect(who.mutation(api.communityTimelines.decline, { id: row!._id, reason: "spam" })).rejects.toThrow();
      await expect(who.mutation(api.communityTimelines.keepEdit, { id: row!._id })).rejects.toThrow();
      await expect(who.mutation(api.communityTimelines.hideByAdmin, { id: row!._id, hidden: true })).rejects.toThrow();
      await expect(who.mutation(api.communityTimelines.removeByAdmin, { id: row!._id })).rejects.toThrow();
    }
    expect((await rows(t))[0]).toMatchObject({ status: "pending" });
  });

  it("the admin list shows what to check, with the office by name", async () => {
    const t = createTestContext();
    await t.mutation(internal.communityTimelines.save, bare(1, { greenCardOn: "2025-05-09", biometricsOn: null }));
    const admin = await adminAuth(t);
    const list = await admin.query(api.communityTimelines.listForAdmin, {});
    expect(list.waiting).toHaveLength(1);
    expect(list.waiting[0]).toMatchObject({ office: "Hartford", status: "pending", shared: true, caseNumber: null });
    expect(list.waiting[0]!.flags.join(" ")).toMatch(/8 days after the I-485 filing/);
  });

  it("is told once a day however many arrive, by one email that names no case", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SECURITY_ALERT_EMAIL", ADMIN);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const t = createTestContext();
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.communityTimelines.save, { ...bare(i, { category: "eb2" }), caseNumber: `G-100-25324-${300000 + i}` });
    }
    const notices = await t.run((ctx) =>
      ctx.db
        .query("rateLimits")
        .take(1000)
        .then((all) => all.filter((r) => r.action === "timeline_notice")),
    );
    expect(notices).toHaveLength(1);
    const waiting = await t.query(internal.communityTimelines.waitingForOwner, {});
    expect(waiting).toHaveLength(3);
    expect(JSON.stringify(waiting)).not.toMatch(/G-100-25324/);
    expect(waiting[0]!.line).toMatch(/Hartford/);
  });

  it("a decision refreshes the timelines page and that office's page", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "s3cret");
    const t = createTestContext();
    await t.action(internal.communityTimelines.refreshPages, { offices: [HFD] });
    const call = posted.find((p) => p.url.endsWith("/api/revalidate-timelines"));
    expect(call).toBeDefined();
    expect(JSON.parse(call!.body)).toEqual({ offices: [HFD] });
  });

  it("a refresh the site refuses is tried again, then recorded", async () => {
    vi.useFakeTimers();
    vi.stubEnv("REVALIDATE_SECRET", "s3cret");
    global.fetch = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    const t = createTestContext();
    await t.action(internal.communityTimelines.refreshPages, { offices: [] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const errors = await t.run((ctx) => ctx.db.query("systemErrors").take(100));
    expect(errors.some((e) => JSON.stringify(e).includes("communityTimelines.refreshPages"))).toBe(true);
  });
});

describe("the HTTP layer, with no case number", () => {
  it("saves, reads back and removes a timeline by its key", async () => {
    const t = createTestContext();
    const post = (path: string, body: unknown) =>
      t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const k = "c".repeat(64);
    const ok = await post("/timeline/save", { key: k, fieldOffice: HFD, i485FiledOn: "2025-05-01", biometricsOn: "2025-06-10" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, status: "pending" });
    const mine = (await (await post("/timeline/mine", { key: k })).json()) as { mine: { status: string; input: { fieldOffice: string } } };
    expect(mine.mine).toMatchObject({ status: "pending", input: { fieldOffice: HFD } });
    expect((await post("/timeline/save", { key: k, caseNumber: 7, i485FiledOn: "2025-05-01" })).status).toBe(400);
    expect((await post("/timeline/remove", { key: k })).status).toBe(200);
    expect(await rows(t)).toHaveLength(0);
  });
});

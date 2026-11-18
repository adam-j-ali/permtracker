import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settleScheduled, trackedTestContext as createTestContext } from "../../test-utils/convexSettle";
import { api, internal } from "../_generated/api";
import { BOARD_OPENS_AT, RECENT_MIN } from "../lib/communityTimeline";
import { easternDay } from "../lib/time";

/**
 * Whose case a timeline follows, saved, read back and shown on its row; and the board's count of approvals reported
 * in the week through the day the page passes, held below RECENT_MIN.
 */

type T = ReturnType<typeof createTestContext>;

const ADMIN = "admin@applicant-test.com";
const key = (i: number) => i.toString(16).padStart(64, "0");
const ip = (i: number) => (i + 4096).toString(16).padStart(64, "0");
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

const rows = (t: T) => t.run((ctx) => ctx.db.query("communityTimelines").take(1000));

async function saveApproved(t: T, inputs: Record<string, unknown>[]) {
  for (const [i, input] of inputs.entries()) {
    const r = await t.mutation(internal.communityTimelines.save, {
      editKeyHash: key(i),
      ipHash: ip(i),
      input: { i485FiledOn: "2026-04-14", i485Center: "SSC", category: "eb3", public: true, ...input },
    });
    expect(r.ok, r.message).toBe(true);
  }
  const id = await t.run(async (ctx) => ctx.db.insert("users", { email: ADMIN }));
  const admin = t.withIdentity({ subject: id, email: ADMIN });
  for (const r of await rows(t)) await admin.mutation(api.communityTimelines.approve, { id: r._id });
  return admin;
}

describe("whose case a timeline follows", () => {
  it("is saved, read back by its key, refused when it isn't on the list, and cleared when an edit leaves it out", async () => {
    const t = createTestContext();
    await saveApproved(t, [{ applicant: "dependent" }]);
    const [row] = await rows(t);
    expect(row).toMatchObject({ applicant: "dependent" });
    const mine = await t.query(internal.communityTimelines.mine, { editKeyHash: key(0) });
    expect(mine?.input).toMatchObject({ applicant: "dependent" });
    const bad = await t.mutation(internal.communityTimelines.save, {
      editKeyHash: key(9),
      ipHash: ip(9),
      input: { i485FiledOn: "2026-04-14", applicant: "spouse" },
    });
    expect(bad.ok).toBe(false);
    await t.mutation(internal.communityTimelines.save, { editKeyHash: key(0), ipHash: ip(0), input: { i485FiledOn: "2026-04-14" } });
    const [after] = await rows(t);
    expect("applicant" in after!).toBe(false);
  });

  it("shows on the owner's list and on the board's rows once the board opens", async () => {
    const t = createTestContext();
    const admin = await saveApproved(
      t,
      Array.from({ length: BOARD_OPENS_AT }, (_, i) => ({ applicant: i === 0 ? "dependent" : "principal" })),
    );
    const list = await admin.query(api.communityTimelines.listForAdmin, {});
    expect(list.decided.map((r) => r.applicant)).toContain("A spouse or child (a dependent)");
    const board = await t.query(api.communityTimelines.board, {});
    expect(board.rows.map((r) => r.applicant)).toContain("dependent");
  });
});

describe("approvals reported this week", () => {
  // The week ends on the real Eastern day, so the dates are built back from it.
  const today = easternDay(Date.now());
  const back = (n: number) => easternDay(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000);

  it("counts the days inside the week through today, and holds a step below the floor", async () => {
    const t = createTestContext();
    await saveApproved(t, [
      ...Array.from({ length: RECENT_MIN }, (_, i) => ({ i485FiledOn: back(300), eadOn: back(i) })),
      { i485FiledOn: back(300), eadOn: back(20) },
      { i485FiledOn: back(300), apOn: back(1) },
    ]);
    const board = await t.query(api.communityTimelines.board, { today });
    expect(board.recent).toMatchObject({ from: back(6), through: today });
    const by = Object.fromEntries(board.recent!.steps.map((s) => [s.id, s.count]));
    expect(by.eadOn).toBe(RECENT_MIN);
    expect(by.apOn).toBeNull();
  });

  it("is null without a day, and any day but today or yesterday gets today's week", async () => {
    const t = createTestContext();
    expect((await t.query(api.communityTimelines.board, {})).recent).toBeNull();
    expect((await t.query(api.communityTimelines.board, { today: "yesterday" })).recent).toMatchObject({ through: today });
    expect((await t.query(api.communityTimelines.board, { today: "2026-03-05" })).recent).toMatchObject({ through: today });
  });
});

describe("the details and what people did", () => {
  it("are saved, read back, counted on the board, and never dated on a row", async () => {
    const t = createTestContext();
    await saveApproved(
      t,
      Array.from({ length: BOARD_OPENS_AT }, (_, i) => ({
        interview: i < 6 ? "waived" : "held",
        greenCardOn: "2026-09-01",
        cardArrivedOn: "2026-09-15",
        officeMovedOn: "2026-05-02",
        contacts: [{ on: "2026-07-01", kind: "congressional" }],
      })),
    );
    const [row] = await rows(t);
    expect(row).toMatchObject({ interview: expect.any(String), cardArrivedOn: "2026-09-15", contacts: [{ on: "2026-07-01", kind: "congressional" }] });
    const mine = await t.query(internal.communityTimelines.mine, { editKeyHash: key(0) });
    expect(mine?.input.contacts).toEqual([{ on: "2026-07-01", kind: "congressional" }]);
    const board = await t.query(api.communityTimelines.board, {});
    expect(board.interviews).toEqual({ answered: BOARD_OPENS_AT, waived: 6 });
    expect(board.contacts.find((c) => c.kind === "congressional")).toMatchObject({ reported: BOARD_OPENS_AT, withCard: BOARD_OPENS_AT, medianToCard: 62 });
    expect(board.rows[0]!.contacts).toEqual({ count: 1, kinds: ["congressional"] });
    expect(JSON.stringify(board.rows)).not.toContain("2026-07-01");
  });
});

describe("more than one RFE", () => {
  it("are saved, read back, counted and listed on a row", async () => {
    const t = createTestContext();
    await saveApproved(
      t,
      Array.from({ length: BOARD_OPENS_AT }, () => ({
        rfeForm: "i140",
        rfeIssuedOn: "2026-06-25",
        rfeRespondedOn: "2026-08-19",
        rfeOutcome: "approved",
        i140ApprovedOn: "2026-08-25",
        moreRfes: [{ form: "i485", issuedOn: "2026-10-26", respondedOn: "2026-10-30", outcome: "approved" }],
        greenCardOn: "2026-11-17",
      })),
    );
    const mine = await t.query(internal.communityTimelines.mine, { editKeyHash: key(0) });
    expect(mine?.input.moreRfes).toEqual([{ form: "i485", issuedOn: "2026-10-26", respondedOn: "2026-10-30", outcome: "approved" }]);
    const board = await t.query(api.communityTimelines.board, {});
    expect(board.rfe.total).toBe(2 * BOARD_OPENS_AT);
    expect(board.rows[0]!.rfes.map((e) => e.form)).toEqual(["i140", "i485"]);
    expect(board.metrics.find((m) => m.id === "rfe-decision")).toMatchObject({ n: BOARD_OPENS_AT });
  });
});

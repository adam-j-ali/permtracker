/**
 * The USCIS receipt tracking beta (convex/uscisAlerts.ts): the sign-up, the confirm and stop pages, the checker's
 * two routes as their contract states them, and every edge case the plan names. Most go through the HTTP routes,
 * because the routes are what a person, a mail scanner and the checker actually touch.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settleScheduled, trackedTestContext as createTestContext } from "../../test-utils/convexSettle";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { BUDGETS } from "../lib/alertBudgets";
import { makeUnsubscribeToken } from "../lib/unsubscribeToken";
import { MAX_RECEIPTS_PER_ADDRESS, WATCH_AFTER_FINAL_MS, WATCHED_RECEIPTS_CAP } from "../lib/uscisWatch";
import { addWatcher } from "../lib/uscisWatchStore";
import { FULL_REPLY } from "../uscisAlerts";

type T = ReturnType<typeof createTestContext>;

const UNSUB = "test-unsubscribe-secret";
const CHECKER = "checker-secret-0123456789abcdef";
const A = "IOE0900000101";
const B = "IOE0900000202";
const C = "EAC2600000303";
const PERSON = "person@example.com";
const OTHER = "other@example.com";
const HOUR = 60 * 60 * 1000;
const originalFetch = global.fetch;

/** Every email the code under test asked Resend to send. */
let sends: Record<string, unknown>[] = [];

function stubResend() {
  sends = [];
  global.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sends.push(init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {});
    return new Response(JSON.stringify({ id: "stub" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

const confirmations = () => sends.filter((s) => String(s.subject).startsWith("Confirm alerts for"));
const alerts = () => sends.filter((s) => String(s.subject).startsWith("USCIS updated"));
const to = (s: Record<string, unknown>) => (Array.isArray(s.to) ? s.to[0] : s.to) as string;

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", UNSUB);
  vi.stubEnv("WATCHED_CASES_SECRET", CHECKER);
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("BLOCKED_EMAILS", "");
  stubResend();
});

afterEach(async () => {
  await settleScheduled();
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function signUp(t: T, email: string, receipt: string, extra: Record<string, unknown> = {}) {
  return await t.fetch("/uscis-alert/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://permtracker.app" },
    body: JSON.stringify({ email, receipt, source: "test", ...extra }),
  });
}

const confirmToken = (email: string) => makeUnsubscribeToken(email, UNSUB, "uscis-confirm");
const stopToken = (email: string) => makeUnsubscribeToken(email, UNSUB, "uscis-unsubscribe");

async function confirm(t: T, email: string, method: "GET" | "POST" = "POST") {
  return await t.fetch(`/uscis-alert/confirm?token=${encodeURIComponent(await confirmToken(email))}`, { method });
}

/** One result as the checker sends it. */
function result(receipt: string, status: string, group = "waiting", at = Date.now(), form: string | null = "I-485") {
  return { receipt, status, group, form, checkedAt: new Date(at).toISOString() };
}

async function post(t: T, results: unknown[], secret = CHECKER) {
  return await t.fetch("/uscis-watched/results", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  });
}

async function list(t: T, secret: string | null = CHECKER) {
  return await t.fetch("/uscis-watched", secret === null ? {} : { headers: { Authorization: `Bearer ${secret}` } });
}

/** A confirmed watch, written straight in, its receipt counted the way a confirm counts it. */
async function seedWatch(t: T, email: string, receipt: string, lastAlertedStatus?: string): Promise<Id<"uscisWatches">> {
  return await t.run(async (ctx) => {
    const held = await addWatcher(ctx, receipt);
    return await ctx.db.insert("uscisWatches", {
      email,
      receipt,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
      lastAlertedStatus: lastAlertedStatus ?? held?.status,
    });
  });
}

const watches = (t: T) => t.run(async (ctx) => await ctx.db.query("uscisWatches").collect());
const receipts = (t: T) => t.run(async (ctx) => await ctx.db.query("uscisReceipts").collect());
const meta = (t: T) => t.run(async (ctx) => await ctx.db.query("uscisWatchMeta").first());

/** Run everything the code scheduled, the five-minute wait before an alert included. */
const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

// ============================================================================
// The checker's two routes: the contract
// ============================================================================

describe("GET /uscis-watched", () => {
  it("is off, not open, when the deployment has no secret", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", "");
    const t = createTestContext();
    expect((await list(t, "anything")).status).toBe(503);
    expect((await post(t, [], "anything")).status).toBe(503);
  });

  it("refuses a missing, wrong or differently sent secret with 401, and says nothing", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    expect((await list(t, null)).status).toBe(401);
    const wrong = await list(t, `${CHECKER}x`);
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain(A);
    // The /watched-cases header isn't this contract's, and a bare secret isn't a Bearer one.
    expect((await t.fetch("/uscis-watched", { headers: { "x-watched-secret": CHECKER } })).status).toBe(401);
    expect((await t.fetch("/uscis-watched", { headers: { Authorization: CHECKER } })).status).toBe(401);
  });

  it("hands over every confirmed receipt, upper-cased, once each, and nothing about who watches", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    await seedWatch(t, OTHER, A);
    await seedWatch(t, OTHER, C);
    // Unconfirmed: never handed over.
    await t.run(async (ctx) => {
      await ctx.db.insert("uscisWatches", { email: "new@example.com", receipt: B, createdAt: Date.now() });
    });
    const res = await list(t);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ receipts: [C, A].sort(), capped: false });
    expect(body).not.toContain("@");
  });

  it(`stops at ${WATCHED_RECEIPTS_CAP} receipts and says it's capped`, async () => {
    const t = createTestContext();
    await t.run(async (ctx) => {
      for (let i = 0; i <= WATCHED_RECEIPTS_CAP; i++) {
        await ctx.db.insert("uscisReceipts", { receipt: `IOE${String(i).padStart(10, "0")}`, watchers: 1 });
      }
    });
    const body = (await (await list(t)).json()) as { receipts: string[]; capped: boolean };
    expect(body.capped).toBe(true);
    expect(body.receipts).toHaveLength(WATCHED_RECEIPTS_CAP);
    expect(new Set(body.receipts).size).toBe(WATCHED_RECEIPTS_CAP);
  });

  it("takes a rotated secret at once: the old one is refused, the new one works", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    expect((await list(t, CHECKER)).status).toBe(200);
    vi.stubEnv("WATCHED_CASES_SECRET", "rotated-secret-9876543210");
    expect((await list(t, CHECKER)).status).toBe(401);
    expect((await post(t, [result(A, "Case Was Received")], CHECKER)).status).toBe(401);
    expect((await list(t, "rotated-secret-9876543210")).status).toBe(200);
  });
});

describe("POST /uscis-watched/results", () => {
  it("records the newest status, answers a count only, and ignores a receipt nobody watches", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    const res = await post(t, [result(A, "Case Was Received"), result(B, "Case Was Approved", "approved")]);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ recorded: 1 });
    expect(body).not.toContain("@");
    const held = await receipts(t);
    expect(held.map((r) => [r.receipt, r.status, r.group, r.form])).toEqual([[A, "Case Was Received", "waiting", "I-485"]]);
  });

  it("refuses a bad field with 400, naming the place and the field, and records nothing", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    const bad = [
      { ...result(A, "Case Was Received"), group: "pending" },
      { ...result(A, "Case Was Received"), receipt: "IOE*09000001" },
      { ...result(A, "x".repeat(201)) },
      { ...result(A, "Case Was Received"), checkedAt: "2026-11-24 04:00" },
      { ...result(A, "Case Was Received"), checkedAt: new Date(Date.now() + 2 * HOUR).toISOString() },
      { ...result(A, "Case Was Received"), form: "Form I-485 for adjustment" },
      { ...result(A, "") },
    ];
    for (const item of bad) {
      const res = await post(t, [result(A, "Case Was Received"), item]);
      expect(res.status, JSON.stringify(item).slice(0, 80)).toBe(400);
      expect(((await res.json()) as { message: string }).message).toMatch(/^results\[1\]\./);
    }
    expect((await receipts(t))[0]?.status).toBeUndefined();
  });

  it("refuses more than 500 results a call, and a body past its length cap before parsing it", async () => {
    const t = createTestContext();
    const many = Array.from({ length: 501 }, () => result(A, "Case Was Received"));
    expect((await post(t, many)).status).toBe(400);
    const huge = await t.fetch("/uscis-watched/results", {
      method: "POST",
      headers: { Authorization: `Bearer ${CHECKER}` },
      body: `{"results":[${"1,".repeat(250_000)}1]}`,
    });
    expect(huge.status).toBe(413);
    const broken = await t.fetch("/uscis-watched/results", { method: "POST", headers: { Authorization: `Bearer ${CHECKER}` }, body: "{" });
    expect(broken.status).toBe(400);
  });

  it("takes an offset other than Z, and keeps the newer of two crossing answers", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    const now = Date.now();
    await post(t, [result(A, "Fingerprint Fee Was Received", "waiting", now)]);
    // An older answer from a run that crossed this one.
    const older = await post(t, [result(A, "Case Was Received", "waiting", now - HOUR)]);
    expect(await older.json()).toEqual({ recorded: 0 });
    const offset = new Date(now).toISOString().replace("Z", "+00:00");
    const same = await post(t, [{ ...result(A, "Fingerprint Fee Was Received"), checkedAt: offset }]);
    expect(await same.json()).toEqual({ recorded: 1 });
    expect((await receipts(t))[0]?.status).toBe("Fingerprint Fee Was Received");
  });
});

// ============================================================================
// Sign-up, confirm, stop
// ============================================================================

describe("signing up", () => {
  beforeEach(() => vi.useFakeTimers());

  it("sends one confirmation naming the receipt, its office and the DOL case, and watches nothing yet", async () => {
    const t = createTestContext();
    const res = await signUp(t, " Person@Example.com ", "ioe-0900000101", { dolCaseNumber: "g-100-26125-868956" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Check your inbox to confirm." });
    await drain(t);
    const [mail] = confirmations();
    expect(confirmations()).toHaveLength(1);
    expect(to(mail!)).toBe(PERSON);
    expect(mail!.subject).toBe(`Confirm alerts for USCIS receipt ${A}`);
    expect(String(mail!.text)).toContain("USCIS online filing (ELIS)");
    expect(String(mail!.text)).toContain("G-100-26125-868956");
    expect(String(mail!.text)).toContain("/uscis-alert/confirm?token=");
    const [row] = await watches(t);
    expect(row).toMatchObject({ email: PERSON, receipt: A, dolCaseNumber: "G-100-26125-868956" });
    expect(row?.confirmedAt).toBeUndefined();
    expect(await (await list(t)).json()).toEqual({ receipts: [], capped: false });
  });

  it("refuses a malformed address, receipt or DOL number with 400, and a masked receipt too", async () => {
    const t = createTestContext();
    expect((await signUp(t, "not-an-address", A)).status).toBe(400);
    expect((await signUp(t, PERSON, "IOE*090000010")).status).toBe(400);
    expect((await signUp(t, PERSON, "EAC12")).status).toBe(400);
    expect((await signUp(t, PERSON, A, { dolCaseNumber: "G-100" })).status).toBe(400);
    expect((await signUp(t, PERSON, A, { dolCaseNumber: "" })).status).toBe(200);
  });

  it("answers an address already watching a receipt exactly as a new one, and sends nothing", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    const res = await signUp(t, PERSON, A);
    expect(await res.json()).toEqual({ ok: true, message: "Check your inbox to confirm." });
    await drain(t);
    expect(sends).toHaveLength(0);
  });

  it("holds receipts typed inside the ten minutes for one follow-up email naming them", async () => {
    const t = createTestContext();
    await signUp(t, PERSON, A);
    await confirm(t, PERSON);
    await signUp(t, PERSON, B);
    await signUp(t, PERSON, C);
    await drain(t);
    const mails = confirmations();
    expect(mails).toHaveLength(2);
    expect(mails[1]!.subject).toBe("Confirm alerts for 2 USCIS receipts");
    expect(String(mails[1]!.text)).toContain(B);
    expect(String(mails[1]!.text)).toContain(C);
  });

  it(`keeps one address to ${MAX_RECEIPTS_PER_ADDRESS} receipts, with the same reply past it`, async () => {
    const t = createTestContext();
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_RECEIPTS_PER_ADDRESS; i++) {
        await ctx.db.insert("uscisWatches", { email: PERSON, receipt: `IOE${String(i).padStart(10, "0")}`, createdAt: Date.now() });
      }
    });
    const res = await signUp(t, PERSON, A);
    expect(await res.json()).toEqual({ ok: true, message: "Check your inbox to confirm." });
    expect(await watches(t)).toHaveLength(MAX_RECEIPTS_PER_ADDRESS);
  });

  it("tells everyone the beta is full alike, whatever the receipt or the address, and sends nothing", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("uscisWatchMeta").first();
      await ctx.db.patch(m!._id, { receipts: WATCHED_RECEIPTS_CAP });
    });
    for (const [email, receipt] of [[OTHER, A], [OTHER, B], [PERSON, A]] as const) {
      const res = await signUp(t, email, receipt);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, message: FULL_REPLY });
    }
    await drain(t);
    expect(sends).toHaveLength(0);
  });

  it("queues the confirmation when its pool is spent, as a receipt sign-up the queue can replay", async () => {
    const t = createTestContext();
    await t.run(async (ctx) => {
      for (let i = 0; i < BUDGETS.uscisConfirm.limit; i++) {
        await ctx.db.insert("rateLimits", {
          key: `${BUDGETS.uscisConfirm.key}:all`,
          identifier: "all",
          action: BUDGETS.uscisConfirm.key,
          timestamp: Date.now() - i * 1000,
        });
      }
    });
    const res = await signUp(t, PERSON, A);
    expect(((await res.json()) as { queued?: boolean }).queued).toBe(true);
    const queued = await t.run(async (ctx) => await ctx.db.query("confirmationQueue").collect());
    expect(queued.map((q) => [q.kind, q.email])).toEqual([["uscis", PERSON]]);
    expect(await watches(t)).toHaveLength(0);
  });
});

describe("confirming", () => {
  beforeEach(() => vi.useFakeTimers());

  it("never confirms on a GET, so a mail scanner fetching the link changes nothing", async () => {
    const t = createTestContext();
    await signUp(t, PERSON, A);
    const page = await confirm(t, PERSON, "GET");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('method="POST"');
    expect(html).toContain("/uscis-alert/confirm?token=");
    expect((await watches(t))[0]?.confirmedAt).toBeUndefined();
    expect(await receipts(t)).toHaveLength(0);
  });

  it("confirms on the page's POST, counts the receipt, and lists it for the checker", async () => {
    const t = createTestContext();
    await signUp(t, PERSON, A);
    const res = await confirm(t, PERSON);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(A);
    expect((await watches(t))[0]?.confirmedAt).toBeTypeOf("number");
    expect((await receipts(t)).map((r) => [r.receipt, r.watchers])).toEqual([[A, 1]]);
    expect((await meta(t))?.receipts).toBe(1);
    expect(await (await list(t)).json()).toEqual({ receipts: [A], capped: false });
    // Clicked again: already on the list, nothing counted twice.
    expect(await (await confirm(t, PERSON)).text()).toContain("already on the list");
    expect((await receipts(t))[0]?.watchers).toBe(1);
  });

  it("refuses a forged token, and a stop link used as a confirm link", async () => {
    const t = createTestContext();
    await signUp(t, PERSON, A);
    const forged = (await confirmToken(PERSON)).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await t.fetch(`/uscis-alert/confirm?token=${encodeURIComponent(forged)}`, { method: "POST" })).status).toBe(400);
    const crossed = `/uscis-alert/confirm?token=${encodeURIComponent(await stopToken(PERSON))}`;
    expect((await t.fetch(crossed, { method: "POST" })).status).toBe(400);
    expect((await watches(t))[0]?.confirmedAt).toBeUndefined();
  });
});

describe("stopping", () => {
  beforeEach(() => vi.useFakeTimers());

  it("never stops on a GET, and the POST deletes every receipt of the address and only that address", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    await seedWatch(t, PERSON, B);
    await seedWatch(t, OTHER, A);
    const url = `/uscis-alert/unsubscribe?token=${encodeURIComponent(await stopToken(PERSON))}`;
    expect(await (await t.fetch(url)).text()).toContain('method="POST"');
    expect(await watches(t)).toHaveLength(3);
    expect((await t.fetch(url, { method: "POST" })).status).toBe(200);
    expect((await watches(t)).map((w) => w.email)).toEqual([OTHER]);
    // The other address still holds A; B, watched by nobody now, is gone with its status.
    expect((await receipts(t)).map((r) => [r.receipt, r.watchers])).toEqual([[A, 1]]);
    expect((await meta(t))?.receipts).toBe(1);
  });

  it("then a sign-up again needs a fresh request: the old confirm link is never consent", async () => {
    const t = createTestContext();
    await signUp(t, PERSON, A);
    await confirm(t, PERSON);
    await t.fetch(`/uscis-alert/unsubscribe?token=${encodeURIComponent(await stopToken(PERSON))}`, { method: "POST" });
    // The old link, replayed after the stop: nothing to confirm, nothing written.
    const replay = await confirm(t, PERSON);
    expect(replay.status).toBe(400);
    expect(await watches(t)).toHaveLength(0);
    // A new request, after the ten minutes, and its own click: watched again.
    vi.advanceTimersByTime(11 * 60 * 1000);
    await signUp(t, PERSON, A);
    expect((await watches(t))[0]?.confirmedAt).toBeUndefined();
    expect((await confirm(t, PERSON)).status).toBe(200);
    expect((await watches(t))[0]?.confirmedAt).toBeTypeOf("number");
    await drain(t);
    expect(confirmations()).toHaveLength(2);
  });

  it("goes with the account: deleting it deletes its address's watches and nobody else's", async () => {
    const t = createTestContext();
    const userId = await t.run(
      async (ctx) => await ctx.db.insert("users", { email: "Person@Example.com", deletedAt: Date.now() - 24 * HOUR }),
    );
    await seedWatch(t, PERSON, A);
    await seedWatch(t, OTHER, B);
    await t.run(async (ctx) => {
      await ctx.db.insert("uscisWatches", { email: PERSON, receipt: C, createdAt: Date.now() });
    });
    await t.action(internal.accountDeletion.cleanupAndPurge, { userId });
    expect((await watches(t)).map((w) => w.email)).toEqual([OTHER]);
    expect((await receipts(t)).map((r) => r.receipt)).toEqual([B]);
  });

  it("turns one receipt off from the preference page, and leaves the rest", async () => {
    const t = createTestContext();
    const a = await seedWatch(t, PERSON, A);
    await seedWatch(t, PERSON, B);
    const token = await makeUnsubscribeToken(PERSON, UNSUB, "prefs");
    const state = await t.mutation(internal.emailPrefs.disableByToken, { token, kind: "uscis", id: a });
    expect(state?.uscisAlerts.map((w) => w.receipt)).toEqual([B]);
    expect((await receipts(t)).map((r) => r.receipt)).toEqual([B]);
  });

  it("deletes a sign-up nobody confirmed after 30 days, and keeps a confirmed one", async () => {
    const t = createTestContext();
    const old = Date.now() - 31 * 24 * HOUR;
    await t.run(async (ctx) => {
      await ctx.db.insert("uscisWatches", { email: PERSON, receipt: A, createdAt: old });
      await ctx.db.insert("uscisWatches", { email: OTHER, receipt: B, createdAt: Date.now() - 2 * 24 * HOUR });
    });
    const kept = await seedWatch(t, PERSON, C);
    await t.run(async (ctx) => {
      await ctx.db.patch(kept, { createdAt: old });
    });
    expect(await t.mutation(internal.uscisAlerts.expireUnconfirmed, {})).toEqual({ deleted: 1 });
    expect((await watches(t)).map((w) => w.receipt).sort()).toEqual([B, C].sort());
  });
});

// ============================================================================
// The change detector and the emails
// ============================================================================

describe("the alerts", () => {
  beforeEach(() => vi.useFakeTimers());

  it("send nothing for the first status, then one email when it changes, dated by the check", async () => {
    const checked = Date.UTC(2026, 10, 24, 9, 12); // 4:12 AM Eastern
    vi.setSystemTime(checked - 6 * HOUR);
    const t = createTestContext();
    await signUp(t, PERSON, A);
    await confirm(t, PERSON);
    await drain(t);
    await post(t, [result(A, "Case Was Received")]);
    await drain(t);
    expect(alerts()).toHaveLength(0);
    expect((await watches(t))[0]?.lastAlertedStatus).toBe("Case Was Received");

    vi.setSystemTime(checked + 60_000);
    await post(t, [result(A, "Case Was Approved", "approved", checked)]);
    await drain(t);
    const [mail] = alerts();
    expect(alerts()).toHaveLength(1);
    expect(to(mail!)).toBe(PERSON);
    expect(mail!.subject).toBe(`USCIS updated ${A}: Case Was Approved`);
    const text = String(mail!.text);
    expect(text).toContain("Was: Case Was Received");
    expect(text).toContain("Now: Case Was Approved");
    expect(text).toContain("when we checked, at 4:12 AM ET");
    expect(text).not.toMatch(/no change/i);
    expect(text).toContain(`/uscis-case-status?receipt=${A}`);
    expect(text).toContain("/uscis-receipt-blocks/IOE09000");
    expect(String(mail!.html)).toContain("Stop these alerts");
    const headers = mail!.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toMatch(/\/uscis-alert\/unsubscribe\?token=/);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const [w] = await watches(t);
    expect(w).toMatchObject({ lastAlertedStatus: "Case Was Approved" });
    expect(w?.alertDue).toBeUndefined();
  });

  it("put every receipt of one address that moved in the same run into one email", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    await seedWatch(t, PERSON, C);
    await post(t, [result(A, "Case Was Received"), result(C, "Case Was Received")]);
    // The checker's run, in two posts a minute apart.
    await post(t, [result(A, "Fingerprint Fee Was Received")]);
    vi.advanceTimersByTime(60_000);
    await post(t, [result(C, "Case Is Being Actively Reviewed By USCIS")]);
    await drain(t);
    expect(alerts()).toHaveLength(1);
    const [mail] = alerts();
    expect(mail!.subject).toBe("USCIS updated 2 of your receipts");
    expect(String(mail!.text)).toContain(A);
    expect(String(mail!.text)).toContain(C);
    // The DOL case link only where one was given.
    expect(String(mail!.text)).not.toContain("Your PERM case");
  });

  it("keep one status for a receipt two addresses watch, and email each of them", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    await seedWatch(t, OTHER, A);
    expect((await receipts(t)).map((r) => r.watchers)).toEqual([2]);
    await post(t, [result(A, "Case Was Received")]);
    await post(t, [result(A, "Case Was Approved", "approved")]);
    await drain(t);
    expect(alerts().map(to).sort()).toEqual([OTHER, PERSON].sort());
    expect(await receipts(t)).toHaveLength(1);
    expect(await (await list(t)).json()).toEqual({ receipts: [A], capped: false });
  });

  it("record a receipt USCIS can't find without an email, and keep the last status found", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    // Not found from the start: no baseline yet, so the first status found is the baseline.
    await post(t, [result(A, "", "none", Date.now(), null)]);
    expect((await receipts(t))[0]).toMatchObject({ notFound: true });
    expect((await receipts(t))[0]?.status).toBeUndefined();
    await post(t, [result(A, "Case Was Received")]);
    await drain(t);
    expect(alerts()).toHaveLength(0);
    // Found, then not found, then found as before: nobody is told anything.
    await post(t, [result(A, "Case Not Found", "none")]);
    await post(t, [result(A, "Case Was Received")]);
    await drain(t);
    expect(alerts()).toHaveLength(0);
    expect((await receipts(t))[0]).toMatchObject({ status: "Case Was Received" });
    expect((await receipts(t))[0]?.notFound).toBeUndefined();
  });

  it("owe nothing for a status that flips back before the email goes, and email when it flips back after", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A, "Case Was Received");
    await post(t, [result(A, "Request for Evidence Was Sent", "rfe")]);
    await post(t, [result(A, "Case Was Received")]);
    await drain(t);
    expect(alerts()).toHaveLength(0);

    await post(t, [result(A, "Request for Evidence Was Sent", "rfe")]);
    await drain(t);
    expect(alerts()).toHaveLength(1);
    // Back again, past the receipt's one-hour gap: the person was told the first move, so this one is news too.
    vi.advanceTimersByTime(2 * HOUR);
    await post(t, [result(A, "Case Was Received")]);
    await drain(t);
    expect(alerts()).toHaveLength(2);
    expect(String(alerts()[1]!.text)).toContain("Was: Request for Evidence Was Sent");
  });

  it("wait while the alert pool is spent, and go when it has room: queued, never dropped", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A, "Case Was Received");
    await t.run(async (ctx) => {
      for (let i = 0; i < BUDGETS.uscisAlert.limit; i++) {
        await ctx.db.insert("rateLimits", {
          key: `${BUDGETS.uscisAlert.key}:all`,
          identifier: "all",
          action: BUDGETS.uscisAlert.key,
          timestamp: Date.now() - i * 1000,
        });
      }
    });
    await post(t, [result(A, "Case Was Approved", "approved")]);
    await drain(t);
    expect(alerts()).toHaveLength(0);
    expect((await watches(t))[0]?.alertDue).toBe(true);
    // A day on the pool has room; the retry run sends what waited.
    vi.advanceTimersByTime(25 * HOUR);
    expect(await t.mutation(internal.uscisAlerts.sendDue, {})).toEqual({ addresses: 1 });
    await drain(t);
    expect(alerts()).toHaveLength(1);
    expect((await watches(t))[0]?.alertDue).toBeUndefined();
  });

  it("leave the watch owed when a send fails, and send it on the next run", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A, "Case Was Received");
    global.fetch = (async () =>
      new Response(JSON.stringify({ name: "validation_error", message: "stubbed" }), { status: 422 })) as unknown as typeof fetch;
    await post(t, [result(A, "Case Was Approved", "approved")]);
    await drain(t);
    const [w] = await watches(t);
    expect(w?.lastAlertedStatus).toBe("Case Was Received");
    expect(w?.alertDue).toBe(true);
    expect(w?.sendingAt).toBeUndefined();
    stubResend();
    await t.mutation(internal.uscisAlerts.sendDue, {});
    await drain(t);
    expect(alerts()).toHaveLength(1);
  });

  it("keep watching a year after a final status, then end the watch", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A, "Case Was Approved");
    await post(t, [result(A, "Case Was Approved", "approved")]);
    expect((await receipts(t))[0]?.finalSince).toBeTypeOf("number");
    vi.advanceTimersByTime(WATCH_AFTER_FINAL_MS - 24 * HOUR);
    await post(t, [result(A, "Case Was Approved", "approved")]);
    expect(await watches(t)).toHaveLength(1);
    vi.advanceTimersByTime(2 * 24 * HOUR);
    await post(t, [result(A, "Case Was Approved", "approved")]);
    expect(await watches(t)).toHaveLength(0);
    expect(await receipts(t)).toHaveLength(0);
    expect(await (await list(t)).json()).toEqual({ receipts: [], capped: false });
  });

  it("start the year again when a final status moves on", async () => {
    const t = createTestContext();
    await seedWatch(t, PERSON, A, "Case Was Denied");
    await post(t, [result(A, "Case Was Denied", "denied")]);
    vi.advanceTimersByTime(300 * 24 * HOUR);
    await post(t, [result(A, "Case Was Reopened", "other")]);
    await drain(t);
    expect(alerts()).toHaveLength(1);
    expect((await receipts(t))[0]?.finalSince).toBeUndefined();
    vi.advanceTimersByTime(200 * 24 * HOUR);
    await post(t, [result(A, "Case Was Reopened", "other")]);
    expect(await watches(t)).toHaveLength(1);
  });

  it("say on the preference page when the checker last looked, never that nothing changed", async () => {
    const checked = Date.UTC(2026, 10, 22, 21, 5); // Nov 22, 4:05 PM Eastern
    vi.setSystemTime(checked - HOUR);
    const t = createTestContext();
    await seedWatch(t, PERSON, A);
    const token = await makeUnsubscribeToken(PERSON, UNSUB, "prefs");
    const before = await t.mutation(internal.emailPrefs.stateByToken, { token });
    expect(before?.uscisAlerts[0]).toMatchObject({ receipt: A, checkedAt: null, status: null });
    expect(await (await t.fetch(`/prefs?token=${encodeURIComponent(token)}`)).text()).toContain("Not checked yet.");

    vi.setSystemTime(checked + 60_000);
    await post(t, [result(A, "Case Was Received", "waiting", checked)]);
    // The checker then goes quiet for two days: the page still says when it last looked.
    vi.advanceTimersByTime(48 * HOUR);
    const page = await (await t.fetch(`/prefs?token=${encodeURIComponent(token)}`)).text();
    expect(page).toContain("when we checked, at 4:05 PM ET, Nov 22");
    expect(page).not.toMatch(/no change/i);
  });
});

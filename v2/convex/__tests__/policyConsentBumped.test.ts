/**
 * Active consent after a policy change: the version moved past the baseline here (it equals the baseline today, and
 * policyConsent.test.ts holds that side). What must hold: an account is asked until it accepts this version; the
 * emailed link's GET page writes nothing and its POST records once, refusing a forged token and a burst; the
 * hand-run sweep mails each live subscriber without an account once, charging its pool before each send, and waits
 * at the pool's end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/policyConsent", async (orig) => ({ ...(await orig<typeof import("../lib/policyConsent")>()), POLICY_CONSENT_VERSION: "2027-02-01" }));

const { settleScheduled, trackedTestContext } = await import("../../test-utils/convexSettle");
const { createAuthenticatedContext } = await import("../../test-utils/convex");
const { api, internal } = await import("../_generated/api");
const { BUDGETS } = await import("../lib/alertBudgets");
const { POLICY_ACCEPT_IP_LIMIT, policyAcceptPurpose } = await import("../lib/policyConsent");
const { makeUnsubscribeToken } = await import("../lib/unsubscribeToken");
const { raterKeyFor } = await import("../siteReviews");

const SECRET = "test-unsubscribe-secret";
const V = "2027-02-01";
const originalFetch = global.fetch;
let resendSends = 0;

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("BLOCKED_EMAILS", "");
  resendSends = 0;
  global.fetch = (async (url: unknown) => {
    if (String(url).includes("api.resend.com")) {
      resendSends += 1;
      return new Response(JSON.stringify({ id: `email-${resendSends}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(async () => {
  await settleScheduled();
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof trackedTestContext>;

async function subscribe(t: T, table: "caseStatusAlerts" | "bulletinAlerts", email: string, over: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    if (table === "caseStatusAlerts") {
      await ctx.db.insert("caseStatusAlerts", { email, caseNumber: "G-100-26125-868956", createdAt: 1, confirmedAt: 2, ...over } as never);
    } else {
      await ctx.db.insert("bulletinAlerts", { email, category: "EB2", country: "india", createdAt: 1, confirmedAt: 2, ...over } as never);
    }
  });
}

const charges = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("rateLimits").collect()).filter((r) => r.action === BUDGETS.policyNotice.key).length);
const consentRows = (t: T) => t.run(async (ctx) => await ctx.db.query("policyConsents").collect());

describe("an account, after a change that needs consent", () => {
  it("is asked until it accepts this version, and accepting an older text does nothing", async () => {
    const t = trackedTestContext();
    const user = await createAuthenticatedContext(t);
    expect(await user.query(api.policyConsent.myStatus, {})).toEqual({ needed: true, version: V });
    expect(await user.mutation(api.policyConsent.accept, { version: "2026-11-18" })).toEqual({ ok: false });
    expect((await user.query(api.policyConsent.myStatus, {}))?.needed).toBe(true);
    expect(await user.mutation(api.policyConsent.accept, { version: V })).toEqual({ ok: true });
    expect((await user.query(api.policyConsent.myStatus, {}))?.needed).toBe(false);
    const row = await t.run(async (ctx) => await ctx.db.get("users", user.userId));
    expect(row?.policyAcceptedVersion).toBe(V);
    expect(typeof row?.policyAcceptedAt).toBe("number");
  });

  it("needs a signed-in account to accept, and answers nothing about nobody", async () => {
    const t = trackedTestContext();
    await expect(t.mutation(api.policyConsent.accept, { version: V })).rejects.toThrow(/not authenticated/);
    expect(await t.query(api.policyConsent.myStatus, {})).toBeNull();
  });
});

describe("the emailed accept link", () => {
  it("shows the change on GET and records nothing; the POST records once", async () => {
    const t = trackedTestContext();
    const token = await makeUnsubscribeToken("Sub@Example.com", SECRET, policyAcceptPurpose(V));
    const path = `/prefs/policy?token=${encodeURIComponent(token)}&v=${V}`;
    const page = await t.fetch(path, { method: "GET" });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Accept the updated policy?");
    expect(html).toContain('method="POST"');
    expect(await consentRows(t)).toHaveLength(0);

    const first = await t.fetch(path, { method: "POST" });
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Accepted");
    const again = await t.fetch(path, { method: "POST" });
    expect(await again.text()).toContain("Already accepted");
    const rows = await consentRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: await raterKeyFor("sub@example.com"), version: V });
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });

  it("refuses a forged token, another purpose's token, an old version's and a missing version", async () => {
    const t = trackedTestContext();
    const prefs = await makeUnsubscribeToken("sub@example.com", SECRET, "prefs");
    const old = await makeUnsubscribeToken("sub@example.com", SECRET, policyAcceptPurpose("2026-11-18"));
    expect((await t.fetch(`/prefs/policy?token=forged.sig&v=${V}`, { method: "POST" })).status).toBe(400);
    expect((await t.fetch(`/prefs/policy?token=${encodeURIComponent(prefs)}&v=${V}`, { method: "POST" })).status).toBe(400);
    expect((await t.fetch(`/prefs/policy?token=${encodeURIComponent(prefs)}`, { method: "GET" })).status).toBe(400);
    const stale = await t.fetch(`/prefs/policy?token=${encodeURIComponent(old)}&v=2026-11-18`, { method: "POST" });
    expect(await stale.text()).toContain("earlier version");
    expect(await consentRows(t)).toHaveLength(0);
  });

  it("answers a burst from one caller with 429", async () => {
    const t = trackedTestContext();
    const headers = { "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9" };
    let last = 0;
    for (let i = 0; i <= POLICY_ACCEPT_IP_LIMIT.limit; i++) {
      last = (await t.fetch(`/prefs/policy?token=forged.sig&v=${V}`, { method: "POST", headers })).status;
    }
    expect(last).toBe(429);
  });
});

describe("the change email, run by hand", () => {
  it("mails each live subscriber without an account once, and charges the pool before each send", async () => {
    const t = trackedTestContext();
    await subscribe(t, "caseStatusAlerts", "one@example.com");
    await subscribe(t, "bulletinAlerts", "one@example.com");
    await subscribe(t, "caseStatusAlerts", "two@example.com");
    await subscribe(t, "caseStatusAlerts", "pending@example.com", { confirmedAt: undefined });
    await subscribe(t, "caseStatusAlerts", "gone@example.com", { unsubscribedAt: 3 });
    await subscribe(t, "caseStatusAlerts", "member@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: "member@example.com" });
    });

    const caseStep = await t.mutation(internal.policyConsent.noticeBatch, { version: V, table: "caseStatusAlerts", cursor: null });
    expect(caseStep).toMatchObject({ sent: 2, waiting: false });
    const bulletinStep = await t.mutation(internal.policyConsent.noticeBatch, { version: V, table: "bulletinAlerts", cursor: null });
    // The same address on a second table is not mailed twice.
    expect(bulletinStep.sent).toBe(0);
    expect(await charges(t)).toBe(2);
    const rows = await consentRows(t);
    const keys = await Promise.all(["one@example.com", "two@example.com"].map(raterKeyFor));
    expect(rows.map((r) => r.key).sort()).toEqual([...keys].sort());
    expect(rows.every((r) => typeof r.noticeSentAt === "number" && r.acceptedAt === undefined)).toBe(true);
  });

  it("waits at the pool's end instead of bursting", async () => {
    const t = trackedTestContext();
    const n = BUDGETS.policyNotice.limit + 3;
    for (let i = 0; i < n; i++) await subscribe(t, "caseStatusAlerts", `s${String(i).padStart(3, "0")}@example.com`);
    const step = await t.mutation(internal.policyConsent.noticeBatch, { version: V, table: "caseStatusAlerts", cursor: null });
    expect(step).toMatchObject({ sent: BUDGETS.policyNotice.limit, waiting: true });
    expect(await charges(t)).toBe(BUDGETS.policyNotice.limit);
    expect((await consentRows(t)).length).toBe(BUDGETS.policyNotice.limit);
  });

  it("sends nothing for a version that isn't current", async () => {
    const t = trackedTestContext();
    await subscribe(t, "caseStatusAlerts", "one@example.com");
    expect(await t.mutation(internal.policyConsent.startNotices, { version: "2026-11-18" })).toMatchObject({ started: false });
    expect(await t.mutation(internal.policyConsent.noticeBatch, { version: "2026-11-18", table: "caseStatusAlerts", cursor: null })).toMatchObject({ sent: 0 });
    expect(await charges(t)).toBe(0);
  });
});

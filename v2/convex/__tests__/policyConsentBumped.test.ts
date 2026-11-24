/**
 * Active consent after a policy change: the version moved past the baseline here (it equals the baseline today, and
 * policyConsent.test.ts holds that side). What must hold:
 * - an account older than the change is asked until it accepts this version; one opened after it never is;
 * - the emailed link's GET page writes nothing and its POST records once; a forged token is refused, a burst of
 *   forged ones is slowed, and a valid one is never refused because of someone else's tries;
 * - the hand-run sweep mails each live subscriber without an account once, charging its pool before each send,
 *   never past the day's list ceiling, with the refs that let an opt-out drop a queued copy; it skips rows confirmed
 *   during the sweep and alerts that have finished; someone confirming after the change is never asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/policyConsent", async (orig) => ({
  ...(await orig<typeof import("../lib/policyConsent")>()),
  POLICY_CONSENT_VERSION: "2027-02-01",
  POLICY_CHANGE_SUMMARIES: { "2027-02-01": "We now share the number of alerts we send each month with a research partner." },
}));

const { settleScheduled, trackedTestContext, finishScheduledNow } = await import("../../test-utils/convexSettle");
const { createAuthenticatedContext } = await import("../../test-utils/convex");
const { api, internal } = await import("../_generated/api");
const { authCallbacks } = await import("../auth");
const { BUDGETS } = await import("../lib/alertBudgets");
const { LIST_CEILING, utcDay } = await import("../lib/emailLimits");
const { POLICY_ACCEPT_IP_LIMIT, policyAcceptPurpose } = await import("../lib/policyConsent");
const { consentKey } = await import("../lib/policyConsentStore");
const { makeUnsubscribeToken } = await import("../lib/unsubscribeToken");
const { raterKeyFor } = await import("../siteReviews");

const SECRET = "test-unsubscribe-secret";
const V = "2027-02-01";
const SUMMARY = "We now share the number of alerts we send each month with a research partner.";
const originalFetch = global.fetch;
let resendSends = 0;
/** The recipients these tests create: every one is an address at policy-test.example. */
const OURS = /@policy-test\.example/;

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("BLOCKED_EMAILS", "");
  resendSends = 0;
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    // The parsed host, so a URL that only mentions Resend somewhere never counts as a send.
    if (new URL(String(url)).hostname === "api.resend.com") {
      // Only this file's own recipients count: another file's leftover scheduled email (an admin notice, an error
      // report) can still be on its way when these tests run, and it would land in this stub.
      if (!OURS.test(String(init?.body ?? ""))) return new Response(JSON.stringify({ id: "elsewhere" }), { status: 200 });
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
const T0 = Date.UTC(2027, 1, 2);

async function caseRow(t: T, email: string, over: Record<string, unknown> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("caseStatusAlerts", { email, caseNumber: "G-100-26125-868956", createdAt: 1, confirmedAt: 2, ...over } as never),
  );
}
async function bulletinRow(t: T, email: string, over: Record<string, unknown> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("bulletinAlerts", { email, category: "EB2", country: "india", createdAt: 1, confirmedAt: 2, ...over } as never),
  );
}
const step = (t: T, table: "caseStatusAlerts" | "bulletinAlerts" | "newsletterSubscribers", startedAt = T0) =>
  t.mutation(internal.policyConsent.noticeBatch, { version: V, table, cursor: null, startedAt });
const charges = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("rateLimits").take(500)).filter((r) => r.action === BUDGETS.policyNotice.key).length);
const consentRows = (t: T) => t.run(async (ctx) => await ctx.db.query("policyConsents").take(500));

describe("an account", () => {
  it("older than the change is asked, with what changed, until it accepts this version", async () => {
    const t = trackedTestContext();
    const user = await createAuthenticatedContext(t);
    expect(await user.query(api.policyConsent.myStatus, {})).toEqual({ needed: true, version: V, summary: SUMMARY });
    expect(await user.mutation(api.policyConsent.accept, { version: "2026-11-18" })).toEqual({ ok: false });
    expect((await user.query(api.policyConsent.myStatus, {}))?.needed).toBe(true);
    expect(await user.mutation(api.policyConsent.accept, { version: V })).toEqual({ ok: true });
    expect((await user.query(api.policyConsent.myStatus, {}))?.needed).toBe(false);
    const row = await t.run(async (ctx) => await ctx.db.get("users", user.userId));
    expect(row?.policyAcceptedVersion).toBe(V);
  });

  it("opened after the change is never asked: sign-up stamps the version of the day", async () => {
    const t = trackedTestContext();
    type Hook = typeof authCallbacks.createOrUpdateUser;
    const userId = await t.run((ctx) =>
      authCallbacks.createOrUpdateUser(ctx as unknown as Parameters<Hook>[0], {
        existingUserId: null,
        type: "oauth",
        provider: { id: "google", type: "oidc" },
        profile: { email: "new@policy-test.example", name: "New Person", emailVerified: true },
      } as unknown as Parameters<Hook>[1]),
    );
    const status = await t.withIdentity({ subject: userId }).query(api.policyConsent.myStatus, {});
    expect(status?.needed).toBe(false);
  });

  it("needs to be signed in to accept, and nobody signed in is told nothing", async () => {
    const t = trackedTestContext();
    await expect(t.mutation(api.policyConsent.accept, { version: V })).rejects.toThrow(/not authenticated/);
    expect(await t.query(api.policyConsent.myStatus, {})).toBeNull();
  });
});

describe("the emailed accept link", () => {
  it("shows what changed on GET and records nothing; the POST records once, by the address's hash", async () => {
    const t = trackedTestContext();
    const token = await makeUnsubscribeToken("Sub@Policy-Test.example", SECRET, policyAcceptPurpose(V));
    const path = `/prefs/policy?token=${encodeURIComponent(token)}&v=${V}`;
    const page = await t.fetch(path, { method: "GET" });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Accept the updated policy?");
    expect(html).toContain(SUMMARY);
    expect(html).toContain('method="POST"');
    expect(await consentRows(t)).toHaveLength(0);

    expect(await (await t.fetch(path, { method: "POST" })).text()).toContain("Accepted");
    expect(await (await t.fetch(path, { method: "POST" })).text()).toContain("Already accepted");
    const rows = await consentRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: await raterKeyFor("sub@policy-test.example"), version: V });
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("policy-test.example");
  });

  it("refuses a forged token, another purpose's, an old version's and a missing version", async () => {
    const t = trackedTestContext();
    const prefs = await makeUnsubscribeToken("sub@policy-test.example", SECRET, "prefs");
    const old = await makeUnsubscribeToken("sub@policy-test.example", SECRET, policyAcceptPurpose("2026-11-18"));
    expect((await t.fetch(`/prefs/policy?token=forged.sig&v=${V}`, { method: "POST" })).status).toBe(400);
    expect((await t.fetch(`/prefs/policy?token=${encodeURIComponent(prefs)}&v=${V}`, { method: "POST" })).status).toBe(400);
    expect((await t.fetch(`/prefs/policy?token=${encodeURIComponent(prefs)}`, { method: "GET" })).status).toBe(400);
    expect(await (await t.fetch(`/prefs/policy?token=${encodeURIComponent(old)}&v=2026-11-18`, { method: "POST" })).text()).toContain("earlier version");
    expect(await consentRows(t)).toHaveLength(0);
  });

  it("slows a burst of forged tokens, and never refuses a valid one because of them", async () => {
    const t = trackedTestContext();
    const headers = { "x-forwarded-for": "203.0.113.9" };
    let last = 0;
    for (let i = 0; i <= POLICY_ACCEPT_IP_LIMIT.limit; i++) {
      last = (await t.fetch(`/prefs/policy?token=forged.sig&v=${V}`, { method: "POST", headers })).status;
    }
    expect(last).toBe(429);
    const token = await makeUnsubscribeToken("real@policy-test.example", SECRET, policyAcceptPurpose(V));
    const ok = await t.fetch(`/prefs/policy?token=${encodeURIComponent(token)}&v=${V}`, { method: "POST", headers });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Accepted");
  });
});

describe("the change email, run by hand", () => {
  it("mails each live subscriber without an account once, charging the pool before each send", async () => {
    const t = trackedTestContext();
    await caseRow(t, "one@policy-test.example");
    await bulletinRow(t, "one@policy-test.example");
    await caseRow(t, "two@policy-test.example");
    await caseRow(t, "pending@policy-test.example", { confirmedAt: undefined });
    await caseRow(t, "gone@policy-test.example", { unsubscribedAt: 3 });
    await caseRow(t, "closed@policy-test.example", { caseClosedAt: 3 });
    await caseRow(t, "member@policy-test.example");
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: "member@policy-test.example" });
    });

    expect(await step(t, "caseStatusAlerts")).toMatchObject({ claimed: 2, waiting: false });
    // The same address on a second list is not mailed twice.
    expect((await step(t, "bulletinAlerts")).claimed).toBe(0);
    expect(await charges(t)).toBe(2);
    const keys = await Promise.all(["one@policy-test.example", "two@policy-test.example"].map(consentKey));
    expect((await consentRows(t)).map((r) => r.key).sort()).toEqual([...keys].sort());
    await finishScheduledNow(t);
    expect(resendSends).toBe(2);
  });

  it("passes over rows confirmed during the sweep, but still counts that address's older live row", async () => {
    const t = trackedTestContext();
    await caseRow(t, "late@policy-test.example", { confirmedAt: T0 + 5 });
    await caseRow(t, "both@policy-test.example", { confirmedAt: T0 + 5 });
    await caseRow(t, "both@policy-test.example", { confirmedAt: 2, caseNumber: "G-100-26125-000001" });
    const r = await step(t, "caseStatusAlerts");
    expect(r.claimed).toBe(1);
    expect((await consentRows(t))[0]?.key).toBe(await consentKey("both@policy-test.example"));
  });

  it("skips an address whose only rows have finished, and counts one with a live row left", async () => {
    const t = trackedTestContext();
    await caseRow(t, "done@policy-test.example", { caseClosedAt: 3 });
    await caseRow(t, "mixed@policy-test.example", { caseClosedAt: 3 });
    await caseRow(t, "mixed@policy-test.example", { caseNumber: "G-100-26125-000002" });
    expect((await step(t, "caseStatusAlerts")).claimed).toBe(1);
  });

  it("never sends past the day's list ceiling: one at a time, the rest kept with their refs", async () => {
    const t = trackedTestContext();
    await t.run(async (ctx) => {
      await ctx.db.insert("emailDays", { day: utcDay(Date.now()), sent: LIST_CEILING - 1 });
    });
    const ids: string[] = [];
    for (const e of ["a@policy-test.example", "b@policy-test.example", "c@policy-test.example"]) ids.push(await caseRow(t, e));
    expect((await step(t, "caseStatusAlerts")).claimed).toBe(3);
    await finishScheduledNow(t);
    expect(resendSends).toBe(1);
    const kept = await t.run(async (ctx) => (await ctx.db.query("emailRetries").take(10)).filter((r) => r.kind === "policy-change"));
    expect(kept).toHaveLength(2);
    expect(kept.every((r) => (r.refs ?? []).some((ref) => ids.some((id) => ref === `case:${id}`)))).toBe(true);
  });

  it("waits at the pool's end instead of bursting", async () => {
    const t = trackedTestContext();
    const n = BUDGETS.policyNotice.limit + 3;
    for (let i = 0; i < n; i++) await caseRow(t, `s${String(i).padStart(3, "0")}@policy-test.example`);
    expect(await step(t, "caseStatusAlerts")).toMatchObject({ claimed: BUDGETS.policyNotice.limit, waiting: true });
    expect(await charges(t)).toBe(BUDGETS.policyNotice.limit);
  });

  it("never asks someone who confirmed the digest after the change", async () => {
    const t = trackedTestContext();
    await t.run(async (ctx) => {
      await ctx.db.insert("newsletterSubscribers", { email: "digest@policy-test.example", createdAt: 1 });
    });
    await t.mutation(internal.emailPrefs.confirmNewsletterForEmail, { email: "digest@policy-test.example" });
    const rows = await consentRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: await consentKey("digest@policy-test.example"), version: V });
    expect(typeof rows[0]?.acceptedAt).toBe("number");
    // Confirmed after the sweep began, and already accepted: the sweep passes it over.
    expect((await step(t, "newsletterSubscribers", 0)).claimed).toBe(0);
  });

  it("sends nothing for a version that isn't current", async () => {
    const t = trackedTestContext();
    await caseRow(t, "one@policy-test.example");
    expect(await t.mutation(internal.policyConsent.startNotices, { version: "2026-11-18" })).toMatchObject({ started: false });
    expect(
      await t.mutation(internal.policyConsent.noticeBatch, { version: "2026-11-18", table: "caseStatusAlerts", cursor: null, startedAt: T0 }),
    ).toMatchObject({ claimed: 0 });
    expect(await charges(t)).toBe(0);
  });
});

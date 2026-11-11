import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// C4 — force recordContactEvent to throw so we can assert the webhook returns
// 5xx (so svix/Resend redelivers) instead of swallowing the failure as 200.
// vi.mock is hoisted file-wide; the C1 tests below don't touch this mutation,
// so the throwing stub is harmless to them.
// ---------------------------------------------------------------------------
vi.mock("../marketingWebhook", async (importOriginal) => {
  // Partial mock: keep every real export (http.ts + schema.ts import
  // isLiveContactEventType / contactEventTypeValidator / LIVE_CONTACT_EVENT_TYPES
  // from here) and override ONLY recordContactEvent so the C4 webhook path can
  // exercise the internal-write-failure branch.
  const actual = await importOriginal<typeof import("../marketingWebhook")>();
  const { internalMutation } = await import("../_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    recordContactEvent: internalMutation({
      args: {
        svixId: v.string(),
        email: v.string(),
        contactId: v.string(),
        audienceId: v.optional(v.string()),
        eventType: v.union(
          v.literal("contact.created"),
          v.literal("contact.updated"),
          v.literal("contact.deleted"),
          v.literal("contact.backfill"),
        ),
        unsubscribed: v.boolean(),
        occurredAt: v.number(),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        rawPayload: v.string(),
      },
      handler: async () => {
        throw new Error("simulated DB write failure");
      },
    }),
  };
});

import { Webhook } from "svix";
import { createTestContext } from "../../test-utils/convex";
import { api, internal } from "../_generated/api";

const TEST_WEBHOOK_SECRET = Buffer.from("perm-tracker-test-secret-1234").toString("base64");

function signWebhook(rawBody: string): {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
} {
  const wh = new Webhook(TEST_WEBHOOK_SECRET);
  const svixId = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = wh.sign(svixId, new Date(Number(timestamp) * 1000), rawBody);
  return {
    "svix-id": svixId,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}

const originalFetch = global.fetch;

// ============================================================================
// C1 — IDOR: subscription actions must operate on the CALLER's own email,
// never the client-supplied `email` arg.
// ============================================================================

describe("marketingEmail subscription actions — IDOR protection (C1)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.AUTH_RESEND_KEY = "re_test_key";
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_RESEND_KEY;
    vi.clearAllMocks();
  });

  /** Seed a user with a known email and return an identity-scoped context. */
  async function seedCaller(t: ReturnType<typeof createTestContext>, email: string) {
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Caller", email }),
    );
    return { userId, ctx: t.withIdentity({ subject: userId as string }) };
  }

  it("getMarketingSubscriptionStatus queries the CALLER's email, ignoring the victim email arg", async () => {
    const t = createTestContext();
    const { ctx } = await seedCaller(t, "caller@example.com");

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unsubscribed: false }),
      text: async () => "{}",
    });

    // Caller passes a VICTIM's email, attempting to read someone else's status.
    const result = await ctx.action(api.marketingEmail.getMarketingSubscriptionStatus, {
      email: "victim@firm.com",
    });

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    // Resend was hit with the CALLER's own email, not the victim's.
    expect(calledUrl).toContain(encodeURIComponent("caller@example.com"));
    expect(calledUrl).not.toContain("victim%40firm.com");
    expect(calledUrl).not.toContain("victim@firm.com");
  });

  it("updateMarketingSubscription patches the CALLER's email, ignoring the victim email arg", async () => {
    const t = createTestContext();
    const { ctx } = await seedCaller(t, "owner@example.com");

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}",
    });

    // Caller tries to unsubscribe a victim by passing their email.
    const result = await ctx.action(api.marketingEmail.updateMarketingSubscription, {
      email: "victim@firm.com",
      subscribed: false,
    });

    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain(encodeURIComponent("owner@example.com"));
    expect(calledUrl).not.toContain("victim");
    expect(calledInit.method).toBe("PATCH");
    expect(JSON.parse(calledInit.body as string)).toEqual({ unsubscribed: true });
  });

  // Everyone who joined after the April 12 2026 sync has no contact, and the switch failed for them (Nov 4 2026).
  it("turning updates on for someone not on the list adds them, subscribed, to the list", async () => {
    const t = createTestContext();
    const { ctx } = await seedCaller(t, "new@example.com");
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => "not found" })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "c1" }), text: async () => "{}" });
    const result = await ctx.action(api.marketingEmail.updateMarketingSubscription, { email: "x", subscribed: true });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/contacts$/);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ email: "new@example.com", unsubscribed: false });
    expect(body.segment_ids).toHaveLength(1);
  });

  // Product updates are opt-out for an account (the Privacy Policy, "Product Update Emails"):
  // the list is filled from the accounts before each update goes. So an account that isn't on
  // the list yet is one that will be mailed, and the switch has to say so.
  it("an account not on the list yet reads as subscribed, so the switch shows on", async () => {
    const t = createTestContext();
    const { ctx } = await seedCaller(t, "new@example.com");
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => "not found" });
    expect(await ctx.action(api.marketingEmail.getMarketingSubscriptionStatus, { email: "x" })).toBe(true);
  });

  // It answered "nothing to do", so the choice was recorded nowhere and the next fill of the
  // list subscribed the account.
  it("turning updates off for an account not on the list puts the choice on record", async () => {
    const t = createTestContext();
    const { ctx } = await seedCaller(t, "new@example.com");
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => "not found" })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "c1" }), text: async () => "{}" });
    const result = await ctx.action(api.marketingEmail.updateMarketingSubscription, { email: "x", subscribed: false });
    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/contacts$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ email: "new@example.com", unsubscribed: true });
  });

  it("getMarketingSubscriptionStatus returns null for an unauthenticated caller (no Resend call)", async () => {
    const t = createTestContext();

    const result = await t.action(api.marketingEmail.getMarketingSubscriptionStatus, {
      email: "anyone@firm.com",
    });

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("updateMarketingSubscription throws for an unauthenticated caller (no Resend call)", async () => {
    const t = createTestContext();

    await expect(
      t.action(api.marketingEmail.updateMarketingSubscription, {
        email: "anyone@firm.com",
        subscribed: true,
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when the authenticated user has no email on record (no Resend call)", async () => {
    const t = createTestContext();
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "No Email" }),
    );
    const ctx = t.withIdentity({ subject: userId as string });

    const result = await ctx.action(api.marketingEmail.getMarketingSubscriptionStatus, {
      email: "spoofed@firm.com",
    });

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// C4 — webhook returns 5xx (not 200) when the internal write fails, so
// svix/Resend redelivers and the by_svix_id dedup recovers the audit event.
// ============================================================================

// "Stop everything" on the preferences page removed the address's contact. The list is filled
// from the accounts before each product update, so an account that pressed it came back,
// subscribed. A stop is kept as a contact that says so.
describe("a stop stays on record", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const ok = { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  const missing = { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };

  beforeEach(() => {
    process.env.AUTH_RESEND_KEY = "re_test_key";
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_RESEND_KEY;
    vi.clearAllMocks();
  });

  const call = (i: number) => {
    const [url, init] = mockFetch.mock.calls[i] as [string, RequestInit];
    return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
  };

  it("marks an existing contact unsubscribed, and never deletes it", async () => {
    const t = createTestContext();
    mockFetch.mockResolvedValueOnce(ok);
    await t.action(internal.marketingEmail.setContactUnsubscribed, { email: "stop@example.com", createIfMissing: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(call(0)).toMatchObject({ method: "PATCH", body: { unsubscribed: true } });
    expect(call(0).url).toContain("/contacts/stop%40example.com");
  });

  it("creates the contact already unsubscribed for an account that isn't on the list", async () => {
    const t = createTestContext();
    mockFetch.mockResolvedValueOnce(missing).mockResolvedValueOnce(ok);
    await t.action(internal.marketingEmail.setContactUnsubscribed, { email: "stop@example.com", createIfMissing: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(call(1)).toMatchObject({ method: "POST", body: { email: "stop@example.com", unsubscribed: true } });
  });

  it("stores nothing for an address with no account and no contact", async () => {
    const t = createTestContext();
    mockFetch.mockResolvedValueOnce(missing);
    await t.action(internal.marketingEmail.setContactUnsubscribed, { email: "stranger@example.com", createIfMissing: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("records a failed request and doesn't throw", async () => {
    const t = createTestContext();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" });
    await expect(
      t.action(internal.marketingEmail.setContactUnsubscribed, { email: "stop@example.com", createIfMissing: true }),
    ).resolves.toBeNull();
    const recorded = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect())
        .filter((job) => job.name.includes("systemErrors"))
        .map((job) => (job.args[0] as { operation: string }).operation),
    );
    expect(recorded).toEqual(["marketingEmail.setContactUnsubscribed"]);
  });
});

// Stops made before the fix removed the contact, and that removal (in the log of the mail
// provider's contact events) is the only record of them.
describe("filling the list never undoes a stop", () => {
  let calls: { url: string; method: string; body?: Record<string, unknown> }[];

  beforeEach(() => {
    process.env.AUTH_RESEND_KEY = "re_test_key";
    calls = [];
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      // The list as Resend holds it: one account's contact, already unsubscribed.
      if (method === "GET") {
        return new Response(
          JSON.stringify({ data: [{ id: "c-off", email: "off@example.com", first_name: "Off", unsubscribed: true }], has_more: false }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "new" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_RESEND_KEY;
  });

  it("adds a new account subscribed, a stopped one unsubscribed, and leaves an unsubscribed contact alone", async () => {
    const t = createTestContext();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { name: "New Person", email: "new@example.com" });
      await ctx.db.insert("users", { name: "Stopped Person", email: "Stopped@Example.com" });
      await ctx.db.insert("users", { name: "Off", email: "off@example.com" });
      // The stopped account's contact was removed by "Stop everything"; the newest event says so.
      const base = { contactId: "c-old", unsubscribed: false, rawPayload: "{}" };
      await ctx.db.insert("marketingEvents", { ...base, svixId: "e1", email: "stopped@example.com", eventType: "contact.created", occurredAt: 1 });
      await ctx.db.insert("marketingEvents", { ...base, svixId: "e2", email: "stopped@example.com", eventType: "contact.deleted", occurredAt: 2 });
    });

    await t.action(internal.marketingEmail.syncContacts, {});

    const created = calls.filter((c) => c.method === "POST").map((c) => c.body!);
    expect(created.find((b) => b.email === "new@example.com")?.unsubscribed).toBeUndefined();
    expect(created.find((b) => String(b.email).toLowerCase() === "stopped@example.com")).toMatchObject({ unsubscribed: true });
    // The contact that's already unsubscribed is never written to.
    expect(calls.filter((c) => c.method !== "GET" && c.url.includes("c-off"))).toEqual([]);
    expect(created.find((b) => b.email === "off@example.com")).toBeUndefined();
  }, 30_000);
});

describe("/resend-inbound returns 5xx on internal write failure (C4)", () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("returns 500 when recordContactEvent throws (lets Resend retry)", async () => {
    const t = createTestContext();
    const rawBody = JSON.stringify({
      type: "contact.deleted",
      created_at: "2026-04-15T16:47:45.000Z",
      data: {
        id: "c_fail",
        email: "retry@example.com",
        unsubscribed: true,
        created_at: "2026-04-15T16:47:45.000Z",
      },
    });

    const res = await t.fetch("/resend-inbound", {
      method: "POST",
      headers: { ...signWebhook(rawBody), "Content-Type": "application/json" },
      body: rawBody,
    });

    // 5xx → svix/Resend redelivers with the same svix-id (dedup-safe).
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBe(500);
  });
});

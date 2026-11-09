/**
 * The admin's one-off email to a user (admin.sendAdminEmail): it says whether the email went now or only waits
 * in the retry queue, so the admin screen doesn't say "Email sent" for one that hasn't.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { api } from "../_generated/api";

const ADMIN = "admin@send-email-test.com";
const originalFetch = global.fetch;

function stubResend(status: number) {
  global.fetch = (async () =>
    status >= 400
      ? new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests" }), {
          status,
          headers: { "Content-Type": "application/json" },
        })
      : new Response(JSON.stringify({ id: "stub" }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAIL", ADMIN);
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("BLOCKED_EMAILS", "");
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

async function asAdmin(t: ReturnType<typeof createTestContext>) {
  const id = await t.run(async (ctx) => ctx.db.insert("users", { email: ADMIN }));
  return t.withIdentity({ subject: id, email: ADMIN });
}

const mail = { toEmail: "person@example.com", toName: "Pat", subject: "About your case", body: "A short note." };

describe("admin.sendAdminEmail", () => {
  it("says the email went when Resend took it", async () => {
    const t = createTestContext();
    stubResend(200);
    expect(await (await asAdmin(t)).action(api.admin.sendAdminEmail, mail)).toEqual({ success: true, queued: false });
  });

  it("says the email only waits in the retry queue when Resend couldn't take it yet", async () => {
    const t = createTestContext();
    stubResend(429);
    expect(await (await asAdmin(t)).action(api.admin.sendAdminEmail, mail)).toEqual({ success: true, queued: true });
  }, 60_000);
});

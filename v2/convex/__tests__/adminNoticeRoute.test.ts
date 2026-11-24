import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { internal } from "../_generated/api";

/**
 * An admin notice names its kind in the routing list (scripts/data/alert_routes.json), and the action sends it only
 * when the list sends that kind as it happens; a kind left to the morning report or the admin page isn't emailed.
 */
const originalFetch = global.fetch;
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubEnv("ADMIN_EMAIL", "owner@example.com");
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  global.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("sendAdminNotificationEmail and the routing list", () => {
  it("sends nothing for a kind the list leaves to the morning report", async () => {
    const t = createTestContext();
    await t.action(internal.notificationActions.sendAdminNotificationEmail, {
      subject: "s", body: "b", route: "errors.once",
    });
    expect(calls).toEqual([]);
  });

  it("sends a kind the list sends by email", async () => {
    const t = createTestContext();
    await t.action(internal.notificationActions.sendAdminNotificationEmail, {
      subject: "s", body: "b", route: "notice.signup-spike",
    });
    expect(calls.length).toBeGreaterThan(0);
  });
});

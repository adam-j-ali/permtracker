import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { internal } from "../_generated/api";

/**
 * The watch's action: the switch, the recorded state, and the one scheduled
 * admin email. Its rules (judge, step) are tested in convex/lib/serverWatch.test.ts.
 */
const originalFetch = global.fetch;

function mirrorAnswers(row: { computed_at: number; json: string } | null) {
  global.fetch = (async () => {
    const cols = [{ name: "computed_at" }, { name: "json" }];
    const rows = row ? [[{ type: "integer", value: String(row.computed_at) }, { type: "text", value: row.json }]] : [];
    return new Response(
      JSON.stringify({ results: [{ type: "ok", response: { type: "execute", result: { cols, rows } } }, { type: "ok", response: { type: "close" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

async function scheduledEmails(t: ReturnType<typeof createTestContext>) {
  const s = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return s.filter((f) => f.name.includes("sendAdminNotificationEmail"));
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "https://example.turso.io");
  vi.stubEnv("DATABASE_AUTH_TOKEN", "stub-token");
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("the server watch", () => {
  it("does nothing where SERVER_WATCH isn't on", async () => {
    const t = createTestContext();
    mirrorAnswers(null);
    await t.action(internal.serverWatch.check, {});
    expect(await t.run(async (ctx) => ctx.db.query("serverWatch").collect())).toHaveLength(0);
    expect(await scheduledEmails(t)).toHaveLength(0);
  });

  it("emails once when the report goes stale, and not again 15 minutes later", async () => {
    vi.stubEnv("SERVER_WATCH", "on");
    const t = createTestContext();
    const stale = Date.now() - 2 * 60 * 60 * 1000;
    mirrorAnswers({ computed_at: stale, json: JSON.stringify({ at: new Date(stale).toISOString(), now: { diskPct: 40 } }) });
    await t.action(internal.serverWatch.check, {});
    expect(await scheduledEmails(t)).toHaveLength(1);
    const [row] = await t.run(async (ctx) => ctx.db.query("serverWatch").collect());
    expect(row?.down).toBe(true);
    await t.action(internal.serverWatch.check, {});
    expect(await scheduledEmails(t), "a second check inside the reminder window sends nothing").toHaveLength(1);
  });

  it("pushes to the phone beside the email: once, urgent, with no address in it", async () => {
    vi.stubEnv("SERVER_WATCH", "on");
    vi.stubEnv("NTFY_TOPIC", "test_topic_123456");
    const t = createTestContext();
    const stale = Date.now() - 2 * 60 * 60 * 1000;
    mirrorAnswers({ computed_at: stale, json: JSON.stringify({ at: new Date(stale).toISOString(), now: { diskPct: 40 } }) });
    const mirror = global.fetch;
    const pushes: { url: string; init?: RequestInit }[] = [];
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://ntfy.sh/")) {
        pushes.push({ url: String(url), init });
        return new Response("{}", { status: 200 });
      }
      return mirror(url, init);
    }) as typeof fetch;
    await t.action(internal.serverWatch.check, {});
    expect(await scheduledEmails(t)).toHaveLength(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.url).toBe("https://ntfy.sh/test_topic_123456");
    expect((pushes[0]?.init?.headers as Record<string, string>).Priority).toBe("urgent");
    expect(String(pushes[0]?.init?.body)).toMatch(/minutes old.*Since \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M E[SD]T\./);
    await t.action(internal.serverWatch.check, {});
    expect(pushes, "no reminder push while it lasts").toHaveLength(1);
  });

  it("mails a database that doesn't answer only on the second check in a row", async () => {
    // Arrange
    vi.stubEnv("SERVER_WATCH", "on");
    const t = createTestContext();
    global.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    // Act
    await t.action(internal.serverWatch.check, {});
    const afterOne = await scheduledEmails(t);
    await t.action(internal.serverWatch.check, {});
    // Assert
    expect(afterOne, "one miss is the morning report's, not an email").toHaveLength(0);
    expect(await scheduledEmails(t)).toHaveLength(1);
    const [row] = await t.run(async (ctx) => ctx.db.query("serverWatch").collect());
    expect(row?.down).toBe(true);
    expect(row?.pendingSince, "the mailed miss is no longer pending").toBeUndefined();
  });

  it("still emails when the push fails", async () => {
    vi.stubEnv("SERVER_WATCH", "on");
    vi.stubEnv("NTFY_TOPIC", "test_topic_123456");
    const t = createTestContext();
    const stale = Date.now() - 2 * 60 * 60 * 1000;
    mirrorAnswers({ computed_at: stale, json: JSON.stringify({ at: new Date(stale).toISOString(), now: { diskPct: 40 } }) });
    const mirror = global.fetch;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://ntfy.sh/")) throw new TypeError("fetch failed");
      return mirror(url, init);
    }) as typeof fetch;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.action(internal.serverWatch.check, {});
    expect(await scheduledEmails(t)).toHaveLength(1);
    expect(log.mock.calls.flat().join(" ")).toMatch(/push not sent: ntfy unreachable/);
    log.mockRestore();
  });
});

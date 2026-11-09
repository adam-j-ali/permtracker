import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The check says "sent" only when something could have reached Sentry: a client is set up (a DSN) and the queue
 * drained. An event id alone proves nothing, since captureException hands one out with no client at all.
 */
const captureException = vi.fn(() => "evt-1");
const flush = vi.fn(async () => true);
const getClient = vi.fn((): object | undefined => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...(a as [])),
  flush: (...a: unknown[]) => flush(...(a as [])),
  getClient: () => getClient(),
}));

const SECRET = "test-sentry-check-secret";
const { GET } = await import("../route");
const call = (secret = SECRET) => GET(new Request("https://permtracker.app/api/sentry-check", { headers: { "x-sentry-check-secret": secret } }));

beforeEach(() => {
  process.env.SENTRY_CHECK_SECRET = SECRET;
  captureException.mockClear();
  flush.mockReset().mockResolvedValue(true);
  getClient.mockReset().mockReturnValue({});
});

describe("GET /api/sentry-check", () => {
  it("refuses without the secret and sends nothing", async () => {
    expect((await call("wrong")).status).toBe(403);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("says sent, with the event id, when a client is set up and the queue drained", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "sent", eventId: "evt-1" });
  });

  it("says not sent when no client is set up (no DSN)", async () => {
    getClient.mockReturnValue(undefined);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("not sent");
  });

  it("says not sent when the queue didn't drain in time", async () => {
    flush.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("not sent");
  });
});

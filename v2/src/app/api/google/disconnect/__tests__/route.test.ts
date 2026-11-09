import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Disconnecting Google Calendar first removes the PERM deadline events, then revokes the token. Once the token is
 * revoked nothing here can remove an event, so an event left behind is said in the answer and reported, never
 * folded into a clean "disconnected".
 */
vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(async () => "token"),
  isAuthenticatedNextjs: vi.fn(async () => true),
}));
const fetchAction = vi.fn();
vi.mock("convex/nextjs", () => ({ fetchAction: (...a: unknown[]) => fetchAction(...a) }));
const captureError = vi.fn();
vi.mock("@/lib/sentry", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

const { api } = await import("@convex/_generated/api");
const { getFunctionName } = await import("convex/server");
const { POST } = await import("../route");

const is = (fn: unknown, ref: unknown) => getFunctionName(fn as never) === getFunctionName(ref as never);
const call = () => POST(new Request("https://permtracker.app/api/google/disconnect", { method: "POST" }) as never);

function answers(clear: unknown) {
  fetchAction.mockImplementation(async (fn: unknown) => {
    if (is(fn, api.googleCalendarActions.clearAllEvents)) {
      if (clear instanceof Error) throw clear;
      return clear;
    }
    if (is(fn, api.googleAuth.disconnectWithRevocation)) return { success: true, revoked: true };
    throw new Error("unexpected action");
  });
}

beforeEach(() => {
  fetchAction.mockReset();
  captureError.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/google/disconnect", () => {
  it("says how many events it removed when it removed them all", async () => {
    answers({ success: true, eventsDeleted: 12, casesCleaned: 3, errors: 0 });
    const body = await (await call()).json();
    expect(body).toMatchObject({ success: true, eventsLeft: false });
    expect(body.message).toMatch(/12 events removed/);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    ["the clear failed", { success: false, eventsDeleted: 0, casesCleaned: 0, errors: 0, error: "invalid_grant" }],
    ["some events weren't removed", { success: true, eventsDeleted: 9, casesCleaned: 3, errors: 3 }],
    ["the clear threw", new Error("Google 503")],
  ])("says events stayed in the calendar, and reports it, when %s", async (_why, clear) => {
    answers(clear);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, eventsLeft: true });
    expect(body.message).toMatch(/couldn't be removed/);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("isn't alarmed when there was nothing connected to clear", async () => {
    answers({ success: false, eventsDeleted: 0, casesCleaned: 0, errors: 0, error: "Google Calendar not connected" });
    const body = await (await call()).json();
    expect(body.eventsLeft).toBe(false);
    expect(captureError).not.toHaveBeenCalled();
  });
});

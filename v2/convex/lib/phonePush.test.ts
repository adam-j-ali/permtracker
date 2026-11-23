import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cleared, pushPhone, scrub, started } from "./phonePush";
import { pushFor, step } from "./serverWatch";

/**
 * A push to the owner's phone says what, since when and what to do, carries no address, and goes once on start
 * and once on clear. The cases are shared with the server's scripts/oracle/test_phone_push.py, so both say it one way.
 */
const CASES = JSON.parse(readFileSync(join(process.cwd(), "scripts/fixtures/phone_push_cases.json"), "utf8")) as {
  scrub: [string, string][];
  started: { what: string; since: number; todo: string; out: string }[];
  cleared: { what: string; since: number; out: string }[];
};

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("what a push may carry", () => {
  it.each(CASES.scrub)("scrub(%j)", (given, want) => {
    expect(scrub(given)).toBe(want);
  });
  it.each(CASES.started)("started: $what", (c) => {
    expect(started(c.what, c.since * 1000, c.todo)).toBe(c.out);
  });
  it.each(CASES.cleared)("cleared: $what", (c) => {
    expect(cleared(c.what, c.since * 1000)).toBe(c.out);
  });
});

describe("which watch emails push", () => {
  const NOW = 1_796_043_600_000;
  it("a start pushes urgent when the server can't be heard from, high for the disk; a reminder never pushes", () => {
    const quiet = step(null, "the server's health report is 40 minutes old (it writes one every 10)", NOW);
    expect(pushFor(quiet.mail)?.level).toBe("urgent");
    expect(pushFor(step(null, "the server's database did not answer (fetch failed)", NOW).mail)?.level).toBe("urgent");
    expect(pushFor(step(null, "the server's disk is 93% full", NOW).mail)?.level).toBe("high");
    const still = step(quiet.next, "the server's health report is 400 minutes old", NOW + 7 * 3600_000);
    expect(still.mail?.kind).toBe("still");
    expect(pushFor(still.mail)).toBeNull();
    const clear = step(still.next, null, NOW + 8 * 3600_000);
    expect(pushFor(clear.mail)?.level).toBe("clear");
    expect(clear.mail?.since, "a clear carries when the trouble started").toBe(NOW);
  });
});

describe("pushPhone", () => {
  it("sends the scrubbed title and message with the level's priority", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    expect(await pushPhone("From 203.0.113.7", "to a@example.com", "high", "abcdefgh12")).toEqual({ ok: true, why: "" });
    expect(calls[0]?.url).toBe("https://ntfy.sh/abcdefgh12");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Title).toBe("From an address");
    expect(headers.Priority).toBe("high");
    expect(calls[0]?.init?.body).toBe("to an email address");
  });
  it("says why when it can't push, and never throws", async () => {
    expect(await pushPhone("t", "m", "urgent", undefined)).toEqual({ ok: false, why: "no usable NTFY_TOPIC" });
    expect((await pushPhone("t", "m", "urgent", "short")).ok).toBe(false);
    global.fetch = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await pushPhone("t", "m", "urgent", "abcdefgh12")).toEqual({ ok: false, why: "ntfy answered 500" });
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await pushPhone("t", "m", "clear", "abcdefgh12")).toEqual({ ok: false, why: "ntfy unreachable (TypeError)" });
  });
});

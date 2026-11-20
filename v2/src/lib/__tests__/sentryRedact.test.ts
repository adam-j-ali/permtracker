import { describe, expect, it } from "vitest";

import { redactBrowserEvent, scrubShareKeys } from "../sentryRedact";

/** No email address leaves the browser for Sentry (Nov 4 2026: the signed-in person's address went as the user). */
describe("redactBrowserEvent", () => {
  it("keeps the user's id and drops the address and name", async () => {
    const e = await redactBrowserEvent({ user: { id: "u1", email: "jane@example.test", username: "Jane Doe" } });
    expect(e.user).toEqual({ id: "u1" });
  });

  it("replaces every address in the message, exceptions, breadcrumbs, request and extra", async () => {
    const e = await redactBrowserEvent({
      message: "no account for jane@example.test",
      exception: { values: [{ value: "Error: jane@example.test not found" }] },
      breadcrumbs: [{ message: "typed jane@example.test", data: { to: "jane@example.test" } }],
      request: { url: "https://permtracker.app/x?email=jane@example.test" },
      extra: { form: { email: "jane@example.test", n: 3 } },
    });
    const text = JSON.stringify(e);
    expect(text).not.toContain("jane@example.test");
    expect(e.message).toMatch(/^no account for email#[0-9a-f]{6}$/);
    expect(e.extra).toEqual({ form: { email: e.message!.slice("no account for ".length), n: 3 } });
  });

  it("leaves an event with no address alone", async () => {
    const e = await redactBrowserEvent({ message: "Failed to load the calendar" });
    expect(e).toEqual({ message: "Failed to load the calendar" });
  });
});

/**
 * A recruitment record shared by link opens to anyone holding its key (src/app/share), and the Privacy Policy says we
 * keep only a one-way hash of it. Nothing Sentry receives, from the browser or the server, may carry the key.
 */
describe("scrubShareKeys", () => {
  const KEY = "q7Zt0Lw_-3fXbV9kR2mN8pS1uY4eH6cJ0aD5gK7iO2s";
  const PATH = `/share/recruitment/${KEY}`;

  it("blanks the key everywhere an event can carry a path, and keeps the rest", () => {
    const e = scrubShareKeys({
      message: `couldn't read ${PATH}`,
      transaction: `GET ${PATH}`,
      exception: { values: [{ value: `Error at https://permtracker.app${PATH}?_rsc=1` }] },
      request: { url: `https://permtracker.app${PATH}`, headers: { referer: `https://permtracker.app${PATH}` } },
      // onRequestError's own report (src/instrumentation.ts).
      extra: { method: "GET", path: PATH },
      tags: { routePath: "/share/recruitment/[token]", url: PATH },
      breadcrumbs: [{ category: "navigation", data: { from: "/cases", to: PATH } }],
      contexts: { trace: { data: { "url.full": `https://permtracker.app${PATH}`, "http.target": PATH } } },
      spans: [{ description: `GET ${PATH}`, data: { "url.path": PATH, "url.query": "?_rsc=1" } }],
      level: "error",
      count: 3,
    });
    expect(JSON.stringify(e)).not.toContain(KEY);
    expect(e.request.url).toBe("https://permtracker.app/share/recruitment/redacted");
    expect(e.extra).toEqual({ method: "GET", path: "/share/recruitment/redacted" });
    expect(e.tags.routePath).toBe("/share/recruitment/[token]");
    expect(e.spans[0]!.data["url.query"]).toBe("?_rsc=1");
    expect(e.level).toBe("error");
    expect(e.count).toBe(3);
  });

  it("blanks a key written into another address, encoded", () => {
    const e = scrubShareKeys({ message: `next=%2Fshare%2Frecruitment%2F${KEY}` });
    expect(e.message).toBe("next=%2Fshare%2Frecruitment%2Fredacted");
  });

  it("scrubs a log line the same way", () => {
    const log = scrubShareKeys({ level: "error", message: `failed ${PATH}`, attributes: { path: PATH } });
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("leaves an event without a key alone, and doesn't loop on one that points at itself", () => {
    expect(scrubShareKeys({ message: "Failed to load the calendar", request: { url: "https://permtracker.app/cases" } })).toEqual({
      message: "Failed to load the calendar",
      request: { url: "https://permtracker.app/cases" },
    });
    const looped: Record<string, unknown> = { message: PATH };
    looped.self = looped;
    expect(scrubShareKeys(looped).message).toBe("/share/recruitment/redacted");
  });

  it("is part of what every browser event goes through", async () => {
    const e = await redactBrowserEvent({ request: { url: `https://permtracker.app${PATH}` }, breadcrumbs: [{ data: { to: PATH } }] });
    expect(JSON.stringify(e)).not.toContain(KEY);
  });
});

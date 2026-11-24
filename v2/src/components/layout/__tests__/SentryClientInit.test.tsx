import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SENTRY_DATA_COLLECTION } from "@/lib/sentryDataCollection";

import { SentryClientInit } from "../SentryClientInit";

/**
 * The browser's Sentry, started on the live site's pages that load it, collects no more than the Privacy Policy says:
 * the same data collection setting as the server, no request body, and no shared recruitment record's key in a span
 * or anything else it sends.
 */

const sentry = vi.hoisted(() => ({ init: vi.fn(), on: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  init: sentry.init,
  consoleLoggingIntegration: (options: unknown) => ({ name: "ConsoleLogs", options }),
  getClient: () => ({ on: sentry.on }),
}));

const KEY = "q7Zt0Lw_-3fXbV9kR2mN8pS1uY4eH6cJ0aD5gK7iO2s";
const PATH = `/share/recruitment/${KEY}`;

describe("the browser's Sentry setup (SentryClientInit)", () => {
  it("collects no more than Sentry 10 did, scrubs spans and every envelope, and logs through the console integration", async () => {
    // Sentry starts only on the live site.
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://permtracker.app/cases");
    render(<SentryClientInit />);
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1), { timeout: 6000 });
    const options = sentry.init.mock.calls[0]![0] as Record<string, unknown> & {
      beforeSendSpan: (span: Record<string, unknown>) => Record<string, unknown>;
      integrations: Array<{ name: string; options: unknown }>;
    };

    expect(options.dataCollection).toBe(SENTRY_DATA_COLLECTION);
    expect(options.traceLifecycle).toBe("stream");
    expect(options).not.toHaveProperty("enableLogs");
    expect(options.integrations).toEqual([{ name: "ConsoleLogs", options: { levels: ["warn", "error"] } }]);

    const span = options.beforeSendSpan({
      name: `GET ${PATH}`,
      is_segment: true,
      status: "ok",
      attributes: { "url.full": `https://permtracker.app${PATH}`, "sentry.segment.name": `GET ${PATH}` },
    });
    expect(JSON.stringify(span)).not.toContain(KEY);
    expect(span.name).toBe("GET /share/recruitment/redacted");

    expect(sentry.on).toHaveBeenCalledWith("beforeEnvelope", expect.any(Function));
    const envelope = [{ trace: { transaction: `GET ${PATH}` } }, [[{ type: "event" }, { request: { url: `https://permtracker.app${PATH}` } }]]];
    (sentry.on.mock.calls[0]![1] as (e: unknown) => void)(envelope);
    expect(JSON.stringify(envelope)).not.toContain(KEY);
  });
});

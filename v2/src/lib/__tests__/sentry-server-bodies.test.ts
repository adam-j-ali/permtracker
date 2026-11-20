import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The Privacy Policy says request contents never reach Sentry from the website's server. That is true only while
// the server config replaces the SDK's HTTP integration with one that attaches no body (its default is 10 KB).
const config = readFileSync(join(process.cwd(), "sentry.server.config.ts"), "utf8").replace(/\/\/.*$/gm, "");
const edge = readFileSync(join(process.cwd(), "sentry.edge.config.ts"), "utf8").replace(/\/\/.*$/gm, "");

describe("the server's Sentry setup", () => {
  it("attaches no request body to an event", () => {
    expect(config).toMatch(/httpIntegration\(\{[^}]*maxIncomingRequestBodySize:\s*"none"/);
  });

  it("keeps the Next.js SDK's own setting for the integration it replaces", () => {
    expect(config).toMatch(/httpIntegration\(\{[^}]*disableIncomingRequestSpans:\s*true/);
  });
});

// A recruitment record's share key never reaches Sentry (the Privacy Policy keeps only a one-way hash of it): every
// error, trace and log the server sends goes through scrubShareKeys (src/lib/sentryRedact.ts).
describe("share keys and the server's Sentry setup", () => {
  it("scrubs every error, trace and log the Node server sends", () => {
    expect(config).toMatch(/beforeSend:[^\n]*scrubShareKeys\(/);
    expect(config).toMatch(/beforeSendTransaction:[^\n]*scrubShareKeys\(/);
    expect(config).toMatch(/beforeSendLog:[^\n]*scrubShareKeys\(/);
  });

  it("scrubs every error and trace the edge runtime sends", () => {
    expect(edge).toMatch(/beforeSend:[^\n]*scrubShareKeys\(/);
    expect(edge).toMatch(/beforeSendTransaction:[^\n]*scrubShareKeys\(/);
  });
});

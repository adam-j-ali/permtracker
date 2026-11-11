import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mayCapture } from "@/lib/posthog-server";

/**
 * Events the server files under an account's id. The browser's own events stop for an
 * account that switched usage analytics off and for a browser sending Global Privacy
 * Control; the Privacy Policy says both, so the server's events stop for them too.
 */
describe("mayCapture", () => {
  const plain = new Headers();
  const gpc = new Headers({ "Sec-GPC": "1" });

  it("allows an account with analytics on, from a browser sending no signal", () => {
    expect(mayCapture({ analyticsOff: false }, plain)).toBe(true);
    expect(mayCapture({}, plain)).toBe(true);
  });

  it("refuses an account that switched analytics off", () => {
    expect(mayCapture({ analyticsOff: true }, plain)).toBe(false);
  });

  it("refuses a browser sending Global Privacy Control, whatever the account says", () => {
    expect(mayCapture({ analyticsOff: false }, gpc)).toBe(false);
    expect(mayCapture(null, gpc)).toBe(false);
  });

  it("reads only the signal's own value", () => {
    expect(mayCapture({}, new Headers({ "Sec-GPC": "0" }))).toBe(true);
  });

  it("allows the count when the profile couldn't be read (the event is then filed under no account)", () => {
    expect(mayCapture(null, plain)).toBe(true);
    expect(mayCapture(undefined, plain)).toBe(true);
  });
});

describe("the chat route's events", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");

  it("asks mayCapture with the account's profile and the request's headers", () => {
    expect(src).toContain("mayCapture(userProfile, req.headers)");
  });

  it("files every event through the one guarded call", () => {
    expect(src.match(/getPostHogClient\(\)\?\.capture\(/g)).toHaveLength(1);
    expect(src).toMatch(/if \(!captureAllowed\) return;\s+try \{\s+getPostHogClient\(\)\?\.capture\(/);
  });
});

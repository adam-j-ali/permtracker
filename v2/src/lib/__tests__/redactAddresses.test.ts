import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { redactAddresses, redactEventAddresses } from "@/lib/analyticsRedact";

/**
 * What a page address may tell PostHog. The Privacy Policy says case numbers are
 * taken out of page addresses before anything is sent and that a USCIS receipt
 * number is never shared; this is the code that keeps both.
 */

const run = (props: Record<string, unknown>) => {
  redactAddresses(props);
  return props;
};

describe("redactAddresses", () => {
  it("is wired into before_send, and the start-up file keeps no copy of its own", () => {
    const src = readFileSync(join(process.cwd(), "src/instrumentation-client.ts"), "utf8");
    expect(src).toContain("redactEventAddresses(event);");
    expect(src).not.toMatch(/function redact\w*\(/);
  });

  it("covers every bag of an event: its own fields and the person properties it sets", () => {
    const lookup = "https://permtracker.app/perm-case-status?case=G-100-26125-868956";
    const clean = "https://permtracker.app/perm-case-status?case=redacted";
    const event = {
      properties: {
        $current_url: lookup,
        $set: { $current_url: lookup },
        // A signed-in person's first page, on a `$set` event.
        $set_once: { $initial_current_url: lookup },
      },
      $set: { $referrer: lookup },
      // The same first page, as posthog-js sends it with every event once someone is identified.
      $set_once: { $initial_current_url: lookup, $initial_referrer: "https://permtracker.app/uscis-case-status?receipt=IOE0912345678" },
    };
    redactEventAddresses(event);
    expect(event.properties.$current_url).toBe(clean);
    expect(event.properties.$set.$current_url).toBe(clean);
    expect(event.properties.$set_once.$initial_current_url).toBe(clean);
    expect(event.$set.$referrer).toBe(clean);
    expect(event.$set_once.$initial_current_url).toBe(clean);
    expect(event.$set_once.$initial_referrer).toBe("https://permtracker.app/uscis-case-status?receipt=redacted");
  });

  it("leaves an event with no bags, or none at all, alone", () => {
    expect(() => redactEventAddresses(undefined)).not.toThrow();
    expect(() => redactEventAddresses({})).not.toThrow();
    expect(() => redactEventAddresses({ properties: { $set: "not a bag", $set_once: 3 } })).not.toThrow();
  });

  it("redacts a case number from a full URL", () => {
    expect(run({ $current_url: "https://permtracker.app/perm-case-status?case=G-100-26125-868956" }).$current_url).toBe(
      "https://permtracker.app/perm-case-status?case=redacted",
    );
  });

  it("redacts a USCIS receipt number, which the receipt box puts in the address", () => {
    expect(run({ $current_url: "https://permtracker.app/uscis-case-status?receipt=IOE0912345678" }).$current_url).toBe(
      "https://permtracker.app/uscis-case-status?receipt=redacted",
    );
    expect(run({ $referrer: "/uscis-case-status?form=I-140&receipt=WAC2190012345#result" }).$referrer).toBe(
      "/uscis-case-status?form=I-140&receipt=redacted#result",
    );
  });

  it("redacts the review-link token and keeps the rest of the address", () => {
    const p = run({
      $current_url: "https://permtracker.app/reviews?rating=5&t=abc123-_XYZ#write",
      $initial_current_url: "https://permtracker.app/reviews?t=abc123",
      $referrer: "https://permtracker.app/guides?topic=queue",
    });
    expect(p.$current_url).toBe("https://permtracker.app/reviews?rating=5&t=redacted#write");
    expect(p.$initial_current_url).toBe("https://permtracker.app/reviews?t=redacted");
    expect(p.$referrer).toBe("https://permtracker.app/guides?topic=queue");
  });

  it("redacts an identifier by its shape wherever it sits: a search, another parameter, the path", () => {
    // The site search takes a case number as readily as a name.
    expect(run({ $current_url: "/case-search?q=G-100-26125-868956&program=perm" }).$current_url).toBe(
      "/case-search?q=[redacted]&program=perm",
    );
    expect(run({ $current_url: "/case-search?q=ioe0912345678" }).$current_url).toBe("/case-search?q=[redacted]");
    expect(run({ $pathname: "/x/A-12345-67890/y" }).$pathname).toBe("/x/[redacted]/y");
    // An email address, plain or percent-encoded.
    expect(run({ url: "/prefs?who=someone@example.com" }).url).toBe("/prefs?who=[redacted]");
    expect(run({ url: "/prefs?who=someone%40example.com&x=1" }).url).toBe("/prefs?who=[redacted]&x=1");
  });

  it("redacts from a bare path, which new URL() would throw on", () => {
    expect(run({ $pathname: "/perm-case-status?case=G-100-26125-868956" }).$pathname).toBe(
      "/perm-case-status?case=redacted",
    );
  });

  it("keeps every other parameter and the fragment intact", () => {
    expect(run({ $current_url: "/x?a=1&case=G-100-26125-868956&b=2#frag" }).$current_url).toBe(
      "/x?a=1&case=redacted&b=2#frag",
    );
  });

  it("catches the referrer and the first-visit fields, which is how a number leaks from the next page", () => {
    const p = run({
      $referrer: "https://permtracker.app/perm-case-status?case=P-100-26125-868956",
      $initial_current_url: "https://permtracker.app/perm-case-status?case=G-100-26125-868956",
      $initial_referrer: "https://permtracker.app/uscis-case-status?receipt=IOE0912345678",
    });
    expect(p.$referrer).toBe("https://permtracker.app/perm-case-status?case=redacted");
    expect(p.$initial_current_url).toBe("https://permtracker.app/perm-case-status?case=redacted");
    expect(p.$initial_referrer).toBe("https://permtracker.app/uscis-case-status?receipt=redacted");
  });

  it("does not match a parameter that merely ends in a private name", () => {
    expect(run({ $current_url: "/x?showcase=yes&format=wide&nreceipt=2" }).$current_url).toBe(
      "/x?showcase=yes&format=wide&nreceipt=2",
    );
  });

  it("leaves ordinary addresses exactly as they were", () => {
    for (const url of [
      "/perm-queue",
      "/perm-queue/2026-01",
      "/perm-employers/acme-technology-inc?tab=wages",
      "https://permtracker.app/case-search?q=software+engineer&state=CA",
      "/uscis-processing-times/i-140",
      "/soc-codes/15-1252",
    ]) {
      expect(run({ $current_url: url }).$current_url).toBe(url);
    }
  });

  it("survives a missing bag and values that aren't strings", () => {
    expect(() => redactAddresses(undefined)).not.toThrow();
    expect(run({ $current_url: 42 }).$current_url).toBe(42);
  });
});

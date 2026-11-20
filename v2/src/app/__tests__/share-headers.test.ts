import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it, vi } from "vitest";

/**
 * A recruitment record shared by link (/share/recruitment/<key>): the address is the key, so the page tells
 * browsers never to pass it on, tells search engines never to index or follow it, and loads no third-party
 * analytics (Ahrefs' script would send the address it was loaded on). Every other page keeps its headers.
 *
 * The real config is loaded and its rules applied the way Next applies them, a later rule's key overriding an
 * earlier one's, as embed-headers.test.ts does.
 */

vi.mock("@sentry/nextjs", () => ({ withSentryConfig: (c: unknown) => c }));
vi.mock("@serwist/next", () => ({ default: () => (c: unknown) => c }));
vi.mock("@next/bundle-analyzer", () => ({ default: () => (c: unknown) => c }));

type Rule = { source: string; headers: { key: string; value: string }[] };

async function effectiveHeaders(path: string): Promise<Map<string, string>> {
  const config = (await import("../../../next.config")).default as { headers: () => Promise<Rule[]> };
  const out = new Map<string, string>();
  for (const rule of await config.headers()) {
    const re = pathToRegexp(rule.source, [], { strict: true, sensitive: false, delimiter: "/" });
    if (!re.test(path)) continue;
    for (const h of rule.headers) out.set(h.key.toLowerCase(), h.value);
  }
  return out;
}

const SHARED = "/share/recruitment/Zk3_x-9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890";

describe("a shared recruitment record's headers", () => {
  it("passes no referrer, is never indexed or followed, and is never framed", async () => {
    const h = await effectiveHeaders(SHARED);
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
  });

  it("loads no third-party analytics, and keeps everything else the site's policy allows", async () => {
    const shared = (await effectiveHeaders(SHARED)).get("content-security-policy") ?? "";
    const page = (await effectiveHeaders("/perm-recruitment")).get("content-security-policy") ?? "";
    expect(page).toContain("https://analytics.ahrefs.com");
    expect(shared).not.toContain("ahrefs");
    expect(shared).toContain("https://*.convex.cloud");
    const strip = (csp: string) => csp.replace(/ https:\/\/analytics\.ahrefs\.com/g, "");
    expect(shared).toBe(strip(page));
  });

  it("leaves every other page as it was, the ones that start with the same letters included", async () => {
    for (const path of ["/", "/perm-recruitment", "/sharepoint", "/guides/recruitment-tracking"]) {
      const h = await effectiveHeaders(path);
      expect(h.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(h.get("x-robots-tag"), path).toBeUndefined();
      expect(h.get("content-security-policy"), path).toContain("https://analytics.ahrefs.com");
    }
  });
});

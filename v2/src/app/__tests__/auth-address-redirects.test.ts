import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The addresses people and assistants type for signing in and signing up (/sign-in, /signin, /log-in, /sign-up)
 * answered 404 until Nov 26 2026: our pages are /login and /signup. Each answers a permanent redirect to the page
 * that exists.
 */

vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: (c: unknown) => c }));
vi.mock("@serwist/next", () => ({ default: () => (c: unknown) => c }));
vi.mock("@next/bundle-analyzer", () => ({ default: () => (c: unknown) => c }));

type Redirect = { source: string; destination: string; permanent?: boolean };

describe("sign-in and sign-up addresses", () => {
  it.each([
    ["/sign-in", "/login"],
    ["/signin", "/login"],
    ["/log-in", "/login"],
    ["/sign-up", "/signup"],
    ["/register", "/signup"],
  ])("%s answers a permanent redirect to %s", async (from, to) => {
    const config = (await import("../../../next.config")).default as { redirects: () => Promise<Redirect[]> };
    const rule = (await config.redirects()).find((r) => r.source === from);
    expect(rule?.destination).toBe(to);
    expect(rule?.permanent).toBe(true);
  });

  it("points only at pages that exist", () => {
    for (const page of ["login", "signup"]) {
      expect(existsSync(join(__dirname, "../(site)/(auth)", page, "page.tsx"))).toBe(true);
    }
  });
});

/**
 * PostHog Server-Side Client
 *
 * Provides a singleton PostHog Node.js client for server-side event capture
 * (API routes, Server Actions, etc.).
 *
 * Configured with flushAt=1 and flushInterval=0 so events are sent
 * immediately, required for short-lived Next.js server functions.
 *
 * Returns null if NEXT_PUBLIC_POSTHOG_KEY is not set, so callers should
 * use optional chaining: getPostHogClient()?.capture(...)
 */

import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;
let warnedMissingKey = false;

export function getPostHogClient(): PostHog | null {
  if (!posthogClient) {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) {
      if (!warnedMissingKey) {
        console.warn("[PostHog Server] NEXT_PUBLIC_POSTHOG_KEY not set. Server analytics disabled.");
        warnedMissingKey = true;
      }
      return null;
    }
    posthogClient = new PostHog(key, {
      // Server-side uses the direct PostHog host, not the /ingest reverse
      // proxy (which is for browser ad-blocker avoidance only)
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

/**
 * Whether the server may file an event for this request. Never for an account that switched
 * usage analytics off in Settings, and never for a browser sending Global Privacy Control
 * (`Sec-GPC: 1`). The browser's own events stop for both (src/instrumentation-client.ts), and
 * the Privacy Policy says both, so the server's events stop too. A profile that couldn't be
 * read files under no account, which the switch doesn't cover.
 */
export function mayCapture(profile: { analyticsOff?: boolean } | null | undefined, headers: Headers): boolean {
  return profile?.analyticsOff !== true && headers.get("sec-gpc") !== "1";
}

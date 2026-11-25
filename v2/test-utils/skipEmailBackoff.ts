import { vi } from "vitest";

/**
 * Skips sendEmailWithRetry's backoff waits in a test (convex/lib/email.ts: 2^attempt seconds from attempt 0, plus up to half a
 * second of jitter). A real wait matters in production and no test measures it; Nov 24 2026 the two email test files
 * spent 21 s of 25 waiting. Only a delay of exactly that shape is shortened, so the Convex test harness's own timers
 * (scheduled functions) keep their times. Call in beforeEach; vi.restoreAllMocks() in afterEach undoes it.
 */
export function skipEmailBackoff(): void {
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    realSetTimeout(fn, isBackoff(ms) ? 0 : ms, ...args)) as unknown as typeof setTimeout);
}

export function isBackoff(ms: number | undefined): boolean {
  if (ms === undefined) return false;
  for (let attempt = 0; attempt <= 5; attempt++) {
    const base = 2 ** attempt * 1000;
    if (ms >= base && ms <= base + 500) return true;
  }
  return false;
}

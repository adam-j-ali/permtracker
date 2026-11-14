/**
 * Let a convex test's own scheduled work finish before the next test starts.
 *
 * A mutation under test often ends by scheduling an action (`ctx.scheduler.runAfter(0, ...)`): a confirmation
 * email, a sweep's next batch. convex-test runs it on a timer, so when a test returns straight after that
 * mutation, the action is still on its way. It then runs during the NEXT test and sends its email through
 * whichever `fetch` stub is installed by then, so the next test counts an email it never asked for. In file order
 * that had happened to stay invisible. Shuffled, on a slow machine, it failed 2 runs in 6 (Nov 14 2026).
 *
 * A file that stubs `fetch` uses `trackedTestContext` in place of `createTestContext`, and calls
 * `settleScheduled()` FIRST in its `afterEach`, while the test's stubs are still installed.
 */
import { vi } from "vitest";

import { createTestContext } from "./convex";

type TestContext = ReturnType<typeof createTestContext>;

/** The contexts made since the last settle: one test's worth. */
const created: TestContext[] = [];

/** How long a test's leftover work may take before the next test starts anyway. */
const SETTLE_LIMIT_MS = 4000;

/** `createTestContext`, remembered so `settleScheduled` can find it when the test ends. */
export function trackedTestContext(): TestContext {
  const t = createTestContext();
  created.push(t);
  return t;
}

/**
 * Inside a test on real timers: wait for the work the code under test scheduled with no delay, before reading
 * what that work writes (an error row, a stamp). Without it the read races the job, and loses when the job's
 * module is loading for the first time in the run.
 */
export async function finishScheduledNow(t: TestContext): Promise<void> {
  // Three rounds: a job that has just finished may have scheduled the next one.
  for (let round = 0; round < 3; round++) {
    // A zero-delay job hasn't started yet: give it its turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}

/**
 * Wait for what the finished test left running. Bounded: a job waiting on a fake timer that was taken away with
 * the test's fake clock never finishes, and it can no longer send anything either, so the wait gives up on it.
 */
export async function settleScheduled(): Promise<void> {
  const mine = created.splice(0);
  if (mine.length === 0) return;
  // A real turn of the event loop is needed below; a test that left its fake clock in place would hang here.
  if (vi.isFakeTimers()) vi.useRealTimers();
  const settle = (async () => {
    for (const t of mine) await finishScheduledNow(t);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SETTLE_LIMIT_MS);
  });
  await Promise.race([settle.catch(() => undefined), limit]);
  clearTimeout(timer);
}

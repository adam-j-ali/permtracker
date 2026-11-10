/**
 * How password resets end, counted by Eastern day for the morning report.
 *
 * A reset has three steps that fail apart: the code is sent, the person types it with a new password, and the
 * library checks it. Each of the first two has its own error path, but nothing counted whether resets were being
 * COMPLETED, so a reset that sent codes and then refused every one would have looked healthy from every side.
 * Three counts close that: codes sent, resets completed, and codes refused (wrong or expired).
 *
 * Counts only: no address, no account, no code. One row per day per kind (the `authOutcomes` table).
 *
 * This file is the pure half (names, the report's verdict, the wrapper); the database half is
 * convex/lib/authOutcomes.ts.
 */
export const RESET_OUTCOMES = ["resetSent", "resetCompleted", "resetFailed"] as const;
export type ResetOutcome = (typeof RESET_OUTCOMES)[number];

/** The report reads the last seven Eastern days: a day's handful of resets says little alone. */
export const RESET_WINDOW_DAYS = 7;
/**
 * Codes sent in the window before "none completed" is worth a warning. People do ask for a code and never use it,
 * so a few with none completed is ordinary; six in a week with none completed is rarely chance.
 */
export const RESET_QUIET_FLOOR = 6;

export interface ResetCounts {
  days: number;
  sent: number;
  completed: number;
  failed: number;
}

/**
 * The report's line, and whether it's a warning. Pure.
 *
 * Warns when codes went out and no reset completed: at the floor, or sooner when codes were also being refused
 * (sent, typed, turned away, and nobody got through is the broken-reset signature at any volume above two).
 */
export function resetVerdict(c: ResetCounts): { warn: boolean; line: string } {
  const codes = `${c.sent} code${c.sent === 1 ? "" : "s"} sent`;
  const refused = c.failed > 0 ? `, ${c.failed} wrong or expired code${c.failed === 1 ? "" : "s"}` : "";
  const stuck = c.completed === 0 && (c.sent >= RESET_QUIET_FLOOR || (c.sent >= 3 && c.failed >= 3));
  if (stuck) {
    return {
      warn: true,
      line: `Password resets, ${c.days} days: ${codes} and none completed${refused}. Try one from the sign-in page.`,
    };
  }
  return { warn: false, line: `Password resets, ${c.days} days: ${codes}, ${c.completed} completed${refused}` };
}

/**
 * A provider's authorize that counts how each "reset-verification" ends: completed when the library accepts the
 * code and changes the password, failed when it throws (a wrong or expired code, or a password it refuses). Every
 * other flow passes straight through, and the result or the error is the library's own, unchanged.
 */
export function countResetOutcomes<P extends Record<string, unknown>, C, R>(
  authorize: (params: P, ctx: C) => Promise<R>,
  note: (ctx: C, kind: ResetOutcome) => Promise<void>,
): (params: P, ctx: C) => Promise<R> {
  return async (params, ctx) => {
    if (params.flow !== "reset-verification") return authorize(params, ctx);
    const count = async (kind: ResetOutcome) => {
      try {
        await note(ctx, kind);
      } catch (error) {
        console.error(`[authOutcomes] ${kind} was not counted`, error);
      }
    };
    let result: R;
    try {
      result = await authorize(params, ctx);
    } catch (error) {
      await count("resetFailed");
      throw error;
    }
    await count("resetCompleted");
    return result;
  };
}

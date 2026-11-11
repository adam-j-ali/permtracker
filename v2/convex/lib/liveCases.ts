/**
 * An account's live cases: its own work that is still open. Not a deleted case, not a
 * closed one, and not the sample case setup adds. One rule for every count that says
 * "your N cases" (the weekly summary, the re-engagement email).
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** How many live cases an account has. Reads only that account's undeleted cases. */
export async function countLiveCases(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<number> {
  let live = 0;
  for await (const c of ctx.db
    .query("cases")
    .withIndex("by_user_and_deleted", (q) => q.eq("userId", userId).eq("deletedAt", undefined))) {
    if (c.caseStatus !== "closed" && c.isSample !== true) live += 1;
  }
  return live;
}

/**
 * A saved case order holds only the caller's own cases (Nov 25 2026). It was never a leak: getCaseOrder returns the
 * row to its owner and nothing loads a case by these ids. But the mutation stored whatever ids it was given, and the
 * list had no length cap.
 */
import { describe, expect, it } from "vitest";

import { createAuthenticatedContext, createTestContext, finishScheduledFunctions, setupSchedulerTests } from "../../test-utils/convex";
import { api } from "../_generated/api";

const ORDER = { filters: {}, baseSortMethod: "deadline" as const, baseSortOrder: "asc" as const };
const make = (user: Awaited<ReturnType<typeof createAuthenticatedContext>>, name: string) =>
  user.mutation(api.cases.create, { employerName: name, beneficiaryIdentifier: "Person", positionTitle: "Engineer" });

describe("saveCaseOrder", () => {
  setupSchedulerTests();

  it("keeps the caller's own cases, in the order given, and drops anyone else's", async () => {
    const t = createTestContext();
    const me = await createAuthenticatedContext(t, "Me");
    const other = await createAuthenticatedContext(t, "Other");
    const a = await make(me, "A Co");
    const b = await make(me, "B Co");
    const theirs = await make(other, "C Co");
    await finishScheduledFunctions(t);
    await me.mutation(api.userCaseOrder.saveCaseOrder, { caseIds: [b, theirs, a], ...ORDER });
    expect((await me.query(api.userCaseOrder.getCaseOrder, {}))?.caseIds).toEqual([b, a]);
  });

  it("refuses a list longer than any account holds", async () => {
    const t = createTestContext();
    const me = await createAuthenticatedContext(t, "Me");
    const a = await make(me, "A Co");
    await finishScheduledFunctions(t);
    await expect(
      me.mutation(api.userCaseOrder.saveCaseOrder, { caseIds: Array.from({ length: 5001 }, () => a), ...ORDER }),
    ).rejects.toThrow(/too many/i);
  });
});

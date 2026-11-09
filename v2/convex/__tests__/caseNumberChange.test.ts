import { describe, expect, it } from "vitest";
import { createAuthenticatedContext, createTestContext, finishScheduledFunctions, setupSchedulerTests } from "../../test-utils/convex";
import { api } from "../_generated/api";

/**
 * A new DOL number on a saved case is a different DOL case. Its live status starts over, so the watch seeds it
 * silently, and the old case's status is never announced as a move of this one (the Nov 9 2026 review).
 */
setupSchedulerTests();

async function seed() {
  const t = createTestContext();
  const owner = await createAuthenticatedContext(t, "Owner");
  const caseId = await owner.mutation(api.cases.create, {
    employerName: "Acme",
    positionTitle: "Engineer",
    caseNumber: "G-100-25324-425560",
  });
  await finishScheduledFunctions(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(caseId, { liveStatus: "ANALYST REVIEW", liveStatusSeenAt: 1, liveStatusIsFinal: false });
  });
  const live = async () => {
    const c = await t.run(async (ctx) => ctx.db.get(caseId));
    return { liveStatus: c!.liveStatus, liveStatusSeenAt: c!.liveStatusSeenAt, liveStatusIsFinal: c!.liveStatusIsFinal };
  };
  return { owner, caseId, live };
}

describe("changing a saved case's DOL number", () => {
  it("drops the old number's live status", async () => {
    const { owner, caseId, live } = await seed();
    await owner.mutation(api.cases.update, { id: caseId, caseNumber: "G-100-25300-111111" });
    expect(await live()).toEqual({ liveStatus: undefined, liveStatusSeenAt: undefined, liveStatusIsFinal: undefined });
  });

  it("drops it when the number is cleared", async () => {
    const { owner, caseId, live } = await seed();
    await owner.mutation(api.cases.update, { id: caseId, caseNumber: null });
    expect((await live()).liveStatus).toBeUndefined();
  });

  it("keeps it when the same number is written another way", async () => {
    const { owner, caseId, live } = await seed();
    await owner.mutation(api.cases.update, { id: caseId, caseNumber: " g-100-25324-425560 " });
    expect((await live()).liveStatus).toBe("ANALYST REVIEW");
  });

  it("keeps it for an edit that doesn't touch the number, the control", async () => {
    const { owner, caseId, live } = await seed();
    await owner.mutation(api.cases.update, { id: caseId, positionTitle: "Senior Engineer" });
    expect((await live()).liveStatus).toBe("ANALYST REVIEW");
  });
});

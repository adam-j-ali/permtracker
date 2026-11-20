import { describe, expect, it } from "vitest";

import { createAuthenticatedContext, createTestContext, finishScheduledFunctions, setupSchedulerTests } from "../../test-utils/convex";
import { api, internal } from "../_generated/api";

const ETA = "G-100-25318-409609";
const PWD = "P-100-25210-123456";

describe("a DOL number typed in any box is the one the watch follows", () => {
  setupSchedulerTests();

  it("carries a step's number into the case's DOL number on create and as the case moves on", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User");
    const id = await user.mutation(api.cases.create, {
      employerName: "FMR LLC",
      beneficiaryIdentifier: "Person",
      positionTitle: "Engineer",
      pwdCaseNumber: PWD,
    });
    await finishScheduledFunctions(t);
    expect((await user.query(api.cases.get, { id }))?.caseNumber).toBe(PWD);

    await user.mutation(api.cases.update, { id, eta9089CaseNumber: ETA });
    await finishScheduledFunctions(t);
    expect((await user.query(api.cases.get, { id }))?.caseNumber).toBe(ETA);

    // A number the person types in the DOL case number box is theirs and stays.
    await user.mutation(api.cases.update, { id, caseNumber: "G-200-24001-000001" });
    await user.mutation(api.cases.update, { id, eta9089CaseNumber: "G-100-25318-409601" });
    await finishScheduledFunctions(t);
    expect((await user.query(api.cases.get, { id }))?.caseNumber).toBe("G-200-24001-000001");
  });

  it("fills the cases saved before, missing or blank, and leaves the rest", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User");
    // Saved as the code before Nov 20 2026 left them: the number only in a step's box.
    const make = async (more: Record<string, string>) =>
      user.mutation(api.cases.create, { employerName: "FMR LLC", beneficiaryIdentifier: "Person", positionTitle: "Engineer", ...more });
    const ids = { missing: await make({ eta9089CaseNumber: ETA }), blank: await make({ pwdCaseNumber: PWD }), none: await make({}) };
    await finishScheduledFunctions(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.missing, { caseNumber: undefined });
      await ctx.db.patch(ids.blank, { caseNumber: "" });
    });
    for (const blank of [false, true]) {
      const dry = await t.mutation(internal.caseDataBackfills.dolCaseNumbers, { blank, dryRun: true });
      expect(dry.changed).toBe(1);
      const r = await t.mutation(internal.caseDataBackfills.dolCaseNumbers, { blank });
      expect([r.changed, r.done]).toEqual([1, true]);
    }
    const after = await t.run(async (ctx) =>
      Promise.all([ids.missing, ids.blank, ids.none].map(async (id) => (await ctx.db.get(id))?.caseNumber ?? null)),
    );
    expect(after).toEqual([ETA, PWD, null]);
  });
});

/**
 * A person tracking their own case may know neither the employer's exact name nor the job title: a case saves
 * without either, and the places that read a case back (the list, the duplicate check, the import) cope with it.
 */
import { describe, expect, it } from "vitest";
import {
  createAuthenticatedContext,
  createTestContext,
  finishScheduledFunctions,
  setupSchedulerTests,
} from "../../test-utils/convex";
import { api } from "../_generated/api";

setupSchedulerTests();

async function owner() {
  const t = createTestContext();
  const me = await createAuthenticatedContext(t, "Owner");
  return { t, me };
}

describe("a case without an employer or a job title", () => {
  it("saves with neither, stored as empty text", async () => {
    const { t, me } = await owner();
    const caseId = await me.mutation(api.cases.create, { i485FilingDate: "2025-01-02" });
    await finishScheduledFunctions(t);
    const c = await t.run(async (ctx) => (await ctx.db.get(caseId))!);
    expect(c.employerName).toBe("");
    expect(c.positionTitle).toBe("");
    expect(c.caseStatus).toBe("i485");
  });

  it("previews like create does", async () => {
    const { me } = await owner();
    const preview = await me.query(api.cases.previewCreate, {});
    expect(preview.valid).toBe(true);
  });

  it("trims a name of only spaces to nothing", async () => {
    const { t, me } = await owner();
    const caseId = await me.mutation(api.cases.create, { employerName: "   ", positionTitle: "  " });
    await finishScheduledFunctions(t);
    const c = await t.run(async (ctx) => (await ctx.db.get(caseId))!);
    expect(c.employerName).toBe("");
    expect(c.positionTitle).toBe("");
  });

  it("sorts after every named case when the list is sorted by employer", async () => {
    const { t, me } = await owner();
    await me.mutation(api.cases.create, {});
    await me.mutation(api.cases.create, { employerName: "Beta", positionTitle: "Analyst" });
    await me.mutation(api.cases.create, { employerName: "Alpha", positionTitle: "Engineer" });
    await finishScheduledFunctions(t);
    for (const sortOrder of ["asc", "desc"] as const) {
      const list = await me.query(api.cases.listFiltered, { sortBy: "employer", sortOrder });
      const names = list.cases.map((c: { employerName: string }) => c.employerName);
      expect(names[names.length - 1]).toBe("");
    }
  });

  it("isn't called a duplicate of another case that has no employer", async () => {
    const { t, me } = await owner();
    await me.mutation(api.cases.create, {});
    await finishScheduledFunctions(t);
    const { duplicates } = await me.query(api.cases.checkDuplicates, { cases: [{ employerName: "" }] });
    expect(duplicates).toHaveLength(0);
  });

  it("imports, and two imported cases without an employer both land", async () => {
    const { t, me } = await owner();
    const result = await me.mutation(api.cases.importCases, {
      cases: [
        { employerName: "", beneficiaryIdentifier: "" },
        { employerName: "", beneficiaryIdentifier: "" },
      ],
    });
    await finishScheduledFunctions(t);
    expect(result.importedCount).toBe(2);
  });
});

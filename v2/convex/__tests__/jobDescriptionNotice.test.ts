/**
 * The "Job description updated" notice goes only when the job description changed.
 *
 * The edit form sends `null` for every empty field it can clear (`prepareUpdatePayload`), so a case with no job
 * description arrives with `jobDescription: null` on every save. Empty stayed empty: that isn't a change, and the
 * notice used to go on each of those saves. Each test below also proves the other direction, so a rule that
 * stopped every notice would fail as surely as one that sent them all.
 */
import { describe, it, expect } from "vitest";
import {
  createTestContext,
  createAuthenticatedContext,
  setupSchedulerTests,
  finishScheduledFunctions,
} from "../../test-utils/convex";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const TITLE = "Job description updated";

async function noticesFor(t: ReturnType<typeof createTestContext>, caseId: Id<"cases">) {
  return t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter((n) => n.caseId === caseId && n.title === TITLE),
  );
}

async function newCase(extra: { jobDescription?: string } = {}) {
  const t = createTestContext();
  const user = await createAuthenticatedContext(t, "Notice Person");
  const caseId = await user.mutation(api.cases.create, {
    employerName: "Real Co",
    positionTitle: "Engineer",
    ...extra,
  });
  await finishScheduledFunctions(t);
  return { t, user, caseId };
}

describe("the job description notice", () => {
  setupSchedulerTests();

  it("doesn't go when a case with no job description is saved with the form's empty value", async () => {
    const { t, user, caseId } = await newCase();
    await user.mutation(api.cases.update, { id: caseId, positionTitle: "Senior Engineer", jobDescription: null });
    await finishScheduledFunctions(t);
    expect(await noticesFor(t, caseId)).toHaveLength(0);

    await user.mutation(api.cases.update, { id: caseId, jobDescription: "" });
    await finishScheduledFunctions(t);
    expect(await noticesFor(t, caseId)).toHaveLength(0);
  });

  it("goes once when the job description is written, and not again when the same text is saved", async () => {
    const { t, user, caseId } = await newCase();
    await user.mutation(api.cases.update, { id: caseId, jobDescription: "Design and build data pipelines." });
    await finishScheduledFunctions(t);
    expect(await noticesFor(t, caseId)).toHaveLength(1);

    await user.mutation(api.cases.update, { id: caseId, jobDescription: "Design and build data pipelines." });
    await finishScheduledFunctions(t);
    expect(await noticesFor(t, caseId)).toHaveLength(1);
  });

  it("goes when a written job description is cleared", async () => {
    const { t, user, caseId } = await newCase({ jobDescription: "Design and build data pipelines." });
    await user.mutation(api.cases.update, { id: caseId, jobDescription: null });
    await finishScheduledFunctions(t);
    expect(await noticesFor(t, caseId)).toHaveLength(1);
  });

  it("names the position by the title the same save gave it", async () => {
    const { t, user, caseId } = await newCase();
    await user.mutation(api.cases.update, {
      id: caseId,
      positionTitle: "Senior Engineer",
      jobDescription: "Design and build data pipelines.",
    });
    await finishScheduledFunctions(t);
    const [notice] = await noticesFor(t, caseId);
    expect(notice?.message).toBe("The job description for Senior Engineer at Real Co was updated.");
  });
});

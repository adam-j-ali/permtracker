import { describe, it, expect } from "vitest";
import { createTestContext, createAuthenticatedContext, setupSchedulerTests, finishScheduledFunctions } from "../test-utils/convex";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type T = ReturnType<typeof createTestContext>;
type User = Awaited<ReturnType<typeof createAuthenticatedContext>>;

async function newCase(t: T, user: User, name: string, more: Record<string, unknown> = {}): Promise<Id<"cases">> {
  const id = await user.mutation(api.cases.create, {
    employerName: name,
    beneficiaryIdentifier: "Person",
    positionTitle: "Engineer",
    ...more,
  });
  await finishScheduledFunctions(t);
  return id;
}

const closedCase = { caseStatus: "closed", progressStatusOverride: true } as const;

async function shown(user: User): Promise<string[]> {
  const cases = await user.query(api.timeline.getCasesForTimeline, {});
  return cases.map((c) => c.employerName).sort();
}

describe("Timeline settings", () => {
  setupSchedulerTests();

  it("returns the default range for a new account and the saved one after", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    expect(await user.query(api.timeline.getPreferences, {})).toEqual({ selectedCaseIds: null, timeRange: 12 });
    await user.mutation(api.timeline.updatePreferences, { timeRange: 6 });
    await user.mutation(api.timeline.updatePreferences, { timeRange: 24 });
    expect((await user.query(api.timeline.getPreferences, {})).timeRange).toBe(24);
  });

  it("returns the defaults and no cases when signed out", async () => {
    const t = createTestContext();
    expect(await t.query(api.timeline.getPreferences, {})).toEqual({ selectedCaseIds: null, timeRange: 12 });
    expect(await t.query(api.timeline.getCasesForTimeline, {})).toEqual([]);
  });
});

describe("Which cases the timeline shows: each case's own switch", () => {
  setupSchedulerTests();

  it("shows every open case and no closed one until a switch is set", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    await newCase(t, user, "Open");
    await newCase(t, user, "Closed", closedCase);
    expect(await shown(user)).toEqual(["Open"]);
  });

  it("reads the form's switch and the menu's as one: off in the form, the menu puts it back", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    const id = await newCase(t, user, "Open", { showOnTimeline: false });
    expect(await shown(user)).toEqual([]);
    await user.mutation(api.timeline.addCaseToTimeline, { caseId: id });
    expect(await shown(user)).toEqual(["Open"]);
    expect((await user.query(api.cases.get, { id }))?.showOnTimeline).toBeUndefined();
  });

  it("takes the only open case off and shows nothing, never every case", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    const id = await newCase(t, user, "Open");
    await newCase(t, user, "Closed", closedCase);
    await user.mutation(api.timeline.removeCaseFromTimeline, { caseId: id });
    expect(await shown(user)).toEqual([]);
  });

  it("puts a closed case on without taking the open ones off", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    await newCase(t, user, "Open");
    const closed = await newCase(t, user, "Closed", closedCase);
    await user.mutation(api.timeline.addCaseToTimeline, { caseId: closed });
    expect(await shown(user)).toEqual(["Closed", "Open"]);
  });

  it("shows a case added after a pick", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    const a = await newCase(t, user, "A");
    await newCase(t, user, "B");
    await user.mutation(api.timeline.updatePreferences, { selectedCaseIds: [a] });
    expect(await shown(user)).toEqual(["A"]);
    await newCase(t, user, "C");
    expect(await shown(user)).toEqual(["A", "C"]);
  });

  it("shows exactly the cases picked, none for an empty pick, and every open one again for null", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    await newCase(t, user, "A");
    const b = await newCase(t, user, "B");
    const c = await newCase(t, user, "C", closedCase);
    await user.mutation(api.timeline.updatePreferences, { selectedCaseIds: [b, c] });
    expect(await shown(user)).toEqual(["B", "C"]);
    await user.mutation(api.timeline.updatePreferences, { selectedCaseIds: [] });
    expect(await shown(user)).toEqual([]);
    await user.mutation(api.timeline.updatePreferences, { selectedCaseIds: null });
    expect(await shown(user)).toEqual(["A", "B"]);
  });

  it("keeps an unset switch unset when the form sends it back unchanged, so the case leaves once it closes", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    const id = await newCase(t, user, "Open");
    await user.mutation(api.cases.update, { id, showOnTimeline: true, notes: [] });
    await finishScheduledFunctions(t);
    expect((await user.query(api.cases.get, { id }))?.showOnTimeline).toBeUndefined();
    await user.mutation(api.cases.update, { id, ...closedCase });
    await finishScheduledFunctions(t);
    expect(await shown(user)).toEqual([]);
  });

  it("refuses another account's case and a deleted one", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    const other = await createAuthenticatedContext(t, "Other");
    const id = await newCase(t, owner, "Owner Corp");
    await expect(other.mutation(api.timeline.addCaseToTimeline, { caseId: id })).rejects.toThrow("Case not found");
    await expect(other.mutation(api.timeline.removeCaseFromTimeline, { caseId: id })).rejects.toThrow("Case not found");
    expect(await shown(owner)).toEqual(["Owner Corp"]);
    expect(await shown(other)).toEqual([]);
    await owner.mutation(api.cases.remove, { id });
    await finishScheduledFunctions(t);
    await expect(owner.mutation(api.timeline.addCaseToTimeline, { caseId: id })).rejects.toThrow("Case not found");
    expect(await shown(owner)).toEqual([]);
  });

  it("returns each case with its timeline dates", async () => {
    const t = createTestContext();
    const user = await createAuthenticatedContext(t, "User 1");
    await newCase(t, user, "Test Corp", {
      caseStatus: "recruitment",
      progressStatusOverride: true,
      progressStatus: "working",
      pwdFilingDate: "2024-01-15",
      pwdDeterminationDate: "2024-02-15",
      pwdExpirationDate: "2025-06-30",
      sundayAdFirstDate: "2024-03-03",
      sundayAdSecondDate: "2024-03-10",
      jobOrderStartDate: "2024-03-01",
      jobOrderEndDate: "2024-03-31",
    });
    const [c] = await user.query(api.timeline.getCasesForTimeline, {});
    expect(c).toMatchObject({
      employerName: "Test Corp",
      positionTitle: "Engineer",
      caseStatus: "recruitment",
      progressStatus: "working",
      pwdFilingDate: "2024-01-15",
      pwdDeterminationDate: "2024-02-15",
      pwdExpirationDate: "2025-06-30",
      sundayAdFirstDate: "2024-03-03",
      sundayAdSecondDate: "2024-03-10",
      jobOrderStartDate: "2024-03-01",
      jobOrderEndDate: "2024-03-31",
      rfiEntries: [],
      rfeEntries: [],
    });
  });
});

describe("The one-time move from the old list to the switches", () => {
  setupSchedulerTests();

  /** Every page of a backfill, as it's run by hand. */
  async function runAll(t: T, fn: "timelineSwitches" | "clearTimelineLists", dryRun = false): Promise<number> {
    let cursor: string | null = null;
    let changed = 0;
    for (let i = 0; i < 50; i++) {
      const r: { changed: number; cursor: string; done: boolean } = await t.mutation(internal.caseDataBackfills[fn], {
        cursor,
        dryRun,
      });
      changed += r.changed;
      if (r.done) return changed;
      cursor = r.cursor;
    }
    throw new Error("didn't finish");
  }

  it("keeps every account's timeline showing the cases it showed, then retires the lists", async () => {
    const t = createTestContext();
    // An account that picked: A and the closed C; B left off.
    const picked = await createAuthenticatedContext(t, "Picked");
    const a = await newCase(t, picked, "A");
    await newCase(t, picked, "B");
    const c = await newCase(t, picked, "C", closedCase);
    // An account that never picked, with the old form's "on" stored on a closed case.
    const never = await createAuthenticatedContext(t, "Never");
    const d = await newCase(t, never, "D");
    const e = await newCase(t, never, "E", closedCase);
    // An account whose only open case was removed: the old reader then showed every case.
    const emptied = await createAuthenticatedContext(t, "Emptied");
    await newCase(t, emptied, "F");
    await newCase(t, emptied, "G", closedCase);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(d, { showOnTimeline: true });
      await ctx.db.patch(e, { showOnTimeline: true });
      for (const [userId, list] of [
        [picked.userId, [a, c]],
        [emptied.userId, []],
      ] as const) {
        await ctx.db.insert("timelinePreferences", { userId, selectedCaseIds: [...list], timeRange: 12, createdAt: now, updatedAt: now });
      }
    });
    const before = { picked: ["A", "C"], never: ["D"], emptied: ["F", "G"] };

    expect(await runAll(t, "timelineSwitches", true)).toBeGreaterThan(0);
    expect(await t.run(async (ctx) => (await ctx.db.get(d))?.showOnTimeline)).toBe(true); // the dry run wrote nothing

    await runAll(t, "timelineSwitches");
    expect(await runAll(t, "timelineSwitches")).toBe(0); // a second run finds nothing to do
    expect(await runAll(t, "clearTimelineLists")).toBe(2);
    expect({ picked: await shown(picked), never: await shown(never), emptied: await shown(emptied) }).toEqual(before);
    expect(await t.run(async (ctx) => (await ctx.db.query("timelinePreferences").take(10)).map((p) => p.selectedCaseIds === undefined))).toEqual([
      true,
      true,
    ]);
  });
});

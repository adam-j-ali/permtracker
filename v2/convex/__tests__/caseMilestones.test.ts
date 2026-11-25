import { describe, expect, it } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { internal } from "../_generated/api";

/**
 * The legacy milestone reports: a closed table. Community timelines took their
 * place (convex/communityTimelines.ts), so nothing may add a row any more,
 * over HTTP or otherwise, and the rows already there still read back as
 * counts.
 */

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const CASE = "G-100-25324-425560";

type Kind = "i140-filed" | "i140-approved" | "i485-filed" | "i485-approved";

async function seed(t: ReturnType<typeof createTestContext>, kind: Kind, eventDate: string, ipHash: string) {
  await t.run((ctx) => ctx.db.insert("caseMilestones", { caseNumber: CASE, kind, eventDate, submittedAt: Date.now(), ipHash }));
}

describe("the milestone write route", () => {
  it("is gone: a report sent over HTTP finds no route and writes nothing", async () => {
    const t = createTestContext();
    const res = await t.fetch("/milestone/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseNumber: CASE, kind: "i140-filed", eventDate: "2026-06-01" }),
    });
    expect(res.status).toBe(404);
    const preflight = await t.fetch("/milestone/report", { method: "OPTIONS" });
    expect(preflight.status).toBe(404);
    const rows = await t.run((ctx) => ctx.db.query("caseMilestones").take(10));
    expect(rows).toHaveLength(0);
  });
});

describe("caseMilestones.summary", () => {
  it("reads the rows already there back as counts with the latest date", async () => {
    const t = createTestContext();
    await seed(t, "i140-filed", "2026-06-01", HASH_A);
    await seed(t, "i140-filed", "2026-06-03", HASH_B);
    const s = await t.query(internal.caseMilestones.summary, { caseNumber: CASE });
    expect(s.reports).toBe(2);
    expect(s.reporters).toBe(2);
    expect(s.kinds.find((k) => k.kind === "i140-filed")).toMatchObject({ count: 2, latest: "2026-06-03" });
    expect(s.kinds.find((k) => k.kind === "i485-filed")).toMatchObject({ count: 0, latest: null });
  });

  it("reads nothing for a number that isn't a PERM case", async () => {
    const t = createTestContext();
    await seed(t, "i140-filed", "2026-06-01", HASH_A);
    const s = await t.query(internal.caseMilestones.summary, { caseNumber: "P-100-26125-868956" });
    expect(s.reports).toBe(0);
  });

  it("still answers over HTTP", async () => {
    const t = createTestContext();
    await seed(t, "i485-filed", "2026-07-01", HASH_A);
    const res = await t.fetch(`/milestone/summary?case=${CASE}`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ caseNumber: CASE, reports: 1 });
  });
});

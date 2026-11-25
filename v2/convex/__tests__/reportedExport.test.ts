/**
 * GET /reported-export (convex/http.ts): the shared timelines and consulate reports the server merges into the list of
 * reported cases (scripts/build_reported_cases.py --from-convex). It hands over dates and categories only, never a case
 * number, a hash or a person's words; only rows a page could show; and nothing without the server's secret.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext } from "../../test-utils/convex";

const SECRET = "test-watched-secret-0123456789";
const NOW = Date.UTC(2026, 10, 19, 20, 0);

async function seed(t: ReturnType<typeof createTestContext>) {
  await t.run(async (ctx) => {
    const base = { editKeyHash: "k", ipHash: "ip", createdAt: NOW, updatedAt: NOW };
    await ctx.db.insert("communityTimelines", {
      ...base, caseNumber: "G-100-25213-000001", public: true, status: "approved", category: "eb2", country: "india",
      route: "adjustment", fieldOffice: "SFV", i485FiledOn: "2026-06-12", biometricsOn: "2026-07-08",
      officeMovedOn: "2026-09-24", greenCardOn: "2026-11-03", permFiledOn: "2025-08-01", permCertifiedOn: "2026-05-02",
    });
    await ctx.db.insert("communityTimelines", { ...base, editKeyHash: "k2", public: false, status: "approved", category: "eb3", i140FiledOn: "2026-01-02" });
    await ctx.db.insert("communityTimelines", { ...base, editKeyHash: "k3", public: true, status: "pending", category: "eb3" });
    await ctx.db.insert("communityTimelines", { ...base, editKeyHash: "k4", public: true, status: "declined", category: "eb3" });
    await ctx.db.insert("communityTimelines", { ...base, editKeyHash: "k5", public: true, status: "approved", hiddenAt: NOW });
    await ctx.db.insert("consularReports", {
      post: "mumbai", category: "employment", line: "eb3", nvcCompleteMonth: "2026-03", scheduledOn: "2026-05-02",
      interviewOn: "2026-06-10", outcome: "221g", editKeyHash: "c1", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("consularReports", {
      post: "mumbai", category: "employment", line: "eb2", outcome: "issued", hidden: true, editKeyHash: "c2", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("consularReports", {
      post: "chennai", category: "h1b", outcome: "issued", editKeyHash: "c3", createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("the reported-cases export", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is off, not open, when no secret is set, and refuses a wrong one", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", "");
    const t = createTestContext();
    expect((await t.fetch("/reported-export", { headers: { "x-watched-secret": "x" } })).status).toBe(503);
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    expect((await t.fetch("/reported-export", { headers: { "x-watched-secret": "wrong" } })).status).toBe(401);
    expect((await t.fetch("/reported-export")).status).toBe(401);
  });

  it("hands over the shown timelines' dates, a private one marked private, and no case number or hash", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    const t = createTestContext();
    await seed(t);
    const res = await t.fetch("/reported-export", { headers: { "x-watched-secret": SECRET } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; timelines: Record<string, unknown>[]; consular: Record<string, unknown>[] };
    expect(body.ok).toBe(true);
    expect(body.timelines).toHaveLength(2);
    const shared = body.timelines.find((r) => r.public === true)!;
    expect(shared).toMatchObject({ fieldOffice: "SFV", officeMovedOn: "2026-09-24", permCertifiedOn: "2026-05-02", category: "eb2" });
    expect(body.timelines.some((r) => r.public === false && r.i140FiledOn === "2026-01-02")).toBe(true);
    const text = JSON.stringify(body);
    for (const never of ["G-100-25213-000001", "editKeyHash", "ipHash", '"k"', '"ip"', "caseNumber"]) expect(text).not.toContain(never);
  });

  it("hands over employment-based consulate reports a page shows, and nothing else", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    const t = createTestContext();
    await seed(t);
    const res = await t.fetch("/reported-export", { headers: { "x-watched-secret": SECRET } });
    const body = (await res.json()) as { consular: Record<string, unknown>[] };
    expect(body.consular).toHaveLength(1);
    expect(body.consular[0]).toMatchObject({ post: "mumbai", line: "eb3", outcome: "221g", interviewOn: "2026-06-10" });
    expect(JSON.stringify(body.consular)).not.toContain("editKeyHash");
  });

  // D7 (Nov 25 2026): the server's summary works out every figure over people's reports, so the export carries what
  // the figures read: a spouse's H-4 papers with the work permit's route resolved here, and every RFE's form and dates.
  it("hands over the H-4 papers, the route they went in by and every RFE's dates, never an RFE's reason", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    const t = createTestContext();
    await t.run(async (ctx) => {
      await ctx.db.insert("communityTimelines", {
        editKeyHash: "h", ipHash: "ip", createdAt: NOW, updatedAt: NOW, public: true, status: "approved", category: "eb2",
        h4FiledOn: "2026-03-01", h4ApprovedOn: "2026-06-01", h4EadFiledOn: "2026-03-01", h4EadApprovedOn: "2026-07-01",
        rfeForm: "i140", rfeReason: "ability-to-pay", rfeIssuedOn: "2026-02-01", rfeRespondedOn: "2026-02-20", rfeOutcome: "approved",
        moreRfes: [{ form: "i485", reason: "medical", issuedOn: "2026-09-01", respondedOn: "2026-09-20", outcome: "pending" }],
      });
    });
    const body = (await (await t.fetch("/reported-export", { headers: { "x-watched-secret": SECRET } })).json()) as {
      timelines: Record<string, unknown>[];
    };
    expect(body.timelines[0]).toMatchObject({
      h4FiledOn: "2026-03-01", h4ApprovedOn: "2026-06-01", h4EadFiledOn: "2026-03-01", h4EadApprovedOn: "2026-07-01",
      // No answer given, and the two filing days are one day: filed with the I-539 (h4EadRoute).
      h4EadRoute: "with-i539",
      moreRfes: [{ form: "i485", issuedOn: "2026-09-01", respondedOn: "2026-09-20" }],
    });
    const text = JSON.stringify(body.timelines);
    for (const never of ["ability-to-pay", "medical", "rfeReason"]) expect(text).not.toContain(never);
  });

  it("hands over every shown consulate report, any kind of visa, with what the reports' own figures read", async () => {
    vi.stubEnv("WATCHED_CASES_SECRET", SECRET);
    const t = createTestContext();
    await seed(t);
    const body = (await (await t.fetch("/reported-export", { headers: { "x-watched-secret": SECRET } })).json()) as {
      reports: Record<string, unknown>[];
    };
    expect(body.reports.map((r) => r.post).sort()).toEqual(["chennai", "mumbai"]);
    expect(body.reports.find((r) => r.post === "chennai")).toMatchObject({ category: "h1b", outcome: "issued", updatedAt: NOW });
    expect(body.reports.find((r) => r.post === "mumbai")).toMatchObject({
      category: "employment", line: "eb3", nvcCompleteMonth: "2026-03", interviewOn: "2026-06-10", outcome: "221g",
    });
    const text = JSON.stringify(body.reports);
    for (const never of ["editKeyHash", "ipHash", '"c1"', "_id"]) expect(text).not.toContain(never);
  });
});

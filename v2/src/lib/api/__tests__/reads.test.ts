import { beforeEach, describe, expect, it, vi } from "vitest";

// The entity answers carry two dates: the last decision in DOL's published
// files (meta.asOf) and the sweep that read DOL's live status (pendingNow.asOf).
// Both were null before Oct 3 2026, so an assistant quoting the counts had no
// date to give.
const getEntityBySlug = vi.fn();
const getFreshness = vi.fn();
const entityPending = vi.fn();
const searchByName = vi.fn();

vi.mock("@/lib/db/publicData", () => ({
  getEntityBySlug: (...a: unknown[]) => getEntityBySlug(...a),
  getFreshness: (...a: unknown[]) => getFreshness(...a),
  getLiveBacklog: vi.fn(),
}));
vi.mock("@/lib/db/entityDetail", () => ({ entityPending: (...a: unknown[]) => entityPending(...a) }));
vi.mock("@/lib/db/entities", () => ({ searchByName: (...a: unknown[]) => searchByName(...a) }));
const lookupCase = vi.fn();
vi.mock("@/lib/db/caseLookup", () => ({ lookupCase: (...a: unknown[]) => lookupCase(...a) }));
vi.mock("@/lib/db/client", () => ({ one: vi.fn() }));
vi.mock("@/lib/db/processingTimes", () => ({ getProcessingTimes: vi.fn() }));
vi.mock("@/lib/db/pwdCases", () => ({ pwd: {} }));
vi.mock("@/lib/db/lcaCases", () => ({ lca: {} }));
const seasonalLookup = vi.fn();
const seasonalDisclosed = vi.fn();
const seasonalRecord = vi.fn();
const seasonalPosting = vi.fn();
vi.mock("@/lib/db/seasonalCases", () => ({
  seasonal: {
    lookup: (...a: unknown[]) => seasonalLookup(...a),
    lookupDisclosed: (...a: unknown[]) => seasonalDisclosed(...a),
  },
  lookupSeasonalRecord: (...a: unknown[]) => seasonalRecord(...a),
  lookupSeasonalPosting: (...a: unknown[]) => seasonalPosting(...a),
}));
const estimatePermCase = vi.fn();
vi.mock("@/lib/db/permEstimate", () => ({
  estimatePermCase: (...a: unknown[]) => estimatePermCase(...a),
  loadPermEstimateContext: vi.fn(async () => ({})),
}));

const findCase = vi.fn();
vi.mock("@/lib/findCase", () => ({ findCase: (...a: unknown[]) => findCase(...a) }));

import { getLiveBacklog } from "@/lib/db/publicData";
import { getProcessingTimes } from "@/lib/db/processingTimes";
import { findCases, readCase, readEntity, readEstimate, readQueue, searchEntities } from "../reads";

const adobe = {
  slug: "adobe-inc",
  name: "Adobe Inc.",
  rank: 40,
  total: 1200,
  certified: 1100,
  denied: 20,
  medianDays: 480,
  medianAnnualWage: 180000,
  state: "CA",
  code: null,
  recent12m: 300,
};

beforeEach(() => {
  getEntityBySlug.mockReset().mockResolvedValue(adobe);
  getFreshness.mockReset().mockResolvedValue({
    "perm-cases": { asOf: "2026-06-30T00:00:00Z" },
    "perm-case-status": { asOf: "2026-10-02T09:14:00Z" },
  });
  entityPending.mockReset().mockResolvedValue({
    tracked: 230,
    pending: 224,
    stages: [
      { status: "APPLICATION ON HOLD", n: 216 },
      { status: "ANALYST REVIEW", n: 8 },
    ],
    oldest: "2025-02-11T00:00:00Z",
  });
  searchByName.mockReset().mockResolvedValue([adobe]);
});

describe("readEntity", () => {
  it("dates the published counts and the live pending count separately", async () => {
    const r = await readEntity("employer", "adobe-inc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.asOf).toBe("2026-06-30");
    expect(r.data.pendingNow).toEqual({
      pending: 224,
      casesTracked: 230,
      byStatus: [
        { status: "APPLICATION ON HOLD", cases: 216 },
        { status: "ANALYST REVIEW", cases: 8 },
      ],
      oldestPendingFiled: "2025-02-11",
      asOf: "2026-10-02",
    });
  });

  it("answers without the pending block when the live read fails", async () => {
    entityPending.mockRejectedValue(new Error("db down"));
    const r = await readEntity("employer", "adobe-inc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pendingNow).toBeNull();
  });

  it("answers with null dates when the freshness read fails", async () => {
    getFreshness.mockRejectedValue(new Error("db down"));
    const r = await readEntity("employer", "adobe-inc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.asOf).toBeNull();
    expect((r.data.pendingNow as { asOf: string | null }).asOf).toBeNull();
  });

  it("still 404s a name with no page", async () => {
    getEntityBySlug.mockResolvedValue(null);
    const r = await readEntity("employer", "nobody-here");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("searchEntities", () => {
  it("dates the results by the published files", async () => {
    const r = await searchEntities("employer", "adobe");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta.asOf).toBe("2026-06-30");
  });
});

describe("fields by kind", () => {
  it("gives an employer no wage, state or occupation code", async () => {
    const r = await readEntity("employer", "adobe-inc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).not.toHaveProperty("medianAnnualWage");
    expect(r.data).not.toHaveProperty("state");
    expect(r.data).not.toHaveProperty("occupationCode");
  });

  it("gives an occupation its code and median wage", async () => {
    getEntityBySlug.mockResolvedValue({ ...adobe, slug: "software-developers", code: "15-1252", medianAnnualWage: 150000 });
    const r = await readEntity("occupation", "software-developers");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.occupationCode).toBe("15-1252");
    expect(r.data.medianAnnualWage).toBe(150000);
    expect(r.data).not.toHaveProperty("state");
  });

  it("gives a law firm its state", async () => {
    getEntityBySlug.mockResolvedValue({ ...adobe, slug: "fragomen", state: "NY" });
    const r = await readEntity("attorney", "fragomen");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.state).toBe("NY");
    expect(r.data).not.toHaveProperty("medianAnnualWage");
  });
});

describe("readCase, H-2A, H-2B and CW-1", () => {
  beforeEach(() => {
    for (const f of [seasonalLookup, seasonalDisclosed, seasonalRecord, seasonalPosting]) f.mockReset().mockResolvedValue(null);
  });

  it("answers a live H-2A case with the job DOL accepted, before any decision", async () => {
    seasonalLookup.mockResolvedValue({
      caseNumber: "H-300-26272-266803", status: "IN PROCESS", isFinal: false, filingDate: "2026-09-29",
      employerName: "MCRP Farms", jobTitle: "Farmworker", lastCheckedAt: "2026-10-03T12:00:00Z",
    });
    seasonalPosting.mockResolvedValue({
      caseNumber: "H-300-26272-266803", feed: "h2a", employerName: "MCRP Farms", jobTitle: "Farmworker",
      workers: 40, workersForeign: 40, beginDate: "2026-11-27", endDate: "2027-06-30", wage: 16.08, wageUnit: "HOUR",
      worksiteCity: "Danielsville", worksiteCounty: "Madison", worksiteState: "GA", jobOrderNumber: "JO-A-300-26271-264525",
      pwdNumber: null, submittedDate: "2026-09-29", acceptedDate: "2026-10-01",
    });
    const out = await readCase("H-300-26272-266803");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data).toMatchObject({ program: "seasonal", status: "IN PROCESS", isFinal: false, decision: null });
    expect(out.data.accepted).toMatchObject({ wage: 16.08, wageUnit: "HOUR", workBegins: "2026-11-27", jobOrderNumber: "JO-A-300-26271-264525" });
  });

  it("answers an H-2B wage request from DOL's prevailing wage file when no live row exists", async () => {
    seasonalRecord.mockResolvedValue({
      caseNumber: "P-400-25100-000001", status: "DETERMINATION ISSUED", receivedDate: "2025-04-10",
      decisionDate: "2025-06-02", employerName: "Shore Crabs LLC", employerSlug: "shore-crabs-llc",
      jobTitle: "Crab Picker", socTitle: "Meat, Poultry, and Fish Cutters", wage: 15.2, wageUnit: "HOUR",
      workers: null, workersCertified: null, beginDate: null, endDate: null, worksiteCity: "Hoopers Island",
      worksiteCounty: null, worksiteState: "MD", attorneyName: null, visaClass: "H-2B", sourceFile: "PW.xlsx",
    });
    const out = await readCase("P-400-25100-000001");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data).toMatchObject({ status: "DETERMINATION ISSUED", isFinal: true, employer: "Shore Crabs LLC", accepted: null });
    expect(out.data.decision).toMatchObject({ decisionDate: "2025-06-02", wage: 15.2, visaClass: "H-2B" });
  });

  it("is not found only when no source holds the case", async () => {
    const out = await readCase("C-500-26271-263466");
    expect(out.ok).toBe(false);
  });

  it("throws, never answers not found, when nothing was found and a published read failed", async () => {
    seasonalDisclosed.mockRejectedValue(new Error("turso query deadline"));
    await expect(readCase("C-500-26271-263466")).rejects.toThrow("turso query deadline");
  });

  it("still answers from what was read when one published half failed", async () => {
    seasonalDisclosed.mockRejectedValue(new Error("turso query deadline"));
    seasonalLookup.mockResolvedValue({
      caseNumber: "H-300-26272-266803", status: "IN PROCESS", isFinal: false, filingDate: "2026-09-29",
      employerName: "MCRP Farms", jobTitle: "Farmworker", lastCheckedAt: "2026-10-03T12:00:00Z",
    });
    const out = await readCase("H-300-26272-266803");
    expect(out.ok).toBe(true);
  });
});

describe("readEstimate", () => {
  beforeEach(() => {
    lookupCase.mockReset();
    estimatePermCase.mockReset().mockReturnValue({ estimate: { kind: "no-date", note: "An appeal.", age: 270 }, casesAhead: null });
  });

  it("gives an appealed case the no-date answer, never 'decided' (live status wins over the published row)", async () => {
    lookupCase.mockResolvedValue({
      live: { isFinal: false, status: "RECONSIDERATION APPEALS", filingDate: "2025-01-10", lastCheckedAt: "2026-10-10T08:00:00Z" },
      decided: { status: "DENIED", decisionDate: "2025-09-01" },
    });
    const out = await readEstimate({ caseNumber: "G-100-25010-123456" });
    expect(out.ok).toBe(true);
    expect(out.ok && out.data.kind).toBe("no-date");
    expect(estimatePermCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "RECONSIDERATION APPEALS" }), expect.any(String));
  });

  it("answers 'decided' for a case DOL has decided", async () => {
    lookupCase.mockResolvedValue({
      live: { isFinal: true, status: "CERTIFIED", filingDate: "2025-01-10", lastCheckedAt: "2026-10-10T08:00:00Z" },
      decided: { status: "CERTIFIED", decisionDate: "2025-09-01" },
    });
    const out = await readEstimate({ caseNumber: "G-100-25010-123456" });
    expect(out.ok && out.data.kind).toBe("decided");
  });

  it("answers 'decided' from the published row when DOL's live record has none", async () => {
    lookupCase.mockResolvedValue({ live: null, decided: { status: "CERTIFIED", decisionDate: "2025-09-01" } });
    const out = await readEstimate({ caseNumber: "G-100-25010-123456" });
    expect(out.ok && out.data.kind).toBe("decided");
  });
});

describe("readQueue", () => {
  const pt = { permAsOf: "2026-11-01", permQueues: [], permAverageDays: [], pwdAsOf: "2026-11-01", pwdQueues: [], pwdPermBacklog: null };
  const pending = (out: Awaited<ReturnType<typeof readQueue>>) => (out.ok ? (out.data.perm as Record<string, unknown> | undefined) : undefined);

  it("sends no pending count, never an empty list, when the backlog can't be read", async () => {
    vi.mocked(getProcessingTimes).mockResolvedValue(pt as never);
    vi.mocked(getLiveBacklog).mockRejectedValue(new Error("fetch failed"));
    const out = await readQueue();
    expect(out.ok).toBe(true);
    expect(out.ok && out.data.pendingPermByFilingMonth).toBeNull();
    expect(pending(out)?.asOf).toBe("2026-11-01");
  });

  it("lists the pending months when it can", async () => {
    vi.mocked(getProcessingTimes).mockResolvedValue(pt as never);
    vi.mocked(getLiveBacklog).mockResolvedValue([{ month: "2025-01", total: 10, decided: 4, pending: 6 }] as never);
    const out = await readQueue();
    expect(out.ok && out.data.pendingPermByFilingMonth).toEqual([
      { month: "2025-01", filed: 10, decided: 4, pending: 6, inAnalystReview: null },
    ]);
  });
});

describe("findCases", () => {
  const filing = (n: number, employer: string, over: Record<string, unknown> = {}) => ({
    caseNumber: `G-100-26030-${String(n).padStart(6, "0")}`,
    status: "ANALYST REVIEW",
    employer,
    employerSlug: null,
    jobTitle: "Software Engineer",
    final: false,
    filedOn: "2026-01-30",
    ...over,
  });
  /** What the shared read answers (src/lib/findCase.ts). */
  const answer = (over: Record<string, unknown> = {}) => ({
    ok: true,
    answer: {
      program: "perm", by: "window", window: { from: "2026-01-30", to: "2026-01-30", assumed: false }, cases: [], matched: 0, ofEmployer: null,
      capped: false, period: { filed: 3, decided: 1, waiting: 2 }, close: [], firm: null, firmUnknown: false, decidedOnly: false,
      ...over,
    },
  });

  beforeEach(() => {
    findCase.mockReset().mockResolvedValue(answer());
  });

  it.each([
    ["one letter of a name", { employer: "g", filed: "2026-01-30" }, /employer must be 2 to 120/],
    ["a name past the length cap", { employer: "a".repeat(5000), filed: "2026-01-30" }, /employer must be 2 to 120/],
    ["one letter of a firm", { firm: "s" }, /firm must be 2 to 120/],
    ["a month for the day", { employer: "acme", filed: "2026-01" }, /filed must be the filing day/],
    ["a day with a time on it", { employer: "acme", filed: "2026-01-30T00:00" }, /filed must be the filing day/],
    ["a range end that isn't a day", { employer: "acme", from: "2026-01-05", to: "Jan 31" }, /from and to must be days/],
    ["one day and a range together", { employer: "acme", filed: "2026-01-30", from: "2026-01-01" }, /not both/],
    ["a program that isn't one", { employer: "acme", filed: "2026-01-30", program: "h1b" }, /program must be one of perm, pwd, lca, seasonal/],
    ["a job title past its cap", { employer: "acme", filed: "2026-01-30", job: "x".repeat(81) }, /job must be at most 80/],
  ])("refuses %s as a bad request, before any read", async (_label, args, message) => {
    const out = await findCases(args);
    expect(out).toMatchObject({ ok: false, status: 400, code: "bad_request" });
    expect(!out.ok && out.message).toMatch(message);
    expect(findCase).not.toHaveBeenCalled();
  });

  it("passes on the shared read's own refusal, in its words", async () => {
    findCase.mockResolvedValue({ ok: false, why: "nothing", message: "Give at least one of the employer's name, the job title, the law firm or a filing date." });
    const out = await findCases({});
    expect(out).toMatchObject({ ok: false, status: 400, code: "bad_request", message: "Give at least one of the employer's name, the job title, the law firm or a filing date." });
  });

  it("reads one day as before: that employer's cases with the day's totals, each case linked to its page", async () => {
    findCase.mockResolvedValue(
      answer({
        cases: [
          filing(1, "Acme Robotics, Inc.", { status: "CERTIFIED", final: true, decided: "2026-10-01", state: "WA", wageRequest: "P-100-25171-129387", firm: "Smith Immigration PC" }),
          filing(2, "ACME ROBOTICS INC", { jobTitle: "Controls Engineer" }),
        ],
        matched: 2,
        ofEmployer: 2,
      }),
    );
    const out = await findCases({ employer: " Acme Robotics ", filed: "2026-01-30" });
    // PERM unless another kind is asked for; one day is both ends of the window.
    expect(findCase).toHaveBeenCalledWith("perm", { employer: "Acme Robotics", title: "", firm: "", from: "2026-01-30", to: "2026-01-30" }, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(out.ok && out.data).toMatchObject({
      filed: "2026-01-30",
      program: "perm",
      readBy: "window",
      window: { from: "2026-01-30", to: "2026-01-30", assumed: false },
      day: { filed: 3, decided: 1, waiting: 2 },
      period: { filed: 3, decided: 1, waiting: 2 },
      matchedEmployer: 2,
      matched: 2,
      truncated: false,
      closeNames: [],
      lawFirm: null,
      lawFirmUnknown: false,
      decidedOnly: false,
      dayListCapped: false,
    });
    const cases = (out.ok ? out.data.cases : []) as Record<string, unknown>[];
    expect(cases[0]).toEqual({
      caseNumber: "G-100-26030-000001",
      status: "CERTIFIED",
      isFinal: true,
      employer: "Acme Robotics, Inc.",
      jobTitle: "Software Engineer",
      filedOn: "2026-01-30",
      decisionDate: "2026-10-01",
      worksiteState: "WA",
      wageRequest: "P-100-25171-129387",
      lawFirm: "Smith Immigration PC",
      url: "https://permtracker.app/perm-case-status?case=G-100-26030-000001",
    });
    expect(cases[1]).toMatchObject({ caseNumber: "G-100-26030-000002", decisionDate: null, worksiteState: null, wageRequest: null, lawFirm: null });
    expect(out.ok && out.meta.url).toBe("https://permtracker.app/perm-queue/2026-01/30");
  });

  it("takes a range of days, a job title and a law firm, for any kind of filing", async () => {
    findCase.mockResolvedValue(
      answer({
        program: "pwd", by: "index", window: { from: "2026-01-05", to: "2026-06-30", assumed: false }, cases: [filing(1, "Acme Robotics", { firm: "Smith Immigration PC" })], matched: 1,
        decidedOnly: true, capped: true, firm: { name: "Smith Immigration PC", slug: "smith-immigration-pc", alternatives: [{ name: "Smith Law LLC", slug: "smith-law-llc" }] },
      }),
    );
    const out = await findCases({ employer: "acme", from: "2026-01-05", to: "2026-06-30", program: "PWD", job: "controls", firm: "smith" });
    expect(findCase).toHaveBeenCalledWith("pwd", { employer: "acme", title: "controls", firm: "smith", from: "2026-01-05", to: "2026-06-30" }, expect.any(String));
    expect(out.ok && out.data).toMatchObject({
      program: "pwd", readBy: "index", matched: 1, decidedOnly: true, dayListCapped: true, truncated: true,
      lawFirm: { name: "Smith Immigration PC", alternatives: ["Smith Law LLC"] },
    });
    // A range has no one day's page: the answer points at the search for that employer.
    expect(out.ok && "filed" in out.data).toBe(false);
    expect(out.ok && "day" in out.data).toBe(false);
    expect(out.ok && out.meta.url).toBe("https://permtracker.app/case-search?q=acme");
  });

  it("needs no employer: a job title alone is an ask", async () => {
    findCase.mockResolvedValue(answer({ window: { from: "2026-08-11", to: "2026-11-10", assumed: true }, matched: 0 }));
    const out = await findCases({ job: "controls engineer" });
    expect(findCase).toHaveBeenCalledWith("perm", { employer: "", title: "controls engineer", firm: "", from: "", to: "" }, expect.any(String));
    expect(out.ok && out.data).toMatchObject({ window: { assumed: true } });
    expect(out.ok && out.meta.url).toBe("https://permtracker.app/case-search");
  });

  it("offers the close spellings that filed in those days when the name fits none", async () => {
    findCase.mockResolvedValue(answer({ ofEmployer: 0, close: [{ employer: "Acme Robotics, Inc.", cases: 2 }] }));
    const out = await findCases({ employer: "acmee robotcs", filed: "2026-01-30" });
    expect(out.ok && out.data).toMatchObject({ matched: 0, matchedEmployer: 0, cases: [], closeNames: [{ employer: "Acme Robotics, Inc.", cases: 2 }] });
  });

  it("lists the first fifty of a longer answer and says it was cut", async () => {
    findCase.mockResolvedValue(answer({ cases: Array.from({ length: 73 }, (_, i) => filing(i + 1, "Acme Robotics")), matched: 73, ofEmployer: 73 }));
    const out = await findCases({ employer: "acme", filed: "2026-01-30" });
    expect(out.ok && (out.data.cases as unknown[]).length).toBe(50);
    expect(out.ok && out.data).toMatchObject({ matched: 73, truncated: true });
  });

  it("throws when the record can't be read, so the route answers an error and never 'none'", async () => {
    findCase.mockRejectedValue(new Error("database is locked"));
    await expect(findCases({ employer: "acme", filed: "2026-01-30" })).rejects.toThrow("database is locked");
  });
});

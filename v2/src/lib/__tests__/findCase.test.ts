import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundCase } from "@/lib/caseFinder";

/**
 * One function answers "find my case" for the site's finder, the API, the MCP tool and the chat. What has to hold:
 * every box is optional and one is enough; dates a quarter apart or less are read whole and matched by the
 * finder's own rules; a law firm, or an employer with no dates, is answered by the case search's indexes; dates
 * further apart with no name are refused with what to add; and a failed read is never "none".
 */
vi.mock("server-only", () => ({}));
const getFiledInWindow = vi.fn();
const getWindowEmployers = vi.fn();
const getFilingsByDay = vi.fn();
const unifiedSearch = vi.fn();
const planCaseSearch = vi.fn();
vi.mock("../db/filedWindow", () => ({ getFiledInWindow: (...a: unknown[]) => getFiledInWindow(...a), getWindowEmployers: (...a: unknown[]) => getWindowEmployers(...a) }));
vi.mock("../db/filingsByDay", () => ({ getFilingsByDay: () => getFilingsByDay() }));
vi.mock("../db/unifiedSearch", () => ({ unifiedSearch: (...a: unknown[]) => unifiedSearch(...a) }));
vi.mock("@/lib/caseSearchRequest", () => ({
  planCaseSearch: (...a: unknown[]) => planCaseSearch(...a),
  NO_MATCH_MESSAGE: { employer: "No employer matches those words.", firm: "No law firm matches those words.", occupation: "No occupation matches those words." },
}));

const { findCase, FIND_REFUSALS } = await import("../findCase");

const TODAY = "2026-11-10";
const ask = (over: Partial<{ employer: string; title: string; firm: string; from: string; to: string }> = {}) => ({
  employer: "", title: "", firm: "", from: "", to: "", ...over,
});
const row = (caseNumber: string, employer: string, filedOn: string, over: Partial<FoundCase> = {}): FoundCase => ({
  caseNumber, status: "ANALYST REVIEW", employer, employerSlug: null, jobTitle: "Software Engineer", final: false, filedOn, ...over,
});
const days = [
  { day: "2026-01-05", filed: 500, waiting: 120, fileOnly: 0, mismatch: 0 },
  { day: "2026-01-06", filed: 300, waiting: 100, fileOnly: 0, mismatch: 0 },
  { day: "2026-02-01", filed: 999, waiting: 999, fileOnly: 0, mismatch: 0 },
];
const doc = { asOf: TODAY, computedAt: 1, from: "2019-10-01", programs: { perm: { days, liveFrom: null }, pwd: { days: [], liveFrom: null }, lca: { days: [], liveFrom: null }, seasonal: { days: [], liveFrom: null } } };
const searchRow = (over: Record<string, unknown> = {}) => ({
  caseNumber: "G-100-25300-000001", program: "perm", half: "published", status: "Certified", isFinal: true, filedOn: "2025-10-27", decidedOn: "2026-08-01",
  employerName: "Acme Corp", employerSlug: "acme-corp", jobTitle: "Engineer", wage: 120000, wageUnit: "Year", state: "WA", firmName: "Smith Immigration PC",
  firmSlug: "smith-immigration-pc", socCode: null, socTitle: null, days: 278, wageRequest: "P-100-25200-111111",
  ...over,
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const f of [getFiledInWindow, getWindowEmployers, getFilingsByDay, unifiedSearch, planCaseSearch]) f.mockReset();
  getFiledInWindow.mockResolvedValue({ cases: [], capped: false });
  getWindowEmployers.mockResolvedValue([]);
  getFilingsByDay.mockResolvedValue(doc);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return () => warn.mockRestore();
});

describe("what counts as an ask", () => {
  it("refuses nothing at all, and says what to give", async () => {
    expect(await findCase("perm", ask(), TODAY)).toEqual({ ok: false, why: "nothing", message: FIND_REFUSALS.nothing });
    expect(await findCase("perm", ask({ employer: "a" }), TODAY)).toMatchObject({ ok: false, why: "nothing" });
    expect(getFiledInWindow).not.toHaveBeenCalled();
  });

  it.each([
    ["bad-date", { from: "2026-02-30" }],
    ["too-early", { from: "2018-01-01", to: "2018-01-31" }],
    ["not-yet", { from: "2026-11-11" }],
  ] as const)("refuses %s before any read", async (why, over) => {
    expect(await findCase("perm", ask({ employer: "acme", ...over }), TODAY)).toMatchObject({ ok: false, why });
    expect(getFiledInWindow).not.toHaveBeenCalled();
    expect(planCaseSearch).not.toHaveBeenCalled();
  });

  it("refuses dates more than a quarter apart when there's no name to lead with", async () => {
    const got = await findCase("perm", ask({ title: "engineer", from: "2026-01-01", to: "2026-06-30" }), TODAY);
    expect(got).toEqual({ ok: false, why: "too-long", message: FIND_REFUSALS["too-long"] });
    expect(getFiledInWindow).not.toHaveBeenCalled();
  });
});

describe("a window read whole", () => {
  it("answers dates alone: the window's cases, newest first, with what DOL's record holds for those days", async () => {
    getFiledInWindow.mockResolvedValue({ cases: [row("G-1", "Acme Corp", "2026-01-05"), row("G-2", "Beta LLC", "2026-01-06")], capped: false });
    const got = await findCase("perm", ask({ from: "2026-01-05", to: "2026-01-06" }), TODAY);
    expect(getFiledInWindow).toHaveBeenCalledWith("perm", "2026-01-05", "2026-01-06", { employerStem: "", titleWords: [], firmWords: [] });
    expect(got).toMatchObject({
      ok: true,
      answer: { asked: { employer: "", title: "", firm: "" }, by: "window", window: { from: "2026-01-05", to: "2026-01-06", assumed: false }, matched: 2, ofEmployer: null, capped: false, period: { filed: 800, decided: 580, waiting: 220 }, decidedOnly: false },
    });
    expect(got.ok && got.answer.cases.map((c) => c.caseNumber)).toEqual(["G-2", "G-1"]);
  });

  it("reads one date as that one day", async () => {
    await findCase("pwd", ask({ employer: "acme", to: "2026-01-05" }), TODAY);
    expect(getFiledInWindow).toHaveBeenCalledWith("pwd", "2026-01-05", "2026-01-05", { employerStem: "acm", titleWords: [], firmWords: [] });
  });

  it("fits an employer by the finder's own rule, and says how many it fits before a job title narrows them", async () => {
    getFiledInWindow.mockResolvedValue({
      cases: [
        row("G-1", "JP Morgan Chase & Co.", "2026-01-05", { jobTitle: "Data Scientist" }),
        row("G-2", "JPMORGAN CHASE & CO", "2026-01-06", { jobTitle: "Vice President" }),
        row("G-3", "Morgan Stanley", "2026-01-06", { jobTitle: "Data Scientist" }),
        row("G-4", "Organ Recovery Inc", "2026-01-06", { jobTitle: "Data Scientist" }),
        row("G-5", "Morgan Stanley", "2026-01-06", { jobTitle: "Vice President, Trading" }),
      ],
      capped: false,
    });
    const got = await findCase("perm", ask({ employer: "morgan", title: "data scientist", from: "2026-01-05", to: "2026-01-06" }), TODAY);
    // The name narrows the read. The job title is matched afterwards, or the count before it couldn't be given.
    expect(getFiledInWindow.mock.calls[0]![3]).toEqual({ employerStem: "mor", titleWords: [], firmWords: [] });
    // "morgan" begins a word of JP Morgan and of Morgan Stanley. It's the middle of the one word JPMORGAN, which the
    // finder's rule leaves to someone typing "jpmorgan". Three of the employer's cases, two of them data scientists.
    expect(got.ok && got.answer.ofEmployer).toBe(3);
    expect(got.ok && got.answer.cases.map((c) => c.caseNumber).sort()).toEqual(["G-1", "G-3"]);
    // The answer says what it was asked, trimmed, so its words can't mix with what's typed after it.
    expect(got.ok && got.answer.asked).toEqual({ employer: "morgan", title: "data scientist", firm: "" });
    expect(getWindowEmployers).not.toHaveBeenCalled();
  });

  it("with a job title and no dates, reads the newest quarter and says it assumed it", async () => {
    const got = await findCase("lca", ask({ title: "nurse" }), TODAY);
    expect(getFiledInWindow).toHaveBeenCalledWith("lca", "2026-08-11", TODAY, { employerStem: "", titleWords: ["nurse"], firmWords: [] });
    expect(got.ok && got.answer.window).toEqual({ from: "2026-08-11", to: TODAY, assumed: true });
  });

  it("offers the close spellings that filed in a short window when the name fits none", async () => {
    getWindowEmployers.mockResolvedValue([{ employer: "Microsoft Corporation", cases: 40 }, { employer: "Zenith Foods Inc", cases: 1 }]);
    const got = await findCase("perm", ask({ employer: "mircosoft", from: "2026-01-05" }), TODAY);
    expect(getWindowEmployers).toHaveBeenCalledWith("perm", "2026-01-05", "2026-01-05");
    expect(got.ok && got.answer.close).toEqual([{ employer: "Microsoft Corporation", cases: 40 }]);
    expect(got.ok && got.answer.matched).toBe(0);
  });

  it("offers no spellings over a window longer than a month: that read is the whole window's names", async () => {
    const got = await findCase("perm", ask({ employer: "mircosoft", from: "2026-01-01", to: "2026-03-15" }), TODAY);
    expect(getWindowEmployers).not.toHaveBeenCalled();
    expect(got.ok && got.answer.close).toEqual([]);
  });

  it("carries at most the answer's limit, and says more fit", async () => {
    getFiledInWindow.mockResolvedValue({ cases: Array.from({ length: 230 }, (_, i) => row(`G-${i}`, "Acme Corp", "2026-01-05")), capped: false });
    const got = await findCase("perm", ask({ from: "2026-01-05" }), TODAY);
    expect(got.ok && got.answer.cases).toHaveLength(200);
    expect(got.ok && got.answer.matched).toBe(230);
    expect(got.ok && got.answer.capped).toBe(true);
  });

  it("passes on the read's own limit", async () => {
    getFiledInWindow.mockResolvedValue({ cases: [row("G-1", "Acme Corp", "2026-01-05")], capped: true });
    const got = await findCase("perm", ask({ from: "2026-01-05" }), TODAY);
    expect(got.ok && got.answer.capped).toBe(true);
  });

  it("leaves the day counts out when they can't be read, and still answers", async () => {
    getFilingsByDay.mockRejectedValue(new Error("db down"));
    getFiledInWindow.mockResolvedValue({ cases: [row("G-1", "Acme Corp", "2026-01-05")], capped: false });
    const got = await findCase("perm", ask({ from: "2026-01-05" }), TODAY);
    expect(got.ok && got.answer.period).toBeNull();
    expect(got.ok && got.answer.matched).toBe(1);
  });

  it("throws a failed read of the window on", async () => {
    getFiledInWindow.mockRejectedValue(new Error("database is locked"));
    await expect(findCase("perm", ask({ from: "2026-01-05" }), TODAY)).rejects.toThrow("database is locked");
  });
});

describe("an answer from the case search's indexes", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    kind: "search", csv: false, args: { lead: { kind: "employer", value: "acme" }, narrow: {}, programs: ["perm"], limit: 201 }, resolved: { firm: null, occupation: null }, dropped: [],
    ...over,
  });

  it("answers an employer with no dates over every year, by the start of its name", async () => {
    planCaseSearch.mockResolvedValue(plan());
    unifiedSearch.mockResolvedValue({ rows: [searchRow(), searchRow({ caseNumber: "G-2", half: "live", isFinal: false, status: "analyst review", firmName: null, decidedOn: null, wage: null })], truncated: false, capped: false });
    const got = await findCase("perm", ask({ employer: "acme" }), TODAY);
    const sent = planCaseSearch.mock.calls[0]![0] as URLSearchParams;
    expect(Object.fromEntries(sent)).toEqual({ programs: "perm", limit: "201", order: "filed-desc", q: "acme" });
    expect(getFiledInWindow).not.toHaveBeenCalled();
    expect(got).toMatchObject({ ok: true, answer: { asked: { employer: "acme", title: "", firm: "" }, by: "index", window: null, period: null, matched: 2, capped: false, decidedOnly: false, firm: null } });
    expect(got.ok && got.answer.cases[0]).toMatchObject({
      caseNumber: "G-100-25300-000001", status: "CERTIFIED", final: true, filedOn: "2025-10-27", decided: "2026-08-01",
      employer: "Acme Corp", employerSlug: "acme-corp", state: "WA", firm: "Smith Immigration PC", wageRequest: "P-100-25200-111111",
    });
    expect(got.ok && got.answer.cases[0]!.wage).toContain("$120,000");
    expect(got.ok && got.answer.cases[1]).toMatchObject({ status: "ANALYST REVIEW", final: false, firm: null, wage: null });
    // A search's row comes from one half of the record, and the other may hold the case too: where it's held isn't said.
    expect(got.ok && got.answer.cases.every((c) => c.source === undefined)).toBe(true);
  });

  it("answers an employer with dates too far apart for one read the same way, the dates narrowing it", async () => {
    planCaseSearch.mockResolvedValue(plan());
    unifiedSearch.mockResolvedValue({ rows: [], truncated: false, capped: false });
    const got = await findCase("perm", ask({ employer: "acme", title: "engineer", from: "2025-01-01", to: "2026-06-30" }), TODAY);
    expect(Object.fromEntries(planCaseSearch.mock.calls[0]![0] as URLSearchParams)).toMatchObject({ q: "acme", title: "engineer", from: "2025-01-01", to: "2026-06-30" });
    expect(got.ok && got.answer.window).toEqual({ from: "2025-01-01", to: "2026-06-30", assumed: false });
  });

  it("answers a law firm with no dates by the page its words name, decided cases only, with the other firms they could mean", async () => {
    planCaseSearch.mockResolvedValue(
      plan({
        args: { lead: { kind: "firm", value: "smith-immigration-pc" }, narrow: {}, programs: ["perm"], limit: 201 },
        resolved: { firm: { slug: "smith-immigration-pc", name: "Smith Immigration PC", total: 900, key: "smith-immigration-pc", alternatives: [{ slug: "smith-law-llc", name: "Smith Law LLC", total: 40 }] }, occupation: null },
      }),
    );
    unifiedSearch.mockResolvedValue({ rows: [searchRow()], truncated: false, capped: false });
    const got = await findCase("perm", ask({ firm: " smith " }), TODAY);
    expect(Object.fromEntries(planCaseSearch.mock.calls[0]![0] as URLSearchParams)).toEqual({ programs: "perm", limit: "201", order: "filed-desc", firm: "smith" });
    expect(getFiledInWindow).not.toHaveBeenCalled();
    expect(got).toMatchObject({
      ok: true,
      answer: { asked: { employer: "", title: "", firm: "smith" }, by: "index", window: null, decidedOnly: true, firmUnknown: false, firm: { name: "Smith Immigration PC", slug: "smith-immigration-pc", alternatives: [{ name: "Smith Law LLC", slug: "smith-law-llc" }] } },
    });
  });

  it("answers a law firm with dates from the days themselves: every spelling that holds the words, decided cases only", async () => {
    getFiledInWindow.mockResolvedValue({
      cases: [
        row("G-1", "Acme Corp", "2026-01-05", { final: true, firm: "Smith Immigration PC" }),
        row("G-2", "Beta LLC", "2026-01-06", { final: true, firm: "SMITH IMMIGRATION, P.C." }),
        row("G-3", "Gamma Inc", "2026-01-06", { final: true, firm: "Jones & Smithers LLP" }),
        row("G-4", "Delta Co", "2026-01-06", { final: true, firm: "Law firm 3" }),
      ],
      capped: false,
    });
    const got = await findCase("perm", ask({ firm: "smith immigration", from: "2026-01-05", to: "2026-01-06" }), TODAY);
    expect(planCaseSearch).not.toHaveBeenCalled();
    expect(getFiledInWindow).toHaveBeenCalledWith("perm", "2026-01-05", "2026-01-06", { employerStem: "", titleWords: [], firmWords: ["smith", "immigration"] });
    expect(got.ok && got.answer.cases.map((c) => c.caseNumber).sort()).toEqual(["G-1", "G-2"]);
    expect(got).toMatchObject({ ok: true, answer: { by: "window", decidedOnly: true, firm: null, firmUnknown: false, matched: 2 } });
  });

  // A firm withheld at its owner's request comes back from the database under its label. The match runs on what
  // came back, so typing the real name finds nothing, and the label never points at it.
  it("can't find a withheld firm by its real name: the rows it's given carry the label, and the label doesn't fit", async () => {
    getFiledInWindow.mockResolvedValue({ cases: [row("G-4", "Delta Co", "2026-01-06", { final: true, firm: "Law firm 3" })], capped: false });
    const got = await findCase("perm", ask({ firm: "realname partners", from: "2026-01-05", to: "2026-01-06" }), TODAY);
    expect(got.ok && got.answer.matched).toBe(0);
    expect(got.ok && got.answer.cases).toEqual([]);
  });

  it("says an undated firm's words name no page, with nothing listed", async () => {
    planCaseSearch.mockResolvedValue({ kind: "noMatch", csv: false, field: "firm", resolved: { firm: null, occupation: null } });
    const got = await findCase("perm", ask({ firm: "zzzzzz" }), TODAY);
    expect(unifiedSearch).not.toHaveBeenCalled();
    expect(got).toMatchObject({ ok: true, answer: { cases: [], matched: 0, firmUnknown: true, decidedOnly: true } });
  });

  it("answers a name withheld at its owner's request with nothing, and never names why", async () => {
    planCaseSearch.mockResolvedValue({ kind: "noMatch", csv: false, field: "employer", resolved: { firm: null, occupation: null } });
    const got = await findCase("perm", ask({ employer: "withheld co" }), TODAY);
    expect(got).toMatchObject({ ok: true, answer: { cases: [], matched: 0, firmUnknown: false } });
  });

  it("passes on the planner's refusal of a malformed ask", async () => {
    planCaseSearch.mockResolvedValue({ kind: "bad", message: "filed dates must be YYYY-MM or YYYY-MM-DD" });
    expect(await findCase("perm", ask({ employer: "acme" }), TODAY)).toEqual({ ok: false, why: "bad-ask", message: "filed dates must be YYYY-MM or YYYY-MM-DD" });
  });

  it("says more fit than the answer carries", async () => {
    planCaseSearch.mockResolvedValue(plan());
    unifiedSearch.mockResolvedValue({ rows: Array.from({ length: 201 }, (_, i) => searchRow({ caseNumber: `G-${i}` })), truncated: false, capped: false });
    const got = await findCase("perm", ask({ employer: "acme" }), TODAY);
    expect(got.ok && got.answer.cases).toHaveLength(200);
    expect(got.ok && got.answer.capped).toBe(true);
  });

  it("throws a failed search on", async () => {
    planCaseSearch.mockResolvedValue(plan());
    unifiedSearch.mockRejectedValue(new Error("search unavailable"));
    await expect(findCase("perm", ask({ employer: "acme" }), TODAY)).rejects.toThrow("search unavailable");
  });
});

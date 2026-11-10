import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The last database readers that answered a failed read with nothing (Nov 10 2026). Each now does one of two things.
 * A read a page's subject depends on throws, so the page keeps its last good render; only a table the first load
 * hasn't made yet is "nothing held". A read a page can live without keeps its fallback and is recorded under a name
 * that says which read it was.
 */
vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
const exec = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("../client", () => ({ one, rows, exec }));
vi.mock("../employerSlugs", () => ({
  employerMatch: vi.fn(async () => ({ where: "employer_slug IN (?)", args: ["acme"], basis: "map", spellings: 1 })),
}));

const { getH1bSummary } = await import("../h1bRanks");
const { getProcessingTimesArchive } = await import("../openData");
const { getCoverageWindows } = await import("../decidedDays");
const { getRecordCounts } = await import("../recordCounts");
const { liveOnlyLastChanged } = await import("../publicData");
const { readStored, touchRead } = await import("../uscisCaseStatus");
const { firstSeenDecided, getCaseFieldOptions } = await import("../caseSearchReads");
const { employmentBy } = await import("../visaIssuances");
const { cityGeo, priceParity, projectionFor } = await import("../reference");
const { getEmployerPrograms } = await import("../employerPrograms");
const { getDateSources } = await import("../dateSources");
const { forgetSoftReads } = await import("@/lib/softRead");

const LOCKED = () => new Error("SERVER_ERROR: database is locked");
const NO_TABLE = (t: string) => new Error(`SQLITE_ERROR: no such table: ${t}`);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  one.mockReset();
  rows.mockReset();
  exec.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // A failed read is recorded once per ten minutes, so each test starts with nothing recorded.
  forgetSoftReads();
});
afterEach(() => warn.mockRestore());

/** The names of the reads recorded as failed, in order. */
const recorded = () =>
  warn.mock.calls
    .map((c: unknown[]) => /^\[soft-read\] (\S+) failed/.exec(String(c[0]))?.[1])
    .filter((label): label is string => Boolean(label));

describe("reads whose failure is a failure", () => {
  it("the H-1B rankings' summary throws on a failed read, and is null before its first build", async () => {
    one.mockRejectedValueOnce(LOCKED());
    await expect(getH1bSummary()).rejects.toThrow("database is locked");
    one.mockRejectedValueOnce(NO_TABLE("perm_docs"));
    expect(await getH1bSummary()).toBeNull();
    one.mockResolvedValueOnce(null);
    expect(await getH1bSummary()).toBeNull();
    expect(recorded()).toEqual([]);
  });

  it("DOL's processing-times archive never answers a failed read from the older table", async () => {
    rows.mockRejectedValueOnce(LOCKED());
    await expect(getProcessingTimesArchive()).rejects.toThrow("database is locked");
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("the archive reads the older table only when the newer one isn't there yet", async () => {
    rows.mockRejectedValueOnce(NO_TABLE("processing_time_readings")).mockResolvedValueOnce([{ json: '{"permAsOf":"2026-10-01"}', fetched_at: 5 }]);
    expect(await getProcessingTimesArchive()).toEqual([{ permAsOf: "2026-10-01", fetchedAt: 5 }]);
    expect(String(rows.mock.calls[1]![0])).toContain("FROM processing_times ");
  });

  it("the coverage windows throw when one bound can't be read", async () => {
    rows.mockImplementation(async (sql: string) => {
      if (sql.includes("MAX(changed_at)")) throw LOCKED();
      return [{ v: null }];
    });
    await expect(getCoverageWindows()).rejects.toThrow("database is locked");
  });

  it("the coverage windows hold nothing, without failing, before any table is loaded", async () => {
    rows.mockImplementation(async (sql: string) => {
      throw NO_TABLE(/FROM (\w+)/.exec(sql)?.[1] ?? "x");
    });
    expect(await getCoverageWindows()).toEqual({ decided: null, decidedByProgram: {}, observed: null });
  });
});

describe("reads a page can live without", () => {
  beforeEach(() => {
    one.mockRejectedValue(LOCKED());
    rows.mockRejectedValue(LOCKED());
    exec.mockRejectedValue(LOCKED());
  });

  it("the record's size keeps what it can and names both reads", async () => {
    expect(await getRecordCounts()).toEqual([]);
    expect(recorded().sort()).toEqual(["recordCounts.bulletins", "recordCounts.docs"]);
  });

  it.each<[string, () => Promise<unknown>, unknown]>([
    ["publicData.liveOnlyLastChanged", () => liveOnlyLastChanged("acme"), null],
    ["uscisCaseStatus.readStored", () => readStored("IOE0912345678"), null],
    ["uscisCaseStatus.touchRead", () => touchRead("IOE0912345678", new Date(0)), undefined],
    ["visaIssuances.employmentBy", () => employmentBy("fsc", "2026-01", "2026-06"), []],
    ["reference.cityGeo", () => cityGeo("appleton-wi"), null],
    ["reference.priceParity", () => priceParity("55087"), null],
    ["reference.projectionFor", () => projectionFor("15-1252"), null],
  ])("%s keeps its fallback and is recorded", async (label, read, fallback) => {
    expect(await read()).toEqual(fallback);
    expect(recorded()).toEqual([label]);
    expect(String(warn.mock.calls[0]![0])).toContain("database is locked");
  });

  it("the day a live case was first seen decided stays unknown, and is recorded", async () => {
    expect((await firstSeenDecided("perm", ["A-26001-12345"])).size).toBe(0);
    expect(recorded()).toEqual(["caseSearchReads.firstSeenDecided"]);
  });

  it("the search filters fall back to free text, and name the doc and the country list", async () => {
    const options = await getCaseFieldOptions();
    expect(options.citizenship).toEqual([]);
    expect(options.birthCountry).toEqual([]);
    expect(recorded()).toEqual(["caseSearchReads.fieldOptionsDoc", "caseSearchReads.countryOptions"]);
  });

  it("an employer's open cases drop out alone: the published counts still print", async () => {
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("is_final = 0")) throw LOCKED();
      return { n: 3, wage_n: 0, certified: 0 };
    });
    const programs = await getEmployerPrograms("acme");
    expect(programs?.pwd.published).toBe(3);
    expect(programs?.pwd.pending).toBeNull();
    expect(programs?.lca.pending).toBeNull();
    expect(programs?.seasonal?.pending).toBeNull();
    expect(recorded().sort()).toEqual(["employerPrograms.lcaPending", "employerPrograms.pwdPending", "employerPrograms.seasonalPending"]);
  });

  it("a page's date sources leave out what can't be read, name each, and never throw", async () => {
    const sources = await getDateSources();
    expect(sources.dol).toBeNull();
    expect(sources.bulletin).toBeNull();
    expect(sources.refusals).toBeNull();
    expect(sources.corpus).toBeNull();
    expect(recorded()).toEqual(expect.arrayContaining(["dateSources.dol", "dateSources.bulletin", "dateSources.refusals", "dateSources.corpus"]));
  });
});

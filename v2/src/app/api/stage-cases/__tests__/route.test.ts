import { beforeEach, describe, expect, it, vi } from "vitest";

const listStageCases = vi.fn();
const getSweepCoverage = vi.fn();
// The feed reads one history: the waiting cases (with where each wait starts) and the answered ones.
const exitsRef: { current: unknown[] } = { current: [] };
const getStageHistory = vi.fn(async (status: string, limit: number) => ({
  cases: await listStageCases(status, limit, 0),
  exits: exitsRef.current,
}));

vi.mock("@/lib/db/rfi", () => ({ getStageHistory, LISTABLE_STAGE_MAX: 20_000 }));
vi.mock("@/lib/db/sweepCoverage", () => ({ getSweepCoverage }));

const { GET } = await import("../route");

function get(qs: string): Request {
  return new Request(`https://permtracker.app/api/stage-cases?${qs}`);
}

const row = (n: number) => ({
  caseNumber: `G-100-26030-${String(100000 + n)}`,
  filingDate: "2026-01-30",
  employer: n % 2 ? 'Acme "Widgets", Inc.' : "Plain Co",
  employerSlug: n % 2 ? "acme-widgets-inc" : null,
  jobTitle: "Software Developer",
  deniedOn: null,
  startOn: n === 1 ? "2026-10-05" : null,
  startSource: n === 1 ? "seen" : "unknown",
});

describe("GET /api/stage-cases", () => {
  beforeEach(() => {
    listStageCases.mockReset();
    getStageHistory.mockClear();
    exitsRef.current = [];
    getSweepCoverage.mockReset();
    getSweepCoverage.mockResolvedValue({ finishedOn: "2026-09-08", mode: "pending", asked: 1, answered: 1 });
  });

  it("refuses a missing or malformed stage before touching the database", async () => {
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get("stage=../etc"))).status).toBe(400);
    expect(listStageCases).not.toHaveBeenCalled();
  });

  it("answers 404 for a slug the stage registry does not know, and analyst review has no slug", async () => {
    expect((await GET(get("stage=not-a-stage"))).status).toBe(404);
    expect((await GET(get("stage=analyst-review"))).status).toBe(404);
    expect(listStageCases).not.toHaveBeenCalled();
  });

  it("returns the whole cohort as JSON with the sweep's date and an edge cache header", async () => {
    listStageCases.mockResolvedValue([row(1), row(2)]);
    const res = await GET(get("stage=application-on-hold"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=21600");
    const body = await res.json();
    expect(body.status).toBe("APPLICATION ON HOLD");
    expect(body.label).toBe("Application on hold");
    expect(body.asOf).toBe("2026-09-08");
    expect(body.count).toBe(2);
    expect(body.rows[0].caseNumber).toBe("G-100-26030-100001");
    // The read asks for the whole cohort, not a page of it.
    expect(listStageCases).toHaveBeenCalledWith("APPLICATION ON HOLD", 25_000, 0);
  });

  it("renders CSV with quoting for commas and quotes, as an attachment named by stage and date", async () => {
    listStageCases.mockResolvedValue([row(1)]);
    const res = await GET(get("stage=rfi-issued&format=csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('perm-rfi-issued-2026-09-08.csv');
    const text = await res.text();
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("case_number,filing_date,employer,job_title,status,waiting_since,waiting_since_from,as_of");
    expect(lines[1]).toBe('G-100-26030-100001,2026-01-30,"Acme ""Widgets"", Inc.",Software Developer,RFI ISSUED,2026-10-05,our daily check,2026-09-08');
  });

  it("never caches an answer with no sweep date, in JSON or CSV", async () => {
    listStageCases.mockResolvedValue([row(1)]);
    getSweepCoverage.mockResolvedValue(null);
    for (const q of ["stage=rfi-issued", "stage=rfi-issued&format=csv"]) {
      const res = await GET(get(q));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("refuses a cohort above the listable ceiling instead of serving it", async () => {
    listStageCases.mockResolvedValue(Array.from({ length: 20_001 }, (_, i) => row(i)));
    const res = await GET(get("stage=rfi-issued"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/perm-queue/);
  });

  it("rejects an unknown format", async () => {
    expect((await GET(get("stage=rfi-issued&format=xml"))).status).toBe(400);
  });

  it("serves the cases that left the stage as JSON and CSV, each with its outcome and how long it waited", async () => {
    listStageCases.mockResolvedValue([row(1)]);
    exitsRef.current = [
      {
        caseNumber: "G-100-25300-200001",
        leftOn: "2026-11-12",
        to: "CERTIFIED",
        startOn: "2026-06-12",
        startSource: "denied",
        days: 153,
        filingDate: "2025-01-15",
        employer: "Plain Co",
        employerSlug: null,
        jobTitle: "Analyst",
        nowStatus: "CERTIFIED",
      },
    ];
    const json = await (await GET(get("stage=reconsideration-appeals&kind=answered"))).json();
    expect(json.kind).toBe("answered");
    expect(json.count).toBe(1);
    expect(json.rows[0].to).toBe("CERTIFIED");
    const text = await (await GET(get("stage=reconsideration-appeals&kind=answered&format=csv"))).text();
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("case_number,left_on,moved_to,waiting_since,waiting_since_from,days_at_stage,filing_date,employer,job_title,status_now,as_of");
    expect(lines[1]).toBe("G-100-25300-200001,2026-11-12,CERTIFIED,2026-06-12,DOL denial date,153,2025-01-15,Plain Co,Analyst,CERTIFIED,2026-09-08");
  });

  it("refuses a kind it doesn't know", async () => {
    expect((await GET(get("stage=rfi-issued&kind=everything"))).status).toBe(400);
  });
});

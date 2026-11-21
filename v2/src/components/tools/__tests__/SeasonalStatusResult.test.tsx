import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * An H-2A, H-2B or CW-1 case's page links what its record names, as the PERM, wage request and LCA pages do: the
 * occupation to the job code finder, the employer and the law firm to their pages when they have one, and the job
 * order and wage determination to their own case pages. A P-400 or P-500 wage request also shows the level DOL set
 * and the job's requirements, which DOL's prevailing wage file prints.
 */
const reads = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  posting: null as Record<string, unknown> | null,
  row: null as Record<string, unknown> | null,
  detail: null as Record<string, unknown> | null,
  employerPages: new Map<string, string>(),
  firmPages: new Set<string>(),
  detailAsked: [] as string[],
}));

const RECORD = {
  caseNumber: "H-400-25301-000123",
  status: "DETERMINATION ISSUED - CERTIFICATION",
  receivedDate: "2025-10-28",
  decisionDate: "2025-11-20",
  employerName: "Acme Landscaping LLC",
  employerSlug: "acme-landscaping-llc",
  jobTitle: "Landscape Laborer",
  socCode: "37-3011",
  socTitle: "Landscaping and Groundskeeping Workers",
  naics: "561730",
  wage: 17.5,
  wageUnit: "Hour",
  workers: 40,
  workersCertified: 35,
  beginDate: "2026-03-01",
  endDate: "2026-11-30",
  worksiteCity: "Austin",
  worksiteCounty: "Travis",
  worksiteState: "TX",
  attorneyName: "Example Visa Group",
  attorneySlug: "example-visa-group",
  visaClass: "H-2B",
  sourceFile: "H-2B_Disclosure_Data_FY2026_Q1.xlsx",
};

const POSTING = {
  caseNumber: "H-400-25301-000123",
  feed: "h2b",
  employerName: "Acme Landscaping LLC",
  jobTitle: "Landscape Laborer",
  workers: 40,
  workersForeign: 40,
  beginDate: "2026-03-01",
  endDate: "2026-11-30",
  wage: 17.5,
  wageUnit: "Hour",
  worksiteCity: "Austin",
  worksiteCounty: "Travis",
  worksiteState: "TX",
  jobOrderNumber: "JO-A-300-25290-000777",
  pwdNumber: "P-400-25200-000555",
  submittedDate: "2025-10-28",
  acceptedDate: "2025-11-02",
};

vi.mock("@/lib/db/seasonalCasesTypes", () => ({
  lookupSeasonalCaseOutcome: vi.fn(async () => ({ row: reads.row, dolMiss: null })),
  lookupSeasonalRecord: vi.fn(async () => reads.record),
  lookupSeasonalPosting: vi.fn(async () => reads.posting),
}));
vi.mock("@/lib/db/seasonalTiming", () => ({
  getSeasonalTiming: vi.fn(async () => null),
  getSeasonalCheck: vi.fn(async () => null),
}));
vi.mock("@/lib/db/h2bGroups", () => ({
  h2bGroupOf: vi.fn(async () => null),
  getH2bGroupTiming: vi.fn(async () => null),
}));
vi.mock("@/lib/db/pwdDetail", () => ({
  getPwdDetail: vi.fn(async (n: string) => {
    reads.detailAsked.push(n);
    return reads.detail;
  }),
}));
vi.mock("@/lib/db/entityLinks", () => ({
  linkTargets: vi.fn(async (_kind: string, slugs: Iterable<string | null | undefined>) => {
    const out = new Map<string, string>();
    for (const s of slugs) if (s && reads.employerPages.has(s)) out.set(s, reads.employerPages.get(s)!);
    return out;
  }),
  linkableSlugs: vi.fn(async (_kind: string, slugs: Iterable<string | null | undefined>) => {
    return new Set([...slugs].filter((s): s is string => !!s && reads.firmPages.has(s)));
  }),
}));
vi.mock("@/lib/softRead", () => ({ softFail: (_label: string, fallback: unknown) => () => fallback }));

const { SeasonalLookup } = await import("../SeasonalStatusResult");

beforeEach(() => {
  reads.record = { ...RECORD };
  reads.posting = { ...POSTING };
  reads.row = null;
  reads.detail = null;
  reads.employerPages = new Map([["acme-landscaping-llc", "acme-landscaping"]]);
  reads.firmPages = new Set(["example-visa-group"]);
  reads.detailAsked = [];
});

async function page(caseNumber = "H-400-25301-000123") {
  return render((await SeasonalLookup({ caseNumber })) as ReactElement);
}

describe("a seasonal case's links", () => {
  it("links the occupation's code, the law firm, the job order and the wage determination", async () => {
    await page();
    expect(screen.getByRole("link", { name: "37-3011" })).toHaveAttribute("href", "/soc-codes?q=37-3011");
    expect(screen.getByRole("link", { name: "Example Visa Group" })).toHaveAttribute(
      "href",
      "/perm-attorneys/example-visa-group",
    );
    expect(screen.getByRole("link", { name: "JO-A-300-25290-000777" })).toHaveAttribute(
      "href",
      "/perm-case-status?case=JO-A-300-25290-000777",
    );
    expect(screen.getByRole("link", { name: "P-400-25200-000555" })).toHaveAttribute(
      "href",
      "/perm-case-status?case=P-400-25200-000555",
    );
  });

  it("names the industry from the employer's NAICS code", async () => {
    const { container } = await page();
    expect(container.textContent).toMatch(/Industry/);
    expect(container.textContent).toMatch(/\(NAICS 56173\d?\)/);
  });

  it("links the employer to the page the nightly map gives its spelling", async () => {
    await page();
    expect(screen.getByRole("link", { name: "Acme Landscaping LLC" })).toHaveAttribute(
      "href",
      "/perm-employers/acme-landscaping",
    );
  });

  it("prints an employer or a firm with no page as text, never a link to nothing", async () => {
    reads.employerPages = new Map();
    reads.firmPages = new Set();
    await page();
    expect(screen.queryByRole("link", { name: "Acme Landscaping LLC" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Example Visa Group" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Acme Landscaping LLC").length).toBeGreaterThan(0);
    expect(screen.getByText("Example Visa Group")).toBeInTheDocument();
  });

  it("links the employer on a live record too, from the live row's own slug", async () => {
    reads.record = null;
    reads.posting = null;
    reads.row = {
      caseNumber: "H-400-25301-000123",
      status: "FULL CERTIFICATION",
      isFinal: true,
      filingDate: "2025-10-28",
      submittedDate: null,
      employerName: "ACME LANDSCAPING, L.L.C.",
      employerSlug: "acme-landscaping-llc",
      jobTitle: "Landscape Laborer",
      lastCheckedAt: "2026-11-20",
    };
    await page();
    const record = screen.getByRole("heading", { name: "The record" }).closest("section")!;
    expect(within(record).getByRole("link", { name: "ACME LANDSCAPING, L.L.C." })).toHaveAttribute(
      "href",
      "/perm-employers/acme-landscaping",
    );
  });
});

describe("an H-2B or CW-1 wage request", () => {
  it("shows the level DOL set and the job's requirements from the prevailing wage file", async () => {
    reads.record = { ...RECORD, caseNumber: "P-400-25200-000555", visaClass: "H-2B", workers: null, workersCertified: null };
    reads.posting = null;
    reads.detail = {
      level: "II",
      expires: null,
      determinedOn: "2025-11-19",
      education: "None",
      experienceMonths: 3,
      altEducation: null,
      altExperienceMonths: null,
      acwia: null,
      worksiteCity: "Austin",
      naics: "561730",
    };
    const { container } = await page("P-400-25200-000555");
    expect(reads.detailAsked).toEqual(["P-400-25200-000555"]);
    expect(container.textContent).toMatch(/Wage level DOL set/);
    expect(container.textContent).toMatch(/Level II/);
    expect(container.textContent).toMatch(/What the job requires/);
    expect(container.textContent).toMatch(/3 months of experience/);
  });

  it("never asks the prevailing wage file about an application", async () => {
    await page();
    expect(reads.detailAsked).toEqual([]);
  });
});

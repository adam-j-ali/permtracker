import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * An LCA's page prints DOL's decided record, and on the few LCAs whose file cites a wage request, a link to that
 * request's own page. The record never waits on that link: a read that fails leaves the row out and nothing else.
 */
const reads = vi.hoisted(() => ({ wageRequest: null as string | null, failWageRequest: false, soft: [] as string[] }));

const DISCLOSED = {
  caseNumber: "I-200-25340-123456",
  status: "CERTIFIED",
  receivedDate: "2025-12-06",
  decisionDate: "2025-12-15",
  employerName: "Acme Robotics Inc",
  employerSlug: "acme-robotics-inc",
  jobTitle: "Controls Engineer",
  socCode: "17-2071",
  socTitle: "Electrical Engineers",
  wage: 128000,
  wageUnit: "Year",
  worksiteState: "CA",
  visaClass: "H-1B",
  fiscalYear: 2026,
  attorneyName: null,
  attorneySlug: null,
  naics: null,
  worksiteCity: null,
};

vi.mock("@/lib/db/lcaCasesTypes", () => ({
  // DOL's live service didn't return the number, so the page stands on the quarterly file alone.
  lookupLcaCaseOutcome: vi.fn(async () => ({ row: null, dolMiss: null })),
  lookupLcaDisclosed: vi.fn(async () => DISCLOSED),
  lookupLcaWageRequest: vi.fn(async () => {
    if (reads.failWageRequest) throw new Error("query deadline");
    return reads.wageRequest;
  }),
}));
vi.mock("@/lib/softRead", () => ({
  softFail: (label: string, fallback: unknown) => () => {
    reads.soft.push(label);
    return fallback;
  },
}));

const { LcaLookup } = await import("../LcaStatusResult");

beforeEach(() => {
  reads.wageRequest = null;
  reads.failWageRequest = false;
  reads.soft = [];
});

describe("an LCA's page and the wage request it cites", () => {
  it("links the cited wage request to its own page", async () => {
    reads.wageRequest = "P-100-25300-654321";
    render((await LcaLookup({ caseNumber: "I-200-25340-123456" })) as ReactElement);
    expect(screen.getByText("Wage request it cites")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "P-100-25300-654321" });
    expect(link).toHaveAttribute("href", "/perm-case-status?case=P-100-25300-654321");
  });

  it("leaves the row out when the file cites none, as on nearly every LCA", async () => {
    render((await LcaLookup({ caseNumber: "I-200-25340-123456" })) as ReactElement);
    expect(screen.queryByText("Wage request it cites")).not.toBeInTheDocument();
    expect(screen.getByText("Wage offered")).toBeInTheDocument();
    expect(reads.soft).toEqual([]);
  });

  it("still draws the record when that one read fails, and records the failure", async () => {
    reads.failWageRequest = true;
    render((await LcaLookup({ caseNumber: "I-200-25340-123456" })) as ReactElement);
    expect(screen.getByText("Wage offered")).toBeInTheDocument();
    expect(screen.getByText("Controls Engineer")).toBeInTheDocument();
    expect(screen.queryByText("Wage request it cites")).not.toBeInTheDocument();
    expect(reads.soft).toEqual(["LcaStatusResult.lookupLcaWageRequest"]);
  });
});

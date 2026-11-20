import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PwdLikelySection } from "../PwdLikelySection";

const likely = {
  past: [
    { caseNumber: "P-100-26076-707795", determinedOn: "2026-06-24", socCode: "11-3021", socTitle: "Computer and Information Systems Managers", level: "IV", wage: 238285, wageUnit: "YEAR", worksiteCity: "Boston", worksiteState: "MA", education: "Bachelor's", experienceMonths: 72 },
    { caseNumber: "P-100-26009-547922", determinedOn: "2026-05-13", socCode: "11-3021", socTitle: "Computer and Information Systems Managers", level: "IV", wage: 209394, wageUnit: "YEAR", worksiteCity: "Westlake", worksiteState: "TX", education: null, experienceMonths: null },
  ],
  soc: { code: "11-3021", title: "Computer and Information Systems Managers", basis: "employer" as const, share: 1 },
  area: { code: "71654", name: "Boston-Cambridge-Newton", city: "Boston, MA", jobs: 1 },
  levels: { wageYear: 2026, yearly: [150000, 180000, 210000, 240000], levels: [null, null, null, null] as [null, null, null, null], annual: false, label: null },
};

describe("PwdLikelySection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the employer's past determinations, the likely code and level, and DOL's four wages, labelled an estimate", async () => {
    const basis = {
      ok: true,
      soc: "11-3021",
      wageYear: 2026,
      occupations: [{ onetCode: "11-3021.00", title: "Computer and Information Systems Managers", jobZone: 4, education: "bachelor", appendixA: true, usable: true }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(basis))));
    render(<PwdLikelySection likely={likely} jobTitle="Director, Full Stack Engineering" state={null} />);
    expect(screen.getByText(/An estimate\./)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /past determinations/ })).toBeInTheDocument();
    expect(screen.getByText(/The code DOL used on 2 of this employer's 2 past determinations/)).toBeInTheDocument();
    expect(screen.getAllByText("Level IV").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("$240,000 a year")).toBeInTheDocument();
    expect(screen.getByText("Which level will DOL likely give this job?")).toBeInTheDocument();
    // The estimate starts from the employer's newest request for the title, never from blank answers.
    expect(screen.getByText(/starts from what the employer's newest request for the title asked for \(bachelor's degree, 72 months of experience\)/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Months of experience/)).toHaveValue(72);
    expect(screen.getByLabelText(/Degree the job requires/)).toHaveValue("bachelor");
  });
});

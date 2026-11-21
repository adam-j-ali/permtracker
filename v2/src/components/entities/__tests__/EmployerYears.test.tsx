import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmployerYears } from "../EmployerYears";

const YEARS = [
  { fy: 2008, certified: 10, denied: 2, withdrawn: 1 },
  { fy: 2010, certified: 30, denied: 0, withdrawn: 0 },
  { fy: 2021, certified: 5, denied: 1, withdrawn: 0 },
];
const CASES = [
  { caseNumber: "A-20001-11111", status: "certified", decisionDate: "2021-03-01", jobTitle: "Engineer", state: "WA", wage: 104000 },
];

describe("EmployerYears", () => {
  it("renders nothing when the employer has no years", () => {
    const { container } = render(<EmployerYears years={[]} cases={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws no chart for a single year, and still lists that year's cases under that year", () => {
    render(<EmployerYears years={[{ fy: 2021, certified: 1, denied: 0, withdrawn: 0 }]} cases={CASES} />);
    expect(screen.queryByText(/Year by year since/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decided in FY2021" })).toBeInTheDocument();
  });

  /**
   * The older table reaches FY2008, so the list's heading, its table's name and its "of N" say the employer's own
   * older years, never a fixed FY2016 to FY2023 (the Nov 20 2026 sweep, item 28).
   */
  it("names the employer's own older years, from FY2008, and counts every one of them", () => {
    const years = [...YEARS, { fy: 2025, certified: 40, denied: 0, withdrawn: 0 }];
    render(<EmployerYears years={years} cases={CASES} />);
    expect(screen.getByRole("heading", { name: "Decided in FY2008 to FY2021" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cases decided in FY2008 to FY2021" })).toBeInTheDocument();
    // FY2008, FY2010 and FY2021: 13 + 30 + 6. FY2025 is the current table's, never this list's.
    expect(screen.getByText(/The 1 most recent of 49\./)).toBeInTheDocument();
    expect(screen.queryByText(/FY2016 to FY2023/)).toBeNull();
  });

  it("takes the years from the cases when the yearly table has none", () => {
    const cases = [
      { ...CASES[0]!, caseNumber: "A-12001-11111", decisionDate: "2012-10-03" },
      { ...CASES[0]!, caseNumber: "A-10001-11111", decisionDate: "2010-02-01" },
    ];
    render(<EmployerYears years={[]} cases={cases} />);
    expect(screen.getByRole("heading", { name: "Decided in FY2010 to FY2013" })).toBeInTheDocument();
    expect(screen.getByText("All 2.")).toBeInTheDocument();
  });

  it("draws every year from the first to the last, a missing year as zero", () => {
    const { container } = render(<EmployerYears years={YEARS} cases={[]} />);
    const rows = [...container.querySelectorAll("tbody tr")].map((r) => r.textContent?.trim().split(/\s+/)[0]);
    expect(rows).toEqual(Array.from({ length: 14 }, (_, i) => `FY${2008 + i}`));
    const fy2009 = [...container.querySelectorAll("tbody tr")][1]!;
    expect(fy2009.textContent).toMatch(/FY2009\s+0\s+0\s+0/);
    expect(screen.getByText(/49 PERM decisions from FY2008 to FY2021, busiest in FY2010 with 30/)).toBeInTheDocument();
  });

  it("says how many of its older cases it lists, and links each to its lookup", () => {
    render(<EmployerYears years={YEARS} cases={CASES} lastYearPartial="DOL's newest file runs through June 2026" />);
    expect(screen.getByText(/The 1 most recent of 49\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A-20001-11111" })).toHaveAttribute(
      "href", "/perm-case-status?case=A-20001-11111",
    );
    expect(screen.getByText(/FY2021 is partial: DOL's newest file runs through June 2026\./)).toBeInTheDocument();
  });
});

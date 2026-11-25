// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReportedOverview } from "../ReportedOverview";

const overview = {
  people: 728,
  inSeveral: 29,
  i140s: 448,
  bySource: [
    { source: "visastats", cases: 448 },
    { source: "reddit", cases: 174 },
    { source: "sfv-filers", cases: 131 },
    { source: "timeline", cases: 4 },
  ],
  offices: [{ office: "SFV", cases: 276 }],
};

describe("every case people reported, at a glance", () => {
  it("counts each person once, says how many were in two places, and links each slice", () => {
    const { container } = render(<ReportedOverview overview={overview} />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Every case people reported, from every source");
    expect(text).toContain("728");
    expect(text).toContain("29");
    expect(text).toContain("all at San Fernando Valley");
    const links = [...container.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toContainEqual(["I-140s: 448 cases, by category and premium processing", "/uscis-processing-times/i-140#reported"]);
    expect(links.some(([t, h]) => String(t).includes("276 cases") && String(h).endsWith("#reported-cases"))).toBe(true);
  });

  it("says 1 case, never 1 cases", () => {
    const { container } = render(<ReportedOverview overview={{ ...overview, offices: [...overview.offices, { office: "SBD", cases: 1 }] }} />);
    const text = container.textContent ?? "";
    expect(text).toContain("San Bernardino: 1 case");
    expect(text).not.toMatch(/\b1 cases\b/);
  });

  it("names each source the way the office page does", () => {
    const { container } = render(<ReportedOverview overview={overview} />);
    const text = container.textContent ?? "";
    for (const name of ["VisaStats", "Reddit", "San Fernando Filers", "Shared here"]) expect(text).toContain(name);
  });

  it("names the cases the figures count that aren't listed, so two 'each person once' counts don't read as a mistake", () => {
    const people = overview.people;
    const withGap = render(<ReportedOverview overview={overview} counted={people + 442} />).container.textContent ?? "";
    expect(withGap).toContain("also count 442 more, timelines and saved cases their owners shared privately");
    const even = render(<ReportedOverview overview={overview} counted={people} />).container.textContent ?? "";
    expect(even).not.toContain("also count");
  });

  it("shows nothing before the first build or with no cases", () => {
    expect(render(<ReportedOverview overview={null} />).container.textContent).toBe("");
    expect(render(<ReportedOverview overview={{ ...overview, people: 0 }} />).container.textContent).toBe("");
  });
});

/**
 * The facet modules carry the same small-n discipline as the rest of the
 * site, and one extra job: two facet rows can share a label because DOL
 * accepts two SOC vintages, so the code has to be printed.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FacetRow } from "@/lib/db/entityDetail";

import { groupIndustries, IndustryMix, OccupationMix, PartyMix, PlaceMix, RecruitmentMix, StateMix } from "../FilingMakeup";

function facet(over: Partial<FacetRow> = {}): FacetRow {
  return {
    key: "software-developers",
    label: "Software Developers",
    code: "15-1252.00",
    n: 749,
    certified: 700,
    denied: 40,
    ...over,
  };
}

describe("OccupationMix", () => {
  it("leads with the dominant occupation and its share of the whole", () => {
    render(<OccupationMix rows={[facet()]} total={2490} />);
    expect(screen.getByRole("link", { name: "Software Developers" })).toHaveAttribute(
      "href",
      "/perm-wages/software-developers",
    );
    expect(screen.getByText(/30% of everything they file/)).toBeInTheDocument();
  });

  it("prints the rate once the decided count can carry one", () => {
    render(<OccupationMix rows={[facet()]} total={2490} />);
    // 700 certified of 740 decided, which is over the site-wide floor.
    expect(screen.getByText(/94\.6% approved/)).toBeInTheDocument();
  });

  it("withholds the rate below the floor and still prints the count", () => {
    render(
      <OccupationMix rows={[facet({ n: 4, certified: 3, denied: 1 })]} total={4} />,
    );
    // Three of four is not a 75% approval rate. It is four cases.
    expect(screen.queryByText(/approved/)).not.toBeInTheDocument();
    expect(screen.getByText(/4 filings/)).toBeInTheDocument();
  });

  it("prints the SOC code, because one job can appear under two vintages", () => {
    render(
      <OccupationMix
        rows={[
          facet({ key: "electronics-engineers-except-computer", code: "17-2072.00", n: 527 }),
          facet({
            key: "electronics-engineers-except-computer-2",
            label: "Electronics Engineers, Except Computer",
            code: "17-2072",
            n: 70,
          }),
        ]}
        total={2490}
      />,
    );
    // Two rows, identical label, different codes. Without the code printed
    // this reads as a duplicate-rendering bug rather than as DOL's own data.
    expect(screen.getByText(/SOC 17-2072\.00/)).toBeInTheDocument();
    expect(screen.getByText("17-2072")).toBeInTheDocument();
  });

  it("renders nothing when there are no rows", () => {
    const { container } = render(<OccupationMix rows={[]} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StateMix", () => {
  it("spells the state out and does not pretend the chip is tappable", () => {
    const { container } = render(
      <StateMix rows={[facet({ key: "CA", label: "CA", code: null, n: 1520 })]} total={2490} />,
    );
    expect(screen.getByText("California")).toBeInTheDocument();
    // `/perm-by-state` is one page, not a route per state. A chip styled as a
    // control that goes nowhere is worse than a chip that is plainly not one.
    expect(container.querySelectorAll("li a")).toHaveLength(0);
  });

  it("keeps the one link it does have pointed at the state map", () => {
    render(<StateMix rows={[facet({ key: "CA", label: "CA", code: null })]} total={2490} />);
    expect(screen.getByRole("link", { name: "state map" })).toHaveAttribute(
      "href",
      "/perm-by-state",
    );
  });
});

describe("PartyMix", () => {
  it("links each party to its own page and states the covered share", () => {
    render(
      <PartyMix
        rows={[facet({ key: "apple-inc", label: "APPLE INC.", code: null, n: 2800 })]}
        total={4000}
        title="Who they file for"
        note="The employers named on the most applications."
        hrefBase="/perm-employers"
      />,
    );
    expect(screen.getByRole("link", { name: "APPLE INC." })).toHaveAttribute(
      "href",
      "/perm-employers/apple-inc",
    );
    expect(screen.getByText(/2,800 of 4,000 filings, 70% of the\s+total/)).toBeInTheDocument();
  });

  it("renders a plain name when the party has no page to link to", () => {
    render(
      <PartyMix
        rows={[facet({ key: null, label: "SOME EMPLOYER", code: null, n: 12 })]}
        total={12}
        title="Who they file for"
        note="Note."
        hrefBase="/perm-employers"
      />,
    );
    expect(screen.queryByRole("link", { name: "SOME EMPLOYER" })).not.toBeInTheDocument();
    expect(screen.getByText("SOME EMPLOYER")).toBeInTheDocument();
  });
});

describe("IndustryMix", () => {
  // Microsoft's rows, Oct 11 2026: four NAICS editions of one industry.
  const rows = [
    facet({ key: "513210", label: "Software Publishers", code: null, n: 4432 }),
    facet({ key: "51121", label: "Software Publishers", code: null, n: 1801 }),
    facet({ key: "511210", label: "Software Publishers", code: null, n: 556 }),
    facet({ key: "541511", label: "Custom Computer Programming Services", code: null, n: 40 }),
    facet({ key: "51321", label: "Software Publishers", code: null, n: 70 }),
  ];

  it("lists an industry once, with every code it was filed under", () => {
    const g = groupIndustries(rows);
    expect(g.map((r) => r.label)).toEqual(["Software Publishers", "Custom Computer Programming Services"]);
    expect(g[0]).toEqual({ label: "Software Publishers", codes: ["513210", "51121", "511210", "51321"], n: 6859 });
  });

  it("renders the title once", () => {
    render(<IndustryMix rows={rows} />);
    expect(screen.getAllByText("Software Publishers")).toHaveLength(1);
    expect(screen.getByText(/NAICS 513210, 51121, 511210, 51321/)).toBeInTheDocument();
  });

  it("keeps a word between a smaller industry's codes and its count", () => {
    // Arrange, Act
    const { container } = render(<IndustryMix rows={rows} />);
    // Assert: "541511 40", never "54151140"
    expect(container.textContent).toMatch(/541511 40/);
  });
});

describe("RecruitmentMix", () => {
  const paper = (label: string, n: number): FacetRow => ({ key: null, label, code: null, n, certified: n, denied: 0 });
  const lead: FacetRow[] = [{ key: "150-180", label: "150 to 180 days", code: null, n: 40, certified: 40, denied: 0 }];

  it("states one paper as a line, not as a chart of one full bar in its own box", () => {
    render(<RecruitmentMix papers={[paper("Wisconsin State Journal", 1626)]} lead={lead} />);
    expect(screen.queryByText("Newspapers it advertised in")).toBeNull();
    expect(screen.getByText("Newspaper it advertised in")).toBeInTheDocument();
    expect(screen.getByText("Wisconsin State Journal")).toBeInTheDocument();
    expect(screen.getByText(/1,626 cases, its only paper/)).toBeInTheDocument();
    // The one box left takes the row whole: no two-column grid for a single box.
    expect(screen.getByText("How long before filing it began").closest("div.grid")?.className).not.toMatch(/md:grid-cols-2/);
  });

  it("keeps the chart when there are several papers to compare", () => {
    render(<RecruitmentMix papers={[paper("The Seattle Times", 40), paper("Seattle Weekly", 3)]} lead={lead} />);
    expect(screen.getByText("Newspapers it advertised in")).toBeInTheDocument();
    expect(screen.getByText("How long before filing it began").closest("div.grid")?.className).toMatch(/md:grid-cols-2/);
  });
});

/**
 * The current figures count FY2024 on and the older ones FY2008 to FY2023, each over its own total, so every share
 * says which years it's a share of (the Nov 20 2026 sweep, item 28).
 */
describe("a share says which years it covers", () => {
  it("the lead job's share names its years", () => {
    render(<OccupationMix rows={[facet()]} total={2490} period="since FY2024" />);
    expect(screen.getByText(/30% of their filings since FY2024/)).toBeInTheDocument();
    expect(screen.queryByText(/everything they file/)).toBeNull();
    expect(screen.getByText(/the most filings since FY2024, 749 of 2,490 cases between them/)).toBeInTheDocument();
  });

  it("a party list's note names its years", () => {
    render(
      <PartyMix
        rows={[facet({ key: "apple-inc", label: "APPLE INC.", code: null, n: 2800 })]}
        total={4000}
        title="Who they filed for"
        note="The employers named on the most applications."
        hrefBase="/perm-employers"
        period="in FY2012 to FY2023"
      />,
    );
    expect(screen.getByText(/2,800 of 4,000 filings in FY2012 to FY2023, 70% of the\s+total/)).toBeInTheDocument();
  });

  it("the places' note names its years", () => {
    render(
      <PlaceMix
        states={[facet({ key: "WA", label: "WA", code: null, n: 30 }), facet({ key: "CA", label: "CA", code: null, n: 10 })]}
        cities={[]}
        total={50}
        period="in FY2012 to FY2023"
      />,
    );
    expect(screen.getByText(/These 2 states cover 40 of 50 filings in FY2012 to FY2023/)).toBeInTheDocument();
  });

  it("the state chips' note names its years", () => {
    render(<StateMix rows={[facet({ key: "CA", label: "CA", code: null, n: 1520 })]} total={2490} period="since FY2024" />);
    expect(screen.getByText(/This state covers 1,520 of 2,490 filings since FY2024/)).toBeInTheDocument();
  });

  it("without a period the wording is as before", () => {
    render(<OccupationMix rows={[facet()]} total={2490} />);
    expect(screen.getByText(/30% of everything they file/)).toBeInTheDocument();
  });
});

describe("the state chips stay six however many states the facet holds", () => {
  // The facet keeps every state now (the map draws them all); the chips stay the six busiest.
  const CODES = ["TX", "OR", "CA", "WA", "NY", "NJ", "MA", "IL", "GA"];
  const states = CODES.map((key, i) => facet({ key, label: key, code: null, n: 100 - i * 10 }));

  it("PlaceMix shows six chips, says how many more there are, and points at the map when the page has one", () => {
    const { container } = render(<PlaceMix states={states} cities={[]} total={900} mapHref="#where" />);
    const chips = [...container.querySelectorAll("li")].filter((li) => /\d/.test(li.textContent ?? "") && !/more/.test(li.textContent ?? ""));
    expect(chips.map((li) => li.textContent?.split(" ")[0])).toEqual(["Texas", "Oregon", "California", "Washington", "New", "New"]);
    const more = screen.getByRole("link", { name: "3 more states on the map" });
    expect(more.getAttribute("href")).toBe("#where");
    // The note counts what the chips show.
    expect(screen.getByText(/These 6 states cover 450 of 900 filings/)).toBeInTheDocument();
  });

  it("without a map on the page, the rest is a plain count, never a dead link", () => {
    render(<PlaceMix states={states} cities={[]} total={900} />);
    expect(screen.getByText("3 more states")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /more states/ })).toBeNull();
  });

  it("StateMix does the same", () => {
    const { container } = render(<StateMix rows={states} total={900} mapHref="#where" />);
    expect(container.querySelectorAll("li").length).toBe(7);
    expect(screen.getByRole("link", { name: "3 more states on the map" }).getAttribute("href")).toBe("#where");
  });

  it("six or fewer states show no count of more", () => {
    render(<PlaceMix states={states.slice(0, 6)} cities={[]} total={900} mapHref="#where" />);
    expect(screen.queryByText(/more state/)).toBeNull();
  });

  it("PlaceMix takes a title, so it needn't repeat the heading of the part it sits in", () => {
    render(<PlaceMix states={states} cities={[]} total={900} title="The busiest states and cities" />);
    expect(screen.getByText("The busiest states and cities")).toBeInTheDocument();
  });
});


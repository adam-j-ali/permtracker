import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GroupView, groupAnswer, groupFigures } from "../GroupView";
import type { GroupDetail, GroupSummary } from "@/lib/db/groups";

const ranked = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, n: 100 - i }));

const detail: GroupDetail = {
  years: [
    { fy: 2023, certified: 90, denied: 10, withdrawn: 0 },
    { fy: 2024, certified: 135, denied: 15, withdrawn: 0 },
    { fy: 2025, certified: 40, denied: 2, withdrawn: 0 },
  ],
  employers: Array.from({ length: 14 }, (_, i) => ({ slug: i === 0 ? "acme-corp" : null, name: `Sponsor ${i + 1}`, n: 60 - i })),
  occupations: [{ code: "15-1252", title: "Software Developers", slug: "software-developers", n: 50 }],
  states: ranked("S", 3),
  cities: [],
  countries: [],
  industries: [{ code: "541511", title: "Custom Computer Programming Services", n: 30 }],
  education: [{ key: "Master's", n: 40 }],
  visa: [],
};

const group: GroupSummary & { detail: GroupDetail } = {
  kind: "city",
  slug: "boise-id",
  key: "BOISE|ID",
  label: "Boise, ID",
  total: 292,
  certified: 265,
  denied: 27,
  withdrawn: 0,
  medianWage: 118000,
  fyFrom: 2016,
  fyTo: 2025,
  detail,
};

describe("groupFigures", () => {
  it("gives three figures: how many, how they were decided with the counts, and what they paid", () => {
    const cards = groupFigures(group, detail.years, 2025);
    expect(cards.map((c) => c.k)).toEqual(["Decisions", "Approval", "Median certified wage"]);
    expect(cards[0]).toMatchObject({ v: "292", sub: "FY2016 to FY2025", icon: "filings" });
    // The newest year is partial, so the trend compares the two complete ones: 100 to 150.
    expect(cards[0]!.trend).toMatchObject({ text: "Up 50% in FY2024", tone: "info" });
    expect(cards[1]).toMatchObject({ v: "90.8%", sub: "265 certified, 27 denied", icon: "approval" });
    expect(cards[2]).toMatchObject({ v: "$118,000", icon: "wage" });
  });

  it("withholds a rate on too few decisions, and says so with the counts", () => {
    const cards = groupFigures({ ...group, certified: 9, denied: 2 }, detail.years, null);
    expect(cards[1]).toMatchObject({ v: "Not shown", sub: "9 certified, 2 denied: too few to rate" });
  });

  it("says when there's no wage, rather than dropping the figure", () => {
    expect(groupFigures({ ...group, medianWage: null }, detail.years, null)[2]).toMatchObject({ v: "n/a" });
  });
});

describe("groupAnswer", () => {
  it("answers in one line: how many decisions, over which years, and who filed the most", () => {
    expect(groupAnswer("city", group)).toBe(
      "292 PERM decisions from FY2016 to FY2025 name Boise, ID as the worksite. Sponsor 1 filed the most.",
    );
    expect(groupAnswer("industry", { ...group, label: "Software Publishers" })).toBe(
      "292 PERM decisions from FY2016 to FY2025 carry this industry's code. Sponsor 1 filed the most.",
    );
    expect(groupAnswer("country", { ...group, label: "India" })).toBe(
      "292 PERM decisions from FY2016 to FY2025 were for citizens of India. Sponsor 1 filed the most.",
    );
  });

  it("leaves out the sponsor when none is named, and a span of one year reads as that year", () => {
    expect(groupAnswer("city", { ...group, fyFrom: 2025, fyTo: 2025, detail: { ...detail, employers: [] } })).toBe(
      "292 PERM decisions in FY2025 name Boise, ID as the worksite.",
    );
  });
});

describe("GroupView", () => {
  it("opens on who files and for what, in boxes, with the year chart after and the rest folded", () => {
    const { container } = render(<GroupView kind="city" group={group} />);
    const text = container.textContent!;
    const at = (s: string) => {
      const i = text.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    expect(at("Top sponsors")).toBeLessThan(at("Top occupations"));
    expect(at("Top occupations")).toBeLessThan(at("Year by year"));
    expect(at("Year by year")).toBeLessThan(at("Industries"));
    // The lead lists are open, in the house's box.
    const sponsors = screen.getByRole("heading", { name: "Top sponsors" }).closest("section")!;
    expect(sponsors.className).toMatch(/\bborder-2\b/);
    expect(sponsors.className).toMatch(/\bshadow-hard-sm\b/);
    expect(sponsors.closest("details")).toBeNull();
    // The rest waits behind one line that names what's inside. A city is its own worksite, so it lists no states.
    expect(screen.queryByRole("heading", { name: "Worksite states" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Industries" }).closest("details")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Worker's education" }).closest("details")).not.toBeNull();
    expect(text).toContain("More of the record The industries and education");
  });

  it("folds a country's worksite states with the rest", () => {
    render(<GroupView kind="country" group={{ ...group, kind: "country", label: "India" }} />);
    expect(screen.getByRole("heading", { name: "Worksite states" }).closest("details")).not.toBeNull();
  });

  it("shows the busiest ten of a long list and keeps the rest one press away, every name still in the page", () => {
    render(<GroupView kind="city" group={group} />);
    const sponsors = screen.getByRole("heading", { name: "Top sponsors" }).closest("section")!;
    expect(within(sponsors).getByText("Sponsor 14")).toBeTruthy();
    expect(within(sponsors).getByText("Sponsor 11").closest("details")).not.toBeNull();
    expect(within(sponsors).getByText("Sponsor 10").closest("details")).toBeNull();
    expect(within(sponsors).getByText("The other 4")).toBeTruthy();
  });

  it("draws no fold when nothing is left to fold", () => {
    const bare = { ...group, detail: { ...detail, states: [], industries: [], education: [] } };
    const { container } = render(<GroupView kind="city" group={bare} />);
    expect(container.textContent).not.toContain("More of the record");
    expect(container.textContent).toContain("The other 4");
  });
});

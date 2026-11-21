/**
 * What an employer's or a firm's older cases (FY2008 to FY2023) were made of, beside the current figures (FY2024 on)
 * and never mixed with them: its own total, its own years, and every share a share of those (the Nov 20 2026 sweep,
 * item 28).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FacetRow } from "@/lib/db/entityDetail";
import type { HistoryMakeup as Makeup } from "@/lib/db/employerHistory";

import { HistoryMakeup, historyYears } from "../HistoryMakeup";

function facet(over: Partial<FacetRow> = {}): FacetRow {
  return { key: null, label: "x", code: null, n: 1, certified: 1, denied: 0, ...over };
}

const employer: Makeup = {
  total: 120,
  fyFrom: 2012,
  fyTo: 2023,
  facets: {
    occupation: [facet({ key: "software-developers", label: "Software Developers", code: "15-1252.00", n: 90, certified: 85, denied: 2 })],
    state: [facet({ key: "WA", label: "WA", n: 100 }), facet({ key: "CA", label: "CA", n: 20 })],
    city: [facet({ key: "SEATTLE|WA", label: "Seattle, WA", n: 80 })],
    industry: [facet({ key: "541511", label: "Custom Computer Programming Services", n: 110 })],
    attorney: [facet({ key: "law-firm-llp", label: "Law Firm LLP", n: 70 }), facet({ key: null, label: "Old Firm PC", n: 10 })],
  },
};

describe("HistoryMakeup", () => {
  it("names its years and its own total in the heading and the line under it", () => {
    render(<HistoryMakeup makeup={employer} subject="employer" />);
    expect(screen.getByRole("heading", { name: "What they filed, and where, FY2012 to FY2023" })).toBeInTheDocument();
    expect(screen.getByText(/From its 120 cases DOL decided in FY2012 to FY2023/)).toBeInTheDocument();
  });

  it("gives every share as a share of those years' cases", () => {
    render(<HistoryMakeup makeup={employer} subject="employer" />);
    expect(screen.getByText(/75% of their filings in FY2012 to FY2023/)).toBeInTheDocument();
    expect(screen.getByText(/80 of 120 filings in FY2012 to FY2023/)).toBeInTheDocument();
    expect(screen.getByText(/These 2 states cover 120 of 120 filings in FY2012 to FY2023/)).toBeInTheDocument();
    expect(screen.queryByText(/everything they file/)).toBeNull();
  });

  it("links what has a page and names what doesn't", () => {
    render(<HistoryMakeup makeup={employer} subject="employer" />);
    expect(screen.getByRole("link", { name: "Law Firm LLP" })).toHaveAttribute("href", "/perm-attorneys/law-firm-llp");
    expect(screen.queryByRole("link", { name: "Old Firm PC" })).toBeNull();
    expect(screen.getByText("Old Firm PC")).toBeInTheDocument();
    expect(screen.getByText("Custom Computer Programming Services")).toBeInTheDocument();
  });

  it("shows a firm's clients, jobs and states", () => {
    const firm: Makeup = {
      total: 40,
      fyFrom: 2019,
      fyTo: 2019,
      facets: {
        employer: [facet({ key: "acme-inc", label: "ACME INC", n: 30 })],
        occupation: [facet({ key: "software-developers", label: "Software Developers", code: "15-1252.00", n: 40 })],
        state: [facet({ key: "TX", label: "TX", n: 40 })],
      },
    };
    render(<HistoryMakeup makeup={firm} subject="firm" />);
    expect(screen.getByRole("heading", { name: "The practice, FY2019" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ACME INC" })).toHaveAttribute("href", "/perm-employers/acme-inc");
    expect(screen.getByText("Texas")).toBeInTheDocument();
  });

  it("renders nothing without older cases", () => {
    const { container } = render(<HistoryMakeup makeup={null} subject="employer" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("words one year and a span", () => {
    expect(historyYears({ ...employer, fyFrom: 2019, fyTo: 2019 })).toBe("FY2019");
    expect(historyYears(employer)).toBe("FY2012 to FY2023");
  });
});

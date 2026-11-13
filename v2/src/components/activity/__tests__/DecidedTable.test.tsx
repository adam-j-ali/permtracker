// @vitest-environment jsdom
/**
 * The published decisions come a page sized for the screen.
 *
 * The table showed 50 rows a page at every width, and a walk of the page at 390px measured that as 5.9 screens of
 * rows (Nov 13 2026). Every list shows a short page on a phone, with a pager and a rows choice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { DecidedCase } from "@/lib/db/decidedDays";

import { DecidedTable } from "../DecidedTable";

const screenIs = (narrow: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: narrow && q.includes("max-width"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
afterEach(() => vi.unstubAllGlobals());

function cases(n: number): DecidedCase[] {
  return Array.from({ length: n }, (_, i) => ({
    caseNumber: `G-100-25001-${String(i).padStart(6, "0")}`,
    program: "perm",
    status: "certified",
    decidedOn: "2025-03-03",
    receivedOn: "2024-01-02",
    employerName: `Employer ${i}`,
    employerSlug: null,
    jobTitle: "Engineer",
    socCode: null,
    socTitle: null,
    state: null,
    wage: null,
    wageUnit: null,
    attorneyName: null,
    attorneySlug: null,
  })) as unknown as DecidedCase[];
}

const table = (n: number) => (
  <DecidedTable rows={cases(n)} sort={{ key: "decided", dir: -1 }} onSort={() => {}} caption="Cases DOL decided" />
);
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").length - 1;

describe("the published decisions, a page at a time", () => {
  it("shows ten rows on a phone", () => {
    // Arrange
    screenIs(true);
    // Act
    render(table(120));
    // Assert
    expect(bodyRows()).toBe(10);
  });

  it("shows fifty on a wide screen", () => {
    screenIs(false);
    render(table(120));
    expect(bodyRows()).toBe(50);
  });

  it("offers the rows choice, and a pick starts from the first page", () => {
    // Arrange: a phone, on its second page.
    screenIs(true);
    render(table(120));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("11 to 20 of 120 decided cases")).toBeInTheDocument();
    // Act
    fireEvent.click(screen.getByRole("button", { name: "25 rows per page" }));
    // Assert
    expect(bodyRows()).toBe(25);
    expect(screen.getByText("1 to 25 of 120 decided cases")).toBeInTheDocument();
  });

  it("goes back to the first page when the rows change", () => {
    screenIs(true);
    const { rerender } = render(table(120));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    rerender(table(60));
    expect(screen.getByText("1 to 10 of 60 decided cases")).toBeInTheDocument();
  });
});

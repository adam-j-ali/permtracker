import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StartYears } from "../StartYears";
import { fillStartYears, type EmployerStarts, type StartYear } from "@/lib/employerStarts";

const y = (year: number, wageRequests: number, permFiled: number, scheduleA = 0, jobKnown = wageRequests): StartYear => ({
  year,
  wageRequests,
  permFiled,
  scheduleA,
  jobKnown,
});

const starts = (years: StartYear[], newestWageRequest: string | null, newestPerm: string | null): EmployerStarts => ({
  years: fillStartYears(years, 2026),
  newestWageRequest,
  newestPerm,
});

const google = starts([y(2023, 62, 55), y(2024, 1014, 0), y(2025, 209, 1), y(2026, 1894, 23)], "2026-11-12", "2026-10-30");

describe("StartYears", () => {
  it("puts each year's wage requests beside its PERM applications, the newest of each dated above", () => {
    render(<StartYears starts={google} />);
    expect(screen.getByRole("heading", { level: 3, name: "Wage requests and PERM applications, by year" })).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Its newest wage request went in on November 12, 2026, and its newest PERM application on October 30, 2026.",
    );
    const table = screen.getByRole("table", { name: "Wage requests and PERM applications, by year" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual([
      "Year",
      "Wage requests",
      "PERM applications",
    ]);
    const body = within(table).getAllByRole("row").slice(1);
    expect(body).toHaveLength(4);
    expect(within(body[1]!).getByRole("rowheader").textContent?.trim()).toBe("2024");
    expect(within(body[1]!).getAllByRole("cell").map((c) => c.textContent?.trim())).toEqual(["1,014", "0"]);
    expect(within(body[3]!).getAllByRole("cell").map((c) => c.textContent?.trim())).toEqual(["1,894", "23"]);
  });

  it("marks the current year as unfinished, with a space between the year and the note", () => {
    render(<StartYears starts={google} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[3]!.querySelector("th")!.textContent).toMatch(/^2026 so far\s*$/);
    expect(rows[2]!.querySelector("th")!.textContent).toMatch(/^2025\s*$/);
  });

  it("draws both columns on one scale, and no bar for a zero", () => {
    render(<StartYears starts={google} />);
    const rows = screen.getAllByRole("row").slice(1);
    const bars = (row: Element) => [...row.querySelectorAll("td")].map((td) => td.querySelector<HTMLElement>("[data-bar]"));
    // 2024: 1,014 wage requests of a top figure of 1,894, and no PERM application.
    const [wage2024, perm2024] = bars(rows[1]!);
    expect(wage2024!.style.width).toBe(`${(1014 / 1894) * 100}%`);
    expect(perm2024).toBeNull();
    // 2026: the top figure fills its track; 23 PERM applications draw on the same 1,894.
    const [wage2026, perm2026] = bars(rows[3]!);
    expect(wage2026!.style.width).toBe("100%");
    expect(perm2026!.style.width).toBe(`${(23 / 1894) * 100}%`);
  });

  it("says in the open that nurses and physical therapists skip the PERM application", () => {
    const avant = starts([y(2025, 1949, 0, 1949), y(2026, 3588, 0, 1468, 1468)], "2026-08-31", null);
    render(<StartYears starts={avant} />);
    const note = screen.getByText(/skip the PERM application/);
    expect(note.textContent).toContain("Most of these wage requests are for nurses or physical therapists.");
    expect(within(note).getByRole("link", { name: "Schedule A" }).getAttribute("href")).toBe("/glossary#schedule-a");
    // The dated line stops at the wage request: "no PERM application" beside a nurse employer would read as a pause.
    expect(document.body.textContent).toContain("Its newest wage request went in on August 31, 2026.");
    expect(document.body.textContent).not.toContain("It has filed no PERM application");
  });

  it("has no Schedule A note for an ordinary employer", () => {
    render(<StartYears starts={google} />);
    expect(screen.queryByText(/skip the PERM application/)).toBeNull();
  });

  it("names how many spellings the files were read under, in the fine print", () => {
    const { rerender } = render(<StartYears starts={google} spellings={7} />);
    expect(document.body.textContent).toContain("read under the 7 spellings DOL's files use for it");
    rerender(<StartYears starts={google} spellings={1} />);
    expect(document.body.textContent).not.toContain("spellings DOL's files use");
  });

  it("is absent with nothing read, and for a handful of filings", () => {
    const { container, rerender } = render(<StartYears starts={null} />);
    expect(container.innerHTML).toBe("");
    rerender(<StartYears starts={starts([y(2025, 3, 1)], "2025-03-01", "2025-09-01")} />);
    expect(container.innerHTML).toBe("");
  });
});

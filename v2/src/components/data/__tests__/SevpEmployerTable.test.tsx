import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AsPrinted, SevpEmployerTable } from "../SevpEmployerTable";

/** ICE's top-200 tables: a blank cell stays blank, names link a search, ICE's slips are named. */
describe("SevpEmployerTable", () => {
  const list = {
    year: 2024,
    list: "opt" as const,
    asPrinted: [],
    rows: [
      { rank: 1, employer: "Amazon", total: 10167, opt: 5379, stemOpt: 6679, cpt: null },
      { rank: 2, employer: "Bright Mind Enrichment and Schooling", total: 1234, opt: 1234, stemOpt: null, cpt: null },
    ],
  };

  it("prints ICE's counts, with a blank STEM OPT cell left blank", () => {
    const { container } = render(<SevpEmployerTable list={list} />);
    const cells = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim()));
    expect(cells[0]).toEqual(["1", "10,167", "5,379", "6,679"]);
    expect(cells[1]).toEqual(["2", "1,234", "1,234", ""]);
  });

  it("links each name to a search, not a claimed employer page", () => {
    const { container } = render(<SevpEmployerTable list={list} />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/perm-employers?q=Amazon");
  });

  it("names ICE's own ordering slips", () => {
    const { container } = render(<AsPrinted notes={["Apple, Inc (323) is listed below Populus Group (233)"]} />);
    expect(container.textContent).toContain("As ICE printed it: Apple, Inc (323) is listed below Populus Group (233).");
  });
});

/**
 * A whole list of 200, a page at a time. Drawn whole, eight of these lists were 1,604 table rows and 1.2 MB of
 * /opt-employers' 1.58 MB of HTML (Nov 23 2026); the page is held under 1.5 MB (scripts/audit_page_markup.py).
 */
describe("SevpEmployerTable, a page at a time", () => {
  const full = {
    year: 2024,
    list: "cpt" as const,
    asPrinted: [],
    rows: Array.from({ length: 200 }, (_, i) => ({
      rank: i + 1,
      employer: `Employer ${i + 1}`,
      total: 2000 - i,
      opt: null,
      stemOpt: null,
      cpt: 2000 - i,
    })),
  };
  const ranks = (root: HTMLElement) =>
    [...root.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent?.trim());

  it("draws the first 25 of 200 in the server's HTML, and a phone's first 10 alone until the browser starts", () => {
    // Act
    const html = renderToStaticMarkup(<SevpEmployerTable list={full} />);
    // Assert
    expect((html.match(/<tr\b/g) ?? []).length).toBe(1 + 25);
    expect(html).toContain("Employer 25<");
    expect(html).not.toContain("Employer 26<");
    // The rows a phone's page leaves out are hidden there before scripts run.
    expect((html.match(/<tr class="[^"]*max-sm:hidden/g) ?? []).length).toBe(15);
  });

  it("keeps every rank a pager away, with the place said and a rows-per-page choice", () => {
    // Arrange
    const { container } = render(<SevpEmployerTable list={full} />);
    const pages = screen.getByRole("navigation", { name: /Pages of ICE's top employers for CPT, 2024/ });
    expect(within(pages).getByText("1 to 25 of 200 employers")).toBeInTheDocument();
    // Act
    fireEvent.click(within(pages).getByRole("button", { name: "Next page" }));
    // Assert
    expect(ranks(container)[0]).toBe("26");
    expect(ranks(container)).toHaveLength(25);
    expect(within(pages).getByText("26 to 50 of 200 employers")).toBeInTheDocument();
    // Act: 100 a page
    fireEvent.click(within(pages).getByRole("button", { name: "100 rows per page" }));
    // Assert: a new size starts from the first page
    expect(ranks(container)[0]).toBe("1");
    expect(ranks(container)).toHaveLength(100);
  });

  it("draws every bar against the list's leader on every page", () => {
    const { container } = render(<SevpEmployerTable list={full} />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    const bar = container.querySelector<HTMLElement>("tbody tr span.bg-primary")!;
    // Rank 26 holds 1,975 against the leader's 2,000.
    expect(bar.style.width).toBe(`${(1975 / 2000) * 100}%`);
    expect(container.querySelector("[data-tip]")?.getAttribute("data-tip")).toContain("#26 of 200");
  });

  it("has no fold of the ranks past the first page", () => {
    const html = renderToStaticMarkup(<SevpEmployerTable list={full} />);
    expect(html).not.toMatch(/Ranks 26 to 200/);
  });
});

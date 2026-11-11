import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CALCULATOR_PAGES, DATA_MENU_FOOTER } from "@/lib/siteMap";

import CalculatorsPage from "../page";

/**
 * The Data menu and the Data hub said "All 25 calculators" while this page opened with "22 calculators about your
 * case, 4 explorers" (Nov 10 2026): its explorers list held a data page (H-1B salaries) the site map doesn't count
 * as a calculator. One count, the site map's, wherever a reader sees one.
 */
describe("the calculators page's count", () => {
  it("opens with the site map's number of calculators, split into the two kinds", () => {
    render(<CalculatorsPage />);
    const lede = screen.getByText(/calculators:/);
    const [total, mine, field] = (lede.textContent ?? "").match(/\d+/g)!.map(Number);
    expect(total).toBe(CALCULATOR_PAGES.length);
    expect(mine! + field!).toBe(total);
  });

  it("agrees with the Data menu's own line", () => {
    const menu = DATA_MENU_FOOTER.find((p) => p.href === "/calculators");
    expect(menu?.name).toBe(`All ${CALCULATOR_PAGES.length} calculators`);
  });

  it("labels a row that isn't a calculator as the data page it is", () => {
    render(<CalculatorsPage />);
    const row = screen.getByRole("link", { name: /H-1B salaries/ });
    expect(row.textContent).toContain("Data page");
  });
});

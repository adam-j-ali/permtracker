// @vitest-environment jsdom
/**
 * The by-day table comes a page sized for the screen: a month of days on a wide one and ten on a phone, with the
 * rows choice. It showed 31 rows at every width and offered no choice (2.2 phone screens of rows at 390px in the
 * control walk, Nov 13 2026).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/hooks/usePublicQuery", () => ({
  usePublicQuery: () => ({ data: undefined, failed: false, previous: undefined, retry: vi.fn() }),
}));
vi.mock("@/hooks/useUrlSearchParams", () => ({
  // 90 days, all inside the page's own window, so the rows come from the `programs` prop.
  useUrlSearchParams: () => new URLSearchParams("period=90"),
  useUrlPatch: () => vi.fn(),
}));

const { FilingsExplorer } = await import("../FilingsExplorer");

const screenIs = (narrow: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: narrow && q.includes("max-width"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
afterEach(() => vi.unstubAllGlobals());

const explorer = () => (
  <FilingsExplorer asOf="2026-11-01" windowFrom="2026-07-01" programs={{ perm: [], pwd: [], lca: [], seasonal: [] } as never} />
);
// The chart above it carries a table of its own for screen readers; this is the one with a row a day.
const byDay = () => screen.getByRole("table", { name: /filed each day, / });
const bodyRows = () => within(byDay()).getAllByRole("row").length - 1;

describe("the by-day table, a page at a time", () => {
  it("shows ten days on a phone", () => {
    // Arrange
    screenIs(true);
    // Act
    render(explorer());
    // Assert
    expect(bodyRows()).toBe(10);
  });

  it("shows a month of days on a wide screen", () => {
    screenIs(false);
    render(explorer());
    expect(bodyRows()).toBe(31);
  });

  it("offers the rows choice, and a pick starts from the first page", () => {
    // Arrange: a phone, on its second page of 90 days.
    screenIs(true);
    render(explorer());
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("11 to 20 of 90 days")).toBeInTheDocument();
    // Act
    fireEvent.click(screen.getByRole("button", { name: "31 rows per page" }));
    // Assert
    expect(bodyRows()).toBe(31);
    expect(screen.getByText("1 to 31 of 90 days")).toBeInTheDocument();
  });

  it("hides the rows a phone's page leaves out in the server's drawing, which is the wide one", () => {
    // The server can't know the screen: it draws 31 rows, and a phone must not paint the long page before the
    // browser starts.
    screenIs(false);
    render(explorer());
    const rows = within(byDay()).getAllByRole("row").slice(1);
    expect(rows[9]!.className).not.toContain("max-sm:hidden");
    expect(rows[10]!.className).toContain("max-sm:hidden");
  });
});

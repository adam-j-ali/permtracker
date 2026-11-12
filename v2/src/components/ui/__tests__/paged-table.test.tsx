import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PagedTable, pageRule } from "../paged-table";

const screenIs = (narrow: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: narrow && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
afterEach(() => vi.unstubAllGlobals());

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <tr key={i} className="row">
      <td>{`firm ${i + 26}`}</td>
    </tr>
  ));
const table = (n: number) => (
  <PagedTable
    label="Law firms ranked 26 to 100"
    caption={<caption>Law firms ranked 26 to 100</caption>}
    head={
      <thead>
        <tr>
          <th scope="col">Law firm</th>
        </tr>
      </thead>
    }
    rows={rows(n)}
    noun="law firms"
  />
);
/** The rule in force, with the body's generated id written as "B". */
const rule = (container: HTMLElement) =>
  (container.querySelector("style")?.textContent ?? "").replaceAll(`#${container.querySelector("tbody")!.id}`, "B");

describe("pageRule", () => {
  it("hides everything past the first page", () => {
    expect(pageRule("x", 0, 25, null)).toBe("#x > :nth-child(n+26) { display: none; }");
  });
  it("hides the rows before a later page and the rows after it", () => {
    expect(pageRule("x", 50, 25, null)).toBe("#x > :nth-child(-n+50), #x > :nth-child(n+76) { display: none; }");
  });
  it("adds a phone's shorter page to a first page drawn before the screen is known", () => {
    expect(pageRule("x", 0, 25, 10)).toBe(
      "#x > :nth-child(n+26) { display: none; } @media (max-width: 639px) { #x > :nth-child(n+11) { display: none; } }",
    );
    expect(pageRule("x", 0, 10, 10)).toBe("#x > :nth-child(n+11) { display: none; }");
  });
});

describe("PagedTable", () => {
  it("keeps every row in the page, whatever page is showing, so a link in a later row is still there", () => {
    screenIs(false);
    const { container } = render(table(75));
    expect(container.querySelectorAll("tbody > tr")).toHaveLength(75);
    expect(container.querySelector("tbody > tr")!.className).toBe("row");
  });

  it("shows 25 of 75 on a wide screen, with a phone's ten in a media rule until the screen is known", () => {
    screenIs(false);
    const { container } = render(table(75));
    expect(rule(container)).toBe("B > :nth-child(n+26) { display: none; } @media (max-width: 639px) { B > :nth-child(n+11) { display: none; } }");
    expect(screen.getByText("1 to 25 of 75 law firms")).toBeDefined();
  });

  it("shows ten on a phone, and the next ten on the next page", () => {
    screenIs(true);
    const { container } = render(table(75));
    expect(rule(container)).toBe("B > :nth-child(n+11) { display: none; }");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(rule(container)).toBe("B > :nth-child(-n+10), B > :nth-child(n+21) { display: none; }");
    expect(screen.getByText("11 to 20 of 75 law firms")).toBeDefined();
  });

  it("lets the reader ask for more rows, and starts from the first page then", () => {
    screenIs(true);
    const { container } = render(table(75));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "50 rows per page" }));
    expect(rule(container)).toBe("B > :nth-child(n+51) { display: none; }");
    expect(screen.getByText("1 to 50 of 75 law firms")).toBeDefined();
  });

  it("draws no pager for a table that fits one phone page", () => {
    screenIs(true);
    render(table(8));
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });
});

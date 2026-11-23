import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/data/EmptyState";
import { SplitColumns } from "@/components/data/SplitColumns";

/**
 * A public page's part with nothing in it says what will appear and offers the next step, in the house's box; a
 * wide page reads as two unequal columns, one column in reading order on a phone.
 */
describe("EmptyState", () => {
  it("says what will appear, why, and the one next step, in a box with the ink edge", () => {
    render(
      <EmptyState title="Nothing loaded yet" action={{ href: "/case-search", label: "Search the case files" }}>
        DOL&apos;s quarterly file hasn&apos;t been read in yet.
      </EmptyState>,
    );
    const title = screen.getByRole("heading", { level: 2, name: "Nothing loaded yet" });
    const box = title.closest("section")!;
    expect(box.className).toMatch(/\bborder-2\b/);
    expect(box.className).toMatch(/\bborder-border\b/);
    expect(box.className).toMatch(/\bshadow-hard-sm\b/);
    expect(box.className).toMatch(/\bbg-tint\b/);
    expect(box.textContent).toContain("quarterly file hasn't been read in yet");
    const link = screen.getByRole("link", { name: "Search the case files" });
    expect(link.getAttribute("href")).toBe("/case-search");
    // A link alone on its line is a 44px target.
    expect(link.className).toMatch(/\bmin-h-11\b/);
  });

  it("takes a lower heading where it sits inside a section, and no action when there's none", () => {
    render(
      <EmptyState title="No notices" heading="h3" action={null}>
        None on record.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "No notices" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps a space between its words when read as text", () => {
    const { container } = render(
      <EmptyState title="Nothing yet" action={{ href: "/x", label: "Look here" }}>
        It fills next week.
      </EmptyState>,
    );
    expect(container.textContent).toContain("Nothing yet It fills next week. Look here");
  });
});

describe("SplitColumns", () => {
  it("puts the main part first in the source, the aside after it", () => {
    const { container } = render(<SplitColumns aside={<p>Aside</p>}>{<p>Main</p>}</SplitColumns>);
    expect(container.textContent!.indexOf("Main")).toBeLessThan(container.textContent!.indexOf("Aside"));
  });

  it("puts the aside first in the source when it's read first, so a phone and a screen reader agree", () => {
    const { container } = render(
      <SplitColumns asideFirst aside={<nav aria-label="On this page">Contents</nav>}>
        {<p>Text</p>}
      </SplitColumns>,
    );
    expect(container.textContent!.indexOf("Contents")).toBeLessThan(container.textContent!.indexOf("Text"));
    // The side part brings its own meaning; the split adds no landmark of its own.
    expect(screen.getByRole("navigation", { name: "On this page" })).toBeTruthy();
    expect(container.querySelector("aside")).toBeNull();
    // On two columns the side part still sits on the right.
    expect(container.querySelector("[data-split-side]")!.className).toMatch(/@\[56rem\]:col-start-2/);
  });

  it("leaves no empty aside behind when there's nothing to put beside the main part", () => {
    const { container } = render(<SplitColumns aside={null}>{<p>Only</p>}</SplitColumns>);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.textContent).toBe("Only");
  });

  it("splits by its own width, one column with shrinkable tracks below it", () => {
    const { container } = render(<SplitColumns aside={<p>A</p>}>{<p>M</p>}</SplitColumns>);
    const grid = container.querySelector(".grid")!;
    expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid.className).toContain("[&>*]:min-w-0");
    expect(container.firstElementChild!.className).toMatch(/@container/);
  });
});

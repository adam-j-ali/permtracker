// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ContentSearch from "../ContentSearch";
import TableOfContents from "../TableOfContents";

/**
 * The article's contents list jumps to a heading and takes keyboard focus there, so the next Tab starts from the
 * section the reader chose, and it jumps without the glide when the system asks for less motion. The listing's
 * search box says what it is to a screen reader.
 */
let reduce = false;
beforeEach(() => {
  reduce = false;
  window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("reduce") && reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  window.scrollTo = vi.fn() as never;
});
afterEach(() => {
  document.body.innerHTML = "";
});

function article() {
  const div = document.createElement("div");
  div.className = "prose-article";
  div.innerHTML = '<h2 id="first">First</h2><p>x</p><h2 id="second">Second</h2><p>y</p>';
  document.body.appendChild(div);
}

describe("TableOfContents", () => {
  it("moves keyboard focus to the chosen heading", async () => {
    // Arrange
    article();
    render(<TableOfContents />);
    // Act
    fireEvent.click(await screen.findByRole("link", { name: "Second" }));
    // Assert
    expect(document.activeElement?.id).toBe("second");
  });

  it("jumps without the glide when the system asks for less motion", async () => {
    // Arrange
    reduce = true;
    article();
    render(<TableOfContents />);
    // Act
    fireEvent.click(await screen.findByRole("link", { name: "Second" }));
    // Assert
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});

describe("ContentSearch", () => {
  it("is a named search box", () => {
    // Arrange, Act
    render(<ContentSearch value="" onChange={vi.fn()} />);
    // Assert
    expect(screen.getByRole("searchbox", { name: "Search articles" })).toBeInTheDocument();
  });
});

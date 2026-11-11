// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { FilterFold } from "../filter-fold";

/**
 * The window as a wide screen or a phone, as `matchMedia("(min-width: 640px)")` answers it. Set by assignment and
 * put back the same way: the shared setup's `matchMedia` is itself a mock, and "restoring" a spy over it would
 * leave it answering nothing for whichever test runs next.
 */
const realMatchMedia = window.matchMedia;
function screenIs(wide: boolean) {
  window.matchMedia = ((query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}
const fold = (c: HTMLElement) => c.querySelector("details") as HTMLDetailsElement;

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("FilterFold", () => {
  it("is shut with nothing on, and its control says only its name", () => {
    screenIs(true);
    const { container } = render(<FilterFold><input aria-label="Year" /></FilterFold>);
    expect(fold(container).open).toBe(false);
    expect(fold(container).querySelector("summary")?.textContent?.trim()).toBe("More filters");
    // Shut or open, what's inside stays in the page, so a form still carries it.
    expect(container.querySelector('input[aria-label="Year"]')).not.toBeNull();
  });

  it("opens by itself on a wide screen when a filter inside is on, and says how many", () => {
    screenIs(true);
    const { container } = render(<FilterFold active={2}><span>inside</span></FilterFold>);
    expect(fold(container).open).toBe(true);
    expect(fold(container).querySelector("summary")?.textContent).toContain("2 on");
  });

  it("stays shut on a phone with a filter on, and still says how many", () => {
    screenIs(false);
    const { container } = render(<FilterFold active={2}><span>inside</span></FilterFold>);
    expect(fold(container).open).toBe(false);
    expect(fold(container).querySelector("summary")?.textContent).toContain("2 on");
  });

  it("shuts when the list is asked again, and not when only the count changes", () => {
    screenIs(true);
    const { container, rerender } = render(<FilterFold active={1} shutOn={0}><span>inside</span></FilterFold>);
    expect(fold(container).open).toBe(true);
    rerender(<FilterFold active={2} shutOn={0}><span>inside</span></FilterFold>);
    expect(fold(container).open).toBe(true);
    rerender(<FilterFold active={2} shutOn={1}><span>inside</span></FilterFold>);
    expect(fold(container).open).toBe(false);
  });

  it("reads a window that can't answer as a phone", () => {
    window.matchMedia = (() => undefined) as unknown as typeof window.matchMedia;
    const { container } = render(<FilterFold active={1}><span>inside</span></FilterFold>);
    expect(fold(container).open).toBe(false);
  });

  it("follows the person's own opening and shutting", () => {
    screenIs(false);
    const { container } = render(<FilterFold><span>inside</span></FilterFold>);
    const d = fold(container);
    d.open = true;
    fireEvent(d, new Event("toggle"));
    expect(fold(container).open).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FilterFold } from "../filter-fold";

/**
 * A list's other filters. On a wide screen they're open, as they were before Nov 11 2026: folding them there fixed
 * nothing (the page was long on a phone) and hid how the list gets used. On a phone they're one tap away. Which of
 * the two a screen gets is a style rule, so the server's page is right before any script runs.
 */
const control = () => screen.getByRole("button", { name: /More filters/ });
const region = (c: HTMLElement) => c.querySelector("[data-filter-fold]") as HTMLElement;

describe("FilterFold", () => {
  it("is open from 640px by a style rule, with no control to press", () => {
    const { container } = render(<FilterFold><input aria-label="Year" /></FilterFold>);
    expect(region(container).className.split(/\s+/)).toContain("sm:block");
    expect(control().className.split(/\s+/)).toContain("sm:hidden");
  });

  it("is shut on a phone until its control is pressed, and what's inside stays in the page", () => {
    const { container } = render(<FilterFold><input aria-label="Year" /></FilterFold>);
    expect(region(container).className.split(/\s+/)).toContain("hidden");
    expect(control().getAttribute("aria-expanded")).toBe("false");
    expect(control().getAttribute("aria-controls")).toBe(region(container).id);
    // Shut or open, the fields are in the page, so a form still carries them.
    expect(container.querySelector('input[aria-label="Year"]')).not.toBeNull();
    fireEvent.click(control());
    expect(region(container).className.split(/\s+/)).not.toContain("hidden");
    expect(control().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(control());
    expect(region(container).className.split(/\s+/)).toContain("hidden");
  });

  it("says only its name with nothing on, and how many are on when some are", () => {
    const { rerender } = render(<FilterFold><span>inside</span></FilterFold>);
    expect(control().textContent?.trim()).toBe("More filters");
    rerender(<FilterFold active={2}><span>inside</span></FilterFold>);
    expect(control().textContent).toContain("2 on");
  });

  it("shuts on a phone when the list is asked again, and not when only the count changes", () => {
    const { container, rerender } = render(<FilterFold active={1} shutOn={0}><span>inside</span></FilterFold>);
    fireEvent.click(control());
    expect(region(container).className.split(/\s+/)).not.toContain("hidden");
    rerender(<FilterFold active={2} shutOn={0}><span>inside</span></FilterFold>);
    expect(region(container).className.split(/\s+/)).not.toContain("hidden");
    rerender(<FilterFold active={2} shutOn={1}><span>inside</span></FilterFold>);
    expect(region(container).className.split(/\s+/)).toContain("hidden");
  });

  it("shows the filters to a phone with scripts off, where the control can't work", () => {
    const { container } = render(<FilterFold><span>inside</span></FilterFold>);
    expect(container.querySelector("noscript")).not.toBeNull();
  });
});

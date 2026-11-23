import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CaseStatusHead } from "../CaseStatusShell";

/**
 * The loading state and its fallback stay in the streamed HTML, so three real
 * <h1> tags gave crawlers the page's heading three times (Oct 1 2026). Only
 * the page's own copy is an <h1>; the loading copies look the same and keep a
 * level-1 heading role for screen readers.
 */
describe("CaseStatusHead", () => {
  it("renders the page's one <h1>", () => {
    const { container } = render(<CaseStatusHead typed="" />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("renders no <h1> while loading, still announced as a level-1 heading", () => {
    const { container } = render(<CaseStatusHead typed="G-100-26239-123456" loading />);
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "Check and track your PERM case status" })).toBeInTheDocument();
  });

  it("says what the page gives in a short lede, and lists the other programs under the box's hint", () => {
    // A six-line lede on a phone melted the first screen into grey (the Nov 23 2026 squint test).
    const { container } = render(<CaseStatusHead typed="" />);
    const lede = container.querySelector("header p")!;
    expect(lede.textContent).toBe(
      "Its status in plain English, its place in DOL's queue and an estimated decision date, with a free email the moment it changes. No account needed.",
    );
    expect(lede.textContent).not.toContain("LCA");
    const box = screen.getByRole("textbox");
    const hint = document.getElementById(box.getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toBe(
      "It's on your ETA-9089 receipt. A case number looks like G-100-26125-868956. Wage request, LCA, H-2A, H-2B and CW-1 numbers work too.",
    );
  });

  it("looks the same either way", () => {
    const page = render(<CaseStatusHead typed="" />).container.querySelector("h1")!.className;
    const loading = render(<CaseStatusHead typed="" loading />).container.querySelector('[role="heading"]')!.className;
    expect(loading).toBe(page);
  });
});

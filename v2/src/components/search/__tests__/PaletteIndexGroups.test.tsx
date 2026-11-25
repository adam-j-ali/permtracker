// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staticIndex } from "@/lib/search/siteIndex";

import { SearchPalette } from "../SearchPalette";

/**
 * Every group the search index files pages under is one the palette shows (Nov 25 2026). The field offices, the USCIS
 * form pages and the review stages were filed under groups the palette never rendered, so "hartford field office"
 * found no office and "i-485 processing time" no I-485 page, though the index held both.
 */
const noop = () => {};
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {}))));
afterEach(() => vi.unstubAllGlobals());

describe("the palette shows every page the index holds", () => {
  it.each([
    ["hartford field office", /^Hartford field office/],
    ["i-485 processing time", /^I-485 processing time$/],
    ["reconsideration appeals", /^PERM .*reconsideration/i],
  ])("finds %s", async (typed, name) => {
    const user = userEvent.setup();
    render(<SearchPalette open onOpenChange={noop} />);
    await user.type(screen.getByRole("combobox"), typed);
    expect(await screen.findByRole("option", { name })).toBeTruthy();
  });

  it("renders a heading for every group the index uses, once its pages match", () => {
    const pages = staticIndex();
    const used = [...new Set(pages.map((e) => e.group))];
    expect(used.length, "the index files pages under no group; the walk is blind").toBeGreaterThan(5);
    render(<SearchPalette open onOpenChange={noop} />);
    const input = screen.getByRole("combobox");
    for (const group of used) {
      // Typing a page's own name shows that page, under its group's heading.
      fireEvent.change(input, { target: { value: pages.find((e) => e.group === group)!.label } });
      const shown = [...document.querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent ?? "");
      expect(shown, group).toContain(group);
    }
  });
});

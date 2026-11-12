import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { DataRail, GROUP_ICONS } from "../DataRail";
import { GROUPS, SECTIONS } from "@/lib/siteMap";

const at = vi.hoisted(() => ({ path: "/perm-employers" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePathname: () => at.path,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The rail's group headings carry an icon and a page count, and the collapsed
 * rail is a strip of group squares that opens the rail at the group chosen
 * (Oct 7 2026). The desktop rail and the phone panel both render the groups,
 * so ids carry where they are.
 */
describe("the data rail", () => {
  it("gives every group an icon", () => {
    for (const g of GROUPS) expect(GROUP_ICONS[g], g).toBeTypeOf("object");
  });

  it("names each group with its page count, and draws its icon", () => {
    const { container } = render(<DataRail />);
    const rail = container.querySelector("#data-rail-desktop") as HTMLElement;
    for (const g of GROUPS) {
      const n = SECTIONS.filter((s) => s.group === g).length;
      const head = within(rail).getByRole("button", { name: `${g}, ${n} pages` });
      expect(head.querySelector("svg"), g).not.toBeNull();
    }
  });

  it("draws the phone panel's rows the first time it opens, never up front", () => {
    // The desktop rail carries every link in the HTML; the phone copy was ~45 KB of duplicates.
    const { container } = render(<DataRail />);
    const panel = container.querySelector("#data-rail-panel") as HTMLElement;
    const desktop = container.querySelector("#data-rail-desktop") as HTMLElement;
    expect(panel.querySelectorAll("a")).toHaveLength(0);
    expect(desktop.querySelectorAll("a").length).toBeGreaterThan(10);
    fireEvent.click(screen.getByRole("button", { name: "Open data sections" }));
    expect(panel.querySelectorAll("a").length).toBeGreaterThan(10);
    // Closed again, the rows stay drawn, so reopening is instant.
    fireEvent.click(screen.getByRole("button", { name: "Close data sections" }));
    expect(panel.querySelectorAll("a").length).toBeGreaterThan(10);
  });

  it("uses each id once, across the desktop rail and the phone panel", () => {
    const { container } = render(<DataRail />);
    fireEvent.click(screen.getByRole("button", { name: "Open data sections" }));
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("collapses to a strip of Overview and every group, the current one marked", () => {
    render(<DataRail />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse data sections" }));
    expect(screen.getByRole("link", { name: "Data" })).toBeTruthy();
    for (const g of GROUPS) {
      const name = g === "Employers and firms" ? `${g} (this page's group)` : g;
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Focus moved to the toggle that replaced the one clicked.
    expect(document.activeElement?.id).toBe("rail-expand");
  });

  it("opens the rail at the group chosen in the strip, with focus on its heading", () => {
    render(<DataRail />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse data sections" }));
    fireEvent.click(screen.getByRole("button", { name: "PERM" }));
    const head = document.getElementById("rail-head-perm") as HTMLElement;
    expect(head).not.toBeNull();
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(head);
  });
});

/**
 * Seen in captures on Nov 10 2026: two names in the rail were cut off at 1280 wide ("Green card timeline and pl…"),
 * "Check my case" was pinned beside the case box on the case page itself, and on a phone the rail's opener tab, a
 * 44px square fixed over the page, hid the first letters of each line that scrolled under it. The first fix let the
 * tab scroll away with the page, and the owner missed it at once (Nov 12 2026): it stays on the screen, and it's
 * narrow enough on a phone to sit in the page's margin.
 */
describe("the data rail, as a reader meets it", () => {
  afterEach(() => {
    at.path = "/perm-employers";
  });

  it("wraps a long page name instead of cutting it off", () => {
    at.path = "/perm-case-status";
    const { container } = render(<DataRail />);
    const rail = container.querySelector("#data-rail-desktop") as HTMLElement;
    const long = within(rail).getByRole("link", { name: "Green card timeline and planner" });
    const label = [...long.querySelectorAll("span")].find((s) => s.textContent === "Green card timeline and planner");
    expect(label).toBeDefined();
    expect(label?.className).not.toMatch(/\btruncate\b/);
  });

  it("pins the case lookup under the list, except on the page that is the lookup", () => {
    const elsewhere = render(<DataRail />);
    const rail = elsewhere.container.querySelector("#data-rail-desktop") as HTMLElement;
    expect(within(rail).getByRole("link", { name: /Check my case/ })).toBeTruthy();
    elsewhere.unmount();

    at.path = "/perm-case-status";
    const onLookup = render(<DataRail />);
    const railThere = onLookup.container.querySelector("#data-rail-desktop") as HTMLElement;
    expect(within(railThere).queryByRole("link", { name: /Check my case/ })).toBeNull();
    // The phone panel follows the same rule.
    fireEvent.click(screen.getByRole("button", { name: "Open data sections" }));
    const panel = onLookup.container.querySelector("#data-rail-panel") as HTMLElement;
    expect(within(panel).queryByRole("link", { name: /Check my case/ })).toBeNull();
  });

  it("keeps the phone tab on the screen, shut or open, under the header's measured height", () => {
    render(<DataRail />);
    const tab = screen.getByRole("button", { name: "Open data sections" });
    expect(tab.className.split(/\s+/)).toContain("fixed");
    expect(tab.className.split(/\s+/)).not.toContain("absolute");
    expect(tab.style.top).toContain("--site-header-h");
    fireEvent.click(tab);
    const open = screen.getByRole("button", { name: "Close data sections" });
    expect(open.className.split(/\s+/)).toContain("fixed");
    expect(open.style.top).toContain("--site-header-h");
  });

  it("draws the tab inside a phone page's margin, and still gives a thumb 44px", () => {
    render(<DataRail />);
    const classes = screen.getByRole("button", { name: "Open data sections" }).className.split(/\s+/);
    // 28px wide with a 2px shadow: a phone page's first letter is 32px from the edge (the shell's 16px, the page's 16px).
    expect(classes).toContain("w-7");
    expect(classes).toContain("h-11");
    // From 640px the margins are 48px, and the tab is the full square.
    expect(classes).toContain("sm:w-11");
    // The other 16px of the target is there to tap and draws nothing.
    expect(classes).toEqual(expect.arrayContaining(["after:absolute", "after:inset-y-0", "after:left-full", "after:w-4", "sm:after:hidden"]));
    expect(classes).not.toContain("size-11");
  });
});

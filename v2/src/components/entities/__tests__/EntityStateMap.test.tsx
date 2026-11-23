import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntityStateMap } from "../EntityStateMap";
import type { MapEra } from "@/lib/stateMap";

/**
 * The employer, firm and job pages' state map: hover or focus reads a state out, a tap, a click or Enter keeps it,
 * and the kept state's line leads on. States with nothing are plain paper and no control at all.
 */

const CURRENT: MapEra = {
  id: "current",
  label: "since FY2024",
  choice: "Since FY2024",
  total: 1076,
  states: [
    { state: "TX", n: 741, certified: 700, denied: 10, href: "/case-search?q=MERIT+LOGISTICS&state=TX", linkText: "Its 741 Texas filings in the case search" },
    { state: "OR", n: 300, certified: 280, denied: 4, href: "/case-search?q=MERIT+LOGISTICS&state=OR", linkText: "Its 300 Oregon filings in the case search" },
    { state: "NJ", n: 30, certified: 30, denied: 0, href: "/case-search?q=MERIT+LOGISTICS&state=NJ", linkText: "Its 30 New Jersey filings in the case search" },
    { state: "PR", n: 5, certified: 5, denied: 0 },
  ],
};

const HISTORY: MapEra = {
  id: "history",
  label: "in FY2008 to FY2023",
  choice: "FY2008 to FY2023",
  total: 90,
  states: [
    { state: "CA", n: 60, certified: 55, denied: 2 },
    { state: "TX", n: 30, certified: 30, denied: 0 },
  ],
};

const map = (props: Partial<Parameters<typeof EntityStateMap>[0]> = {}) =>
  render(<EntityStateMap eras={[CURRENT]} label="Filings by worksite state" {...props} />);


describe("EntityStateMap", () => {
  it("names the drawing, says how many states hold filings, and opens on the busiest one", () => {
    map();
    expect(screen.getByRole("group", { name: "Filings by worksite state, since FY2024" })).toBeInTheDocument();
    expect(screen.getByText("In 3 of 51 states and Puerto Rico")).toBeInTheDocument();
    expect(screen.getByText("Texas has the most: 741 of 1,076 filings since FY2024, or 69%.")).toBeInTheDocument();
  });

  it("makes a control of each state with filings, and leaves every state without as plain paper", () => {
    const { container } = map();
    // Texas and Oregon by their shapes; New Jersey and Puerto Rico by their tiles.
    const controls = screen.getAllByRole("button");
    expect(controls).toHaveLength(4);
    const wyoming = container.querySelector('path:not([data-state])[d^="M247.0 135.9"]');
    expect(wyoming?.getAttribute("aria-hidden")).toBe("true");
    expect(wyoming?.getAttribute("style")).toContain("fill: var(--card)");
    expect(wyoming?.getAttribute("role")).toBeNull();
    // A zero is a known zero: never the hatch that means "not known".
    expect(container.innerHTML).not.toMatch(/hatch/);
    const tx = container.querySelector('path[data-state="TX"]');
    expect(tx?.getAttribute("style")).toContain("var(--data-info) 100%");
  });

  it("reads a state out on hover and lets it go when the pointer leaves", () => {
    map();
    const or = screen.getByRole("button", { name: /^Oregon: 300 filings/ });
    fireEvent.mouseEnter(or);
    expect(screen.getByText("300 filings, 28% of 1,076 since FY2024")).toBeInTheDocument();
    expect(screen.getByText("280 certified, 4 denied")).toBeInTheDocument();
    // A preview carries no link: it would vanish as the pointer went for it.
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.mouseLeave(or);
    expect(screen.getByText(/Texas has the most/)).toBeInTheDocument();
  });

  it("keeps a clicked state, with its link into the case search, until it's clicked again", () => {
    map();
    const tx = screen.getByRole("button", { name: /^Texas/ });
    fireEvent.mouseEnter(tx);
    fireEvent.click(tx);
    fireEvent.mouseLeave(tx);
    expect(tx.getAttribute("aria-pressed")).toBe("true");
    const link = screen.getByRole("link", { name: "Its 741 Texas filings in the case search" });
    expect(link.getAttribute("href")).toBe("/case-search?q=MERIT+LOGISTICS&state=TX");
    fireEvent.click(tx);
    expect(tx.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is one tab stop, the arrow keys walk the states busiest first, Enter keeps one and Escape lets it go", () => {
    map();
    const stops = screen.getAllByRole("button").filter((b) => b.getAttribute("tabindex") === "0");
    expect(stops.map((b) => b.getAttribute("aria-label")?.split(":")[0])).toEqual(["Texas"]);
    const tx = screen.getByRole("button", { name: /^Texas/ });
    tx.focus();
    fireEvent.focus(tx);
    fireEvent.keyDown(tx, { key: "ArrowRight" });
    const or = screen.getByRole("button", { name: /^Oregon/ });
    expect(document.activeElement).toBe(or);
    fireEvent.keyDown(or, { key: "ArrowRight" });
    const nj = screen.getByRole("button", { name: /^New Jersey/ });
    expect(document.activeElement).toBe(nj);
    expect(nj.tagName).toBe("BUTTON");
    fireEvent.keyDown(nj, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(or);
    fireEvent.keyDown(or, { key: "Enter" });
    expect(or.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Its 300 Oregon filings in the case search" })).toBeInTheDocument();
    // The kept state is the tab stop now.
    expect(or.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(or, { key: "Escape" });
    expect(or.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(or, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Puerto Rico/ }));
  });

  it("gives the small states and the territories tiles, since their shapes are too small to tap", () => {
    map();
    const tiles = screen.getByRole("list", { name: "Small states and territories" });
    const names = within(tiles).getAllByRole("button").map((b) => b.textContent?.trim());
    expect(names).toEqual(["NJ 30", "PR 5"]);
    fireEvent.click(within(tiles).getByRole("button", { name: /^New Jersey/ }));
    expect(screen.getByRole("link", { name: "Its 30 New Jersey filings in the case search" })).toBeInTheDocument();
  });

  it("reads a state out with no link on a withheld employer's neutral page, which searches by no name", () => {
    const neutral: MapEra = { ...CURRENT, states: CURRENT.states.map(({ href: _h, linkText: _l, ...s }) => s) };
    map({ eras: [neutral] });
    const tx = screen.getByRole("button", { name: /^Texas/ });
    fireEvent.click(tx);
    expect(screen.getByText("741 filings, 69% of 1,076 since FY2024")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keys its four steps with the counts each holds, and the paper of a state with none", () => {
    map();
    const key = screen.getByRole("list", { name: "Key" });
    expect(within(key).getAllByRole("listitem").map((li) => li.textContent?.trim())).toEqual([
      "1 to 27",
      "28 to 82",
      "83 to 246",
      "247 to 741",
      "None",
      "In 3 of 51 states and Puerto Rico",
    ]);
  });

  it("switches between two spans of years, each with its own total", () => {
    map({ eras: [CURRENT, HISTORY] });
    const older = screen.getByRole("button", { name: "FY2008 to FY2023" });
    expect(older.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(older);
    expect(older.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Filings by worksite state, in FY2008 to FY2023" })).toBeInTheDocument();
    expect(screen.getByText("California has the most: 60 of 90 filings in FY2008 to FY2023, or 67%.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Oregon/ })).toBeNull();
  });

  it("outlines a law firm's office state, and says so in the key and the readout", () => {
    const { container } = map({ office: { state: "OR", label: "The firm's office state" }, noun: "cases" });
    expect(container.querySelector('path[stroke-dasharray]')).not.toBeNull();
    expect(within(screen.getByRole("list", { name: "Key" })).getByText("The firm's office state")).toBeInTheDocument();
    const or = screen.getByRole("button", { name: /^Oregon: 300 cases.*The firm's office state\.$/ });
    fireEvent.mouseEnter(or);
    const readout = screen.getByText("300 cases, 28% of 1,076 since FY2024").closest("div");
    expect(readout?.textContent).toContain("The firm's office state");
  });

  it("draws nothing without a state to draw", () => {
    const { container } = map({ eras: [{ ...CURRENT, states: [] }] });
    expect(container.innerHTML).toBe("");
  });
});

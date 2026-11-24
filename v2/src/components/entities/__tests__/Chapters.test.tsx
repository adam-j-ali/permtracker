import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChapterNav } from "../Chapters";

/**
 * The chapter bar marks the part on screen, and nothing above the first part. It once stayed lit on "Notes" at the
 * top of an employer page: the marker kept whatever an intersection observer last reported. It now reads where
 * each part sits whenever the page scrolls or resizes.
 */
const ITEMS = [
  { id: "now", label: "Right now" },
  { id: "where", label: "Where" },
  { id: "notes", label: "Notes" },
];

/** Each part's top on screen, in px, as the page would lay it out at one scroll position. */
let tops: Record<string, number> = {};
let pageBottom = false;

function layout(next: Record<string, number>, atBottom = false) {
  tops = next;
  pageBottom = atBottom;
}

function marked(): string | null {
  const on = screen.queryAllByRole("link").filter((a) => a.getAttribute("aria-current") === "location");
  expect(on.length).toBeLessThanOrEqual(1);
  return on[0]?.textContent ?? null;
}

function scroll() {
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  // The frame runs at once. It answers 0, the handle of a frame already run: a real frame runs after the call
  // returns its handle, so the bar's "a frame is waiting" flag is cleared by the frame, never left set.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("innerHeight", 1000);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = tops[this.id] ?? 0;
    return { top, bottom: top + 800, left: 0, right: 800, width: 800, height: 800, x: 0, y: top, toJSON: () => ({}) };
  });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => (pageBottom ? 1000 : 99_999) });
  for (const i of ITEMS) {
    const s = document.createElement("section");
    s.id = i.id;
    document.body.appendChild(s);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const i of ITEMS) document.getElementById(i.id)?.remove();
});

describe("ChapterNav", () => {
  it("marks nothing while the page is above the first part", () => {
    layout({ now: 1400, where: 3000, notes: 6000 });
    render(<ChapterNav items={ITEMS} />);
    scroll();
    expect(marked()).toBeNull();
  });

  it("marks the part whose top has passed the reading line, and only that one", () => {
    layout({ now: 1400, where: 3000, notes: 6000 });
    render(<ChapterNav items={ITEMS} />);
    layout({ now: -900, where: 200, notes: 3200 });
    scroll();
    expect(marked()).toBe("Where");
  });

  it("clears the marker when the reader scrolls back above the first part", () => {
    layout({ now: -4000, where: -2000, notes: 100 });
    render(<ChapterNav items={ITEMS} />);
    scroll();
    expect(marked()).toBe("Notes");
    // Straight back to the top, in one jump: no part is in view, so nothing stays lit.
    layout({ now: 1400, where: 3000, notes: 6000 });
    scroll();
    expect(marked()).toBeNull();
  });

  it("marks a short last part once the page can't scroll any further", () => {
    layout({ now: -3000, where: -200, notes: 700 }, true);
    render(<ChapterNav items={ITEMS} />);
    scroll();
    expect(marked()).toBe("Notes");
  });
});

describe("the chapter bar's ground", () => {
  // A box reaching past the bar to the measured edges widened the page whenever a measurement was a few pixels
  // off (a job page ran 7px past a 320px screen). The ground is paint: a border image's outset and a clip path,
  // which draw outside the box without making the page any wider.
  const css = readFileSync(join(__dirname, "..", "..", "..", "app", "globals.css"), "utf8");
  const rule = css.slice(css.indexOf(".chapter-ground::before {"), css.indexOf("}", css.indexOf(".chapter-ground::before {")));

  it("is drawn by the bar's own class, with no box stretched out to the edges", () => {
    render(<ChapterNav items={ITEMS} />);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(nav.className).toContain("chapter-ground");
    expect(nav.className).not.toMatch(/before:(left|right)-/);
  });

  it("reaches the measured edges as paint only", () => {
    expect(rule).toContain("inset: 0;");
    expect(rule).toMatch(/border-image:[^;]*fill 0 \/ 0 \/ 0 100vmax;/);
    expect(rule).toContain("clip-path: inset(0 calc(-1 * var(--bleed-r, 0px)) 0 calc(-1 * var(--bleed-l, 0px)));");
    expect(rule).not.toMatch(/(^|[^-])(left|right):/m);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * A section held below the fold, waiting to rise, prints in full: a print or "save as PDF" from the top of the page
 * had left blank gaps where the held sections were, since a paused animation's first frame (opacity 0) applies in
 * print too.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/tools/green-card-timeline" }));

const { AutoReveal } = await import("../auto-reveal");

const animations: { finish: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> }[] = [];
const realAnimate = Element.prototype.animate;
const realRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  animations.length = 0;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.animate = function () {
    const a = { pause: vi.fn(), play: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    animations.push(a);
    return a as never;
  } as never;
  // Every section sits below the first screen.
  Element.prototype.getBoundingClientRect = () => ({ top: 5000 }) as DOMRect;
});

afterEach(() => {
  Element.prototype.animate = realAnimate;
  Element.prototype.getBoundingClientRect = realRect;
});

describe("AutoReveal and print", () => {
  it("shows every held section before the page prints", () => {
    // Arrange
    render(
      <>
        <main>
          <section>The plan</section>
          <section>The costs</section>
        </main>
        <AutoReveal />
      </>,
    );
    expect(animations).toHaveLength(2);
    // Act
    window.dispatchEvent(new Event("beforeprint"));
    // Assert
    for (const a of animations) expect(a.finish).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { CaseWall } from "../CaseWall";
import type { Wall, WallSegment } from "@/lib/casePosition";

/** A wall of `n` months ending at the reader's: the first is DOL's front, the last is theirs. */
function wallOf(n: number): Wall {
  const segments: WallSegment[] = Array.from({ length: n }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    pending: 1000 + i * 100,
    share: 100 / n,
    isSubject: i === n - 1,
    isFront: i === 0,
  }));
  const last = segments[n - 1]!;
  return {
    segments,
    ahead: 5000,
    drawnAhead: 4000,
    sameMonth: last.pending,
    subject: { month: last.month, total: 6000, pending: last.pending, decided: 6000 - last.pending, decidedPct: 80 },
    frontMonth: segments[0]!.month,
    monthsBehindFront: n - 1,
    isPastFront: false,
  } as unknown as Wall;
}

const list = (c: HTMLElement) => c.querySelector("ul") as HTMLUListElement;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The bars of undecided cases, from DOL's front to the reader's month. The reader's own month is the last bar, so on
 * a phone it must be the one in view.
 */
describe("the wall in front of a case, on a phone", () => {
  it("is only as wide as its months need, so a short wall fits the screen with the reader's month in it", () => {
    // Two months at a fixed 560px each took 277px on a 326px phone box: the reader's own bar sat off the right
    // edge, with a sliver showing (seen Nov 12 2026). A column needs 56px.
    expect(list(render(<CaseWall wall={wallOf(2)} />).container).style.minWidth).toBe("112px");
    expect(list(render(<CaseWall wall={wallOf(5)} />).container).style.minWidth).toBe("280px");
  });

  it("keeps the old floor for a long wall, which still scrolls", () => {
    expect(list(render(<CaseWall wall={wallOf(10)} />).container).style.minWidth).toBe("560px");
    expect(list(render(<CaseWall wall={wallOf(14)} />).container).style.minWidth).toBe("560px");
  });

  it("opens a wall that does scroll at its right end, where the reader's month is", () => {
    // Arrange: jsdom lays nothing out, so give the scroll box a width to scroll.
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(560);

    // Act
    const { container } = render(<CaseWall wall={wallOf(12)} />);

    // Assert: the box that scrolls starts at its end.
    const box = container.querySelector(".chart-tips-scroll") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.scrollLeft).toBe(560);
  });
});

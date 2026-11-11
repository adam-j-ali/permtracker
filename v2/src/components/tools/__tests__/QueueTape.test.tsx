import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QueueTape } from "../QueueTape";

/**
 * The two flags, "DOL is here" and "You", were both positioned
 * `-top-7 left-1/2 -translate-x-1/2`. A flag is about 90px wide over a column
 * that can be 30px, so whenever the selected month sat near the frontier the
 * badges overlapped and neither was readable. Reported from a screenshot with
 * the two one month apart.
 */

const flags = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("span")).filter((s) =>
    /^(DOL is here|You)$/i.test((s.textContent ?? "").trim()),
  );
const flag = (c: HTMLElement, words: string) => flags(c).find((s) => (s.textContent ?? "").trim() === words);
const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);
/** The month labels in order, each with its classes. */
const labels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("[data-tip] > span.font-mono")).map((s) => ({
    text: (s.textContent ?? "").trim(),
    classes: classes(s),
  }));

describe("QueueTape flag placement", () => {
  it("stacks the two flags on different rows when they are close, at every width", () => {
    const { container } = render(
      <QueueTape frontierMonth="2025-10" selectedMonth="2025-11" />,
    );
    expect(classes(flag(container, "DOL is here"))).toContain("-top-7");
    // "You" is raised a full row, so the two cannot occupy the same band.
    expect(classes(flag(container, "You"))).toContain("-top-14");
    expect(classes(flag(container, "You"))).not.toContain("sm:-top-7");
  });

  it("leaves both on the same row from `sm` up when they are far apart", () => {
    const { container } = render(
      <QueueTape frontierMonth="2025-10" selectedMonth="2026-06" />,
    );
    expect(classes(flag(container, "DOL is here"))).toContain("-top-7");
    expect(classes(flag(container, "You"))).toContain("sm:-top-7");
  });

  it("reserves the taller headroom at every width only when they collide", () => {
    const near = render(<QueueTape frontierMonth="2025-10" selectedMonth="2025-11" />);
    const nearBox = near.container.querySelector(".pt-14");
    expect(nearBox).not.toBeNull();
    expect(classes(nearBox)).not.toContain("sm:pt-7");
    const far = render(<QueueTape frontierMonth="2025-10" selectedMonth="2026-06" />);
    expect(far.container.querySelector(".sm\\:pt-7")).not.toBeNull();
  });

  it("does not raise anything when no month is selected", () => {
    const { container } = render(<QueueTape frontierMonth="2025-10" />);
    expect(container.querySelector(".pt-14")).toBeNull();
    expect(container.querySelector(".pt-7")).not.toBeNull();
  });
});

/**
 * On a phone the strip was 560px wide in a box that scrolled sideways and
 * opened at its left end. A case filed ten months after DOL's front had its
 * "You" flag off the right edge, with nothing saying the strip scrolled, on the
 * first picture of the most-visited page (seen at 390 wide, Nov 10 2026).
 */
describe("QueueTape on a phone", () => {
  // The case page's call for a case filed ten months behind DOL's front: thirteen months.
  const casePage = () =>
    render(
      <QueueTape
        frontierMonth="2026-01"
        selectedMonth="2026-11"
        monthsBehind={1}
        monthsAhead={11}
        aheadLabel="77,057 cases ahead"
      />,
    );

  it("has no fixed width below `sm`, so every month and both flags fit the screen", () => {
    const { container } = casePage();
    const strip = container.querySelector(".grid");
    expect(classes(strip)).toContain("sm:min-w-[560px]");
    expect(classes(strip)).not.toContain("min-w-[560px]");
  });

  it("puts 'You' on its own row on a phone, tied to its month by a line", () => {
    const { container } = casePage();
    const you = flag(container, "You");
    expect(classes(you)).toEqual(expect.arrayContaining(["-top-14", "sm:-top-7"]));
    // The headroom follows it: two rows on a phone, one from `sm`.
    expect(classes(container.querySelector(".pt-14"))).toContain("sm:pt-7");
    const tie = you?.parentElement?.querySelector("span.w-px.h-7");
    expect(tie).not.toBeNull();
    expect(classes(tie)).toContain("sm:hidden");
  });

  it("keeps a flag at the strip's first columns inside the strip", () => {
    const { container } = casePage();
    expect(classes(flag(container, "DOL is here"))).toEqual(
      expect.arrayContaining(["max-sm:left-0", "max-sm:translate-x-0"]),
    );
    // In the middle of the strip it stays centred on its month.
    const mid = render(<QueueTape frontierMonth="2026-01" />);
    expect(classes(flag(mid.container, "DOL is here"))).not.toContain("max-sm:left-0");
  });

  it("labels DOL's month, the reader's month and every fourth month clear of them", () => {
    const { container } = casePage();
    const shown = (l: { classes: string[] }) => !l.classes.includes("sr-only") && !l.classes.includes("max-sm:sr-only");
    const all = labels(container);
    expect(all).toHaveLength(13);
    // Dec '25 (0), Jan '26 = DOL (1), ... Nov '26 = You (11), Dec '26 (12).
    expect(all.map((l, i) => (shown(l) ? i : -1)).filter((i) => i >= 0)).toEqual([1, 4, 8, 11]);
    // From `sm` up the old rule holds: every other month, and the two flagged ones.
    const wide = (l: { classes: string[] }) => !l.classes.includes("sr-only");
    expect(all.map((l, i) => (wide(l) ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 2, 4, 6, 8, 10, 11, 12]);
  });

  it("draws the cases-ahead label inside the strip on a phone only when the stretch can hold it", () => {
    // The words sit in a span of their own inside the stretch's box; the box is what hides.
    const stretchBox = (c: HTMLElement, words: string) =>
      Array.from(c.querySelectorAll("span.pointer-events-none")).find((s) => s.textContent === words);
    const wideGap = casePage();
    expect(stretchBox(wideGap.container, "77,057 cases ahead")).toBeDefined();
    expect(classes(stretchBox(wideGap.container, "77,057 cases ahead"))).not.toContain("max-sm:hidden");
    // Four months apart: three columns of a phone's strip can't hold the words.
    const narrowGap = render(
      <QueueTape frontierMonth="2026-01" selectedMonth="2026-05" monthsBehind={1} monthsAhead={5} aheadLabel="9,120 cases ahead" />,
    );
    expect(classes(stretchBox(narrowGap.container, "9,120 cases ahead"))).toContain("max-sm:hidden");
  });
});

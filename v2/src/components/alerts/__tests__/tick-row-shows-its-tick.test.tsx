/**
 * A ticked box looks ticked.
 *
 * Until Nov 13 2026 the alert forms' tick boxes drew nothing when ticked: the lime fill and the tick were two
 * utility classes, the class merge dropped the fill as a duplicate of the tick's image class, and the image class
 * (an escaped string in a constant) was never generated. In the browser a ticked box had a white ground and no
 * image, the same as an unticked one. The ticked look is now one named rule in globals.css.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OptInBox, TickRow } from "../AlertParts";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const RULE = /@utility tick-box \{([\s\S]*?)\n\}/;
/** The body of `@utility tick-box { ... }`, or "" when the rule is gone. */
const rule = RULE.exec(css)?.[1] ?? "";

describe("the tick box's ticked look", () => {
  it("is one rule that fills the box and draws a tick, only when it's ticked", () => {
    expect(rule).toContain("&:checked");
    expect(rule).toContain("background-color: var(--primary)");
    // The tick itself: a path, in ink, so the state never rests on colour alone.
    expect(rule).toMatch(/background-image: url\("data:image\/svg\+xml,[^"]*stroke='black'[^"]*"\)/);
  });

  it("is on every tick box the alert forms draw, with no utility class standing in for it", () => {
    // Arrange and act: a form's own row, and an opt-in.
    render(
      <>
        <TickRow id="a" checked onChange={() => {}}>
          Every case too
        </TickRow>
        <OptInBox id="b" kind="news" checked={false} onChange={() => {}} />
      </>,
    );
    // Assert
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.className.split(/\s+/)).toContain("tick-box");
      // The two classes that cancelled each other must not come back.
      expect(box.className).not.toMatch(/checked:bg-/);
    }
  });

  it("would catch the rule being removed", () => {
    // The probe: the stylesheet without the rule has nothing for the first test to read.
    expect(RULE.exec(css.replace(RULE, ""))).toBeNull();
  });
});

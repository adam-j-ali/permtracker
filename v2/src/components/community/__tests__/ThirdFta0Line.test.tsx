import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThirdFta0Line } from "../TimelineBoard";

/** After a third FTA0: both halves in words, a median only when one was computed, and nothing with nothing reported. */
describe("the third-FTA0 line", () => {
  it("names both halves with their medians", () => {
    render(<ThirdFta0Line r={{ reported: 12, withCard: 7, medianToCard: 41, waiting: 5, medianWaiting: 63 }} />);
    expect(
      screen.getByText(
        "Of the 12 timelines reporting a third FTA0 on the I-485, 7 have a green card, a median of 41 days after it. 5 are still waiting, a median of 63 days so far.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/not what will happen to a case/)).toBeTruthy();
  });

  it("gives counts without a median below the floor, and says when nobody has a card yet", () => {
    render(<ThirdFta0Line r={{ reported: 2, withCard: 0, medianToCard: null, waiting: 1, medianWaiting: null }} />);
    expect(
      screen.getByText("Of the 2 timelines reporting a third FTA0 on the I-485, none has a green card after it yet. 1 is still waiting."),
    ).toBeTruthy();
  });

  it("draws nothing when nobody reports one", () => {
    const { container } = render(<ThirdFta0Line r={{ reported: 0, withCard: 0, medianToCard: null, waiting: 0, medianWaiting: null }} />);
    expect(container.textContent).toBe("");
  });
});

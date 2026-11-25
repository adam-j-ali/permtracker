import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PremiumClock } from "../PremiumClock";

/** The premium I-140 clock: a receipt day and a classification give the day USCIS must act by (premiumActionDeadline). */

const fill = (value: string) => fireEvent.change(screen.getByLabelText("The day USCIS received it"), { target: { value } });

describe("the premium processing clock", () => {
  it("says nothing until a day is entered", () => {
    render(<PremiumClock />);
    expect(screen.queryByText(/by then USCIS approves/)).toBeNull();
  });

  it("names the day for most classifications: 15 business days, Thanksgiving skipped", () => {
    render(<PremiumClock />);
    fill("2026-11-23");
    expect(screen.getByText(/Tuesday, December 15, 2026/)).toBeTruthy();
    expect(screen.getByText(/refunds the premium fee/)).toBeTruthy();
  });

  it("counts 45 for EB-1C and national interest waivers", () => {
    render(<PremiumClock />);
    fill("2026-11-23");
    fireEvent.click(screen.getByRole("button", { name: /national interest waiver/ }));
    expect(screen.getByText(/Friday, January 29, 2027/)).toBeTruthy();
  });

  it("cites USCIS's page and says the count restarts after a request for evidence", () => {
    render(<PremiumClock />);
    expect(screen.getByText(/last reviewed November 10, 2026/)).toBeTruthy();
    expect(screen.getAllByText(/request for evidence/).length).toBeGreaterThan(0);
  });
});

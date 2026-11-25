// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UscisReceiptForm } from "../UscisReceiptForm";

/**
 * The receipt box. USCIS's Case Status API page bars a vendor from submitting a receipt number for anyone who isn't
 * its user without their express consent, so the box says whose number to enter, and the field reads that out.
 */
const CONSENT = "Enter only your own receipt number, or one its owner has asked you to check. By looking it up, you confirm that.";

describe("the USCIS receipt box", () => {
  for (const live of [true, false]) {
    it(`says whose receipt number to enter, tied to the field (${live ? "live" : "decode only"})`, () => {
      render(<UscisReceiptForm live={live} />);
      const line = screen.getByText(CONSENT);
      const field = screen.getByLabelText("Your USCIS receipt number");
      expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(line.id);
    });
  }
});

describe("the USCIS receipt box reads the number as it's typed (RT1, Nov 25 2026)", () => {
  const field = () => screen.getByLabelText("Your USCIS receipt number") as HTMLInputElement;
  const hint = () => document.getElementById(field().getAttribute("aria-describedby")!.split(" ")[0]!)!.textContent ?? "";

  it("names the office from three letters and counts what's left", () => {
    render(<UscisReceiptForm />);
    fireEvent.change(field(), { target: { value: "lin26" } });
    expect(hint()).toMatch(/Nebraska Service Center/);
    expect(hint()).toMatch(/fiscal year 2026/);
    expect(hint()).toMatch(/8 more digits/);
  });

  it("names the first character that can't belong, and offers the one-tap fix for a usual typo", () => {
    render(<UscisReceiptForm />);
    fireEvent.change(field(), { target: { value: "LIN26O4214850" } });
    expect(hint()).toMatch(/Character 6 should be a digit/);
    fireEvent.click(screen.getByRole("button", { name: "Use LIN2604214850" }));
    expect(field().value).toBe("LIN2604214850");
    expect(hint()).not.toMatch(/should be/);
  });

  it("tells an A-number apart from a receipt", () => {
    render(<UscisReceiptForm />);
    fireEvent.change(field(), { target: { value: "A123456789" } });
    expect(hint()).toMatch(/A-number/);
  });

  it("still routes a DOL number to the PERM page", () => {
    render(<UscisReceiptForm />);
    fireEvent.change(field(), { target: { value: "G-100-26125-868956" } });
    expect(hint()).toMatch(/Department of Labor number/);
  });
});

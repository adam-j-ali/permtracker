// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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

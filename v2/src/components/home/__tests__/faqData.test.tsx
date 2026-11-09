import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { HOME_FAQS } from "../faqData";

/**
 * Each homepage answer is written twice, plain for the structured data and rich for the page, so the two must say
 * the same thing: the page told readers the weekly summary comes on the same day each week while the structured data
 * said Mondays, in a week something changed.
 */
const words = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the homepage FAQ", () => {
  it("says on the page what its structured data says about the weekly summary", () => {
    // Arrange
    const item = HOME_FAQS.find((f) => /weekly case summary/.test(f.answer))!;
    // Act
    const { container } = render(<>{item.rich}</>);
    // Assert
    expect(item.answer).toMatch(/on Mondays in any week something changed/);
    expect(words(container.textContent ?? "")).toMatch(/A weekly case summary arrives on Mondays in any week something changed/);
  });
});

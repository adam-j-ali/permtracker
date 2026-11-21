import { describe, expect, it } from "vitest";

import { canonicalAddress } from "../canonicalAddress";

/**
 * The inbox an address reaches (convex/lib/canonicalAddress.ts): the one rule the email blocklist and a second
 * reminder recipient's refusal list and invitation count compare by.
 */
describe("the address as one inbox", () => {
  it("is lowercased, with a +tag dropped on every domain", () => {
    expect(canonicalAddress(" Para+News@Firm.Example ")).toBe("para@firm.example");
    expect(canonicalAddress("para+a+b@firm.example")).toBe("para@firm.example");
    expect(canonicalAddress("p.ara@firm.example")).toBe("p.ara@firm.example");
  });

  it("drops a Gmail address's dots and reads googlemail.com as gmail.com", () => {
    expect(canonicalAddress("Para.Legal+promo@googlemail.com")).toBe("paralegal@gmail.com");
    expect(canonicalAddress("p.a.r.a@gmail.com")).toBe("para@gmail.com");
  });

  it("keeps a local part that would be left empty", () => {
    expect(canonicalAddress("+tag@firm.example")).toBe("+tag@firm.example");
    expect(canonicalAddress(".@gmail.com")).toBe(".@gmail.com");
  });
});

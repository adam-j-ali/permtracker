import { describe, expect, it } from "vitest";

import { tidyCaseNumber } from "../tidyCaseNumber";

/**
 * What a pasted case number looks like before the shape rules judge it. A number copied out of a PDF, an email or a
 * chat arrives with typographic dashes, spaces where the dashes were, or the sentence's full stop. Each of these was
 * refused by the box's own rule before this tidy existed (the Nov 23 2026 check of the box against Postel's law).
 */

describe("tidyCaseNumber", () => {
  it.each([
    ["‐", "hyphen"],
    ["‑", "non-breaking hyphen"],
    ["‒", "figure dash"],
    ["–", "en dash"],
    ["—", "em dash"],
    ["―", "horizontal bar"],
    ["−", "minus sign"],
  ])("reads a %s (%s) as the plain dash", (dash) => {
    // Arrange
    const pasted = ["G", "100", "26125", "868956"].join(dash);

    // Act
    const tidied = tidyCaseNumber(pasted);

    // Assert
    expect(tidied).toBe("G-100-26125-868956");
  });

  it("turns spaces between the groups into dashes when the number has no dash at all", () => {
    expect(tidyCaseNumber("G 100 26125 868956")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("a 23043 00641")).toBe("A-23043-00641");
    expect(tidyCaseNumber("JO A 300 26271 264525")).toBe("JO-A-300-26271-264525");
    // A non-breaking space is a space.
    expect(tidyCaseNumber("P 100 26125 868956")).toBe("P-100-26125-868956");
  });

  it("drops a space beside a dash, as it always did", () => {
    expect(tidyCaseNumber("G-100- 26125-868956")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("G - 100 - 26125 - 868956")).toBe("G-100-26125-868956");
    // A line break in a copied paragraph lands after a dash.
    expect(tidyCaseNumber("G-100-26125-\n868956")).toBe("G-100-26125-868956");
  });

  it("keeps the old reading of a space inside a dashed number: it's removed, never made a dash", () => {
    // Before the tidy, "868 956" read as "868956". A number that already has its dashes keeps that reading, so no
    // input the box used to accept is refused now.
    expect(tidyCaseNumber("G-100-26125-868 956")).toBe("G-100-26125-868956");
  });

  it("strips the full stop, comma or closing bracket a sentence leaves on the end, and quotes around it", () => {
    expect(tidyCaseNumber("G-100-26125-868956.")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("G-100-26125-868956,")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("(G-100-26125-868956);")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("“G-100-26125-868956”")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("'A-23043-00641'.")).toBe("A-23043-00641");
  });

  it("puts the dashes into a letter followed by 14 digits", () => {
    expect(tidyCaseNumber("G10026125868956")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("p10026125868956")).toBe("P-100-26125-868956");
    expect(tidyCaseNumber("I20026055173457.")).toBe("I-200-26055-173457");
  });

  it("puts back the one dash a letter lost when the rest of the number has its dashes", () => {
    expect(tidyCaseNumber("G100-26125-868956")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("A23043-00641")).toBe("A-23043-00641");
  });

  it("drops the invisible characters a PDF copy carries", () => {
    expect(tidyCaseNumber("G-100-​26125-868956")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("﻿G-100-26125-868956")).toBe("G-100-26125-868956");
    expect(tidyCaseNumber("G-100-26125-8689­56")).toBe("G-100-26125-868956");
  });

  it("leaves a number that was already clean exactly as it was, upper-cased", () => {
    for (const n of ["G-100-26125-868956", "A-23043-00641", "JO-A-300-26271-264525", "I-07135-3458699", "C-500-26271-263466"]) {
      expect(tidyCaseNumber(n)).toBe(n);
      expect(tidyCaseNumber(n.toLowerCase())).toBe(n);
    }
  });

  it("leaves a paste far longer than any case number to the shape rules, untidied and quick", () => {
    // A `?case=` from a stranger can be any length: the length check comes before the patterns.
    const long = `${".".repeat(50_000)}x`;
    const started = performance.now();
    expect(tidyCaseNumber(long)).toBe(long.toUpperCase());
    expect(performance.now() - started).toBeLessThan(50);
    // A real number with its sentence's punctuation is well inside the limit.
    expect(tidyCaseNumber(`  “JO-A-300-26271-264525.”  `)).toBe("JO-A-300-26271-264525");
  });

  it("only tidies: what isn't a case number stays not a case number", () => {
    // The shape rules judge; the tidy must not manufacture a shape out of text.
    expect(tidyCaseNumber("")).toBe("");
    expect(tidyCaseNumber("   ")).toBe("");
    expect(tidyCaseNumber("Amazon Com Services")).toBe("AMAZON-COM-SERVICES");
    // A trailing dash is part of the number, not punctuation: "A-23043-00641-" stays refused by the shape rule.
    expect(tidyCaseNumber("A-23043-00641-")).toBe("A-23043-00641-");
    // Thirteen or fifteen digits are not a case number, so no dashes go in.
    expect(tidyCaseNumber("G1002612586895")).toBe("G1002612586895");
    expect(tidyCaseNumber("G100261258689561")).toBe("G100261258689561");
    // Two letters in front is not the one-letter form.
    expect(tidyCaseNumber("GG10026125868956")).toBe("GG10026125868956");
  });
});

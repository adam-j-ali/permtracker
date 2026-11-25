import { describe, expect, it } from "vitest";

import { dolCasePageHref, receiptPageHref, socWagePageHref } from "../publicLinks";

describe("a case's numbers and codes, linked where the public site has a page", () => {
  it("links a DOL number in DOL's spelling to its case page", () => {
    expect(dolCasePageHref(" g-100-25318-409609 ")).toBe("/perm-case-status?case=G-100-25318-409609");
    expect(dolCasePageHref("P-100-25210-123456")).toBe("/perm-case-status?case=P-100-25210-123456");
  });

  it("links a USCIS receipt to its lookup, and a job code to its wage levels", () => {
    expect(receiptPageHref("eac3590123456")).toBe("/uscis-case-status?receipt=EAC3590123456");
    expect(socWagePageHref("15-1252.00")).toMatch(/^\/tools\/wage-levels\?soc=15-1252/);
  });

  it("leaves an internal reference, a typo or nothing as plain text", () => {
    for (const bad of ["ACME-2026-14", "G-100-2531", "", null, undefined]) {
      expect(dolCasePageHref(bad)).toBeNull();
      expect(receiptPageHref(bad)).toBeNull();
      expect(socWagePageHref(bad)).toBeNull();
    }
  });
});

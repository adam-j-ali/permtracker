import { describe, expect, it } from "vitest";

import { caseHref, namedByLabel, wageRequestNumber } from "../caseLinks";

describe("wageRequestNumber", () => {
  it("keeps a wage request's number, upper-cased and trimmed", () => {
    expect(wageRequestNumber("P-100-24171-129387")).toBe("P-100-24171-129387");
    expect(wageRequestNumber(" p-200-25078-786174 ")).toBe("P-200-25078-786174");
  });

  it("refuses anything that isn't one: an empty cell, free text, another program's number", () => {
    for (const bad of [null, undefined, "", "N/A", "see attached", 12345, "G-100-26030-607031", "I-200-26030-123456", "P-100-24171"]) {
      expect(wageRequestNumber(bad)).toBeNull();
    }
  });
});

describe("the words and the address", () => {
  it("links any number to the case page, escaped", () => {
    expect(caseHref("P-100-24171-129387")).toBe("/perm-case-status?case=P-100-24171-129387");
    expect(caseHref("A B")).toBe("/perm-case-status?case=A%20B");
  });

  it("counts the PERM cases in words, one or many", () => {
    expect(namedByLabel(1)).toBe("Named on 1 decided PERM case");
    expect(namedByLabel(1234)).toBe("Named on 1,234 decided PERM cases");
  });
});

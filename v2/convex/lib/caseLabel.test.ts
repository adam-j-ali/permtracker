import { describe, expect, it } from "vitest";
import { caseInSentence, caseOneLine, caseSubtitle, caseTitle, duplicateKey } from "./caseLabel";

const full = { employerName: "Acme Corp", positionTitle: "Engineer", beneficiaryIdentifier: "J.D." };

describe("caseTitle", () => {
  it("names a case by its employer first", () => {
    expect(caseTitle(full)).toBe("Acme Corp");
  });

  it("falls back to the person, then the DOL number, then the words given", () => {
    expect(caseTitle({ employerName: "", beneficiaryIdentifier: "J.D." })).toBe("J.D.");
    expect(caseTitle({ employerName: " ", caseNumber: "G-100-26001-123456" })).toBe("G-100-26001-123456");
    expect(caseTitle({ employerName: "" })).toBe("Your case");
    expect(caseTitle({}, "")).toBe("");
  });

  it("reads null and missing parts as absent", () => {
    expect(caseTitle({ employerName: null, positionTitle: null })).toBe("Your case");
  });
});

describe("caseSubtitle", () => {
  it("carries the job and the person under an employer", () => {
    expect(caseSubtitle(full)).toBe("Engineer, J.D.");
  });

  it("never repeats what the title already says", () => {
    expect(caseSubtitle({ employerName: "", positionTitle: "Engineer", beneficiaryIdentifier: "J.D." })).toBe("Engineer");
    expect(caseSubtitle({ employerName: "", beneficiaryIdentifier: "J.D." })).toBe("");
  });

  it("is empty when there is nothing else to say", () => {
    expect(caseSubtitle({})).toBe("");
  });
});

describe("caseOneLine", () => {
  it("joins the title and the subtitle", () => {
    expect(caseOneLine(full)).toBe("Acme Corp, Engineer, J.D.");
    expect(caseOneLine({ positionTitle: "Engineer" })).toBe("Your case, Engineer");
    expect(caseOneLine({})).toBe("Your case");
  });
});

describe("caseInSentence", () => {
  it("names the person at the employer", () => {
    expect(caseInSentence(full, "your case")).toBe("J.D. at Acme Corp");
  });

  it("drops the half that's missing", () => {
    expect(caseInSentence({ beneficiaryIdentifier: "J.D." }, "your case")).toBe("J.D.");
    expect(caseInSentence({ employerName: "Acme Corp", positionTitle: "Engineer" }, "your case")).toBe("Engineer at Acme Corp");
    expect(caseInSentence({ employerName: "Acme Corp" }, "your case")).toBe("Acme Corp");
    expect(caseInSentence({ positionTitle: "Engineer" }, "your case")).toBe("Engineer");
    expect(caseInSentence({}, "your case")).toBe("your case");
  });
});

describe("duplicateKey", () => {
  it("keys a case by its employer and person", () => {
    expect(duplicateKey({ employerName: " Acme ", beneficiaryIdentifier: "J.D." })).toBe("acme|j.d.");
  });

  it("has no key without an employer: two unnamed cases aren't the same case", () => {
    expect(duplicateKey({ employerName: "", beneficiaryIdentifier: "" })).toBeNull();
    expect(duplicateKey({ employerName: "  " })).toBeNull();
  });
});

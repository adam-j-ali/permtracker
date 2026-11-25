import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isLegacyCaseNumber, normaliseCaseNumber } from "../caseNumberShape";
import { normaliseCaseNumber as narrowNormalise } from "../caseStatusVocabulary";
import {
  isLegacyCaseNumber as serverLegacy,
  normaliseCaseNumber as serverNarrow,
  normaliseLookupCaseNumber as serverLookup,
} from "../db/caseLookup";
import { normalisePwdCaseNumber } from "../db/pwdCases";
import { normaliseFlagCaseNumber, programOf } from "../flagCaseNumber";
import { parseCaseNumber } from "../permCaseNumber";

/**
 * Three modules carry a case-number rule for three audiences. This is what
 * stops them drifting into each other by accident.
 */

const SERVER_SRC = readFileSync(
  join(process.cwd(), "src/lib/db/caseLookup.ts"),
  "utf8",
);

/** Real numbers, both shapes, taken off the live tables. */
const CURRENT = [
  "G-100-26125-868956",
  "G-200-24267-358106",
  "G-300-25048-699608",
  "P-100-26021-574323",
  // An H-2A job order (Form ETA-790A) and a CW-1 application, both answered by
  // DOL's live service on Oct 3 2026.
  "JO-A-300-26271-264525",
  "C-500-26271-263466",
];
const LEGACY = [
  "A-23043-00641",
  "A-22256-20380",
  "A-22271-30061",
  "A-22185-82932",
];

describe("against the server's own copies", () => {
  it("uses the identical current-format pattern", () => {
    expect(SERVER_SRC).toContain("/^(?:[A-Z]|JO-A)-\\d{3}-\\d{5}-\\d+$/");
  });

  it("uses the identical legacy-format pattern", () => {
    expect(SERVER_SRC).toContain("/^[A-Z]-\\d{5}-\\d{5}$/");
  });

  it("and the server routes LOOKUP through the wide rule, not the narrow one", () => {
    // Widening the client without widening the server would show a friendly
    // form that then reports every legacy case as not found.
    expect(SERVER_SRC).toContain(
      "const caseNumber = normaliseLookupCaseNumber(input);",
    );
  });
});

describe("normaliseCaseNumber, the wide lookup rule", () => {
  it.each(CURRENT)("accepts the current format: %s", (n) => {
    expect(normaliseCaseNumber(n)).toBe(n);
  });

  it.each(LEGACY)("accepts the legacy format: %s", (n) => {
    expect(normaliseCaseNumber(n)).toBe(n);
  });

  it("upper-cases and strips whitespace that paste introduces", () => {
    expect(normaliseCaseNumber("  a-23043-00641 ")).toBe("A-23043-00641");
    expect(normaliseCaseNumber("G-100- 26125-868956")).toBe("G-100-26125-868956");
  });

  it.each([
    ["", "empty"],
    ["A-2304-00641", "legacy with a short first block"],
    ["A-23043-0064", "legacy with a short second block"],
    ["A-23043-00641-9", "legacy with a fourth segment"],
    ["A-230430-0641", "legacy with the split in the wrong place"],
    ["G-100-26125", "current with no serial"],
    ["1-100-26125-868956", "a digit where the letter goes"],
    ["A-23043-00641; DROP TABLE", "a string with SQL in it"],
    ["JO-B-300-26271-264525", "a two-letter code that is not the job order's"],
    ["JO-A-26271-264525", "a job order with no form digits"],
  ])("still refuses %s (%s)", (input) => {
    expect(normaliseCaseNumber(input)).toBeNull();
  });

  it("takes DOL's FY2008 LCA form, which the case page finds in the older files (Nov 25 2026)", () => {
    expect(normaliseCaseNumber("I-07135-3458699")).toBe("I-07135-3458699");
    expect(normaliseCaseNumber(" i–07135–3458699. ")).toBe("I-07135-3458699");
    expect(normaliseCaseNumber("I-07135-345869")).toBeNull();
    expect(normaliseCaseNumber("I-0713-3458699")).toBeNull();
    expect(normaliseCaseNumber("A-07135-3458699")).toBeNull();
    expect(isLegacyCaseNumber("I-07135-3458699")).toBe(false); // never date-decoded as a PERM legacy number
  });

  it("has not become permissive: the widening added exactly one shape", () => {
    // The probe the lead asked for. A five-and-five rule could easily have
    // been written loosely enough to swallow anything with two number blocks.
    expect(normaliseCaseNumber("A-23043-006415")).toBeNull();
    expect(normaliseCaseNumber("A-123456-00641")).toBeNull();
    expect(normaliseCaseNumber("AA-23043-00641")).toBeNull();
    expect(normaliseCaseNumber("A-23043-00641-")).toBeNull();
  });
});

describe("the narrow alert rule stays narrow", () => {
  it.each(CURRENT)("still accepts the current format: %s", (n) => {
    expect(narrowNormalise(n)).toBe(n);
  });

  it.each(LEGACY)("still refuses the legacy format: %s", (n) => {
    // Not an oversight. Every legacy case is decided and years old, so an
    // alert on one would promise mail that can never arrive. If this ever
    // starts passing, the alert path has been widened by accident.
    expect(narrowNormalise(n)).toBeNull();
  });
});

describe("isLegacyCaseNumber", () => {
  it.each(LEGACY)("recognises %s", (n) => {
    expect(isLegacyCaseNumber(n)).toBe(true);
  });

  it.each(CURRENT)("does not claim %s is legacy", (n) => {
    expect(isLegacyCaseNumber(n)).toBe(false);
  });
});

/**
 * A number pasted from a PDF, an email or a chat. Every module that judges a case number reads it through the one
 * tidy (`tidyCaseNumber`), so a number the lookup box accepts is one the server finds, the alert stores and the
 * program table claims, whichever dash or space it arrived with.
 */
const PASTED: readonly [string, string][] = [
  ["G–100–26125–868956", "G-100-26125-868956"],
  ["G‑100‑26125‑868956", "G-100-26125-868956"],
  ["G−100−26125−868956", "G-100-26125-868956"],
  ["G 100 26125 868956", "G-100-26125-868956"],
  ["G10026125868956", "G-100-26125-868956"],
  ["G-100-26125-868956.", "G-100-26125-868956"],
  ["(g-100-26125-868956),", "G-100-26125-868956"],
];

describe("a pasted number reads the same in every module", () => {
  it.each(PASTED)("the lookup box reads %s as %s", (pasted, clean) => {
    expect(normaliseCaseNumber(pasted)).toBe(clean);
  });

  it.each(PASTED)("the alert rule reads %s as %s", (pasted, clean) => {
    expect(narrowNormalise(pasted)).toBe(clean);
  });

  it.each(PASTED)("the server's lookup reads %s as %s", (pasted, clean) => {
    expect(serverLookup(pasted)).toBe(clean);
    expect(serverNarrow(pasted)).toBe(clean);
  });

  it("a legacy number pasted with an en dash is still legacy, in both copies of that rule", () => {
    expect(normaliseCaseNumber("A–23043–00641.")).toBe("A-23043-00641");
    expect(serverLookup("A 23043 00641")).toBe("A-23043-00641");
    expect(isLegacyCaseNumber("A–23043–00641")).toBe(true);
    expect(serverLegacy("A–23043–00641")).toBe(true);
  });

  it("a pasted wage request is claimed by its own program, never read as a PERM case", () => {
    // The PERM shape takes any leading letter, so a wage request that only the PERM rule could read would be looked
    // up in the PERM table and never found. Each program's rule reads the same tidy.
    const pasted = "P–100–26125–868956.";
    expect(normalisePwdCaseNumber(pasted)).toBe("P-100-26125-868956");
    expect(normaliseFlagCaseNumber(pasted)).toEqual({ caseNumber: "P-100-26125-868956", program: "pwd" });
    expect(programOf("P 100 26125 868956")).toBe("pwd");
  });

  it.each([
    "src/lib/caseNumberShape.ts",
    "src/lib/caseStatusVocabulary.ts",
    "src/lib/db/caseLookup.ts",
    "src/lib/flagCaseNumber.ts",
    "src/lib/db/flagCases.ts",
  ])("%s reads through the one tidy and keeps no copy of its own", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).toMatch(/import \{[^}]*\btidyCaseNumber\b[^}]*\} from "[^"]*tidyCaseNumber"/);
    // The old inline tidy, which knew no dash but the plain one.
    expect(src).not.toContain('.toUpperCase().replace(/\\s+/g, "")');
  });
});

describe("date decoding stays current-format only", () => {
  it.each(CURRENT)("decodes %s", (n) => {
    expect(parseCaseNumber(n)).not.toBeNull();
  });

  it.each(LEGACY)("refuses to decode %s", (n) => {
    // 13.4% exact against a 90.5% control. The parser must keep refusing,
    // because a plausible wrong filing month silently produces a wrong queue
    // position that the reader cannot see happen.
    expect(parseCaseNumber(n)).toBeNull();
  });

  it("stays looser than the parser on an impossible day-of-year", () => {
    expect(parseCaseNumber("G-100-26400-868956")).toBeNull();
    expect(normaliseCaseNumber("G-100-26400-868956")).toBe("G-100-26400-868956");
  });
});

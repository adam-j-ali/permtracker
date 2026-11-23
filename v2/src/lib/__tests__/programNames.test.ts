import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { programNamePattern, programNameRuns } from "../programNames";

const ROOT = process.cwd();
const names = (text: string) => [...text.matchAll(programNamePattern())].map((m) => m[0]);

describe("the program and form names that never split", () => {
  it("finds the visas, the preference categories and the forms a case moves through", () => {
    expect(names("H-1B, H-1B1, H-2A, H-2B, H-3, H-4 and CW-1")).toEqual(["H-1B", "H-1B1", "H-2A", "H-2B", "H-3", "H-4", "CW-1"]);
    expect(names("EB-1A, EB-1, EB-2, EB-3 and EB-5")).toEqual(["EB-1A", "EB-1", "EB-2", "EB-3", "EB-5"]);
    expect(names("I-140, I-485, I-765, I-131, I-129, I-797C, I-94, I-907, I-9 and I-129F")).toEqual([
      "I-140", "I-485", "I-765", "I-131", "I-129", "I-797C", "I-94", "I-907", "I-9", "I-129F",
    ]);
    expect(names("ETA-9089, ETA 9089, ETA-9141, ETA-9035 and ETA-9142B")).toEqual(["ETA-9089", "ETA 9089", "ETA-9141", "ETA-9035", "ETA-9142B"]);
    expect(names("DS-260, DS-160, DS-2019, N-400, G-28 and AR-11")).toEqual(["DS-260", "DS-160", "DS-2019", "N-400", "G-28", "AR-11"]);
    expect(names("F-1, J-1, L-1A, L-1, O-1, E-3 and TN")).toEqual(["F-1", "J-1", "L-1A", "L-1", "O-1", "E-3"]);
  });

  it("takes a plural with the name, and stops at a possessive or a following word", () => {
    expect(names("H-1Bs and I-140s")).toEqual(["H-1Bs", "I-140s"]);
    expect(names("the I-140's receipt")).toEqual(["I-140"]);
    expect(names("an H-1B-dependent employer, (I-485), EB-2/EB-3.")).toEqual(["H-1B", "I-485", "EB-2", "EB-3"]);
  });

  it("leaves DOL's case numbers whole: the start of one is never a form", () => {
    expect(names("G-100-24001-000002, I-200-23001-123456, H-300-24001-000001, P-100-12345-123456 and A-19001-00001")).toEqual([]);
  });

  it("leaves a lookalike inside a longer word or number alone", () => {
    expect(names("XH-1B, K-12 schools, F-15, COVID-19, W-2, H-1Bx")).toEqual([]);
  });

  it("splits text into runs that join back to the input exactly", () => {
    const text = "Case by case, in every program: PERM, wage requests, H-1B, H-2A, H-2B and CW-1.";
    const runs = programNameRuns(text);
    expect(runs.map((r) => r.text).join("")).toBe(text);
    expect(runs.filter((r) => r.name).map((r) => r.text)).toEqual(["H-1B", "H-2A", "H-2B", "CW-1"]);
    expect(programNameRuns("No names here.")).toEqual([{ text: "No names here.", name: false }]);
    expect(programNameRuns("")).toEqual([]);
    expect(programNameRuns("I-140")).toEqual([{ text: "I-140", name: true }]);
  });

  it("is the one way a name is kept whole: no page or article types the non-breaking hyphen", () => {
    // U+2011 isn't in the site's own fonts, so it drew from a system font, and find-in-page, copying and the
    // site's search saw a different character from the one a reader types.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const path = `${dir}/${name}`;
        if (name === "__tests__" || name === "node_modules") continue;
        if (statSync(join(ROOT, path)).isDirectory()) walk(path);
        else if (/\.(tsx?|mdx|json)$/.test(name) && readFileSync(join(ROOT, path), "utf8").includes("‑")) found.push(path);
      }
    };
    for (const dir of ["src", "content"]) walk(dir);
    expect(found).toEqual([]);
  });

  it("hands out a fresh pattern each time, so one caller's place in a string never carries into the next", () => {
    const a = programNamePattern();
    a.exec("H-1B and H-2B");
    expect(a.lastIndex).toBeGreaterThan(0);
    expect(programNamePattern().lastIndex).toBe(0);
  });
});

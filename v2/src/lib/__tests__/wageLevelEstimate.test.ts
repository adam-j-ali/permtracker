import { describe, expect, it } from "vitest";

import { estimateLevel, degreeOf, type Occupation, type Requirements } from "../wageLevelEstimate";

/**
 * DOL's own method for the four prevailing wage levels (Prevailing Wage Determination Policy Guidance, revised
 * November 2009, pp. 6-13, still the one NPWC applies), as the estimate follows it. Each case below is a rule from the
 * guidance; the experience bands are the Job Zone SVP halves DOL's FY2026 determinations follow.
 */
const SOFTWARE: Occupation = { soc: "15-1252", onetCode: "15-1252.00", title: "Software Developers", jobZone: 4, education: "bachelor", appendixA: true };
const COOK: Occupation = { soc: "35-2014", onetCode: "35-2014.00", title: "Cooks, Restaurant", jobZone: 2, education: "none", appendixA: false };
const INTERPRETER: Occupation = { soc: "27-3091", onetCode: "27-3091.00", title: "Interpreters and Translators", jobZone: 4, education: "bachelor", appendixA: true };
const IT_MANAGER: Occupation = { soc: "11-3021", onetCode: "11-3021.00", title: "Computer and Information Systems Managers", jobZone: 4, education: "bachelor", appendixA: true };

const req = (over: Partial<Requirements> = {}): Requirements => ({
  degree: "bachelor", experienceMonths: 0, foreignLanguage: false, license: false, otherSkills: false, supervises: false, travel: false, ...over,
});

describe("estimateLevel", () => {
  it("starts every job at Level I", () => {
    // Arrange, Act
    const e = estimateLevel(SOFTWARE, req());
    // Assert
    expect(e.level).toBe(1);
    expect(e.steps[0]).toMatchObject({ step: "start", points: 1 });
  });

  it("adds experience by the Job Zone's range: nothing at its start, 1 and 2 inside it, 3 above it", () => {
    // Job Zone 4 runs over 2 to 4 years: 24 months adds nothing, 36 is its low end, 48 its high end, past 48 above it.
    expect([24, 30, 36, 40, 48, 49, 120].map((m) => estimateLevel(SOFTWARE, req({ experienceMonths: m })).level)).toEqual([1, 2, 2, 3, 3, 4, 4]);
    // Job Zone 2 runs over 3 months to 1 year.
    expect([3, 6, 12, 13].map((m) => estimateLevel(COOK, req({ degree: "none", experienceMonths: m })).level)).toEqual([1, 2, 3, 4]);
  });

  it("adds 1 for one degree above the occupation's usual one and 2 for more, never for less", () => {
    expect(estimateLevel(SOFTWARE, req({ degree: "master" })).level).toBe(2);
    expect(estimateLevel(SOFTWARE, req({ degree: "doctorate" })).level).toBe(3);
    expect(estimateLevel(SOFTWARE, req({ degree: "associate" })).level).toBe(1);
    expect(estimateLevel(COOK, req({ degree: "high-school" })).level).toBe(2);
  });

  it("caps the sum at Level IV", () => {
    const e = estimateLevel(SOFTWARE, req({ degree: "doctorate", experienceMonths: 120, foreignLanguage: true, supervises: true, travel: true }));
    expect(e.level).toBe(4);
    expect(e.points).toBeGreaterThan(4);
  });

  it("counts a foreign language, except where the language is the job", () => {
    expect(estimateLevel(SOFTWARE, req({ foreignLanguage: true })).level).toBe(2);
    expect(estimateLevel(INTERPRETER, req({ foreignLanguage: true })).level).toBe(1);
  });

  it("never adds for a license on its own, and says other skills may add one", () => {
    const e = estimateLevel(SOFTWARE, req({ license: true, otherSkills: true }));
    expect(e.level).toBe(1);
    expect(e.mayBeHigher).toBe(true);
  });

  it("adds 1 for supervising, but not where supervising is the occupation's own work", () => {
    expect(estimateLevel(SOFTWARE, req({ supervises: true })).level).toBe(2);
    expect(estimateLevel(IT_MANAGER, req({ supervises: true })).level).toBe(1);
  });

  it("adds 1 for travel in Job Zones 3 and 4, where DOL's own decisions show it, and only flags it elsewhere", () => {
    expect(estimateLevel(SOFTWARE, req({ travel: true })).level).toBe(2);
    const cook = estimateLevel(COOK, req({ degree: "none", travel: true }));
    expect(cook.level).toBe(1);
    expect(cook.mayBeHigher).toBe(true);
  });

  it("levels the alternative requirements on their own, and the higher wage governs", () => {
    const e = estimateLevel(SOFTWARE, req({ degree: "master" }), { degree: "bachelor", experienceMonths: 60 });
    expect(e.level).toBe(2);
    expect(e.alternative?.level).toBe(4);
    expect(e.governing).toBe(4);
  });

  it("refuses nonsense experience rather than guessing", () => {
    expect(() => estimateLevel(SOFTWARE, req({ experienceMonths: -1 }))).toThrow();
    expect(() => estimateLevel(SOFTWARE, req({ experienceMonths: Number.NaN }))).toThrow();
  });
});

describe("degreeOf", () => {
  it("reads DOL's education labels, and gives null for one it doesn't know", () => {
    expect(degreeOf("Bachelor's degree")).toBe("bachelor");
    expect(degreeOf("High school diploma or equivalent")).toBe("high-school");
    expect(degreeOf("Doctoral or professional degree")).toBe("doctorate");
    expect(degreeOf("None")).toBe("none");
    expect(degreeOf("Postsecondary nondegree award")).toBe("high-school");
    expect(degreeOf("Something new")).toBeNull();
  });

  it("reads the requirement words in DOL's wage request file", () => {
    expect(degreeOf("Bachelor's")).toBe("bachelor");
    expect(degreeOf("Master's")).toBe("master");
    expect(degreeOf("Associate's")).toBe("associate");
    expect(degreeOf("High School/GED")).toBe("high-school");
    expect(degreeOf("Doctorate (PhD)")).toBe("doctorate");
    expect(degreeOf("Other degree (JD, MD, etc.)")).toBe("doctorate");
    expect(degreeOf(null)).toBeNull();
  });
});

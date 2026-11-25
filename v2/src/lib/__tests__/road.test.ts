import { describe, expect, it } from "vitest";

import { CONSULAR_STAGE, PLAN_STAGES } from "@/lib/perm";
import { JOURNEY_STEPS } from "@/lib/journey";
import { GROUPS } from "@/lib/siteMap";
import { STEP_GROUP_NAMES } from "@/lib/stepSources";
import { BESIDE_THE_ROAD, ROAD } from "@/lib/road";

/**
 * D2 (Nov 25 2026): the road to a green card is one ordered list (src/lib/road.ts), and the planner's stages, the
 * Data menu's step groups, the reported-case names and the journey guide's steps all follow it. Every name a reader
 * sees is pinned here exactly as it read before the road existed, so the move changed no word on any page.
 */
describe("the road", () => {
  it("runs from the wage request to the consulate, in order", () => {
    expect(ROAD.map((s) => s.id)).toEqual(["pwd", "recruitment", "perm", "i140", "visa", "i485", "consular"]);
  });

  it("covers the planner's stages in the planner's order, each once, the consulate as the other last step", () => {
    const inside = ROAD.filter((s) => s.where === "us").flatMap((s) => s.planner);
    expect(inside).toEqual(PLAN_STAGES.map((s) => s.key));
    expect(ROAD.filter((s) => s.where === "abroad").flatMap((s) => s.planner)).toEqual([CONSULAR_STAGE.key]);
  });

  it("orders the Data menu's step groups, between the reader's case and the rest", () => {
    expect(GROUPS).toEqual([
      "Your case",
      "Wage request",
      "Recruitment",
      "PERM",
      "I-140",
      "Green card line",
      "After the green card",
      "Employers and firms",
      "Breakdowns",
      "Wages",
      "Other visas",
      "Students and OPT",
    ]);
  });

  it("names each step's reported cases as the pages always have", () => {
    expect(STEP_GROUP_NAMES).toEqual({
      h1b: "The H-1B and its LCA",
      pwd: "The wage request",
      perm: "PERM",
      i140: "The I-140",
      i485: "The I-485",
      consular: "The consulate",
    });
    expect(BESIDE_THE_ROAD.planner).toEqual([]);
    expect(BESIDE_THE_ROAD.app).toBeNull();
  });

  it("walks the journey guide through the steps inside the US", () => {
    expect([...JOURNEY_STEPS]).toEqual(["pwd", "recruitment", "perm", "i140", "visa", "i485"]);
  });

  it("names the app's own stage for each step the app tracks, and no other", () => {
    expect(Object.fromEntries(ROAD.map((s) => [s.id, s.app]))).toEqual({
      pwd: "pwd",
      recruitment: "recruitment",
      perm: "eta9089",
      i140: "i140",
      visa: null,
      i485: null,
      consular: null,
    });
  });
});

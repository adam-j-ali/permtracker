import type { CaseStatus, PlanStage } from "@/lib/perm";
import type { StepGroup } from "@/lib/reportedSummary";
import type { DataGroup } from "@/lib/siteMap";

/**
 * The road to a green card through an employer, in order: one list, and everything that walks the steps follows it
 * (D2, Nov 25 2026). The planner's stages, the Data menu's step groups, the names of people's reported cases on each
 * step page (src/lib/stepSources.ts) and the journey guide's steps (src/lib/journey.ts) are read from here, so a step
 * can't be added, renamed or reordered in one place and missed in another. src/lib/__tests__/road.test.ts pins every
 * name a reader sees.
 */

export interface RoadStep {
  id: PlanStage;
  /** The Data menu's group that holds the step's pages. */
  menu: DataGroup;
  /** People's reported cases for the step, and the words a link to the agency's figures starts with, or null. */
  reported: { group: StepGroup; name: string } | null;
  /** The planner's stages that make up the step, in order (the I-140 is prepared, then filed). */
  planner: readonly PlanStage[];
  /** The app's own stage for a case on this step, or null where the app doesn't track the step yet. */
  app: CaseStatus | null;
  /** Where the step happens: the consulate is abroad, the other way to the same green card as the I-485. */
  where: "us" | "abroad";
}

export const ROAD = [
  { id: "pwd", menu: "Wage request", reported: { group: "pwd", name: "The wage request" }, planner: ["pwd"], app: "pwd", where: "us" },
  { id: "recruitment", menu: "Recruitment", reported: null, planner: ["recruitment"], app: "recruitment", where: "us" },
  { id: "perm", menu: "PERM", reported: { group: "perm", name: "PERM" }, planner: ["perm"], app: "eta9089", where: "us" },
  { id: "i140", menu: "I-140", reported: { group: "i140", name: "The I-140" }, planner: ["i140Prep", "i140"], app: "i140", where: "us" },
  { id: "visa", menu: "Green card line", reported: null, planner: ["visa"], app: null, where: "us" },
  { id: "i485", menu: "I-485", reported: { group: "i485", name: "The I-485" }, planner: ["i485"], app: "i485", where: "us" },
  { id: "consular", menu: "Consulate", reported: { group: "consular", name: "The consulate" }, planner: ["consular"], app: "consular", where: "abroad" },
] as const satisfies readonly RoadStep[];

export type RoadStepId = (typeof ROAD)[number]["id"];

/**
 * Where many people start: an H-1B and its LCA. People report its steps, so step pages name it, but it's no stage of
 * the planner or the app.
 */
export const BESIDE_THE_ROAD = {
  id: "h1b",
  reported: { group: "h1b", name: "The H-1B and its LCA" },
  planner: [],
  app: null,
} as const satisfies { id: string; reported: { group: StepGroup; name: string }; planner: readonly PlanStage[]; app: null };

/** The Data menu's step groups, in the road's order, each once. */
export const ROAD_MENU_GROUPS: readonly DataGroup[] = ROAD.reduce<DataGroup[]>(
  (out, s) => (out.includes(s.menu) ? out : [...out, s.menu]),
  [],
);

/** The steps that happen inside the US, in order: the I-485 path, the consulate left out. */
export type InsideStepId = Extract<(typeof ROAD)[number], { where: "us" }>["id"];
export const INSIDE_STEPS: readonly InsideStepId[] = ROAD.flatMap((s) => (s.where === "us" ? [s.id] : []));

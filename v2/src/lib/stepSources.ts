import { BESIDE_THE_ROAD, ROAD } from "@/lib/road";
import type { StepGroup } from "@/lib/reportedSummary";
import type { SourceKind } from "@/lib/sourceKind";

/**
 * Every public page about a green card step, and which steps it shows from both sources: the agency's own figure
 * and people's reported cases (src/components/community/StepBothSources.tsx). A page is listed with its steps, or
 * exempt with the reason. `src/app/__tests__/step-pages-show-both-sources.test.ts` fails when a page in the site
 * map's step groups is missing here, or when a listed page doesn't render the section, so a new step page can't
 * ship showing one source.
 */

/** Each step's name, the start of a link's words ("The wage request: our daily count"). From the road (src/lib/road.ts). */
export const STEP_GROUP_NAMES = Object.fromEntries(
  [BESIDE_THE_ROAD, ...ROAD].flatMap((s) => (s.reported ? [[s.reported.group, s.reported.name]] : [])),
) as Record<StepGroup, string>;

/**
 * A step figure's link words, saying whose figure it is: an agency's own ("the agency's figures") or our daily count of
 * its records (kind "measured": PERM, wage requests, LCAs). Until Nov 25 2026 every one said "the agency's".
 */
export function figuresLinkText(group: StepGroup, kind: SourceKind): string {
  return `${STEP_GROUP_NAMES[group]}: ${kind === "official" ? "the agency's figures" : "our daily count"}`;
}

/** The two-sources section's opening line, naming the kinds of figure it holds. */
export function sourcesLede(kinds: readonly SourceKind[], withReported: boolean): string {
  const official = kinds.includes("official");
  const ours = kinds.includes("measured");
  const whose = official && ours
    ? "The agency's figures and our own daily count of its records"
    : ours
      ? "Our own daily count of the agency's records"
      : "The agency's own count";
  return withReported
    ? `${whose}, beside how long the cases people reported to us took. Each names where it comes from and when it was true.`
    : `${whose} for each step, dated, beside the reported steps on this page.`;
}

export type StepPage = { groups: readonly StepGroup[]; reported: boolean } | { exempt: string };

/** `reported: false`: the page shows people's reported steps itself, so the section adds only the agency's figures. */
export const STEP_PAGES: Record<string, StepPage> = {
  // Wage request
  "/pwd-cases": { groups: ["pwd"], reported: true },
  "/tools/pwd-calculator": { groups: ["pwd"], reported: true },
  "/tools/wage-levels": { groups: ["pwd"], reported: true },
  "/tools/pwd-validity": { exempt: "a date rule: when a determination expires, not how long a step takes" },
  // Recruitment
  "/perm-recruitment": { groups: ["pwd", "perm"], reported: true },
  "/tools/perm-deadline-calculator": { exempt: "deadline arithmetic from the case's own dates" },
  "/perm-layoff-disclosures": { exempt: "layoffs reported on PERM forms, not a wait" },
  // PERM
  "/perm-cases": { groups: ["perm"], reported: true },
  "/perm-processing-times": { groups: ["i140", "i485", "consular"], reported: false },
  "/tools/perm-timeline-calculator": { groups: ["perm"], reported: true },
  "/perm-queue": { groups: ["perm"], reported: true },
  "/perm-updates": { groups: ["perm"], reported: true },
  "/perm-decision-activity": { groups: ["perm"], reported: true },
  "/filings-by-day": { groups: ["perm"], reported: true },
  "/perm-denial-risk": { exempt: "outcomes by employer and job, not how long a step takes" },
  "/perm-rfi-audit": { groups: ["perm"], reported: true },
  "/tools/rfi-deadline": { exempt: "a deadline from the date on DOL's letter" },
  // I-140
  "/uscis-processing-times": { groups: ["i140", "i485"], reported: true },
  "/tools/uscis-case-inquiry": { groups: ["i140", "i485"], reported: true },
  "/tools/i140-calculator": { groups: ["i140"], reported: true },
  "/tools/i140-trends": { groups: ["i140"], reported: true },
  "/i140-awaiting-visa": { groups: ["i140"], reported: true },
  "/uscis-rfe-rates": { groups: ["i140"], reported: true },
  "/tools/priority-date-retention": { exempt: "a rule about keeping a priority date, not a wait" },
  "/tools/cspa-age-calculator": { exempt: "a child's age under CSPA, from the case's own dates" },
  // The green card line
  "/visa-bulletin": { groups: ["i485", "consular"], reported: true },
  "/tools/priority-date-calculator": { exempt: "a date against the bulletin's cutoffs" },
  "/tools/green-card-line": { groups: ["i485"], reported: true },
  "/tools/eb2-vs-eb3": { groups: ["i485"], reported: true },
  "/i485-by-field-office": { groups: ["i485"], reported: true },
  "/uscis-account-reader": { exempt: "reads a USCIS account's update codes" },
  "/tools/i485-queue-position": { groups: ["i485"], reported: true },
  "/nvc-waiting-list": { groups: ["consular"], reported: true },
  "/visa-issuances": { groups: ["consular"], reported: true },
  "/consular-posts": { exempt: "shows State's figures and the reported consulate steps itself" },
  // H-1B
  "/lca-cases": { groups: ["h1b"], reported: true },
  "/h1b-lottery-odds": { groups: ["h1b"], reported: true },
  // Your case
  "/green-card-timelines": { groups: ["pwd", "perm", "i140", "i485", "consular"], reported: false },
  "/tools/green-card-timeline": { groups: ["pwd", "perm", "i140", "i485", "consular"], reported: true },
  "/perm-case-status": { exempt: "one case's own page; its case-level figures are its own section" },
};

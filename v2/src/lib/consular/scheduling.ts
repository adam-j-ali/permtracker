import { monthIndex } from "@convex/lib/months";

/**
 * Reading State's IV Scheduling Status Tool (scripts/ingest_iv_scheduling.py). Each cell is the
 * month of documentarily complete cases NVC is scheduling interviews for at a post. That's NVC's
 * paperwork queue: a post showing the update's own month has no backlog on paper, and it says
 * nothing about whether the post is holding interviews.
 */

/** State's IV Scheduling Status Tool. */
export const IV_TOOL_URL = "https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html";

export type IvCategory = "employment" | "family" | "immediate";
export const IV_CATEGORIES: readonly IvCategory[] = ["employment", "family", "immediate"];
export const IV_CATEGORY_LABEL: Record<IvCategory, string> = {
  employment: "Employment",
  family: "Family preference",
  immediate: "Immediate relative",
};

export interface IvCell {
  /** As State printed it ("Mar-2023", "N/A"). */
  printed: string;
  /** YYYY-MM, or null where State shows none. */
  month: string | null;
}

/** Whole months between the scheduled month and the month of State's update; 0 means caught up. */
export function monthsBehind(cell: IvCell | null | undefined, asOf: string): number | null {
  if (!cell?.month) return null;
  return Math.max(0, monthIndex(asOf.slice(0, 7)) - monthIndex(cell.month));
}

/** "Caught up", "14 months back", "Not shown": a cell in words. */
export function behindLabel(cell: IvCell | null | undefined, asOf: string): string {
  const n = monthsBehind(cell, asOf);
  if (n === null) return "Not shown";
  if (n === 0) return "Caught up";
  if (n < 24) return `${n} month${n === 1 ? "" : "s"} back`;
  const years = n / 12;
  return `${Number.isInteger(years) ? years : years.toFixed(1)} years back`;
}

/** A post's page address and name: one rule, shared with Convex (convex/lib/consularReport.ts). */
export { postName, postSlug } from "@convex/lib/consularReport";

/**
 * Shared Status Types - Single Source of Truth
 *
 * This file defines the canonical CaseStatus and ProgressStatus types.
 * All other files should import from here to ensure consistency.
 *
 * Used by:
 * - src/lib/perm/ (frontend re-exports)
 * - convex/lib/dashboardTypes.ts
 * - convex/schema.ts (indirectly - schema uses v.literal() strings)
 */

// Case lifecycle stages. After the I-140 the case takes one of two paths to the green card: "i485" (adjustment of
// status in the US) or "consular" (an immigrant visa abroad). "complete" means the green card arrived
// (lib/perm/greenCard.ts); "closed" is a case that ended without one.
export type CaseStatus =
  | "pwd"
  | "recruitment"
  | "eta9089"
  | "i140"
  | "i485"
  | "consular"
  | "complete"
  | "closed";

// Progress within a stage
export type ProgressStatus =
  | "working"
  | "waiting_intake"
  | "filed"
  | "approved"
  | "under_review"
  | "rfi_rfe";

// Runtime arrays for iteration and validation
export const CASE_STATUSES = [
  "pwd",
  "recruitment",
  "eta9089",
  "i140",
  "i485",
  "consular",
  "complete",
  "closed",
] as const satisfies readonly CaseStatus[];

export const PROGRESS_STATUSES = [
  "working",
  "waiting_intake",
  "filed",
  "approved",
  "under_review",
  "rfi_rfe",
] as const satisfies readonly ProgressStatus[];

/** Each stage's place in the case's life, 1 for the PWD: sorts a list of cases by how far along they are. */
export const CASE_STATUS_ORDER = Object.fromEntries(CASE_STATUSES.map((s, i) => [s, i + 1])) as Record<CaseStatus, number>;

// Type guards for runtime validation
export function isCaseStatus(value: unknown): value is CaseStatus {
  return (
    typeof value === "string" &&
    (CASE_STATUSES as readonly string[]).includes(value)
  );
}

export function isProgressStatus(value: unknown): value is ProgressStatus {
  return (
    typeof value === "string" &&
    (PROGRESS_STATUSES as readonly string[]).includes(value)
  );
}

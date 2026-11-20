/**
 * A deleted case's copy in the change log, and how long it can be restored.
 *
 * Deleting a case erases its row (cases.remove, cases.bulkRemove, an import that replaces it), and `logDelete` first
 * writes every field of it into that deletion's `auditLogs` row. For DELETED_CASE_DAYS its owner can restore it from
 * Settings (caseRestore.listRecentlyDeleted and restoreDeleted). Then the retention run erases the copy and the rest
 * of the case's change history, and keeps the deletion's own row: who deleted which case, and when
 * (retention.eraseDeletedCaseCopies). Its uploaded files and its recruitment log are erased when it's deleted, and
 * the change log never keeps the employer's FEIN, so none of those come back.
 */
import type { Doc } from "../_generated/dataModel";
import { MS_PER_DAY } from "./time";

/** Days a deleted case can be restored, and then its copy is erased. The Privacy Policy says the same number. */
export const DELETED_CASE_DAYS = 30;

/** The last moment a deletion made at `deletedAt` can be restored. */
export function restoreBy(deletedAt: number): number {
  return deletedAt + DELETED_CASE_DAYS * MS_PER_DAY;
}

/**
 * The deleted case's fields, from its deletion row. Each value was written with JSON.stringify; a field the change
 * log redacts (the employer's FEIN) holds a marker that isn't JSON, and is left out.
 */
export function readDeletedCopy(row: Pick<Doc<"auditLogs">, "changes">): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const change of row.changes ?? []) {
    if (change.oldValue === undefined) continue;
    try {
      copy[change.field] = JSON.parse(change.oldValue);
    } catch {
      // A redacted field: there's nothing to restore.
    }
  }
  return copy;
}

/** What a person recognises a deleted case by: the employer, the job and the beneficiary, when it has one. */
export function deletedCaseLabel(copy: Record<string, unknown>): {
  employerName: string;
  positionTitle: string;
  beneficiaryIdentifier: string | null;
} {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    employerName: text(copy.employerName),
    positionTitle: text(copy.positionTitle),
    beneficiaryIdentifier: text(copy.beneficiaryIdentifier) || null,
  };
}

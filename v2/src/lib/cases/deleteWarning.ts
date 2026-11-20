import { DELETED_CASE_DAYS } from "@convex/lib/deletedCases";

/** Where deleted cases can be brought back from, and for how long (convex/caseRestore.ts). */
export function caseRestoreLine(count = 1): string {
  return `You can restore ${count === 1 ? "it" : "them"} for ${DELETED_CASE_DAYS} days from Recently deleted in Settings, under Support.`;
}

/**
 * What deleting cases does, said the same way in every dialog that offers it and in the chat's confirmation: the
 * case can be restored from Settings for DELETED_CASE_DAYS, and its documents and recruitment log are erased at once.
 */
export function caseDeleteWarning(count = 1): string {
  const erased =
    count === 1 ? "Its documents and recruitment log are" : "Their documents and recruitment logs are";
  return `${caseRestoreLine(count)} ${erased} erased now and can’t be restored.`;
}

/** The warning for one case. */
export const CASE_DELETE_WARNING = caseDeleteWarning(1);

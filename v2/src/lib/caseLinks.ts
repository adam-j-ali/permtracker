/**
 * The links DOL's published files draw between filings, as a list row can carry them: a decided
 * PERM case names its wage request, a few H-1B LCAs cite one, and a wage request is named by the
 * decided PERM cases filed on it. Plain module: the readers attach these and the rows print them.
 *
 * A pending PERM case names nothing in DOL's live record. Its likely wage requests are worked
 * out on its own page (src/lib/employerWageRequests.ts), never in a list.
 */
import { normaliseCaseNumber } from "@/lib/caseNumberShape";

/** A wage request's number as a file printed it, or null when the cell holds anything else. */
export function wageRequestNumber(raw: unknown): string | null {
  const n = typeof raw === "string" ? normaliseCaseNumber(raw) : null;
  return n && n.startsWith("P-") ? n : null;
}

/** The page for any DOL case number. */
export function caseHref(caseNumber: string): string {
  return `/perm-case-status?case=${encodeURIComponent(caseNumber)}`;
}

/** "Named on 2 decided PERM cases". */
export function namedByLabel(n: number): string {
  return `Named on ${n.toLocaleString("en-US")} decided PERM ${n === 1 ? "case" : "cases"}`;
}

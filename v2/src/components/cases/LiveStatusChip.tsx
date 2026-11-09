/**
 * A compact chip for DOL's live status on a saved case: a tone dot and the
 * status word. Used on the case card for an at-a-glance read across the list.
 *
 * Never colour alone: the status word is always present, and the dot is a
 * secondary cue. The dot wears the site's one status code (`caseStatusTint`):
 * certified green, denied red, filed or waiting yellow, withdrawn purple.
 *
 * @module
 */

import { canonicalStatus } from "@/lib/caseStatusVocabulary";
import { CASE_STATUS_FILL, caseStatusTint } from "@/lib/statusTone";

export function LiveStatusChip({ status, className = "" }: { status: string; className?: string }) {
  const label = canonicalStatus(status);
  const tint = caseStatusTint(label);
  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-border px-2 py-0.5 text-xs font-medium ${className}`}
      title={`DOL's live status: ${label}`}
    >
      <span
        data-testid="live-status-dot"
        data-tint={tint}
        className={`inline-block size-2.5 shrink-0 border border-foreground ${CASE_STATUS_FILL[tint]}`}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">DOL:</span>{" "}
      <span className="font-semibold">{label}</span>
    </span>
  );
}

import { CheckIcon } from "@phosphor-icons/react/ssr";

import { STAGE_VISUALS } from "@/components/status/stage-visuals";
import { formatCaseStatus } from "@convex/lib/notificationHelpers";
import type { CaseStatus, GreenCardPath } from "@/lib/perm";
import { cn } from "@/lib/utils";
import { getStageIndex } from "./next-up-section.utils";

/**
 * Where the case is on its way to the green card, as six steps: the four PERM stages, the I-485 or the consulate
 * (whichever path the case is on), and the card. The done ones ticked, the current one filled in its own colour, the
 * rest still grey. Three to a row on a phone, so each name fits.
 */
export function StageProgress({ caseStatus, path }: { caseStatus: CaseStatus; path?: GreenCardPath }) {
  const stages = ["pwd", "recruitment", "eta9089", "i140", path === "consular" ? "consular" : "i485", "complete"] as const;
  const at = Math.min(Math.max(getStageIndex(caseStatus), 0), stages.length - 1);
  return (
    <ol aria-label="Case progress" className="grid grid-cols-3 border-2 border-[var(--object-border)] sm:grid-cols-6">
      {stages.map((st, i) => (
        <li
          key={st}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex min-h-11 min-w-0 items-center justify-center gap-1 border-[var(--object-border)] px-1 text-center text-sm font-semibold sm:gap-1.5 sm:px-2",
            // Lines between the cells: on a phone three to a row, with a rule above the second row.
            "max-sm:[&:not(:nth-child(3n+1))]:border-l-2 max-sm:[&:nth-child(n+4)]:border-t-2 sm:border-l-2 sm:first:border-l-0",
            i === at
              ? cn(STAGE_VISUALS[st].fill, STAGE_VISUALS[st].onFill)
              : i < at
                ? "bg-card text-foreground"
                : "bg-muted text-muted-foreground",
          )}
        >
          {i < at ? <CheckIcon weight="bold" aria-hidden="true" className="size-4 shrink-0 text-primary-text" /> : null}
          <span className="sr-only">{i < at ? "Done: " : i === at ? "Now: " : "Next: "}</span>{" "}
          <span>{formatCaseStatus(st)}</span>
        </li>
      ))}
    </ol>
  );
}

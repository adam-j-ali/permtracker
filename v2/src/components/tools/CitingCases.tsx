import Link from "next/link";

import { prettyStatus } from "@/components/queue/stages";
import { caseHref } from "@/lib/caseLinks";
import type { CaseCitingPwd } from "@/lib/db/caseLinks";
import { formatDay } from "@/lib/dolFormat";

/**
 * The LCAs and seasonal job orders that cite a wage request, each linked to its own case page. Drawn beside the
 * decided PERM cases that name it, in the same box; nothing when nothing cites it.
 */
export function CitingCases({ citing }: { citing: readonly CaseCitingPwd[] }) {
  if (citing.length === 0) return null;
  return (
    <div className="mt-6 max-w-3xl border-l-4 border-primary bg-tint px-4 py-3">
      <p className="font-semibold">
        {citing.length === 1 ? "A filing cites this wage request" : "Filings that cite this wage request"}
      </p>{" "}
      <ul className="mt-1 space-y-1">
        {citing.map((c) => {
          const kind = c.kind === "lca" ? "LCA" : "job order";
          const what = c.program ? `${c.program} ${kind}` : kind.charAt(0).toUpperCase() + kind.slice(1);
          const words = [what, c.employerName, c.status ? prettyStatus(c.status.toUpperCase()) : null, c.day ? formatDay(c.day) : null]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={c.caseNumber}>
              <Link href={caseHref(c.caseNumber)} className="link inline-flex min-h-11 items-center font-mono">
                {c.caseNumber}
              </Link>{" "}
              <span className="text-soft">{words}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import Link from "next/link";

import { Figure, FigureRow } from "@/components/data/FigureRow";
import { formatAsOf } from "@/lib/dolFormat";
import { formatInt } from "@/lib/format";
import { newestCompleteMonths, type SampleMonthsDoc } from "@/lib/uscisSample";
import { MONTH_NAMES } from "@convex/lib/months";
import { keepWhole } from "@/components/ui/keep-whole";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const monthWords = (m: string) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

/**
 * One form's share approved in our USCIS sample, for the newest months that have ended, each with its 95% margin and
 * the cases checked (Batch 8): the small figure the form and center pages carry beside USCIS's own counts. Online
 * (IOE) filings only, which the note under the figures says wherever they show. A month with few cases shows like any
 * other, its margin wide and its count beside it. Nothing renders for a form the sample doesn't hold; the page decides
 * whether the section around it shows with `newestCompleteMonths`.
 */
export function SampleMonthFigures({ doc, form, note }: { doc: SampleMonthsDoc; form: string; note?: string }) {
  const months = newestCompleteMonths(doc, form);
  if (months.length === 0) return null;
  return (
    <div>
      <FigureRow>
        {months.map((m) => (
          <Figure
            key={m.month}
            kind="measured"
            label={`Filed in ${monthWords(m.month)}`}
            value={pct(m.approved.share)}
            note={`Approved so far. Margin ${pct(m.approved.low)} to ${pct(m.approved.high)}, from ${formatInt(m.counted)} ${m.counted === 1 ? "case" : "cases"} checked.`}
          />
        ))}
      </FigureRow>{" "}
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-soft">
        {keepWhole(
          `Online (IOE) ${form}s only: paper filings aren't in the sample. ${note ? `${note} ` : ""}From the receipt numbers we check on USCIS's Case Status page, each counted at its newest status, as of ${formatAsOf(doc.as_of)}. A month's share climbs as its cases age, so the newest month shows the fewest approvals.`,
        )}{" "}
        <Link href="/uscis-receipt-blocks" className="link font-bold">
          Where approvals stand, block by block
        </Link>
      </p>
    </div>
  );
}

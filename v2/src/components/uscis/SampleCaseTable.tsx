import { keepWhole } from "@/components/ui/keep-whole";
import { ScrollBox } from "@/components/ui/scroll-box";
import type { SampleCaseRow } from "@/lib/db/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import { CASE_STATUS_FILL } from "@/lib/statusTone";
import { SAMPLE_GROUP_TINT, SAMPLE_GROUP_WORD } from "@/lib/uscisSample";

/**
 * Receipt numbers the sample checked, one row each: the number, its form, the last status the sample saw (the group in
 * words beside its colour, then USCIS's own words), the day the sample first saw that status and the day it last
 * checked. A row named in `mark` (the reader's own number) is drawn in ink. Server-rendered, a table that scrolls
 * sideways on a phone.
 */
export function SampleCaseTable({ rows, label, mark }: { rows: readonly SampleCaseRow[]; label: string; mark?: string }) {
  return (
    <ScrollBox className="mt-4" label={label}>
      <table className="w-full min-w-[640px] border-collapse text-left text-base">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b-2 border-border bg-tint">
            <th scope="col" className="px-4 py-2 font-semibold">
              Receipt number{" "}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Form{" "}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Last status we saw{" "}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              First seen{" "}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Last checked{" "}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tint = SAMPLE_GROUP_TINT[r.grp] ?? "flat";
            const own = r.receipt === mark;
            return (
              <tr key={r.receipt} className={`border-b border-border ${own ? "bg-foreground text-background" : ""}`}>
                <th scope="row" className="px-4 py-2 font-mono font-semibold">
                  {r.receipt}
                  {own ? <span className="ml-2 font-sans text-sm font-semibold">(yours)</span> : null}{" "}
                </th>
                <td className="px-4 py-2">{r.form ? keepWhole(r.form) : "Not shown"}{" "}</td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span aria-hidden="true" className={`inline-block size-3 shrink-0 border border-foreground ${CASE_STATUS_FILL[tint]}`} />
                    {SAMPLE_GROUP_WORD[r.grp] ?? r.grp}
                  </span>{" "}
                  <span className={`block text-sm ${own ? "" : "text-muted-foreground"}`}>{r.status}</span>{" "}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{formatAsOf(r.since_on) ?? r.since_on}{" "}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatAsOf(r.checked_on) ?? r.checked_on}{" "}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollBox>
  );
}

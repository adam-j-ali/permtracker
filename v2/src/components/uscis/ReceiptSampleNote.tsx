import Link from "next/link";

import { keepWhole } from "@/components/ui/keep-whole";
import { SampleCaseTable } from "@/components/uscis/SampleCaseTable";
import { blockPlace, getCasesAround, getReceiptLastStatus } from "@/lib/db/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import { softFail } from "@/lib/softRead";
import { BLOCK_NUMBERS_PER, RECEIPT_LAST_STATUS_SHOWN, SAMPLE_GROUP_WORD, blockFromInput, groupCounts } from "@/lib/uscisSample";

/** How far either side of a typed number the note reads: 500, so 1,000 numbers around it. */
export const AROUND_SPAN = 500;
/** The nearest checked numbers listed on each side; the rest are counted, and the block's list has every one. */
const NEAREST = 10;

/**
 * Below a typed receipt on /uscis-case-status: the last status the sample saw for this exact number, dated; the
 * numbers it checked within 500 either side, counted by status, the nearest ten on each side listed; and the link to
 * how its block is moving and to every number checked in that block (the Privacy Policy, "Our sample of USCIS cases").
 */
export async function ReceiptSampleNote({ receipt }: { receipt: string }) {
  const block = blockFromInput(receipt);
  const shown = RECEIPT_LAST_STATUS_SHOWN;
  const [seen, around, place] = await Promise.all([
    shown ? getReceiptLastStatus(receipt).catch(softFail("getReceiptLastStatus", null)) : null,
    shown ? getCasesAround(receipt, AROUND_SPAN).catch(softFail("getCasesAround", [])) : [],
    shown && block ? blockPlace(receipt).catch(softFail("blockPlace", 0)) : 0,
  ]);
  if (!block && !seen && around.length === 0) return null;
  const before = around.filter((r) => r.receipt < receipt).slice(-NEAREST);
  const after = around.filter((r) => r.receipt > receipt).slice(0, NEAREST);
  const counts = groupCounts(around);
  const listPage = Math.floor(place / BLOCK_NUMBERS_PER[0]) + 1;
  const listHref = block
    ? `/uscis-receipt-blocks/${block}/numbers?${new URLSearchParams({ ...(listPage > 1 ? { page: String(listPage) } : {}), at: receipt })}`
    : null;
  return (
    <section className="mt-8 border-2 border-border bg-card p-5 sm:p-6" aria-labelledby="sample-note-title">
      <h2 id="sample-note-title" className="font-heading text-xl font-bold">
        From our sample of USCIS cases
      </h2>{" "}
      {seen ? (
        <p className="mt-3 text-base leading-relaxed">
          The last time our sample checked this number, on {formatAsOf(seen.checked_on)}, USCIS showed{" "}
          <b className="font-bold">{seen.status}</b>
          {seen.form ? <> for an {keepWhole(seen.form)}</> : null}. Our sample first saw that status on{" "}
          {formatAsOf(seen.since_on)}. USCIS may have shown it earlier, and its own page has today&apos;s.
        </p>
      ) : null}{" "}
      {around.length > 0 ? (
        <div className="mt-6">
          <h3 className="font-heading text-lg font-bold">Cases around yours</h3>{" "}
          <p className="mt-2 text-base leading-relaxed">
            Of the 1,000 numbers around yours, 500 on each side, our sample checked {around.length.toLocaleString("en-US")}:{" "}
            {counts.map((c, i) => (
              <span key={c.grp}>
                {i ? ", " : ""}
                {c.n.toLocaleString("en-US")} {(SAMPLE_GROUP_WORD[c.grp] ?? c.grp).toLowerCase()}
              </span>
            ))}
            . The nearest {before.length + after.length} are below.
          </p>{" "}
          <SampleCaseTable
            rows={[...before, ...after]}
            label={`The checked numbers nearest ${receipt}`}
          />
        </div>
      ) : null}{" "}
      {block ? (
        <p className="mt-4 text-base leading-relaxed">
          This number sits in block <span className="font-mono font-bold">{block}</span>.{" "}
          <Link href={`/uscis-receipt-blocks/${block}`} className="link">
            See how cases in block {block} are moving
          </Link>
          {listHref && around.length > 0 ? (
            <>
              {" "}
              or{" "}
              <Link href={listHref} className="link">
                each number checked in it
              </Link>
            </>
          ) : null}
          .
        </p>
      ) : null}
    </section>
  );
}

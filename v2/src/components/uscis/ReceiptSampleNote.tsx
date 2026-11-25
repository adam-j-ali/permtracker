import Link from "next/link";

import { keepWhole } from "@/components/ui/keep-whole";
import { getReceiptLastStatus } from "@/lib/db/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import { softFail } from "@/lib/softRead";
import { RECEIPT_LAST_STATUS_SHOWN, blockFromInput } from "@/lib/uscisSample";

/**
 * Below a typed receipt on /uscis-case-status: the link to how its block is moving (an online number's block, counts
 * only), and, once RECEIPT_LAST_STATUS_SHOWN is on, the last status the sample saw for this exact number, dated. The
 * number itself is the reader's own input; nothing else here names a receipt.
 */
export async function ReceiptSampleNote({ receipt }: { receipt: string }) {
  const block = blockFromInput(receipt);
  const seen = RECEIPT_LAST_STATUS_SHOWN
    ? await getReceiptLastStatus(receipt).catch(softFail("getReceiptLastStatus", null))
    : null;
  if (!block && !seen) return null;
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
      {block ? (
        <p className="mt-3 text-base leading-relaxed">
          This number sits in block <span className="font-mono font-bold">{block}</span>.{" "}
          <Link href={`/uscis-receipt-blocks/${block}`} className="link">
            See how cases in block {block} are moving
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

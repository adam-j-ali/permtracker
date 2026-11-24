import Link from "next/link";

import type { EbSplit as Split } from "@/lib/db/ebSplit";
import { formatInt, formatShareOf } from "@/lib/format";
import { EB_LINE_COLOURS } from "./ebLineColours";
import { monthYear } from "@convex/lib/months";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * Which line the jobs in DOL's queue can join: the share whose own minimum meets the EB-2 bar,
 * from their wage requests. The employer picks the category at the I-140, so this is what the
 * jobs could file, never what they did.
 */
export function EbSplit({
  split,
  className,
  titled = true,
}: {
  split: Split | null;
  className?: string;
  /** Off inside an article, whose own heading names the section. */
  titled?: boolean;
}) {
  if (!split) return null;
  const known = split.eb2 + split.eb3;
  if (known === 0) return null;
  const eb2 = (split.eb2 / known) * 100;
  return (
    <section aria-labelledby={titled ? "eb-split-h" : undefined} aria-label={titled ? undefined : "EB-2 or EB-3: what the jobs require"} className={className}>
      {titled ? (
        <h2 id="eb-split-h" className="font-heading text-2xl font-bold sm:text-3xl">
          <KeepWhole>{"EB-2 or EB-3: what the jobs require"}</KeepWhole>
        </h2>
      ) : null}{" "}
      {/* Inside an article its own lead says what the bar is; on its own the chart says it. */}
      {titled ? (
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-soft">
          The employer picks the line at the <span className="whitespace-nowrap"><KeepWhole>{"I-140"}</KeepWhole></span><KeepWhole>{", after the PERM. The job decides which it can pick: a master’s or higher, or a bachelor’s and five years, meets the EB-2 bar."}</KeepWhole>
        </p>
      ) : null}{" "}
      <div className={titled ? "mt-6 max-w-3xl" : "max-w-3xl"}>
        <div aria-hidden="true" className="flex h-12 w-full border-2 border-border">
          <span className={`h-full ${EB_LINE_COLOURS.EB2.fill}`} style={{ width: `${eb2}%` }} />
          <span className={`h-full ${EB_LINE_COLOURS.EB3.fill}`} style={{ width: `${100 - eb2}%` }} />
        </div>{" "}
        <dl className="mt-3 grid grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <dt className="flex items-center gap-1.5 text-sm text-soft">
              <span aria-hidden="true" className={`size-3 border-2 ${EB_LINE_COLOURS.EB2.edge} ${EB_LINE_COLOURS.EB2.fill}`} /><KeepWhole>{" Meets the EB-2 bar"}</KeepWhole>
            </dt>{" "}
            <dd className="font-heading text-3xl font-bold tabular-nums">{formatShareOf(split.eb2, known)}</dd>{" "}
            <dd className="text-sm text-soft">{formatInt(split.eb2)} jobs</dd>
          </div>{" "}
          <div>
            <dt className="flex items-center gap-1.5 text-sm text-soft">
              <span aria-hidden="true" className={`size-3 border-2 ${EB_LINE_COLOURS.EB3.edge} ${EB_LINE_COLOURS.EB3.fill}`} /><KeepWhole>{" EB-3 only"}</KeepWhole>
            </dt>{" "}
            <dd className="font-heading text-3xl font-bold tabular-nums">{formatShareOf(split.eb3, known)}</dd>{" "}
            <dd className="text-sm text-soft">{formatInt(split.eb3)} jobs</dd>
          </div>
        </dl>
      </div>{" "}
      <p className="mt-5 max-w-3xl text-sm leading-relaxed text-soft">
        Every PERM job whose wage DOL set from {monthYear(split.from.slice(0, 7))} to {monthYear(split.to.slice(0, 7))}<KeepWhole>{", the jobs being filed and decided now, by its required education and experience and any alternative (8 CFR 204.5(k)(2)). A job that meets the bar can still go EB-3. The two lines’ cutoffs are on the"}</KeepWhole>{" "}
        <Link href="/tools/eb2-vs-eb3" className="link">
          <KeepWhole>{"EB-2 and EB-3 comparison"}</KeepWhole>
        </Link>
        .
      </p>
    </section>
  );
}

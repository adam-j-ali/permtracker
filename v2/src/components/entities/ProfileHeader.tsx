import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FinderDock, FinderDockPanel } from "@/components/tools/FinderDock";

/**
 * The top of an entity page: what this is, what is true of it right now, and
 * the reader's own way in, before any chapter starts.
 *
 * Most visitors to an employer page work there and came about their own case,
 * so the case-number box comes straight after the name and its answer line on a
 * phone, and sits beside the name on a wide header. A hold, an appeal or a
 * debarment keeps its box (it changes how every figure reads); the rest of what's
 * on record (layoff notices, inspections, other programs) is one plain line of
 * links, each to where it's shown in full.
 */

export interface ProfileFact {
  /** What the cell answers: "Main job", "Main worksite", "Industry". */
  label: string;
  value: string;
  href?: string;
  note?: string;
}

export interface ProfileTag {
  text: string;
  /** An anchor on the same page. */
  href: string;
  /** warn: on hold or at RFI; bad: an appeal or a debarment; ink: everything else worth a look, on the plain line. */
  tone: "warn" | "bad" | "ink";
}

const TONE: Record<Exclude<ProfileTag["tone"], "ink">, string> = {
  warn: "bg-data-warn-ink",
  bad: "bg-data-bad-ink",
};

/** A link alone on a phone's line gets the 44px floor (standalone-links-tap-floor.test.ts). */
const LINE_LINK = "link max-sm:inline-flex max-sm:min-h-11 max-sm:items-center";

export function ProfileHeader({
  eyebrow,
  name,
  answer,
  note,
  facts = [],
  tags = [],
  recordLead = "On record",
  aside,
  figures,
}: {
  eyebrow: string;
  name: string;
  /** The one sentence that answers why most people came: what is waiting at DOL now. */
  answer?: ReactNode;
  /** A plain line under the answer that says how to read the page (an employer page: these are past filings). */
  note?: ReactNode;
  facts?: ProfileFact[];
  tags?: ProfileTag[];
  /** The words before the plain line of links: "On record", "Also on this page". */
  recordLead?: string;
  aside?: ReactNode;
  figures?: ReactNode;
}) {
  const boxed = tags.filter((t): t is ProfileTag & { tone: "warn" | "bad" } => t.tone !== "ink");
  const record = tags.filter((t) => t.tone === "ink");
  const below = boxed.length > 0 || record.length > 0 || facts.length > 0;
  return (
    // Two columns by the header's own width, never the screen's: beside the data rail a 1024px screen leaves the
    // title a 256px column. One column below that, in reading order: the name and its answer, the case box, then
    // the tags and facts. On two, the box spans both rows of the left column, and the second row takes the spare
    // height, so a tall box never opens a gap between the name and its tags.
    <header className="@container pt-6 sm:pt-8">
      {/* The case box's finder opens in the dock's panel, under both columns: the box is too narrow to hold it. */}
      <FinderDock>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 @[52rem]:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] @[52rem]:grid-rows-[auto_1fr] @[52rem]:items-start [&>*]:min-w-0">
        <div>
          <p className="text-sm text-muted-foreground">{eyebrow}</p>{" "}
          <h1
            translate="no"
            className="mt-1.5 font-heading text-3xl font-bold leading-tight [overflow-wrap:anywhere] sm:text-[2.5rem]"
          >
            {name}
          </h1>{" "}
          {answer ? <p className="mt-3 max-w-2xl text-base leading-relaxed text-foreground sm:text-[1.0625rem]">{answer}</p> : null}{" "}
          {note ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{note}</p> : null}
        </div>{" "}
        {aside ? <div className="@[52rem]:col-start-2 @[52rem]:row-span-2 @[52rem]:row-start-1">{aside}</div> : null}{" "}
        {below ? (
          <div className="@[52rem]:col-start-1 @[52rem]:row-start-2">
            {boxed.length > 0 ? (
              <ul aria-label="What stands out now" className="flex flex-wrap gap-x-3 gap-y-2">
                {boxed.map((t) => (
                  <Fragment key={t.text}>
                    {" "}
                    <li>
                      <a
                        href={t.href}
                        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline-offset-2 hover:underline border-2 shadow-hard-sm motion-safe:hover:-translate-y-0.5 px-3 bg-card border-border transition-[color,background-color,border-color,box-shadow,transform]"
                      >
                        <span aria-hidden="true" className={cn("size-2.5 shrink-0", TONE[t.tone])} />
                        {t.text}
                      </a>
                    </li>
                  </Fragment>
                ))}
              </ul>
            ) : null}{" "}
            {record.length > 0 ? (
              <p className={cn("max-w-2xl text-base text-soft", boxed.length > 0 && "mt-3")}>
                <span className="font-semibold text-foreground">{`${recordLead}:`}</span>{" "}
                {record.map((t, i) => (
                  <Fragment key={t.text}>
                    {i > 0 ? " · " : null}
                    <a href={t.href} className={LINE_LINK}>
                      {t.text}
                    </a>
                  </Fragment>
                ))}
              </p>
            ) : null}{" "}
            {facts.length > 0 ? (
              <dl
                className={cn(
                  "grid max-w-2xl grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2",
                  (boxed.length > 0 || record.length > 0) && "mt-5",
                )}
              >
                {facts.map((f) => (
                  <div key={f.label} className="min-w-0">
                    <dt className="text-sm text-muted-foreground">{f.label}</dt>{" "}
                    <dd className="text-base font-semibold [overflow-wrap:anywhere]">
                      {f.href ? (
                        <Link href={f.href} className="link">
                          {f.value}
                        </Link>
                      ) : (
                        f.value
                      )}
                      {f.note ? <span className="font-normal text-muted-foreground"> · {f.note}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}
      </div>{" "}
      <FinderDockPanel className="mt-6" />
      </FinderDock>{" "}
      {figures ? <div className="mt-8">{figures}</div> : null}
    </header>
  );
}

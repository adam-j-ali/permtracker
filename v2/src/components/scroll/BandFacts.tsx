import { Fragment } from "react";

import { cn } from "@/lib/utils";

/**
 * A picture band's facts: three plain lines under its lead, each behind a small lime square, ruled apart. On an
 * ink band the rules take the band's light colour.
 */
export function BandFacts({ facts, ink = false }: { facts: readonly string[]; ink?: boolean }) {
  const rule = ink ? "border-white/30 dark:border-border" : "border-border";
  return (
    <ul className={cn("mt-6 border-t-2", rule)}>
      {facts.map((f) => (
        <Fragment key={f}>
          {" "}
          <li className={cn("flex gap-3 border-b-2 py-3 text-base leading-snug", rule)}>
            <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 border-2 border-black bg-primary" />{" "}
            <span>{f}</span>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

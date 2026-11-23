import { Fragment } from "react";

import { programNameRuns } from "@/lib/programNames";

/**
 * Text with every program or form name (H-1B, CW-1, I-140, ETA-9089) in a no-wrap span, so a line never ends
 * on "CW-" with "1" on the next. The words are unchanged: find-in-page, copying and search see the plain
 * hyphen. The rule and its list are in src/lib/programNames.ts. Server-safe: no hooks, no client code.
 */
export function KeepWhole({ children }: { children: string }) {
  return (
    <>
      {programNameRuns(children).map((r, i) =>
        r.name ? (
          <span key={i} className="whitespace-nowrap">
            {r.text}
          </span>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </>
  );
}

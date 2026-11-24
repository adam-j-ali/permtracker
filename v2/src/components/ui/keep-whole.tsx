import { Fragment, type ReactNode } from "react";

import { programNameRuns } from "@/lib/programNames";

/**
 * Text with every program or form name (H-1B, CW-1, I-140, ETA-9089) in a no-wrap span, so a line never ends
 * on "CW-" with "1" on the next. The words are unchanged: find-in-page, copying and search see the plain
 * hyphen. The rule and its list are in src/lib/programNames.ts. Server-safe: no hooks, no client code.
 *
 * Text with a name in it comes back in one span of its own, so it's still one piece wherever it sits: in a
 * flex row (a figure's label beside its icon, an inline-flex link) loose runs would each become a flex item,
 * spaced by the row's gap and wrapping apart. Text with no name comes back as it was.
 */
export function KeepWhole({ children }: { children: string }) {
  const runs = programNameRuns(children);
  if (!runs.some((r) => r.name)) return <>{children}</>;
  return (
    <span>
      {runs.map((r, i) =>
        r.name ? (
          <span key={i} className="whitespace-nowrap">
            {r.text}
          </span>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </span>
  );
}

/**
 * A shared part's text, kept whole when it's a string (a data file's label, a heading passed as a prop), and
 * drawn as it came when it's anything else: a node its caller built has its own text to keep.
 */
export function keepWhole(node: ReactNode): ReactNode {
  return typeof node === "string" ? <KeepWhole>{node}</KeepWhole> : node;
}

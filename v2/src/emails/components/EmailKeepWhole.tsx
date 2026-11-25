/**
 * Text with every program or form name (I-140, I-485, H-1B, ETA-9089) in a no-wrap span, so a line never ends on
 * "I-" with "485" on the next. The email form of the site's KeepWhole (src/components/ui/keep-whole.tsx): the same
 * rule (src/lib/programNames.ts), with the style inline because email clients drop class names. The words are
 * unchanged.
 *
 * @module
 */

import { Fragment } from "react";

import { programNameRuns } from "../../lib/programNames";

const NOWRAP = { whiteSpace: "nowrap" as const };

export function EmailKeepWhole({ children }: { children: string }) {
  const runs = programNameRuns(children);
  if (!runs.some((r) => r.name)) return <>{children}</>;
  return (
    <>
      {runs.map((r, i) =>
        r.name ? (
          <span key={i} style={NOWRAP}>
            {r.text}
          </span>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </>
  );
}

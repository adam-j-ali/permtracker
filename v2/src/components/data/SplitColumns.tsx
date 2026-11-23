import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Two columns of unequal width where the page is wide enough, one column in reading order where it isn't: the
 * main part on the left, a narrower part beside it (a picture, the figures that go with the words, a way to act on
 * them, a page's contents). A long page reads as one filled spread instead of a single column with empty margins.
 *
 * The split follows the column's own width, never the screen's: beside the data rail a 1024px screen leaves the
 * column too narrow for two. On one column the aside follows the main part, unless `asideFirst` puts it on top (a
 * page's contents, read before the text). The source order is the one-column order, so a screen reader and a
 * keyboard meet the parts in the order a phone shows them.
 */
export function SplitColumns({
  children,
  aside,
  asideFirst = false,
  sticky = false,
  label,
  className,
}: {
  children: ReactNode;
  aside: ReactNode;
  /** On one column, the aside comes before the main part. */
  asideFirst?: boolean;
  /** On two columns, the aside stays in view while the main part scrolls (a long page's contents). */
  sticky?: boolean;
  /** The aside's name for a screen reader, when it's a landmark of its own. */
  label?: string;
  className?: string;
}) {
  const main = <div className="@[56rem]:col-start-1 @[56rem]:row-start-1">{children}</div>;
  const side = (
    <aside
      aria-label={label}
      className={cn("@[56rem]:col-start-2 @[56rem]:row-start-1", sticky && "@[56rem]:sticky @[56rem]:top-24")}
    >
      {aside}
    </aside>
  );
  return (
    <div className={cn("@container", className)}>
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 @[56rem]:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] @[56rem]:items-start [&>*]:min-w-0">
        {asideFirst ? side : main}{" "}
        {asideFirst ? main : side}
      </div>
    </div>
  );
}

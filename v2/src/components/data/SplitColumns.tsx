import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Two columns of unequal width where the page is wide enough, one column in reading order where it isn't: the
 * main part on the left, a narrower part beside it (a picture, the figures that go with the words, a way to act on
 * them, a page's contents). A long page reads as one filled spread instead of a single column with empty margins.
 *
 * The split follows the column's own width, never the screen's: beside the data rail a 1024px screen leaves the
 * column too narrow for two. On one column the side part follows the main part, unless `asideFirst` puts it on top
 * (a page's contents, read before the text). The source order is the one-column order, so a screen reader and a
 * keyboard meet the parts in the order a phone shows them.
 *
 * The side part is a plain box: what goes in it brings its own meaning (a `nav` with a name, a `section` with a
 * heading), since an `aside` inside the page's main landmark is a landmark nested in a landmark.
 */
export function SplitColumns({
  children,
  aside,
  asideFirst = false,
  sticky = false,
  className,
}: {
  children: ReactNode;
  aside: ReactNode;
  /** On one column, the side part comes before the main part. */
  asideFirst?: boolean;
  /** On two columns, the side part stays in view while the main part scrolls (a long page's contents). */
  sticky?: boolean;
  className?: string;
}) {
  // With nothing beside it the main part is the whole width.
  if (aside == null || aside === false) return <div className={className}>{children}</div>;
  const main = <div className="@[56rem]:col-start-1 @[56rem]:row-start-1">{children}</div>;
  const side = (
    <div
      data-split-side=""
      className={cn("@[56rem]:col-start-2 @[56rem]:row-start-1", sticky && "@[56rem]:sticky @[56rem]:top-24")}
    >
      {aside}
    </div>
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

import { Fragment } from "react";

import { NewTabLink } from "@/components/ui/new-tab-link";
import { coverageOf } from "@/lib/press/coverage";
import { longDate } from "@convex/lib/months";
import { cn } from "@/lib/utils";

/** The stories that used this page's figures, in one plain line near its source line; nothing when there are none. */
export function CitedBy({ path, className }: { path: string; className?: string }) {
  const items = coverageOf(path);
  if (!items.length) return null;
  return (
    <p className={cn("mt-8 max-w-3xl text-base leading-relaxed text-muted-foreground", className)} data-cited-by="">
      {items.map((c, i) => (
        <Fragment key={c.href}>
          {i ? " " : ""}
          {c.outlet} used these figures in{" "}
          <NewTabLink href={c.href} inline>
            {c.about}
          </NewTabLink>
          , published {longDate(c.published)}.
        </Fragment>
      ))}
    </p>
  );
}

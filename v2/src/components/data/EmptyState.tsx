import type { ReactNode } from "react";
import Link from "next/link";

import { SpotPicture } from "@/components/ui/spot-picture";
import type { SpotPictureName } from "@/lib/spotPictures";
import { cn } from "@/lib/utils";

/**
 * What a part of a public page shows when it has nothing to show yet. Never a bare grey line: a box in the house's
 * ink edge on the tint, a small picture or icon, a title saying what will appear here, one sentence saying when or
 * why, and the one next step. The design system's empty state is a title, one sentence and one action.
 *
 * Plain server markup, so it reads the same before any script runs.
 */
export function EmptyState({
  title,
  children,
  action,
  spot,
  icon,
  heading = "h2",
  className,
}: {
  /** What will appear here: "No filings in the last 12 months", "Nothing loaded yet". */
  title: string;
  /** One sentence: when it fills, or why it's empty, and where the reader can look meanwhile. */
  children: ReactNode;
  /** The one next step. */
  action?: { href: string; label: string } | null;
  /** A drawn picture beside the words, where one helps. */
  spot?: SpotPictureName;
  /** A Phosphor icon, where no picture fits. */
  icon?: ReactNode;
  /** The title's level, so the page's outline stays in order. */
  heading?: "h2" | "h3";
  className?: string;
}) {
  const Heading = heading;
  return (
    <section className={cn("border-2 border-border bg-tint p-5 shadow-hard-sm sm:p-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        {spot ? (
          <SpotPicture name={spot} alt="" className="w-24 shrink-0 sm:w-28" />
        ) : icon ? (
          <span
            aria-hidden="true"
            className="inline-flex size-12 shrink-0 items-center justify-center border-2 border-border bg-card text-foreground [&_svg]:size-6"
          >
            {icon}
          </span>
        ) : null}{" "}
        <div className="min-w-0">
          <Heading className="font-heading text-lg font-bold leading-snug">{title}</Heading>{" "}
          <div className="mt-1.5 max-w-prose text-base leading-relaxed text-soft">{children}</div>{" "}
          {action ? (
            <Link href={action.href} className="link mt-2 inline-flex min-h-11 items-center font-semibold">
              {action.label}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

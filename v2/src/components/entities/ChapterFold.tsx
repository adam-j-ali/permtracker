import type { ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * A part of an entity page's chapter that waits behind one line: the newest lists, the peer lists, the older
 * years. A native `<details>`, so its words stay in the page for search, find-in-page and a link to an anchor
 * inside it (the browser opens it), and it works before any script runs. Folds sit on the tint, with no edge.
 *
 * The line says what opening it shows, in words a reader would look for. The parts inside keep their own headings.
 */
export function ChapterFold({
  summary,
  hint,
  children,
  className,
}: {
  /** What opening it shows: "Sponsors like this one". */
  summary: string;
  /** One more line, when the summary needs it. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group mt-6", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 bg-tint px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-heading text-lg font-bold underline-offset-4 group-hover:underline">{summary}</span>
          {hint ? <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span> : null}
        </span>{" "}
        <CaretDownIcon
          aria-hidden="true"
          weight="bold"
          className="size-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>{" "}
      <div className="mt-4">{children}</div>
    </details>
  );
}

import type { ReactNode } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * A link that opens in a new tab and says so: an arrow-out mark, and "(opens in a new tab)" for screen readers. For a
 * link from the signed-in app to one of the site's public pages, so the app stays where it was, and for a link out of
 * the site. `inline` keeps it in the flow of a sentence (the mark rides on the last word, and the words after it stay
 * on the same line); without it, it's its own small box.
 */
export function NewTabLink({
  href,
  children,
  className,
  inline = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  return (
    <a href={href} target="_blank" rel="noopener" className={cn(inline ? "link" : "link inline-flex items-center gap-1", className)}>
      {children}
      <ArrowSquareOutIcon
        aria-hidden="true"
        className={inline ? "ml-1 inline size-3.5 shrink-0 align-[-0.125em]" : "size-3.5 shrink-0"}
      />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

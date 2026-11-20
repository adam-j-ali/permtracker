import type { ReactNode } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * A link that opens in a new tab and says so: an arrow-out mark, and "(opens in a new tab)" for screen readers. For a
 * link from the signed-in app to one of the site's public pages, so the app stays where it was.
 */
export function NewTabLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className={cn("link inline-flex items-center gap-1", className)}>
      {children}
      <ArrowSquareOutIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

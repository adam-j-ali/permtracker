"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that pre-loads its page once a reader shows intent: the pointer over
 * it, a touch, or keyboard focus. For the page's frame (header, footer, data
 * rail, breadcrumbs) and for the rows of a list. A plain `<Link>` pre-loads
 * the moment it scrolls into view, and both show dozens of links at once: on
 * Oct 21 2026 one employer page view pre-loaded 20 to 40 frame links, and on
 * Nov 10 2026 its lists drew about 80 more, each one a whole page for the
 * server to answer. Next has no hover-only setting (`prefetch={false}` turns
 * hover off too), so this is the pattern its docs give: pre-loading stays off
 * until the first sign of intent, then it's the default again. A link in a
 * page's own sentences keeps the default.
 */
export function IntentLink({ prefetch, onMouseEnter, onTouchStart, onFocus, ...rest }: ComponentProps<typeof Link>) {
  const [armed, setArmed] = useState(false);
  return (
    <Link
      {...rest}
      prefetch={armed ? (prefetch ?? null) : false}
      onMouseEnter={(e) => {
        setArmed(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setArmed(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setArmed(true);
        onFocus?.(e);
      }}
    />
  );
}

"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/**
 * A list's other filters: open on a wide screen, one tap away on a phone.
 *
 * ON A WIDE SCREEN THEY'RE OPEN. For one release (Nov 11 2026) they sat behind this control at every width. The
 * reason was a phone, where the open filters are a screen tall above the list; on a desktop nothing was wrong, and
 * the filters are how the list gets used. So the fold is a phone's alone.
 *
 * WHICH ONE A SCREEN GETS IS A STYLE RULE (`sm:block` on the filters, `sm:hidden` on the control), never a script
 * reading the window: the server's page is already right, and nothing moves when the browser starts. With scripts
 * off the control can't work, so a phone gets the filters open.
 *
 * Shut or open, the fields stay in the page, so a form still carries them. On a phone the control says how many of
 * the filters inside are on, and the fold shuts when `shutOn` changes (a search was run): the list is what the
 * person came for.
 */
export function FilterFold({
  label = "More filters",
  active = 0,
  shutOn,
  children,
  className,
}: {
  label?: string;
  /** How many of the filters inside are set. */
  active?: number;
  /** Any value that changes when the list is asked again (a search's count): the fold shuts. */
  shutOn?: number;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Shut when a search runs. State adjusted while rendering, the way React asks for a value derived from a prop.
  const [seen, setSeen] = useState(shutOn);
  if (shutOn !== seen) {
    setSeen(shutOn);
    setOpen(false);
  }
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex min-h-[44px] cursor-pointer items-center gap-2 border-2 border-input bg-card px-4 text-sm font-bold hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:hidden"
      >
        <SlidersHorizontalIcon className="size-4 shrink-0" aria-hidden="true" />{" "}
        <span>{label}</span>{" "}
        {active > 0 ? <span className="bg-tint px-1.5 tabular-nums">{`${active} on`}</span> : null}{" "}
        <CaretDownIcon
          className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>{" "}
      <div id={id} data-filter-fold className={cn(open ? "mt-4" : "hidden", "sm:mt-0 sm:block")}>
        {children}
      </div>
      <noscript>
        <style>{`[id="${id}"]{display:block}`}</style>
      </noscript>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { CaretDownIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/** `sm` and up: room for an open fold above the list. False on the server, where nothing is filtered yet. */
function isWide(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 640px)").matches;
}

/**
 * The filters a list doesn't need on its first screen, behind one control: the search, then the list, then the
 * rest. Native `<details>`, so the keyboard and a screen reader work with no script, and a control inside is
 * still part of its form (a shut fold's fields are submitted like any others).
 *
 * The control says how many filters inside are on. On a wide screen it also opens by itself when one is, so a
 * filtered view shows what's narrowing it; on a phone it stays shut, because open it's a screen tall and the list
 * is what the person came for. It shuts when `shutOn` changes (a search was run), for the same reason.
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
  const [open, setOpen] = useState(() => active > 0 && isWide());
  // Shut when a search runs. State adjusted while rendering, the way React asks for a value derived from a prop.
  const [seen, setSeen] = useState(shutOn);
  if (shutOn !== seen) {
    setSeen(shutOn);
    setOpen(false);
  }
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={cn("group", className)}>
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-2 border-2 border-input bg-card px-4 text-sm font-bold hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <SlidersHorizontalIcon className="size-4 shrink-0" aria-hidden="true" />{" "}
        <span>{label}</span>{" "}
        {active > 0 ? <span className="bg-tint px-1.5 tabular-nums">{`${active} on`}</span> : null}{" "}
        <CaretDownIcon
          className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>{" "}
      <div className="mt-4">{children}</div>
    </details>
  );
}

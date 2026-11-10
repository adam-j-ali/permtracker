"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Where a case box's finder opens when the box sits in a narrow column.
 *
 * A list page's case box is a side column a few hundred pixels wide. Opened inside it, the finder was a box in a
 * box: its fields and its list squeezed, and the column three times as tall as the title beside it. Under a dock,
 * the box's "Find it by employer and filing date" opens the finder in the dock's panel instead, below the header
 * and as wide as the page's own column. The box still owns the finder (its kind of filing, its employer's name);
 * only where it's drawn changes, through a portal. With no dock above it, a case box opens its finder in place.
 */
interface Dock {
  open: boolean;
  toggle: () => void;
  /** The panel's id, for the opener's `aria-controls`. */
  panelId: string;
  /** The panel's element once it's on the page: the finder is drawn into it. */
  panel: HTMLElement | null;
}

const DockContext = createContext<Dock | null>(null);
/** How the panel hands its element to the dock: kept apart from the dock's own values, which are read while drawing. */
const AttachPanelContext = createContext<(el: HTMLElement | null) => void>(() => {});

export function FinderDock({ children }: { children: ReactNode }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const dock = useMemo<Dock>(() => ({ open, toggle: () => setOpen((o) => !o), panelId, panel }), [open, panelId, panel]);
  return (
    <AttachPanelContext.Provider value={setPanel}>
      <DockContext.Provider value={dock}>{children}</DockContext.Provider>
    </AttachPanelContext.Provider>
  );
}

/** The dock above this component, or null where a case box opens its finder in place. */
export function useFinderDock(): Dock | null {
  return useContext(DockContext);
}

/** How long after opening the panel still follows its own growth into view: the finder's code arrives a moment later. */
const SETTLE_MS = 1500;

/** The place the finder opens in: empty and hidden until then. `className` applies only while it's open. */
export function FinderDockPanel({ className }: { className?: string }) {
  const dock = useContext(DockContext);
  const attach = useContext(AttachPanelContext);
  const open = dock?.open ?? false;
  const panel = dock?.panel ?? null;

  // The opener can sit a screen above where the finder appears. Bring the finder into view as it arrives, by the
  // least scrolling that shows it, and stop following once it has settled so typing never moves the page.
  useEffect(() => {
    if (!open || !panel) return;
    // Asked for only where the browser has it: a test's document doesn't.
    const show = () => panel.scrollIntoView?.({ block: "nearest" });
    show();
    if (typeof ResizeObserver === "undefined") return;
    const grown = new ResizeObserver(show);
    grown.observe(panel);
    const settled = setTimeout(() => grown.disconnect(), SETTLE_MS);
    return () => {
      clearTimeout(settled);
      grown.disconnect();
    };
  }, [open, panel]);

  if (!dock) return null;
  return <div id={dock.panelId} ref={attach} hidden={!open} className={cn(open && className)} />;
}

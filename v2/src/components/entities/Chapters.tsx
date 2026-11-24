"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * A long page in named parts: the bar stays under the site header while the
 * page scrolls, says which part is on screen, and jumps to any of them (back
 * by the owner's ask, Oct 15 2026: the plain row scrolled away and left a long
 * page with no way back to its parts).
 */

export interface ChapterItem {
  id: string;
  label: string;
}

export function ChapterNav({ items, className }: { items: ChapterItem[]; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // The bar's rules run edge to edge (owner, Oct 15 2026: they stopped short of
  // the rail on the left and the window on the right). The page's own column
  // is narrower than that, so the bar measures how far it has to reach: on a
  // data page to the rail's edge, elsewhere and on a phone to the screen's.
  // Before this runs the rules span the column, as they always did.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const column = nav.closest<HTMLElement>("[data-shell-column]");
    const wide = window.matchMedia("(min-width: 64rem)");
    const measure = () => {
      const box = nav.getBoundingClientRect();
      let edge = 0;
      if (column && wide.matches && column.parentElement) {
        const gap = parseFloat(getComputedStyle(column.parentElement).columnGap) || 0;
        edge = column.getBoundingClientRect().left - gap;
      }
      nav.style.setProperty("--bleed-l", `${Math.max(0, box.left - edge)}px`);
      nav.style.setProperty("--bleed-r", `${Math.max(0, document.documentElement.clientWidth - box.right)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    ro.observe(nav);
    if (column) ro.observe(column);
    return () => ro.disconnect();
  }, []);

  // The part on screen is the last one, in page order, whose top has passed a line a third of the way down the
  // window; above the first part nothing is marked. It is read from where each part sits, once a frame while the
  // page scrolls or resizes. An intersection observer kept whatever it last reported, and left "Notes" lit at the
  // top of a page after a jump back up.
  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const pick = () => {
      const line = window.innerHeight * 0.3;
      let current: string | null = null;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= line) current = s.id;
      }
      // At the foot of the page a short last part may never reach the line: once the page can't scroll further,
      // the last part whose top is on screen is the one being read.
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        for (const s of sections) {
          if (s.getBoundingClientRect().top < window.innerHeight) current = s.id;
        }
      }
      setActive(current);
    };
    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    };
    pick();
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items]);

  // On a phone the bar scrolls sideways: keep the current part in view,
  // without moving the page.
  useEffect(() => {
    const list = listRef.current;
    const link = active ? list?.querySelector<HTMLElement>(`a[href="#${active}"]`) : null;
    if (!list || !link) return;
    const left = link.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + link.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, left - 16);
    }
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="On this page"
      className={cn(
        // Sticks under the fixed header. `-mx` lines its parts up with the
        // column's edges; the ground and rules are a layer behind them that
        // reaches as far as the effect above measured, painted rather than
        // sized (`chapter-ground` in globals.css), so no measurement can make
        // the page wider than the screen.
        "chapter-ground sticky top-(--site-header-h) z-30 -mx-4 min-w-0 px-4 sm:-mx-6 sm:px-6 print:hidden",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <p className="hidden shrink-0 text-sm font-semibold text-muted-foreground lg:block">On this page</p>{" "}
        {/* `max-lg:pl-8`: below lg the data rail's 44px handle is fixed at the
            screen's left edge at this same height, and covered the first link. */}
        <ol
          ref={listRef}
          className="flex min-w-0 gap-2 overflow-x-auto py-2 pr-1 max-lg:pl-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((i) => (
            <Fragment key={i.id}>
              {" "}
              <li className="shrink-0">
                <a
                  href={`#${i.id}`}
                  aria-current={active === i.id ? "location" : undefined}
                  // Boxes, not underlined links (round 3, Oct 15 2026): each part
                  // is a tile, the one on screen filled lime.
                  className="inline-flex min-h-11 items-center whitespace-nowrap border-2 border-border bg-card px-3 text-sm font-bold text-foreground shadow-hard-sm transition-colors duration-150 hover:bg-sage-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[current=location]:border-black aria-[current=location]:bg-primary aria-[current=location]:text-black"
                >
                  {keepWhole(i.label)}
                </a>
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
    </nav>
  );
}

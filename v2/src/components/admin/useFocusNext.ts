"use client";

import { useEffect, useRef } from "react";

/**
 * Focus an element once the next render has put it on the page.
 *
 * A two-press control swaps one button for others, and React drops keyboard focus to the page when it removes the
 * focused button. Call the returned function with a getter for where focus belongs, then change the state that
 * renders it; after that render, the getter's element takes focus.
 */
export function useFocusNext(): (target: () => HTMLElement | null) => void {
  const next = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const el = next.current?.();
    if (!el) return;
    next.current = null;
    el.focus();
  });
  return (target) => {
    next.current = target;
  };
}

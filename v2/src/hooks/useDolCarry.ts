"use client";

import { useMemo, useSyncExternalStore } from "react";

import { readDolCarry, type DolCarried } from "@/lib/dolCarried";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** The address's query is the snapshot: a string compares equal between reads, an object wouldn't. */
function snapshot(): string {
  return window.location.search;
}

/**
 * The DOL record a public case page's "Add to my cases" carried in the address (src/lib/dolCarried.ts), or null.
 * Null on the server and in the first client render, like the calculator's carry (useCarriedDates), so the page
 * hydrates the same either way; `key` remounts the form once the record is read.
 */
export function useDolCarry(): { record: DolCarried | null; key: string } {
  const search = useSyncExternalStore(subscribe, snapshot, () => "");
  const record = useMemo(() => (search ? readDolCarry(new URLSearchParams(search)) : null), [search]);
  return { record, key: record ? `dol-${record.caseNumber}` : "" };
}

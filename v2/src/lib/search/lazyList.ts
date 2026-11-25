import { useEffect, useState } from "react";

/**
 * A list fetched at most once per visit and shared by everything that asks (the search palette, the 404 page): the
 * articles (/articles.json) and the consulates (/consulates.json). A failed fetch is forgotten, so the next caller
 * tries again, and an answer that isn't a list is refused rather than read.
 */
export function lazyList<T>(url: string) {
  let pending: Promise<T[]> | null = null;

  function load(): Promise<T[]> {
    pending ??= fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url} answered ${r.status}`);
        return r.json();
      })
      .then((list: unknown) => {
        if (!Array.isArray(list)) throw new Error(`${url} is not a list`);
        return list as T[];
      })
      .catch((e: unknown) => {
        pending = null;
        throw e;
      });
    return pending;
  }

  /** The list once `enabled`; `failed` when it couldn't be read. */
  function useList(enabled: boolean): { list: T[]; failed: boolean } {
    const [state, setState] = useState<{ list: T[]; failed: boolean }>({ list: [], failed: false });
    useEffect(() => {
      if (!enabled) return;
      let live = true;
      load().then(
        (list) => live && setState({ list, failed: false }),
        () => live && setState((s) => ({ list: s.list, failed: true })),
      );
      return () => {
        live = false;
      };
    }, [enabled]);
    return state;
  }

  /** For tests: forget the fetched list. */
  function reset(): void {
    pending = null;
  }

  return { load, useList, reset };
}

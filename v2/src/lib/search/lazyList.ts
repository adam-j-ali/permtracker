import { useEffect, useState } from "react";

/**
 * A list fetched at most once per visit and shared by everything that asks (the search palette, the 404 page): the
 * articles (/articles.json), the consulates (/consulates.json), the job titles (/soc-titles.json) and the cities
 * (/cities.json). A failed fetch is forgotten, so the next caller tries again, and an answer that isn't a list is
 * refused rather than read.
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

  /**
   * The list once `enabled`; `failed` when it couldn't be read; `ready` once it has been, so an empty list read
   * and a list not read yet can be told apart.
   */
  function useList(enabled: boolean): { list: T[]; failed: boolean; ready: boolean } {
    const [state, setState] = useState<{ list: T[]; failed: boolean; ready: boolean }>({ list: [], failed: false, ready: false });
    useEffect(() => {
      if (!enabled) return;
      let live = true;
      load().then(
        (list) => live && setState({ list, failed: false, ready: true }),
        () => live && setState((s) => ({ ...s, failed: true })),
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

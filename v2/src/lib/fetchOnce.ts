/**
 * A JSON file a page asks for the first time a reader needs it, rather than carrying it in every page load. Fetched at
 * most once a visit; a failed fetch or an answer of the wrong shape is forgotten, so the next try asks again.
 */
export function fetchOnce<T>(url: string, check: (body: unknown) => body is T): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`${url} answered ${r.status}`);
          return r.json() as Promise<unknown>;
        })
        .then((body) => {
          if (!check(body)) throw new Error(`${url} isn't the shape expected`);
          return body;
        })
        .catch((e: unknown) => {
          pending = null;
          throw e;
        });
    }
    return pending;
  };
}

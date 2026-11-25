import type { SourceKind } from "@/lib/sourceKind";

/**
 * The sources switch's views (D3, Nov 25 2026): every kind of figure, or one, so a reader can see the agency's figures,
 * our own count or people's reports alone. A view is shared by `?source=` in the address; the canonical stays the bare
 * page and robots.txt keeps the variants off the crawl.
 */
export const SOURCE_VIEWS = [
  { id: "all", kind: null, label: "All" },
  { id: "agency", kind: "official", label: "The agency" },
  { id: "ours", kind: "measured", label: "Our count" },
  { id: "people", kind: "community", label: "People's reports" },
] as const satisfies readonly { id: string; kind: SourceKind | null; label: string }[];

export type SourceViewId = (typeof SOURCE_VIEWS)[number]["id"];

const IDS = new Set<string>(SOURCE_VIEWS.map((v) => v.id));

/** The view an address asks for (`location.search`); anything unknown is all. */
export function sourceViewFrom(search: string): SourceViewId {
  const asked = new URLSearchParams(search).get("source");
  return asked && IDS.has(asked) ? (asked as SourceViewId) : "all";
}

/** The address's query with this view in it, other parameters kept; all drops the parameter. */
export function withSourceView(search: string, view: SourceViewId): string {
  const params = new URLSearchParams(search);
  if (view === "all") params.delete("source");
  else params.set("source", view);
  const out = params.toString();
  return out ? `?${out}` : "";
}

/**
 * The page numbers a pager draws, shared by the client pager (src/components/ui/pagination.tsx) and the server-drawn
 * one on pages paged by their address (the receipt numbers in a block).
 */

/** The page numbers to draw, 1-based, with "gap" where a run is skipped. Seven slots at most. */
export function pageItems(page: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "gap", count];
  if (page >= count - 3) return [1, "gap", count - 4, count - 3, count - 2, count - 1, count];
  return [1, "gap", page - 1, page, page + 1, "gap", count];
}

/** Clamp a page number read from anywhere to 1..count. */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, count));
}

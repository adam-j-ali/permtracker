/**
 * Sorting cases by an order the person set by hand.
 *
 * The saved order is a list of case ids. A case on the list sorts by its place
 * there, the first place included; a case that isn't on it sorts after every
 * case that is.
 */

/** A case's place in the saved order, or undefined when it isn't on the list. */
export function placeIn(order: ReadonlyMap<string, number>, id: string): number | undefined {
  return order.has(id) ? order.get(id) : undefined;
}

/**
 * Compares two cases by the saved order. Returns undefined when neither is on
 * the list, so the caller applies its own rule for those.
 */
export function compareByCustomOrder(
  order: ReadonlyMap<string, number>,
  aId: string,
  bId: string,
): number | undefined {
  const a = placeIn(order, aId);
  const b = placeIn(order, bId);
  if (a !== undefined && b !== undefined) return a - b;
  if (a !== undefined) return -1;
  if (b !== undefined) return 1;
  return undefined;
}

/** The saved order as a lookup from case id to place. */
export function orderLookup(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]));
}

/**
 * What kind of source a figure comes from. Every dataset row (DATASET_COVERAGE) and every figure card (`Figure`)
 * carries one, so no figure ships without saying which it is.
 *
 * - official: what the agency publishes, as it printed it (DOL's average, USCIS's posted times, the visa bulletin).
 * - measured: our own reading of the agency's case-by-case records: DOL's live case-status service, its disclosure
 *   files, and the USCIS receipt sample.
 * - community: what people report about their own cases.
 */
export const SOURCE_KINDS = ["official", "measured", "community"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * A figure's kind: one, or the kinds it's built from when it blends them (the PERM estimate is measured, with DOL's
 * own average as its fallback, so it names both).
 */
export type FigureKind = SourceKind | readonly [SourceKind, SourceKind, ...SourceKind[]];

/** The kinds a figure names, each once, in the order given. */
export function kindsOf(kind: FigureKind): readonly SourceKind[] {
  return typeof kind === "string" ? [kind] : [...new Set(kind)];
}

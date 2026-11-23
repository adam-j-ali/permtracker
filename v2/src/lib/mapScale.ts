/**
 * The one colour scale every state map fills with: four steps of the information blue mixed into the card, the
 * last step the blue itself. Blue says "information" on this site, never a pick or an action (lime is those), and
 * the steps are opaque mixes over the card, so they read the same over either theme's ground. A state with nothing
 * is plain card, a known zero; hatching means "not known" and is never used for a zero.
 */
export const BLUE_STEPS = [25, 50, 75, 100] as const;

/** The fill for step 0 (least) to 3 (most). */
export function blueFill(step: number): string {
  const i = Math.max(0, Math.min(BLUE_STEPS.length - 1, Math.floor(step)));
  return `color-mix(in srgb, var(--data-info) ${BLUE_STEPS[i]}%, var(--card))`;
}

/** A state with no filings: the card itself. */
export const NONE_FILL = "var(--card)";

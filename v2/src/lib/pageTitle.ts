/**
 * Page titles that fit what a search result shows, for the templates whose title holds a name of any
 * length (a job title, an industry, a consulate).
 *
 * Google cuts a title near 600px, about 60 characters, and the root layout's template adds the brand,
 * so a 50-character name can render at 75. The order of what gives way is the site's standing one
 * (`entityTitle` in components/tools/EntityContext.tsx): a qualifier first while the brand still fits,
 * then the brand, and only when the name alone can't fit, the name, cut after a whole word with an
 * ellipsis. The frame around the name (the code, "SOC Code for", "PERM") is the key term and is never
 * cut. A word is never split: "(except Physi" read in industry titles until Oct 6 2026.
 */

/** What a search result shows of a title, in characters. */
export const TITLE_LIMIT = 60;
/** `title.template` in `src/app/layout.tsx`. Changing that must change this. */
export const TITLE_SUFFIX = " | PERM Tracker";

const ELLIPSIS = "…";

/** Words a cut title must not end on: they promise a word that isn't there. */
const JOINERS = new Set(["and", "or", "of", "for", "the", "in", "with", "to", "a", "an", "at", "by", "on", "&", "-", "–", "—"]);

export interface FittedTitle {
  /** The title without the brand. */
  title: string;
  /** True when the brand template must be dropped to keep the title short. */
  absolute: boolean;
  /** True when the name was shortened. */
  cut: boolean;
}

/** The name's first words that fit `room` characters with an ellipsis, never ending on a joiner or a mark. */
function cutAtWord(name: string, room: number): string {
  const words = name.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    if ([...kept, w].join(" ").length + ELLIPSIS.length > room) break;
    kept.push(w);
  }
  // A trailing joiner or a word ending in a mark (a comma, an open bracket) reads as a broken phrase.
  while (kept.length > 1 && (JOINERS.has(kept[kept.length - 1]!.toLowerCase()) || /^[([]/.test(kept[kept.length - 1]!))) kept.pop();
  const head = kept.length ? kept.join(" ") : (words[0] ?? name);
  return `${head.replace(/[\s,;:/(\[\-–—&]+$/, "")}${ELLIPSIS}`;
}

/**
 * The title for `name` in the first frame that fits with the brand, else the first that fits alone, else the
 * last frame with the name cut at a word. `frames` run richest first; each places the name in its key term.
 */
export function fitTitle(name: string, frames: ReadonlyArray<(name: string) => string>, limit: number = TITLE_LIMIT): FittedTitle {
  const whole = frames.map((f) => f(name));
  for (const t of whole) if (t.length + TITLE_SUFFIX.length <= limit) return { title: t, absolute: false, cut: false };
  for (const t of whole) if (t.length <= limit) return { title: t, absolute: true, cut: false };
  const last = frames[frames.length - 1] ?? ((n: string) => n);
  const room = limit - last("").length;
  return { title: last(cutAtWord(name, room)), absolute: true, cut: true };
}

/** The `title` a page's metadata carries: the plain form takes the layout's brand template, a fitted one doesn't. */
export function metadataTitle(t: FittedTitle): string | { absolute: string } {
  return t.absolute ? { absolute: t.title } : t.title;
}

/** The `<title>` Next renders from it, brand included where it stays. */
export function renderedTitle(t: FittedTitle): string {
  return t.absolute ? t.title : `${t.title}${TITLE_SUFFIX}`;
}

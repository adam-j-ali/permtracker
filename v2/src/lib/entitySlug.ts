/**
 * Identity and URLs for the programmatic entity pages.
 *
 * Two separate jobs, and conflating them was the original bug.
 *
 * `entityKey` decides WHO an entity is, before anything is counted or
 * ranked. DOL prints the name that went on the form, so one practice
 * arrives under dozens of spellings. It lives in `convex/lib/entityKey.ts`
 * and is re-exported here.
 *
 * `slugify` / `withUniqueSlugs` decide what URL a decided entity gets. The
 * `-2` suffix still exists, but it now only handles the residue that
 * survives a real merge - two genuinely different entities whose names
 * happen to reduce to the same string. It is no longer doing identity's job.
 *
 * THE RULES ARE MIRRORED IN `scripts/entity_identity.py` AND
 * `scripts/lib_slugs.py`. A key or a slug computed differently in the
 * writer than in the reader is a detail page that 404s from its own index,
 * so `src/lib/__tests__/entitySlug.test.ts` and
 * `scripts/test_entity_identity.py` assert both against ONE fixture file:
 * `src/lib/__fixtures__/entityIdentity.json`.
 */

// The key rule lives beside the withheld-names masker, which reads it too (Convex can't import the site's modules).
// A relative path: Convex bundles this file too (convex/caseAlerts.ts), and its bundler knows no "@convex" alias.
export { entityKey, programKey } from "../../convex/lib/entityKey";

export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

export interface Slugged<T> {
  slug: string;
  item: T;
}

/**
 * Assigns each item a unique slug. Order matters and must be deterministic:
 * the caller sorts first (by volume), so the busier entity keeps the clean
 * slug and the later one takes the suffix.
 */
export function withUniqueSlugs<T>(items: T[], nameOf: (item: T) => string): Slugged<T>[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = slugify(nameOf(item)) || "entity";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { slug: n === 0 ? base : `${base}-${n + 1}`, item };
  });
}

export function findBySlug<T>(items: Slugged<T>[], slug: string): T | undefined {
  return items.find((s) => s.slug === slug)?.item;
}

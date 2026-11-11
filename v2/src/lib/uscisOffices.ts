/**
 * Every USCIS office in the quarterly I-485 file, with the address of its own page.
 *
 * A fixed list (uscisOffices.json), so the sitemap, the search box and the page's static params read it without
 * the database. It was written from USCIS's FY2026 Q3 file (99 rows besides the total). The file names an office
 * by its city and files it under a state; five service centers are named by their state alone ("Texas"), so each
 * carries its full name here.
 *
 * An office USCIS adds later has a row on the index page and no page of its own until it's added to the JSON. The
 * quarterly load reads the same file and ends red, naming the office, for as long as one is missing
 * (`offices_without_a_page` in scripts/ingest_uscis_quarterly.py).
 */

import OFFICES from "./uscisOffices.json";

export interface UscisOffice {
  /** USCIS's three-letter code, the key in the quarterly file. */
  code: string;
  /** The office as a person would say it: "Hartford", "National Benefits Center", "Texas Service Center". */
  name: string;
  /** The state or territory of a field office; empty for the service centers and the National Benefits Center. */
  state: string;
  slug: string;
}

export const USCIS_OFFICES: readonly UscisOffice[] = OFFICES;

const BY_SLUG = new Map(USCIS_OFFICES.map((o) => [o.slug, o]));
const BY_CODE = new Map(USCIS_OFFICES.map((o) => [o.code, o]));

export const officeBySlug = (slug: string): UscisOffice | undefined => BY_SLUG.get(slug);
export const officeByCode = (code: string): UscisOffice | undefined => BY_CODE.get(code);

/** The office's own page, or null for a code this list doesn't hold yet. */
export function officeHref(code: string): string | null {
  const o = BY_CODE.get(code);
  return o ? `/i485-by-field-office/${o.slug}` : null;
}

/** "Hartford, Connecticut" for a field office; the center's own name otherwise. */
export const officePlace = (o: UscisOffice): string => (o.state ? `${o.name}, ${o.state}` : o.name);

/** A field office (it holds interviews) or one of the centers that decide cases on paper. */
export const isCenter = (o: UscisOffice): boolean => o.state === "";

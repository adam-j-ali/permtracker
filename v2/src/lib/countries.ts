/**
 * Country names for the two-letter codes a case stores (convex/lib/perm/greenCard.ts): the country of birth and the
 * chargeability country. The names come from the runtime's own list (`Intl.DisplayNames`), so none is spelled by
 * hand here; a runtime without it shows the code.
 */

import { COUNTRY_CODES, type CountryCode } from "@/lib/perm";

let names: Intl.DisplayNames | null | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (names !== undefined) return names;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  return names;
}

/** "India" for "IN"; the code itself when the runtime can't name it. */
export function countryName(code: string): string {
  try {
    return displayNames()?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country a case can name, A to Z by its English name. */
export const COUNTRY_OPTIONS: readonly { code: CountryCode; name: string }[] = COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
})).sort((a, b) => a.name.localeCompare(b.name, "en"));

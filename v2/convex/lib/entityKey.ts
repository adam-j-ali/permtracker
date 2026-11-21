/**
 * WHO an entity is: the merge key that joins one real-world employer or law
 * firm across its printed spellings. DOL prints the name that went on the
 * form, so one practice arrives under dozens of spellings.
 *
 * It lives here so Convex's code can read it too: the withheld-names masker
 * (./withheldNames.ts) knows a withheld firm's older spelling by the same key
 * the site joins that spelling to its page by. `src/lib/entitySlug.ts`
 * re-exports both functions for the site.
 *
 * THE RULES ARE MIRRORED IN `scripts/entity_identity.py`. A key computed
 * differently in the writer than in the reader is a detail page that 404s
 * from its own index, so `src/lib/__tests__/entitySlug.test.ts` and
 * `scripts/test_entity_identity.py` assert both against ONE fixture file:
 * `src/lib/__fixtures__/entityIdentity.json`.
 */

/**
 * Words that say what KIND of thing something is rather than which one.
 * Stripping them is conservative: two names still only merge when every
 * remaining word is identical.
 */
const ENTITY_NOISE = new Set([
  "llp", "lllp", "llc", "inc", "pc", "plc", "pllc", "lp", "ltd", "corp",
  "corporation", "co", "company", "pa", "chartered", "and", "the",
  // The spelled-out forms of "ltd" and "inc" (Oct 5 2026). Without them "INFOSYS LIMITED"
  // (46,988 LCAs) sat on a page apart from "INFOSYS LTD.", whose PERM page showed 0 H-1B.
  "limited", "incorporated",
]);

/**
 * A merge key for one real-world entity across its printed spellings.
 *
 * The load-bearing step is the re-glue. Punctuation is shredded to spaces
 * first, so `P.C.` arrived as `p` + `c` and the noise list - which has
 * always contained "pc" - never saw it. `Jackson Lewis P.C.` and `Jackson
 * Lewis PC` were two firms with two pages and two ranks, and so were 604
 * other pairs. Gluing runs of consecutive single-letter tokens back into one
 * token before filtering fixes exactly that and nothing else: `l l c` ->
 * `llc` (dropped), `p a` -> `pa` (dropped), `a t t` -> `att` (kept, and
 * correct for AT&T).
 */
export function entityKey(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const glued: string[] = [];
  for (let i = 0; i < words.length; ) {
    if (words[i]!.length === 1) {
      let j = i;
      while (j < words.length && words[j]!.length === 1) j += 1;
      glued.push(words.slice(i, j).join(""));
      i = j;
    } else {
      glued.push(words[i]!);
      i += 1;
    }
  }
  const kept = glued.filter((w) => !ENTITY_NOISE.has(w));
  return kept.length > 0 ? kept.join(" ") : cleaned.trim();
}

/**
 * The entities DOL's program files actually carry, plus numeric ones.
 * Python's `html.unescape` knows every HTML5 name; these are the ones a
 * printed employer name has been seen to hold, so the two agree on every
 * name the fixture pins.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** "Acme Holdings d/b/a Acme Staffing": the legal name is the part before the trade name. */
const TRADE_NAME = /\s+(?:d\s*\/\s*b\s*\/\s*a|d\.b\.a\.?|dba|a\s*\/\s*k\s*\/\s*a|aka)\s+.*$/i;

/**
 * The key that joins a printed employer name to its page across programs.
 *
 * `entityKey` after the three repairs the H-1B and wage-request files need:
 * HTML entities decoded (twice, for "&amp;amp;"), only the legal name before
 * "d/b/a" or "a/k/a", and ".com" dropped. Mirrors `program_key` in
 * `scripts/entity_identity.py`, which builds `employer_page_map.key`; both are
 * asserted against `program_keys` in the shared fixture.
 */
export function programKey(raw: string): string {
  let text = decodeEntities(decodeEntities(raw ?? ""));
  text = text.replace(TRADE_NAME, "");
  text = text.replace(/\.com\b/gi, "");
  return entityKey(text);
}

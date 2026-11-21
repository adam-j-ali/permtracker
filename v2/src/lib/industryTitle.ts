/**
 * Titles for the industry pages (/perm-industries/<code>).
 */

/**
 * A Census industry title without its parenthetical: "(except Physicians)" and
 * our own "(group 518)" note stay on the page, and the NAICS code that sits
 * beside this name in a title already tells two such industries apart.
 */
export function industryName(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, "").trim() || label;
}

/**
 * The two forms of an industry title around its name, for `fitTitle` (lib/pageTitle.ts): "PERM in <industry>,
 * NAICS <code>", and the code first for a name too long for that. People search these pages by code ("naics code
 * 238340"), so the code is the key term the fitter never cuts.
 */
export function industryFrames(code: string): Array<(name: string) => string> {
  return [(n) => `PERM in ${n}, NAICS ${code}`, (n) => `NAICS ${code} PERM Filings: ${n}`];
}

/** The whole title, uncut, for a share card: "PERM in <industry>, NAICS <code>" when it fits 60; the code first when it doesn't. */
export function industryTitle(label: string, code: string): string {
  const [plain, codeFirst] = industryFrames(code).map((f) => f(industryName(label)));
  return plain!.length <= 60 ? plain! : codeFirst!;
}

/**
 * What a saved case is called wherever the app, an email or a calendar names it.
 *
 * A case needn't carry an employer or a job title: a person tracking their own case may know neither, and the
 * case stores each as empty text then (the way an absent beneficiary has always been stored). Every name here
 * falls back in one order: the employer, the person, DOL's case number, then the words the caller passes. The
 * site imports this module too, so the app and the server never name a case two ways.
 */

/** The parts of a case its names are built from. Any may be missing, empty or null. */
export interface CaseNameParts {
  employerName?: string | null;
  positionTitle?: string | null;
  beneficiaryIdentifier?: string | null;
  caseNumber?: string | null;
}

const part = (s: string | null | undefined): string => (s ?? "").trim();

/** The case's heading: the employer, else the person, else DOL's case number, else `fallback`. */
export function caseTitle(c: CaseNameParts, fallback = "Your case"): string {
  return part(c.employerName) || part(c.beneficiaryIdentifier) || part(c.caseNumber) || fallback;
}

/**
 * The line under the heading: the job title, and the person when the heading is the employer's. Nothing the
 * heading already says is repeated; "" when nothing is left.
 */
export function caseSubtitle(c: CaseNameParts): string {
  const byEmployer = part(c.employerName) !== "";
  return [part(c.positionTitle), byEmployer ? part(c.beneficiaryIdentifier) : ""].filter(Boolean).join(", ");
}

/** The case on one line: the heading, then the line under it, joined by commas. */
export function caseOneLine(c: CaseNameParts, fallback = "Your case"): string {
  return [caseTitle(c, fallback), caseSubtitle(c)].filter(Boolean).join(", ");
}

/**
 * The case inside a sentence ("for J.D. at Acme Corp"): the person at the employer, the job at the employer when
 * there's no person, whichever half there is, or `fallback` when there's neither.
 */
export function caseInSentence(c: CaseNameParts, fallback: string): string {
  const employer = part(c.employerName);
  const who = part(c.beneficiaryIdentifier) || part(c.positionTitle);
  if (who && employer) return `${who} at ${employer}`;
  return who || employer || fallback;
}

/**
 * The key two cases share when they look like the same case: the employer and the person, compared without case
 * or spaces. A case without an employer has none, since two cases nobody named can't be told apart that way.
 */
export function duplicateKey(c: { employerName?: string | null; beneficiaryIdentifier?: string | null }): string | null {
  const employer = part(c.employerName).toLowerCase();
  if (!employer) return null;
  return `${employer}|${part(c.beneficiaryIdentifier).toLowerCase()}`;
}

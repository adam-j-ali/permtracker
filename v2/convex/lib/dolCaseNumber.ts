/**
 * A case's DOL case number: the one number the watch follows for DOL's live status, the case page links to DOL's
 * record by, and the estimate reads. The form has three boxes that can hold a DOL number: "DOL case number" in Basic
 * information, the ETA 9089's in its fold and the wage request's. A number typed only in a step's box is carried into
 * the DOL case number, the ETA 9089's first since it's the later step, so it's watched wherever it was entered.
 *
 * A number typed in the DOL case number box itself is kept: it's only replaced while it's empty or the same number as
 * one of the step boxes (so it moves on when the case moves from its wage request to its ETA 9089 filing).
 */
import { normaliseFlagCaseNumber } from "../../src/lib/flagCaseNumber";

export interface CaseNumbers {
  caseNumber?: string | null;
  eta9089CaseNumber?: string | null;
  pwdCaseNumber?: string | null;
}

/** One spelling per DOL number, so a reformatted number isn't read as a new one. */
export function dolNumberKey(n: unknown): string {
  if (typeof n !== "string") return "";
  return normaliseFlagCaseNumber(n)?.caseNumber ?? n.trim().toUpperCase();
}

/** The step's own DOL number, in DOL's spelling: the ETA 9089's, else the wage request's; null when neither is one. */
export function stepDolNumber(n: CaseNumbers): string | null {
  for (const raw of [n.eta9089CaseNumber, n.pwdCaseNumber]) {
    const parsed = typeof raw === "string" ? normaliseFlagCaseNumber(raw) : null;
    if (parsed) return parsed.caseNumber;
  }
  return null;
}

/** True when the DOL case number box is empty or holds the same number as a step's box. */
function followsTheSteps(n: CaseNumbers): boolean {
  const own = dolNumberKey(n.caseNumber);
  if (!own) return true;
  return own === dolNumberKey(n.eta9089CaseNumber) || own === dolNumberKey(n.pwdCaseNumber);
}

/** A new case's DOL case number: the one typed, or the step's when that box is empty. */
export function dolCaseNumberOnCreate(n: CaseNumbers): string | undefined {
  const typed = typeof n.caseNumber === "string" ? n.caseNumber.trim() : "";
  if (typed) return typed;
  return stepDolNumber(n) ?? undefined;
}

/**
 * The DOL case number after an edit, or null to leave it as the edit has it. `before` is the stored case, `after` the
 * case with the edit applied. A DOL case number the edit itself changed to another number is the person's choice and is
 * kept; otherwise, while the stored one followed the steps, it moves to the step's number.
 */
export function dolCaseNumberOnUpdate(before: CaseNumbers, after: CaseNumbers): string | null {
  const ownAfter = dolNumberKey(after.caseNumber);
  const typedNew = ownAfter !== "" && ownAfter !== dolNumberKey(before.caseNumber);
  if (typedNew) return null;
  if (!followsTheSteps(before) && ownAfter !== "") return null;
  const step = stepDolNumber(after);
  if (!step || dolNumberKey(step) === ownAfter) return null;
  return step;
}

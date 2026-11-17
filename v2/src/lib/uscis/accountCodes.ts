/**
 * What is known about each code a USCIS online account shows on a case's updates, for the account reader and the
 * silent-updates guide. USCIS publishes no meanings for these codes, so each carries where its reading comes from:
 *
 * - "documented": the code and its wording appear in USCIS's CLAIMS 3 user manual (2008) or DHS's NIEM data standard,
 *   quoted as written. That the account shows these same codes is an inference: the letters match, and nobody at
 *   USCIS says so.
 * - "reported": in neither government list; the reading is what filers consistently report around it.
 * - "unknown": filers name it, and there's no settled reading.
 *
 * One entry for each code the timeline form offers (ACCOUNT_CODES), in its order; a test holds the two together.
 * From research of Nov 11 2026 (posts counted over 200,582 posts in 18 forums; the manual and NIEM read line by
 * line). A code is never a decision: USCIS decides a case in a notice.
 */

export type CodeEvidence = "documented" | "reported" | "unknown";

export interface AccountCodeInfo {
  code: string;
  /** A few words for a list of updates, where the full reading would repeat on every line. */
  short: string;
  evidence: CodeEvidence;
  /** The government list's own wording, as written, when the code is in one. */
  government: string | null;
  /** Where that wording comes from. */
  source: "CLAIMS 3 manual and NIEM" | "NIEM" | null;
  /** What filers report around it, in plain words. */
  filers: string;
  /** A caution a reader should see beside it. */
  caution?: string;
}

export const ACCOUNT_CODE_INFO: readonly AccountCodeInfo[] = [
  {
    code: "FTA0",
    short: "Database checks received",
    evidence: "documented",
    government: "DATABASE CHECKS RECEIVED",
    source: "CLAIMS 3 manual and NIEM",
    filers: "Often shows within hours of a biometrics appointment, and again later. Filers read it as background or database checks coming back.",
    caution: "It doesn't say which check, or whether the result was clear. A third FTA0 isn't a sign that approval is close.",
  },
  {
    code: "FTA1",
    short: "No settled reading",
    evidence: "unknown",
    government: null,
    source: null,
    filers: "Readings split: active review, a step around an interview, or a supervisor's look. Some saw an evidence request follow it.",
  },
  {
    code: "H008",
    short: "Filers see it near an approval",
    evidence: "reported",
    government: null,
    source: null,
    filers: "Filers see it within about a day of an approval notice.",
    caution: "On July 22 and 23, 2026 a USCIS fault wrote it on cases that weren't approved. Wait for the notice.",
  },
  {
    code: "IAF",
    short: "Receipt letter emailed",
    evidence: "documented",
    government: "RECEIPT LETTER EMAILED",
    source: "NIEM",
    filers: "The case was received. Some see a second IAF months later.",
  },
  {
    code: "FJ",
    short: "Interview scheduled",
    evidence: "documented",
    government: "INTERVIEW SCHEDULED/NOTICE ORDERED",
    source: "CLAIMS 3 manual and NIEM",
    filers: "An interview was scheduled.",
  },
  {
    code: "HA",
    short: "Evidence response received",
    evidence: "documented",
    government: "RESPONSE TO REQUEST NOTICE TO APPLICATION/PETITION RECEIVED",
    source: "CLAIMS 3 manual and NIEM",
    filers: "A response to an evidence request was received.",
  },
  {
    code: "IKA",
    short: "Filers: evidence request sent",
    evidence: "reported",
    government: null,
    source: null,
    filers: "A request for evidence was sent.",
  },
  {
    code: "LDA",
    short: "Card produced",
    evidence: "documented",
    government: "CARD PRODUCED",
    source: "CLAIMS 3 manual and NIEM",
    filers: "A card was produced.",
  },
  {
    code: "IMAG",
    short: "Filers: biometrics scheduled",
    evidence: "reported",
    government: null,
    source: null,
    filers: "A biometrics appointment was scheduled.",
  },
  {
    code: "SA",
    short: "Filers: read as an approval",
    evidence: "reported",
    government: null,
    source: null,
    filers: "Read as an approval, from filers' before-and-after reports.",
  },
  {
    code: "IK",
    short: "Evidence request sent",
    evidence: "documented",
    government: "REQUEST FOR ADDITIONAL EVIDENCE SENT",
    source: "CLAIMS 3 manual and NIEM",
    filers: "A request for evidence was sent.",
  },
  {
    code: "IK1",
    short: "No settled reading",
    evidence: "unknown",
    government: null,
    source: null,
    filers: "Seen in filers' screenshots, with no settled reading yet.",
  },
  {
    code: "IP",
    short: "Transfer notice sent",
    evidence: "documented",
    government: "TRANSFER NOTICE SENT",
    source: "CLAIMS 3 manual and NIEM",
    filers: "The case moved to another office.",
  },
  {
    code: "BB",
    short: "Moved to a new office",
    evidence: "documented",
    government: "RELOCATED TO NEW JURISDICTION",
    source: "CLAIMS 3 manual and NIEM",
    filers: "The case moved to another office.",
  },
  {
    code: "IEA",
    short: "Approval notice sent",
    evidence: "documented",
    government: "APPROVAL NOTICE SENT",
    source: "CLAIMS 3 manual and NIEM",
    filers: "An approval notice was sent.",
  },
  {
    code: "MBC",
    short: "Travel document produced",
    evidence: "documented",
    government: "ADVANCE PAROLE DOCUMENT PRODUCED",
    source: "CLAIMS 3 manual and NIEM",
    filers: "A travel document was produced.",
  },
];

/** How each kind of evidence is introduced beside a code. */
export const EVIDENCE_WORDS: Record<CodeEvidence, string> = {
  documented: "In USCIS's own code list:",
  reported: "Not in USCIS's lists. Filers report:",
  unknown: "No settled reading. Filers report:",
};

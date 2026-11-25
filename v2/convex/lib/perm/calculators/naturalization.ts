import { addDays, addYears, format, isValid, parseISO } from "date-fns";

/**
 * The first day a green card holder can file the N-400, read on Nov 25 2026 from:
 *
 *  - INA 334(a), 8 U.S.C. 1445(a): an applicant held to the continuous residence of INA 316(a) (five years) or 319(a)
 *    (three years, married to a citizen) may file "up to 3 months before the date the applicant would first otherwise
 *    meet such continuous residence requirement."
 *  - 8 CFR 334.2(b) (eCFR, current to Nov 23 2026) says 90 days, and the USCIS Policy Manual counts 90 calendar days:
 *    "counting back 90 days from the day before the alien would have first satisfied the continuous residence
 *    requirement", so residence first complete on June 10, 2010 opens filing on March 12, 2010 (12 USCIS-PM D.6(D),
 *    and G.3(E) for spouses, current as of Nov 20 2026). The statute's three months and the regulation's 90 days can
 *    differ by a day or two; USCIS counts the 90 days, and so does this.
 *  - The residence is first complete on the anniversary of the day the card says "Resident since": five years on
 *    (INA 316(a)) or three (INA 319(a)).
 *  - On the three-year path the early filing covers the residence only: "All other requirements for naturalization
 *    must be met at the time of filing" (12 USCIS-PM G.3(E)), and they include three years of living in marital union
 *    with a spouse who was a citizen for all three (G.3(A)). So the first day is the later of the two.
 *
 * Not settled by any of them: the anniversary of February 29 in a year without one. This counts it on March 1, the
 * later day, so the date given is never early, and the result says when it did.
 *
 * Arithmetic only. Physical presence, time abroad and good moral character are findings for USCIS.
 */

export const N400_EARLY_FILING_DAYS = 90;

/** The continuous residence each path needs: five years, or three when married to a citizen. */
export const NATURALIZATION_RESIDENCE_YEARS = { five: 5, three: 3 } as const;
export type NaturalizationPath = keyof typeof NATURALIZATION_RESIDENCE_YEARS;

export interface N400EarlyFilingInput {
  /** The "Resident since" date on the green card. */
  residentSince: string;
  path: NaturalizationPath;
  /** The three-year path: the wedding day. */
  marriedOn?: string;
  /** The three-year path: the day the spouse became a citizen, when that came after the wedding. */
  spouseCitizenSince?: string;
}

export interface N400EarlyFilingResult {
  /** The day the continuous residence is first complete: the anniversary of "Resident since". */
  residenceComplete: string;
  /** 90 days before it: the first day the residence allows filing. */
  earlyFilingOpens: string;
  /** The three-year path with a wedding date: the day three years married to a citizen are complete. */
  marriageComplete: string | null;
  /** The first day to file: the later of the two. */
  earliest: string;
  /** The marriage's three years, not the residence, set the day. */
  setByMarriage: boolean;
  /** An anniversary of February 29 fell in a year without one and was counted on March 1. */
  leapDay: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => format(d, "yyyy-MM-dd");

function day(name: string, v: string): Date {
  const d = parseISO(v);
  if (!DATE_RE.test(v) || !isValid(d) || iso(d) !== v) throw new Error(`${name}: expected a real date as YYYY-MM-DD, got ${JSON.stringify(v)}`);
  return d;
}

/** The anniversary `years` on, with a February 29 that has none counted on March 1 (the later day). */
function anniversary(d: Date, years: number): { at: Date; leapDay: boolean } {
  const at = addYears(d, years);
  const leapDay = d.getMonth() === 1 && d.getDate() === 29 && at.getDate() !== 29;
  return { at: leapDay ? addDays(at, 1) : at, leapDay };
}

export function n400EarliestFiling(input: N400EarlyFilingInput): N400EarlyFilingResult {
  const since = day("residentSince", input.residentSince);
  const residence = anniversary(since, NATURALIZATION_RESIDENCE_YEARS[input.path]);
  const earlyFilingOpens = iso(addDays(residence.at, -N400_EARLY_FILING_DAYS));

  let marriageComplete: string | null = null;
  let leapDay = residence.leapDay;
  if (input.path === "three" && input.marriedOn) {
    const married = day("marriedOn", input.marriedOn);
    const citizen = input.spouseCitizenSince ? day("spouseCitizenSince", input.spouseCitizenSince) : null;
    // The three years count from whichever came later: the wedding, or the spouse's citizenship.
    const unionStart = citizen && citizen > married ? citizen : married;
    const union = anniversary(unionStart, NATURALIZATION_RESIDENCE_YEARS.three);
    marriageComplete = iso(union.at);
    leapDay = leapDay || union.leapDay;
  }

  const setByMarriage = marriageComplete !== null && marriageComplete > earlyFilingOpens;
  return {
    residenceComplete: iso(residence.at),
    earlyFilingOpens,
    marriageComplete,
    earliest: setByMarriage ? marriageComplete! : earlyFilingOpens,
    setByMarriage,
    leapDay,
  };
}

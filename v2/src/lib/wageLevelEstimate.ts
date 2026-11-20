/**
 * Which of DOL's four prevailing wage levels a job is likely to get, by DOL's own method: the Prevailing Wage
 * Determination Policy Guidance (revised November 2009, pp. 6-13), which DOL says its National Prevailing Wage Center
 * still applies (dol.gov "Prevailing Wage Information and Resources", read Nov 20 2026; 91 FR 15459).
 *
 * Every job starts at Level I. Points are added for experience past the start of the occupation's O*NET Job Zone
 * range, for a degree above the occupation's usual one, for a foreign language, for supervising (outside supervisory
 * occupations), and, where DOL's own decisions show it, for required travel. The sum is capped at Level IV.
 *
 * AN ESTIMATE, AND SAID SO. DOL's guidance itself says the process "should not be implemented in an automated
 * fashion": NPWC reads the job's duties, which DOL never publishes. This code, run on 68,116 of DOL's own PERM
 * determinations (issued April to September 2026, from its FY2026 disclosure file, alternative requirements left out,
 * rules fixed before scoring), gave the exact level 83.7% of the time and a level within one 98.8% of the time
 * (ESTIMATE_ACCURACY below; measured Nov 20 2026 with the 2026-27 occupation table).
 *
 * The occupation's Job Zone, usual education and professional status are DOL's own yearly table ("Appendix A, Job
 * Zone, and Education", inside each OFLC wage file; `oflc_occupation_basis`), never typed here.
 */

export type Degree = "none" | "high-school" | "associate" | "bachelor" | "master" | "doctorate";

/** The order DOL compares degrees in (Form ETA-9141, F.b.1). */
const RANK: Record<Degree, number> = { none: 0, "high-school": 1, associate: 2, bachelor: 3, master: 4, doctorate: 5 };

export const DEGREE_LABELS: Record<Degree, string> = {
  none: "None",
  "high-school": "High school or equivalent",
  associate: "Associate's degree",
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  doctorate: "Doctorate or professional degree (PhD, JD, MD)",
};

/** DOL's education labels in its yearly table, read as a degree. Null for a label it hasn't used before. */
export function degreeOf(label: string | null | undefined): Degree | null {
  const l = (label ?? "").trim().toLowerCase();
  if (!l) return null;
  if (l === "none" || l.startsWith("no formal")) return "none";
  if (l.startsWith("high school") || l.startsWith("postsecondary nondegree") || l.startsWith("some college")) return "high-school";
  if (l.startsWith("associate")) return "associate";
  if (l.startsWith("bachelor")) return "bachelor";
  if (l.startsWith("master")) return "master";
  if (l.startsWith("doctoral") || l.startsWith("doctorate") || l.includes("professional degree")) return "doctorate";
  return null;
}

export interface Occupation {
  soc: string;
  onetCode: string;
  title: string;
  jobZone: 1 | 2 | 3 | 4 | 5;
  /** The occupation's usual education in DOL's table. */
  education: Degree;
  /** On DOL's Appendix A list of professional occupations. */
  appendixA: boolean;
}

export interface Requirements {
  degree: Degree;
  /** Months of experience the job requires (Form ETA-9141, F.b.4). */
  experienceMonths: number;
  foreignLanguage: boolean;
  license: boolean;
  otherSkills: boolean;
  supervises: boolean;
  travel: boolean;
}

export interface LevelStep {
  step: "start" | "experience" | "education" | "language" | "license" | "skills" | "supervision" | "travel";
  points: number;
  /** What the step found, in a reader's words. */
  note: string;
  /** False where NPWC often decides otherwise after reading the duties (a "may" step). */
  firm: boolean;
}

export interface LevelEstimate {
  level: 1 | 2 | 3 | 4;
  /** The uncapped sum. */
  points: number;
  steps: LevelStep[];
  /** A step that adds nothing here but may add a level once NPWC reads the duties. */
  mayBeHigher: boolean;
  /** The alternative requirements' own estimate (Form ETA-9141, F.c), when given. */
  alternative?: { level: 1 | 2 | 3 | 4; points: number; steps: LevelStep[] };
  /** The level whose wage governs: the higher of the two (form instructions p. 7). */
  governing: 1 | 2 | 3 | 4;
}

/** How the steps did on DOL's own decisions (the held-out test described above). */
export const ESTIMATE_ACCURACY = { exact: 0.837, withinOne: 0.988, tested: 68116, period: "April to September 2026" } as const;

/**
 * Experience bands by Job Zone, in months: up to the first bound adds nothing, up to the second 1, up to the third 2,
 * anything above 3. The halves of each zone's SVP range (2009 guidance p. 10, Appendix E), the bands DOL's FY2026
 * determinations follow. Job Zone 1's first bound is zero: any experience past a short demonstration counts.
 */
const EXPERIENCE_BANDS: Record<1 | 2 | 3 | 4 | 5, readonly [number, number, number]> = {
  1: [0, 1, 3],
  2: [3, 7, 12],
  3: [12, 18, 24],
  4: [24, 36, 48],
  5: [48, 84, 120],
};

const ZONE_RANGE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "a short demonstration up to 3 months",
  2: "over 3 months up to 1 year",
  3: "over 1 year up to 2 years",
  4: "over 2 years up to 4 years",
  5: "over 4 years up to 10 years",
};

/** Occupations where a foreign language is the job itself (2009 guidance p. 12). */
const LANGUAGE_IS_THE_JOB = new Set(["25-1124", "27-3091", "23-2093", "27-3092"]);

/** Management occupations and first-line supervisors, where supervising is the occupation's own work (p. 13). */
function supervisingIsTheJob(soc: string): boolean {
  return soc.startsWith("11-") || /^(3[3-9]|4\d|5[0-3])-10/.test(soc);
}

const months = (n: number) => (n % 12 === 0 && n > 0 ? `${n / 12} ${n === 12 ? "year" : "years"}` : `${n} ${n === 1 ? "month" : "months"}`);

function score(o: Occupation, r: Pick<Requirements, "degree" | "experienceMonths"> & Partial<Requirements>): { points: number; steps: LevelStep[]; mayBeHigher: boolean } {
  if (!Number.isFinite(r.experienceMonths) || r.experienceMonths < 0 || r.experienceMonths > 600) {
    throw new RangeError(`experience must be 0 to 600 months, not ${r.experienceMonths}`);
  }
  const steps: LevelStep[] = [{ step: "start", points: 1, note: "Every job starts at Level I.", firm: true }];
  let mayBeHigher = false;

  const [start, low, high] = EXPERIENCE_BANDS[o.jobZone];
  const m = r.experienceMonths;
  const exp = m <= start ? 0 : m <= low ? 1 : m <= high ? 2 : 3;
  steps.push({
    step: "experience",
    points: exp,
    note:
      exp === 0
        ? `${m === 0 ? "No experience required" : `${months(m)} of experience`} is within the start of Job Zone ${o.jobZone}'s range (${ZONE_RANGE[o.jobZone]}).`
        : exp === 3
          ? `${months(m)} of experience is above Job Zone ${o.jobZone}'s range (${ZONE_RANGE[o.jobZone]}).`
          : `${months(m)} of experience is in the ${exp === 1 ? "low" : "high"} end of Job Zone ${o.jobZone}'s range (${ZONE_RANGE[o.jobZone]}).`,
    firm: true,
  });

  const above = RANK[r.degree] - RANK[o.education];
  const edu = above <= 0 ? 0 : above === 1 ? 1 : 2;
  steps.push({
    step: "education",
    points: edu,
    note:
      edu === 0
        ? `${DEGREE_LABELS[r.degree]} is no more than this occupation usually needs (${DEGREE_LABELS[o.education].toLowerCase()}).`
        : `${DEGREE_LABELS[r.degree]} is ${edu === 1 ? "one step" : "more than one step"} above what this occupation usually needs (${DEGREE_LABELS[o.education].toLowerCase()}).`,
    firm: true,
  });

  if (r.foreignLanguage) {
    const counts = !LANGUAGE_IS_THE_JOB.has(o.soc);
    steps.push({
      step: "language",
      points: counts ? 1 : 0,
      note: counts ? "A foreign language usually counts as a special skill." : "A foreign language is this occupation's own work, so it adds nothing.",
      firm: counts ? false : true,
    });
  }
  if (r.license) {
    steps.push({ step: "license", points: 0, note: "A license on its own adds nothing when the job needs it at entry level.", firm: true });
  }
  if (r.otherSkills) {
    mayBeHigher = true;
    steps.push({ step: "skills", points: 0, note: "Other special skills add a level only when DOL reads them as beyond entry level, which it decides from the duties.", firm: false });
  }
  if (r.supervises) {
    const counts = !supervisingIsTheJob(o.soc);
    steps.push({
      step: "supervision",
      points: counts ? 1 : 0,
      note: counts ? "Supervising others usually adds a level." : "Supervising is this occupation's own work, so it adds nothing.",
      firm: !counts,
    });
  }
  if (r.travel) {
    const counts = o.jobZone === 3 || o.jobZone === 4;
    if (!counts) mayBeHigher = true;
    steps.push({
      step: "travel",
      points: counts ? 1 : 0,
      note: counts
        ? "Required travel isn't in DOL's written steps, but in its own decisions it adds a level for jobs like this."
        : "Required travel sometimes adds a level in DOL's own decisions, though rarely for jobs in this Job Zone.",
      firm: false,
    });
  }
  return { points: steps.reduce((n, s) => n + s.points, 0), steps, mayBeHigher };
}

const cap = (points: number) => Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4;

export function estimateLevel(
  o: Occupation,
  r: Requirements,
  alternative?: Pick<Requirements, "degree" | "experienceMonths">,
): LevelEstimate {
  const main = score(o, r);
  const level = cap(main.points);
  const out: LevelEstimate = { level, points: main.points, steps: main.steps, mayBeHigher: main.mayBeHigher || main.steps.some((s) => !s.firm && s.points > 0), governing: level };
  if (alternative) {
    // The alternative requirements are levelled on their own, with the same skills, supervision and travel.
    const alt = score(o, { ...r, ...alternative });
    out.alternative = { level: cap(alt.points), points: alt.points, steps: alt.steps };
    out.governing = Math.max(level, cap(alt.points)) as 1 | 2 | 3 | 4;
  }
  return out;
}

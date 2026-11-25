/**
 * What a sandbox key (pt_test_) gets: fixed sample answers, in the same shape
 * as the live ones, for building and testing against without touching the
 * live records or spending an allowance.
 *
 * NOTHING HERE IS A REAL RECORD. The case numbers carry day 000, a day DOL's
 * numbering never issues, so a sample can't be mistaken for somebody's case;
 * the employers and law firm are made up. Every answer's `meta.source` says
 * it's sample data. A request the samples don't cover answers 404 and names
 * the samples that exist.
 *
 * Pure and synchronous: no database, no Convex, no network.
 */
import type { ReadResult } from "./reads";

export const SANDBOX_SOURCE = "PERM Tracker sandbox: fixed sample data for building and testing, not a real record";
const AS_OF = "2026-10-01";
const SITE = "https://permtracker.app";

const meta = (url: string, asOf: string | null = AS_OF) => ({ source: SANDBOX_SOURCE, asOf, url: `${SITE}${url}` });

/** The sample cases, by number: one pending PERM case, one decided, a wage request and an LCA. */
export const SANDBOX_CASES: Record<string, Record<string, unknown>> = {
  "G-100-26000-000101": {
    caseNumber: "G-100-26000-000101",
    program: "perm",
    programName: "PERM labor certification",
    status: "ANALYST REVIEW",
    isFinal: false,
    filingDate: "2026-02-10",
    employer: "Example Robotics LLC",
    jobTitle: "Software Engineer",
    statusCheckedOn: AS_OF,
    decision: null,
    queue: {
      filingMonth: "2026-02",
      casesFiledThatMonth: 9_800,
      decidedFromThatMonth: 410,
      pendingFromThatMonth: 9_390,
      pendingFromEarlierMonths: 31_200,
    },
  },
  "G-100-26000-000102": {
    caseNumber: "G-100-26000-000102",
    program: "perm",
    programName: "PERM labor certification",
    status: "CERTIFIED",
    isFinal: true,
    filingDate: "2025-06-02",
    employer: "Example Robotics LLC",
    jobTitle: "Data Scientist",
    statusCheckedOn: AS_OF,
    decision: {
      status: "Certified",
      receivedDate: "2025-06-02",
      decisionDate: "2026-04-14",
      daysToDecision: 316,
      occupation: "Data Scientists",
      worksiteState: "CA",
      offeredWage: 165_000,
    },
    queue: null,
  },
  "P-100-26000-000103": {
    caseNumber: "P-100-26000-000103",
    program: "pwd",
    programName: "prevailing wage determination",
    status: "IN PROCESS",
    isFinal: false,
    filingDate: "2026-08-20",
    employer: "Example Robotics LLC",
    jobTitle: "Software Engineer",
    statusCheckedOn: AS_OF,
    decision: null,
    queue: null,
  },
  "I-200-26000-000104": {
    caseNumber: "I-200-26000-000104",
    program: "lca",
    programName: "H-1B labor condition application",
    status: "CERTIFIED",
    isFinal: true,
    filingDate: "2026-03-03",
    employer: "Sample Analytics Inc.",
    jobTitle: "Machine Learning Engineer",
    statusCheckedOn: AS_OF,
    decision: {
      status: "Certified",
      receivedDate: "2026-03-03",
      decisionDate: "2026-03-10",
      occupation: "Software Developers",
      occupationCode: "15-1252",
      wage: 148_000,
      wageUnit: "Year",
      worksiteState: "WA",
      visaClass: "H-1B",
      lawFirm: "Sample & Partners LLP",
    },
    queue: null,
  },
};

const ENTITIES = {
  employer: [
    {
      kind: "employer",
      slug: "example-robotics-llc",
      name: "Example Robotics LLC",
      rankByVolume: 1_204,
      publishedCases: 86,
      certified: 81,
      denied: 2,
      certifiedShare: 0.976,
      medianDaysToDecision: 312,
      filingsLast12Months: 22,
      url: `${SITE}/perm-employers/example-robotics-llc`,
    },
    {
      kind: "employer",
      slug: "sample-analytics-inc",
      name: "Sample Analytics Inc.",
      rankByVolume: 3_870,
      publishedCases: 19,
      certified: 18,
      denied: 0,
      certifiedShare: 1,
      medianDaysToDecision: 298,
      filingsLast12Months: 5,
      url: `${SITE}/perm-employers/sample-analytics-inc`,
    },
  ],
  attorney: [
    {
      kind: "attorney",
      slug: "sample-partners-llp",
      name: "Sample & Partners LLP",
      rankByVolume: 412,
      publishedCases: 640,
      certified: 598,
      denied: 11,
      certifiedShare: 0.982,
      medianDaysToDecision: 305,
      state: "NY",
      filingsLast12Months: 140,
      url: `${SITE}/perm-attorneys/sample-partners-llp`,
    },
  ],
  occupation: [
    {
      kind: "occupation",
      slug: "software-developers",
      name: "Software Developers",
      rankByVolume: 1,
      publishedCases: 50_000,
      certified: 48_900,
      denied: 600,
      certifiedShare: 0.988,
      medianDaysToDecision: 301,
      occupationCode: "15-1252",
      medianAnnualWage: 152_000,
      filingsLast12Months: 14_000,
      url: `${SITE}/perm-wages/software-developers`,
    },
  ],
} as const;

const KIND_BY_SEGMENT: Record<string, keyof typeof ENTITIES> = {
  employers: "employer",
  "law-firms": "attorney",
  occupations: "occupation",
};
const PAGE_BY_KIND: Record<keyof typeof ENTITIES, string> = {
  employer: "/perm-employers",
  attorney: "/perm-attorneys",
  occupation: "/perm-wages",
};

const notInSandbox = (message: string): ReadResult<never> => ({ ok: false, status: 404, code: "not_found", message });

export const SANDBOX_CASE_NUMBERS = Object.keys(SANDBOX_CASES);

/** One sample case, or a 404 naming the ones that exist. */
export function sandboxCase(input: string, opts: { live?: boolean } = {}): ReadResult<Record<string, unknown>> {
  const n = input.trim().toUpperCase();
  const c = SANDBOX_CASES[n];
  if (!c) {
    return notInSandbox(
      `The sandbox holds four sample cases: ${SANDBOX_CASE_NUMBERS.join(", ")}. A live key looks up any real case.`,
    );
  }
  return {
    ok: true,
    data: opts.live ? { ...c, askedDolLive: true } : c,
    meta: meta(`/perm-case-status?case=${encodeURIComponent(n)}`),
  };
}

/** Sample search results for a kind, matched by a case-insensitive substring. */
export function sandboxSearch(kind: keyof typeof ENTITIES, q: string): ReadResult<Record<string, unknown>> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2 || needle.length > 120) {
    return { ok: false, status: 400, code: "bad_request", message: "Search with 2 to 120 characters." };
  }
  const results = ENTITIES[kind].filter((e) => e.name.toLowerCase().includes(needle));
  return { ok: true, data: { results, more: false }, meta: meta(`${PAGE_BY_KIND[kind]}?q=${encodeURIComponent(needle)}`) };
}

/** Every sample record of a kind, for a sandbox export. */
export function sandboxEntities(kind: keyof typeof ENTITIES): readonly Record<string, unknown>[] {
  return ENTITIES[kind];
}

function sandboxEntity(kind: keyof typeof ENTITIES, slug: string): ReadResult<Record<string, unknown>> {
  const e = ENTITIES[kind].find((x) => x.slug === slug);
  if (!e) {
    return notInSandbox(`The sandbox's sample ${kind === "attorney" ? "law firms" : `${kind}s`} are: ${ENTITIES[kind].map((x) => x.slug).join(", ")}.`);
  }
  return {
    ok: true,
    data: {
      ...e,
      pendingNow: { pending: 12, casesTracked: 98, byStatus: [{ status: "ANALYST REVIEW", cases: 12 }], oldestPendingFiled: "2025-11-04", asOf: AS_OF },
    },
    meta: meta(`${PAGE_BY_KIND[kind]}/${slug}`),
  };
}

const SAMPLE_QUEUE = {
  perm: {
    asOf: AS_OF,
    decidingNow: { month: "2026-02", asOf: AS_OF, source: "PERM Tracker's daily check of DOL's case status" },
    oldestOpenMonth: "2026-01",
    queues: [{ queue: "Analyst Review", workingOnMonth: "2025-12", asPrinted: "December 2025" }],
    averageDays: [{ determination: "Analyst Review", month: null, period: "Last 30 Days", calendarDays: 470 }],
  },
  prevailingWage: {
    asOf: AS_OF,
    queues: [{ program: "PERM", oewsReceiptDate: "2026-07", nonOewsReceiptDate: "2026-06" }],
    permRequestsPending: [
      { receiptMonth: "2026-08", remainingRequests: 9_400 },
      { receiptMonth: "2026-09", remainingRequests: 11_600 },
    ],
  },
  pendingPermByFilingMonth: [
    { month: "2026-01", filed: 10_100, decided: 900, pending: 9_200, inAnalystReview: 9_050 },
    { month: "2026-02", filed: 9_800, decided: 410, pending: 9_390, inAnalystReview: 9_300 },
  ],
};

const SAMPLE_BULLETIN = {
  month: "2026-10",
  cells: "As printed: a date like 15JAN13, C (current: every priority date may proceed) or U (unavailable).",
  employment: {
    finalAction: { EB2: { "ALL CHARGEABILITY AREAS EXCEPT THOSE LISTED": "01APR24", INDIA: "01JAN13" } },
    datesForFiling: { EB2: { "ALL CHARGEABILITY AREAS EXCEPT THOSE LISTED": "01OCT24", INDIA: "01JUN13" } },
  },
  family: { finalAction: null, datesForFiling: null },
  sourceUrl: "https://travel.state.gov/",
};

/** The finder's sample: the pending sample case, found by its employer and filing day. */
const SAMPLE_FOUND = {
  program: "perm",
  programName: "PERM labor certification",
  readBy: "window",
  window: { from: "2026-02-10", to: "2026-02-10", assumed: false },
  filed: "2026-02-10",
  period: { filed: 412, decided: 18, waiting: 394 },
  day: { filed: 412, decided: 18, waiting: 394 },
  matchedEmployer: 1,
  matched: 1,
  cases: [
    {
      caseNumber: "G-100-26000-000101",
      status: "ANALYST REVIEW",
      isFinal: false,
      employer: "Example Robotics LLC",
      jobTitle: "Software Engineer",
      filedOn: "2026-02-10",
      decisionDate: null,
      worksiteState: null,
      wageRequest: null,
      lawFirm: null,
      url: `${SITE}/perm-case-status?case=G-100-26000-000101`,
    },
  ],
  truncated: false,
  closeNames: [],
  lawFirm: null,
  lawFirmUnknown: false,
  decidedOnly: false,
  dayListCapped: false,
};

const SAMPLE_ESTIMATE = {
  kind: "date",
  filingDate: "2026-02-10",
  status: "ANALYST REVIEW",
  estimatedDate: "2026-12-04",
  earliest: "2026-11-27",
  latest: "2026-12-17",
  model: "Decision pace",
  basis: "Sample: cases ahead divided by DOL's measured pace.",
  pendingCasesAhead: 40_100,
  caveats: ["Sample data: the sandbox's estimate never changes."],
};

/* The figure answers (API 1.2). Every figure is made up; the blocks are numbers USCIS hasn't reached. */

const g = (count: number, share: number, low: number, high: number) => ({ count, estimated: count * 10, share, low, high });
const SAMPLE_GROUPS_I485 = {
  approved: g(12, 0.4, 0.24, 0.58),
  denied: g(0, 0, 0, 0.11),
  withdrawn: g(0, 0, 0, 0.11),
  closed: g(0, 0, 0, 0.11),
  revoked: g(0, 0, 0, 0.11),
  rfe: g(3, 0.1, 0.03, 0.26),
  waiting: g(15, 0.5, 0.33, 0.67),
};

const SAMPLE_RECEIPT_BLOCKS = {
  form: "I-485",
  forms: ["I-485", "I-765", "I-131"],
  approvalsSeenUpTo: "IOE00002",
  near: null,
  blocks: [
    { block: "IOE00001", counted: 30, approved: SAMPLE_GROUPS_I485.approved },
    { block: "IOE00002", counted: 30, approved: SAMPLE_GROUPS_I485.approved },
  ],
  casesInSample: 2_000,
};

const SAMPLE_RECEIPT_BLOCK = {
  block: "IOE00001",
  forms: [{ form: "I-485", counted: 30, groups: SAMPLE_GROUPS_I485 }],
  before: null,
  after: "IOE00002",
  recentMoves: [{ day: AS_OF, form: "I-485", movedTo: "approved", cases: 2 }],
  unreadable: [],
};

const SAMPLE_RECEIPT_MONTHS = {
  form: "I-485",
  forms: ["I-485", "I-765", "I-131"],
  months: [{ month: "2026-02", counted: 60, walked: false, approved: SAMPLE_GROUPS_I485.approved, rfe: SAMPLE_GROUPS_I485.rfe, waiting: SAMPLE_GROUPS_I485.waiting }],
};

const SAMPLE_I140 = {
  quarter: {
    fiscalQuarter: "FY2026 Q3",
    sourceFile: "sample.xlsx",
    subtypes: [{ code: "E21", label: "Professionals with Advanced Degrees", received: 10_000, approved: 9_000, denied: 500, pending: 40_000 }],
  },
  byQuarter: [
    { fiscalYear: 2026, quarter: 3, category: "E21", categoryLabel: "Professionals with Advanced Degrees", received: 10_000, approved: 9_000, denied: 500, pending: 40_000 },
  ],
  medianMonths: { months: 6.5, title: "Immigrant Petition for Alien Worker", fiscalYear: 2026, quarter: 3, quarterEnd: "2026-06-30" },
  processingTimes: {
    postedOn: AS_OF,
    rows: [{ subtype: "E21", office: "SCD", months: 7, asPrinted: "7 Months", label: "Advanced degree", officeLabel: "Service Center Operations", inquiryFrom: "2026-01-01" }],
  },
  awaitingVisa: { month: "2026-06", sourceFile: "sample.xlsx", cells: [{ country: "TOTAL", category: "TOTAL", count: 1_000_000 }] },
  unreadable: [],
};

const sampleOffice = (code: string, office: string, state: string) => ({
  code,
  office,
  state,
  withheld: 0,
  employment: { received: 900, approved: 800, denied: 40, pending: 3_000, pendingLastQuarter: 3_200 },
  family: { received: 1_200, approved: 1_100, denied: 60, pending: 4_000 },
  all: { received: 2_130, approved: 1_923, denied: 103, pending: 7_080 },
});

const SAMPLE_I485 = {
  byOffice: {
    fiscalYear: 2026,
    quarter: 3,
    quarterEnd: "2026-06-30",
    sourceFile: "sample.xlsx",
    previousQuarter: { fiscalYear: 2026, quarter: 2 },
    total: sampleOffice("ALL", "Total", ""),
    offices: [sampleOffice("XSO", "Sample Field Office", "Sample State")],
  },
  inventory: {
    newest: { asOf: "2026-09-01", pending: 120_000, visaAvailable: 40_000, awaitingVisa: 80_000 },
    history: [{ asOf: "2026-09-01", pending: 120_000, visaAvailable: 40_000, awaitingVisa: 80_000 }],
  },
  medianMonths: { months: 8.2, title: "Employment-based adjustment applications", fiscalYear: 2026, quarter: 3, quarterEnd: "2026-06-30" },
  processingTimes: null,
  unreadable: [],
};

const sampleCell = (asPrinted: string, month: string | null, monthsBehind: number | null) => ({ asPrinted, month, monthsBehind });
const SAMPLE_POST = {
  slug: "sample-city",
  name: "Sample City",
  scheduling: {
    employment: sampleCell("Sep-2026", "2026-09", 0),
    family: sampleCell("Mar-2025", "2025-03", 18),
    immediate: sampleCell("Jun-2026", "2026-06", 3),
  },
  issuedLast12Months: 9_000,
  employmentLast12Months: 400,
  url: `${SITE}/consular-posts/sample-city`,
};

const SAMPLE_TIMELINES = {
  scope: "all",
  place: null,
  asOf: AS_OF,
  cases: 1_000,
  steps: [
    {
      id: "perm-decision",
      label: "PERM, filing to decision",
      stage: "perm",
      verified: false,
      cases: 120,
      windowDays: 183,
      medianDays: 480,
      p25Days: 450,
      p75Days: 510,
      before: { medianDays: 500, cases: 100 },
      allTime: 900,
      months: [{ month: "2026-09", cases: 20, medianDays: 478 }],
    },
  ],
  lastWeek: { from: "2026-09-24", through: "2026-09-30", steps: [{ id: "perm-decision", label: "PERM certified", count: 6 }] },
  waiting: { heardFromDays: 365, heard: 400, byStage: [{ id: "perm", label: "PERM", count: 150 }], lines: [], unlisted: 400 },
  i140: [],
  overview: { people: 900, inSeveral: 40, i140s: 300, sources: [{ name: "Sample source", cases: 900 }], offices: [] },
  unreadable: [],
};

const sampleGraded = { since: "2026-01-01", recorded: 400, graded: 200, typicalMissDays: 5, biasDays: 1, inRangeShare: 0.8, within14Share: 0.9, overdue: 10, missAtLeastDays: 6 };
const SAMPLE_ACCURACY = {
  checks: [{ key: "perm-line", estimate: "When DOL decides a PERM case waiting in its line", result: "5 days typically", basis: "Sample: the sandbox's check never changes." }],
  permBacktest: { from: "2026-09-01", to: AS_OF, decided: 1_000, typicalMissDays: 5, within7Share: 0.7, decidedByEndRight: 0.9 },
  dailySample: { perm: sampleGraded, pwd: null },
  unreadable: [],
};

function sandboxFigures(head: string | undefined, second: string | undefined, params: Record<string, string>): ReadResult<unknown> | null {
  if (head === "uscis" && second === "receipt-blocks") {
    if (!params.block) return { ok: true, data: SAMPLE_RECEIPT_BLOCKS, meta: meta("/uscis-receipt-blocks") };
    return params.block.toUpperCase() === SAMPLE_RECEIPT_BLOCK.block
      ? { ok: true, data: SAMPLE_RECEIPT_BLOCK, meta: meta(`/uscis-receipt-blocks/${SAMPLE_RECEIPT_BLOCK.block}`) }
      : notInSandbox(`The sandbox's sample block is ${SAMPLE_RECEIPT_BLOCK.block}.`);
  }
  if (head === "uscis" && second === "receipt-months") return { ok: true, data: SAMPLE_RECEIPT_MONTHS, meta: meta("/uscis-receipt-blocks") };
  if (head === "uscis" && second === "i140") return { ok: true, data: SAMPLE_I140, meta: meta("/tools/i140-trends", null) };
  if (head === "uscis" && second === "i485") return { ok: true, data: SAMPLE_I485, meta: meta("/i485-by-field-office", null) };
  if (head === "consulates" && !params.slug) {
    return { ok: true, data: { asOf: AS_OF, issuedFrom: "2025-09", issuedTo: "2026-08", posts: [SAMPLE_POST] }, meta: meta("/consular-posts") };
  }
  if (head === "consulates") {
    return params.slug === SAMPLE_POST.slug
      ? {
          ok: true,
          data: {
            ...SAMPLE_POST,
            history: [{ asOf: AS_OF, ...SAMPLE_POST.scheduling }],
            monthlyIssuances: [{ month: "2026-08", byCategory: { "EB-2": 30, "EB-3": 10 } }],
          },
          meta: meta(`/consular-posts/${SAMPLE_POST.slug}`),
        }
      : notInSandbox(`The sandbox's sample consulate is ${SAMPLE_POST.slug}.`);
  }
  if (head === "timelines") return { ok: true, data: SAMPLE_TIMELINES, meta: meta("/green-card-timelines") };
  if (head === "accuracy") return { ok: true, data: SAMPLE_ACCURACY, meta: meta("/estimate-scorecard") };
  return null;
}

/**
 * The sandbox's answer for a /v1 read, by its path (`/v1/...`). Paths the
 * samples don't cover answer 404 saying so, never a live read.
 */
export function sandboxAnswer(url: URL, params: Record<string, string>): ReadResult<unknown> {
  const parts = url.pathname.replace(/^\/v1\/?/, "").split("/").filter(Boolean);
  const [head, second] = parts;
  if (head === "cases" && params.caseNumber) {
    return sandboxCase(params.caseNumber, { live: url.searchParams.get("live") === "1" });
  }
  if (head === "cases") return { ok: true, data: SAMPLE_FOUND, meta: meta("/perm-queue/2026-02/10") };
  if (head === "queue") return { ok: true, data: SAMPLE_QUEUE, meta: meta("/perm-processing-times") };
  if (head === "visa-bulletin") return { ok: true, data: SAMPLE_BULLETIN, meta: meta("/visa-bulletin/2026-10", "2026-10-01") };
  if (head === "estimate") return { ok: true, data: SAMPLE_ESTIMATE, meta: meta("/tools/perm-timeline-calculator") };
  const figures = sandboxFigures(head, second, params);
  if (figures) return figures;
  const kind = head ? KIND_BY_SEGMENT[head] : undefined;
  if (kind) {
    return second ? sandboxEntity(kind, params.slug ?? second) : sandboxSearch(kind, url.searchParams.get("q") ?? "");
  }
  return notInSandbox("The sandbox has no sample answer for this address. The samples: https://permtracker.app/developers#sandbox");
}

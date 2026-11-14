/**
 * The shape of every answer the API gives, one schema per answer.
 *
 * ONE DEFINITION, FOUR READERS. The OpenAPI document publishes these as its
 * response schemas, the MCP server advertises the same ones as each tool's
 * structured output, the tests check every sample and example against them,
 * and the SDKs' types are held to the same field names. So a field can't be in
 * the docs and missing from an answer, or the other way round.
 *
 * Objects are open (`looseObject`): DOL's own records differ by program and
 * gain fields over time, and a client must not break when an answer carries a
 * field it doesn't know. Every field NAMED here is promised: its name and type
 * won't change inside version 1.
 *
 * Pure: no database, no network, no server-only import. The docs page, the
 * spec route and the tests all read it.
 */
import { z } from "zod";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** A calendar day, `YYYY-MM-DD`. */
const day = (what: string) => z.string().regex(DAY_RE).describe(`${what}, as YYYY-MM-DD.`);
/** A month, `YYYY-MM`. */
const month = (what: string) => z.string().regex(MONTH_RE).describe(`${what}, as YYYY-MM.`);

export const PROGRAMS = ["perm", "pwd", "lca", "seasonal"] as const;

const program = z
  .enum(PROGRAMS)
  .describe("Which DOL program the case belongs to: perm (PERM labor certification), pwd (prevailing wage request), lca (H-1B labor condition application) or seasonal (H-2A, H-2B or CW-1).");

/** Where an answer came from. Every 200 carries it beside `data`. */
export const MetaSchema = z
  .object({
    source: z.string().describe("Who published the underlying records, in words."),
    asOf: day("The date the data is true for").nullable().describe("The date the data is true for, as YYYY-MM-DD, or null when no single date applies."),
    url: z.string().describe("The page on permtracker.app that shows the same thing. Cite it."),
  })
  .describe("Where the answer came from: the publisher, the date it's true for, and the page that shows it.");

const queuePlace = z
  .object({
    filingMonth: month("The month the case was filed"),
    casesFiledThatMonth: z.number().int().describe("PERM cases filed in that month."),
    decidedFromThatMonth: z.number().int().describe("How many of them DOL has decided."),
    pendingFromThatMonth: z.number().int().describe("How many of them are still pending."),
    pendingFromEarlierMonths: z.number().int().describe("Pending PERM cases filed in earlier months, which DOL works first."),
  })
  .describe("PERM only: where the case's filing month stands in DOL's queue.");

export const CaseSchema = z
  .looseObject({
    caseNumber: z.string().describe("The case number as DOL prints it, e.g. G-100-26045-123456."),
    program,
    programName: z.string().describe("The program in words, e.g. PERM labor certification."),
    status: z.string().nullable().describe("DOL's status for the case, as DOL prints it, e.g. ANALYST REVIEW or CERTIFIED. Null when no record carries one."),
    isFinal: z.boolean().describe("True once DOL has decided the case or the employer withdrew it."),
    filingDate: day("The day the case was filed").nullable(),
    employer: z.string().nullable().describe("The employer's name as DOL holds it."),
    jobTitle: z.string().nullable().describe("The job title on the case."),
    statusCheckedOn: day("The day PERM Tracker last asked DOL about this case").nullable(),
    decision: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe("DOL's decided record, once a disclosure file carries the case: status, receivedDate, decisionDate, and by program the occupation, worksite, wage and law firm. Null while the case is pending."),
    accepted: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe("H-2A and H-2B only: the job as DOL accepted it (wage, workers, work period, worksite), before any decision."),
    queue: queuePlace.nullable(),
  })
  .describe("One DOL case: its status, dates, employer and job, DOL's decided record once there is one, and for a pending PERM case its place in the queue.");

const foundCase = z
  .looseObject({
    caseNumber: z.string().describe("The case number as DOL prints it."),
    status: z.string().nullable().describe("DOL's status for the case."),
    isFinal: z.boolean().describe("True once the case is decided or withdrawn."),
    employer: z.string().nullable().describe("The employer's name as DOL holds it."),
    jobTitle: z.string().nullable().describe("The job title on the case."),
    filedOn: day("The day the case was filed").nullable().optional(),
    decisionDate: day("The day DOL decided the case").nullable(),
    worksiteState: z.string().nullable().describe("The worksite's state, two letters, when DOL's record carries it."),
    wageRequest: z.unknown().nullable().describe("The prevailing wage request the case used, when it can be matched."),
    lawFirm: z.string().nullable().optional().describe("The law firm on the case. DOL names it only once the case is decided."),
    url: z.string().describe("The case's page on permtracker.app."),
  })
  .describe("One case in a search answer.");

const dayCounts = z
  .looseObject({
    filed: z.number().int().describe("Cases filed in the days read."),
    decided: z.number().int().describe("How many of them DOL has decided."),
    waiting: z.number().int().describe("How many are still waiting."),
  })
  .describe("What DOL's record holds for the days read, whatever was asked.");

export const CaseSearchSchema = z
  .looseObject({
    program,
    programName: z.string().describe("The program in words."),
    readBy: z.string().optional().describe("How the search read: window (every case filed in the days read) or index (the employer's or firm's cases over any dates)."),
    window: z.unknown().optional().describe("The days read: from, to, and assumed when no date was sent with a job title alone."),
    filed: day("The one filing day read, when the search was for a single day").optional(),
    period: dayCounts.nullable().optional(),
    day: dayCounts.nullable().optional().describe("The same as period, under its older name. Sent for a single-day search."),
    matchedEmployer: z.number().int().nullable().describe("Cases in the days read whose employer matched the name sent."),
    matched: z.number().int().describe("Cases that matched everything sent."),
    cases: z.array(foundCase).describe("The matching cases, 50 at most."),
    truncated: z.boolean().describe("True when more cases matched than the answer lists."),
    closeNames: z.array(z.unknown()).describe("With no employer fitting in a month or less: the employers that did file in those days under a close spelling."),
    lawFirm: z
      .looseObject({
        name: z.string().describe("The firm's name as DOL's files print it."),
        alternatives: z.array(z.string()).describe("Other firms the same words could mean."),
      })
      .nullable()
      .optional()
      .describe("The firm a law firm's words named, with the other firms they could mean."),
    lawFirmUnknown: z.boolean().optional().describe("True when a law firm was sent and no firm in the records matches it."),
    decidedOnly: z.boolean().optional().describe("True when a law firm was sent: DOL names a firm only at the decision, so no pending case can be listed."),
    dayListCapped: z.boolean().describe("True when a read stopped at its limit, so a case can be missing from this answer."),
  })
  .describe("Cases found without a case number, with what DOL's record holds for the days read.");

export const EstimateSchema = z
  .looseObject({
    kind: z
      .enum(["date", "no-date", "none", "decided"])
      .describe("date: an estimated day with a range. no-date: the case is past every model's reach, with a note. none: no model can give a defensible date. decided: the case already has a decision."),
    filingDate: day("The filing date the estimate is for").nullable().optional(),
    status: z.string().nullable().optional().describe("The status the estimate assumed, e.g. ANALYST REVIEW."),
    estimatedDate: day("The likeliest decision day").optional(),
    earliest: day("The early end of the range").optional(),
    latest: day("The late end of the range").optional(),
    model: z.string().optional().describe("The model that produced the estimate, by name."),
    basis: z.string().optional().describe("How the estimate was worked out, in a sentence."),
    pendingCasesAhead: z.number().int().nullable().optional().describe("Pending PERM cases filed before this one."),
    caveats: z.array(z.string()).optional().describe("What the estimate can't know. Show them with the date."),
    note: z.string().optional().describe("Why there is no date, for the no-date and none kinds."),
    waitedDays: z.number().int().optional().describe("Days the case has waited, for the no-date kind."),
    decisionDate: day("The day DOL decided the case, for the decided kind").nullable().optional(),
  })
  .describe("When a pending PERM case is likely to be decided. An estimate from DOL's own pace: it makes no promise.");

const printedQueue = z
  .looseObject({
    queue: z.string().describe("The queue's name as DOL printed it, e.g. Analyst Review."),
    workingOnMonth: z.string().nullable().describe("The filing month DOL printed for the queue, as YYYY-MM."),
    asPrinted: z.string().nullable().describe("The same month in the words DOL printed."),
  })
  .describe("One queue as DOL's processing times page printed it.");

export const QueueSchema = z
  .looseObject({
    perm: z
      .looseObject({
        asOf: z.string().nullable().describe("The day DOL's PERM processing times are dated."),
        decidingNow: z
          .looseObject({
            month: month("The filing month DOL is deciding"),
            asOf: z.string().describe("The day that reading was taken."),
            source: z.string().describe("Where the reading comes from."),
          })
          .nullable()
          .describe("The filing month DOL is deciding now, by PERM Tracker's daily check of case statuses. Null when it can't be read."),
        oldestOpenMonth: z.string().nullable().describe("The oldest filing month that still has pending cases, as YYYY-MM."),
        queues: z
          .array(printedQueue)
          .describe("The months DOL printed for its PERM queues. Empty since October 31, 2026, when DOL stopped printing a PERM month: decidingNow gives the month by our own check."),
        averageDays: z
          .array(
            z.looseObject({
              determination: z.string().describe("The kind of determination, e.g. Analyst Review."),
              month: z.string().nullable().describe("The month the average is for, when DOL gives one. Null when DOL gives a period."),
              period: z.string().nullable().optional().describe("The period the average covers, as DOL names it, e.g. Last 30 Days."),
              calendarDays: z.number().describe("Average calendar days to a decision."),
            }),
          )
          .describe("DOL's average days to a decision, by kind of determination."),
      })
      .describe("PERM processing times."),
    prevailingWage: z
      .looseObject({
        asOf: z.string().nullable().describe("The day DOL's prevailing wage processing times are dated."),
        queues: z
          .array(
            z.looseObject({
              program: z.string().describe("The program the wage request is for, e.g. PERM, H-1B or CW-1."),
              oewsReceiptDate: z.string().nullable().describe("The receipt month DOL is working on for requests using its OEWS wage survey, as YYYY-MM."),
              nonOewsReceiptDate: z.string().nullable().describe("The same for requests using another wage source."),
            }),
          )
          .describe("The receipt month DOL prints for each prevailing wage queue."),
        permRequestsPending: z
          .array(
            z.looseObject({
              receiptMonth: z.string().describe("The month the requests were received, as YYYY-MM."),
              remainingRequests: z.number().int().describe("PERM wage requests from that month still pending."),
            }),
          )
          .nullable()
          .describe("Prevailing wage requests for PERM still pending, by the month DOL received them. Null when DOL's page can't be read."),
      })
      .describe("Prevailing wage processing times."),
    pendingPermByFilingMonth: z
      .array(
        z.looseObject({
          month: month("The filing month"),
          filed: z.number().int().describe("PERM cases filed that month."),
          decided: z.number().int().describe("How many DOL has decided."),
          pending: z.number().int().describe("How many are still pending."),
          inAnalystReview: z.number().int().describe("How many of the pending are in analyst review."),
        }),
      )
      .nullable()
      .describe("Pending PERM cases by filing month. Null when the count can't be read, never an empty list."),
  })
  .describe("DOL's processing times and the pending PERM queue by filing month.");

const bulletinChart = z
  .record(z.string(), z.record(z.string(), z.string()))
  .describe("One chart: category (e.g. EB2), then chargeability area (e.g. INDIA), then the cell as printed.");

export const VisaBulletinSchema = z
  .looseObject({
    month: month("The bulletin's month"),
    cells: z.string().describe("How to read a cell: a date like 15JAN13, C for current, or U for unavailable."),
    employment: z
      .looseObject({ finalAction: bulletinChart.nullable(), datesForFiling: bulletinChart.nullable() })
      .describe("The employment-based charts."),
    family: z
      .looseObject({ finalAction: bulletinChart.nullable(), datesForFiling: bulletinChart.nullable() })
      .describe("The family-sponsored charts. Null for a month whose family charts aren't held."),
    sourceUrl: z.string().describe("The State Department's own page for this bulletin."),
  })
  .describe("One visa bulletin's charts, as the State Department printed them.");

const entityFields = {
  kind: z.enum(["employer", "attorney", "occupation"]).describe("What the record is: an employer, a law firm (attorney) or an occupation."),
  slug: z.string().describe("The record's name in its page's address. Send it to the matching get endpoint."),
  name: z.string().describe("The name as DOL's files print it most often."),
  rankByVolume: z.number().int().nullable().describe("Its rank by number of PERM cases, 1 being the most."),
  publishedCases: z.number().int().describe("PERM cases in DOL's published files: decided ones, so certified, denied or withdrawn."),
  certified: z.number().int().describe("How many were certified."),
  denied: z.number().int().describe("How many were denied."),
  certifiedShare: z.number().nullable().describe("certified / (certified + denied), from 0 to 1. Null under the site's floor of decided cases."),
  medianDaysToDecision: z.number().nullable().describe("Median days from filing to decision."),
  filingsLast12Months: z.number().int().nullable().describe("PERM cases filed in the last 12 months."),
  state: z.string().nullable().optional().describe("Law firms only: the firm's state, two letters."),
  occupationCode: z.string().nullable().optional().describe("Occupations only: the SOC code, e.g. 15-1252."),
  medianAnnualWage: z.number().nullable().optional().describe("Occupations only: the median offered wage, a year, in dollars."),
  url: z.string().describe("The record's page on permtracker.app."),
};

const entitySummary = z.looseObject(entityFields).describe("One employer, law firm or occupation, with its PERM record.");

export const EntitySearchSchema = z
  .looseObject({
    results: z.array(entitySummary).describe("The matches, best first."),
    more: z.boolean().describe("True when more matched than the limit returned. Send more of the name to narrow it."),
  })
  .describe("Employers, law firms or occupations found by name.");

export const EntitySchema = z
  .looseObject({
    ...entityFields,
    pendingNow: z
      .looseObject({
        pending: z.number().int().describe("Its cases pending at DOL now."),
        casesTracked: z.number().int().describe("Its cases in DOL's live record, pending and decided."),
        byStatus: z
          .array(z.looseObject({ status: z.string().describe("A DOL status, as DOL prints it."), cases: z.number().int().describe("Its pending cases in that status.") }))
          .describe("The pending cases by DOL status."),
        oldestPendingFiled: z.string().nullable().describe("The filing day of its oldest pending case."),
        asOf: z.string().nullable().describe("The day the live record was read."),
      })
      .nullable()
      .describe("Its cases pending at DOL right now, by stage. Null when the live record can't be read."),
  })
  .describe("One employer's, law firm's or occupation's PERM record, with its cases pending at DOL now.");

export const EmployerLookupSchema = z
  .looseObject({
    query: z.string().describe("The name as sent."),
    shareFloor: z.number().int().describe("Under this many decided cases, no certified share is given."),
    match: z.enum(["exact", "possible", "none"]).describe("exact: the name is this employer's. possible: the closest employer, to be shown as a maybe. none: no employer page fits."),
    employer: z
      .looseObject({
        name: z.string().describe("The employer's name as DOL's files print it."),
        slug: z.string().describe("Its name in its page's address."),
        url: z.string().describe("Its page on permtracker.app."),
        page: z.enum(["perm", "live", "other"]).describe("perm: a published PERM sponsor. live: PERM filings DOL hasn't published yet. other: H-1B, wage-request or seasonal filings only."),
        perm: z
          .looseObject({
            published: z.number().int().describe("PERM cases in DOL's published files."),
            certified: z.number().int().describe("How many were certified."),
            denied: z.number().int().describe("How many were denied."),
            certifiedShare: z.number().nullable().describe("certified / (certified + denied), or null under the floor."),
            pending: z.number().int().nullable().describe("Cases DOL's live record shows still open."),
            newestFiling: z.string().nullable().describe("The newest filing date the live record holds."),
            filingsLast12Months: z.number().int().nullable().describe("PERM cases filed in the last 12 months."),
          })
          .describe("Its PERM record."),
        h1bLcas: z.number().int().nullable().describe("H-1B labor condition applications in DOL's published files."),
        wageRequests: z.number().int().nullable().describe("Prevailing wage requests, published and live."),
      })
      .nullable()
      .describe("The employer the name belongs to, or null when match is none."),
  })
  .describe("The employer page a printed name belongs to, with its PERM record.");

export const SocLookupSchema = z
  .looseObject({
    query: z.string().describe("The title or code as sent."),
    code: z
      .looseObject({
        soc: z.string().describe("The SOC code, e.g. 15-1252."),
        title: z.string().describe("The code's title."),
        known: z.boolean().describe("False when the code isn't in the SOC lists held."),
        filings: z.number().int().describe("Filings under the code in DOL's files."),
        jobZone: z.number().int().nullable().describe("O*NET's Job Zone, 1 to 5."),
        became: z
          .array(z.looseObject({ soc: z.string().describe("A 2018 SOC code."), title: z.string().describe("That code's title.") }))
          .describe("For a 2010 code: the 2018 codes it became."),
        description: z.string().nullable().describe("O*NET's description of the job."),
        tasks: z.array(z.string()).describe("O*NET's core tasks for the job."),
        jobZoneName: z.string().nullable().describe("The Job Zone in words."),
        perm: z.unknown().describe("The job's PERM figures, under the site's floors."),
        filedTitles: z
          .array(
            z.looseObject({
              title: z.string().describe("A job title as employers filed it."),
              filings: z.number().int().describe("Filings under the code with that title."),
              share: z.number().describe("That title's share of the code's filings, 0 to 1."),
            }),
          )
          .describe("The titles employers filed most under the code."),
      })
      .nullable()
      .describe("The code typed, read as one. Null when a job title was sent."),
    titles: z
      .array(
        z.looseObject({
          title: z.string().describe("A job title as employers filed it."),
          filings: z.number().int().describe("Filings under that title."),
          codes: z
            .array(
              z.looseObject({
                soc: z.string().describe("The SOC code, e.g. 15-2051."),
                title: z.string().describe("The code's title."),
                filings: z.number().int().describe("Filings of the job title under this code."),
                share: z.number().nullable().describe("This code's share of the title's filings, 0 to 1."),
                onetLists: z.boolean().describe("True when O*NET lists the title under this code."),
                became: z.array(z.string()).describe("For a 2010 code: the 2018 codes it became."),
              }),
            )
            .describe("The codes employers filed the title under, most used first."),
        }),
      )
      .describe("Job titles matching the words sent, with the codes each was filed under."),
    codes: z
      .array(z.looseObject({ soc: z.string().describe("The SOC code."), title: z.string().describe("The code's title.") }))
      .describe("Codes whose own title matches the words sent."),
  })
  .describe("The SOC codes employers filed a job title under, or a code's own details.");

export const ExportSchema = z
  .looseObject({
    kind: z.enum(["cases", "employers", "law-firms", "occupations"]).describe("What was exported."),
    rows: z.array(z.record(z.string(), z.unknown())).describe("The rows. The CSV form carries the same rows."),
    count: z.number().int().describe("Rows in this answer."),
    cap: z.number().int().describe("The most rows one export may hold on this plan."),
    truncated: z.boolean().describe("True when more matched than the export holds."),
    note: z.string().nullable().describe("What to do when the export was cut short."),
  })
  .describe("A search's whole answer as rows.");

const webhookEndpoint = z
  .looseObject({
    id: z.string().describe("The endpoint's id. Send it to delete the endpoint."),
    url: z.string().describe("The https address deliveries are posted to."),
    events: z.array(z.string()).describe("The events the endpoint receives."),
  })
  .describe("One webhook endpoint.");

export const WebhookListSchema = z
  .looseObject({
    endpoints: z.array(webhookEndpoint).describe("This account's endpoints, each with its url, events, whether it's paused and the last four characters of its secret."),
    watches: z.array(z.record(z.string(), z.unknown())).describe("The cases and employers this account's webhooks watch."),
    events: z.array(z.string()).describe("Every event an endpoint can ask for."),
  })
  .describe("An account's webhook endpoints and watches.");

export const WebhookCreatedSchema = z
  .looseObject({
    id: z.string().describe("The new endpoint's id."),
    secret: z.string().describe("The signing secret. Shown this once: use it to check each delivery's webhook-signature header."),
    note: z.string().describe("A reminder that the secret is shown only once."),
  })
  .describe("A new webhook endpoint with its signing secret.");

export const DoneSchema = z.looseObject({}).describe("What was done, in a few fields.");

export const MeSchema = z
  .looseObject({
    key: z
      .looseObject({
        id: z.string().describe("The key's id (never the key itself)."),
        sandbox: z.boolean().describe("True for a pt_test_ key, which answers sample data."),
        scopes: z.array(z.string()).describe("What the key may do beyond reading public records."),
        expiresAt: z.string().nullable().describe("When the key expires, ISO 8601, or null for no expiry."),
      })
      .describe("The key that made the call."),
    plan: z
      .looseObject({
        id: z.string().describe("The plan's id, e.g. free or plus."),
        name: z.string().describe("The plan's name."),
        perMinute: z.number().int().describe("Calls a minute."),
        perDay: z.number().int().describe("Calls a day."),
        perMonth: z.number().int().describe("Calls a month."),
      })
      .describe("The plan whose limits apply to this key, with every limit."),
    accountPlan: z
      .looseObject({ id: z.string().describe("The plan's id."), name: z.string().describe("The plan's name.") })
      .describe("The plan the account itself is on."),
    paywall: z
      .looseObject({
        enforced: z.boolean().describe("False while every account gets the Plus plan's limits."),
        note: z.string().describe("The same, in a sentence."),
      })
      .describe("Whether paid limits are enforced yet."),
    usage: z
      .looseObject({
        today: z.number().int().describe("Counted calls today (UTC)."),
        thisMonth: z.number().int().describe("Counted calls this month (UTC)."),
        remainingToday: z.number().int().describe("Counted calls left today."),
        remainingThisMonth: z.number().int().describe("Counted calls left this month."),
        dayResetsInSeconds: z.number().int().describe("Seconds until the day's count resets, at midnight UTC."),
        monthResetsInSeconds: z.number().int().describe("Seconds until the month's count resets."),
      })
      .describe("What the account has used and what's left."),
  })
  .describe("Your key, its plan, the limits and what you've used.");

export const HealthSchema = z
  .object({
    status: z.literal("ok").describe("Always ok when the API answers."),
    version: z.string().describe("The API description's version."),
    docs: z.string().describe("The developer page."),
    openapi: z.string().describe("The OpenAPI document."),
  })
  .describe("Whether the API is up.");

/**
 * Every refusal, as an RFC 9457 problem document that also carries the
 * `error` object version 1 has always sent, so a client written against
 * either reads it.
 */
export const ProblemSchema = z
  .looseObject({
    type: z.string().describe("A URL naming the kind of problem. It opens the docs for that error code."),
    title: z.string().describe("The kind of problem in a few words."),
    status: z.number().int().describe("The HTTP status, repeated."),
    detail: z.string().describe("What went wrong with this request and what to do, in a sentence."),
    code: z.string().describe("A stable machine-readable code, e.g. rate_limited or not_found."),
    retryAfter: z.number().int().optional().describe("Seconds until the limit lifts. Also sent as the Retry-After header."),
    error: z
      .looseObject({
        code: z.string().describe("The same code."),
        message: z.string().describe("The same sentence as detail."),
        retryAfter: z.number().int().optional().describe("Seconds until the limit lifts."),
        url: z.string().optional().describe("A page on permtracker.app that can help, when there is one."),
        docs: z.string().describe("The developer page."),
      })
      .describe("The error as version 1 has always sent it. Kept so older clients keep working."),
  })
  .describe("A refusal or a failure: an RFC 9457 problem document, with the older error object inside it.");

/** The envelope every 200 answer shares. */
export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: MetaSchema });
}

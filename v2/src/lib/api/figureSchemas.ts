/**
 * The shapes of the figure answers (API 1.2): USCIS's I-140 and I-485 figures, the receipt-number sample, the
 * consulates, the timelines people reported and the estimates' own record. Same rules as ./schemas.ts: open objects,
 * every named field promised and described, read by the OpenAPI document, the MCP server and the tests.
 *
 * Aggregates only. No schema here has a field for a receipt number or a person: the sample's answers carry counts and
 * shares by block, month and form, and the timelines' answers carry counts and medians with small groups withheld.
 *
 * Pure: it reads nothing and imports nothing server-only.
 */
import { z } from "zod";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const day = (what: string) => z.string().regex(DAY_RE).describe(`${what}, as YYYY-MM-DD.`);
const month = (what: string) => z.string().regex(MONTH_RE).describe(`${what}, as YYYY-MM.`);
const count = (what: string) => z.number().int().describe(what);
const maybeCount = (what: string) => z.number().int().nullable().describe(`${what} Null where the publisher printed none.`);
const share = (what: string) => z.number().min(0).max(1).describe(`${what}, from 0 to 1.`);

const unreadable = z
  .array(z.string())
  .describe("The parts of this answer that couldn't be read just now, by field name. Each is null in this answer. An empty list means every part was read.");

/* ------------------------------------------------------------------ */
/* The receipt-number sample                                           */
/* ------------------------------------------------------------------ */

const groupFigure = z
  .looseObject({
    count: count("Sampled cases in this status group."),
    estimated: z.number().describe("The sample's estimate of how many of the form's cases here are in this group."),
    share: share("The estimated share of the form's cases here in this group"),
    low: share("The low end of the 95% margin on that share"),
    high: share("The high end of the 95% margin on that share"),
  })
  .describe("One status group's figure: the sampled count, the estimated share and its 95% margin.");

const groups = z
  .record(z.string(), groupFigure)
  .describe("By status group: approved, denied, withdrawn, closed, revoked, rfe (USCIS asked for more evidence) and waiting (still pending).");

const formFigure = z
  .looseObject({
    form: z.string().describe("The USCIS form, e.g. I-485."),
    counted: count("Cases of this form the sample counted here."),
    groups,
  })
  .describe("One form's figures: how many cases the sample counted and the share in each status group.");

export const ReceiptBlocksSchema = z
  .looseObject({
    form: z.string().describe("The form these figures are for, e.g. I-485."),
    forms: z.array(z.string()).describe("The forms with the most sampled cases, most first. Any of them can be asked for with form."),
    approvalsSeenUpTo: z
      .string()
      .nullable()
      .describe("The newest block where the sample saw an approved case of this form, e.g. IOE09365. Null when it has seen none."),
    blocks: z
      .array(
        z
          .looseObject({
            block: z.string().describe("The block: IOE and five digits, the first eight characters of an online receipt number. Each block is 100,000 numbers."),
            counted: count("Cases of this form the sample counted in the block."),
            approved: groupFigure,
          })
          .describe("One receipt block's approved share for the form. The one-block answer has every group."),
      )
      .describe("Every block where the sample counted the form, in block order, or the blocks near the one asked for."),
    near: z.string().nullable().describe("The block the list was asked to centre on, or null for every block."),
    casesInSample: z.number().int().nullable().describe("Every case in the sample, all forms, online and paper. Null when it couldn't be read."),
  })
  .describe("The share of one form's sampled cases approved, block by block, from receipt numbers checked on USCIS's Case Status page. Estimates with a 95% margin.");

export const ReceiptBlockSchema = z
  .looseObject({
    block: z.string().describe("The block: IOE and five digits."),
    forms: z.array(formFigure).describe("Each form the sample counted in the block, most counted first."),
    before: z.string().nullable().describe("The nearest earlier block where the sample holds cases, or null."),
    after: z.string().nullable().describe("The nearest later block where the sample holds cases, or null."),
    recentMoves: z
      .array(
        z
          .looseObject({
            day: day("The day the sample saw the change"),
            form: z.string().nullable().describe("The form of the cases that changed."),
            movedTo: z.string().describe("The status group the cases moved to: one of the seven groups, or rejected, decided or other."),
            cases: count("Sampled cases that made this move on this day."),
          })
          .describe("Sampled cases in the block that changed status on one day, counted by form and new group."),
      )
      .nullable()
      .describe("The newest status changes the sample saw in the block, as counts. No receipt number is ever listed. Null when they couldn't be read."),
    unreadable,
  })
  .describe("One receipt block: each form's share in each status group with its margin, the blocks either side, and the newest moves the sample saw.");

export const ReceiptMonthsSchema = z
  .looseObject({
    form: z.string().describe("The form these figures are for, e.g. I-485."),
    forms: z.array(z.string()).describe("The forms with the most sampled cases, most first."),
    months: z
      .array(
        z
          .looseObject({
            month: z.string().describe("The month USCIS received the cases, as YYYY-MM."),
            counted: count("Cases of this form the sample counted from that month."),
            walked: z.boolean().describe("True when part of the month was checked number by number and counted whole, the rest estimated from the draw."),
            approved: groupFigure,
            rfe: groupFigure,
            waiting: groupFigure,
          })
          .describe("One receipt month's figures for the form."),
      )
      .describe("Every receipt month the sample counted the form, newest first."),
  })
  .describe("The share of one form's online filings approved, sent an evidence request and still waiting, by the month USCIS received them. Estimates with a 95% margin.");

/* ------------------------------------------------------------------ */
/* USCIS's own figures                                                 */
/* ------------------------------------------------------------------ */

const median = z
  .looseObject({
    months: z.number().describe("USCIS's median processing time, in months."),
    title: z.string().describe("The row of USCIS's table the median is from."),
    fiscalYear: count("The federal fiscal year of the quarter."),
    quarter: count("The fiscal quarter, 1 to 4."),
    quarterEnd: day("The last day of that quarter"),
  })
  .describe("USCIS's newest quarterly median processing time for the form.");

const postedTimes = z
  .looseObject({
    postedOn: day("The day USCIS posted these times"),
    rows: z
      .array(
        z
          .looseObject({
            subtype: z.string().describe("The kind of filing, as USCIS's page names it."),
            office: z.string().describe("The office code USCIS posts the time under."),
            months: z.number().nullable().describe("USCIS's posted time in months. Null where USCIS prints a note instead."),
            asPrinted: z.string().nullable().describe("The time as USCIS printed it."),
            label: z.string().nullable().describe("The subtype in words."),
            officeLabel: z.string().nullable().describe("The office in words."),
            inquiryFrom: z.string().nullable().describe("The receipt date before which USCIS lets a case ask about itself, as posted."),
          })
          .describe("One time USCIS posts for the form."),
      )
      .describe("Each time USCIS posts for the form."),
  })
  .describe("The form's times as posted on USCIS's processing times page.");

const i140Counts = {
  received: count("Petitions USCIS received in the quarter."),
  approved: count("Petitions USCIS approved in the quarter."),
  denied: count("Petitions USCIS denied in the quarter."),
  pending: count("Petitions pending at the quarter's end."),
};

export const UscisI140Schema = z
  .looseObject({
    quarter: z
      .looseObject({
        fiscalQuarter: z.string().describe("USCIS's quarter, e.g. FY2026 Q3."),
        sourceFile: z.string().describe("The USCIS file the figures are from."),
        subtypes: z
          .array(
            z
              .looseObject({
                code: z.string().describe("USCIS's code for the subtype, e.g. E21."),
                label: z.string().describe("The subtype in USCIS's words."),
                ...i140Counts,
              })
              .describe("One I-140 subtype's counts."),
          )
          .describe("Every subtype USCIS reported."),
      })
      .nullable()
      .describe("USCIS's newest quarter of I-140 counts, by subtype. Null when it couldn't be read."),
    byQuarter: z
      .array(
        z
          .looseObject({
            fiscalYear: count("The federal fiscal year."),
            quarter: count("The fiscal quarter, 1 to 4."),
            category: z.string().describe("USCIS's category code."),
            categoryLabel: z.string().describe("The category in USCIS's own words."),
            ...i140Counts,
          })
          .describe("One category's counts in one quarter."),
      )
      .nullable()
      .describe("The newest eight quarters USCIS reported, oldest first, by category."),
    medianMonths: median.nullable(),
    processingTimes: postedTimes.nullable(),
    awaitingVisa: z
      .looseObject({
        month: month("The month USCIS's count is for"),
        sourceFile: z.string().describe("The USCIS file the counts are from."),
        cells: z
          .array(
            z
              .looseObject({
                country: z.string().describe("The country of chargeability, or TOTAL."),
                category: z.string().describe("The preference category, e.g. EB2, or TOTAL."),
                count: count("Approved employment-based petitions waiting for a visa number."),
              })
              .describe("One country and category."),
          )
          .describe("Every cell USCIS printed, totals included."),
      })
      .nullable()
      .describe("Approved employment-based petitions waiting for a visa number, by country and category, as USCIS counts them."),
    unreadable,
  })
  .describe("USCIS's own I-140 figures: the newest quarter by subtype and the last eight by category. Also the median and posted processing times, and approved petitions waiting for a visa number.");

const officeCounts = (who: string) =>
  z
    .looseObject({
      received: maybeCount(`${who} I-485s received in the quarter.`),
      approved: maybeCount(`${who} I-485s approved in the quarter.`),
      denied: maybeCount(`${who} I-485s denied in the quarter.`),
      pending: maybeCount(`${who} I-485s pending at the quarter's end.`),
    })
    .describe(`${who} I-485s.`);

const officeRow = z
  .looseObject({
    code: z.string().describe("USCIS's code for the office, or ALL for the total."),
    office: z.string().describe("The office's name as USCIS prints it."),
    state: z.string().describe("The office's state, or Service Center."),
    withheld: count("How many of the row's figures USCIS withheld to protect privacy. Each is null."),
    employment: officeCounts("Employment-based")
      .extend({
        pendingLastQuarter: z.number().int().nullable().describe("Employment-based I-485s pending at the end of the quarter before, when it's held."),
      })
      .describe("Employment-based I-485s, with the pending count a quarter earlier."),
    family: officeCounts("Family-based"),
    all: officeCounts("All"),
  })
  .describe("One USCIS office's I-485 counts for the quarter: employment-based, family-based, and every category together.");

const inventoryPoint = z
  .looseObject({
    asOf: day("The day USCIS's inventory is as of"),
    pending: count("Employment-based I-485s pending in USCIS's inventory."),
    visaAvailable: count("Of those, cases whose visa number is available."),
    awaitingVisa: count("Of those, cases waiting for a visa number."),
  })
  .describe("USCIS's pending employment-based I-485 inventory on one day.");

export const UscisI485Schema = z
  .looseObject({
    byOffice: z
      .looseObject({
        fiscalYear: count("The federal fiscal year."),
        quarter: count("The fiscal quarter, 1 to 4."),
        quarterEnd: day("The last day of the quarter"),
        sourceFile: z.string().describe("The USCIS file the figures are from."),
        previousQuarter: z
          .looseObject({ fiscalYear: count("The federal fiscal year."), quarter: count("The fiscal quarter, 1 to 4.") })
          .nullable()
          .describe("The quarter the pendingLastQuarter figures are from, when it's held."),
        total: officeRow.nullable(),
        offices: z.array(officeRow).describe("Every field office and service center USCIS listed."),
      })
      .nullable()
      .describe("USCIS's newest quarter of I-485 counts by office. Null when it couldn't be read."),
    inventory: z
      .looseObject({
        newest: inventoryPoint,
        history: z.array(inventoryPoint).describe("The newest 24 inventories USCIS published, oldest first."),
      })
      .nullable()
      .describe("USCIS's pending employment-based I-485 inventory. Null when it couldn't be read."),
    medianMonths: median.nullable(),
    processingTimes: postedTimes.nullable(),
    unreadable,
  })
  .describe("USCIS's own I-485 figures: the newest quarter by office, the pending employment-based inventory, and the median and posted processing times.");

/* ------------------------------------------------------------------ */
/* Consulates                                                          */
/* ------------------------------------------------------------------ */

const ivCell = z
  .looseObject({
    asPrinted: z.string().describe("The month as State printed it, e.g. Mar-2023, or N/A."),
    month: month("The month of documentarily complete cases the post is scheduling").nullable(),
    monthsBehind: z.number().int().nullable().describe("Whole months between that month and State's update. 0 means caught up. Null where State shows no month."),
  })
  .describe("One category's place in the post's interview line.");

const scheduling = z
  .looseObject({ employment: ivCell, family: ivCell, immediate: ivCell })
  .describe("Where the post's immigrant visa interview line is, by category: employment, family preference and immediate relative.");

const postFields = {
  slug: z.string().describe("The post's name in its page's address."),
  name: z.string().describe("The consulate or embassy."),
  scheduling: scheduling.nullable().describe("The post's line in State's newest update. Null for a post State's tool doesn't list."),
  issuedLast12Months: z.number().int().nullable().describe("Immigrant visas the post issued in the newest 12 published months. Null when State's tables couldn't be read."),
  employmentLast12Months: z.number().int().nullable().describe("Of those, employment-based visas."),
  url: z.string().describe("The post's page on permtracker.app."),
};

export const ConsulatesSchema = z
  .looseObject({
    asOf: day("State's newest update to its scheduling tool").nullable(),
    issuedFrom: month("The first of the 12 issuance months counted").nullable(),
    issuedTo: month("The last of them").nullable(),
    posts: z.array(z.looseObject(postFields).describe("One consulate.")).describe("Every post that schedules or issues immigrant visas, by name."),
  })
  .describe("Every consulate's immigrant visa interview line, from State's IV Scheduling Status Tool, and the visas each issued in the newest 12 months.");

export const ConsulateSchema = z
  .looseObject({
    ...postFields,
    history: z
      .array(
        z
          .looseObject({ asOf: day("The day of State's update"), employment: ivCell, family: ivCell, immediate: ivCell })
          .describe("The post's line in one of State's updates."),
      )
      .describe("Every update State made to the post's line that PERM Tracker holds, oldest first."),
    monthlyIssuances: z
      .array(
        z
          .looseObject({
            month: month("The month"),
            byCategory: z.record(z.string(), z.number()).describe("Visas issued that month, by State's category."),
          })
          .describe("One month of the post's issuances."),
      )
      .describe("Immigrant visas the post issued each month, by category, the newest 36 months, oldest first."),
  })
  .describe("One consulate: its interview line now and over time, and the immigrant visas it issued each month.");

/* ------------------------------------------------------------------ */
/* Timelines people reported                                           */
/* ------------------------------------------------------------------ */

const step = z
  .looseObject({
    id: z.string().describe("The step's id, e.g. perm-decision."),
    label: z.string().describe("The step in words."),
    stage: z.string().describe("Its stage: h1b, pwd, perm, i140, i485 or consular."),
    verified: z.boolean().describe("True when the figure counts only timelines PERM Tracker checked."),
    cases: count("Cases behind the figure, in its window."),
    windowDays: z.number().int().nullable().describe("The window this figure covers: 183 or 365 days. Null when even a year holds too few cases."),
    medianDays: z.number().nullable().describe("The median days the step took."),
    p25Days: z.number().nullable().describe("A quarter of cases took this many days or fewer."),
    p75Days: z.number().nullable().describe("Three quarters took this many days or fewer."),
    before: z
      .looseObject({ medianDays: z.number().describe("The median days."), cases: count("The cases behind it.") })
      .nullable()
      .describe("The six months before the window, when both hold enough cases: which way the step is moving."),
    allTime: count("Every case ever reported for the step."),
    months: z
      .array(
        z
          .looseObject({
            month: month("The month the step finished"),
            cases: count("Cases that finished the step that month."),
            medianDays: z.number().nullable().describe("Their median days. Null when the month holds too few cases."),
          })
          .describe("One month."),
      )
      .describe("Month by month."),
  })
  .describe("How long one step took for the people who reported it.");

export const TimelinesSchema = z
  .looseObject({
    scope: z.enum(["all", "office", "consulate"]).describe("all: every reported case. office: one USCIS office. consulate: one consulate."),
    place: z.string().nullable().describe("The office code or consulate slug asked for, or null for all."),
    asOf: day("The day the figures were worked out"),
    cases: count("Reported cases behind the figures, each person once."),
    steps: z.array(step).describe("Each step with enough cases for a figure."),
    lastWeek: z
      .looseObject({
        from: day("The first day of the week"),
        through: day("The last day of the week"),
        steps: z
          .array(
            z
              .looseObject({
                id: z.string().describe("The step's id."),
                label: z.string().describe("The step in words."),
                count: z.number().int().nullable().describe("People who reported finishing it that week. Null when under 5."),
              })
              .describe("One step."),
          )
          .describe("Approvals reported in the week, by step."),
      })
      .nullable()
      .describe("All only: the approvals people reported in the newest week."),
    waiting: z
      .looseObject({
        heardFromDays: count("How far back someone's newest report may be and still count as waiting, in days."),
        heard: count("People heard from in that time."),
        byStage: z
          .array(z.looseObject({ id: z.string().describe("The stage's id."), label: z.string().describe("The stage in words."), count: count("People at it.") }).describe("One stage."))
          .describe("Where the people heard from are waiting, at the furthest step each reported."),
        lines: z
          .array(
            z
              .looseObject({
                category: z.string().describe("The preference category."),
                country: z.string().describe("The country of chargeability."),
                counts: z.array(z.number().int().nullable()).describe("One count per stage, in byStage's order. Null where it's under 5."),
                total: count("Everyone waiting in this line."),
              })
              .describe("One category and country."),
          )
          .describe("The same people by category and country. A line of fewer than 5 isn't listed."),
        unlisted: count("People no line shows."),
      })
      .nullable()
      .describe("Who's still waiting, as counts. Null for a place without enough cases."),
    i140: z
      .array(
        z
          .looseObject({
            category: z.string().describe("The I-140 category."),
            premium: z.string().describe("Premium processing: with filing, after filing, yes, none or not given."),
            reported: count("I-140s reported in this group."),
            decidedAllTime: count("Of those, decided, any year."),
            windowDays: count("The window the figures cover, in days."),
            decided: count("Decided in the window."),
            approvedShare: z.number().nullable().describe("The share of those approved, 0 to 1."),
            medianDays: z.number().nullable().describe("The median days to a decision."),
            rfeShare: z.number().nullable().describe("The share that got a request for evidence, 0 to 1."),
          })
          .describe("One category and premium choice."),
      )
      .nullable()
      .describe("All only: reported I-140s by category and premium processing."),
    overview: z
      .looseObject({
        people: count("Listed cases from every source, each person once."),
        inSeveral: count("Of those, reported in more than one place."),
        i140s: count("Of those, with an I-140 date or decision."),
        sources: z
          .array(z.looseObject({ name: z.string().describe("Where people reported."), cases: count("Cases reported there.") }).describe("One source."))
          .describe("Where the cases were reported. A case in two places counts in each."),
        offices: z
          .array(z.looseObject({ office: z.string().describe("USCIS's office code."), cases: count("Employment-based I-485s reported there.") }).describe("One office."))
          .describe("Employment-based I-485s by USCIS office, the most reported first."),
      })
      .nullable()
      .describe("All only: the merged list at a glance."),
    unreadable,
  })
  .describe("What people reported about their own cases, merged across sources and counted once each: how long each step took, and who's still waiting. Self-reported.");

/* ------------------------------------------------------------------ */
/* The estimates' own record                                           */
/* ------------------------------------------------------------------ */

const graded = z
  .looseObject({
    since: day("The first day a prediction was recorded").nullable(),
    recorded: count("Predictions recorded."),
    graded: count("Of those, graded against a decision."),
    typicalMissDays: z.number().nullable().describe("The median days between the predicted day and the decision."),
    biasDays: z.number().nullable().describe("The median of decision minus prediction: above 0 means decisions came later than predicted."),
    inRangeShare: z.number().nullable().describe("The share of graded predictions decided inside the range given, 0 to 1."),
    within14Share: z.number().nullable().describe("The share decided within 14 days of the predicted day, 0 to 1."),
    overdue: count("Predictions past their day and still waiting."),
    missAtLeastDays: z.number().nullable().describe("The typical miss counting each overdue case at the days it's already late: a floor."),
  })
  .describe("One program's daily sample of predictions, graded as DOL decides.");

export const AccuracySchema = z
  .looseObject({
    checks: z
      .array(
        z
          .looseObject({
            key: z.string().describe("The check's id, e.g. perm-line."),
            estimate: z.string().describe("What's estimated, as a reader would ask it."),
            result: z.string().describe("How the check came out, in short."),
            basis: z.string().describe("The cases it was checked on, with their days."),
          })
          .describe("One estimate and its check."),
      )
      .nullable()
      .describe("Every estimate the site gives, with how its own check came out, as the scorecard prints it. Null when the checks couldn't be read."),
    permBacktest: z
      .looseObject({
        from: day("The first day of the backtest"),
        to: day("Its last day"),
        decided: count("PERM cases DOL decided in it."),
        typicalMissDays: z.number().nullable().describe("The median days between each case's date and its decision."),
        within7Share: z.number().nullable().describe("The share decided within a week of their date, 0 to 1."),
        decidedByEndRight: z.number().nullable().describe("The share of calls about the window (decided by the end, or not yet) that were right, 0 to 1."),
      })
      .nullable()
      .describe("The nightly PERM backtest: real decisions, each dated as the line stood on the first day."),
    dailySample: z
      .looseObject({
        perm: graded.nullable(),
        pwd: graded.nullable(),
      })
      .nullable()
      .describe("The dates recorded each day for a random sample of pending cases, graded as DOL decides them."),
    unreadable,
  })
  .describe("How close PERM Tracker's estimates land, graded against what DOL and the State Department did.");

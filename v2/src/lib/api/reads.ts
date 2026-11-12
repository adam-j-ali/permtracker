/**
 * What the API and the assistant tools answer, built from the same reads the
 * pages use. /v1 and /mcp both call these, so an endpoint and its tool can't
 * disagree.
 *
 * Every answer names its source and the date its data is true for, and links
 * the page it came from. Nothing here asks DOL live: the API answers from our
 * own records, which the nightly and afternoon sweeps keep current.
 */
import "server-only";

import { SITE_URL } from "@/lib/constants/site";
import { normaliseFlagCaseNumber, type FlagProgram } from "@/lib/flagCaseNumber";
import { isEntityKind, type EntityKind } from "@/lib/entityPayload";
import { lookupCase } from "@/lib/db/caseLookup";
import { one } from "@/lib/db/client";
import { getEntityBySlug, getFreshness, getLiveBacklog } from "@/lib/db/publicData";
import { entityPending } from "@/lib/db/entityDetail";
import { searchByName } from "@/lib/db/entities";
import { getProcessingTimes } from "@/lib/db/processingTimes";
import { getPermLine } from "@/lib/db/permLine";
import { findFront } from "@/lib/liveQueue";

import { certifiedShare } from "./share";
import { LOOKS_YEARLY_NOTE, looksYearly } from "@/lib/wageFormat";
import { pwd } from "@/lib/db/pwdCases";
import { lca } from "@/lib/db/lcaCases";
import { lookupSeasonalPosting, lookupSeasonalRecord, seasonal } from "@/lib/db/seasonalCases";
import { estimatePermCase, loadPermEstimateContext } from "@/lib/db/permEstimate";
import { rfiEnteredOn } from "@/lib/db/rfiClock";
import { softFail } from "@/lib/softRead";
import { enoughTyped } from "@/lib/caseFinder";
import { findCase } from "@/lib/findCase";
import { FILING_PROGRAMS, dayHref, type FilingProgram } from "@/lib/filingsByDay";
import { easternDay } from "@convex/lib/time";
import { ISO_MONTH_RE } from "@convex/lib/months";

export interface ApiMeta {
  /** Who published the underlying records. */
  source: string;
  /** The date the data is true for, `YYYY-MM-DD`, when one applies. */
  asOf: string | null;
  /** The page on permtracker.app that shows the same thing. */
  url: string;
}

export type ReadResult<T> =
  | { ok: true; data: T; meta: ApiMeta }
  | { ok: false; status: 400 | 403 | 404 | 429 | 503; code: string; message: string; url?: string; retryAfter?: number };

const DOL_SOURCE = "U.S. Department of Labor, FLAG case status (flag.dol.gov) and OFLC disclosure files";
const PROGRAM_NAMES: Record<FlagProgram, string> = {
  perm: "PERM labor certification",
  pwd: "prevailing wage determination",
  lca: "H-1B labor condition application",
  seasonal: "H-2A, H-2B or CW-1 seasonal program",
};
const FLAG_PROGRAMS = { pwd, lca, seasonal } as const;

const bad = (message: string): ReadResult<never> => ({ ok: false, status: 400, code: "bad_request", message });
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

export interface CaseRecord {
  caseNumber: string;
  program: FlagProgram;
  programName: string;
  status: string | null;
  isFinal: boolean;
  filingDate: string | null;
  employer: string | null;
  jobTitle: string | null;
  /** When the sweep last asked DOL about this case. */
  statusCheckedOn: string | null;
  /** DOL's decided record, once a disclosure file carries the case. */
  decision: Record<string, unknown> | null;
  /**
   * H-2A and H-2B only: the job as DOL accepted it, from its SeasonalJobs
   * feed (wage, workers, period, worksite), before any decision.
   */
  accepted?: Record<string, unknown> | null;
  /** PERM only: where the case's filing month stands in the queue. */
  queue: {
    filingMonth: string;
    casesFiledThatMonth: number;
    decidedFromThatMonth: number;
    pendingFromThatMonth: number;
    pendingFromEarlierMonths: number;
  } | null;
}

export async function readCase(input: string): Promise<ReadResult<CaseRecord>> {
  if (input.length > 40) return bad("That isn't a case number.");
  const ref = normaliseFlagCaseNumber(input);
  if (!ref) {
    return bad("That isn't a case number. PERM numbers look like G-100-26045-123456, prevailing wage P-100-..., H-1B I-200-....");
  }
  const url = `${SITE_URL}/perm-case-status?case=${encodeURIComponent(ref.caseNumber)}`;
  const notFound: ReadResult<never> = {
    ok: false,
    status: 404,
    code: "not_found",
    message:
      "No record of this case yet. New filings are found nightly, and the case page on the site can ask DOL right now.",
    url,
  };

  if (ref.program === "perm") {
    const r = await lookupCase(ref.caseNumber, { discover: false });
    if (!r || (!r.live && !r.decided)) return notFound;
    const d = r.decided;
    return {
      ok: true,
      data: {
        caseNumber: r.caseNumber,
        program: "perm",
        programName: PROGRAM_NAMES.perm,
        status: r.live?.status ?? d?.status ?? null,
        isFinal: r.live ? r.live.isFinal : true,
        filingDate: r.live?.filingDate ?? d?.receivedDate ?? null,
        employer: r.live?.employerName ?? d?.employerName ?? null,
        jobTitle: r.live?.jobTitle ?? d?.jobTitle ?? null,
        statusCheckedOn: day(r.live?.lastCheckedAt),
        decision: d
          ? {
              status: d.status,
              receivedDate: d.receivedDate,
              decisionDate: d.decisionDate,
              daysToDecision: d.days,
              occupation: d.socTitle,
              worksiteState: d.state,
              offeredWage: d.wage,
            }
          : null,
        queue: r.cohort
          ? {
              filingMonth: r.cohort.month,
              casesFiledThatMonth: r.cohort.total,
              decidedFromThatMonth: r.cohort.decided,
              pendingFromThatMonth: r.cohort.sameMonthPending,
              pendingFromEarlierMonths: r.cohort.aheadOfMonth,
            }
          : null,
      },
      meta: { source: DOL_SOURCE, asOf: day(r.live?.lastCheckedAt) ?? d?.decisionDate ?? null, url },
    };
  }

  const program = FLAG_PROGRAMS[ref.program];
  const isSeasonal = ref.program === "seasonal";
  // The published halves may fail on their own and the answer still stands on
  // what was read, but a failure is never a 404: with nothing found and a read
  // failed, this throws (a 500 the caller isn't charged for).
  const failed: unknown[] = [];
  const soft = <T,>(p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      failed.push(err);
      return null;
    });
  const [row, disc, extra, posting] = await Promise.all([
    program.lookup(ref.caseNumber, { discover: false }),
    soft(program.lookupDisclosed(ref.caseNumber)),
    // The seasonal record adds what the shared reader doesn't select (the
    // workers, the work period, the county) and covers the H-2B and CW-1 wage
    // requests, which DOL publishes in its prevailing wage file instead.
    isSeasonal ? soft(lookupSeasonalRecord(ref.caseNumber)) : Promise.resolve(null),
    isSeasonal ? soft(lookupSeasonalPosting(ref.caseNumber)) : Promise.resolve(null),
  ]);
  if (!row && !disc && !extra && !posting) {
    if (failed.length > 0) throw failed[0];
    return notFound;
  }
  return {
    ok: true,
    data: {
      caseNumber: ref.caseNumber,
      program: ref.program,
      programName: PROGRAM_NAMES[ref.program],
      status: row?.status ?? disc?.status ?? extra?.status ?? null,
      isFinal: row ? row.isFinal : !!(disc ?? extra),
      filingDate: row?.filingDate ?? disc?.receivedDate ?? extra?.receivedDate ?? null,
      employer: row?.employerName ?? disc?.employerName ?? extra?.employerName ?? posting?.employerName ?? null,
      jobTitle: row?.jobTitle ?? disc?.jobTitle ?? extra?.jobTitle ?? posting?.jobTitle ?? null,
      statusCheckedOn: day(row?.lastCheckedAt),
      decision: disc
        ? {
            status: disc.status,
            receivedDate: disc.receivedDate,
            decisionDate: disc.decisionDate,
            occupation: disc.socTitle,
            occupationCode: disc.socCode,
            wage: disc.wage,
            wageUnit: disc.wageUnit,
            ...(looksYearly(disc.wage, disc.wageUnit) ? { wageNote: LOOKS_YEARLY_NOTE } : {}),
            worksiteState: disc.worksiteState,
            visaClass: disc.visaClass,
            lawFirm: disc.attorneyName,
            ...(extra
              ? {
                  workersRequested: extra.workers,
                  workersCertified: extra.workersCertified,
                  workBegins: extra.beginDate,
                  workEnds: extra.endDate,
                  worksiteCity: extra.worksiteCity,
                  worksiteCounty: extra.worksiteCounty,
                }
              : {}),
          }
        : extra
          ? {
              status: extra.status,
              receivedDate: extra.receivedDate,
              decisionDate: extra.decisionDate,
              occupation: extra.socTitle,
              wage: extra.wage,
              wageUnit: extra.wageUnit,
              worksiteState: extra.worksiteState,
              visaClass: extra.visaClass,
              lawFirm: extra.attorneyName,
            }
          : null,
      ...(isSeasonal
        ? {
            accepted: posting
              ? {
                  acceptedDate: posting.acceptedDate,
                  submittedDate: posting.submittedDate,
                  wage: posting.wage,
                  wageUnit: posting.wageUnit,
                  workersForeign: posting.workersForeign,
                  workBegins: posting.beginDate,
                  workEnds: posting.endDate,
                  worksiteCity: posting.worksiteCity,
                  worksiteCounty: posting.worksiteCounty,
                  worksiteState: posting.worksiteState,
                  jobOrderNumber: posting.jobOrderNumber,
                  wageDeterminationNumber: posting.pwdNumber,
                }
              : null,
          }
        : {}),
      queue: null,
    },
    meta: { source: DOL_SOURCE, asOf: day(row?.lastCheckedAt) ?? disc?.decisionDate ?? null, url },
  };
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export async function readQueue(): Promise<ReadResult<Record<string, unknown>>> {
  // A backlog that can't be read is sent as null, never as an empty list that reads as "nothing pending".
  // The month by our own check is sent as null when it can't be read, never as DOL's last printed month.
  const [pt, backlog, line] = await Promise.all([
    getProcessingTimes(),
    getLiveBacklog().catch(softFail("api/reads.readQueue.getLiveBacklog", null)),
    getPermLine().catch(softFail("api/reads.readQueue.getPermLine", null)),
  ]);
  if (!pt) return { ok: false, status: 503, code: "unavailable", message: "DOL's processing times aren't loaded right now. Try again later." };
  return {
    ok: true,
    data: {
      perm: {
        asOf: pt.permAsOf,
        // The filing month DOL is deciding, measured each day from DOL's own case statuses (lib/permLine.ts). DOL's
        // page stopped printing a month on Oct 31 2026, so `queues[].workingOnMonth` can be empty while this isn't.
        decidingNow: line ? { month: line.month, asOf: line.asOf, source: "PERM Tracker's daily check of DOL's case status" } : null,
        // The oldest filing month DOL hasn't substantially decided (lib/liveQueue.ts, `findFront`).
        oldestOpenMonth: backlog ? (findFront(backlog)?.month ?? null) : null,
        queues: pt.permQueues.map((q) => ({ queue: q.queue, workingOnMonth: q.priorityDate, asPrinted: q.raw })),
        averageDays: pt.permAverageDays.map((a) => ({
          determination: a.determination,
          month: a.month,
          // The window an average covers ("Last 30 Days"): DOL averages over windows, not months, from Oct 31 2026.
          period: a.period ?? null,
          calendarDays: a.calendarDays,
        })),
      },
      prevailingWage: {
        asOf: pt.pwdAsOf,
        queues: pt.pwdQueues,
        permRequestsPending: pt.pwdPermBacklog,
      },
      pendingPermByFilingMonth: backlog
        ? backlog.map((m) => ({
            month: m.month,
            filed: m.total,
            decided: m.decided,
            pending: m.pending,
            inAnalystReview: m.analystReview ?? null,
          }))
        : null,
    },
    meta: {
      source: "U.S. Department of Labor, FLAG processing times; pending counts from PERM Tracker's sweep of DOL case statuses",
      asOf: pt.permAsOf,
      url: `${SITE_URL}/perm-processing-times`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Visa bulletin                                                       */
/* ------------------------------------------------------------------ */


export async function readBulletin(month?: string | null): Promise<ReadResult<Record<string, unknown>>> {
  if (month && !ISO_MONTH_RE.test(month)) return bad("month must look like 2026-10.");
  const cols = "bulletin_month, source_url, final_action, dates_for_filing, family_final_action, family_dates_for_filing";
  const r = month
    ? await one<Record<string, string | null>>(`SELECT ${cols} FROM visa_bulletins WHERE bulletin_month = ?`, [month])
    : await one<Record<string, string | null>>(`SELECT ${cols} FROM visa_bulletins ORDER BY bulletin_month DESC LIMIT 1`);
  if (!r) {
    const span = await one<{ first: string | null; last: string | null }>(
      "SELECT min(bulletin_month) AS first, max(bulletin_month) AS last FROM visa_bulletins",
    ).catch(softFail("api/reads.bulletinSpan", null));
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: span?.first
        ? `No bulletin held for that month. The archive runs from ${span.first} to ${span.last}, with a few months missing.`
        : "No bulletin held for that month.",
    };
  }
  const parse = (v: string | null | undefined) => (v ? JSON.parse(v) : null);
  const m = r.bulletin_month as string;
  return {
    ok: true,
    data: {
      month: m,
      cells: "As printed: a date like 15JAN13, C (current: every priority date may proceed) or U (unavailable).",
      employment: { finalAction: parse(r.final_action), datesForFiling: parse(r.dates_for_filing) },
      family: { finalAction: parse(r.family_final_action), datesForFiling: parse(r.family_dates_for_filing) },
      sourceUrl: r.source_url,
    },
    meta: { source: "U.S. Department of State, Visa Bulletin", asOf: `${m}-01`, url: `${SITE_URL}/visa-bulletin/${m}` },
  };
}

/* ------------------------------------------------------------------ */
/* Employers, law firms, occupations                                   */
/* ------------------------------------------------------------------ */

/** The URL segment for each kind, and the site's page for it. */
export const ENTITY_PATHS: Record<string, { kind: EntityKind; page: string }> = {
  employers: { kind: "employer", page: "/perm-employers" },
  "law-firms": { kind: "attorney", page: "/perm-attorneys" },
  occupations: { kind: "occupation", page: "/perm-wages" },
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

function entityData(kind: EntityKind, page: string, e: NonNullable<Awaited<ReturnType<typeof getEntityBySlug>>>) {
  return {
    kind,
    slug: e.slug,
    name: e.name,
    rankByVolume: e.rank,
    publishedCases: e.total,
    certified: e.certified,
    denied: e.denied,
    certifiedShare: certifiedShare(e.certified, e.denied),
    medianDaysToDecision: e.medianDays,
    // Each kind carries only the fields its record holds: an occupation its
    // code and median offered wage, a law firm its state. Printing null for
    // the others read as missing data.
    ...(kind === "occupation" ? { occupationCode: e.code, medianAnnualWage: e.medianAnnualWage } : {}),
    ...(kind === "attorney" ? { state: e.state } : {}),
    filingsLast12Months: e.recent12m,
    url: `${SITE_URL}${page}/${e.slug}`,
  };
}

/**
 * The dates an entity answer is true for: the last decision in DOL's published
 * files (the counts, rates and medians), and the sweep that read DOL's live
 * status (the pending count). A failed read leaves the date null rather than
 * failing the answer.
 */
async function entityDates(): Promise<{ disclosedThrough: string | null; sweptOn: string | null }> {
  const f = await getFreshness().catch(softFail("api/reads.getFreshness", {} as Record<string, { asOf: string | null } | undefined>));
  return { disclosedThrough: day(f["perm-cases"]?.asOf), sweptOn: day(f["perm-case-status"]?.asOf) };
}

export async function readEntity(kind: EntityKind, slug: string): Promise<ReadResult<Record<string, unknown>>> {
  if (!isEntityKind(kind)) return bad("Unknown kind.");
  if (!SLUG_RE.test(slug)) return bad("That isn't a valid name in a URL. Search by name first to find it.");
  const page = Object.values(ENTITY_PATHS).find((p) => p.kind === kind)!.page;
  const [e, dates, live] = await Promise.all([
    getEntityBySlug(kind, slug),
    entityDates(),
    entityPending(kind, slug).catch(softFail("api/reads.entityPending", null)),
  ]);
  if (!e) return { ok: false, status: 404, code: "not_found", message: "No page by that name. Search by name to find the right one." };
  return {
    ok: true,
    data: {
      ...entityData(kind, page, e),
      // DOL's live status for this entity's cases, from the latest sweep: the
      // queue the published files can't show, because they hold decided cases only.
      pendingNow: live
        ? {
            pending: live.pending,
            casesTracked: live.tracked,
            byStatus: live.stages.map((st) => ({ status: st.status, cases: st.n })),
            oldestPendingFiled: live.oldest ? live.oldest.slice(0, 10) : null,
            asOf: dates.sweptOn,
          }
        : null,
    },
    meta: {
      source: "U.S. Department of Labor, OFLC PERM disclosure files (decided cases) and FLAG case status (pending)",
      asOf: dates.disclosedThrough,
      url: `${SITE_URL}${page}/${e.slug}`,
    },
  };
}

/** Search by name; `max` is the most one answer may hold (100 a page, an export's plan cap). */
export async function searchEntities(
  kind: EntityKind,
  q: string,
  limit = 25,
  max = 100,
): Promise<ReadResult<{ results: Record<string, unknown>[]; more: boolean }>> {
  if (!isEntityKind(kind)) return bad("Unknown kind.");
  const needle = q.trim();
  if (needle.length < 2 || needle.length > 120) return bad("Search with 2 to 120 characters.");
  const take = Math.min(Math.max(1, Math.floor(limit)), max);
  const page = Object.values(ENTITY_PATHS).find((p) => p.kind === kind)!.page;
  const [found, dates] = await Promise.all([searchByName(kind, needle, take + 1), entityDates()]);
  return {
    ok: true,
    data: {
      results: found.slice(0, take).map((e) => entityData(kind, page, e)),
      // One more was asked for so the answer can say there are more, rather
      // than imply it found everything.
      more: found.length > take,
    },
    meta: {
      source: "U.S. Department of Labor, OFLC PERM disclosure files (decided cases)",
      asOf: dates.disclosedThrough,
      url: `${SITE_URL}${page}?q=${encodeURIComponent(needle)}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Estimate                                                            */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function readEstimate(args: { caseNumber?: string | null; filed?: string | null }): Promise<
  ReadResult<Record<string, unknown>>
> {
  const today = new Date().toISOString().slice(0, 10);
  let filingDate: string | null = null;
  let status = "ANALYST REVIEW";
  let url = `${SITE_URL}/tools/perm-timeline-calculator`;

  let rfiEntered: string | null = null;
  if (args.caseNumber) {
    const ref = normaliseFlagCaseNumber(args.caseNumber.slice(0, 40));
    if (!ref) return bad("That isn't a case number.");
    if (ref.program !== "perm") return bad("Decision estimates cover PERM cases (G-100-...). Use /v1/queue for the wage-request queue.");
    url = `${SITE_URL}/perm-case-status?case=${encodeURIComponent(ref.caseNumber)}`;
    const r = await lookupCase(ref.caseNumber, { discover: false });
    if (!r || (!r.live && !r.decided)) {
      return { ok: false, status: 404, code: "not_found", message: "No record of this case yet, so no estimate. Try again tomorrow, or pass filed=YYYY-MM-DD.", url };
    }
    // DOL's live status decides when there is one: an appealed case is in the
    // published file as decided and pending again live, and the case page
    // gives it the no-date answer, so this must too.
    if (r.live ? r.live.isFinal : Boolean(r.decided)) {
      return {
        ok: true,
        data: { kind: "decided", status: r.live?.status ?? r.decided?.status ?? null, decisionDate: r.decided?.decisionDate ?? null },
        meta: { source: DOL_SOURCE, asOf: day(r.live?.lastCheckedAt) ?? r.decided?.decisionDate ?? null, url },
      };
    }
    filingDate = r.live?.filingDate ?? null;
    status = r.live?.status ?? status;
    // An RFI case is dated from its own RFI day, as on the case page.
    if (status?.trim().toUpperCase() === "RFI ISSUED") rfiEntered = await rfiEnteredOn(ref.caseNumber).catch(softFail("api/reads.readEstimate.rfiEnteredOn", null));
  } else if (args.filed) {
    if (!DATE_RE.test(args.filed)) return bad("filed must look like 2026-02-15.");
    if (args.filed > today) return bad("filed can't be in the future.");
    filingDate = args.filed;
  } else {
    return bad("Pass case=G-100-... or filed=YYYY-MM-DD.");
  }
  if (!filingDate) return { ok: false, status: 404, code: "not_found", message: "This case has no filing date on record, so no estimate.", url };

  const ctx = await loadPermEstimateContext();
  const { estimate, casesAhead } = estimatePermCase(ctx, { filingDate, status, rfiEnteredOn: rfiEntered }, today);
  const meta: ApiMeta = {
    source: "PERM Tracker's estimate, from DOL's published queue and the decision pace our sweep measures. An estimate, not a promise.",
    asOf: today,
    url,
  };
  if (!estimate) {
    return { ok: true, data: { kind: "none", filingDate, status, note: "No model can give this case a defensible date." }, meta };
  }
  if (estimate.kind === "no-date") {
    return { ok: true, data: { kind: "no-date", filingDate, status, note: estimate.note, waitedDays: estimate.age }, meta };
  }
  return {
    ok: true,
    data: {
      kind: "date",
      filingDate,
      status,
      estimatedDate: estimate.estimatedDate,
      earliest: estimate.earliestDate,
      latest: estimate.latestDate,
      model: estimate.modelLabel,
      basis: estimate.basis,
      pendingCasesAhead: casesAhead,
      caveats: estimate.caveats,
    },
    meta,
  };
}

/* ------------------------------------------------------------------ */
/* Finding a case without its number                                    */
/* ------------------------------------------------------------------ */

/** Cases one answer lists. A longer answer says it was cut; another box or closer dates narrow it. */
const FOUND_MAX = 50;

/**
 * A case found from what a caller knows about it, with no case number: any of the employer's name, words of the
 * job title and the law firm, with one filing day (`filed`), a range of days (`from` and `to`) or no date at all.
 * One of them is enough. The same read and the same matching as the site's finder (src/lib/findCase.ts), so the
 * API, the MCP tool, the chat and the page answer the same ask the same way. A failed read throws to the route's
 * 500, never "none".
 */
export async function findCases(args: {
  employer?: string | null;
  /** One filing day. The same as `from` and `to` both set to it. */
  filed?: string | null;
  from?: string | null;
  to?: string | null;
  program?: string | null;
  job?: string | null;
  firm?: string | null;
}): Promise<ReadResult<Record<string, unknown>>> {
  // Lengths first, then shapes: nothing below walks a string it hasn't capped.
  const employer = (args.employer ?? "").slice(0, 121).trim();
  const job = (args.job ?? "").slice(0, 81).trim();
  const firm = (args.firm ?? "").slice(0, 121).trim();
  const filed = (args.filed ?? "").slice(0, 11).trim();
  const from = (args.from ?? "").slice(0, 11).trim();
  const to = (args.to ?? "").slice(0, 11).trim();
  const program = (args.program ?? "perm").slice(0, 12).trim().toLowerCase();
  if (employer.length > 120 || (employer !== "" && !enoughTyped(employer))) return bad("employer must be 2 to 120 characters of the employer's name.");
  if (job.length > 80) return bad("job must be at most 80 characters.");
  if (firm.length > 120 || (firm !== "" && !enoughTyped(firm))) return bad("firm must be 2 to 120 characters of the law firm's name.");
  if (filed && !DATE_RE.test(filed)) return bad("filed must be the filing day, like 2026-01-30.");
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return bad("from and to must be days, like 2026-01-30.");
  if (filed && (from || to)) return bad("Give filed for one day, or from and to for a range of days, not both.");
  if (!(FILING_PROGRAMS as readonly string[]).includes(program)) return bad(`program must be one of ${FILING_PROGRAMS.join(", ")}.`);
  const today = easternDay();

  const kind = program as FilingProgram;
  const got = await findCase(kind, { employer, title: job, firm, from: filed || from, to: filed || to }, today);
  if (!got.ok) return bad(got.message);
  const a = got.answer;
  const oneDay = a.window && !a.window.assumed && a.window.from === a.window.to ? a.window.from : null;
  return {
    ok: true,
    data: {
      program: kind,
      programName: PROGRAM_NAMES[kind],
      // "window": every case filed in the days read, matched by any word of the employer's name. "index": the
      // case search's index for the employer (by the start of its name) or the law firm, over any dates.
      readBy: a.by,
      // The days read. `assumed` is the newest three months, when no date was given with a job title alone.
      window: a.window,
      ...(oneDay ? { filed: oneDay } : {}),
      // What DOL's record holds for the days read, whatever was asked. `day` is the same under its older name.
      period: a.period,
      ...(oneDay && a.period ? { day: a.period } : {}),
      matchedEmployer: a.ofEmployer,
      matched: a.matched,
      cases: a.cases.slice(0, FOUND_MAX).map((c) => ({
        caseNumber: c.caseNumber,
        status: c.status,
        isFinal: c.final,
        employer: c.employer,
        jobTitle: c.jobTitle,
        filedOn: c.filedOn || null,
        decisionDate: c.decided ?? null,
        worksiteState: c.state ?? null,
        wageRequest: c.wageRequest ?? null,
        lawFirm: c.firm ?? null,
        url: `${SITE_URL}/perm-case-status?case=${encodeURIComponent(c.caseNumber)}`,
      })),
      truncated: a.matched > FOUND_MAX || a.capped,
      // With no employer fitting in a window of a month or less: the employers that did file in it under a close spelling.
      closeNames: a.close,
      // The firm a typed law firm's words named, with the other firms they could mean.
      lawFirm: a.firm ? { name: a.firm.name, alternatives: a.firm.alternatives.map((f) => f.name) } : null,
      lawFirmUnknown: a.firmUnknown,
      // A law firm was asked for: DOL names it only once a case is decided, so no pending case can be listed.
      decidedOnly: a.decidedOnly,
      // A read stopped at its limit, so a case can be missing from this answer.
      dayListCapped: a.capped,
    },
    meta: {
      source: DOL_SOURCE,
      asOf: today,
      url: oneDay ? `${SITE_URL}${dayHref(oneDay, kind)}` : `${SITE_URL}/case-search${employer ? `?q=${encodeURIComponent(employer)}` : ""}`,
    },
  };
}

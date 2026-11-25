/**
 * The figure reads behind API 1.2: USCIS's own I-140 and I-485 figures, the receipt-number sample, the consulates,
 * the timelines people reported and the estimates' own record. Each is built from the reads the site's pages use,
 * and /v1, /mcp and the chat all call these, so an endpoint, its tool and its page can't disagree.
 *
 * AGGREGATES ONLY. The sample's answers carry counts and shares by block, month and form. A receipt number never
 * leaves this module: `noReceipts` refuses any answer holding one, and the tests feed it one. The timelines carry
 * the stored summaries, whose small groups are already withheld, and the short names the page shows for sources.
 *
 * A PART THAT CAN'T BE READ IS NAMED. An answer built from several reads lists the ones that failed in `unreadable`
 * and sends null for them, never an empty list that reads as "none". With every part failed it throws, which the
 * route answers as a 500 that isn't counted.
 *
 * The figures change at most daily, so each answer is kept in memory for a few minutes per copy of the site.
 */
import "server-only";

import { SITE_URL } from "@/lib/constants/site";
import { monthsBehind, IV_CATEGORIES, type IvCell } from "@/lib/consular/scheduling";
import { getConsularIndex, getPostDetail, type PostSummary } from "@/lib/db/consularPosts";
import { getReportedOverview } from "@/lib/db/communityReports";
import { getEstimateChecks } from "@/lib/db/estimateChecks";
import { getEstimatorBacktest, getScorecardSummary } from "@/lib/db/predictions";
import { getI140Trends, getI485Trend } from "@/lib/db/publicData";
import { getOfficeSummary, getPostSummary, getReportedSummary } from "@/lib/db/reportedSummary";
import { getI140Snapshot } from "@/lib/db/uscisI140";
import { getUscisPosted } from "@/lib/db/uscisPosted";
import { getEbAwaitingVisa, getI485Offices, getUscisFormMedian, type UscisFormMedian } from "@/lib/db/uscisQuarterly";
import { getBlockMoves, getSampleBlocks, getSampleMeta, getSampleMonths } from "@/lib/db/uscisSample";
import { shortSourceName } from "@/lib/reportedCases";
import type { PlaceSummary, ReportedSummary, StepFigure, WaitingSummary } from "@/lib/reportedSummary";
import type { Cell } from "@/lib/scorecard/score";
import { softFail } from "@/lib/softRead";
import { officeHref } from "@/lib/uscisOffices";
import type { UscisPosted } from "@/lib/uscisPosted";
import type { OfficeRow } from "@/lib/uscisQuarterlyShape";
import {
  approvalsStopAfter,
  blockForms,
  blockSeries,
  formFigure,
  monthFigures,
  neighbours,
  topForms,
  topFormsIn,
  type FormFigure,
} from "@/lib/uscisSample";

import type { ReadResult } from "./reads";

/** A receipt number's shape: three letters and ten digits (IOE0912345678, EAC2412345678). */
export const RECEIPT_SHAPE = /[A-Za-z]{3}\d{10}/;

const bad = (message: string): ReadResult<never> => ({ ok: false, status: 400, code: "bad_request", message });
const notLoaded = (what: string): ReadResult<never> => ({
  ok: false,
  status: 503,
  code: "unavailable",
  message: `${what} aren't loaded right now. Try again later.`,
  retryAfter: 3600,
});

/** Refuse to send an answer holding anything shaped like a receipt number. A throw is a 500, never a leak. */
export function noReceipts<T>(result: ReadResult<T>): ReadResult<T> {
  if (result.ok && RECEIPT_SHAPE.test(JSON.stringify(result.data))) {
    throw new Error("figureReads refused an answer holding a receipt-shaped string");
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Kept a few minutes                                                  */
/* ------------------------------------------------------------------ */

const KEEP_MS = 10 * 60_000;
const KEEP_MAX = 256;
type Answer = ReadResult<Record<string, unknown>>;
const kept = new Map<string, { at: number; value: Answer }>();

/** One answer per key for KEEP_MS. Only an answer or a "no such record" is kept. A failure is asked again. */
async function keep(key: string, read: () => Promise<Answer>): Promise<Answer> {
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const value = await read();
  if (value.ok || value.status === 404) {
    if (kept.size >= KEEP_MAX) kept.delete(kept.keys().next().value!);
    kept.set(key, { at: Date.now(), value });
  }
  return value;
}

/** For the tests: forget every kept answer. */
export function forgetKeptFigures(): void {
  kept.clear();
}

/** Reads that may fail one by one: each failure is logged and named, and its part is null. */
function partsReader(where: string) {
  const unreadable: string[] = [];
  const errors: unknown[] = [];
  const soft = <T,>(name: string, p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      softFail(`api/figureReads.${where}.${name}`, null)(err);
      unreadable.push(name);
      errors.push(err);
      return null;
    });
  /** Throws the first failure when every part failed, so the route answers 500 rather than an empty answer. */
  const settle = (total: number) => {
    if (errors.length > 0 && errors.length === total) throw errors[0];
  };
  return { unreadable, soft, settle };
}

/* ------------------------------------------------------------------ */
/* The receipt-number sample                                           */
/* ------------------------------------------------------------------ */

const SAMPLE_SOURCE =
  "PERM Tracker's sample of USCIS receipt numbers, each checked on USCIS's Case Status page. Shares are estimates with a 95% margin.";
const BLOCK_RE = /^IOE\d{5}$/;
const FORM_RE = /^[A-Z]{1,3}-?\d{1,4}[A-Z]{0,3}$/;

/** "i485" or "I-485" as "I-485"; null for anything that isn't shaped like a USCIS form. */
export function formName(input: string | null | undefined): string | null {
  const s = (input ?? "").slice(0, 12).trim().toUpperCase();
  if (!FORM_RE.test(s)) return null;
  return s.includes("-") ? s : s.replace(/^([A-Z]+)(\d)/, "$1-$2");
}

const figureOut = (form: string, f: FormFigure) => ({ form, counted: f.counted, groups: f.groups });

/** The form asked for, or I-485 when it's held, or the most sampled form. */
function pickForm(asked: string | null, held: string[]): string | null {
  if (asked) return asked;
  return held.includes("I-485") ? "I-485" : (held[0] ?? null);
}

export async function readReceiptBlocks(formInput?: string | null): Promise<ReadResult<Record<string, unknown>>> {
  const asked = formInput ? formName(formInput) : null;
  if (formInput && !asked) return bad("form must be a USCIS form, like I-485 or I-765.");
  return keep(`blocks:${asked ?? ""}`, async () => {
    const [doc, meta] = await Promise.all([getSampleBlocks(), getSampleMeta().catch(softFail("api/figureReads.sampleMeta", null))]);
    if (!doc) return notLoaded("The sample's figures");
    const forms = topForms(doc, 12);
    const form = pickForm(asked, forms);
    const series = form ? blockSeries(doc, form) : [];
    if (!form || series.length === 0) {
      return { ok: false, status: 404, code: "not_found", message: `The sample counts no ${asked ?? "form"} in any block. Its forms: ${forms.join(", ")}.`, url: `${SITE_URL}/uscis-receipt-blocks` };
    }
    return noReceipts({
      ok: true,
      data: {
        form,
        forms,
        approvalsSeenUpTo: approvalsStopAfter(series),
        blocks: series.map((p) => ({ block: p.block, counted: p.counted, groups: formFigure(doc.by_block[p.block] ?? {}, form)!.groups })),
        casesInSample: meta?.cases ?? null,
      },
      meta: { source: SAMPLE_SOURCE, asOf: doc.as_of, url: `${SITE_URL}/uscis-receipt-blocks` },
    });
  });
}

export async function readReceiptBlock(blockInput: string): Promise<ReadResult<Record<string, unknown>>> {
  // The answer never repeats what was sent: a whole receipt number sent here stays out of every message.
  const block = blockInput.slice(0, 12).trim().toUpperCase();
  if (!BLOCK_RE.test(block)) return bad("A block is IOE and five digits, like IOE09366: the first eight characters of an online receipt number.");
  return keep(`block:${block}`, async () => {
    const [doc, moves] = await Promise.all([getSampleBlocks(), getBlockMoves(block)]);
    if (!doc) return notLoaded("The sample's figures");
    const forms = blockForms(doc.by_block[block] ?? {});
    const near = neighbours(doc, block);
    const url = `${SITE_URL}/uscis-receipt-blocks/${block}`;
    if (forms.length === 0) {
      const around = [near.before, near.after].filter(Boolean).join(" and ");
      return {
        ok: false,
        status: 404,
        code: "not_found",
        message: `The sample holds no cases in ${block} yet.${around ? ` The nearest blocks with cases: ${around}.` : ""}`,
        url: `${SITE_URL}/uscis-receipt-blocks`,
      };
    }
    return noReceipts({
      ok: true,
      data: {
        block,
        forms: forms.map((f) => figureOut(f.form, f.figure)),
        before: near.before,
        after: near.after,
        recentMoves: moves.map((m) => ({ day: m.on_day, form: m.form, movedTo: m.to_grp, cases: m.n })),
      },
      meta: { source: SAMPLE_SOURCE, asOf: doc.as_of, url },
    });
  });
}

export async function readReceiptMonths(formInput?: string | null): Promise<ReadResult<Record<string, unknown>>> {
  const asked = formInput ? formName(formInput) : null;
  if (formInput && !asked) return bad("form must be a USCIS form, like I-485 or I-765.");
  return keep(`months:${asked ?? ""}`, async () => {
    const doc = await getSampleMonths();
    if (!doc) return notLoaded("The sample's figures");
    const forms = topFormsIn(doc.by_month, 12);
    const form = pickForm(asked, forms);
    const rows = form ? monthFigures(doc, form) : [];
    if (!form || rows.length === 0) {
      return { ok: false, status: 404, code: "not_found", message: `The sample counts no ${asked ?? "form"} in any month. Its forms: ${forms.join(", ")}.`, url: `${SITE_URL}/uscis-receipt-blocks` };
    }
    return noReceipts({
      ok: true,
      data: {
        form,
        forms,
        months: rows.map((r) => ({ month: r.month, counted: r.figure.counted, walked: r.walked, groups: r.figure.groups })),
      },
      meta: { source: SAMPLE_SOURCE, asOf: doc.as_of, url: `${SITE_URL}/uscis-receipt-blocks` },
    });
  });
}

/* ------------------------------------------------------------------ */
/* USCIS's own figures                                                 */
/* ------------------------------------------------------------------ */

const medianOut = (m: UscisFormMedian | null) =>
  m ? { months: m.medianMonths, title: m.title, fiscalYear: m.fy, quarter: m.quarter, quarterEnd: m.quarterEnd } : null;

function postedOut(posted: UscisPosted | null, form: string) {
  if (!posted) return null;
  const rows = posted.newest.filter((r) => r.form === form);
  if (rows.length === 0) return null;
  return {
    postedOn: posted.published,
    rows: rows.map((r) => ({
      subtype: r.subtype,
      office: r.office,
      months: r.posted,
      asPrinted: r.postedText,
      label: r.label,
      officeLabel: r.officeLabel,
      inquiryFrom: r.requestDate,
    })),
  };
}

const USCIS = "U.S. Citizenship and Immigration Services";

export async function readUscisI140(): Promise<ReadResult<Record<string, unknown>>> {
  return keep("i140", async () => {
    const { unreadable, soft, settle } = partsReader("i140");
    const [snapshot, trends, median, posted, awaiting] = await Promise.all([
      soft("quarter", getI140Snapshot(3600)),
      soft("byQuarter", getI140Trends()),
      soft("medianMonths", getUscisFormMedian("I-140")),
      soft("processingTimes", getUscisPosted()),
      soft("awaitingVisa", getEbAwaitingVisa()),
    ]);
    settle(5);
    // The newest eight quarters, oldest first, every category in each.
    const quarters = [...new Set((trends ?? []).map((t) => t.fiscalYear * 10 + t.quarter))].sort((a, b) => a - b).slice(-8);
    const data = {
      quarter: snapshot ? { fiscalQuarter: snapshot.asOfQuarter, sourceFile: snapshot.sourceFile, subtypes: snapshot.subtypes } : null,
      byQuarter: trends ? trends.filter((t) => quarters.includes(t.fiscalYear * 10 + t.quarter)) : null,
      medianMonths: medianOut(median),
      processingTimes: postedOut(posted, "I-140"),
      awaitingVisa: awaiting ? { month: awaiting.asOf, sourceFile: awaiting.sourceFile, cells: awaiting.cells } : null,
      unreadable,
    };
    if (!data.quarter && !data.byQuarter?.length && !data.medianMonths && !data.processingTimes && !data.awaitingVisa) {
      return notLoaded("USCIS's I-140 figures");
    }
    return {
      ok: true,
      data,
      meta: {
        source: `${USCIS}: quarterly I-140 counts, the processing times page, and approved petitions waiting for a visa number. Each part carries its own date.`,
        asOf: null,
        url: `${SITE_URL}/tools/i140-trends`,
      },
    };
  });
}

const officeOut = (r: OfficeRow, previous: Record<string, number | null> | null) => ({
  code: r.code,
  office: r.office,
  state: r.state,
  withheld: r.suppressed,
  employment: {
    received: r.empReceived,
    approved: r.empApproved,
    denied: r.empDenied,
    pending: r.empPending,
    pendingLastQuarter: previous ? (previous[r.code] ?? null) : null,
  },
  family: { received: r.famReceived, approved: r.famApproved, denied: r.famDenied, pending: r.famPending },
  humanitarian: { received: r.humReceived, approved: r.humApproved, denied: r.humDenied, pending: r.humPending },
  other: { received: r.othReceived, approved: r.othApproved, denied: r.othDenied, pending: r.othPending },
  all: { received: r.allReceived, approved: r.allApproved, denied: r.allDenied, pending: r.allPending },
});

export async function readUscisI485(): Promise<ReadResult<Record<string, unknown>>> {
  return keep("i485", async () => {
    const { unreadable, soft, settle } = partsReader("i485");
    const [offices, trend, median, posted] = await Promise.all([
      soft("byOffice", getI485Offices()),
      soft("inventory", getI485Trend()),
      soft("medianMonths", getUscisFormMedian("I-485", "Employment")),
      soft("processingTimes", getUscisPosted()),
    ]);
    settle(4);
    const prev = offices?.previous?.empPendingByCode ?? null;
    const points = (trend ?? []).map((t) => ({ asOf: t.asOf.slice(0, 10), pending: t.total, visaAvailable: t.available, awaitingVisa: t.awaiting }));
    const data = {
      byOffice: offices
        ? {
            fiscalYear: offices.fy,
            quarter: offices.quarter,
            quarterEnd: offices.quarterEnd,
            sourceFile: offices.sourceFile,
            previousQuarter: offices.previous ? { fiscalYear: offices.previous.fy, quarter: offices.previous.quarter } : null,
            total: offices.total ? officeOut(offices.total, prev) : null,
            offices: offices.offices.map((o) => officeOut(o, prev)),
          }
        : null,
      inventory: points.length ? { newest: points[points.length - 1]!, history: points.slice(-24) } : null,
      medianMonths: medianOut(median),
      processingTimes: postedOut(posted, "I-485"),
      unreadable,
    };
    if (!data.byOffice && !data.inventory && !data.medianMonths && !data.processingTimes) return notLoaded("USCIS's I-485 figures");
    return {
      ok: true,
      data,
      meta: {
        source: `${USCIS}: the quarterly I-485 counts by office, the pending employment-based inventory, and the processing times page. Each part carries its own date.`,
        asOf: null,
        url: `${SITE_URL}/i485-by-field-office`,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Consulates                                                          */
/* ------------------------------------------------------------------ */

const STATE_SOURCE = "U.S. Department of State: the IV Scheduling Status Tool and the monthly immigrant visa issuance tables";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

function cellsOut(cells: Record<string, IvCell>, asOf: string | null) {
  return Object.fromEntries(
    IV_CATEGORIES.map((c) => {
      const cell = cells[c];
      return [c, { asPrinted: cell?.printed ?? "", month: cell?.month ?? null, monthsBehind: asOf ? monthsBehind(cell, asOf) : null }];
    }),
  );
}

const postOut = (p: PostSummary, asOf: string | null) => ({
  slug: p.slug,
  name: p.name,
  scheduling: p.now ? cellsOut(p.now, asOf) : null,
  issuedLast12Months: p.issued,
  employmentLast12Months: p.employment,
  url: `${SITE_URL}/consular-posts/${p.slug}`,
});

export async function readConsulates(): Promise<ReadResult<Record<string, unknown>>> {
  return keep("consulates", async () => {
    const index = await getConsularIndex();
    if (!index.posts.length) return notLoaded("State's consulate figures");
    return {
      ok: true,
      data: { asOf: index.asOf, issuedFrom: index.issuedFrom, issuedTo: index.issuedTo, posts: index.posts.map((p) => postOut(p, index.asOf)) },
      meta: { source: STATE_SOURCE, asOf: index.asOf, url: `${SITE_URL}/consular-posts` },
    };
  });
}

export async function readConsulate(slugInput: string): Promise<ReadResult<Record<string, unknown>>> {
  const slug = slugInput.slice(0, 121).trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return bad("That isn't a consulate's slug. The consulates list gives each one's.");
  return keep(`consulate:${slug}`, async () => {
    const post = await getPostDetail(slug);
    if (!post) {
      return { ok: false, status: 404, code: "not_found", message: "No consulate by that slug. The consulates list gives each one's.", url: `${SITE_URL}/consular-posts` };
    }
    const asOf = post.history.length ? post.history[post.history.length - 1]!.asOf : null;
    return {
      ok: true,
      data: {
        ...postOut(post, asOf),
        history: post.history.map((h) => ({ asOf: h.asOf, ...cellsOut(h.cells, h.asOf) })),
        monthlyIssuances: post.months,
      },
      meta: { source: STATE_SOURCE, asOf, url: `${SITE_URL}/consular-posts/${post.slug}` },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Timelines people reported                                           */
/* ------------------------------------------------------------------ */

const TIMELINE_SOURCE =
  "People's own reports of their cases, merged across sources and counted once each. Self-reported. Only the timelines shared on PERM Tracker are checked.";

const stepOut = (s: StepFigure) => ({
  id: s.id,
  label: s.label,
  stage: s.group,
  verified: s.verified,
  cases: s.n,
  windowDays: s.windowDays,
  medianDays: s.median,
  p25Days: s.p25,
  p75Days: s.p75,
  before: s.before ? { medianDays: s.before.median, cases: s.before.n } : null,
  allTime: s.allTime,
  months: s.months.map((m) => ({ month: m.month, cases: m.n, medianDays: m.median })),
});

const waitingOut = (w: WaitingSummary | undefined) =>
  w ? { heardFromDays: w.heardDays, heard: w.heard, byStage: w.byStage, lines: w.lines, unlisted: w.unlisted } : null;

export async function readTimelines(args: { office?: string | null; consulate?: string | null } = {}): Promise<ReadResult<Record<string, unknown>>> {
  const office = (args.office ?? "").slice(0, 8).trim().toUpperCase();
  const consulate = (args.consulate ?? "").slice(0, 121).trim().toLowerCase();
  if (office && consulate) return bad("Give office or consulate, not both.");
  if (office && !/^[A-Z]{3}$/.test(office)) return bad("office must be USCIS's three-letter office code, like SFV.");
  if (consulate && !SLUG_RE.test(consulate)) return bad("consulate must be a consulate's slug, from the consulates list.");
  return keep(`timelines:${office}:${consulate}`, async () => {
    if (office || consulate) {
      const place: PlaceSummary | null = office ? await getOfficeSummary(office) : await getPostSummary(consulate);
      const page = office ? officeHref(office) : `/consular-posts/${consulate}`;
      if (!place) {
        return {
          ok: false,
          status: 404,
          code: "not_found",
          message: `Too few reported cases ${office ? "at that office" : "at that consulate"} for figures, or no such ${office ? "office" : "consulate"}.`,
          url: `${SITE_URL}/green-card-timelines`,
        };
      }
      return {
        ok: true,
        data: {
          scope: office ? "office" : "consulate",
          place: office || consulate,
          asOf: place.today,
          cases: place.cases,
          steps: place.steps.map(stepOut),
          lastWeek: null,
          waiting: waitingOut(place.waiting),
          i140: null,
          overview: null,
          unreadable: [],
        },
        meta: { source: TIMELINE_SOURCE, asOf: place.today, url: `${SITE_URL}${page ?? "/green-card-timelines"}` },
      };
    }
    // The summary is the answer, so its failure throws. The overview is a part the answer can go without.
    const { unreadable, soft } = partsReader("timelines");
    const [summary, overview]: [ReportedSummary | null, Awaited<ReturnType<typeof getReportedOverview>> | null] = await Promise.all([
      getReportedSummary(),
      soft("overview", getReportedOverview()),
    ]);
    if (!summary) return notLoaded("The reported timelines' figures");
    return {
      ok: true,
      data: {
        scope: "all",
        place: null,
        asOf: summary.today,
        cases: summary.headline.cases,
        steps: summary.steps.map(stepOut),
        lastWeek: summary.week ?? null,
        waiting: waitingOut(summary.waiting),
        i140: summary.i140,
        overview: overview
          ? {
              people: overview.people,
              inSeveral: overview.inSeveral,
              i140s: overview.i140s,
              // The names the page shows: a source's own key stays inside the site.
              sources: overview.bySource.map((s) => ({ name: shortSourceName(s.source), cases: s.cases })),
              offices: overview.offices,
            }
          : null,
        unreadable,
      },
      meta: { source: TIMELINE_SOURCE, asOf: summary.today, url: `${SITE_URL}/green-card-timelines` },
    };
  });
}

/* ------------------------------------------------------------------ */
/* The estimates' own record                                           */
/* ------------------------------------------------------------------ */

const gradedOut = (since: string | null, c: Cell | null | undefined) =>
  c
    ? {
        since,
        recorded: c.recorded,
        graded: c.graded,
        typicalMissDays: c.typicalMissDays,
        biasDays: c.biasDays,
        inRangeShare: c.inBandShare,
        within14Share: c.within14Share,
        overdue: c.overdue,
        missAtLeastDays: c.missAtLeastDays,
      }
    : null;

export async function readAccuracy(): Promise<ReadResult<Record<string, unknown>>> {
  return keep("accuracy", async () => {
    const { unreadable, soft, settle } = partsReader("accuracy");
    const [checks, backtest, sample] = await Promise.all([
      soft("checks", getEstimateChecks()),
      soft("permBacktest", getEstimatorBacktest()),
      soft("dailySample", getScorecardSummary()),
    ]);
    settle(3);
    // Ours only: the summary's public half never holds another tracker's figures, and its worked examples (case
    // numbers) aren't part of this answer.
    const ours = (s: { since: string | null; bySource: Record<string, { all: Cell; current?: Cell }> } | undefined) => {
      const o = s?.bySource.ours;
      return gradedOut(s?.since ?? null, o ? (o.current ?? o.all) : null);
    };
    const cur = backtest?.current ?? null;
    const data = {
      checks: checks ? checks.map((c) => ({ key: c.key, estimate: c.estimate, result: c.result, basis: c.basis })) : null,
      permBacktest:
        backtest && cur
          ? {
              from: backtest.t0,
              to: backtest.end,
              decided: cur.decided,
              typicalMissDays: cur.typicalMissDays,
              within7Share: cur.within7Share,
              decidedByEndRight: cur.decidedByEndRight,
            }
          : null,
      dailySample: sample ? { perm: ours(sample.perm), pwd: ours(sample.pwd) } : null,
      unreadable,
    };
    if (!data.checks?.length && !data.permBacktest && !data.dailySample) return notLoaded("The estimates' checks");
    return {
      ok: true,
      data,
      meta: {
        source: "PERM Tracker's own estimates, graded against what DOL and the State Department did",
        asOf: sample?.perm.computedOn?.slice(0, 10) ?? backtest?.end ?? null,
        url: `${SITE_URL}/estimate-scorecard`,
      },
    };
  });
}

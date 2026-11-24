import "server-only";

import { formatDay, formatMonth } from "@/lib/dolFormat";
import { leadLine } from "@/lib/uscisMonthly";
import { monthsBehind } from "@/lib/consular/scheduling";
import { softFail } from "@/lib/softRead";
import type { StepGroup } from "@/lib/reportedSummary";
import type { SourceKind } from "@/lib/sourceKind";
import { getConsularIndex } from "./consularPosts";
import { getLcaSummary } from "./lcaCases";
import { getPermLine } from "./permLine";
import { getPwdLine } from "./pwdDayQueue";
import { getPwdSummary, permPending } from "./pwdCases";
import { getRecordCounts } from "./recordCounts";
import { getUscisFormMedian } from "./uscisQuarterly";
import { getUscisMonthly } from "./uscisMonthly";

/**
 * Each step's one headline figure from the agency itself (DOL, USCIS, State), dated and linked, for the shared
 * "both sources" section (src/components/community/StepBothSources.tsx) that sits beside people's reported cases on
 * every page about a step. Each comes from the reader the step's own page already uses, so the two never differ.
 *
 * A failed read loses only that figure (null), never a page; a figure with no date is never shown.
 */
export interface OfficialHeadline {
  /** The figure itself, as printed: "17,098", "6.1 months". */
  value: string;
  label: string;
  /** What it is and when it was true, as a reader's sentence. */
  note: string;
  href: string;
  /** Our own check of DOL's case-status service is measured; a figure the agency prints is official. */
  kind: SourceKind;
}

const fmt = (n: number) => n.toLocaleString("en-US");

async function pwd(): Promise<OfficialHeadline | null> {
  const [summary, line] = await Promise.all([
    getPwdSummary().catch(softFail("officialHeadlines.pwdSummary", null)),
    getPwdLine().catch(softFail("officialHeadlines.pwdLine", null)),
  ]);
  // PERM's own wage requests: the same count /pwd-cases and the homepage show (the H-1B, H-1B1 and E-3 ones wait apart).
  const waiting = permPending(summary);
  if (!line && !waiting) return null;
  const checked = formatDay(line?.asOf ?? summary?.asOf ?? null);
  if (!checked) return null;
  return {
    value: waiting ? fmt(waiting) : `${fmt(line!.waitDays)} days`,
    label: waiting ? "PERM wage requests waiting at DOL" : "DOL's wage request wait",
    note: line
      ? `DOL is issuing determinations on requests filed ${formatDay(line.day)}, about ${fmt(line.waitDays)} days after filing, by our check of ${checked}.`
      : `By our check of DOL's case-status service on ${checked}.`,
    href: "/pwd-cases",
    kind: "measured",
  };
}

async function perm(): Promise<OfficialHeadline | null> {
  const [counts, line] = await Promise.all([
    getRecordCounts().catch(softFail("officialHeadlines.recordCounts", null)),
    getPermLine().catch(softFail("officialHeadlines.permLine", null)),
  ]);
  const pending = counts?.find((f) => f.label === "PERM cases pending at DOL");
  if (!pending) return null;
  const checked = formatDay(pending.asOf);
  if (!checked) return null;
  return {
    value: fmt(pending.value),
    label: "PERM cases pending at DOL",
    note: line
      ? `DOL is deciding cases filed in ${formatMonth(line.month)}, by our check of every case on ${checked}.`
      : `By our check of every case in DOL's case-status service on ${checked}.`,
    href: "/perm-queue",
    kind: "measured",
  };
}

async function uscisMedian(form: "I-140" | "I-129", href: string): Promise<OfficialHeadline | null> {
  const m = await getUscisFormMedian(form).catch(softFail(`officialHeadlines.median.${form}`, null));
  if (!m || m.medianMonths === null) return null;
  const through = formatDay(m.quarterEnd);
  if (!through) return null;
  return {
    value: `${m.medianMonths} months`,
    label: `USCIS's median for the ${form}`,
    note: `Half of the ${form}s USCIS decided in the quarter that ended ${through} took less time than this.`,
    href,
    kind: "official",
  };
}

async function i485(): Promise<OfficialHeadline | null> {
  const doc = await getUscisMonthly().catch(softFail("officialHeadlines.uscisMonthly", null));
  const line = leadLine(doc, "I-485");
  const newest = line?.points.filter((p) => p.pending !== null).at(-1);
  if (!newest || newest.pending === null) return null;
  const month = formatMonth(newest.month);
  if (!month) return null;
  return {
    value: fmt(newest.pending),
    label: "Employment-based I-485s pending at USCIS",
    note: `At the end of ${month}, from USCIS's monthly report to Congress.`,
    href: "/uscis-processing-times/i-485",
    kind: "official",
  };
}

async function consular(): Promise<OfficialHeadline | null> {
  const index = await getConsularIndex().catch(softFail("officialHeadlines.consularIndex", null));
  if (!index?.asOf) return null;
  const listed = index.posts.filter((p) => p.now);
  if (!listed.length) return null;
  const caughtUp = listed.filter((p) => monthsBehind(p.now?.employment, index.asOf!) === 0).length;
  const when = formatDay(index.asOf);
  if (!when) return null;
  return {
    value: `${fmt(caughtUp)} of ${fmt(listed.length)}`,
    label: "Consulates scheduling employment cases on time",
    note: `From State's immigrant visa scheduling tool, updated ${when}.`,
    href: "/consular-posts",
    kind: "official",
  };
}

async function h1b(): Promise<OfficialHeadline | null> {
  const [median, lca] = await Promise.all([
    uscisMedian("I-129", "/uscis-processing-times/i-129"),
    getLcaSummary().catch(softFail("officialHeadlines.lcaSummary", null)),
  ]);
  if (median) return median;
  const checked = formatDay(lca?.asOf ?? null);
  if (!lca || !lca.pending || !checked) return null;
  return {
    value: fmt(lca.pending),
    label: "LCAs waiting at DOL",
    note: `By our check of DOL's case-status service on ${checked}.`,
    href: "/lca-cases",
    kind: "measured",
  };
}

const READERS: Record<StepGroup, () => Promise<OfficialHeadline | null>> = {
  h1b,
  pwd,
  perm,
  i140: () => uscisMedian("I-140", "/uscis-processing-times/i-140"),
  i485,
  consular,
};

/** The agency's headline figure for each step asked for, read in parallel; a step whose figure couldn't be read is left out. */
export async function getOfficialHeadlines(groups: readonly StepGroup[]): Promise<Partial<Record<StepGroup, OfficialHeadline>>> {
  const got = await Promise.all(groups.map(async (g) => [g, await READERS[g]()] as const));
  return Object.fromEntries(got.filter(([, h]) => h !== null)) as Partial<Record<StepGroup, OfficialHeadline>>;
}

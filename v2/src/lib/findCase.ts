import "server-only";

import {
  CLOSE_NAMES_MAX_DAYS,
  FOUND_MAX,
  boxFilled,
  askedAnything,
  closeNamesAmong,
  employerStem,
  finderWindow,
  matchFound,
  typedWords,
  windowDays,
  type CloseName,
  type FinderAsk,
  type FoundCase,
} from "@/lib/caseFinder";
import { planCaseSearch } from "@/lib/caseSearchRequest";
import { FILINGS_FROM } from "@/lib/filingDay";
import { periodTotal, type FilingProgram } from "@/lib/filingsByDay";
import { softFail } from "@/lib/softRead";
import { formatWage, looksYearly, LOOKS_YEARLY_SHORT } from "@/lib/wageFormat";

import { getFiledInWindow, getWindowEmployers } from "./db/filedWindow";
import { getFilingsByDay } from "./db/filingsByDay";
import { unifiedSearch, type UnifiedCase } from "./db/unifiedSearch";

/**
 * A case found from what a person knows about it: any of the employer's name, the job title and the law firm,
 * with or without the days it was filed between. One function for the site's finder (/api/find-case), the API
 * (/v1/cases), the MCP tool and the chat assistant, so each answers the same ask the same way.
 *
 * HOW AN ASK IS READ. Two ways, chosen by what an index can serve:
 *   - "window": dates a quarter apart or less. Every case filed in the window is read, narrowed in the database,
 *     and matched here by the finder's own rules, so a name fits by any of its words ("morgan" finds JP Morgan)
 *     and a law firm by any spelling that holds the typed words. A job title with no dates reads the newest
 *     quarter, and says so.
 *   - "index": an employer or a law firm with no dates, or with dates further apart. The case search's own
 *     indexes answer (src/lib/db/unifiedSearch.ts): an employer by the start of its name, a firm by the one page
 *     its words name, with the other firms they could mean offered beside it.
 * Either way a firm is in DOL's files alone, so an answer by firm holds decided cases only.
 * Dates further apart than a quarter with no name to lead with are refused with what to add.
 *
 * A failed read throws; nothing here answers a failure with "none".
 */

export interface FindAnswer {
  program: FilingProgram;
  /** What was asked, as it was read: an empty string for a box left empty. The words an answer is described in. */
  asked: { employer: string; title: string; firm: string };
  /** How it was read (see above). */
  by: "window" | "index";
  /** The days read, or null when an index answered with no dates given. `assumed` is the newest quarter, nobody's dates. */
  window: { from: string; to: string; assumed: boolean } | null;
  /** The cases that fit, at most FOUND_MAX. */
  cases: FoundCase[];
  /** How many fit. With `capped`, at least this many. */
  matched: number;
  /** A window read with an employer typed: how many its name fits before a job title or firm narrows them. */
  ofEmployer: number | null;
  /** A read stopped at its limit, so a case can be missing. */
  capped: boolean;
  /** What DOL's record holds for the window, whatever was typed. Null when undated or unread. */
  period: { filed: number; decided: number; waiting: number } | null;
  /** With no employer fitting in a short window: the employers that did file in it under a close spelling. */
  close: CloseName[];
  /** The page a typed law firm's words named, with the other firms they could mean. */
  firm: { name: string; slug: string; alternatives: { name: string; slug: string }[] } | null;
  /** A firm was typed and names no page: the answer is empty, and says so. */
  firmUnknown: boolean;
  /** Only decided cases can be listed, because a firm was asked for. */
  decidedOnly: boolean;
}

export type FindRefusal = {
  ok: false;
  why: "nothing" | "bad-date" | "too-early" | "not-yet" | "too-long" | "bad-ask";
  message: string;
};

export const FIND_REFUSALS: Record<Exclude<FindRefusal["why"], "bad-ask">, string> = {
  nothing: "Give at least one of the employer's name, the job title, the law firm or a filing date.",
  "bad-date": "Dates must be real days, like 2026-01-30.",
  "too-early": `The filings listed start on ${FILINGS_FROM}.`,
  "not-yet": "That day hasn't come yet.",
  "too-long": "Pick dates three months apart or less, or add the employer's name or the law firm.",
};

const refuse = (why: Exclude<FindRefusal["why"], "bad-ask">): FindRefusal => ({ ok: false, why, message: FIND_REFUSALS[why] });

function wageText(wage: number | null, unit: string | null): string | null {
  const text = formatWage(wage, unit);
  if (!text) return null;
  return looksYearly(wage, unit) ? `${text} (${LOOKS_YEARLY_SHORT})` : text;
}

const fromSearch = (c: UnifiedCase): FoundCase => ({
  caseNumber: c.caseNumber,
  status: (c.status || "UNKNOWN").trim().toUpperCase(),
  employer: (c.employerName ?? "").trim(),
  employerSlug: c.employerSlug,
  jobTitle: (c.jobTitle ?? "").trim(),
  final: c.isFinal,
  // Where a case is held isn't said here: a search's row comes from one half, and the other may hold it too.
  fileDate: null,
  decided: c.decidedOn,
  state: c.state,
  wage: wageText(c.wage, c.wageUnit),
  wageRequest: c.wageRequest ?? null,
  ...(c.namedBy ? { namedBy: c.namedBy } : {}),
  filedOn: c.filedOn ?? "",
  firm: c.firmName,
});

/** What DOL's record holds for a window, from the stored day counts. Left out when they can't be read. */
async function periodOf(program: FilingProgram, from: string, to: string): Promise<FindAnswer["period"]> {
  const doc = await getFilingsByDay().catch(softFail("findCase.getFilingsByDay", null));
  if (!doc) return null;
  const t = periodTotal(doc.programs[program].days, from, to);
  return { filed: t.filed, decided: Math.max(0, t.filed - t.waiting), waiting: t.waiting };
}

export async function findCase(
  program: FilingProgram,
  ask: FinderAsk,
  today: string,
): Promise<{ ok: true; answer: FindAnswer } | FindRefusal> {
  if (!askedAnything(ask)) return refuse("nothing");
  const w = finderWindow(ask, today, FILINGS_FROM);
  if (!w.ok && w.why !== "too-long") return refuse(w.why);
  const byName = boxFilled(ask.employer);
  const byFirm = boxFilled(ask.firm);
  const dated = ask.from.trim() !== "" || ask.to.trim() !== "";
  const asked = {
    employer: byName ? ask.employer.trim() : "",
    title: boxFilled(ask.title) ? ask.title.trim() : "",
    firm: byFirm ? ask.firm.trim() : "",
  };
  const base = { program, asked, close: [] as CloseName[], firm: null, firmUnknown: false };

  // A name with no dates, or with dates too far apart for one read: the case search's indexes.
  if ((byFirm || byName) && (!dated || !w.ok)) {
    const from = w.ok ? (dated ? w.from : "") : w.from;
    const to = w.ok ? (dated ? w.to : "") : w.to;
    const p = new URLSearchParams({ programs: program, limit: String(FOUND_MAX + 1), order: "filed-desc" });
    if (byName) p.set("q", ask.employer.trim());
    if (byFirm) p.set("firm", ask.firm.trim());
    if (boxFilled(ask.title)) p.set("title", ask.title.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const plan = await planCaseSearch(p);
    if (plan.kind === "bad") return { ok: false, why: "bad-ask", message: plan.message };
    const window = dated ? { from, to, assumed: false } : null;
    const period = window ? await periodOf(program, from, to) : null;
    const named = plan.resolved.firm;
    const firm = named ? { name: named.name, slug: named.slug, alternatives: named.alternatives.map((a) => ({ name: a.name, slug: a.slug })) } : null;
    if (plan.kind !== "search") {
      // The firm's words name no page, or a name is withheld at its owner's request: nothing fits, said as that.
      return {
        ok: true,
        answer: { ...base, by: "index", window, cases: [], matched: 0, ofEmployer: null, capped: false, period, firm, firmUnknown: plan.kind === "noMatch" && plan.field === "firm", decidedOnly: byFirm },
      };
    }
    const found = await unifiedSearch(plan.args);
    const cases = found.rows.map(fromSearch);
    return {
      ok: true,
      answer: {
        ...base,
        by: "index",
        window,
        cases: cases.slice(0, FOUND_MAX),
        matched: Math.min(cases.length, FOUND_MAX),
        ofEmployer: null,
        capped: cases.length > FOUND_MAX || found.truncated || found.capped,
        period,
        firm,
        decidedOnly: byFirm,
      },
    };
  }

  // Everything else is read from the window itself. Dates too far apart have no name here to lead with.
  if (!w.ok) return refuse("too-long");
  const { cases: read, capped } = await getFiledInWindow(program, w.from, w.to, {
    employerStem: byName ? employerStem(ask.employer) : "",
    // With an employer typed, its name narrows the read and the job title is matched here: the answer says how many
    // cases the employer has before the title narrows them, and a read cut by the title couldn't count those.
    titleWords: byName ? [] : typedWords(asked.title),
    firmWords: typedWords(asked.firm),
  });
  const ofName = byName ? matchFound(read, { employer: ask.employer, title: "", firm: asked.firm }) : null;
  const fits = matchFound(read, { employer: ask.employer, title: asked.title, firm: asked.firm });
  // No employer fits in a short window: the names that did file in it, spelled closest.
  const close =
    byName && ofName !== null && ofName.length === 0 && windowDays(w.from, w.to) <= CLOSE_NAMES_MAX_DAYS
      ? closeNamesAmong(await getWindowEmployers(program, w.from, w.to), ask.employer)
      : [];
  return {
    ok: true,
    answer: {
      ...base,
      by: "window",
      window: { from: w.from, to: w.to, assumed: w.assumed },
      cases: fits.slice(0, FOUND_MAX),
      matched: fits.length,
      ofEmployer: ofName ? ofName.length : null,
      capped: capped || fits.length > FOUND_MAX,
      period: await periodOf(program, w.from, w.to),
      close,
      decidedOnly: byFirm,
    },
  };
}

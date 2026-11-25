/**
 * Backtest: on decided PERM cases, where DOL's file names the wage request (the truth), hide it and ask the case
 * page's rule (src/lib/wageLink.ts) which of the employer's same-title wage requests it was. Measures how often the
 * truth is among the candidates, whether a rule ever drops it, and how often the top-ranked one is it, by how many
 * candidates were left. That rate decides where the page may say "most likely" (wageLink.ts MOST_LIKELY).
 *
 * Reads a local copy of the database only (never the live one: it asks about every decided case). Build and run:
 *   node_modules/.bin/esbuild scripts/backtest_wage_links.ts --bundle --platform=node --format=esm \
 *     --tsconfig=tsconfig.json --outfile=node_modules/.cache/backtest/bt.mjs
 *   node node_modules/.cache/backtest/bt.mjs <copy.db> [--out report.json]
 *
 * Fair to the past: while a case was pending, only the OTHER cases already decided naming a request were known.
 * "strict" counts a naming case only if it was decided before this case was filed; "loose", before this case was
 * decided. The label follows strict. Every case counts in its bucket (by how many candidates were left), a miss
 * whenever the named request isn't the top one, including when it wasn't among the candidates at all.
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

import { daysBetweenOrNull } from "../convex/lib/time";
import { lookbackStart } from "../src/lib/employerWageRequests";
import { narrowWageCandidates, TYPICAL_GAP_DAYS, usesBefore, type WageCandidate } from "../src/lib/wageLink";

const [dbPath, ...rest] = process.argv.slice(2);
const outAt = rest.indexOf("--out");
const out = outAt >= 0 ? rest[outAt + 1] : null;
if (!dbPath) throw new Error("usage: bt.mjs <copy.db> [--out report.json]");

const db = new DatabaseSync(dbPath);
db.exec(`CREATE INDEX IF NOT EXISTS bt_pwd_emp_title ON pwd_cases(employer_slug, upper(trim(job_title)), received_date);
         CREATE INDEX IF NOT EXISTS bt_perm_pwd ON perm_cases(pwd_number);`);
const ISSUED = `(case_status LIKE 'DETERMINATION ISSUED%' OR case_status LIKE 'REDETERMINATION%' OR case_status LIKE 'CENTER DIRECTOR REVIEW%')`;

const cases = db.prepare(
  `SELECT case_number, employer_slug, job_title, received_date, decision_date, pwd_number FROM perm_cases
    WHERE pwd_number LIKE 'P-100-%' AND job_title IS NOT NULL AND trim(job_title) != ''
      AND received_date IS NOT NULL AND employer_slug IS NOT NULL AND employer_slug != ''`,
).all() as { case_number: string; employer_slug: string; job_title: string; received_date: string; decision_date: string | null; pwd_number: string }[];

const pageOf = db.prepare(`SELECT page_slug FROM employer_page_map WHERE source_slug = ?`);
const spellingsOf = db.prepare(`SELECT source_slug FROM employer_page_map WHERE page_slug = ? ORDER BY source_slug LIMIT 2000`);
const namers = db.prepare(`SELECT case_number, decision_date FROM perm_cases WHERE pwd_number = ?`);
const spellCache = new Map<string, string[]>();

function spellings(slug: string): string[] {
  const hit = spellCache.get(slug);
  if (hit) return hit;
  const page = (pageOf.get(slug) as { page_slug?: string } | undefined)?.page_slug || slug;
  const all = (spellingsOf.all(page) as { source_slug: string }[]).map((r) => String(r.source_slug));
  const got = all.length > 0 ? all : [slug];
  spellCache.set(slug, got);
  return got;
}

type Bucket = { cases: number; truthKept: number; top1: number };
const report = {
  cases: 0,
  noCandidates: 0,
  truthNotFound: 0,
  truthDropped: { strict: {} as Record<string, number>, loose: {} as Record<string, number> },
  byKept: { strict: {} as Record<string, Bucket>, loose: {} as Record<string, Bucket> },
  truthGaps: [] as number[],
  typicalGapDays: TYPICAL_GAP_DAYS,
};
const bucketOf = (n: number) => (n >= 6 ? "6+" : n >= 4 ? "4-5" : String(n));

const started = Date.now();
for (const c of cases) {
  const filed = String(c.received_date).slice(0, 10);
  const since = lookbackStart(filed);
  if (!since) continue;
  report.cases += 1;
  const slugs = spellings(String(c.employer_slug));
  const marks = slugs.map(() => "?").join(",");
  const raw = db.prepare(
    `SELECT case_number, received_date, decision_date FROM pwd_cases
      WHERE employer_slug IN (${marks}) AND upper(trim(job_title)) = upper(trim(?))
        AND received_date >= ? AND received_date <= ? AND case_number LIKE 'P-100-%' AND ${ISSUED}`,
  ).all(...slugs, c.job_title, since, filed) as { case_number: string; received_date: string | null; decision_date: string | null }[];
  if (raw.length === 0) {
    report.noCandidates += 1;
    continue;
  }
  const truth = raw.find((r) => r.case_number === c.pwd_number);
  if (!truth) report.truthNotFound += 1;
  const truthGap = daysBetweenOrNull(truth?.decision_date ? String(truth.decision_date).slice(0, 10) : null, filed);
  if (truthGap !== null) report.truthGaps.push(truthGap);
  const uses = new Map(raw.map((r) => [r.case_number, (namers.all(r.case_number) as { case_number: string; decision_date: string | null }[])
    .filter((n) => n.case_number !== c.case_number && n.decision_date).map((n) => String(n.decision_date).slice(0, 10))]));
  for (const mode of ["strict", "loose"] as const) {
    // The other cases known while this one was pending: decided before the cutoff (usesBefore counts only those).
    const cutoff = mode === "strict" ? filed : String(c.decision_date ?? filed).slice(0, 10);
    const cands: WageCandidate[] = raw.map((r) => ({
      caseNumber: r.case_number, received: r.received_date, decided: r.decision_date, ...usesBefore(uses.get(r.case_number), cutoff),
    }));
    const { kept, dropped } = narrowWageCandidates(cands, { caseNumber: c.case_number, filed });
    const lost = dropped.find((d) => d.caseNumber === c.pwd_number);
    if (lost) report.truthDropped[mode][lost.why] = (report.truthDropped[mode][lost.why] ?? 0) + 1;
    if (kept.length === 0) continue;
    const b = (report.byKept[mode][bucketOf(kept.length)] ??= { cases: 0, truthKept: 0, top1: 0 });
    b.cases += 1;
    if (kept.some((k) => k.caseNumber === c.pwd_number)) b.truthKept += 1;
    if (kept[0]?.caseNumber === c.pwd_number) b.top1 += 1;
  }
}

const gaps = report.truthGaps.sort((a, b) => a - b);
const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
const summary = {
  seconds: Math.round((Date.now() - started) / 1000),
  cases: report.cases,
  noCandidates: report.noCandidates,
  truthNotAmongCandidates: report.truthNotFound,
  truthDropped: report.truthDropped,
  medianGapDays: median,
  gapP25: gaps[Math.floor(gaps.length * 0.25)] ?? null,
  gapP75: gaps[Math.floor(gaps.length * 0.75)] ?? null,
  byKept: report.byKept,
};
console.log(JSON.stringify(summary, null, 1));
if (out) writeFileSync(out, JSON.stringify(summary, null, 1));

/**
 * One engine for every figure over people's reported timelines and consulate reports (D7, Nov 25 2026):
 * scripts/lib_reported_summary.py works them out each hourly build, and Convex and the pages read what it stores.
 * The board's step medians (convex/lib/communityTimeline.ts computeMetrics) and the consulate reports' figures
 * (convex/lib/consularReport.ts summarizeReports) were two more engines with their own windows and floors, and are
 * gone. This holds them gone:
 *
 * 1. No file in convex/ or src/ names a retired engine or the queries that served it.
 * 2. No file that reads people's reports (it names their tables, their libs or the stored summary) works out a
 *    median, a percentile or a quantile of its own, beyond the few listed in ALLOWED with the reason each stays.
 * 3. No script but lib_reported_summary.py works out a median over the reported cases.
 *
 * Each rule is probed with a broken input shaped like the copy it stops, so a gate that flags nothing is known to look.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");

/** The retired engines and what served them: a second copy would come back under one of these names. */
const RETIRED = [
  "computeMetrics",
  "summarizeReports",
  "StageMedians",
  "MetricResult",
  "SIDE_METRIC_IDS",
  "OFFICE_METRIC_IDS",
  "consularReports.forPost",
  "consularReports.overview",
] as const;

/** A file reads people's reports when it names one of these. */
const READS_REPORTS = /communityTimeline|consularReport|reported_cases|reported_summary|reportedSummary|reportedCases|community_(case|post|i140)_reports/;

/** Working out a median, a percentile or a quantile, in TypeScript. */
const MEDIAN_TS = /\bnearestRank\s*\(|\bquantiles?\s*\(|\bpercentile\s*\(|\bfunction\s+median\b|\bconst\s+median\s*=|Math\.(ceil|floor)\(\s*0?\.5\s*\*|Math\.floor\(\s*\w+\.length\s*\/\s*2\s*\)/g;

/** The same in Python. */
const MEDIAN_PY = /statistics\.(median|quantiles)\b|\bdef\s+_?median\b|\bnp\.(median|percentile|quantile)\b/;

/**
 * The medians that stay outside the one engine, each with its reason and how many matches the file may hold, so a
 * new one beside them still fails.
 */
const ALLOWED: Readonly<Record<string, { count: number; why: string }>> = {
  "convex/lib/communityTimeline.ts": {
    count: 5,
    why:
      "nearestRank, and the median of each of two figures (two matches each): after a third FTA0 and after each kind of " +
      "contact (thirdFta0, contactOutcomes), " +
      "from the account updates and contacts only this site's timeline form asks for, which the export doesn't carry",
  },
  "src/lib/reportedCases.ts": {
    count: 2,
    why:
      "the days from a transfer to the approval for each transfer day on an office's list of cases (transferCohorts), " +
      "counted over the listed rows the table beside it shows; left for D7's next step, into the office summary",
  },
  "src/lib/db/planFigures.ts": {
    count: 1,
    why: "a median of USCIS's own posted times, never of people's reports",
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_generated" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

interface Source {
  path: string;
  text: string;
}

const isTest = (p: string) => /(__tests__|\.test\.|\.ssr\.test\.)/.test(p);

function codeFiles(): Source[] {
  return ["convex", "src"]
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));
}

function scriptFiles(): Source[] {
  return readdirSync(join(ROOT, "scripts"))
    .filter((n) => n.endsWith(".py") && !n.startsWith("test_"))
    .map((n) => ({ path: `scripts/${n}`, text: readFileSync(join(ROOT, "scripts", n), "utf8") }));
}

/** Comments say what the code did once; only code counts. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

export function retiredNames(files: readonly Source[]): string[] {
  return files.flatMap((f) => RETIRED.filter((name) => code(f.text).includes(name)).map((name) => `${f.path}: ${name}`));
}

export function secondEngines(files: readonly Source[], allowed = ALLOWED): string[] {
  return files.flatMap((f) => {
    if (isTest(f.path) || !READS_REPORTS.test(f.text)) return [];
    const n = (code(f.text).match(MEDIAN_TS) ?? []).length;
    return n > (allowed[f.path]?.count ?? 0) ? [`${f.path}: ${n} median sums, ${allowed[f.path]?.count ?? 0} allowed`] : [];
  });
}

export function secondScripts(files: readonly Source[]): string[] {
  return files.flatMap((f) => {
    if (f.path === "scripts/lib_reported_summary.py" || !READS_REPORTS.test(f.text)) return [];
    const text = f.text.replace(/^\s*#.*$/gm, "");
    return MEDIAN_PY.test(text) ? [`${f.path}: works out a median over the reported cases`] : [];
  });
}

describe("one engine for the community figures (D7)", () => {
  const files = codeFiles();

  it("no file names a retired engine or the queries that served it", () => {
    const self = "src/lib/__tests__/one-community-engine.test.ts";
    expect(retiredNames(files.filter((f) => f.path !== self))).toEqual([]);
  });

  it("no file reading people's reports works out a median of its own, beyond the listed ones", () => {
    expect(secondEngines(files)).toEqual([]);
    // Every allowance is still needed: one that matches nothing is a hole a new copy could use.
    for (const [path, a] of Object.entries(ALLOWED)) {
      const f = files.find((x) => x.path === path);
      expect(f, path).toBeDefined();
      expect((code(f!.text).match(MEDIAN_TS) ?? []).length, `${path}: ${a.why}`).toBe(a.count);
    }
  });

  it("no script but the summary works out a median over the reported cases", () => {
    expect(secondScripts(scriptFiles())).toEqual([]);
  });

  // The probes: each rule fails on a copy shaped like the one it retired.
  it("catches the board's engine coming back", () => {
    const board: Source = {
      path: "convex/lib/communityTimeline.ts",
      text: 'export function computeMetrics(records) { return METRICS.map((m) => nearestRank(vals, 0.5)); }',
    };
    expect(retiredNames([board])).toEqual(["convex/lib/communityTimeline.ts: computeMetrics"]);
    expect(secondEngines([{ ...board, text: `import { x } from "./communityTimeline";\n${board.text}` }], {})).toHaveLength(1);
  });

  it("catches the consulate's engine coming back under a new name", () => {
    const consulate: Source = {
      path: "convex/consularReports.ts",
      text:
        'import { POST_SLUG } from "./lib/consularReport";\n' +
        "function median(values) { const s = [...values].sort((a, b) => a - b); return s[Math.ceil(0.5 * s.length) - 1]; }",
    };
    expect(secondEngines([consulate])).toEqual(["convex/consularReports.ts: 2 median sums, 0 allowed"]);
    // A page reading the stored summary may draw a median, never work one out.
    const page: Source = { path: "src/components/consular/X.tsx", text: 'import { reportView } from "@/lib/consularReportView";\nconst median = view.wait.median;' };
    expect(secondEngines([{ ...page, text: page.text.replace("consularReportView", "reportedSummary") }])).toHaveLength(1);
    expect(secondEngines([{ ...page, text: 'import { reportView } from "@/lib/reportedSummary";\n<b>{view.wait.median}</b>' }])).toEqual([]);
    expect(retiredNames([{ path: "src/app/x/page.tsx", text: "queryStatic(api.consularReports.forPost, { post })" }])).toHaveLength(1);
  });

  it("catches a second script working out the reported cases' medians", () => {
    const script: Source = {
      path: "scripts/report_waits.py",
      text: "import statistics\nrows = query('SELECT * FROM reported_cases')\nprint(statistics.median(d for d in rows))\n",
    };
    expect(secondScripts([script])).toEqual(["scripts/report_waits.py: works out a median over the reported cases"]);
    expect(secondScripts([{ ...script, text: "# statistics.median over reported_cases once lived here\n" }])).toEqual([]);
  });

  it("allows a listed median only up to its count", () => {
    const listed = files.find((f) => f.path === "src/lib/reportedCases.ts")!;
    expect(secondEngines([{ ...listed, text: `${listed.text}\nconst median = (xs) => xs[Math.floor(xs.length / 2)];` }])).toHaveLength(1);
  });
});

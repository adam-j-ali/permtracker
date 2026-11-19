/**
 * What people reported about their own I-140s (the merged list, src/lib/reportedCases.ts), as figures: for each
 * category and kind of premium processing, how many were decided, the share approved, the median days from filing to
 * the decision, and the share that got an RFE or a notice of intent to deny. Mostly VisaStats' tracker today, so mostly
 * self-petitions (EB-2 NIW and EB-1A): an employer's I-140 is filed by its lawyer, and the worker rarely reports it.
 *
 * Self-reported and unchecked. People with a fast approval or a denial are likelier to report, so a page shows these
 * beside USCIS's own figures, never in place of them. A figure needs MIN_CASES cases behind it.
 */
import { MS_PER_DAY } from "@/lib/time";

export type Premium = "with filing" | "after filing" | "yes" | "none" | "not given";

export interface I140Case {
  category: string;
  /** The kind of premium processing, as the merge carries it; null when the source doesn't say. */
  premium: Exclude<Premium, "not given"> | null;
  filed: string | null;
  decision: "approved" | "denied" | "withdrawn" | "pending" | null;
  decided: string | null;
  /** "rfe", "noid" or "none", or null when the source doesn't say. */
  rfe: "rfe" | "noid" | "none" | null;
}

export interface I140Figure {
  category: string;
  premium: Premium;
  reported: number;
  decided: number;
  approvedShare: number | null;
  medianDays: number | null;
  /** Of the cases that say whether an RFE or a NOID came. */
  rfeShare: number | null;
}

/** A figure from fewer cases than this reads as a few people's stories, so none is given. */
export const MIN_CASES = 5;
/** The I-140 categories people report, the most reported first. */
export const CATEGORIES = ["EB-2 NIW", "EB-1A", "EB-1B", "EB-1", "EB-2", "EB-3"] as const;
const PREMIUMS: readonly Premium[] = ["with filing", "after filing", "yes", "none", "not given"];
export const PREMIUM_LABELS: Record<Premium, string> = {
  "with filing": "Premium from filing",
  "after filing": "Premium added later",
  yes: "Premium, when not said",
  none: "No premium",
  "not given": "Premium not said",
};
const SELF_PETITIONS = new Set(["EB-2 NIW", "EB-1A"]);

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS_PER_DAY);

function median(xs: number[]): number | null {
  if (xs.length < MIN_CASES) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const share = (part: number, of: number) => (of >= MIN_CASES ? part / of : null);

/** One row per category and kind of premium that has a case, in a fixed order. */
export function i140Figures(cases: readonly I140Case[]): I140Figure[] {
  const out: I140Figure[] = [];
  for (const category of CATEGORIES) {
    for (const premium of PREMIUMS) {
      const group = cases.filter((c) => c.category === category && (c.premium ?? "not given") === premium);
      if (group.length === 0) continue;
      const decided = group.filter((c) => c.decision === "approved" || c.decision === "denied");
      const approved = decided.filter((c) => c.decision === "approved").length;
      const waits = decided
        .filter((c) => c.filed && c.decided && c.decided >= c.filed)
        .map((c) => days(c.filed!, c.decided!));
      const told = group.filter((c) => c.rfe !== null);
      out.push({
        category,
        premium,
        reported: group.length,
        decided: decided.length,
        approvedShare: share(approved, decided.length),
        medianDays: median(waits),
        rfeShare: share(told.filter((c) => c.rfe !== "none").length, told.length),
      });
    }
  }
  return out;
}

type Row = Record<string, string | number | null>;
const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(v as T) ? (v as T) : null;

/** A `reported_cases` row as an I-140 case. A self-petition's priority date is its filing day. */
export function fromI140Row(r: Row): I140Case {
  const category = text(r.category) ?? "";
  return {
    category,
    premium: oneOf(r.premium, ["with filing", "after filing", "yes", "none"] as const),
    filed: text(r.i140_receipt) ?? (SELF_PETITIONS.has(category) ? text(r.priority_date) : null),
    decision: oneOf(r.i140_decision, ["approved", "denied", "withdrawn", "pending"] as const),
    decided: text(r.i140_decided),
    rfe: oneOf(r.i140_rfe, ["rfe", "noid", "none"] as const),
  };
}

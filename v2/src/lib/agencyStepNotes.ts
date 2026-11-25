import type { PostedRow } from "@/lib/uscisPosted";

/**
 * The agencies' own line for a reported step nobody has reported yet, keyed by the step's id in
 * scripts/lib_reported_summary.py. The H-1B line reads USCIS's posted processing times (perm_docs
 * 'uscis_posted_times'); the LCA line is DOL's rule, read from 20 CFR 655.740(a)(1) on Nov 25 2026. A step with no
 * agency figure gets no line.
 */
const H1B_KINDS: readonly { subtype: string; words: string }[] = [
  { subtype: "137-H1B2", words: "for a change of status" },
  { subtype: "137-H1B3", words: "for an extension" },
  { subtype: "137-H1B1", words: "when the visa is issued abroad" },
];

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function joinWords(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function agencyStepNotes(posted: { published: string; newest: readonly PostedRow[] } | null): Record<string, string> {
  const notes: Record<string, string> = {
    "lca-h1b":
      "No agency measures this gap: it's the employer's timing. DOL decides the LCA itself within 7 working days of " +
      "receiving it (20 CFR 655.740).",
  };
  if (posted) {
    const parts = H1B_KINDS.flatMap(({ subtype, words }) => {
      const r = posted.newest.find((x) => x.form === "I-129" && x.subtype === subtype && x.posted !== null);
      return r ? [`${r.posted} months ${words}`] : [];
    });
    if (parts.length) {
      notes.h1b = `USCIS says it decides 80% of H-1B petitions within ${joinWords(parts)} (posted ${day(posted.published)}).`;
    }
  }
  return notes;
}

/**
 * The review stages the case search can filter by, across the three programs.
 *
 * One list for the select, the route and the stage pages' "open in search"
 * links. PERM's stages come from the registry the stage pages are built from,
 * plus analyst review, which has no page of its own (it is the ordinary queue,
 * drawn by month on /perm-queue) but is a perfectly good search filter with an
 * employer or a filing month beside it. The wage-request and LCA stages are
 * the pending statuses DOL's live record actually carries for those programs
 * (measured: wage requests pend at IN PROCESS, RFI ISSUED and
 * PENDING REDETERMINATION; LCAs pend only at IN PROCESS). The H-2A, H-2B and
 * CW-1 stages are every status the live sweep counts as still waiting
 * (PROGRAMS["seasonal"]["pending"] in scripts/ingest_pwd_status_direct.py,
 * pinned by its test), so a stage the sweep can hold a case at is one a reader
 * can list. A stage belongs to exactly one program, and the slug says which.
 * Plain module: the form imports it in the browser and the route on the server.
 */
import { reviewStages, stageMeta, stageSlug } from "@/components/rfi/stageMeta";
import { SEASONAL_STATUSES } from "@/lib/statusDictionary";

export type StageProgram = "perm" | "pwd" | "lca" | "seasonal";

export interface SearchStage {
  slug: string;
  status: string;
  program: StageProgram;
  label: string;
}

export const ANALYST_REVIEW = "ANALYST REVIEW";

/**
 * The statuses an H-2A, H-2B or CW-1 case waits at on DOL's live record, in upper case. Must stay identical to
 * PROGRAMS["seasonal"]["pending"] in scripts/ingest_pwd_status_direct.py, whose sweep counts them as still waiting.
 */
export const SEASONAL_PENDING = [
  "IN PROCESS",
  "ACCEPTED - PENDING RECRUITMENT",
  "NOD ISSUED",
  "NRM ISSUED",
  "RFI ISSUED",
  "AVAILABLE FOR 9142A LINKING",
  "POST-CERT REQUEST PENDING",
  "PENDING CENTER DIRECTOR REVIEW",
  "PENDING APPEAL",
  "PENDING BALCA",
] as const;

const FLAG_STAGES: SearchStage[] = [
  { slug: "pwd-in-process", status: "IN PROCESS", program: "pwd", label: "In process" },
  { slug: "pwd-rfi-issued", status: "RFI ISSUED", program: "pwd", label: "RFI issued" },
  { slug: "pwd-pending-redetermination", status: "PENDING REDETERMINATION", program: "pwd", label: "Pending redetermination" },
  { slug: "lca-in-process", status: "IN PROCESS", program: "lca", label: "In process" },
  // H-2A, H-2B and CW-1 applications, their job orders and their wage requests: each named as the status
  // dictionary names it, and spelled as DOL's record spells it ("Post-Cert Request Pending" is mixed case there,
  // and the stage read is an exact match on the stored status).
  ...SEASONAL_PENDING.map((status) => {
    const entry = SEASONAL_STATUSES.find((e) => e.status.toUpperCase() === status);
    return {
      slug: `seasonal-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      status: entry?.status ?? status,
      program: "seasonal" as const,
      label: entry?.label ?? status.charAt(0) + status.slice(1).toLowerCase(),
    };
  }),
];

export const STAGE_PROGRAM_LABEL: Record<StageProgram, string> = {
  perm: "PERM",
  pwd: "Wage requests",
  lca: "H-1B LCAs",
  seasonal: "H-2A, H-2B and CW-1",
};

export function searchStages(): SearchStage[] {
  const perm = [{ status: ANALYST_REVIEW, slug: stageSlug(ANALYST_REVIEW) }, ...reviewStages()].map((s) => ({
    ...s,
    program: "perm" as const,
    label: stageMeta(s.status).label,
  }));
  return [...perm, ...FLAG_STAGES];
}

export function searchStageFromSlug(slug: string): { status: string; program: StageProgram } | null {
  const s = searchStages().find((x) => x.slug === slug);
  return s ? { status: s.status, program: s.program } : null;
}

export function searchStageSlug(status: string, program: StageProgram = "perm"): string | null {
  return searchStages().find((s) => s.status === status && s.program === program)?.slug ?? null;
}

import { apiGet } from "@/lib/api/route";
import { findCases } from "@/lib/api/reads";

export const dynamic = "force-dynamic";

/**
 * GET /v1/cases?employer=Acme&filed=2026-01-30: the cases an employer filed on one day, for a
 * caller with no case number. `program` is perm (the default), pwd, lca or seasonal; `job` narrows
 * a long answer by words of the job title.
 */
export const GET = apiGet(async ({ url }) =>
  findCases({
    employer: url.searchParams.get("employer"),
    filed: url.searchParams.get("filed"),
    program: url.searchParams.get("program"),
    job: url.searchParams.get("job"),
  }),
);

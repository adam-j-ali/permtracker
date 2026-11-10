import { apiGet } from "@/lib/api/route";
import { findCases } from "@/lib/api/reads";

export const dynamic = "force-dynamic";

/**
 * GET /v1/cases?employer=Acme&from=2026-01-05&to=2026-01-31: a case found without its number, from what a caller
 * knows about it. Any of `employer`, `job` (words of the job title) and `firm` (the law firm), with one filing day
 * (`filed`), a range (`from`, `to`) or no date; one of them is enough. `program` is perm (the default), pwd, lca
 * or seasonal.
 */
export const GET = apiGet(async ({ url }) =>
  findCases({
    employer: url.searchParams.get("employer"),
    filed: url.searchParams.get("filed"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    program: url.searchParams.get("program"),
    job: url.searchParams.get("job"),
    firm: url.searchParams.get("firm"),
  }),
);

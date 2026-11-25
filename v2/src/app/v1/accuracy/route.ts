import { readAccuracy } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** How close PERM Tracker's own estimates land. */
export const GET = apiGet(async () => readAccuracy());

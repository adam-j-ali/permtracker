import { readTimelines } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** The timelines people reported, for everyone or for one ?office= or ?consulate=. */
export const GET = apiGet(async ({ url }) =>
  readTimelines({ office: url.searchParams.get("office"), consulate: url.searchParams.get("consulate") }),
);

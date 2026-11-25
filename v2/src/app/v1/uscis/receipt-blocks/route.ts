import { readReceiptBlocks } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** One form's approval shares in every receipt block the sample counts, I-485 unless ?form= says. */
export const GET = apiGet(async ({ url }) => readReceiptBlocks(url.searchParams.get("form")));

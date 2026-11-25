import { readReceiptMonths } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** One form's approval shares by the month USCIS received the cases, I-485 unless ?form= says. */
export const GET = apiGet(async ({ url }) => readReceiptMonths(url.searchParams.get("form")));

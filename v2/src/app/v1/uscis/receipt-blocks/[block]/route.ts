import { readReceiptBlock } from "@/lib/api/figureReads";
import { apiGet } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** One receipt block's figures: each form's shares, the blocks either side, and the newest moves as counts. */
export const GET = apiGet<{ block: string }>(async (_ctx, { block }) => readReceiptBlock(block));

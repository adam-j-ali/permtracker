import { listPolicyNotices } from "@/lib/db/policyNotices";
import { archiveBook } from "@/lib/policyArchive";
import { buildFeed } from "@/lib/policyFeed";
import { easternDay } from "@/lib/time";

/**
 * The lines of every year the policy page folds, fetched the first time a reader opens one
 * (src/components/policy/ArchiveYear.tsx). The page's own window, and expired with it by /api/revalidate-policy, so a
 * year's lines are never from an older list than the page shows. A failed read throws, so the last good file stays.
 */
export const revalidate = 21600;

export async function GET(): Promise<Response> {
  const book = archiveBook(buildFeed(await listPolicyNotices(), easternDay()));
  return Response.json(book, { headers: { "X-Robots-Tag": "noindex" } });
}

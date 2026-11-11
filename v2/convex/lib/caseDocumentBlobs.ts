/**
 * A case's uploaded files live in file storage, and the case row holds only
 * their ids. Deleting the row leaves the files behind unless each is deleted
 * too, so every path that erases a case calls this first.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type WithDocuments = { documents?: { storageId?: string }[] };

/** Deletes each stored file of a case. Returns how many went, and the ids that couldn't be deleted. */
export async function deleteCaseDocumentBlobs(
  ctx: MutationCtx,
  caseDoc: WithDocuments,
): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0;
  const failed: string[] = [];
  for (const doc of caseDoc.documents || []) {
    if (!doc.storageId) continue;
    try {
      await ctx.storage.delete(doc.storageId as Id<"_storage">);
      deleted++;
    } catch {
      failed.push(doc.storageId);
    }
  }
  return { deleted, failed };
}

/**
 * A case document's file is the uploader's own fresh upload (Nov 19 2026 security review). saveDocument took any
 * storage id, handed back its download address and let removeDocument delete the file, and it trusted the size the
 * browser sent. cases.create and cases.update stored a caller's document list as given, and deleting a case deletes
 * every file its list names. Each test below fails on the code before that review.
 */
import { describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createAuthenticatedContext,
  createTestContext,
  finishScheduledFunctions,
  setupSchedulerTests,
} from "../../test-utils/convex";

type T = ReturnType<typeof createTestContext>;
type Who = Awaited<ReturnType<typeof createAuthenticatedContext>>;

async function seed() {
  const t = createTestContext();
  const owner = await createAuthenticatedContext(t, "Owner");
  const caseId = await owner.mutation(api.cases.create, {
    employerName: "Acme",
    positionTitle: "Engineer",
    pwdFilingDate: "2026-01-05",
    pwdDeterminationDate: "2026-02-10",
  });
  await finishScheduledFunctions(t);
  return { t, owner, caseId };
}

const pdf = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
const upload = (t: T, bytes = 10): Promise<Id<"_storage">> => t.run((ctx) => ctx.storage.store(pdf(bytes)));
const save = (who: Who, caseId: Id<"cases">, storageId: string, fileSize = 10) =>
  who.mutation(api.documents.saveDocument, {
    caseId,
    storageId,
    fileName: "letter.pdf",
    contentType: "application/pdf",
    fileSize,
  });
const caseDocs = (t: T, caseId: Id<"cases">) => t.run(async (ctx) => (await ctx.db.get(caseId))?.documents ?? []);

setupSchedulerTests();

describe("saving a document", () => {
  it("attaches a fresh upload and records the size storage measured, never the size the browser sent", async () => {
    const { t, owner, caseId } = await seed();
    const file = await upload(t, 10);
    await save(owner, caseId, file, 5);
    const docs = await caseDocs(t, caseId);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.size).toBe(10);
    expect(docs[0]?.storageId).toBe(file);
  });

  it("refuses a file uploaded more than an hour ago, so nobody can claim an old upload by its id", async () => {
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const { t, owner, caseId } = await seed();
    const old = await upload(t);
    vi.setSystemTime(new Date("2026-11-19T13:01:00Z"));
    await expect(save(owner, caseId, old)).rejects.toThrow();
    expect(await caseDocs(t, caseId)).toHaveLength(0);
  });

  it("refuses an id that names no upload", async () => {
    const { t, owner, caseId } = await seed();
    await expect(save(owner, caseId, "kg2bq7x0000000000000000000000000")).rejects.toThrow();
    expect(await caseDocs(t, caseId)).toHaveLength(0);
  });
});

describe("a case's own document list", () => {
  const entry = (storageId: string) => ({
    id: "doc-1-abc",
    name: "theirs.pdf",
    url: "https://example.invalid/file",
    storageId,
    mimeType: "application/pdf",
    size: 10,
    uploadedAt: 1,
  });

  it("can't bring in a file through cases.update, so deleting the case can't delete someone else's file", async () => {
    const { t, owner, caseId } = await seed();
    const stranger = await upload(t);
    await expect(owner.mutation(api.cases.update, { id: caseId, documents: [entry(stranger)] })).rejects.toThrow();
    expect(await caseDocs(t, caseId)).toHaveLength(0);
  });

  it("can't bring in a file through cases.create", async () => {
    const { t } = await seed();
    const someone = await createAuthenticatedContext(t, "Someone");
    const stranger = await upload(t);
    await expect(
      someone.mutation(api.cases.create, {
        employerName: "Beta",
        positionTitle: "Analyst",
        documents: [entry(stranger)],
      }),
    ).rejects.toThrow();
  });

  it("keeps working when an update sends the case's own documents back unchanged", async () => {
    const { t, owner, caseId } = await seed();
    await save(owner, caseId, await upload(t));
    const docs = await caseDocs(t, caseId);
    await owner.mutation(api.cases.update, { id: caseId, documents: docs });
    expect(await caseDocs(t, caseId)).toEqual(docs);
  });
});

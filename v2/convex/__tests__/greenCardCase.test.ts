/**
 * A saved case past the I-140: the I-485 or the consulate, the work permit and travel document, and the card.
 * Every field is optional, so a case saved before they existed reads and saves as it did.
 */
import { describe, expect, it } from "vitest";
import {
  createAuthenticatedContext,
  createTestContext,
  finishScheduledFunctions,
  setupSchedulerTests,
} from "../../test-utils/convex";
import { api } from "../_generated/api";

setupSchedulerTests();

const PERM_DONE = {
  employerName: "Acme",
  positionTitle: "Engineer",
  pwdFilingDate: "2023-01-10",
  pwdDeterminationDate: "2023-04-10",
  eta9089FilingDate: "2023-08-01",
  eta9089CertificationDate: "2024-05-01",
  i140FilingDate: "2024-06-01",
  i140ApprovalDate: "2024-09-01",
};

async function seed(extra: Record<string, unknown> = {}) {
  const t = createTestContext();
  const owner = await createAuthenticatedContext(t, "Owner");
  const caseId = await owner.mutation(api.cases.create, { ...PERM_DONE, ...extra });
  await finishScheduledFunctions(t);
  const read = () => t.run(async (ctx) => (await ctx.db.get(caseId))!);
  return { t, owner, caseId, read };
}

describe("a case past the I-140", () => {
  it("a case saved without any of the new fields keeps its I-140 stage", async () => {
    const { read } = await seed();
    const c = await read();
    expect(c).toMatchObject({ caseStatus: "i140", progressStatus: "approved" });
    expect(c.greenCardPath).toBeUndefined();
    expect(c.cardReceivedDate).toBeUndefined();
  });

  it("stores every new field it's given and works out the stage from them", async () => {
    const { read } = await seed({
      greenCardPath: "adjustment",
      ebCategory: "EB-3-other",
      countryOfBirth: "IN",
      chargeabilityCountry: "CA",
      i485FilingDate: "2025-01-02",
      i485ReceiptDate: "2025-01-09",
      i485ReceiptNumber: "IOE0000000050",
      i485BiometricsDate: "2025-02-01",
      eadFilingDate: "2025-01-02",
      eadReceiptNumber: "IOE0000000051",
      apFilingDate: "2025-01-02",
      apReceiptNumber: "IOE0000000052",
    });
    const c = await read();
    expect(c).toMatchObject({
      caseStatus: "i485",
      progressStatus: "filed",
      greenCardPath: "adjustment",
      ebCategory: "EB-3-other",
      countryOfBirth: "IN",
      chargeabilityCountry: "CA",
      i485ReceiptNumber: "IOE0000000050",
      eadReceiptNumber: "IOE0000000051",
      apReceiptNumber: "IOE0000000052",
    });
    // The older category follows the newer one, so what reads it (the chat, the export, the I-140 estimate) agrees.
    expect(c.i140Category).toBe("EB-3");
  });

  it("is complete when the card arrives, and leaves complete when the date is cleared", async () => {
    const { t, owner, caseId, read } = await seed({ greenCardPath: "consular" });
    expect((await read()).caseStatus).toBe("consular");

    await owner.mutation(api.cases.update, {
      id: caseId,
      ds260SubmittedDate: "2025-02-01",
      consularInterviewDate: "2025-05-01",
      cardProducedDate: "2025-07-01",
      cardReceivedDate: "2025-07-10",
    });
    await finishScheduledFunctions(t);
    expect(await read()).toMatchObject({ caseStatus: "complete", progressStatus: "approved" });

    await owner.mutation(api.cases.update, { id: caseId, cardReceivedDate: null });
    await finishScheduledFunctions(t);
    const c = await read();
    expect(c).toMatchObject({ caseStatus: "consular", progressStatus: "approved" });
    expect(c.cardReceivedDate).toBeUndefined();
  });

  it("stores an I-485 denial, keeps the case in the I-485 stage, and clears it with null", async () => {
    const { t, owner, caseId, read } = await seed({ i485FilingDate: "2025-01-02", i485DenialDate: "2025-09-01" });
    expect(await read()).toMatchObject({ i485DenialDate: "2025-09-01", caseStatus: "i485", progressStatus: "working" });

    await owner.mutation(api.cases.update, { id: caseId, i485DenialDate: null });
    await finishScheduledFunctions(t);
    const c = await read();
    expect(c.i485DenialDate).toBeUndefined();
    expect(c).toMatchObject({ caseStatus: "i485", progressStatus: "filed" });
  });

  it("refuses an I-485 denial dated before its filing", async () => {
    const { owner, caseId } = await seed({ i485FilingDate: "2025-03-01" });
    await expect(owner.mutation(api.cases.update, { id: caseId, i485DenialDate: "2025-02-01" })).rejects.toThrow(/V-GC-08|denial/i);
  });

  it("clears the choice and the category with null", async () => {
    const { t, owner, caseId, read } = await seed({ greenCardPath: "adjustment", ebCategory: "EB-2" });
    await owner.mutation(api.cases.update, { id: caseId, greenCardPath: null, ebCategory: null });
    await finishScheduledFunctions(t);
    const c = await read();
    expect(c.greenCardPath).toBeUndefined();
    expect(c.ebCategory).toBeUndefined();
    expect(c.caseStatus).toBe("i140");
  });

  it("a save that sends an empty category leaves an older case's I-140 category alone", async () => {
    const { t, owner, caseId, read } = await seed({ i140Category: "EB-3" });
    await owner.mutation(api.cases.update, { id: caseId, ebCategory: null, greenCardPath: null, cardReceivedDate: null });
    await finishScheduledFunctions(t);
    expect((await read()).i140Category).toBe("EB-3");
  });

  it("an EB-5 case carries no I-140 category", async () => {
    const { read } = await seed({ ebCategory: "EB-5", i140Category: undefined });
    expect((await read()).i140Category).toBeUndefined();
  });

  it("refuses dates out of order and a country that isn't a code", async () => {
    const t = createTestContext();
    const owner = await createAuthenticatedContext(t, "Owner");
    await expect(
      owner.mutation(api.cases.create, { ...PERM_DONE, i485FilingDate: "2025-03-01", i485ApprovalDate: "2025-02-01" }),
    ).rejects.toThrow(/V-GC-01/);
    await expect(owner.mutation(api.cases.create, { ...PERM_DONE, countryOfBirth: "India" })).rejects.toThrow(/V-GC-07/);
  });

  it("previewUpdate reports the stage a new date would give", async () => {
    const { owner, caseId } = await seed();
    const p = await owner.query(api.cases.previewUpdate, { id: caseId, cardReceivedDate: "2025-08-01" });
    expect(p).toMatchObject({ valid: true, caseStatus: "complete", progressStatus: "approved" });
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Privacy Policy says what deleting a case does (convex/caseRestore.ts, retention.eraseDeletedCaseCopies): a copy
 * is kept DELETED_CASE_DAYS so it can be restored from Settings, then erased with the record of the case's changes,
 * leaving who deleted it and when, and when it was restored if it was. Its documents and recruitment log go when
 * it's deleted. The days are read from the code's constant, so a
 * changed window changes the policy with it.
 */
const SRC = join(process.cwd(), "src");
const flat = (s: string) => s.replace(/\s+/g, " ");
const page = flat(readFileSync(join(SRC, "app/(site)/(public)/privacy/page.tsx"), "utf8"));
const between = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to, page.indexOf(from)));

const caseData = between(">Case Data<", 'id="counted-cases"');
const retention = between('id="data-retention-deletion"', 'id="your-rights"');

describe("the privacy page and deleted cases", () => {
  it("finds both places", () => {
    expect(caseData.length).toBeGreaterThan(200);
    expect(retention.length).toBeGreaterThan(500);
  });

  it("says in the Case Data list and in section 14 that a deleted case's copy is kept, can be restored from Settings, then is erased", () => {
    for (const part of [caseData, retention]) {
      expect(part).toContain("{DELETED_CASE_DAYS} days so you can restore it from Settings");
      expect(part).toMatch(/then (it&apos;s|it is) erased/i);
      expect(part).toMatch(/documents and recruitment log are deleted when you delete the case or replace it/);
      // Replacing a case by importing a file deletes it the same way (cases.importCases).
      expect(part).toMatch(/when you delete a case, or replace it by importing a file, we keep a copy/i);
    }
    expect(page).toContain('import { DELETED_CASE_DAYS } from "@convex/lib/deletedCases"');
    expect(retention).not.toMatch(/\b30 days so you can restore/);
  });

  it("says in both places that a record of who deleted the case and when stays until the account is deleted", () => {
    for (const part of [caseData, retention]) {
      expect(part).toMatch(/After the copy is erased, we keep a record that your account deleted the case and when/);
      expect(part).toMatch(/We keep that record until you delete your account/);
    }
  });

  // A restored case's deletion keeps restoredAt and restoredCaseId after its copy is erased.
  it("says in both places that the record keeps when a restored case was restored", () => {
    for (const part of [caseData, retention]) {
      expect(part).toMatch(/we keep a record that your account deleted the case and when and, if you restored it, when you did\./);
    }
  });
});

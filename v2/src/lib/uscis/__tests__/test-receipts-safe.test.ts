/**
 * No test or fixture holds a USCIS receipt number that could belong to a real case (RT9b, Nov 25 2026). The repository
 * is public, so a test's number is published. A safe number is one of the site's examples (exampleReceipts.ts), a
 * service-center number from a fiscal year 30 to 89 (none issued), or an online number from the IOE00000000 family.
 * Every written form counts: spaced, dotted, dashed, lower case.
 *
 * Allowed, with their reason: the decoder's own tests, which read specific past and present fiscal years (the 1990s,
 * 2000, 2021, 2026) and can't do so with a year that was never issued.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXAMPLE_ONLINE_RECEIPT, EXAMPLE_RECEIPT } from "@/lib/uscis/exampleReceipts";

const ROOT = join(__dirname, "../../../..");
const DECODER_TESTS = new Set([
  "src/lib/uscis/__tests__/receipt.test.ts",
  "src/components/tools/__tests__/CaseLookupForm.test.tsx",
  "src/components/tools/__tests__/UscisReceiptForm.test.tsx",
]);
const TEST_FILE = /(\.test\.(ts|tsx|mjs)$|__tests__\/|\/test_[^/]*\.py$|\.spec\.ts$|__fixtures__\/)/;
const WRITTEN = /(?<![A-Za-z0-9])(IOE|EAC|WAC|LIN|SRC|MSC|NBC|YSC|ioe|eac|wac|lin|src|msc|nbc|ysc)([\s.\-‐-―]*(?:\d[\s.\-‐-―]*){9}\d)(?!\d)/g;

export function couldBeReal(prefix: string, digits: string): boolean {
  const p = prefix.toUpperCase();
  const receipt = p + digits;
  if (receipt === EXAMPLE_RECEIPT || receipt === EXAMPLE_ONLINE_RECEIPT) return false;
  if (p === "IOE") return !digits.startsWith("00000000");
  const fy = Number(digits.slice(0, 2));
  return !(fy >= 30 && fy <= 89);
}

function testFiles(): string[] {
  return execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => TEST_FILE.test(f) && !DECODER_TESTS.has(f));
}

describe("test receipts", () => {
  it("knows a safe number from one that could be real", () => {
    expect(couldBeReal("EAC", "3512345678")).toBe(false);
    expect(couldBeReal("IOE", "0000000012")).toBe(false);
    expect(couldBeReal("ioe", "0912345678")).toBe(true);
    expect(couldBeReal("LIN", "9812345678")).toBe(true);
    expect(couldBeReal("WAC", "2612345678")).toBe(true);
  });

  it("finds none that could belong to a real case outside the decoder's tests", () => {
    const files = testFiles();
    expect(files.length).toBeGreaterThan(500);
    const found: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, f), "utf8");
      } catch {
        continue;
      }
      for (const m of text.matchAll(WRITTEN)) {
        const digits = m[2]!.replace(/\D/g, "");
        if (couldBeReal(m[1]!, digits)) found.push(`${f} (${m[1]!.toUpperCase()}${digits.slice(0, 2)}…)`);
      }
    }
    expect(found).toEqual([]);
  });
});

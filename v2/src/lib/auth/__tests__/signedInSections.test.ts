import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SIGNED_IN_SECTIONS, isSignedInPath } from "@/lib/auth/signedInSections";

describe("the signed-in app's sections", () => {
  it("names a section and every page under it, and nothing that only starts with its letters", () => {
    expect(isSignedInPath("/cases")).toBe(true);
    expect(isSignedInPath("/cases/k57abc")).toBe(true);
    expect(isSignedInPath("/dashboard")).toBe(true);
    expect(isSignedInPath("/admin/monitor")).toBe(true);
    // Public pages whose names begin the same way.
    expect(isSignedInPath("/case-search")).toBe(false);
    expect(isSignedInPath("/casesx")).toBe(false);
    expect(isSignedInPath("/perm-cases")).toBe(false);
    expect(isSignedInPath("/")).toBe(false);
  });

  it("is the list the proxy guards, so a new section is signed in everywhere at once", () => {
    const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(proxy).toContain("SIGNED_IN_SECTIONS");
    for (const section of SIGNED_IN_SECTIONS) {
      expect(proxy, section).not.toContain(`"${section}",`);
    }
  });
});

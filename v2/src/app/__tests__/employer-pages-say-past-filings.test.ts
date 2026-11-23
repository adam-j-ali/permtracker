import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PAST_FILINGS_NOTE } from "@/lib/pastFilingsNote";

/**
 * Every employer page says, near the top, that its filings are past filings and that sponsorship now depends on the
 * job and the employer (owner, Nov 23 2026, after an employer asked us to make that plain). The note rides in the
 * page header, under the answer line, so no employer page is without it.
 */
const PAGE = readFileSync(join(process.cwd(), "src/app/(site)/(public)/perm-employers/[slug]/page.tsx"), "utf8");

describe("the employer page's past-filings note", () => {
  it("says both halves in plain words", () => {
    expect(PAST_FILINGS_NOTE).toMatch(/past filings/i);
    expect(PAST_FILINGS_NOTE).toMatch(/depends on the job and (on )?the employer/i);
  });

  it("is passed to the employer page's header", () => {
    expect(PAGE).toMatch(/<ProfileHeader[\s\S]*?note=\{PAST_FILINGS_NOTE\}/);
  });

  it("names the peers as filing for the same work, never hiring", () => {
    expect(PAGE).not.toMatch(/Sponsors hiring for the same work/);
    expect(PAGE).toMatch(/Sponsors filing for the same work/);
  });
});

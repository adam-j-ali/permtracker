import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Privacy Policy and the Terms say session replay is switched off, and that the
 * pages will say so first if it's turned back on. So the code can't start a recording:
 * PostHog starts with recording disabled and nothing in the app starts one. Before
 * Nov 10 2026 the signed-in layout mounted a component that called
 * `startSessionRecording()`, and one setting in PostHog's dashboard was all that kept
 * it from recording.
 *
 * Turning replay on is one change to those two pages, the code and this test together.
 */

const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("session replay stays off while the promise pages say it's off", () => {
  it("the Privacy Policy and the Terms still say it's off", () => {
    expect(read("app/(site)/(public)/privacy/page.tsx")).toContain("Session replay is switched off");
    expect(read("app/(site)/(public)/terms/page.tsx")).toContain("Session replay is switched off");
  });

  it("PostHog starts with recording disabled", () => {
    expect(read("instrumentation-client.ts")).toContain("disable_session_recording: true");
  });

  it("nothing in the app starts a recording", () => {
    const starters = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/(__tests__|\.test\.)/.test(file))
      .filter((file) => /startSessionRecording|sessionRecording\.start/.test(read(file)));
    expect(starters).toEqual([]);
  });
});

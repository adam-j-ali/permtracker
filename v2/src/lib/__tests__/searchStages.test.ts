import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SEASONAL_PENDING,
  STAGE_PROGRAM_LABEL,
  searchStageFromSlug,
  searchStageSlug,
  searchStages,
} from "@/lib/searchStages";

/**
 * The case search's review-stage filter (src/lib/searchStages.ts). The H-2A, H-2B and CW-1 programs have stages of
 * their own on DOL's live record, and the filter offered none of them: a reader waiting on an H-2B application had
 * no way to list the cases at its stage.
 */

/** The `"pending": {...}` set inside PROGRAMS[<key>] in the Python ingest that marks a live case finished or not. */
function pythonPendingSet(key: string): Set<string> {
  const src = readFileSync(join(process.cwd(), "scripts/ingest_pwd_status_direct.py"), "utf8");
  const start = src.indexOf(`"${key}": {`);
  expect(start, `PROGRAMS["${key}"] not found`).toBeGreaterThan(-1);
  const block = /"pending": \{([\s\S]*?)\}/.exec(src.slice(start));
  expect(block, `pending set for ${key} not found`).not.toBeNull();
  return new Set([...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
}

describe("the seasonal programs' review stages", () => {
  it("offers every status the live sweep treats as still waiting, and nothing else", () => {
    const seasonal = searchStages().filter((s) => s.program === "seasonal");
    expect(new Set(seasonal.map((s) => s.status.toUpperCase()))).toEqual(pythonPendingSet("seasonal"));
    expect(new Set(SEASONAL_PENDING)).toEqual(pythonPendingSet("seasonal"));
  });

  it("spells each status as DOL's record does, since the stage read is an exact match", () => {
    // The live sweep stores DOL's words as given, and DOL writes this one in mixed case.
    expect(searchStageFromSlug("seasonal-post-cert-request-pending")?.status).toBe("Post-Cert Request Pending");
    expect(searchStageFromSlug("seasonal-nod-issued")?.status).toBe("NOD ISSUED");
  });

  it("names the group and gives each stage its own slug, read back to its program", () => {
    expect(STAGE_PROGRAM_LABEL.seasonal).toBe("H-2A, H-2B and CW-1");
    const nod = searchStageSlug("NOD ISSUED", "seasonal");
    expect(nod).toBe("seasonal-nod-issued");
    expect(searchStageFromSlug(nod!)).toEqual({ status: "NOD ISSUED", program: "seasonal" });
    // IN PROCESS is a stage of three programs, each under its own slug.
    expect(searchStageFromSlug("seasonal-in-process")).toEqual({ status: "IN PROCESS", program: "seasonal" });
    expect(searchStageFromSlug("lca-in-process")).toEqual({ status: "IN PROCESS", program: "lca" });
  });

  it("keeps every slug unique and every seasonal label in sentence case", () => {
    const all = searchStages();
    expect(new Set(all.map((s) => s.slug)).size).toBe(all.length);
    for (const s of all.filter((x) => x.program === "seasonal")) {
      // Sentence case: only the first letter, DOL's own abbreviations and proper names are capitals.
      const rest = s.label
        .replace(/\b(NOD|NRM|NOR|RFI|BALCA|ETA|Center Director)\b/g, "")
        .replace(/\d+[A-Z]/g, "")
        .slice(1);
      expect(rest, s.label).toBe(rest.toLowerCase());
    }
  });
});

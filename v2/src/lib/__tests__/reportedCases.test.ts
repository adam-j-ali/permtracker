import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPORTED_COMMUNITY_PLACES,
  REPORTED_PLACES,
  fromRow,
  reportedIn,
  shortSourceName,
  sourceName,
  sourcesIn,
  transferCohorts,
  type ReportedCase,
} from "../reportedCases";

const base: ReportedCase = {
  id: "sfv-filers:1",
  sources: ["sfv-filers"],
  category: "EB-3",
  chargeability: "ROW",
  priorityDate: null,
  priorityNote: null,
  receiptDate: "2026-05-01",
  biometricsDate: null,
  transferDate: "2026-09-24",
  approvalDate: null,
  cardDate: null,
  visaAvailable: true,
  status: null,
  asOf: null,
  maybeRepeats: 0,
};

describe("transferCohorts", () => {
  it("counts each transfer day's cases and approvals, newest day first, with the median days to approval", () => {
    const rows: ReportedCase[] = [
      { ...base, id: "a:1", transferDate: "2026-06-06", approvalDate: "2026-07-26" }, // 50 days
      { ...base, id: "a:2", transferDate: "2026-06-06", approvalDate: "2026-07-16" }, // 40 days
      { ...base, id: "a:3", transferDate: "2026-06-06", approvalDate: "2026-08-05" }, // 60 days
      { ...base, id: "a:4", transferDate: "2026-09-24" },
      { ...base, id: "a:5", transferDate: "2026-09-24", visaAvailable: false },
      { ...base, id: "a:6", transferDate: null },
    ];
    expect(transferCohorts(rows)).toEqual([
      { transferDate: "2026-09-24", cases: 2, approved: 0, medianDays: null, waitingAvailable: 1 },
      { transferDate: "2026-06-06", cases: 3, approved: 3, medianDays: 50, waitingAvailable: 0 },
    ]);
  });

  it("gives a median only from three approvals, and never counts an approval dated before its transfer", () => {
    const rows: ReportedCase[] = [
      { ...base, id: "a:1", transferDate: "2026-08-11", approvalDate: "2026-09-01" },
      { ...base, id: "a:2", transferDate: "2026-08-11", approvalDate: "2026-10-01" },
      { ...base, id: "a:3", transferDate: "2026-08-11", approvalDate: "2026-07-01" },
    ];
    const [c] = transferCohorts(rows);
    expect(c?.approved).toBe(3);
    expect(c?.medianDays).toBeNull();
  });

  it("never counts a case whose visa number nobody gave as waiting with one", () => {
    const [c] = transferCohorts([{ ...base, visaAvailable: null }]);
    expect(c?.waitingAvailable).toBe(0);
  });
});

describe("where a case was reported", () => {
  it("names a sheet by its own name, and each other source plainly", () => {
    expect(sourceName("sfv-filers")).toBe("the San Fernando Filers sheet");
    expect(sourceName("reddit")).toBe("Reddit");
    expect(sourceName("telegram")).toBe("Telegram");
    expect(sourceName("visastats")).toBe("VisaStats");
    expect(sourceName("timeline")).toBe("a timeline shared here");
    expect(sourceName("facebook")).toBe("Facebook");
  });

  it("gives a table cell the short name", () => {
    expect(["sfv-filers", "reddit", "timeline", "visastats", "facebook"].map(shortSourceName)).toEqual([
      "San Fernando Filers",
      "Reddit",
      "Shared here",
      "VisaStats",
      "Facebook",
    ]);
  });

  it("joins two or three sources the way a person would", () => {
    expect(reportedIn(["reddit"])).toBe("Reddit");
    expect(reportedIn(["sfv-filers", "reddit"])).toBe("the San Fernando Filers sheet and Reddit");
    expect(reportedIn(["sfv-filers", "reddit", "telegram"])).toBe("the San Fernando Filers sheet, Reddit and Telegram");
  });

  it("lists the sources a set of cases came from, the sheets first, each once", () => {
    const rows = [
      { ...base, sources: ["reddit"] },
      { ...base, sources: ["sfv-filers", "reddit"] },
      { ...base, sources: ["telegram"] },
    ];
    expect(sourcesIn(rows)).toEqual(["sfv-filers", "reddit", "telegram"]);
  });
});

describe("a stored row", () => {
  const row = {
    case_id: "sfv-filers:7",
    source_names: '["reddit","sfv-filers"]',
    possible_dupes: '["telegram:u9","sfv-filers:8"]',
    category: "EB-2",
    chargeability: "Nigeria",
    priority_date: "2023-02-01",
    priority_note: null,
    i485_receipt: "2026-06-12",
    biometrics: "2026-07-08",
    transfer: "2026-09-24",
    i485_decision: "approved",
    i485_decided: "2026-11-03",
    card: null,
    visa_available: "1",
    nonimmigrant_status: "H1B",
    as_of: "2026-11-10",
  };

  it("reads every field, the visa number's integer included", () => {
    const c = fromRow(row);
    expect(c).toMatchObject({ id: "sfv-filers:7", sources: ["sfv-filers", "reddit"], approvalDate: "2026-11-03" });
    expect(c.visaAvailable).toBe(true);
    expect(fromRow({ ...row, visa_available: "0" }).visaAvailable).toBe(false);
    expect(fromRow({ ...row, visa_available: null }).visaAvailable).toBeNull();
  });

  it("counts only the repeats from other sources: two rows of one sheet are spouses and batch-mates", () => {
    expect(fromRow(row).maybeRepeats).toBe(1);
  });

  it("never reads a denial's day as an approval", () => {
    expect(fromRow({ ...row, i485_decision: "denied" }).approvalDate).toBeNull();
  });
});

describe("the places reported cases come from, said once", () => {
  it("names every place the merge reads, VisaStats' tracker last", () => {
    expect(REPORTED_PLACES).toBe("Telegram and Facebook groups, community sheets, Reddit, VisaStats");
    expect(REPORTED_COMMUNITY_PLACES).toBe("Telegram and Facebook groups, community sheets, Reddit");
    expect(REPORTED_PLACES.startsWith(REPORTED_COMMUNITY_PLACES)).toBe(true);
  });

  it("is never typed out again in a page or a component", () => {
    // Each copy drifted on its own: Facebook groups joined the merge on Nov 20 2026 and seven sentences named the old
    // list. A page says the places through the constants, so one edit reaches every one of them.
    const root = join(__dirname, "..", "..");
    const copies: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(full);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !full.endsWith(join("lib", "reportedPlaces.ts"))) {
          if (/groups, (community )?sheets, Reddit/.test(readFileSync(full, "utf8"))) copies.push(full);
        }
      }
    };
    walk(join(root, "app"));
    walk(join(root, "components"));
    walk(join(root, "lib"));
    expect(copies, "a typed copy of the reported places").toEqual([]);
  });
});

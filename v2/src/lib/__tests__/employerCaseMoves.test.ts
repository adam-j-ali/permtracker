/**
 * The "every case" follow's rules: which rows of the event log are moves, how they read, and what a follower is owed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BULK_WRITE_ROWS,
  CASE_MOVE_FRESH_DAYS,
  DIRECT_SOURCE,
  EXPIRY_FROM,
  EXPIRY_TO,
  caseMoveSentence,
  filedLabel,
  followScope,
  groupCaseMoves,
  newestAt,
  realCaseMoves,
  rowsShown,
  unheardCaseMoves,
  type CaseMoveRow,
} from "../employerCaseMoves";

const DAY = 86_400_000;
/** Noon Eastern on Nov 10 2026 (EST is UTC-5). */
const NOON = Date.UTC(2026, 10, 10, 17, 0, 0);

const row = (over: Partial<CaseMoveRow> = {}): CaseMoveRow => ({
  slug: "acme-corp",
  caseNumber: "A-25100-00001",
  at: NOON,
  from: "ANALYST REVIEW",
  to: "CERTIFIED",
  filed: "2025-04-10",
  jobTitle: "Software Engineer",
  ...over,
});

describe("which rows are moves", () => {
  it("drops a lapsed certification, a first sighting, an unchanged status and a catch-up write", () => {
    // Arrange
    const bulk = NOON - DAY;
    const rows = [
      row({ caseNumber: "A-1" }),
      row({ caseNumber: "A-2", from: EXPIRY_FROM, to: EXPIRY_TO }),
      row({ caseNumber: "A-3", from: "" }),
      row({ caseNumber: "A-4", from: "CERTIFIED", to: "CERTIFIED" }),
      row({ caseNumber: "A-5", at: bulk }),
      row({ caseNumber: "A-6", slug: "" }),
    ];
    // Act
    const moves = realCaseMoves(rows, new Set([bulk]));
    // Assert
    expect(moves.map((m) => m.caseNumber)).toEqual(["A-1"]);
  });

  it("keeps a denial that arrives at 'certified - expired', which is not the lapse pair", () => {
    const moves = realCaseMoves([row({ from: "DENIED", to: EXPIRY_TO })], new Set());
    expect(moves).toHaveLength(1);
  });

  it("dates a move by the day DOL worked: seen before 7 AM Eastern is the day before", () => {
    // 4:10 AM Eastern on Nov 11 is the evening of Nov 10's work.
    const early = Date.UTC(2026, 10, 11, 9, 10, 0);
    const [m] = realCaseMoves([row({ at: early })], new Set());
    expect(m?.worked).toBe("2026-11-10");
    const [later] = realCaseMoves([row({ at: NOON })], new Set());
    expect(later?.worked).toBe("2026-11-10");
  });

  it("holds its three filter constants to the change feed's own", () => {
    const feed = readFileSync(join(process.cwd(), "src/lib/db/changes.ts"), "utf8");
    const constant = (name: string) => new RegExp(`^const ${name} = (.+);$`, "m").exec(feed)?.[1];
    expect(constant("EXPIRY_FROM")).toBe(JSON.stringify(EXPIRY_FROM));
    expect(constant("EXPIRY_TO")).toBe(JSON.stringify(EXPIRY_TO));
    expect(constant("BULK_WRITE_ROWS")).toBe(String(BULK_WRITE_ROWS));
  });

  it("names DOL's direct source exactly as the sweep writes it", () => {
    const sweep = readFileSync(join(process.cwd(), "scripts/ingest_case_status_direct.py"), "utf8");
    expect(sweep).toContain(`SOURCE = ${JSON.stringify(DIRECT_SOURCE)}`);
  });
});

describe("what a follower hasn't heard", () => {
  const now = NOON + DAY;
  const moves = realCaseMoves(
    [
      row({ caseNumber: "A-new", at: NOON }),
      row({ caseNumber: "A-told", at: NOON - 2 * DAY }),
      row({ caseNumber: "A-old", at: NOON - (CASE_MOVE_FRESH_DAYS + 1) * DAY }),
    ],
    new Set(),
  );

  it("is everything after the watermark", () => {
    expect(unheardCaseMoves(moves, NOON - DAY, 0, now).map((m) => m.caseNumber)).toEqual(["A-new"]);
  });

  it("is nothing from before the follow began when there's no watermark yet", () => {
    expect(unheardCaseMoves(moves, undefined, NOON - 3 * DAY, now).map((m) => m.caseNumber)).toEqual([
      "A-new",
      "A-told",
    ]);
    expect(unheardCaseMoves(moves, undefined, NOON, now)).toEqual([]);
  });

  it("is never older than the freshness window, whatever the watermark says", () => {
    expect(unheardCaseMoves(moves, 0, 0, now).map((m) => m.caseNumber)).toEqual(["A-new", "A-told"]);
  });

  it("is empty for an employer with no moves at all", () => {
    expect(unheardCaseMoves(undefined, 0, 0, now)).toEqual([]);
  });

  it("gives the newest instant as the next watermark", () => {
    expect(newestAt(moves)).toBe(NOON);
    expect(newestAt([])).toBe(0);
  });
});

describe("the sentence for each kind of change names who acted", () => {
  it.each([
    ["ANALYST REVIEW", "CERTIFIED", 3, "DOL certified 3 of its cases"],
    ["ANALYST REVIEW", "DENIED", 1, "DOL denied 1 of its cases"],
    ["ANALYST REVIEW", "WITHDRAWN", 1, "1 of its cases was withdrawn by the employer"],
    ["RFI ISSUED", "WITHDRAWN", 2, "2 of its cases were withdrawn by the employer"],
    ["ANALYST REVIEW", "RFI ISSUED", 2, "DOL sent a request for information on 2 of its cases"],
    ["RFI ISSUED", "ANALYST REVIEW", 2, "2 of its cases went back to analyst review after a request for information"],
    ["ANALYST REVIEW", "APPLICATION ON HOLD", 215, "DOL put 215 of its cases on hold"],
    ["APPLICATION ON HOLD", "ANALYST REVIEW", 201, "DOL took 201 of its cases off hold, back to analyst review"],
    ["APPLICATION ON HOLD", "CERTIFIED", 4, "DOL took 4 of its cases off hold and certified them"],
    ["RECONSIDERATION APPEALS", "CERTIFIED", 1, "DOL certified 1 of its cases on reconsideration"],
    ["DENIED", "CERTIFIED", 1, "DOL certified 1 of its cases that it had denied"],
    ["RECONSIDERATION APPEALS", "DENIED", 2, "2 of its cases went from appeal back to denied"],
    ["DENIED", "RECONSIDERATION APPEALS", 2, "The employer asked DOL to reconsider 2 of its cases"],
    ["DENIED", "REQUEST FOR REVIEW", 1, "The employer asked the appeals board (BALCA) to review 1 of its cases"],
    ["REQUEST FOR REVIEW", "BALCA APPEALS", 1, "1 of its cases went to the appeals board (BALCA)"],
    ["BALCA APPEALS", "DENIED - BALCA AFFIRMED", 1, "The appeals board (BALCA) affirmed the denial of 1 of its cases"],
    ["ANALYST REVIEW", "SUPERVISED RECRUITMENT", 1, "DOL put 1 of its cases into supervised recruitment"],
    ["ANALYST REVIEW", "PENDING AUDIT RESPONSE", 2, "DOL selected 2 of its cases for audit"],
  ])("%s to %s", (from, to, n, sentence) => {
    expect(caseMoveSentence(from, to, n)).toBe(sentence);
  });

  it("quotes a status DOL gives no meaning for, and adds none", () => {
    expect(caseMoveSentence("RECONSIDERATION APPEALS", "NORD ISSUED", 1)).toBe(
      '1 of its cases moved to "NORD Issued", DOL\'s own name for the status',
    );
    expect(caseMoveSentence("BALCA APPEALS", "DENIED - BALCA DISMISSED", 1)).toContain('"Denied - BALCA Dismissed"');
  });

  it("gives no reason anywhere", () => {
    const all = [
      ["ANALYST REVIEW", "APPLICATION ON HOLD"],
      ["ANALYST REVIEW", "DENIED"],
      ["ANALYST REVIEW", "RFI ISSUED"],
      ["ANALYST REVIEW", "WITHDRAWN"],
    ].map(([f, t]) => caseMoveSentence(f!, t!, 2));
    for (const s of all) expect(s).not.toMatch(/because|due to|after the|layoff|investigat/i);
  });
});

describe("grouping a follower's news", () => {
  const early = Date.UTC(2026, 10, 12, 20, 0, 0);
  const moves = realCaseMoves(
    [
      row({ caseNumber: "A-2", filed: "2025-05-01" }),
      row({ caseNumber: "A-1", filed: "2025-04-01" }),
      row({ caseNumber: "A-9", filed: null }),
      row({ caseNumber: "A-3", to: "RFI ISSUED" }),
      row({ caseNumber: "A-4", to: "DENIED" }),
      row({ caseNumber: "A-5", at: early }),
    ],
    new Set(),
  );
  const groups = groupCaseMoves(moves);

  it("puts the newest day first, then decisions before requests", () => {
    expect(groups.map((g) => `${g.worked} ${g.to} ${g.n}`)).toEqual([
      "2026-11-12 CERTIFIED 1",
      "2026-11-10 CERTIFIED 3",
      "2026-11-10 DENIED 1",
      "2026-11-10 RFI ISSUED 1",
    ]);
  });

  it("lists a group's cases oldest filing first, an undated one last", () => {
    expect(groups[1]!.cases.map((c) => c.caseNumber)).toEqual(["A-1", "A-2", "A-9"]);
  });

  it("marks a certification good, a denial bad and a request neutral", () => {
    expect(groups.map((g) => g.tone)).toEqual(["good", "good", "bad", "neutral"]);
  });

  it("prints as many case rows as the email allows, in order, and counts the rest", () => {
    expect(rowsShown(groups, 3)).toEqual([1, 2, 0, 0]);
    expect(rowsShown(groups)).toEqual([1, 3, 1, 1]);
  });
});

describe("small parts", () => {
  it("reads a follow with no scope as a group follow", () => {
    expect(followScope(undefined)).toBe("group");
    expect(followScope("each")).toBe("each");
    expect(followScope("everything")).toBe("group");
  });

  it("writes the filing month, or nothing when there's no date", () => {
    expect(filedLabel("2025-03-14")).toBe("filed Mar 2025");
    expect(filedLabel(null)).toBe("");
    expect(filedLabel("not a date")).toBe("");
  });
});

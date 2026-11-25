import { describe, expect, it } from "vitest";

import { MIN_CASE_REPORTERS } from "./communityTimeline";
import {
  MIN_REPORTS,
  OWNER_LIST_MAX,
  REPORT_CATEGORIES,
  latestAllowedDay,
  linesFor,
  ownerDigest,
  postWords,
  validateReport,
  type ReportChange,
  type ReportInput,
} from "./consularReport";

/**
 * The consulate reports' rules: what a report may hold. The figures over them are the server's summary
 * (scripts/lib_reported_summary.py report_view), which holds every cell to the three-report floor the
 * timelines use; a hidden report never reaches it.
 */

const TODAY = "2026-11-05"; // a Thursday

const base: ReportInput = { post: "mumbai", category: "employment", outcome: "waiting", scheduledOn: "2026-10-01" };

describe("validateReport", () => {
  it("accepts a plain report and returns only the fields it holds", () => {
    const r = validateReport({ ...base, nvcCompleteMonth: "2026-03" }, TODAY);
    expect(r).toEqual({
      ok: true,
      value: { post: "mumbai", category: "employment", outcome: "waiting", scheduledOn: "2026-10-01", nvcCompleteMonth: "2026-03" },
    });
  });

  it("takes every kind of visa, employment and the work visas listed first", () => {
    const ids = REPORT_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(["employment", "h1b", "h4", "l1", "l2", "family", "immediate", "k1", "f1", "b1b2", "other"]);
    for (const category of ids) {
      const r = validateReport({ post: "manila", category, outcome: "waiting", interviewOn: "2026-10-20" }, TODAY);
      expect(r.ok, category).toBe(true);
    }
    // A K-1 goes through NVC; an F-1 doesn't.
    expect(validateReport({ post: "manila", category: "k1", outcome: "waiting", nvcCompleteMonth: "2026-06" }, TODAY).ok).toBe(true);
    expect(validateReport({ post: "manila", category: "f1", outcome: "waiting", nvcCompleteMonth: "2026-06" }, TODAY).ok).toBe(false);
  });

  it("shares the timelines' floor of three", () => {
    expect(MIN_REPORTS).toBe(MIN_CASE_REPORTERS);
    expect(MIN_REPORTS).toBe(3);
  });

  it.each([
    ["a post slug with a capital", { post: "Mumbai" }, "post"],
    ["a post slug too short", { post: "m" }, "post"],
    ["a post slug with a slash", { post: "../admin" }, "post"],
    ["no category", { category: null }, "category"],
    ["a category off the list", { category: "eb5" }, "choice"],
    ["no outcome", { outcome: undefined }, "outcome"],
    ["an outcome off the list", { outcome: "stamped" }, "choice"],
    ["a date in the future", { scheduledOn: "2026-11-07" }, "date"],
    ["a date before 2020", { scheduledOn: "2019-12-31" }, "date"],
    ["a date that isn't one", { scheduledOn: "2026-02-30" }, "date"],
    ["a date in another shape", { scheduledOn: "10/01/2026" }, "date"],
    ["a month in the future", { nvcCompleteMonth: "2026-12" }, "date"],
    ["a month before 2020", { nvcCompleteMonth: "2019-11" }, "date"],
    ["a month that isn't one", { nvcCompleteMonth: "2026-13" }, "date"],
    ["no date at all", { scheduledOn: null }, "no-dates"],
    ["a refusal ground without a refusal", { refusalGround: "public-charge" }, "refusal-ground"],
    ["a refusal ground off the list", { outcome: "refused", interviewOn: "2026-10-20", refusalGround: "fraud" }, "choice"],
    ["a resolved day while waiting", { resolvedOn: "2026-10-10" }, "resolved"],
    ["an interview before its letter", { interviewOn: "2026-09-20" }, "order"],
    ["an interview before NVC said complete", { scheduledOn: null, interviewOn: "2026-02-10", nvcCompleteMonth: "2026-03" }, "order"],
    ["a visa issued before the interview", { outcome: "issued", interviewOn: "2026-10-20", resolvedOn: "2026-10-19" }, "order"],
    ["an approval after the visa", { outcome: "issued", interviewOn: "2026-10-20", approvedOn: "2026-10-25", resolvedOn: "2026-10-22" }, "order"],
    ["an approval before the interview", { outcome: "approved", interviewOn: "2026-10-20", approvedOn: "2026-10-19" }, "order"],
    ["an approval day with no approval", { outcome: "refused", interviewOn: "2026-10-20", approvedOn: "2026-10-20" }, "approved"],
    ["NVC's month on an H-1B", { category: "h1b", nvcCompleteMonth: "2026-03" }, "nvc"],
    ["a drop box on a green card", { mode: "dropbox" }, "nonimmigrant"],
    ["a slip colour on a green card", { outcome: "221g", interviewOn: "2026-10-20", slipColor: "white" }, "nonimmigrant"],
    ["a slip colour without a 221(g)", { category: "h1b", outcome: "issued", interviewOn: "2026-10-20", slipColor: "white" }, "221g-detail"],
    ["emailed documents without a 221(g)", { category: "h4", outcome: "waiting", interviewOn: "2026-10-20", askedToEmailDocs: "yes" }, "221g-detail"],
    ["a mode off the list", { category: "h1b", mode: "video" }, "choice"],
    ["a slip colour off the list", { category: "h1b", outcome: "221g", interviewOn: "2026-10-20", slipColor: "orange" }, "choice"],
  ])("refuses %s", (_, over, code) => {
    const r = validateReport({ ...base, ...over } as ReportInput, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("allows a day ahead of UTC, for someone reporting from Manila or Auckland in the morning", () => {
    expect(latestAllowedDay(TODAY)).toBe("2026-11-06");
    expect(validateReport({ ...base, scheduledOn: "2026-11-06" }, TODAY).ok).toBe(true);
  });

  it("keeps a refusal ground only on a refusal, and a resolved day on an issue or a 221(g)", () => {
    const refused = validateReport({ ...base, outcome: "refused", interviewOn: "2026-10-20", refusalGround: "public-charge" }, TODAY);
    expect(refused.ok && refused.value.refusalGround).toBe("public-charge");
    const cleared = validateReport({ ...base, outcome: "221g", interviewOn: "2026-10-20", resolvedOn: "2026-11-01" }, TODAY);
    expect(cleared.ok && cleared.value.resolvedOn).toBe("2026-11-01");
  });

  it("takes a nonimmigrant stamping report with every detail it can carry", () => {
    const r = validateReport(
      {
        post: "mumbai",
        category: "h1b",
        mode: "interview",
        scheduledOn: "2026-10-01",
        interviewOn: "2026-10-20",
        outcome: "221g",
        slipColor: "white",
        askedToEmailDocs: "yes",
        resolvedOn: "2026-11-01",
      },
      TODAY,
    );
    expect(r).toMatchObject({ ok: true, value: { category: "h1b", mode: "interview", slipColor: "white", askedToEmailDocs: "yes" } });
    const visitor = validateReport({ post: "mumbai", category: "h4", mode: "dropbox", interviewOn: "2026-10-02", outcome: "passport-returned", approvedOn: "2026-10-09", resolvedOn: "2026-10-14" }, TODAY);
    expect(visitor.ok).toBe(true);
    const refused = validateReport({ post: "mumbai", category: "l1", interviewOn: "2026-10-02", outcome: "refused", refusalGround: "214b" }, TODAY);
    expect(refused.ok && refused.value.refusalGround).toBe("214b");
    // "Another visa" can carry either kind of question.
    expect(validateReport({ post: "mumbai", category: "other", nvcCompleteMonth: "2026-01", mode: "interview", interviewOn: "2026-10-02", outcome: "waiting" }, TODAY).ok).toBe(true);
  });

  it("takes an empty string as no answer, the way a cleared form field arrives", () => {
    const r = validateReport({ ...base, nvcCompleteMonth: "", interviewOn: "", resolvedOn: "" }, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value).sort()).toEqual(["category", "outcome", "post", "scheduledOn"]);
  });
});

describe("the exact category, why the 221(g), who cancelled", () => {
  const ok = (over: ReportInput) => validateReport({ ...base, ...over }, TODAY);

  it("takes an exact category only from the kind of visa's own list", () => {
    expect(ok({ line: "eb2" })).toMatchObject({ ok: true, value: { line: "eb2" } });
    expect(ok({ category: "family", line: "f2a" })).toMatchObject({ ok: true, value: { line: "f2a" } });
    expect(ok({ category: "immediate", line: "ir1" })).toMatchObject({ ok: true, value: { line: "ir1" } });
    // F2A isn't an employment category, and an H-1B has none.
    expect(ok({ line: "f2a" })).toMatchObject({ ok: false, code: "line" });
    expect(ok({ category: "h1b", line: "eb2" })).toMatchObject({ ok: false, code: "line" });
    expect(ok({ line: "eb9" })).toMatchObject({ ok: false, code: "choice" });
    expect(linesFor("h1b")).toEqual([]);
    expect(linesFor("family").map((l) => l.id)).toEqual(["f1", "f2a", "f2b", "f3", "f4"]);
  });

  it("keeps why the 221(g) only on a 221(g), for any kind of visa", () => {
    expect(ok({ category: "immediate", outcome: "221g", holdReason: "public-charge" })).toMatchObject({
      ok: true,
      value: { holdReason: "public-charge" },
    });
    expect(ok({ category: "h1b", outcome: "221g", holdReason: "admin" })).toMatchObject({ ok: true });
    expect(ok({ outcome: "refused", holdReason: "documents" })).toMatchObject({ ok: false, code: "hold-reason" });
  });

  it("keeps who cancelled only on a cancelled or moved interview", () => {
    expect(ok({ outcome: "cancelled", cancelledBy: "consulate" })).toMatchObject({ ok: true, value: { cancelledBy: "consulate" } });
    expect(ok({ outcome: "rescheduled", cancelledBy: "me" })).toMatchObject({ ok: true, value: { cancelledBy: "me" } });
    expect(ok({ outcome: "issued", cancelledBy: "me" })).toMatchObject({ ok: false, code: "cancelled-by" });
  });
});

// The figures over these reports (the floor, the windows, the weeks, the waits, after the appointment) are the server's
// summary since Nov 25 2026 (D7): scripts/test_lib_reported_summary.py, report_view.

describe("ownerDigest: the owner's daily email", () => {
  const since = 1_000_000;
  const row = (over: Partial<ReportChange> = {}): ReportChange => ({
    post: "manila",
    category: "k1",
    outcome: "221g",
    refusalGround: null,
    interviewOn: "2026-11-03",
    line: null,
    holdReason: null,
    cancelledBy: null,
    createdAt: since + 10,
    updatedAt: since + 10,
    hidden: false,
    ...over,
  });

  it("sends nothing on a day with no reports", () => {
    expect(ownerDigest([], since, "https://x")).toBeNull();
  });

  it("names each report's consulate, visa, result and appointment, new or edited, with its page", () => {
    const d = ownerDigest(
      [row(), row({ post: "ciudad-juarez", category: "immediate", outcome: "refused", refusalGround: "public-charge", createdAt: since - 5, hidden: true })],
      since,
      "https://x",
    )!;
    expect(d.subject).toBe("Consulate reports today: 2 reports");
    expect(d.text).toContain("1 new, 1 edited");
    expect(d.text).toContain("- Manila, K-1 fiancé(e): 221(g), more processing. appointment Nov 3. new. https://x/consular-posts/manila#reports");
    expect(d.text).toContain("Ciudad Juarez");
    expect(d.text).toContain("Refused (Public charge)");
    expect(d.text).toContain("edited. hidden.");
    const g = ownerDigest([row({ category: "family", line: "f2a", holdReason: "public-charge" })], since, "https://x")!;
    expect(g.text).toContain("- Manila, Family preference, F2A: 221(g), more processing (Public charge or I-864).");
    expect(d.text).toContain("https://x/admin#reviews");
  });

  it("lists at most OWNER_LIST_MAX and counts the rest; says 'at least' when the read stopped short", () => {
    const many = Array.from({ length: OWNER_LIST_MAX + 3 }, () => row());
    const d = ownerDigest(many, since, "https://x", true)!;
    expect(d.text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(OWNER_LIST_MAX);
    expect(d.text).toContain("3 more on the admin page.");
    expect(d.subject).toBe(`Consulate reports today: at least ${OWNER_LIST_MAX + 3} reports`);
  });

  it("reads a slug as words", () => {
    expect(postWords("ciudad-juarez")).toBe("Ciudad Juarez");
    expect(postWords("manila")).toBe("Manila");
  });
});

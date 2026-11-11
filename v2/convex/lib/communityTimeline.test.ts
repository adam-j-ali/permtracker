import { describe, expect, it } from "vitest";

import {
  BOARD_OPENS_AT,
  CATEGORIES,
  DATE_FIELDS,
  METRIC_MIN_N,
  OFFICE_LIST_OPENS_AT,
  OFFICE_METRIC_IDS,
  computeMetrics,
  daysBetween,
  isPermCategory,
  isShown,
  reviewFlags,
  summarizeRfes,
  toBoardRow,
  toOfficeRow,
  validateTimeline,
  WAITING_STAGES,
  waitingStage,
  whoIsWaiting,
  type TimelineRecord,
  type WaitingStageId,
} from "./communityTimeline";

const TODAY = "2026-09-26";

describe("validateTimeline", () => {
  it("accepts a plain adjustment timeline and keeps public off unless ticked", () => {
    const r = validateTimeline(
      { category: "eb2", country: "india", route: "adjustment", i140FiledOn: "2026-01-10", i140ApprovedOn: "2026-01-20", premium: true },
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.public).toBe(false);
    expect(r.value.premium).toBe(true);
    expect(r.value.i140ApprovedOn).toBe("2026-01-20");
  });

  it("refuses a timeline with no date after PERM", () => {
    const r = validateTimeline({ category: "eb3", public: true }, TODAY);
    expect(r).toEqual({ ok: false, code: "no-dates", message: expect.stringMatching(/at least one date/) });
  });

  it.each([
    ["a future date", { i140FiledOn: "2026-09-27" }],
    ["a malformed date", { i140FiledOn: "2026-9-1" }],
    ["an impossible date", { i140FiledOn: "2026-02-31x" }],
    ["a date before 2005", { i140FiledOn: "2004-12-31" }],
    ["an unknown category", { category: "eb5", i140FiledOn: "2026-01-01" }],
    ["an office USCIS's file doesn't list", { fieldOffice: "ZZZ", i485FiledOn: "2026-01-01" }],
    ["an office code too long to be one", { fieldOffice: "x".repeat(40), i485FiledOn: "2026-01-01" }],
    ["an unknown RFE reason", { rfeForm: "i140", rfeReason: "vibes", i140FiledOn: "2026-01-01" }],
    ["a string too long to be a choice", { country: "x".repeat(40), i140FiledOn: "2026-01-01" }],
  ])("refuses %s", (_, input) => {
    expect(validateTimeline(input, TODAY).ok).toBe(false);
  });

  it("refuses an approval dated before its filing, and a response before the RFE", () => {
    expect(validateTimeline({ i140FiledOn: "2026-03-01", i140ApprovedOn: "2026-02-01" }, TODAY).ok).toBe(false);
    expect(
      validateTimeline({ i140FiledOn: "2026-03-01", rfeForm: "i140", rfeIssuedOn: "2026-04-01", rfeRespondedOn: "2026-03-20" }, TODAY).ok,
    ).toBe(false);
  });

  it("allows a concurrent I-485 filed the same day as, or before, the I-140 date", () => {
    expect(validateTimeline({ i140FiledOn: "2026-03-01", i485FiledOn: "2026-03-01" }, TODAY).ok).toBe(true);
    expect(validateTimeline({ i140FiledOn: "2026-03-05", i485FiledOn: "2026-03-01" }, TODAY).ok).toBe(true);
  });

  it("needs the form when any RFE field is given", () => {
    expect(validateTimeline({ i140FiledOn: "2026-03-01", rfeReason: "experience" }, TODAY).ok).toBe(false);
  });

  it("refuses an adjustment-only date on a consular timeline rather than printing a contradiction", () => {
    const r = validateTimeline({ route: "consular", i140FiledOn: "2026-01-01", eadOn: "2026-05-01" }, TODAY);
    expect(r.ok).toBe(false);
    expect(validateTimeline({ route: "consular", i140FiledOn: "2026-01-01", interviewOn: "2026-08-01" }, TODAY).ok).toBe(true);
  });

  it("names each refusal with a code, so the page words it from the code", () => {
    const code = (input: Parameters<typeof validateTimeline>[0]) => {
      const r = validateTimeline(input, TODAY);
      return r.ok ? null : "field" in r ? `${r.code}:${r.field}` : r.code;
    };
    expect(code({ category: "eb9", i140FiledOn: "2026-03-01" })).toBe("choice:category");
    expect(code({ i140FiledOn: "2026-13-01" })).toBe("date");
    expect(code({ category: "eb2" })).toBe("no-dates");
    expect(code({ i140FiledOn: "2026-03-01", i140ApprovedOn: "2026-02-01" })).toBe("i140-order");
    expect(code({ i485FiledOn: "2026-03-01", greenCardOn: "2026-02-01" })).toBe("green-card-order");
    expect(code({ i140FiledOn: "2026-03-01", rfeForm: "i140", rfeIssuedOn: "2026-04-01", rfeRespondedOn: "2026-03-20" })).toBe("rfe-order");
    expect(code({ i140FiledOn: "2026-03-01", rfeReason: "experience" })).toBe("rfe-form");
    expect(code({ route: "consular", i140FiledOn: "2026-01-01", eadOn: "2026-05-01" })).toBe("adjustment-only:eadOn");
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days and returns null for a missing end", () => {
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
    expect(daysBetween("2026-01-01", undefined)).toBeNull();
  });
});

const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: false, updatedAt: Date.UTC(2026, 8, 1), ...over });

describe("computeMetrics", () => {
  it("prints no median below the minimum count, and one at it", () => {
    const four = Array.from({ length: METRIC_MIN_N - 1 }, (_, i) =>
      rec({ i140FiledOn: "2026-01-01", i140ApprovedOn: `2026-01-${String(10 + i).padStart(2, "0")}`, premium: true }),
    );
    const m4 = computeMetrics(four).find((m) => m.id === "i140-premium")!;
    expect(m4.n).toBe(METRIC_MIN_N - 1);
    expect(m4.median).toBeNull();
    const five = [...four, rec({ i140FiledOn: "2026-01-01", i140ApprovedOn: "2026-01-20", premium: true })];
    const m5 = computeMetrics(five).find((m) => m.id === "i140-premium")!;
    expect(m5.n).toBe(METRIC_MIN_N);
    expect(m5.median).toBe(11);
  });

  it("keeps premium and regular I-140s apart, and skips an unknown premium", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => rec({ i140FiledOn: "2026-01-01", i140ApprovedOn: "2026-01-11", premium: true })),
      ...Array.from({ length: 5 }, () => rec({ i140FiledOn: "2026-01-01", i140ApprovedOn: "2026-07-01", premium: false })),
      rec({ i140FiledOn: "2026-01-01", i140ApprovedOn: "2026-02-01" }),
    ];
    const ms = computeMetrics(rows);
    expect(ms.find((m) => m.id === "i140-premium")!.median).toBe(10);
    expect(ms.find((m) => m.id === "i140-regular")!.median).toBe(181);
    expect(ms.find((m) => m.id === "i140-regular")!.n).toBe(5);
  });

  it("drops a negative duration and a hidden row rather than averaging them in", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => rec({ permFiledOn: "2025-01-01", permCertifiedOn: "2025-12-01" })),
      rec({ permFiledOn: "2025-12-01", permCertifiedOn: "2025-01-01" }),
      rec({ permFiledOn: "2025-01-01", permCertifiedOn: "2025-02-01", hiddenAt: 1 }),
    ];
    const perm = computeMetrics(rows).find((m) => m.id === "perm")!;
    expect(perm.n).toBe(5);
    expect(perm.median).toBe(334);
    expect(perm.verified).toBe(true);
  });
});

describe("summarizeRfes", () => {
  it("counts by form, reason and outcome, busiest first, and leaves out empty buckets", () => {
    const s = summarizeRfes([
      rec({ rfeForm: "i140", rfeReason: "experience", rfeOutcome: "approved" }),
      rec({ rfeForm: "i140", rfeReason: "experience", rfeOutcome: "pending" }),
      rec({ rfeForm: "i485", rfeReason: "medical" }),
      rec({ i140FiledOn: "2026-01-01" }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byForm.map((f) => [f.id, f.count])).toEqual([["i140", 2], ["i485", 1]]);
    expect(s.byReason[0]).toMatchObject({ id: "experience", count: 2 });
    expect(s.byOutcome.find((o) => o.id === "denied")).toBeUndefined();
  });
});

describe("toBoardRow", () => {
  it("never carries a case number, an employer or an exact PERM date", () => {
    const row = toBoardRow(
      rec({ permFiledOn: "2025-06-17", permCertifiedOn: "2026-05-04", i140FiledOn: "2026-05-20", category: "eb3", public: true }),
    );
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/G-\d{3}/);
    expect(text).not.toContain("2025-06-17");
    expect(text).not.toContain("2026-05-04");
    expect(row.filedMonth).toBe("2025-06");
    expect(row.permVerified).toBe(true);
    expect(row.stops.find((s) => s.id === "permCertifiedOn")!.day).toBe(321);
    expect(row.stops.find((s) => s.id === "i140FiledOn")!.day).toBe(337);
  });

  it("marks the PERM half unverified when DOL's record was not found", () => {
    expect(toBoardRow(rec({ i140FiledOn: "2026-05-20" })).permVerified).toBe(false);
  });
});

it("opens the board at a threshold that is more than one row", () => {
  expect(BOARD_OPENS_AT).toBeGreaterThan(METRIC_MIN_N);
});

it("holds the floors the Privacy Policy states: the board at 10 shared, an office's list at 3", () => {
  expect(BOARD_OPENS_AT).toBe(10);
  expect(OFFICE_LIST_OPENS_AT).toBe(3);
});

describe("the USCIS office and the biometrics date", () => {
  const TODAY = "2026-09-26";

  it("takes an office by USCIS's own code, and a biometrics date alone is a timeline", () => {
    const r = validateTimeline({ fieldOffice: "HAR", biometricsOn: "2026-03-02" }, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fieldOffice).toBe("HAR");
    expect(r.value.biometricsOn).toBe("2026-03-02");
  });

  it("refuses an office on a consular case, where there is none", () => {
    const r = validateTimeline({ route: "consular", fieldOffice: "HAR", i140FiledOn: "2026-01-01" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "office-consular" });
  });

  it("refuses biometrics on a consular case like every other adjustment-only date", () => {
    const r = validateTimeline({ route: "consular", i140FiledOn: "2026-01-01", biometricsOn: "2026-03-02" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "adjustment-only", field: "biometricsOn" });
  });

  it("puts biometrics after the I-485 in the order a case meets its dates", () => {
    const ids = DATE_FIELDS.map((f) => f.id as string);
    expect(ids.indexOf("biometricsOn")).toBe(ids.indexOf("i485FiledOn") + 1);
  });
});

describe("categories", () => {
  it("knows which have a PERM case and which don't", () => {
    expect(CATEGORIES.filter((c) => !c.perm).map((c) => c.id)).toEqual(["eb1", "eb2-niw"]);
    expect(isPermCategory("eb2")).toBe(true);
    expect(isPermCategory("eb2-niw")).toBe(false);
    expect(isPermCategory("nonsense")).toBe(false);
  });
});

describe("isShown", () => {
  it("is true only for an approved timeline that isn't hidden", () => {
    expect(isShown({ status: "approved" })).toBe(true);
    expect(isShown({ status: "approved", hiddenAt: 5 })).toBe(false);
    expect(isShown({ status: "pending" })).toBe(false);
    expect(isShown({ status: "declined" })).toBe(false);
    expect(isShown({})).toBe(false);
  });
});

describe("an office's row and its medians", () => {
  const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ updatedAt: Date.UTC(2026, 8, 1), public: true, ...over }) as TimelineRecord;

  it("counts each step in days from the I-485 filing, and carries no exact date", () => {
    const row = toOfficeRow(
      rec({ i485FiledOn: "2025-05-01", biometricsOn: "2025-06-10", interviewOn: "2026-02-03", greenCardOn: "2026-02-20", category: "eb2", country: "india", permFiledOn: "2023-01-09" }),
    );
    expect(row.filedMonth).toBe("2025-05");
    expect(row.stops.map((s) => [s.id, s.day])).toEqual([
      ["biometricsOn", 40],
      ["eadOn", null],
      ["apOn", null],
      ["interviewOn", 278],
      ["greenCardOn", 295],
    ]);
    const text = JSON.stringify(row);
    expect(text).not.toContain("2025-05-01");
    expect(text).not.toContain("2023-01");
    expect(row.updatedMonth).toBe("2026-09");
  });

  it("gives a step its month and no day count when the I-485 date is missing or later", () => {
    const none = toOfficeRow(rec({ biometricsOn: "2025-06-10" }));
    expect(none.filedMonth).toBeNull();
    expect(none.stops[0]).toEqual({ id: "biometricsOn", day: null, month: "2025-06" });
    const before = toOfficeRow(rec({ i485FiledOn: "2025-07-01", biometricsOn: "2025-06-10" }));
    expect(before.stops[0]!.day).toBeNull();
  });

  it("names only an RFE on the I-485", () => {
    expect(toOfficeRow(rec({ i485FiledOn: "2025-05-01", rfeForm: "i485", rfeOutcome: "approved" })).rfe).toEqual({ outcome: "approved" });
    expect(toOfficeRow(rec({ i485FiledOn: "2025-05-01", rfeForm: "i140" })).rfe).toBeNull();
  });

  it("measures the I-485's steps, each from the filing", () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      rec({ i485FiledOn: "2025-05-01", biometricsOn: `2025-06-${String(10 + i).padStart(2, "0")}`, interviewOn: "2026-02-03" }),
    );
    const m = computeMetrics(five).filter((x) => OFFICE_METRIC_IDS.includes(x.id));
    expect(m.map((x) => x.id)).toEqual(["i485-bio", "i485-ead", "i485-interview", "i485-gc"]);
    expect(m[0]).toMatchObject({ n: 5, median: 42 });
    expect(m[2]).toMatchObject({ n: 5, median: 278 });
    expect(m[3]).toMatchObject({ n: 0, median: null });
  });

  it("the board's row names the office only when told the office's list is open", () => {
    const r = rec({ fieldOffice: "HAR", i485FiledOn: "2025-05-01" });
    expect(toBoardRow(r).office).toBeNull();
    expect(toBoardRow(r, true).office).toBe("HAR");
  });
});

describe("what the owner should look at", () => {
  const rec = (over: Record<string, unknown>) => ({ updatedAt: 1, public: true, ...over }) as TimelineRecord & { caseNumber?: string; permCheckedAt?: number };

  it("says nothing about an ordinary timeline, a long wait included", () => {
    expect(reviewFlags(rec({ permFiledOn: "2012-03-01", permCertifiedOn: "2012-09-01", i140FiledOn: "2012-10-01", i485FiledOn: "2025-05-01", biometricsOn: "2025-06-10", greenCardOn: "2026-02-20" }))).toEqual([]);
  });

  it("points at dates that sit oddly together", () => {
    expect(reviewFlags(rec({ i485FiledOn: "2025-05-01", greenCardOn: "2025-05-09" }))).toEqual(["The green card is dated 8 days after the I-485 filing."]);
    expect(reviewFlags(rec({ permCertifiedOn: "2025-05-01", i140FiledOn: "2025-04-01" }))).toEqual(["The I-140 is dated before DOL certified the PERM."]);
    expect(reviewFlags(rec({ i485FiledOn: "2025-05-01", biometricsOn: "2025-04-01" }))).toEqual(["Biometrics is dated before the I-485 filing."]);
    expect(reviewFlags(rec({ caseNumber: "G-100-25324-425560", permCheckedAt: 5, i140FiledOn: "2025-04-01" }))).toEqual(["DOL's record has no case with this number."]);
    expect(reviewFlags(rec({ i140FiledOn: "2025-04-01", i140ApprovedOn: "2025-04-01", i485FiledOn: "2025-04-01" }))).toEqual(["Every date is the same day."]);
  });

  it("doesn't call a consular visa issued soon after anything a problem", () => {
    expect(reviewFlags(rec({ route: "consular", i140FiledOn: "2025-01-01", greenCardOn: "2025-01-20" }))).toEqual([]);
  });
});

describe("whoIsWaiting", () => {
  const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ updatedAt: 1, public: false, ...over }) as TimelineRecord;
  const many = (n: number, over: Partial<TimelineRecord>) => Array.from({ length: n }, () => rec(over));

  it("places each timeline at the furthest step it reports", () => {
    expect(waitingStage(rec({}))).toBe("perm");
    expect(waitingStage(rec({ permCertifiedOn: "2025-01-01" }))).toBe("certified");
    expect(waitingStage(rec({ i140FiledOn: "2025-02-01" }))).toBe("i140");
    expect(waitingStage(rec({ i140FiledOn: "2025-02-01", i140ApprovedOn: "2025-03-01" }))).toBe("approved");
    expect(waitingStage(rec({ i140ApprovedOn: "2025-03-01", i485FiledOn: "2025-05-01" }))).toBe("i485");
    expect(waitingStage(rec({ i485FiledOn: "2025-05-01", greenCardOn: "2026-01-01" }))).toBe("done");
    // Biometrics, a work permit, a travel document and an interview in the US each follow an I-485.
    expect(waitingStage(rec({ biometricsOn: "2025-06-10" }))).toBe("i485");
    expect(waitingStage(rec({ eadOn: "2025-08-01" }))).toBe("i485");
    expect(waitingStage(rec({ apOn: "2025-08-01" }))).toBe("i485");
    expect(waitingStage(rec({ interviewOn: "2026-01-05" }))).toBe("i485");
    expect(waitingStage(rec({ route: "consular", i140ApprovedOn: "2025-03-01", interviewOn: "2026-01-05" }))).toBe("approved");
  });

  it("stays shut until the board's floor, so a count can't be a person", () => {
    const v = whoIsWaiting(many(BOARD_OPENS_AT - 1, { category: "eb2", country: "india", i140ApprovedOn: "2025-01-01" }));
    expect(v.open).toBe(false);
    expect(v.lines).toEqual([]);
    expect(v.byStage.every((s) => s.count === 0)).toBe(true);
  });

  it("withholds a cell under the minimum and folds a small line into 'unlisted'", () => {
    const v = whoIsWaiting([
      ...many(20, { category: "eb2", country: "india", i140ApprovedOn: "2025-01-01" }),
      ...many(3, { category: "eb2", country: "india", i485FiledOn: "2025-06-01" }),
      ...many(2, { category: "eb3-other", country: "philippines" }),
      ...many(4, {}),
    ]);
    expect(v.open).toBe(true);
    expect(v.lines).toHaveLength(1);
    const india = v.lines[0]!;
    expect([india.category, india.country, india.total]).toEqual(["EB-2", "India", 23]);
    const at = (id: WaitingStageId) => india.counts[WAITING_STAGES.findIndex((s) => s.id === id)];
    expect(at("approved")).toBe(20);
    expect(at("i485")).toBeNull();
    expect(at("done")).toBe(0);
    expect(v.unlisted).toBe(6);
    expect(v.byStage.reduce((a, s) => a + s.count, 0)).toBe(29);
  });

  it("leaves out hidden timelines", () => {
    const v = whoIsWaiting([...many(30, { category: "eb2", country: "row" }), ...many(10, { category: "eb2", country: "row", hiddenAt: 5 })]);
    expect(v.lines[0]!.total).toBe(30);
  });
});

import { describe, expect, it } from "vitest";

import {
  BOARD_OPENS_AT,
  CATEGORIES,
  DATE_FIELDS,
  I485_CENTERS,
  MAX_ACCOUNT_EVENTS,
  METRIC_MIN_N,
  TIMELINE_TEXT_FIELDS,
  OFFICE_LIST_OPENS_AT,
  OFFICE_METRIC_IDS,
  computeMetrics,
  daysBetween,
  formHints,
  isListedCode,
  isPermCategory,
  mergeIntoTimeline,
  isShown,
  reviewFlags,
  sharedDates,
  summarizeRfes,
  tallyCodes,
  thirdFta0,
  toBoardRow,
  toOfficeRow,
  typedCodes,
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
      ["i485jApprovedOn", null],
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

describe("account updates, the service center and the Supplement J date", () => {
  const base = { route: "adjustment", i485FiledOn: "2026-03-02" };

  it("keeps each update's day, form and code, sorted, upper-cased, with exact repeats dropped", () => {
    const r = validateTimeline(
      {
        ...base,
        accountEvents: [
          { on: "2026-06-01", form: "i485", code: "fta0" },
          { on: "2026-04-10", form: "i765", code: null },
          { on: "2026-06-01", form: "i485", code: "FTA0" },
          { on: "2026-05-05", form: "", code: " xq7 " },
        ],
      },
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.accountEvents).toEqual([
      { on: "2026-04-10", form: "i765" },
      { on: "2026-05-05", code: "XQ7" },
      { on: "2026-06-01", form: "i485", code: "FTA0" },
    ]);
    expect(typedCodes(r.value.accountEvents)).toEqual(["XQ7"]);
    expect(isListedCode("FTA0")).toBe(true);
  });

  it("refuses an update with no day, a code that could carry a receipt or a phone number, and more than the limit", () => {
    const bad = (accountEvents: unknown) => validateTimeline({ ...base, accountEvents } as never, TODAY);
    expect(bad([{ form: "i485", code: "FTA0" }])).toMatchObject({ ok: false, code: "account-date" });
    expect(bad([{ on: "2027-01-01" }])).toMatchObject({ ok: false, code: "account-date" });
    expect(bad([{ on: "2026-05-05", code: "IOE0912345678" }])).toMatchObject({ ok: false, code: "account-code" });
    expect(bad([{ on: "2026-05-05", code: "555-1212" }])).toMatchObject({ ok: false, code: "account-code" });
    expect(bad([{ on: "2026-05-05", code: "1FTA" }])).toMatchObject({ ok: false, code: "account-code" });
    expect(bad([{ on: "2026-05-05", form: "n400" }])).toMatchObject({ ok: false, code: "account-form" });
    const many = Array.from({ length: MAX_ACCOUNT_EVENTS + 1 }, (_, i) => ({ on: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, code: `A${i}` }));
    expect(bad(many)).toMatchObject({ ok: false, code: "account-many" });
  });

  it("takes a service center by USCIS's code, and the Supplement J date as one more adjustment date", () => {
    expect(I485_CENTERS.map((c) => c.id).sort()).toEqual(["ESC", "NBC", "NSC", "SSC", "WSC", "YSC"]);
    const r = validateTimeline({ ...base, i485Center: "NBC", i485jApprovedOn: "2026-07-01" }, TODAY);
    expect(r.ok && r.value).toMatchObject({ i485Center: "NBC", i485jApprovedOn: "2026-07-01" });
    expect(validateTimeline({ ...base, i485Center: "HAR" }, TODAY)).toMatchObject({ ok: false, code: "choice", field: "i485Center" });
  });

  it("refuses a center, an I-485 update and a Supplement J date on a consular timeline", () => {
    const consular = { route: "consular", i140FiledOn: "2026-01-02" };
    expect(validateTimeline({ ...consular, i485Center: "NBC" }, TODAY)).toMatchObject({ ok: false, code: "office-consular" });
    expect(validateTimeline({ ...consular, accountEvents: [{ on: "2026-02-02", form: "i485" }] }, TODAY)).toMatchObject({
      ok: false,
      code: "account-consular",
    });
    expect(validateTimeline({ ...consular, accountEvents: [{ on: "2026-02-02", form: "i140", code: "IAF" }] }, TODAY).ok).toBe(true);
    expect(validateTimeline({ ...consular, i485jApprovedOn: "2026-02-02" }, TODAY)).toMatchObject({ ok: false, code: "adjustment-only" });
  });

  it("lists every field the save, the HTTP layer and an edit read, once", () => {
    for (const f of ["i485Center", "i485jApprovedOn", "fieldOffice", "biometricsOn"]) expect(TIMELINE_TEXT_FIELDS).toContain(f);
    expect(new Set(TIMELINE_TEXT_FIELDS).size).toBe(TIMELINE_TEXT_FIELDS.length);
    for (const f of DATE_FIELDS) expect(TIMELINE_TEXT_FIELDS).toContain(f.id);
  });

  it("tells the owner about a typed code, an update before the I-485, and a crowded day", () => {
    const rec = {
      ...base,
      route: "adjustment" as const,
      public: true,
      updatedAt: 0,
      accountEvents: [
        { on: "2026-02-01", form: "i485" as const, code: "FTA0" },
        ...Array.from({ length: 11 }, (_, i) => ({ on: "2026-06-01", code: `Z${i}` })),
      ],
    };
    const flags = reviewFlags(rec);
    expect(flags).toContain("A typed code: Z0.");
    expect(flags.filter((f) => f.startsWith("A typed code"))).toHaveLength(11);
    expect(flags).not.toContain("A typed code: FTA0.");
    expect(flags).toContain("An account update on the I-485 is dated before the I-485 filing.");
    expect(flags).toContain("More than 10 account updates on one day.");
  });

  it("prints a code's count once enough timelines report it, typed codes too", () => {
    const rec = (i: number, codes: string[]): TimelineRecord => ({
      public: true,
      updatedAt: i,
      accountEvents: codes.map((code, j) => ({ on: `2026-05-${String(j + 1).padStart(2, "0")}`, code })),
    });
    const records = [
      ...Array.from({ length: METRIC_MIN_N }, (_, i) => rec(i, ["FTA0", "FTA0", "XQ7"])),
      rec(99, ["IK1"]),
    ];
    expect(tallyCodes(records)).toEqual([
      { code: "FTA0", timelines: METRIC_MIN_N, listed: true },
      { code: "XQ7", timelines: METRIC_MIN_N, listed: false },
    ]);
    expect(tallyCodes(records.slice(1))).toEqual([]);
  });

  it("gives a row its updates as a count, the codes and the newest as days from its start, never a date", () => {
    const r: TimelineRecord = {
      public: true,
      updatedAt: 0,
      i485FiledOn: "2026-03-02",
      accountEvents: [
        { on: "2026-04-01", code: "IAF" },
        { on: "2026-06-01", form: "i485", code: "FTA0" },
      ],
    };
    expect(toOfficeRow(r).updates).toEqual({ count: 2, codes: ["IAF", "FTA0"], lastDay: 91 });
    expect(JSON.stringify(toOfficeRow(r))).not.toContain("2026-06-01");
    expect(toBoardRow(r).updates).toEqual({ count: 2, codes: ["IAF", "FTA0"], lastDay: null });
  });

  it("hints at what to add, never refusing a save", () => {
    expect(formHints({ route: "adjustment", i485FiledOn: "2026-03-02" })).toHaveLength(3);
    expect(formHints({ route: "consular", i140FiledOn: "2026-01-02" })).toEqual([]);
    expect(formHints({ i485FiledOn: "2026-03-02", fieldOffice: "HAR", i485Center: "NBC", accountEvents: [{ on: "2026-04-01", code: "IAF" }] })).toEqual([
      "Saying which form each account update was on makes the counts clearer.",
    ]);
  });

  it("counts the dates two timelines share, for the owner's near-duplicate hint", () => {
    const a: TimelineRecord = { public: true, updatedAt: 0, i485FiledOn: "2026-03-02", biometricsOn: "2026-04-01", eadOn: "2026-06-01" };
    expect(sharedDates(a, { ...a, eadOn: undefined })).toBe(2);
    expect(sharedDates(a, { public: true, updatedAt: 0, i485FiledOn: "2026-03-03" })).toBe(0);
  });
});

describe("adding what the account reader found to a form", () => {
  it("fills only empty answers, adds the updates once each, and keeps the newest the form allows", () => {
    const form = { route: "adjustment", i485FiledOn: "2026-03-01", accountEvents: [{ on: "2026-04-01", form: "i485", code: "IAF" }] };
    const merged = mergeIntoTimeline(form, {
      route: "consular",
      i485FiledOn: "2026-03-02",
      i485Center: "NBC",
      accountEvents: [
        { on: "2026-04-01", form: "i485", code: "iaf" },
        { on: "2026-06-01", form: "i485", code: "FTA0" },
      ],
    });
    expect(merged).toMatchObject({ route: "adjustment", i485FiledOn: "2026-03-01", i485Center: "NBC" });
    expect(merged.accountEvents).toEqual([
      { on: "2026-04-01", form: "i485", code: "IAF" },
      { on: "2026-06-01", form: "i485", code: "FTA0" },
    ]);
    const many = Array.from({ length: MAX_ACCOUNT_EVENTS + 5 }, (_, i) => ({
      on: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      code: `Q${i}`,
    }));
    const kept = mergeIntoTimeline({}, { accountEvents: many }).accountEvents!;
    expect(kept).toHaveLength(MAX_ACCOUNT_EVENTS);
    expect(kept[kept.length - 1]).toEqual(many[many.length - 1]);
    expect(validateTimeline({ route: "adjustment", ...mergeIntoTimeline(form, { accountEvents: [{ on: "2026-06-01", code: "FTA0" }] }) }, "2026-11-17").ok).toBe(true);
  });
});

describe("after a third FTA0", () => {
  const TODAY_ISO = "2026-11-17";
  const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
  const fta = (...days: string[]) => days.map((on) => ({ on, form: "i485" as const, code: "FTA0" }));
  const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: true, updatedAt: at("2026-11-10"), ...over });

  it("counts both halves: a card after it, and still waiting, with medians from five", () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      rec({ accountEvents: fta("2026-01-01", "2026-02-01", "2026-03-01"), greenCardOn: `2026-03-${String(11 + i * 2).padStart(2, "0")}` }),
    );
    const waiting = [
      rec({ accountEvents: fta("2026-05-01", "2026-06-01", "2026-07-01") }),
      // Quiet for over 60 days: not known to be waiting.
      rec({ accountEvents: fta("2026-05-01", "2026-06-01", "2026-07-01"), updatedAt: at("2026-08-01") }),
      // Only two FTA0s, and an FTA0 on another form: no third on the I-485.
      rec({ accountEvents: [...fta("2026-05-01", "2026-06-01"), { on: "2026-07-01", form: "i765", code: "FTA0" }] }),
    ];
    const r = thirdFta0([...cards, ...waiting], TODAY_ISO);
    expect(r).toEqual({ reported: 7, withCard: 5, medianToCard: 14, waiting: 1, medianWaiting: null });
  });

  it("is all zeros with nothing reported", () => {
    expect(thirdFta0([], TODAY_ISO)).toEqual({ reported: 0, withCard: 0, medianToCard: null, waiting: 0, medianWaiting: null });
  });
});

import { describe, expect, it } from "vitest";

import {
  CONTACT_KINDS,
  DETAIL_DATES,
  INTERVIEW_OUTCOMES,
  MAX_CONTACTS,
  METRIC_MIN_N,
  TIMELINE_TEXT_FIELDS,
  computeMetrics,
  contactOutcomes,
  interviewShare,
  toBoardRow,
  toOfficeRow,
  validateTimeline,
  type TimelineRecord,
} from "./communityTimeline";

/**
 * The details the I-485 crowd asks about: the day premium was requested, the move to a field office, the card in the
 * mail, whether the interview was waived, and what people did to move a case (a service request, an Emma chat, a
 * call, a congressional inquiry, the Ombudsman, an expedite request).
 */

const TODAY = "2026-11-18";
const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: true, updatedAt: Date.UTC(2026, 10, 1), ...over });
const base = { i485FiledOn: "2026-01-05" };

describe("the detail dates and the interview answer", () => {
  it("are text fields the HTTP layer narrows and an edit reads back", () => {
    for (const f of [...DETAIL_DATES.map((d) => d.id), "interview"]) expect(TIMELINE_TEXT_FIELDS).toContain(f);
    expect(INTERVIEW_OUTCOMES.map((o) => o.id)).toEqual(["held", "waived"]);
  });

  it("are saved when they fit the other dates", () => {
    const r = validateTimeline(
      {
        ...base,
        premium: true,
        i140FiledOn: "2025-10-01",
        premiumOn: "2025-12-01",
        i140ApprovedOn: "2025-12-20",
        officeMovedOn: "2026-05-02",
        greenCardOn: "2026-09-01",
        cardArrivedOn: "2026-09-15",
        interview: "waived",
      },
      TODAY,
    );
    expect(r.ok && r.value).toMatchObject({ premiumOn: "2025-12-01", officeMovedOn: "2026-05-02", cardArrivedOn: "2026-09-15", interview: "waived" });
  });

  it("refuses each one that contradicts another date", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ i140FiledOn: "2025-10-01", premiumOn: "2025-09-01" }, "premium-order"],
      [{ greenCardOn: "2026-09-01", cardArrivedOn: "2026-08-01" }, "card-order"],
      [{ officeMovedOn: "2025-12-01" }, "office-order"],
      [{ interview: "waived", interviewOn: "2026-06-01" }, "interview-waived-date"],
      [{ interview: "skipped" }, "choice"],
      [{ route: "consular", i140FiledOn: "2025-10-01", officeMovedOn: "2026-02-01", i485FiledOn: undefined }, "adjustment-only"],
    ];
    for (const [over, code] of cases) expect(validateTimeline({ ...base, ...over }, TODAY), code).toMatchObject({ ok: false, code });
  });
});

describe("what people did to move a case", () => {
  it("keeps each with its day and kind, sorted, an exact repeat once", () => {
    const r = validateTimeline(
      { ...base, contacts: [{ on: "2026-08-02", kind: "congressional" }, { on: "2026-07-01", kind: "emma" }, { on: "2026-07-01", kind: "emma" }] },
      TODAY,
    );
    expect(r.ok && r.value.contacts).toEqual([
      { on: "2026-07-01", kind: "emma" },
      { on: "2026-08-02", kind: "congressional" },
    ]);
    expect(CONTACT_KINDS.map((k) => k.id)).toEqual(["service-request", "emma", "call", "congressional", "ombudsman", "expedite"]);
  });

  it("refuses a day that isn't one, a kind that isn't listed, and more than the most kept", () => {
    expect(validateTimeline({ ...base, contacts: [{ on: "tomorrow", kind: "emma" }] }, TODAY)).toMatchObject({ ok: false, code: "contact-date" });
    expect(validateTimeline({ ...base, contacts: [{ on: "2026-07-01", kind: "prayer" }] }, TODAY)).toMatchObject({ ok: false, code: "contact-kind" });
    const many = Array.from({ length: MAX_CONTACTS + 1 }, (_, i) => ({ on: `2026-07-${String(i + 1).padStart(2, "0")}`, kind: "call" }));
    expect(validateTimeline({ ...base, contacts: many }, TODAY)).toMatchObject({ ok: false, code: "contact-many" });
  });

  it("shows on a row as a count and its kinds, never its days", () => {
    const row = toBoardRow(rec({ ...base, contacts: [{ on: "2026-07-01", kind: "emma" }, { on: "2026-08-02", kind: "congressional" }], interview: "waived" }));
    expect(row.contacts).toEqual({ count: 2, kinds: ["emma", "congressional"] });
    expect(row.interview).toBe("waived");
    expect(JSON.stringify(row)).not.toContain("2026-07-01");
    expect(toOfficeRow(rec({ ...base, contacts: [{ on: "2026-07-01", kind: "call" }] })).contacts).toEqual({ count: 1, kinds: ["call"] });
    expect(toBoardRow(rec({ ...base })).contacts).toBeNull();
  });

  it("after each kind: how many got the card and how soon, a median only at the floor", () => {
    const rows = [
      ...Array.from({ length: METRIC_MIN_N }, (_, i) =>
        rec({ ...base, contacts: [{ on: "2026-06-01", kind: "congressional" }], greenCardOn: `2026-07-${String(i + 1).padStart(2, "0")}` }),
      ),
      rec({ ...base, contacts: [{ on: "2026-10-01", kind: "congressional" }] }),
      rec({ ...base, contacts: [{ on: "2026-10-01", kind: "emma" }] }),
    ];
    const out = contactOutcomes(rows, TODAY);
    const cong = out.find((o) => o.kind === "congressional")!;
    expect(cong).toMatchObject({ reported: METRIC_MIN_N + 1, withCard: METRIC_MIN_N, medianToCard: 32, waiting: 1 });
    expect(out.find((o) => o.kind === "emma")).toMatchObject({ reported: 1, withCard: 0, medianToCard: null });
    expect(out.find((o) => o.kind === "ombudsman")).toMatchObject({ reported: 0 });
  });
});

describe("the figures the details feed", () => {
  it("count premium from the day it was requested when that came after filing", () => {
    const rows = Array.from({ length: METRIC_MIN_N }, () =>
      rec({ premium: true, i140FiledOn: "2025-01-01", premiumOn: "2025-06-01", i140ApprovedOn: "2025-06-21" }),
    );
    expect(computeMetrics(rows).find((m) => m.id === "i140-premium")?.median).toBe(20);
  });

  it("measure the move to a field office and the card in the mail", () => {
    const rows = Array.from({ length: METRIC_MIN_N }, () =>
      rec({ i485FiledOn: "2026-01-01", officeMovedOn: "2026-04-11", greenCardOn: "2026-08-01", cardArrivedOn: "2026-08-15" }),
    );
    const m = Object.fromEntries(computeMetrics(rows).map((x) => [x.id, x.median]));
    expect(m["i485-office"]).toBe(100);
    expect(m["gc-card"]).toBe(14);
  });

  it("say how many green cards came without an interview, once enough say either way", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => rec({ greenCardOn: "2026-08-01", interview: "waived" })),
      ...Array.from({ length: 2 }, () => rec({ greenCardOn: "2026-08-01", interview: "held" })),
      rec({ greenCardOn: "2026-08-01", interviewOn: "2026-07-01" }),
      rec({ greenCardOn: "2026-08-01" }),
    ];
    expect(interviewShare(rows)).toEqual({ answered: 6, waived: 3 });
  });
});

describe("the RFE's own times", () => {
  it("measure the answer and the decision after it, the decision by the RFE's form", () => {
    const i140 = Array.from({ length: METRIC_MIN_N }, () =>
      rec({ rfeForm: "i140", rfeIssuedOn: "2026-03-01", rfeRespondedOn: "2026-04-15", i140ApprovedOn: "2026-05-15", greenCardOn: "2026-10-01" }),
    );
    const m = Object.fromEntries(computeMetrics(i140).map((x) => [x.id, x.median]));
    expect(m["rfe-answer"]).toBe(45);
    expect(m["rfe-decision"]).toBe(30);
    const i485 = Array.from({ length: METRIC_MIN_N }, () =>
      rec({ rfeForm: "i485", rfeIssuedOn: "2026-03-01", rfeRespondedOn: "2026-04-15", i140ApprovedOn: "2025-01-01", greenCardOn: "2026-06-14" }),
    );
    expect(computeMetrics(i485).find((x) => x.id === "rfe-decision")?.median).toBe(60);
  });
});

describe("more than one RFE", () => {
  const first = { rfeForm: "i140", rfeReason: "ability-to-pay", rfeIssuedOn: "2026-06-25", rfeRespondedOn: "2026-08-19", rfeOutcome: "approved" };
  const second = { form: "i485", reason: "medical", issuedOn: "2026-10-26", respondedOn: "2026-10-30", outcome: "approved" };

  it("keeps the first in its own fields and the rest in a list, each checked", async () => {
    const { MAX_MORE_RFES, rfesOf } = await import("./communityTimeline");
    const r = validateTimeline({ ...base, ...first, moreRfes: [second] }, TODAY);
    expect(r.ok && r.value.moreRfes).toEqual([second]);
    expect(rfesOf(rec({ ...(r.ok ? r.value : {}) }))).toEqual([
      { form: "i140", reason: "ability-to-pay", issuedOn: "2026-06-25", respondedOn: "2026-08-19", outcome: "approved" },
      second,
    ]);
    expect(validateTimeline({ ...base, ...first, moreRfes: [{ ...second, form: undefined }] }, TODAY)).toMatchObject({ ok: false, code: "rfe-form" });
    expect(validateTimeline({ ...base, ...first, moreRfes: [{ ...second, respondedOn: "2026-10-01" }] }, TODAY)).toMatchObject({ ok: false, code: "rfe-order" });
    expect(validateTimeline({ ...base, ...first, moreRfes: [{ ...second, reason: "vibes" }] }, TODAY)).toMatchObject({ ok: false, code: "choice" });
    const many = Array.from({ length: MAX_MORE_RFES + 1 }, () => second);
    expect(validateTimeline({ ...base, ...first, moreRfes: many }, TODAY)).toMatchObject({ ok: false, code: "rfe-many" });
  });

  it("counts every RFE in the summary, the medians and the row", async () => {
    const { summarizeRfes } = await import("./communityTimeline");
    const one = rec({ ...base, ...(first as Partial<TimelineRecord>), moreRfes: [second as never], i140ApprovedOn: "2026-08-25", greenCardOn: "2026-11-17" });
    const s = summarizeRfes([one]);
    expect(s.total).toBe(2);
    expect(s.byForm.map((f) => [f.id, f.count])).toEqual([["i140", 1], ["i485", 1]]);
    const five = Array.from({ length: METRIC_MIN_N }, () => one);
    const m = Object.fromEntries(computeMetrics(five).map((x) => [x.id, x]));
    expect(m["rfe-answer"]).toMatchObject({ n: 2 * METRIC_MIN_N });
    expect(m["rfe-decision"]).toMatchObject({ n: 2 * METRIC_MIN_N });
    const row = toBoardRow(one);
    expect(row.rfes.map((x) => x.form)).toEqual(["i140", "i485"]);
    expect(row.rfe).toMatchObject({ form: "i140" });
    expect(toOfficeRow(one).rfe).toEqual({ outcome: "approved" });
  });
});

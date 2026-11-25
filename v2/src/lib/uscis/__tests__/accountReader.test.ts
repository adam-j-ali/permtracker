import { describe, expect, it } from "vitest";

import { validateTimeline } from "@/lib/communityTimeline";
import { easternDay, formIdOf, readAccount, timelineFrom } from "@/lib/uscis/accountReader";

/**
 * Reading what a person pastes from their own USCIS account, in the browser only. The JSON below is invented in the
 * shape filers describe (a case with a receipt number, a form and a list of events, each a code and a time); no real
 * person's data is in this file.
 */
const ACCOUNT = JSON.stringify({
  data: [
    {
      receiptNumber: "MSC2690012345",
      formType: "I485",
      submissionDate: "2026-03-02T15:00:00.000Z",
      events: [
        { eventId: "a1", eventCode: "IAF", eventDateTime: "2026-03-04T13:00:00.000Z", receiptNumber: "MSC2690012345" },
        { eventId: "a2", eventCode: "FTA0", eventDateTime: "2026-06-02T02:10:00.000Z" },
        { eventId: "a3", eventCode: "FTA0", eventDateTime: "2026-06-02T02:10:00.000Z" },
        { eventId: "a4", eventCode: "xq7", eventDateTime: "2026-08-01T16:00:00.000Z" },
      ],
    },
    {
      receiptNumber: "IOE9912345678",
      formType: "I-765",
      events: [{ eventCode: "LDA", eventDateTime: "2026-05-20T18:00:00.000Z" }],
    },
  ],
});

describe("reading a pasted account", () => {
  it("finds each case, its form and its updates, by their shape, on the Eastern day", () => {
    const r = readAccount(ACCOUNT);
    expect(r.kind).toBe("json");
    expect(r.cases).toHaveLength(2);
    const i485 = r.cases[0]!;
    expect(i485).toMatchObject({ formLabel: "I-485", form: "i485", center: "NBC", receivedOn: "2026-03-02" });
    // 2:10 AM UTC on June 2 was the evening of June 1 in Washington; the repeat is dropped; a typed-looking code stays.
    expect(i485.updates).toEqual([
      { on: "2026-03-04", code: "IAF" },
      { on: "2026-06-01", code: "FTA0" },
      { on: "2026-08-01", code: "XQ7" },
    ]);
    expect(r.cases[1]).toMatchObject({ form: "i765", center: null, updates: [{ on: "2026-05-20", code: "LDA" }] });
  });

  it("never returns a receipt number whole", () => {
    const r = readAccount(ACCOUNT);
    expect(JSON.stringify(r)).not.toContain("MSC2690012345");
    expect(JSON.stringify(r)).not.toContain("9912345678");
    expect(r.cases[0]!.receipt).toBe("MSC••••••2345");
  });

  it("reads updates from text, a listed code and a date on one line", () => {
    const r = readAccount("I-485  FTA0  06/01/2026\nI-485 IAF 2026-03-04\nEAD card mailed 2026-05-20\nUSCIS said hello");
    expect(r.kind).toBe("text");
    expect(r.cases).toEqual([{ receipt: null, formLabel: "I-485", form: "i485", center: null, receivedOn: null, updates: [{ on: "2026-03-04", code: "IAF" }, { on: "2026-06-01", code: "FTA0" }] }]);
  });

  it("says it found nothing rather than guessing", () => {
    expect(readAccount("")).toEqual({ kind: "none", cases: [] });
    expect(readAccount("my case is taking forever")).toEqual({ kind: "none", cases: [] });
    expect(readAccount('{"hello": "world"}')).toEqual({ kind: "none", cases: [] });
    expect(readAccount("{not json at all FTA0 2026-01-02")).toMatchObject({ kind: "text" });
  });

  it("maps a form to the timeline's id only for the forms it records", () => {
    expect(formIdOf("I-485J")).toBe("i485j");
    expect(formIdOf("I130")).toBeNull();
    expect(easternDay("2026-01-01T03:00:00Z")).toBe("2025-12-31");
    expect(easternDay("not a date")).toBeNull();
  });
});

describe("what the timeline form takes from a reading", () => {
  it("every update on its form, the I-485's center and filing day, and never a receipt number", () => {
    const filled = timelineFrom(readAccount(ACCOUNT).cases);
    expect(filled).toMatchObject({ route: "adjustment", i485Center: "NBC", i485FiledOn: "2026-03-02" });
    expect(filled.accountEvents).toEqual([
      { on: "2026-03-04", form: "i485", code: "IAF" },
      { on: "2026-05-20", form: "i765", code: "LDA" },
      { on: "2026-06-01", form: "i485", code: "FTA0" },
      { on: "2026-08-01", form: "i485", code: "XQ7" },
    ]);
    expect(JSON.stringify(filled)).not.toMatch(/MSC|IOE|\d{10}/);
    expect(validateTimeline(filled, "2026-11-17").ok).toBe(true);
  });
});

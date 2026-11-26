/**
 * One receipt block's status mix, counted from every case the sample holds there (the block card): the outcome groups
 * in the site's one status code, the waiting steps named the way USCIS's page reads, shares out of the block's cases,
 * whether every number was checked, and the line people paste into a chat.
 */
import { describe, expect, it } from "vitest";

import { blockCoverage, blockFormChoices, blockShareLine, blockStatusMix } from "../uscisSample";

const ROWS = [
  { grp: "approved", status: "Case Was Approved", n: 27054 },
  { grp: "waiting", status: "Case Was Received and A Receipt Notice Was Sent", n: 12533 },
  { grp: "waiting", status: "USCIS Is currently Processing the Case", n: 32933 },
  { grp: "waiting", status: "Interview Was Scheduled", n: 1661 },
  { grp: "waiting", status: "Response To USCIS' Request For Evidence Was Received", n: 1539 },
  { grp: "waiting", status: "Biometrics Appointment Was Scheduled", n: 722 },
  { grp: "waiting", status: "Interview Cancelled", n: 60 },
  { grp: "waiting", status: "Case Was Received At Another USCIS Office", n: 177 },
  { grp: "denied", status: "Case Was Denied", n: 1106 },
  { grp: "closed", status: "Case Closed Benefit Received By Other Means", n: 584 },
  { grp: "rejected", status: "Case Rejected For Form Not Signed", n: 451 },
  { grp: "rfe", status: "Request for Additional Evidence Was Sent", n: 382 },
  { grp: "revoked", status: "Approval Was Revoked", n: 352 },
  { grp: "decided", status: "Decision Notice Mailed", n: 182 },
  { grp: "withdrawn", status: "Withdrawal Acknowledgement Notice Was Sent", n: 151 },
  { grp: "other", status: "Something New", n: 3 },
];

describe("blockStatusMix", () => {
  const mix = blockStatusMix(ROWS);

  it("counts every case once, and each group out of them", () => {
    expect(mix.total).toBe(79890);
    const byKey = Object.fromEntries(mix.groups.map((x) => [x.key, x]));
    expect(byKey.approved?.n).toBe(27054);
    expect(byKey.waiting?.n).toBe(12533 + 32933 + 1661 + 1539 + 722 + 60 + 177);
    expect(byKey.other?.n).toBe(584 + 451 + 352 + 182 + 3);
    expect(mix.groups.reduce((s, x) => s + x.n, 0)).toBe(mix.total);
    expect(byKey.approved?.share).toBeCloseTo(27054 / 79890, 10);
  });

  it("keeps the groups in one order whatever the counts: outcomes first, waiting last", () => {
    expect(mix.groups.map((x) => x.key)).toEqual(["approved", "denied", "rfe", "withdrawn", "other", "waiting"]);
  });

  it("leaves out a group with no cases", () => {
    const small = blockStatusMix([{ grp: "approved", status: "Case Was Approved", n: 3 }, { grp: "waiting", status: "Case Was Received and A Receipt Notice Was Sent", n: 1 }]);
    expect(small.groups.map((x) => x.key)).toEqual(["approved", "waiting"]);
  });

  it("names the waiting steps plainly, largest first, a received-elsewhere case under other steps", () => {
    expect(mix.waiting.map((s) => [s.label, s.n])).toEqual([
      ["Being processed", 32933],
      ["Received", 12533],
      ["Interview scheduled", 1661],
      ["Evidence sent back", 1539],
      ["Other waiting steps", 722 + 60 + 177],
    ]);
  });

  it("names what each outcome group holds, for its tooltip", () => {
    const other = mix.groups.find((x) => x.key === "other");
    expect(other?.parts).toEqual([
      ["Closed", 584],
      ["Rejected as filed", 451],
      ["Revoked", 352],
      ["Decided", 182],
      ["Other", 3],
    ]);
  });

  it("is empty, not a division by zero, with no cases", () => {
    const none = blockStatusMix([]);
    expect(none.total).toBe(0);
    expect(none.groups).toEqual([]);
    expect(none.waiting).toEqual([]);
  });

  it("reads libSQL's counts, which arrive as strings", () => {
    const m = blockStatusMix([{ grp: "approved", status: "Case Was Approved", n: "7" as unknown as number }]);
    expect(m.total).toBe(7);
  });
});

describe("blockCoverage", () => {
  it("says every number was checked when the census walked the whole block", () => {
    expect(blockCoverage({ _walked_share: 1 })).toEqual({ every: true, walkedShare: 1 });
  });
  it("says a part when the census walked some of it", () => {
    expect(blockCoverage({ _walked_share: 0.4 })).toEqual({ every: false, walkedShare: 0.4 });
  });
  it("reads a block the estimate never reached as unwalked", () => {
    expect(blockCoverage(undefined)).toEqual({ every: false, walkedShare: 0 });
    expect(blockCoverage({})).toEqual({ every: false, walkedShare: 0 });
  });
});

describe("blockShareLine", () => {
  it("is the block in one line, with the page's address typed out", () => {
    const line = blockShareLine("IOE09377", "2026-11-26", blockStatusMix(ROWS), { every: true, walkedShare: 1 });
    expect(line).toBe(
      "IOE09377, every number checked by November 26, 2026: 79,890 cases. Approved 34%, denied 1.4%, evidence request 0.5%, withdrawn 0.2%, other outcomes 2.0%, waiting 62%. permtracker.app/uscis-receipt-blocks/IOE09377",
    );
  });
  it("says the cases were checked so far when the block isn't walked whole", () => {
    const line = blockShareLine("IOE09360", "2026-11-26", blockStatusMix(ROWS.slice(0, 2)), { every: false, walkedShare: 0 });
    expect(line.startsWith("IOE09360, the cases checked by November 26, 2026: 39,587 cases. Approved 68%, waiting 32%.")).toBe(true);
  });
});

describe("blockFormChoices", () => {
  const byForm = {
    "I-765": [{ grp: "approved", status: "", n: 5885 }, { grp: "waiting", status: "Case Was Received and A Receipt Notice Was Sent", n: 1440 }],
    "I-485": [{ grp: "approved", status: "", n: 2000 }, { grp: "waiting", status: "", n: 9557 }],
    "I-131": [{ grp: "waiting", status: "", n: 12 }],
    "": [{ grp: "approved", status: "", n: 3 }],
  };
  const choices = blockFormChoices(byForm);

  it("starts with every form together, then each form with enough cases, most first", () => {
    expect(choices.map((c) => c.key)).toEqual(["all", "I-485", "I-765"]);
    expect(choices[0]?.mix.total).toBe(5885 + 1440 + 2000 + 9557 + 12 + 3);
    expect(choices[0]?.label).toBe("All forms");
  });

  it("names each form in plain words beside its number", () => {
    expect(choices.find((c) => c.key === "I-765")?.label).toBe("I-765, work permit");
    expect(choices.find((c) => c.key === "I-485")?.label).toBe("I-485, green card");
  });

  it("leaves a form with only a few cases inside every form together", () => {
    expect(choices.some((c) => c.key === "I-131")).toBe(false);
  });

  it("reads the older one-list document as every form together", () => {
    const old = blockFormChoices({ "": [{ grp: "approved", status: "", n: 40 }] });
    expect(old.map((c) => c.key)).toEqual(["all"]);
  });
});

describe("blockShareLine for one form", () => {
  it("names the form and opens the page on it", () => {
    const mix = blockStatusMix([{ grp: "approved", status: "", n: 30 }, { grp: "waiting", status: "", n: 70 }]);
    expect(blockShareLine("IOE09358", "2026-11-27", mix, { every: true }, { key: "I-765", label: "I-765, work permit" })).toBe(
      "IOE09358, I-765 (work permit) cases, every number checked by November 27, 2026: 100 cases. Approved 30%, waiting 70%. permtracker.app/uscis-receipt-blocks/IOE09358#form=I-765",
    );
  });
});

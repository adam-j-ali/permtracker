// @vitest-environment jsdom
/**
 * The change browser's two honesty rules, and the filtering that hangs off
 * them.
 *
 * RULE ONE: A CONTROL THAT CANNOT WORK IS SHOWN, DISABLED, WITH ITS REASON.
 * DOL returns five fields on a live case - number, employer, job title, filing
 * date, status. Wage, law firm, worksite state and SOC arrive only when the
 * case is published in a quarterly file. Offering those as filters here would
 * return nothing and read as a broken site; omitting them leaves the reader
 * wondering. Both were rejected, so the test pins the third option.
 *
 * RULE TWO: A TRUNCATED LIST IS NOT SORTABLE. The prerendered slice is the
 * first rows of the day by employer. Sorting it by status would put a
 * confident-looking order over a sample, so every control stays off until the
 * whole day has arrived - which is also the state a reader with no JavaScript
 * keeps permanently, so the sentence beside the table has to be true then too.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { CaseChange, ChangeCalendar, ChangeDayFeed } from "@/lib/db/changes";

const usePublicQuery = vi.fn();
vi.mock("@/hooks/usePublicQuery", () => ({ usePublicQuery }));

const { ChangeFeedBrowser } = await import("../ChangeFeedBrowser");

/**
 * The two records as production holds them. The gap between 2026-06-30 and
 * 2026-08-26 is genuine, so a fixture using round numbers would not exercise
 * the case the page exists to describe.
 */
const WINDOWS = {
  decided: { from: "2023-10-01", to: "2026-06-30" },
  observed: { from: "2026-08-26", to: "2026-09-03" },
};

function change(over: Partial<CaseChange> = {}): CaseChange {
  return {
    caseNumber: "G-100-25308-370619",
    program: "perm",
    observedOn: "2026-09-03",
    fromStatus: "ANALYST REVIEW",
    toStatus: "CERTIFIED",
    isFinal: true,
    employerName: "Flextronics International USA, Inc.",
    employerSlug: null,
    jobTitle: "Automation Engineer",
    filingDate: "2025-11-04",
    ...over,
  };
}

const CALENDAR: ChangeCalendar = {
  days: [
    { date: "2026-09-03", total: 587, byProgram: { perm: 279, pwd: 200, lca: 108 } },
    { date: "2026-09-02", total: 1090, byProgram: { perm: 1090, pwd: 0, lca: 0 } },
  ],
  observedSince: "2026-08-27",
  programSince: { perm: "2026-08-27", pwd: "2026-09-03", lca: "2026-09-03" },
  truncated: false,
};

const ROWS: CaseChange[] = [
  change({ caseNumber: "G-100-25308-370619", employerName: "Flextronics International USA, Inc." }),
  change({
    caseNumber: "G-100-25200-111111",
    employerName: "Amazon.com Services LLC",
    jobTitle: "Software Development Engineer",
    toStatus: "DENIED",
  }),
  change({
    caseNumber: "P-100-26100-222222",
    program: "pwd",
    employerName: "Zebra Technologies",
    jobTitle: "Data Scientist",
    fromStatus: "IN PROCESS",
    toStatus: "DETERMINATION ISSUED",
    filingDate: "2026-04-09",
  }),
];

function day(over: Partial<ChangeDayFeed> = {}): ChangeDayFeed {
  return {
    date: "2026-09-03",
    changes: ROWS,
    total: 587,
    byProgram: { perm: 2, pwd: 1, lca: 0 },
    transitions: [
      { fromStatus: "ANALYST REVIEW", toStatus: "CERTIFIED", n: 175 },
      { fromStatus: "ANALYST REVIEW", toStatus: "DENIED", n: 29 },
      { fromStatus: "IN PROCESS", toStatus: "DETERMINATION ISSUED", n: 121 },
    ],
    expiriesExcluded: 287,
    bulkExcluded: 0,
    ...over,
  };
}

/** The state before the whole-day fetch lands, and with the script broken. */
function pending() {
  usePublicQuery.mockReturnValue({ data: undefined, failed: false });
}
/** The state once it has. */
function loaded(over: Partial<ChangeDayFeed> = {}) {
  usePublicQuery.mockReturnValue({ data: { day: day(over) }, failed: false });
}

function caseNumbers(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.cells[0]!.textContent!.trim());
}

beforeEach(() => {
  usePublicQuery.mockReset();
});

describe("filters DOL's data cannot support", () => {
  it("explains them on a date only the live check covers, one click away", () => {
    // 2026-09-03 is past DOL's last published file, so on THIS date the four
    // fields genuinely do not exist. The panel used to open itself here; since
    // 2026-10-01 it stays shut and its summary says why, so the feed is not
    // pushed down by four boxes. The explanation is still in the page.
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);

    const panel = screen.getByText(/why wage, law firm, worksite and occupation are off/i).closest("details");
    expect(panel?.open).toBe(false);
    for (const why of [/no wage from the live case lookup/i, /attorney or agent only at publication/i,
                       /worksite is on the published record/i, /SOC code is on the published record/i]) {
      expect(screen.getByText(why)).toBeInTheDocument();
    }
  });

  it("says they WORK on a date inside the published files, and stays shut", () => {
    // THE OLD BEHAVIOUR WAS A BLANKET RULE AND IT WAS WRONG. These four exist
    // on every published case, so on a date DOL has published they are fully
    // filterable. Disabling them regardless taught the reader they can never
    // be used, which is what made a two-year-old date look unanswerable.
    loaded();
    render(
      <ChangeFeedBrowser
        calendar={CALENDAR}
        initialDay={{ ...day(), date: "2025-03-12" }}
        windows={WINDOWS}
      />,
    );

    const summary = screen.getByText(/available for these dates/i);
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.queryByText(/no wage from the live case lookup/i)).toBeNull();
  });

  it("sends the reader where those filters do work", () => {
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    expect(screen.getByRole("link", { name: /decided case browser/i })).toHaveAttribute(
      "href",
      "/perm-cases",
    );
  });
});

describe("before the whole day has loaded", () => {
  it("turns every control off, including sorting", () => {
    pending();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);

    expect((screen.getByLabelText("Search these dates") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Changed from") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Program") as HTMLSelectElement).disabled).toBe(true);
    for (const h of screen.getAllByRole("button", { name: /Employer|Changed to/ })) {
      expect((h as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("says what is on screen without promising a load that may never come", () => {
    // This is also the prerendered sentence, so it has to read correctly for
    // somebody whose JavaScript never runs.
    pending();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    expect(screen.getByText(/Showing the first 3 of 587 changes/)).toBeTruthy();
  });

  it("still lets the day be changed, because that is a fresh request either way", () => {
    pending();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    expect((screen.getByLabelText("From date") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("searching, filtering and sorting one day", () => {
  it("searches the case number, the employer and the job title", () => {
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    const box = screen.getByLabelText("Search these dates");

    fireEvent.change(box, { target: { value: "flextronics" } });
    expect(caseNumbers()).toEqual(["G-100-25308-370619"]);

    fireEvent.change(box, { target: { value: "Data Scientist" } });
    expect(caseNumbers()).toEqual(["P-100-26100-222222"]);

    fireEvent.change(box, { target: { value: "25200" } });
    expect(caseNumbers()).toEqual(["G-100-25200-111111"]);
  });

  it("filters on each end of the transition independently", () => {
    // A count cannot show a transition, and neither can one end of it:
    // "everything that became CERTIFIED" and "everything that left ANALYST
    // REVIEW" are different questions.
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);

    fireEvent.change(screen.getByLabelText("Changed to"), { target: { value: "DENIED" } });
    expect(caseNumbers()).toEqual(["G-100-25200-111111"]);

    fireEvent.change(screen.getByLabelText("Changed to"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Changed from"), { target: { value: "IN PROCESS" } });
    expect(caseNumbers()).toEqual(["P-100-26100-222222"]);
  });

  it("filters by program, and disables a program with nothing that day", () => {
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    const select = screen.getByLabelText("Program") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "pwd" } });
    expect(caseNumbers()).toEqual(["P-100-26100-222222"]);

    // Shown with its count rather than hidden: a program with nothing on this
    // day is a fact about the day, and hiding it reads as the program not
    // existing at all.
    const lca = within(select).getByRole("option", { name: /H-1B LCA/ }) as HTMLOptionElement;
    expect(lca.disabled).toBe(true);
    expect(lca.textContent).toContain("(0)");
  });

  it("sorts on any column, and a click on the active one reverses it", () => {
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);

    // Employer ascending is the default, and it is already active, so the
    // first click on that header flips it rather than re-applying it.
    expect(caseNumbers()[0]).toBe("G-100-25200-111111"); // Amazon
    fireEvent.click(screen.getByRole("button", { name: /^Employer/ }));
    expect(caseNumbers()[0]).toBe("P-100-26100-222222"); // Zebra
    fireEvent.click(screen.getByRole("button", { name: /^Employer/ }));
    expect(caseNumbers()[0]).toBe("G-100-25200-111111");

    // A different column starts in the direction that column is read in: a
    // date newest-first, a name A to Z.
    fireEvent.click(screen.getByRole("button", { name: /^Filed/ }));
    expect(caseNumbers()[0]).toBe("P-100-26100-222222"); // 2026-04-09
    fireEvent.click(screen.getByRole("button", { name: /^Changed to/ }));
    expect(caseNumbers()[0]).toBe("G-100-25308-370619"); // CERTIFIED
  });

  it("reports how many matched, and offers a way back when nothing does", () => {
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);

    fireEvent.change(screen.getByLabelText("Search these dates"), {
      target: { value: "no such employer" },
    });
    expect(screen.queryByRole("table")).toBeNull();
    // The empty state names the day's real size, so "no results" cannot be
    // mistaken for "DOL did nothing".
    const empty = screen.getByText(/Nothing on .* matches that/);
    expect(empty.textContent).toContain("587");

    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(caseNumbers()).toHaveLength(3);
  });
});

describe("what the day itself leaves out", () => {
  it("names both exclusions, with the count each one costs THAT day", () => {
    // Rendered on the server once, this would keep describing the day the page
    // was built for while the reader looked at another one.
    loaded({ expiriesExcluded: 92_113, bulkExcluded: 2_410 });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);

    const note = screen.getByText(/Left out of that count/);
    expect(note.textContent).toContain("92,113");
    expect(note.textContent).toContain("2,410");
    expect(note.textContent).toMatch(/180-day/);
    expect(note.textContent).toMatch(/catching up/);
  });

  it("says nothing when a day excluded nothing, rather than printing a zero", () => {
    loaded({ expiriesExcluded: 0, bulkExcluded: 0 });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    expect(screen.queryByText(/Left out of that count/)).toBeNull();
  });
});

describe("the kinds of change, as chips", () => {
  const MANY = Array.from({ length: 9 }, (_, i) => ({
    fromStatus: `FROM ${i}`,
    toStatus: `TO ${i}`,
    n: 100 - i,
  }));

  it("shows the six busiest until asked, then every kind", () => {
    loaded({ transitions: MANY });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day({ transitions: MANY })} windows={WINDOWS} />);
    expect(screen.getAllByRole("button", { pressed: false }).filter((b) => /FROM \d/.test(b.textContent ?? ""))).toHaveLength(6);
    expect(screen.queryByText("TO 8")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show all 9 kinds of change/i }));
    expect(screen.getByText("TO 8")).toBeInTheDocument();
  });

  it("offers no toggle when every kind already fits", () => {
    loaded();
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
  });
});

describe("a range of days DOL hasn't published yet", () => {
  // Until Nov 11 2026 a range here loaded nothing and the program picker read "All programs (0)".
  const SEP2 = day({
    date: "2026-09-02",
    changes: [change({ caseNumber: "G-100-25300-999999", observedOn: "2026-09-02", employerName: "Yesterday Corp", toStatus: "WITHDRAWN" })],
    total: 1090,
    byProgram: { perm: 1090, pwd: 0, lca: 0 },
    transitions: [
      { fromStatus: "ANALYST REVIEW", toStatus: "CERTIFIED", n: 1000 },
      { fromStatus: "ANALYST REVIEW", toStatus: "WITHDRAWN", n: 90 },
    ],
    expiriesExcluded: 13,
  });
  const SEP3 = day();

  /** Answer each day's own request, and nothing for a slot that skips. */
  function byDay(feeds: Record<string, ChangeDayFeed | "fail" | "wait">, retry = vi.fn()) {
    usePublicQuery.mockImplementation((url: string) => {
      const m = /case-changes\?date=(\d{4}-\d{2}-\d{2})/.exec(url);
      if (!m) return { data: undefined, failed: false, failure: null, retry };
      const f = feeds[m[1]!];
      if (f === "fail") return { data: undefined, failed: true, failure: { message: "The server didn't answer." }, retry };
      if (f === "wait" || f === undefined) return { data: undefined, failed: false, failure: null, retry };
      return { data: { day: f }, failed: false, failure: null, retry };
    });
    return retry;
  }
  const asked = () =>
    [...new Set(usePublicQuery.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("case-changes")))].map(
      (u) => /date=([\d-]+)/.exec(u)![1],
    );

  /** Moving From on a single day moves To with it, so a range is From first, then To back out. */
  function widenTo(from: string, to = "2026-09-03") {
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: from } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: to } });
  }

  it("loads each day in the range and adds them up, where it used to print zeros", () => {
    byDay({ "2026-09-03": SEP3, "2026-09-02": SEP2 });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    widenTo("2026-09-02");

    expect(asked()).toEqual(expect.arrayContaining(["2026-09-03", "2026-09-02"]));
    // 587 + 1,090, and each program's own sum.
    expect(screen.getByRole("option", { name: "All programs (1,677)" })).toBeInTheDocument();
    expect(screen.getByText(/4 changes from Wednesday, September 2, 2026 to Thursday, September 3, 2026/)).toBeInTheDocument();
    // Rows from both days, each with the day it was seen.
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /Seen/ })).toBeInTheDocument();
    expect(within(table).getByText("Yesterday Corp")).toBeInTheDocument();
    expect(within(table).getByText("Flextronics International USA, Inc.")).toBeInTheDocument();
    expect(within(table).getAllByText("2026-09-02").length).toBeGreaterThan(0);
  });

  it("adds a kind of change that both days hold into one chip", () => {
    byDay({ "2026-09-03": SEP3, "2026-09-02": SEP2 });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    widenTo("2026-09-02");
    // 175 on the 3rd and 1,000 on the 2nd.
    expect(screen.getByRole("button", { name: /ANALYST REVIEW.*CERTIFIED.*1,175/i })).toBeInTheDocument();
  });

  it("shows no total until every day has arrived, so a part is never read as the whole", () => {
    byDay({ "2026-09-03": SEP3, "2026-09-02": "wait" });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    widenTo("2026-09-02");
    expect(screen.getByRole("status")).toHaveTextContent("Loading 2 days of changes…");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("option", { name: "All programs (0)" })).toBeInTheDocument();
  });

  it("names a day that didn't come back, and tries only that day again", () => {
    const retry = byDay({ "2026-09-03": SEP3, "2026-09-02": "fail" });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    widenTo("2026-09-02");
    expect(screen.getByText(/One of those days/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says so in words when the range holds no day with a change", () => {
    byDay({});
    const windows = { ...WINDOWS, observed: { from: "2026-08-26", to: "2026-09-03" } };
    render(<ChangeFeedBrowser calendar={{ ...CALENDAR, days: [CALENDAR.days[0]!] }} initialDay={day()} windows={windows} />);
    // Aug 30 to Sep 1: inside our record, and the calendar lists no day there.
    widenTo("2026-08-30", "2026-09-01");
    expect(screen.getByText(/Our daily check recorded no change between Sunday, August 30, 2026 and Tuesday, September 1, 2026/)).toBeInTheDocument();
    expect(asked()).not.toContain("2026-08-31");
  });

  it("has a request slot for every day a range can load, and says how many days it left out", async () => {
    const { RANGE_DAYS_MAX } = await import("@/lib/changeFeedRange");
    const many = Array.from({ length: RANGE_DAYS_MAX + 2 }, (_, i) => `2026-09-${String(RANGE_DAYS_MAX + 2 - i).padStart(2, "0")}`);
    const calendar: ChangeCalendar = {
      ...CALENDAR,
      days: many.map((date) => ({ date, total: 10, byProgram: { perm: 10, pwd: 0, lca: 0 } })),
    };
    byDay(Object.fromEntries(many.map((date) => [date, day({ date, total: 10, changes: [change({ caseNumber: `G-100-25300-${date.slice(8)}0000`, observedOn: date })] })])));
    const windows = { ...WINDOWS, observed: { from: "2026-08-26", to: many[0]! } };
    render(<ChangeFeedBrowser calendar={calendar} initialDay={day({ date: many[0]! })} windows={windows} />);
    widenTo("2026-09-01", many[0]!);

    // The newest RANGE_DAYS_MAX days of the range were asked for, and no older one.
    const newest = many.slice(0, RANGE_DAYS_MAX);
    expect(asked()).toEqual(expect.arrayContaining(newest));
    expect(asked()).not.toContain(many[RANGE_DAYS_MAX]);
    expect(screen.getByRole("option", { name: `All programs (${RANGE_DAYS_MAX * 10})` })).toBeInTheDocument();
    expect(screen.getByText(/These are the newest 7 days of the range that hold a change/)).toHaveTextContent("2 earlier days aren't loaded");
  });

  it("keeps a single day exactly as it was: one request, no day column", () => {
    byDay({ "2026-09-03": SEP3 });
    render(<ChangeFeedBrowser calendar={CALENDAR} initialDay={day()} windows={WINDOWS} />);
    expect(asked()).toEqual(["2026-09-03"]);
    expect(within(screen.getByRole("table")).queryByRole("columnheader", { name: /Seen/ })).toBeNull();
    expect(screen.getByText(/3 changes on Thursday, September 3, 2026/)).toBeInTheDocument();
  });
});

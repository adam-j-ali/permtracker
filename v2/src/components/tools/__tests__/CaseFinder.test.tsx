import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FoundCase } from "@/lib/caseFinder";

import { CaseFinder } from "../CaseFinder";

/**
 * The finder asks /api/find-case for what a person knows about a case: any of the employer's name, the job title
 * and the law firm, with one filing date, two, or none (owner, Nov 10 2026: "time range rather than exact date ...
 * each optional, need to fill in at least one thing"). The server reads and matches; this is the form, what it
 * asks for and when, and how it says each answer.
 */
vi.mock("@/lib/funnelEvents", () => ({ trackFinder: vi.fn() }));
const { trackFinder } = await import("@/lib/funnelEvents");

const c = (n: number, employer: string, over: Partial<FoundCase> = {}): FoundCase => ({
  caseNumber: `G-100-26030-${String(n).padStart(6, "0")}`,
  status: "ANALYST REVIEW",
  employer,
  employerSlug: null,
  jobTitle: `Engineer ${n}`,
  final: false,
  filedOn: "2026-01-30",
  ...over,
});

const GOOGLE = [c(1, "Google LLC", { status: "CERTIFIED", final: true }), c(2, "GOOGLE LLC")];
const DAY_HELD = { filed: 4, decided: 2, waiting: 2 };
const answerOf = (over: Record<string, unknown> = {}) => ({
  program: "perm",
  asked: { employer: "", title: "", firm: "" },
  by: "window",
  window: { from: "2026-01-30", to: "2026-01-30", assumed: false },
  cases: GOOGLE,
  matched: 2,
  ofEmployer: 2,
  capped: false,
  period: DAY_HELD,
  close: [],
  firmUnknown: false,
  decidedOnly: false,
  ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers the finder and the nearby search, and keeps the addresses asked. */
function stub(find: ((ask: URLSearchParams) => unknown) | "fail" = () => answerOf(), nearby: { filedOn: string | null }[] = []) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url.startsWith("/api/find-case?")) {
        if (find === "fail") return json({ error: "DOL's record couldn't be read just now, so try again in a minute" }, 503);
        const ask = new URLSearchParams(url.split("?")[1]);
        // As the route does, every answer says what it was asked.
        return json({ ...(find(ask) as object), asked: { employer: ask.get("employer") ?? "", title: ask.get("title") ?? "", firm: ask.get("firm") ?? "" } });
      }
      if (url.startsWith("/api/case-search")) return json({ rows: nearby });
      return json({}, 404);
    }),
  );
  return asked;
}
const finds = (asked: string[]) => asked.filter((u) => u.startsWith("/api/find-case?")).map((u) => Object.fromEntries(new URLSearchParams(u.split("?")[1])));

const type = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: /employer/i }), { target: { value: text } });
const typeIn = (label: string | RegExp, text: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } });

afterEach(() => {
  // Unmount before the stub goes: a finder still on screen would send its next request to the real network.
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(trackFinder).mockClear();
});

describe("CaseFinder, on a host's date", () => {
  it("asks for nothing until there's a day and two letters of a name, then asks for that one day", async () => {
    const asked = stub();
    const { rerender } = render(<CaseFinder programs={["perm"]} day="" source="t" />);
    type("google");
    expect(screen.getByRole("status")).toHaveTextContent("Pick the filing date above");
    rerender(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    await screen.findByText(/DOL’s record holds 4 PERM cases filed on January 30, 2026: 2 decided, 2 still waiting\./);
    expect(finds(asked)).toEqual([{ program: "perm", employer: "google", from: "2026-01-30", to: "2026-01-30" }]);
    // A host's finder has the name and nothing else to fill in: its date is the host's.
    expect(screen.queryByLabelText("Job title")).toBeNull();
    expect(screen.queryByLabelText("Law firm")).toBeNull();
    expect(screen.queryByLabelText("Filed from")).toBeNull();
  });

  it("asks nothing for a single letter", async () => {
    const asked = stub();
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("g");
    await new Promise((r) => setTimeout(r, 500));
    expect(asked).toEqual([]);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists that employer's cases that day, each linked to its case page, and asks once a rested name", async () => {
    const asked = stub();
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="estimator" />);
    type("goo");
    type("goog");
    type("google inc");
    await screen.findByText(/2 are from an employer matching “google inc”\./);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("link", { name: "G-100-26030-000001" })).toHaveAttribute("href", "/perm-case-status?case=G-100-26030-000001");
    expect(within(rows[0]!).getByText("Certified")).toBeInTheDocument();
    // One day's list doesn't repeat its day on every row.
    expect(rows[0]).not.toHaveTextContent("Filed January 30");
    // Three keys, one request: the name rested once.
    expect(finds(asked)).toEqual([{ program: "perm", employer: "google inc", from: "2026-01-30", to: "2026-01-30" }]);
    expect(screen.getByRole("link", { name: "See everything filed that day" })).toHaveAttribute("href", "/perm-queue/2026-01/30?q=google%20inc");
    expect(screen.getByRole("link", { name: "Search every filing by this employer" })).toHaveAttribute("href", "/case-search?q=google%20inc");
    await waitFor(() => expect(trackFinder).toHaveBeenCalledWith("estimator", "perm", "cases"));
  });

  it("shows the first few of a long answer and the rest on request", async () => {
    stub(() => answerOf({ cases: Array.from({ length: 9 }, (_, i) => c(i + 1, "Amazon.com Services LLC")), matched: 9, ofEmployer: 9, period: { filed: 9, decided: 0, waiting: 9 } }));
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("amazon");
    await screen.findByText(/9 are from an employer matching “amazon”\./);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(9);
  });

  it("offers a job title box once the employer's list is long, and asks again with it", async () => {
    const asked = stub((ask) =>
      ask.get("title")
        ? answerOf({ cases: [c(3, "Amazon.com Services LLC", { jobTitle: "Data Scientist II" })], matched: 1, ofEmployer: 9 })
        : answerOf({ cases: Array.from({ length: 9 }, (_, i) => c(i + 1, "Amazon.com Services LLC")), matched: 9, ofEmployer: 9 }),
    );
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("amazon");
    await screen.findByText(/9 are from an employer matching “amazon”\./);
    fireEvent.change(screen.getByLabelText("Job title, to narrow these"), { target: { value: "data scientist" } });
    await screen.findByText(/9 are from an employer matching “amazon”, 1 with “data scientist” in the job title\./);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(finds(asked).at(-1)).toEqual({ program: "perm", employer: "amazon", title: "data scientist", from: "2026-01-30", to: "2026-01-30" });
    // The box stays while it holds words, though the list is short now.
    expect(screen.getByLabelText("Job title, to narrow these")).toHaveValue("data scientist");
  });

  it("offers the day's close spellings when the name fits none, and a pick asks for that employer", async () => {
    const asked = stub((ask) =>
      ask.get("employer") === "Google LLC"
        ? answerOf()
        : answerOf({ cases: [], matched: 0, ofEmployer: 0, close: [{ employer: "Google LLC", cases: 2 }] }),
    );
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("gogle");
    await screen.findByText(/None is from an employer matching “gogle”\./);
    expect(screen.getByText("Filed that day under a close name:")).toBeInTheDocument();
    // The answer is counted once the name has rested, as the kind of answer it was.
    await waitFor(() => expect(trackFinder).toHaveBeenCalledWith("t", "perm", "close-names"));
    fireEvent.click(screen.getByRole("button", { name: /Google LLC.*2 that day/ }));
    await screen.findByText(/2 are from an employer matching “Google LLC”\./);
    expect(finds(asked).at(-1)).toMatchObject({ employer: "Google LLC" });
    expect(screen.queryByText("Filed that day under a close name:")).toBeNull();
  });

  it("offers the days either side that a name starting the same way filed on, and hands the pick to the host", async () => {
    const asked = stub(() => answerOf({ cases: [], matched: 0, ofEmployer: 0 }), [{ filedOn: "2026-01-28" }, { filedOn: "2026-01-28" }, { filedOn: "2026-02-02" }]);
    const onDay = vi.fn();
    render(<CaseFinder programs={["perm"]} day="2026-01-30" onDay={onDay} source="t" />);
    type("zenith");
    fireEvent.click(await screen.findByRole("button", { name: /January 28, 2026/ }));
    expect(onDay).toHaveBeenCalledWith("2026-01-28");
    expect(asked.some((u) => u.startsWith("/api/case-search?q=zenith&programs=perm&from=2026-01-23&to=2026-02-06"))).toBe(true);
  });

  it("says the record couldn't be read, with a way to ask again, and never that nothing matched", async () => {
    stub("fail");
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("google");
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't be read");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/None is from/)).toBeNull();
    expect(trackFinder).not.toHaveBeenCalled();
  });

  it("asks for no day that hasn't come or that the lists don't reach", async () => {
    const asked = stub();
    const { rerender } = render(<CaseFinder programs={["perm"]} day="2099-01-01" source="t" />);
    type("google");
    expect(screen.getByRole("status")).toHaveTextContent("hasn’t come yet");
    rerender(<CaseFinder programs={["perm"]} day="2015-01-01" source="t" />);
    expect(screen.getByRole("status")).toHaveTextContent("The day lists start on October 1, 2019.");
    expect(screen.getByRole("link", { name: "Search every filing by this employer" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 500));
    expect(asked).toEqual([]);
  });

  it("says when more fit than one list carries", async () => {
    stub(() => answerOf({ capped: true }));
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("google");
    expect(await screen.findByText(/More fit than one list carries, so a case can be missing here\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "open the full search" })).toHaveAttribute("href", "/case-search?q=google");
  });

  it("says a day with no filings plainly, with no link to an empty day", async () => {
    stub((ask) => answerOf({ cases: [], matched: 0, ofEmployer: 0, period: { filed: 0, decided: 0, waiting: 0 }, window: { from: ask.get("from"), to: ask.get("to"), assumed: false } }));
    render(<CaseFinder programs={["perm"]} day="2026-01-31" source="t" />);
    type("google");
    await screen.findByText("DOL’s record holds no PERM cases filed on January 31, 2026.");
    expect(screen.queryByText(/None is from/)).toBeNull();
    expect(screen.queryByRole("link", { name: "See everything filed that day" })).toBeNull();
  });
});

describe("CaseFinder, standing apart", () => {
  it("shows every box, says one is enough, and asks for nothing until one is used", async () => {
    const asked = stub();
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    // Its title names the region and is no heading, so it can open at any depth of a page's outline.
    expect(screen.getByRole("region", { name: "Find your case without the number" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("button", { name: "PERM case" })).toHaveAttribute("aria-pressed", "true");
    for (const label of ["Employer’s name", "Job title", "Law firm", "Filed from", "Filed to"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    const hint = screen.getByText(/Fill in what you know\. One box is enough/);
    expect(screen.getByRole("textbox", { name: "Employer’s name" })).toHaveAttribute("aria-describedby", hint.id);
    await new Promise((r) => setTimeout(r, 450));
    expect(asked).toEqual([]);
  });

  it("takes one date alone as that day, with nothing else typed", async () => {
    const asked = stub((ask) => answerOf({ ofEmployer: undefined, window: { from: ask.get("from"), to: ask.get("from"), assumed: false } }));
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    typeIn("Filed from", "2026-01-30");
    await screen.findByText(/DOL’s record holds 4 PERM cases filed on January 30, 2026: 2 decided, 2 still waiting\./);
    expect(finds(asked)).toEqual([{ program: "perm", from: "2026-01-30" }]);
    expect(screen.queryByText(/Fill in what you know/)).toBeNull();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
    // Nothing was typed, so nothing is said to fit, and there's no employer to search by.
    expect(screen.queryByText(/fit what you typed/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Search every filing by this employer" })).toBeNull();
    expect(screen.getByRole("link", { name: "See everything filed that day" })).toHaveAttribute("href", "/perm-queue/2026-01/30");
  });

  it("takes two dates as the days between, and says each case's own filing day", async () => {
    const asked = stub(() =>
      answerOf({
        window: { from: "2026-01-05", to: "2026-01-31", assumed: false },
        cases: [c(1, "Google LLC", { filedOn: "2026-01-20" }), c(2, "GOOGLE LLC", { filedOn: "2026-01-05" })],
        period: { filed: 11635, decided: 9000, waiting: 2635 },
      }),
    );
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    type("google");
    typeIn("Filed from", "2026-01-05");
    typeIn("Filed to", "2026-01-31");
    await screen.findByText(/DOL’s record holds 11,635 PERM cases filed from January 5, 2026 to January 31, 2026: 9,000 decided, 2,635 still waiting\. 2 are from an employer matching “google”\./);
    await waitFor(() => expect(finds(asked).at(-1)).toEqual({ program: "perm", employer: "google", from: "2026-01-05", to: "2026-01-31" }));
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Filed January 20, 2026");
    expect(rows[1]).toHaveTextContent("Filed January 5, 2026");
    // A range has no one day's page to open.
    expect(screen.queryByRole("link", { name: "See everything filed that day" })).toBeNull();
  });

  it("takes a job title alone, and says it looked at the last three months", async () => {
    const asked = stub(() =>
      answerOf({ window: { from: "2026-08-11", to: "2026-11-10", assumed: true }, ofEmployer: undefined, matched: 2, period: { filed: 30000, decided: 100, waiting: 29900 } }),
    );
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    typeIn("Job title", "controls engineer");
    await screen.findByText(/Looking at PERM cases filed in the last three months, since August 11, 2026\. Add dates to look earlier\. 2 fit what you typed\./);
    expect(finds(asked)).toEqual([{ program: "perm", title: "controls engineer" }]);
  });

  it("takes a law firm alone: names the firm it read, the others the words fit, and that only decided cases can show", async () => {
    const asked = stub((ask) =>
      answerOf({
        by: "index",
        window: undefined,
        period: undefined,
        ofEmployer: undefined,
        decidedOnly: true,
        firm: { name: ask.get("firm") === "Smith Law LLC" ? "Smith Law LLC" : "Smith Immigration PC", slug: "smith", alternatives: ask.get("firm") === "Smith Law LLC" ? [] : [{ name: "Smith Law LLC", slug: "smith-law-llc" }] },
        cases: [c(1, "Google LLC", { status: "CERTIFIED", final: true, firm: "Smith Immigration PC", filedOn: "2025-03-02" })],
        matched: 1,
      }),
    );
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    typeIn("Law firm", "smith");
    await screen.findByText(/Looking through every year of DOL’s record of PERM cases, the newest filing first\. Showing Smith Immigration PC\. 1 fits what you typed\. DOL names a law firm only once it decides a case, so cases still waiting aren’t listed\./);
    expect(finds(asked)).toEqual([{ program: "perm", firm: "smith" }]);
    // The other firms are a list of their own, so the case's row is found by its number.
    const row = screen.getByRole("link", { name: "G-100-26030-000001" }).closest("li")!;
    expect(row).toHaveTextContent("Filed March 2, 2025");
    expect(row).toHaveTextContent("Filed by Smith Immigration PC");
    fireEvent.click(screen.getByRole("button", { name: /Smith Law LLC/ }));
    await screen.findByText(/Showing Smith Law LLC\./);
    expect(screen.getByLabelText("Law firm")).toHaveValue("Smith Law LLC");
  });

  it("says a law firm's words fit no firm", async () => {
    stub(() => answerOf({ by: "index", window: undefined, period: undefined, ofEmployer: undefined, cases: [], matched: 0, firmUnknown: true, decidedOnly: true }));
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    typeIn("Law firm", "zzzzzz");
    await screen.findByText(/No law firm matches “zzzzzz”\./);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("takes an employer alone over every year, and says the name is read from its start", async () => {
    const asked = stub(() => answerOf({ by: "index", window: undefined, period: undefined, ofEmployer: undefined, matched: 2 }));
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    type("google");
    await screen.findByText(/Looking through every year of DOL’s record of PERM cases, the newest filing first\. 2 are from an employer whose name starts with “google”\./);
    expect(finds(asked)).toEqual([{ program: "perm", employer: "google" }]);
  });

  it("asks for closer dates when they're more than three months apart with no name, and reads them once a name is there", async () => {
    const asked = stub(() => answerOf({ by: "index", window: { from: "2025-01-01", to: "2026-01-31", assumed: false }, ofEmployer: undefined }));
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    typeIn("Job title", "engineer");
    typeIn("Filed from", "2025-01-01");
    typeIn("Filed to", "2026-01-31");
    expect(await screen.findByText("Pick dates three months apart or less, or add the employer’s name or the law firm.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    // The first date alone was one day, and was read as one. The year between the two dates never was.
    expect(finds(asked).filter((a) => a.from && a.to)).toEqual([]);
    type("google");
    await waitFor(() => expect(finds(asked).at(-1)).toEqual({ program: "perm", employer: "google", title: "engineer", from: "2025-01-01", to: "2026-01-31" }));
  });

  it("asks again for another kind of filing, and names the firm box for the seasonal programs' agents", async () => {
    const asked = stub((ask) => answerOf({ program: ask.get("program") }));
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    type("google");
    typeIn("Filed from", "2026-01-30");
    await screen.findByText(/2 are from an employer matching “google”\./);
    fireEvent.click(screen.getByRole("button", { name: "Wage request" }));
    await waitFor(() => expect(finds(asked).at(-1)).toMatchObject({ program: "pwd", employer: "google", from: "2026-01-30" }));
    await screen.findByText(/DOL’s record holds 4 wage requests filed on January 30, 2026/);
    fireEvent.click(screen.getByRole("button", { name: "H-2A, H-2B or CW-1" }));
    expect(screen.getByLabelText("Law firm or agent")).toBeInTheDocument();
  });

  it("opens on the kind of filing its page is about", async () => {
    const asked = stub();
    render(<CaseFinder source="pwd-cases-finder" program="pwd" heading="Find your case without the number" />);
    expect(screen.getByRole("button", { name: "Wage request" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "PERM case" })).toHaveAttribute("aria-pressed", "false");
    type("google");
    await waitFor(() => expect(finds(asked)).toEqual([{ program: "pwd", employer: "google" }]));
  });

  it("counts an answer once a window, kind and outcome, however the name is retyped", async () => {
    stub();
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("goo");
    await waitFor(() => expect(trackFinder).toHaveBeenCalledTimes(1));
    type("google");
    await screen.findByText(/2 are from an employer matching “google”\./);
    type("google llc");
    await screen.findByText(/2 are from an employer matching “google llc”\./);
    // Long enough for a rested name to have counted again, if it were going to.
    await new Promise((r) => setTimeout(r, 600));
    expect(trackFinder).toHaveBeenCalledTimes(1);
    expect(trackFinder).toHaveBeenCalledWith("t", "perm", "cases");
  });

  it("moves its own day to a nearby one the reader picks", async () => {
    const asked = stub((ask) => answerOf({ cases: [], matched: 0, ofEmployer: 0, window: { from: ask.get("from"), to: ask.get("from"), assumed: false } }), [{ filedOn: "2026-01-28" }]);
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    type("zenith");
    typeIn("Filed from", "2026-01-30");
    fireEvent.click(await screen.findByRole("button", { name: /January 28, 2026/ }));
    await waitFor(() => expect(finds(asked).at(-1)).toEqual({ program: "perm", employer: "zenith", from: "2026-01-28" }));
    expect(screen.getByLabelText("Filed from")).toHaveValue("2026-01-28");
  });

  it("keeps the last answer up, marked busy, while the next is read", async () => {
    let release: (() => void) | undefined;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        if (asked.length > 1) await new Promise<void>((r) => (release = r));
        return json(answerOf({ asked: { employer: new URLSearchParams(url.split("?")[1]).get("employer") ?? "", title: "", firm: "" } }));
      }),
    );
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("google");
    await screen.findByText(/2 are from an employer matching “google”\./);
    type("google llc");
    await waitFor(() => expect(asked).toHaveLength(2));
    const list = screen.getByRole("list");
    expect(list.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    // Its words are still the last answer's own: the name typed since isn't put in its mouth.
    expect(screen.getByRole("status")).toHaveTextContent("2 are from an employer matching “google”.");
    expect(screen.getByRole("status")).not.toHaveTextContent("google llc");
    release?.();
    await waitFor(() => expect(screen.getByRole("list").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false"));
  });
});

describe("CaseFinder, opened by a press", () => {
  it("says what its boxes are for until one is used", () => {
    stub();
    render(<CaseFinder source="test" heading="Find your case without the number" />);
    const name = screen.getByRole("textbox", { name: "Employer’s name" });
    const hint = screen.getByText(/Fill in what you know\. One box is enough, and each one more narrows the list\. One date is that day; two are the days between, up to three months\./);
    expect(name).toHaveAttribute("aria-describedby", hint.id);
    type("go");
    expect(screen.queryByText(/Fill in what you know/)).toBeNull();
    expect(name).not.toHaveAttribute("aria-describedby");
  });

  it("puts the cursor in the first field still empty: the name, or the first date on an employer's own page", () => {
    stub();
    const first = render(<CaseFinder source="test" heading="Find your case without the number" autoFocus />);
    expect(screen.getByRole("textbox", { name: "Employer’s name" })).toHaveFocus();
    first.unmount();
    render(<CaseFinder source="test" heading="Find your case without the number" autoFocus employer="Google LLC" />);
    expect(screen.getByLabelText("Filed from")).toHaveFocus();
  });

  it("leaves the cursor where it was unless it was opened by a press", () => {
    stub();
    render(<CaseFinder source="test" heading="Find your case without the number" />);
    expect(screen.getByRole("textbox", { name: "Employer’s name" })).not.toHaveFocus();
  });

  it("draws no frame of its own inside a box", () => {
    stub();
    const { unmount } = render(<CaseFinder source="test" heading="Find your case without the number" flat />);
    expect(screen.getByRole("region", { name: "Find your case without the number" }).className).not.toMatch(/\bbg-card\b|(^|\s)border-2(\s|$)/);
    unmount();
    render(<CaseFinder source="test" heading="Find your case without the number" />);
    expect(screen.getByRole("region", { name: "Find your case without the number" }).className).toMatch(/\bbg-card\b/);
  });
});

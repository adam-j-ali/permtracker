import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DayCase } from "@/lib/filingDay";

import { CaseFinder } from "../CaseFinder";

vi.mock("@/lib/funnelEvents", () => ({ trackFinder: vi.fn() }));
const { trackFinder } = await import("@/lib/funnelEvents");

const c = (n: number, employer: string, final = false): DayCase => ({
  caseNumber: `G-100-26030-${String(n).padStart(6, "0")}`,
  status: final ? "CERTIFIED" : "ANALYST REVIEW",
  employer,
  employerSlug: null,
  jobTitle: `Engineer ${n}`,
  final,
});

const DAY = [c(1, "Google LLC", true), c(2, "GOOGLE LLC"), c(3, "Microsoft Corporation"), c(4, "Goggle Optics Inc", true)];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers the day list and the nearby search, and keeps the addresses asked. */
function stub(day: { cases: DayCase[]; capped?: boolean } | "fail", nearby: { filedOn: string | null }[] = []) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url.startsWith("/api/filed-on")) return day === "fail" ? json({ error: "that day's filings couldn't be read, so try again in a minute" }, 503) : json({ capped: false, ...day });
      if (url.startsWith("/api/case-search")) return json({ rows: nearby });
      return json({}, 404);
    }),
  );
  return asked;
}

const type = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: /employer/i }), { target: { value: text } });

afterEach(() => {
  // Unmount before the stub goes: a finder still on screen would send its next request to the real network.
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(trackFinder).mockClear();
});

describe("CaseFinder, on a host's date", () => {
  it("asks for nothing until there's a day and two letters of a name", async () => {
    const asked = stub({ cases: DAY });
    const { rerender } = render(<CaseFinder programs={["perm"]} day="" source="t" />);
    type("google");
    expect(screen.getByRole("status")).toHaveTextContent("Pick the filing date above");
    rerender(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    await screen.findByText(/DOL’s record holds 4 PERM cases filed on January 30, 2026: 2 decided, 2 still waiting\./);
    type("g");
    expect(screen.queryByRole("list")).toBeNull();
    expect(asked).toEqual(["/api/filed-on?day=2026-01-30&program=perm"]);
  });

  it("lists that employer's cases that day, each linked to its case page, and asks once however much is typed", async () => {
    const asked = stub({ cases: DAY });
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="estimator" />);
    type("goo");
    await screen.findByText(/2 are from an employer matching “goo”\./);
    type("google inc");
    await screen.findByText(/2 are from an employer matching “google inc”\./);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("link", { name: "G-100-26030-000001" })).toHaveAttribute("href", "/perm-case-status?case=G-100-26030-000001");
    expect(within(rows[0]!).getByText("Certified")).toBeInTheDocument();
    expect(asked).toEqual(["/api/filed-on?day=2026-01-30&program=perm"]);
    expect(screen.getByRole("link", { name: "See everything filed that day" })).toHaveAttribute("href", "/perm-queue/2026-01/30?q=google%20inc");
    expect(screen.getByRole("link", { name: "Search every filing by this employer" })).toHaveAttribute("href", "/case-search?q=google%20inc");
    await waitFor(() => expect(trackFinder).toHaveBeenCalledWith("estimator", "perm", "cases"));
  });

  it("shows the first few of a long answer and the rest on request", async () => {
    stub({ cases: Array.from({ length: 9 }, (_, i) => c(i + 1, "Acme Robotics Inc")) });
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("acme");
    await screen.findByText(/9 are from an employer matching “acme”\./);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(9);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("offers a job title box once the employer's list is long, and narrows by it without guessing another name", async () => {
    const jobs = ["Software Dev Engineer III", "Sr. Product Manager", "Data Scientist II", "Software Dev Engineer II", "Tech Ops Engineer", "Recruiter", "Welder"];
    stub({ cases: jobs.map((jobTitle, i) => ({ ...c(i + 1, "Acme Robotics Inc"), jobTitle })) });
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("goo");
    await screen.findByText(/None is from an employer matching “goo”\./);
    // A short list or none needs no second box.
    expect(screen.queryByLabelText("Job title, to narrow these")).toBeNull();

    type("acme");
    await screen.findByText(/7 are from an employer matching “acme”\./);
    fireEvent.change(screen.getByLabelText("Job title, to narrow these"), { target: { value: "dev engineer" } });
    await screen.findByText(/7 are from an employer matching “acme”, 2 with “dev engineer” in the job title\./);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Job title, to narrow these"), { target: { value: "astronaut" } });
    await screen.findByText(/7 are from an employer matching “acme”, 0 with “astronaut” in the job title\./);
    expect(screen.queryByRole("list")).toBeNull();
    // The employer was found, so no other name and no other day is offered, and the box stays to be corrected.
    expect(screen.queryByText(/close name/)).toBeNull();
    expect(screen.getByLabelText("Job title, to narrow these")).toHaveValue("astronaut");
  });

  it("offers the day's close spellings when the name fits none, and a pick lists that employer", async () => {
    stub({ cases: DAY });
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("gogle");
    await screen.findByText(/None is from an employer matching “gogle”\./);
    expect(screen.getByText("Filed that day under a close name:")).toBeInTheDocument();
    // The answer is counted once the name has rested, as the kind of answer it was.
    await waitFor(() => expect(trackFinder).toHaveBeenCalledWith("t", "perm", "close-names"));
    // Both spellings of the company are one chip, carrying its two cases.
    fireEvent.click(screen.getByRole("button", { name: /Google LLC.*2 that day/ }));
    await screen.findByText(/2 are from an employer matching “Google LLC”\./);
    expect(screen.queryByText("Filed that day under a close name:")).toBeNull();
  });

  it("offers the days either side that a name starting the same way filed on, and hands the pick to the host", async () => {
    const asked = stub({ cases: DAY }, [{ filedOn: "2026-01-29" }, { filedOn: "2026-01-29" }, { filedOn: "2026-02-02" }, { filedOn: "2026-01-30" }]);
    const onDay = vi.fn();
    render(<CaseFinder programs={["perm"]} day="2026-01-30" onDay={onDay} source="t" />);
    type("zenith");
    await screen.findByText(/None is from an employer matching “zenith”\./);
    const near = await screen.findByRole("button", { name: /January 29, 2026.*2 filings/ });
    expect(asked.at(-1)).toBe("/api/case-search?q=zenith&programs=perm&from=2026-01-23&to=2026-02-06&limit=200");
    expect(screen.getByRole("button", { name: /February 2, 2026.*1 filing/ })).toBeInTheDocument();
    fireEvent.click(near);
    expect(onDay).toHaveBeenCalledWith("2026-01-29");
    await waitFor(() => expect(trackFinder).toHaveBeenCalledWith("t", "perm", "none"));
  });

  it("says a day that couldn't be read, with a way to ask again, and never that nothing matched", async () => {
    stub("fail");
    render(<CaseFinder programs={["perm"]} day="2026-01-30" source="t" />);
    type("google");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The PERM cases filed on January 30, 2026 didn't load.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/None is from/)).toBeNull();
    expect(trackFinder).not.toHaveBeenCalled();
  });

  it("asks for no day that hasn't come or that the lists don't reach", () => {
    const asked = stub({ cases: DAY });
    const { rerender } = render(<CaseFinder programs={["perm"]} day="2099-01-01" source="t" />);
    type("google");
    expect(screen.getByRole("status")).toHaveTextContent("January 1, 2099 hasn't come yet");
    rerender(<CaseFinder programs={["perm"]} day="2019-09-30" source="t" />);
    expect(screen.getByRole("status")).toHaveTextContent("The day lists start on October 1, 2019.");
    expect(asked).toEqual([]);
  });

  it("says when the day holds more than its list carries", async () => {
    stub({ cases: DAY, capped: true });
    render(<CaseFinder programs={["lca"]} day="2026-01-30" source="t" />);
    type("google");
    await screen.findByText(/This day holds more filings than its list carries/);
    expect(screen.getByRole("link", { name: "See everything filed that day" })).toHaveAttribute("href", "/perm-queue/2026-01/30?kind=lca&q=google");
  });

  it("says a day with no filings plainly", async () => {
    stub({ cases: [] });
    render(<CaseFinder programs={["perm"]} day="2026-01-31" source="t" />);
    type("google");
    await screen.findByText("DOL’s record holds no PERM cases filed on January 31, 2026.");
    expect(screen.queryByRole("link", { name: "See everything filed that day" })).toBeNull();
  });
});

describe("CaseFinder, standing apart", () => {
  it("asks for the day itself and lets the reader choose the kind of filing", async () => {
    const asked = stub({ cases: DAY });
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    // Its title names the region and is no heading, so it can open at any depth of a page's outline.
    expect(screen.getByRole("region", { name: "Find your case without the number" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("button", { name: "PERM case" })).toHaveAttribute("aria-pressed", "true");
    type("google");
    fireEvent.change(screen.getByLabelText("Date it was filed"), { target: { value: "2026-01-30" } });
    await screen.findByText(/2 are from an employer matching “google”\./);
    fireEvent.click(screen.getByRole("button", { name: "Wage request" }));
    await waitFor(() => expect(asked).toContain("/api/filed-on?day=2026-01-30&program=pwd"));
    await screen.findByText(/DOL’s record holds 4 wage requests filed on January 30, 2026/);
  });

  it("opens on the kind of filing its page is about", async () => {
    const asked = stub({ cases: DAY });
    render(<CaseFinder source="pwd-cases-finder" program="pwd" heading="Find your case without the number" />);
    expect(screen.getByRole("button", { name: "Wage request" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "PERM case" })).toHaveAttribute("aria-pressed", "false");
    type("google");
    fireEvent.change(screen.getByLabelText("Date it was filed"), { target: { value: "2026-01-30" } });
    await waitFor(() => expect(asked).toEqual(["/api/filed-on?day=2026-01-30&program=pwd"]));
  });

  it("counts an answer once a day, kind and outcome, however the name is retyped", async () => {
    stub({ cases: DAY });
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
    const asked = stub({ cases: DAY }, [{ filedOn: "2026-01-28" }]);
    render(<CaseFinder source="lookup" heading="Find your case without the number" />);
    type("zenith");
    fireEvent.change(screen.getByLabelText("Date it was filed"), { target: { value: "2026-01-30" } });
    fireEvent.click(await screen.findByRole("button", { name: /January 28, 2026/ }));
    await waitFor(() => expect(asked).toContain("/api/filed-on?day=2026-01-28&program=perm"));
  });
});

describe("CaseFinder, opened by a press", () => {
  it("says what its two boxes are for until the first is used, then what's still missing", () => {
    stub({ cases: DAY });
    render(<CaseFinder source="test" heading="Find your case without the number" />);
    const name = screen.getByRole("textbox", { name: "Employer’s name" });
    const hint = screen.getByText(/Type the employer.s name and the day it was filed\. Its filings from that day show here\./);
    expect(name).toHaveAttribute("aria-describedby", hint.id);
    type("go");
    expect(screen.queryByText(/Type the employer.s name and the day it was filed/)).toBeNull();
    expect(name).not.toHaveAttribute("aria-describedby");
    expect(screen.getByText("Add the filing date to see this employer’s cases from that day.")).toBeInTheDocument();
  });

  it("puts the cursor in the first field still empty: the name, or the day on an employer's own page", () => {
    stub({ cases: DAY });
    const first = render(<CaseFinder source="test" heading="Find your case without the number" autoFocus />);
    expect(screen.getByRole("textbox", { name: "Employer’s name" })).toHaveFocus();
    first.unmount();
    render(<CaseFinder source="test" heading="Find your case without the number" autoFocus employer="Google LLC" />);
    expect(screen.getByLabelText("Date it was filed")).toHaveFocus();
  });

  it("leaves the cursor where it was unless it was opened by a press", () => {
    stub({ cases: DAY });
    render(<CaseFinder source="test" heading="Find your case without the number" />);
    expect(screen.getByRole("textbox", { name: "Employer’s name" })).not.toHaveFocus();
  });

  it("draws no frame of its own inside a box", () => {
    stub({ cases: DAY });
    const { unmount } = render(<CaseFinder source="test" heading="Find your case without the number" flat />);
    expect(screen.getByRole("region", { name: "Find your case without the number" }).className).not.toMatch(/\bbg-card\b|(^|\s)border-2(\s|$)/);
    unmount();
    render(<CaseFinder source="test" heading="Find your case without the number" />);
    expect(screen.getByRole("region", { name: "Find your case without the number" }).className).toMatch(/\bbg-card\b/);
  });
});

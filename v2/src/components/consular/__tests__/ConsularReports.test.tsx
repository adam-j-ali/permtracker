import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MIN_REPORTS, REPORT_WEEKS } from "@/lib/consularReport";
import { reportView, type StoredReportView } from "@/lib/consularReportView";

import { ConsularReports } from "../ConsularReports";
import { ReportedPosts } from "../ReportedPosts";
import FIXTURES from "./fixtures/report-views.json";

/**
 * The figures above the form, as the hourly build stores them: the views in the fixture are the server's engine's
 * own output (scripts/test_lib_reported_summary.py writes and checks them), so the floor under test is the one the
 * build applies. What must hold: under three reports no outcome, kind of visa, week or median prints, only "too few
 * reports yet"; at three they print, every figure labelled self-reported; a median after the interview never prints
 * without the count still waiting; the index panel names only consulates State lists.
 */

const views = FIXTURES as unknown as Record<"two" | "three" | "after", StoredReportView>;
const view = (name: keyof typeof views) => reportView(views[name]);

beforeEach(() => {
  // The form inside posts nowhere in these tests.
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
});

describe("the engine and the words agree", () => {
  it("names the floor and the weeks the build counts", () => {
    expect(views.two.floor).toBe(MIN_REPORTS);
    expect(views.two.weeks).toHaveLength(REPORT_WEEKS);
  });

  it("puts the form's words and order on the stored counts, and an empty cell on a kind nobody reported", () => {
    const v = view("three");
    expect(v.categories.map((c) => c.id)).toEqual(["employment", "h1b", "h4", "l1", "l2", "family", "immediate", "k1", "f1", "b1b2", "other"]);
    expect(v.categories.find((c) => c.id === "h1b")?.byOutcome).toEqual([
      { id: "issued", label: "Visa issued", count: 2 },
      { id: "221g", label: "221(g), more processing", count: 1 },
    ]);
    expect(v.categories.find((c) => c.id === "employment")).toMatchObject({ label: "Employment green card", count: null, open: false, byOutcome: [] });
  });
});

describe("ConsularReports: the three-report floor", () => {
  it("prints only \"too few reports yet\" under three reports", () => {
    const v = view("two");
    render(<ConsularReports name="Mumbai" post="mumbai" view={v} all={v} />);
    const section = screen.getByRole("region", { name: /what people report/i });
    const text = section.textContent ?? "";
    expect(text).toMatch(/Too few reports yet: 2 reports so far/);
    // No outcome breakdown, no share and no week count escape.
    expect(text).not.toMatch(/Visa issued/);
    expect(within(section).getAllByText("Not yet").length).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/no week in the last 12 has 3 interviews reported/);
    // No kind of visa is listed until three people report one, and the plate says so.
    expect(text).toMatch(/Too few reports yet for any kind of visa/);
    expect(text).not.toMatch(/H-1B/);
  });

  it("prints the figures from three reports, each labelled self-reported", () => {
    const v = view("three");
    render(<ConsularReports name="Mumbai" post="mumbai" view={v} all={v} />);
    const section = screen.getByRole("region", { name: /what people report/i });
    const text = section.textContent ?? "";
    expect(text).toMatch(/1 of 3 interviews with a result/);
    expect(text).toMatch(/Visa issued/);
    expect(text).toMatch(/H-1B/);
    // The one kind past the floor is listed; the rest are one line, never a row each.
    expect(text).toMatch(/Too few reports yet for every other kind of visa/);
    expect(text).not.toMatch(/Employment green card/);
    expect((text.match(/Visitors' own reports, unchecked/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("never prints a median after the interview without the count still waiting", () => {
    const v = view("after");
    render(<ConsularReports name="Mumbai" post="mumbai" view={v} all={v} />);
    const plate = screen.getByText("From the interview to the visa").closest("figure")!;
    expect(plate.textContent).toMatch(/1 day/);
    expect(plate.textContent).toMatch(/3 finished, 1 still waiting/);
  });

  it("says the reports can't be read when the read failed", () => {
    render(<ConsularReports name="Mumbai" post="mumbai" view={null} all={null} />);
    expect(screen.getByText(/can't be read right now/)).toBeInTheDocument();
  });
});

describe("ReportedPosts: the index panel", () => {
  it("names only consulates State lists, with the 221(g) share only from three results", () => {
    render(
      <ReportedPosts
        busiest={[
          { post: "mumbai", reports30: 5, results: 4, g221: 1 },
          { post: "made-up-post", reports30: 4, results: 3, g221: 3 },
          { post: "manila", reports30: 3, results: null, g221: null },
        ]}
        posts={[
          { slug: "mumbai", name: "Mumbai" },
          { slug: "manila", name: "Manila" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Mumbai" })).toHaveAttribute("href", "/consular-posts/mumbai#reports");
    expect(screen.getByText(/25% of 4 results ended in 221\(g\)/)).toBeInTheDocument();
    expect(screen.getByText(/Too few results yet/)).toBeInTheDocument();
    expect(screen.queryByText(/made-up-post/)).toBeNull();
    expect(screen.getByText(/Visitors' own reports, unchecked/)).toBeInTheDocument();
  });

  it("says so when no consulate has three reports yet", () => {
    render(<ReportedPosts busiest={[]} posts={[{ slug: "mumbai", name: "Mumbai" }]} />);
    expect(screen.getByText(/No consulate has/)).toBeInTheDocument();
  });
});
